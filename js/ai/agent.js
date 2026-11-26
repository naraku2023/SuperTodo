/**
 * 对话代理中枢：DeepSeek V4 适配、非破坏性上下文压缩与长期会话管理
 */

import { state, saveState, emit, getProjectByName, getProjectById, ensureTag } from '../state.js';
import { COMPACTION_DEFAULTS } from '../config.js';
import {
  createTask,
  createSubtask,
  createChatMessage,
  createSessionMeta,
  createCompactionCheckpoint,
  estimateTokens,
  normalizeTaskExtra
} from '../models.js';
import { AIClient } from './client.js';
import {
  buildStaticSystemPrompt,
  buildDynamicTurnContext,
  buildCompactionPrompt
} from './prompts.js';

const COMPACT_CHUNK_TOKEN_LIMIT = 24000;

class AIAgent {
  constructor() {
    this.client = null;
    this.abortController = null;
    this.isGenerating = false;
    this.activeSessionKey = null; // 'global' | task.id
  }

  initClient() {
    this.client = new AIClient({
      base: state.ai.base,
      key: state.ai.key,
      model: state.ai.model,
      thinkingMode: state.ai.thinkingMode || 'disabled'
    });
  }

  isConfigured() {
    return Boolean(state.ai && state.ai.enabled && state.ai.base && state.ai.key);
  }

  /**
   * 统一获取当前会话的存储引用（历史数组 + 元数据）
   */
  getSessionStore(taskContext = null) {
    if (taskContext) {
      if (!Array.isArray(taskContext.chatHistory)) taskContext.chatHistory = [];
      if (!taskContext.sessionMeta) taskContext.sessionMeta = createSessionMeta();
      return {
        history: taskContext.chatHistory,
        meta: taskContext.sessionMeta,
        key: taskContext.id,
        title: taskContext.title || '未命名事项',
        isGlobal: false
      };
    }
    if (!Array.isArray(state.chatHistory)) state.chatHistory = [];
    if (!state.globalSessionMeta) state.globalSessionMeta = createSessionMeta();
    return {
      history: state.chatHistory,
      meta: state.globalSessionMeta,
      key: 'global',
      title: '全局规划总管',
      isGlobal: true
    };
  }

  /**
   * 获取自上次压缩点之后的活跃未压缩普通消息切片
   */
  getActiveHistorySlice(history = [], meta = null) {
    const normalMsgs = history.filter(m =>
      m && m.kind !== 'checkpoint' &&
      !(m.role === 'assistant' && String(m.content || '').startsWith('⚠️ 未配置或未开启 AI 服务'))
    );
    const upToId = meta?.compactedUpToMsgId;
    if (!upToId) return normalMsgs;
    const idx = normalMsgs.findIndex(m => m.id === upToId);
    return idx === -1 ? normalMsgs : normalMsgs.slice(idx + 1);
  }

  /**
   * 计算会话当前上下文统计与压缩触发判断
   */
  getSessionStats(taskContext = null) {
    const { history, meta } = this.getSessionStore(taskContext);
    const allNormal = history.filter(m => m && m.kind !== 'checkpoint');
    const activeSlice = this.getActiveHistorySlice(history, meta);

    let activeTokens = estimateTokens(meta.activeSummary || '');
    activeSlice.forEach(m => {
      activeTokens += estimateTokens(m.content || '') + 8;
    });

    const thrMsgs = Number(state.ai?.compactThresholdMsgs) || COMPACTION_DEFAULTS.thresholdMessages;
    const thrTokens = Number(state.ai?.compactThresholdTokens) || COMPACTION_DEFAULTS.thresholdTokens;
    const shouldAutoCompact = Boolean(state.ai?.autoCompact) &&
      activeSlice.length > COMPACTION_DEFAULTS.keepRecentMessages &&
      (activeSlice.length >= thrMsgs || activeTokens >= thrTokens);

    const lastUsage = meta.lastUsage || null;
    let cacheHitRate = null;
    if (lastUsage && lastUsage.prompt_tokens > 0 && lastUsage.prompt_cache_hit_tokens !== undefined) {
      cacheHitRate = Math.round((lastUsage.prompt_cache_hit_tokens / lastUsage.prompt_tokens) * 100);
    }

    return {
      totalMessages: allNormal.length,
      activeMessages: activeSlice.length,
      activeTokens,
      compactionCount: Array.isArray(meta.compactions) ? meta.compactions.length : 0,
      hasSummary: Boolean(meta.activeSummary),
      pinned: Boolean(meta.pinned),
      lastUsage,
      cacheHitRate,
      totalTokensUsed: meta.totalTokensUsed || 0,
      totalCacheHitTokens: meta.totalCacheHitTokens || 0,
      shouldAutoCompact
    };
  }

  /**
   * 切换会话置顶状态
   */
  toggleSessionPin(taskContext = null) {
    const { meta } = this.getSessionStore(taskContext);
    meta.pinned = !meta.pinned;
    saveState();
    emit(taskContext ? 'task-chat-updated' : 'chat-updated', taskContext ? { taskId: taskContext.id } : state.chatHistory);
    return meta.pinned;
  }

  /**
   * 构造 KV 缓存友好的消息序列：
   * [0] 100% 静态系统指令
   * [1..2] 稳定的压缩检查点摘要对（如有）
   * [3..n] 仅自 compactedUpToMsgId 之后的未压缩消息（严格 user/assistant 交替）
   * 最后一条 user 消息尾部附加动态实时状态上下文
   */
  buildApiMessages(staticSystemPrompt, historyList = [], sessionMeta = null, dynamicTailContext = '') {
    const messages = [{ role: 'system', content: staticSystemPrompt }];

    if (sessionMeta && sessionMeta.activeSummary) {
      messages.push(
        {
          role: 'user',
          content: `【此前历史对话压缩摘要 (Checkpoint)】\n${sessionMeta.activeSummary}`
        },
        {
          role: 'assistant',
          content: '已载入此前压缩的会话记忆，接下来将基于此上下文继续协助你。'
        }
      );
    }

    const activeSlice = this.getActiveHistorySlice(historyList, sessionMeta);
    const normalized = [];

    for (const msg of activeSlice) {
      const content = String(msg?.content || '').trim();
      if (!content) continue;
      const role = msg.role === 'assistant' ? 'assistant' : 'user';
      // 无检查点时保证第一条非 system 消息必须为 user
      if (!sessionMeta?.activeSummary && normalized.length === 0 && role === 'assistant') continue;

      const last = normalized[normalized.length - 1];
      if (last && last.role === role) {
        last.content += `\n${content}`;
      } else {
        normalized.push({ role, content });
      }
    }

    if (dynamicTailContext && normalized.length > 0) {
      for (let i = normalized.length - 1; i >= 0; i--) {
        if (normalized[i].role === 'user') {
          normalized[i] = {
            role: 'user',
            content: `${normalized[i].content}\n\n${dynamicTailContext}`
          };
          break;
        }
      }
    }

    return messages.concat(normalized);
  }

  /**
   * 非破坏性上下文压缩（借鉴 DeepSeek Harness Compaction 机制 + 防溢出分块压缩）：
   * 原始历史对话 100% 保留，仅推进 compactedUpToMsgId 并生成可展开 Checkpoint 卡片
   */
  async compactSession(taskContext = null, { force = false, onProgress = null } = {}) {
    if (!this.isConfigured()) {
      throw new Error('未配置或未开启 AI 服务，无法执行上下文压缩');
    }

    this.initClient();
    const { history, meta, title, isGlobal } = this.getSessionStore(taskContext);
    const activeSlice = this.getActiveHistorySlice(history, meta);
    const keepCount = force ? Math.min(2, Math.max(0, activeSlice.length - 2)) : COMPACTION_DEFAULTS.keepRecentMessages;

    if (activeSlice.length <= keepCount + 1) {
      return { compacted: false, reason: '当前活跃上下文较短，无需压缩' };
    }

    const toCompact = activeSlice.slice(0, activeSlice.length - keepCount);
    const lastCompactedMsg = toCompact[toCompact.length - 1];
    if (!lastCompactedMsg) {
      return { compacted: false, reason: '没有可压缩的消息片段' };
    }

    const tokenBefore = estimateTokens(meta.activeSummary || '') +
      toCompact.reduce((sum, m) => sum + estimateTokens(m.content || ''), 0);

    // 将待压缩消息切分为不超过 COMPACT_CHUNK_TOKEN_LIMIT 的块，防止单次压缩溢出报错
    const chunks = [];
    let currentChunk = [];
    let currentChunkTokens = 0;
    for (const m of toCompact) {
      const t = estimateTokens(m.content || '') + 16;
      if (currentChunk.length > 0 && currentChunkTokens + t > COMPACT_CHUNK_TOKEN_LIMIT) {
        chunks.push(currentChunk);
        currentChunk = [m];
        currentChunkTokens = t;
      } else {
        currentChunk.push(m);
        currentChunkTokens += t;
      }
    }
    if (currentChunk.length > 0) chunks.push(currentChunk);

    let runningSummary = meta.activeSummary || '';
    for (let i = 0; i < chunks.length; i++) {
      onProgress?.(`正在压缩历史上下文 (${i + 1}/${chunks.length})...`);
      const transcript = chunks[i]
        .map(m => `[${m.role === 'assistant' ? '助手' : '用户'}]: ${m.content}`)
        .join('\n\n');

      const sysPrompt = buildCompactionPrompt({
        existingSummary: runningSummary,
        taskTitle: title,
        isGlobal
      });

      const summaryText = await this.client.chat({
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: `请压缩以下对话历史：\n\n${transcript}` }
        ],
        temperature: 0.2,
        thinkingModeOverride: 'disabled'
      });

      if (summaryText && summaryText.trim()) {
        runningSummary = summaryText.trim();
      }
    }

    const tokenAfter = estimateTokens(runningSummary);
    const cp = createCompactionCheckpoint({
      summary: runningSummary,
      compactedUpToMsgId: lastCompactedMsg.id,
      compactedCount: toCompact.length,
      tokenBefore,
      tokenAfter
    });

    meta.activeSummary = runningSummary;
    meta.compactedUpToMsgId = lastCompactedMsg.id;
    if (!Array.isArray(meta.compactions)) meta.compactions = [];
    meta.compactions.push(cp);

    const cpMsg = createChatMessage('system', runningSummary, null, false, {
      kind: 'checkpoint',
      checkpoint: cp
    });
    history.push(cpMsg);

    saveState();
    emit(taskContext ? 'task-chat-updated' : 'chat-updated', taskContext ? { taskId: taskContext.id, history } : history);

    return {
      compacted: true,
      checkpoint: cp,
      message: cpMsg
    };
  }

  /**
   * 从 AI 的完整回复文本中分离出自然回复与结构化动作 JSON
   */
  parseResponse(rawText) {
    let text = String(rawText || '');
    let actionPayload = null;

    const jsonBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/ig;
    const matches = Array.from(text.matchAll(jsonBlockRegex));

    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      try {
        const parsed = JSON.parse(m[1].trim());
        if (parsed && typeof parsed === 'object' && parsed.intent) {
          actionPayload = parsed;
          text = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim();
          break;
        }
      } catch (e) {}
    }

    if (!actionPayload) {
      try {
        const firstBrace = text.indexOf('{');
        const lastBrace = text.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          const possibleJson = text.slice(firstBrace, lastBrace + 1);
          const parsed = JSON.parse(possibleJson);
          if (parsed && typeof parsed === 'object' && parsed.intent) {
            actionPayload = parsed;
            text = (text.slice(0, firstBrace) + text.slice(lastBrace + 1)).trim();
          }
        }
      } catch (err) {}
    }

    return { displayText: text || '已为您分析并整理好以下规划方案：', actionPayload };
  }

  /**
   * 测试当前配置连通性
   */
  async testConnection(overrideConfig = null, signal = null) {
    const cfg = overrideConfig || {
      base: state.ai.base,
      key: state.ai.key,
      model: state.ai.model,
      thinkingMode: state.ai.thinkingMode
    };
    const client = new AIClient(cfg);
    return client.testConnection(signal);
  }

  /**
   * 发起多轮对话流式生成（支持 /compact 命令、自动上下文压缩、DeepSeek V4 thinking 与 usage 统计）
   */
  async sendMessage(
    userText,
    { onUserMessage, onStatus, onCompacted, onReasoning, onDelta, onComplete, onError },
    taskContext = null
  ) {
    if (!this.isConfigured()) {
      throw new Error('未配置或未开启 AI 服务，请先前往「设置」配置 API Key');
    }

    this.initClient();

    // 斜杠指令：手动立即压缩上下文
    if (String(userText || '').trim().toLowerCase() === '/compact') {
      onStatus?.('正在压缩历史上下文...');
      const res = await this.compactSession(taskContext, {
        force: true,
        onProgress: msg => onStatus?.(msg)
      });
      onCompacted?.(res);
      return;
    }

    if (this.abortController) {
      this.abortController.abort();
    }
    const controller = new AbortController();
    this.abortController = controller;
    const { history: historyList, meta, key: sessionKey } = this.getSessionStore(taskContext);
    this.activeSessionKey = sessionKey;
    this.isGenerating = true;

    // 1. 先检查是否需要自动上下文压缩（在写入新 user 消息前完成）
    const statsBefore = this.getSessionStats(taskContext);
    if (statsBefore.shouldAutoCompact) {
      try {
        onStatus?.('对话较长，正在自动压缩早期上下文以保持清晰记忆...');
        const cmpRes = await this.compactSession(taskContext, {
          force: false,
          onProgress: msg => onStatus?.(msg)
        });
        if (cmpRes.compacted) {
          onCompacted?.(cmpRes);
        }
      } catch (e) {
        // 自动压缩失败不阻断本轮正常对话
        console.warn('Auto compaction skipped:', e);
      }
    }

    // 2. 立即记录用户消息
    const userMsg = createChatMessage('user', userText);
    historyList.push(userMsg);
    if (taskContext) {
      taskContext.lastChatAt = userMsg.timestamp;
    }
    saveState();
    onUserMessage?.(userMsg);

    emit(taskContext ? 'task-chat-updated' : 'chat-updated', taskContext ? { taskId: taskContext.id, history: historyList } : state.chatHistory);

    // 3. 组装静态前缀 + 压缩摘要 + 活跃消息 + 尾部动态上下文
    const staticSystemPrompt = buildStaticSystemPrompt();
    const dynamicTail = buildDynamicTurnContext({
      projects: state.projects,
      tags: state.tags,
      types: state.types,
      currentTasks: state.items,
      taskContext
    });
    const messages = this.buildApiMessages(staticSystemPrompt, historyList, meta, dynamicTail);

    try {
      await this.client.chatStream({
        messages,
        signal: controller.signal,
        onReasoning: (rDelta, rAcc) => {
          if (this.abortController !== controller) return;
          onReasoning?.(rDelta, rAcc);
        },
        onChunk: (delta, accumulated) => {
          if (this.abortController !== controller) return;
          const previewText = accumulated.replace(/```(?:json)?[\s\S]*$/, '\n*(正在提炼结构化规划...)*');
          onDelta?.(previewText);
        },
        onDone: (accumulated, _rAcc, lastUsage) => {
          if (this.abortController !== controller) return;
          this.isGenerating = false;
          this.abortController = null;
          this.activeSessionKey = null;

          if (lastUsage) {
            meta.lastUsage = lastUsage;
            meta.totalTokensUsed = (meta.totalTokensUsed || 0) + (lastUsage.total_tokens || 0);
            meta.totalCacheHitTokens = (meta.totalCacheHitTokens || 0) + (lastUsage.prompt_cache_hit_tokens || 0);
          }

          const { displayText, actionPayload } = this.parseResponse(accumulated);
          const botMsg = createChatMessage('assistant', displayText, actionPayload, false, { usage: lastUsage });
          historyList.push(botMsg);
          if (taskContext) {
            taskContext.lastChatAt = botMsg.timestamp;
          }
          saveState();

          emit(taskContext ? 'task-chat-updated' : 'chat-updated', taskContext ? { taskId: taskContext.id, history: historyList } : state.chatHistory);
          onComplete?.(botMsg);
        },
        onError: (err) => {
          if (this.abortController !== controller) return;
          this.isGenerating = false;
          this.abortController = null;
          this.activeSessionKey = null;
          onError?.(err);
        }
      });
    } catch (err) {
      if (this.abortController === controller) {
        this.isGenerating = false;
        this.abortController = null;
        this.activeSessionKey = null;
      }
      if (err.name !== 'AbortError') {
        onError?.(err);
      }
    }
  }

  /**
   * 导出单个事项或全局会话为结构化 Markdown 文档
   */
  exportSessionMarkdown(taskContext = null) {
    const { history, meta, title } = this.getSessionStore(taskContext);
    const lines = [`# ${title} — 会话记录`, ''];

    if (taskContext) {
      const proj = getProjectById(taskContext.projectId);
      lines.push(`- **所属项目**：${proj ? `${proj.icon} ${proj.name}` : '收集箱'}`);
      lines.push(`- **状态 / 优先级**：${taskContext.status || 'todo'} / ${taskContext.priority || 'medium'}`);
      if (taskContext.startDate || taskContext.due) {
        lines.push(`- **排期**：${taskContext.startDate || '未定'} ~ ${taskContext.due || '未定'}`);
      }
      lines.push('');
    }

    if (meta.activeSummary) {
      lines.push('## 上下文压缩摘要 (Checkpoint)', '', meta.activeSummary, '');
    }

    lines.push('## 对话完整记录', '');
    history.forEach(m => {
      const timeStr = m.timestamp ? new Date(m.timestamp).toLocaleString('zh-CN') : '';
      if (m.kind === 'checkpoint') {
        lines.push(`> **[上下文压缩检查点 · ${timeStr}]** 已压缩 ${m.checkpoint?.compactedCount || 0} 条旧消息`, '');
        return;
      }
      const roleLabel = m.role === 'assistant' ? '🤖 AI 助手' : '👤 我';
      lines.push(`### ${roleLabel} (${timeStr})`, '', m.content, '');
    });

    return lines.join('\n');
  }

  /**
   * 清理已归档事项的冗长原文消息（保留压缩摘要与最近 2 条核心消息），释放存储空间
   */
  pruneArchivedSessions() {
    let cleanedTasks = 0;
    let removedMessages = 0;

    state.items.forEach(it => {
      if (!it.done || !Array.isArray(it.chatHistory)) return;
      const normalMsgs = it.chatHistory.filter(m => m.kind !== 'checkpoint');
      if (normalMsgs.length <= 4) return;

      const kept = normalMsgs.slice(-2);
      const removedCount = it.chatHistory.length - kept.length;
      if (removedCount > 0) {
        if (!it.sessionMeta) it.sessionMeta = createSessionMeta();
        if (!it.sessionMeta.activeSummary) {
          it.sessionMeta.activeSummary = `（已归档事项「${it.title}」的早期 ${normalMsgs.length - 2} 条对话已清理释放空间，仅保留收尾记录）`;
        }
        it.sessionMeta.compactedUpToMsgId = null;
        it.chatHistory = kept;
        cleanedTasks++;
        removedMessages += removedCount;
      }
    });

    if (cleanedTasks > 0) {
      saveState();
      emit('items-changed', state.items);
    }
    return { cleanedTasks, removedMessages };
  }

  mergeTaskExtra(existingExtra, incomingExtra) {
    const base = normalizeTaskExtra(existingExtra);
    if (!incomingExtra || typeof incomingExtra !== 'object') return base;

    const inc = normalizeTaskExtra(incomingExtra);

    if (Array.isArray(incomingExtra.shoppingItems) && inc.shoppingItems.length > 0) {
      const boughtMap = new Map(base.shoppingItems.map(i => [i.name, i.bought]));
      base.shoppingItems = inc.shoppingItems.map(item => ({
        ...item,
        bought: item.bought || Boolean(boughtMap.get(item.name))
      }));
    }

    if (incomingExtra.travelPlan && typeof incomingExtra.travelPlan === 'object') {
      const itp = incomingExtra.travelPlan;
      if (itp.destination) base.travelPlan.destination = inc.travelPlan.destination;
      if (itp.days) base.travelPlan.days = inc.travelPlan.days;
      if (itp.transport) base.travelPlan.transport = inc.travelPlan.transport;
      if (itp.hotel) base.travelPlan.hotel = inc.travelPlan.hotel;
      if (Array.isArray(itp.itinerary) && inc.travelPlan.itinerary.length > 0) {
        const doneMap = new Map(base.travelPlan.itinerary.map(r => [`${r.day}|${r.place}|${r.activity}`, r.done]));
        base.travelPlan.itinerary = inc.travelPlan.itinerary.map(row => ({
          ...row,
          done: row.done || Boolean(doneMap.get(`${row.day}|${row.place}|${row.activity}`))
        }));
      }
    }

    if (incomingExtra.wishMeta && typeof incomingExtra.wishMeta === 'object') {
      if (incomingExtra.wishMeta.targetAmount != null) base.wishMeta.targetAmount = inc.wishMeta.targetAmount;
      if (incomingExtra.wishMeta.savedAmount != null) base.wishMeta.savedAmount = inc.wishMeta.savedAmount;
      if (incomingExtra.wishMeta.rewardNote) base.wishMeta.rewardNote = inc.wishMeta.rewardNote;
    }

    if (incomingExtra.planMeta && typeof incomingExtra.planMeta === 'object') {
      if (incomingExtra.planMeta.goalMetric) base.planMeta.goalMetric = inc.planMeta.goalMetric;
      if (incomingExtra.planMeta.reviewNotes) base.planMeta.reviewNotes = inc.planMeta.reviewNotes;
    }

    return base;
  }

  buildSeedChatHistory(sourceMsg, taskTitle) {
    if (!sourceMsg) return [];
    const globalHist = state.chatHistory || [];
    const idx = globalHist.findIndex(m => m.id === sourceMsg.id);
    const seed = [];

    if (idx > 0) {
      for (let i = idx - 1; i >= 0; i--) {
        if (globalHist[i].role === 'user' && globalHist[i].kind !== 'checkpoint') {
          seed.push(createChatMessage('user', globalHist[i].content));
          break;
        }
      }
    }

    const intro = sourceMsg.content
      ? sourceMsg.content
      : `已为你创建「${taskTitle}」并生成初始安排，接下来我们可以在这里继续针对此事项深度讨论与调整。`;
    seed.push(createChatMessage('assistant', intro, null, false));
    return seed;
  }

  applyAction(actionPayload, targetTask = null, sourceMsg = null) {
    if (!actionPayload) return { count: 0, createdTasks: [], updatedTask: null };

    if (actionPayload.intent === 'update_current_task') {
      const tid = actionPayload.taskId || (targetTask ? targetTask.id : null);
      const it = state.items.find(x => x.id === tid) || targetTask;
      if (!it) return { count: 0, createdTasks: [], updatedTask: null };

      if (actionPayload.title && String(actionPayload.title).trim()) {
        it.title = String(actionPayload.title).trim();
      }
      if (actionPayload.note !== undefined && String(actionPayload.note).trim()) {
        it.note = String(actionPayload.note).trim();
      }
      if (actionPayload.projectName || actionPayload.type) {
        const proj = getProjectByName(actionPayload.projectName || actionPayload.type);
        if (proj) {
          it.projectId = proj.id;
          it.type = proj.name;
          if (!actionPayload.template) it.template = proj.template;
        }
      }
      if (['general', 'plan', 'shopping', 'travel', 'wish'].includes(actionPayload.template)) {
        it.template = actionPayload.template;
      }
      if (['urgent', 'high', 'medium', 'low'].includes(actionPayload.priority)) {
        it.priority = actionPayload.priority;
      }
      if (['todo', 'in_progress', 'blocked'].includes(actionPayload.status)) {
        it.status = actionPayload.status;
      }
      if (typeof actionPayload.startDate === 'string' && (/^\d{4}-\d{2}-\d{2}$/.test(actionPayload.startDate) || actionPayload.startDate === '')) {
        it.startDate = actionPayload.startDate;
      }
      if (typeof actionPayload.due === 'string' && (/^\d{4}-\d{2}-\d{2}$/.test(actionPayload.due) || actionPayload.due === '')) {
        it.due = actionPayload.due;
      }
      if (typeof actionPayload.startTime === 'string' && (/^\d{2}:\d{2}$/.test(actionPayload.startTime) || actionPayload.startTime === '')) {
        it.startTime = actionPayload.startTime;
      }
      if (typeof actionPayload.endTime === 'string' && (/^\d{2}:\d{2}$/.test(actionPayload.endTime) || actionPayload.endTime === '')) {
        it.endTime = actionPayload.endTime;
      }
      if (actionPayload.durationMin !== undefined && !isNaN(actionPayload.durationMin)) {
        it.durationMin = Number(actionPayload.durationMin) > 0 ? Math.round(Number(actionPayload.durationMin)) : null;
      }
      if (['none', 'daily', 'weekdays', 'weekly', 'monthly'].includes(actionPayload.repeat)) {
        it.repeat = actionPayload.repeat;
      }
      if (Array.isArray(actionPayload.tags)) {
        const cleanTags = actionPayload.tags.map(t => String(t || '').trim()).filter(Boolean);
        cleanTags.forEach(t => ensureTag(t));
        it.tags = Array.from(new Set(cleanTags));
      }
      if (actionPayload.cost !== undefined && actionPayload.cost !== null && !isNaN(actionPayload.cost)) {
        it.cost = Number(actionPayload.cost);
      }
      if (typeof actionPayload.star === 'number' && actionPayload.star >= 0 && actionPayload.star <= 5) {
        it.star = Math.round(actionPayload.star);
      }

      if (Array.isArray(actionPayload.stages)) {
        it.stages = actionPayload.stages.map(s =>
          typeof s === 'string' ? { name: s.trim(), targetDate: '', desc: '' } : s
        ).filter(s => s.name);
      }

      if (Array.isArray(actionPayload.subtasks)) {
        const oldDoneMap = new Map((it.subtasks || []).map(s => [s.title.trim(), s.done]));
        it.subtasks = actionPayload.subtasks.map(s => {
          const sub = createSubtask(s);
          if (!sub.done && oldDoneMap.get(sub.title)) {
            sub.done = true;
          }
          return sub;
        }).filter(s => s.title);

        const stageNames = new Set((it.stages || []).map(st => st.name));
        it.subtasks.forEach(s => {
          if (s.stage && !stageNames.has(s.stage)) {
            stageNames.add(s.stage);
            it.stages.push({ name: s.stage, targetDate: '', desc: '' });
          }
        });
      }

      if (actionPayload.extra) {
        it.extra = this.mergeTaskExtra(it.extra, actionPayload.extra);
        if ((it.cost == null || it.cost === 0) && it.extra.shoppingItems.length > 0) {
          const sum = it.extra.shoppingItems.reduce((acc, si) => acc + (si.qty || 1) * (si.price || 0), 0);
          if (sum > 0) it.cost = Math.round(sum * 100) / 100;
        }
      }

      it.updated = Date.now();
      if (sourceMsg) sourceMsg.actionApplied = true;
      saveState();
      emit('items-changed', state.items);
      return { count: 1, createdTasks: [], updatedTask: it };
    }

    if (!Array.isArray(actionPayload.tasks) || actionPayload.tasks.length === 0) {
      return { count: 0, createdTasks: [], updatedTask: null };
    }

    const createdTasks = [];
    for (const t of actionPayload.tasks) {
      const proj = getProjectByName(t.projectName || t.type);
      const tags = Array.isArray(t.tags)
        ? t.tags.map(x => String(x || '').trim()).filter(Boolean)
        : [];
      tags.forEach(x => ensureTag(x));

      const extra = normalizeTaskExtra(t.extra);
      let cost = (t.cost !== null && t.cost !== undefined && !isNaN(t.cost)) ? Number(t.cost) : null;
      if ((cost == null || cost === 0) && extra.shoppingItems.length > 0) {
        const sum = extra.shoppingItems.reduce((acc, si) => acc + (si.qty || 1) * (si.price || 0), 0);
        if (sum > 0) cost = Math.round(sum * 100) / 100;
      }

      const seedHistory = this.buildSeedChatHistory(sourceMsg, t.title || '新待办事项');

      const taskObj = createTask({
        title: t.title || '新待办事项',
        note: t.note || '',
        projectId: proj ? proj.id : '',
        type: proj ? proj.name : (t.type || '收集箱'),
        template: ['general', 'plan', 'shopping', 'travel', 'wish'].includes(t.template)
          ? t.template
          : (proj ? proj.template : 'general'),
        tags,
        scene: t.scene || '',
        time: t.time || '',
        priority: ['urgent', 'high', 'medium', 'low'].includes(t.priority) ? t.priority : '',
        status: ['todo', 'in_progress', 'blocked'].includes(t.status) ? t.status : 'todo',
        startDate: t.startDate || '',
        due: t.due || '',
        startTime: t.startTime || '',
        endTime: t.endTime || '',
        durationMin: t.durationMin || null,
        repeat: t.repeat || 'none',
        cost,
        star: t.star || 0,
        stages: Array.isArray(t.stages) ? t.stages : [],
        subtasks: Array.isArray(t.subtasks) ? t.subtasks.map(s => createSubtask(s)) : [],
        extra,
        chatHistory: seedHistory,
        lastChatAt: seedHistory.length ? Date.now() : null
      });

      taskObj.order = -Date.now() - createdTasks.length;
      state.items.unshift(taskObj);
      createdTasks.push(taskObj);
    }

    if (sourceMsg) sourceMsg.actionApplied = true;
    saveState();
    emit('items-changed', state.items);
    return { count: createdTasks.length, createdTasks, updatedTask: null };
  }

  stopGeneration() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.isGenerating = false;
    this.activeSessionKey = null;
  }

  clearHistory(targetTask = null) {
    if (targetTask) {
      targetTask.chatHistory = [];
      targetTask.lastChatAt = null;
      targetTask.sessionMeta = createSessionMeta();
      saveState();
      emit('task-chat-updated', { taskId: targetTask.id, history: [] });
    } else {
      state.chatHistory = [];
      state.globalSessionMeta = createSessionMeta();
      saveState();
      emit('chat-updated', state.chatHistory);
    }
  }
}

export const agent = new AIAgent();
