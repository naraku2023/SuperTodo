/**
 * 可复用的 AI 会话视图组件 (ChatSessionView)
 * 支持：非破坏性上下文压缩检查点卡片渲染、/compact 指令、思考链折叠与缓存统计联动
 */

import { state, saveState, emit, getTaskTemplate, getProjectById } from '../state.js';
import { createChatMessage } from '../models.js';
import { agent } from '../ai/agent.js';
import { escapeHtml } from './list.js';

export class ChatSessionView {
  constructor({
    messagesEl,
    quickTagsEl = null,
    inputEl,
    sendBtnEl,
    scrollEl = null,
    onTaskApplied = null,
    onOpenTaskSession = null,
    onStatsChanged = null
  }) {
    this.messagesEl = messagesEl;
    this.quickTagsEl = quickTagsEl;
    this.inputEl = inputEl;
    this.sendBtnEl = sendBtnEl;
    this.scrollEl = scrollEl || messagesEl;
    this.onTaskApplied = onTaskApplied;
    this.onOpenTaskSession = onOpenTaskSession;
    this.onStatsChanged = onStatsChanged;
    this.currentTask = null;
    this._sending = false;

    this._bindEvents();
  }

  _bindEvents() {
    if (this.sendBtnEl) {
      this.sendBtnEl.addEventListener('click', () => {
        if (agent.isGenerating && this._sending) {
          agent.stopGeneration();
          this._setGeneratingUI(false);
          return;
        }
        this.handleSend();
      });
    }

    if (this.inputEl) {
      this.inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.handleSend();
        }
      });
    }

    if (this.quickTagsEl) {
      this.quickTagsEl.addEventListener('click', (e) => {
        const chip = e.target.closest('.quick-chip');
        if (!chip) return;
        const text = chip.getAttribute('data-prompt');
        if (text && this.inputEl) {
          this.inputEl.value = text;
          this.handleSend();
        }
      });
    }
  }

  setTask(task = null) {
    this.currentTask = task || null;
    this._updateInputPlaceholder();
    this.renderQuickTags();
    this.renderMessages();
    this.onStatsChanged?.(agent.getSessionStats(this.currentTask));
  }

  _updateInputPlaceholder() {
    if (!this.inputEl) return;
    if (this.currentTask) {
      this.inputEl.placeholder = `围绕「${this.currentTask.title}」提问、排期或输入 /compact 压缩...`;
    } else {
      this.inputEl.placeholder = '输入目标或安排，输入 /compact 可压缩上下文...';
    }
  }

  renderQuickTags() {
    if (!this.quickTagsEl) return;

    if (this.currentTask) {
      const tmpl = getTaskTemplate(this.currentTask);
      let chips = [];

      if (tmpl === 'shopping') {
        chips = [
          ['🛒 补全采购清单与预算', '帮我补全这项购物任务的采购明细清单（含数量、单价预估）并计算总预算'],
          ['⚖️ 选购避坑与性价比建议', '针对这个采购事项，给出选购避坑指南、核心参数对比和买前检查点'],
          ['📅 安排采购时间节点', '帮我把采购顺序和截止日期安排好，生成分步骤打卡清单']
        ];
      } else if (tmpl === 'travel') {
        chips = [
          ['🗺️ 生成按天行程安排', '帮我规划详细的按天行程安排表（含景点、时段、预计花费）并同步到事项'],
          ['🧳 行前准备与行李清单', '按【证件文件】【衣物日用】【电子设备】分阶段列出出发前必查清单'],
          ['💡 当地避坑与交通建议', '为这次出行补充交通衔接、住宿区域选择和避坑指南']
        ];
      } else if (tmpl === 'wish') {
        chips = [
          ['💰 制定储蓄达成计划', '帮我拆解实现这个心愿的阶段储蓄目标、时间节点和里程碑激励'],
          ['🎯 细化前置调研步骤', '帮我梳理实现这个心愿前需要调研、对比和准备的具体步骤'],
          ['✨ 补充实现指南', '为这个心愿写一份可行性分析与行动指南']
        ];
      } else {
        chips = [
          ['🎯 分阶段细化排期', '帮我把这个事项拆成 2~3 个阶段，给每个步骤标注建议完成日期与预计耗时'],
          ['💡 补充避坑与执行指南', '为这个事项撰写一份结构化、可落地的执行指南与常见卡点避坑建议'],
          ['⚡ 拆出今天可做的第一步', '如果今天只有 30 分钟，帮我拆出最关键的起步动作并更新步骤'],
          ['⏱ 优化节奏与优先级', '评估当前步骤耗时和截止日期，帮我优化排期节奏与优先级']
        ];
      }

      this.quickTagsEl.innerHTML = chips
        .map(([label, prompt]) => `<button type="button" class="quick-chip" data-prompt="${escapeHtml(prompt)}">${escapeHtml(label)}</button>`)
        .join('');
    } else {
      this.quickTagsEl.innerHTML = `
        <button type="button" class="quick-chip" data-prompt="帮我梳理今天和最近7天的待办优先级，建议今天先做哪几件事">☀️ 梳理今日优先安排</button>
        <button type="button" class="quick-chip" data-prompt="我打算用2周时间系统学习一个新技能，帮我建立长期计划并分阶段排期">🎯 拆解两周学习计划</button>
        <button type="button" class="quick-chip" data-prompt="周末想去做一次大采购，帮我建一份带预算和明细的购物清单">🛒 规划周末采购清单</button>
        <button type="button" class="quick-chip" data-prompt="帮我规划一次3天2晚的短途旅行，生成出行准备和按天行程">✈️ 规划3天短途旅行</button>
      `;
    }
  }

  renderMessages() {
    if (!this.messagesEl) return;
    this.messagesEl.innerHTML = '';

    const history = this.currentTask
      ? (this.currentTask.chatHistory || [])
      : (state.chatHistory || []);

    if (history.length === 0) {
      if (this.currentTask) {
        const proj = getProjectById(this.currentTask.projectId);
        const projBadge = proj ? `${proj.icon} ${proj.name}` : '收集箱';
        this.messagesEl.innerHTML = `
          <div class="chat-welcome">
            <div class="cw-icon">💬</div>
            <div class="cw-title">「${escapeHtml(this.currentTask.title)}」专属独立会话</div>
            <div class="cw-subbadge">${escapeHtml(projBadge)} · 一事项一独立记忆</div>
            <div class="cw-desc">
              此会话仅服务于当前事项，上下文独立持久化存储，支持长对话自动压缩：<br>
              • 让 AI 帮你把任务拆成<b>带日期和耗时的阶段步骤</b><br>
              • 补充<b>购物明细 / 旅游按天行程 / 执行避坑指南</b><br>
              • 方案支持<b>一键同步</b>到左侧「安排与清单」
            </div>
          </div>
        `;
      } else {
        this.messagesEl.innerHTML = `
          <div class="chat-welcome">
            <div class="cw-icon">✨</div>
            <div class="cw-title">全局 AI 规划总管</div>
            <div class="cw-desc">
              你可以直接说目标、灵感或日程安排：<br>
              • 自动归类到对应项目空间并安排起止日期/耗时<br>
              • 一键加入清单后，<b>自动为该事项创建并绑定专属会话</b><br>
              • 长对话支持非破坏性上下文压缩（保留完整聊天记录，节省 Token）
            </div>
          </div>
        `;
      }
      this.onStatsChanged?.(agent.getSessionStats(this.currentTask));
      return;
    }

    history.forEach(msg => this.appendMessageElement(msg));
    this.scrollToBottom();
    this.onStatsChanged?.(agent.getSessionStats(this.currentTask));
  }

  appendMessageElement(msg) {
    if (!this.messagesEl || !msg) return null;
    const welcome = this.messagesEl.querySelector('.chat-welcome');
    if (welcome) welcome.remove();

    // 上下文压缩检查点折叠卡片
    if (msg.kind === 'checkpoint') {
      const cp = msg.checkpoint || {};
      const card = document.createElement('div');
      card.className = 'chat-checkpoint-card';
      card.dataset.msgId = msg.id;
      const savedPct = cp.tokenBefore > 0
        ? Math.max(0, Math.round((1 - (cp.tokenAfter || 0) / cp.tokenBefore) * 100))
        : 0;
      card.innerHTML = `
        <details class="cp-details">
          <summary class="cp-summary">
            <span>📦 上下文已压缩 · 合并前 ${cp.compactedCount || 0} 条消息</span>
            <span class="cp-saving">${cp.tokenBefore || 0} → ${cp.tokenAfter || 0} tok${savedPct ? ` (-${savedPct}%)` : ''}</span>
          </summary>
          <div class="cp-body">${this.formatContent(msg.content)}</div>
        </details>
      `;
      this.messagesEl.appendChild(card);
      return card;
    }

    const isBot = msg.role === 'assistant';
    const row = document.createElement('div');
    row.className = `chat-row ${isBot ? 'bot' : 'user'}`;
    row.dataset.msgId = msg.id;

    let actionCardHtml = '';
    if (isBot && msg.actionPayload) {
      actionCardHtml = this.renderActionCard(msg);
    }

    let usageHint = '';
    if (isBot && msg.usage && msg.usage.prompt_tokens) {
      const hit = msg.usage.prompt_cache_hit_tokens || 0;
      const rate = Math.round((hit / msg.usage.prompt_tokens) * 100);
      usageHint = `<div class="msg-usage-hint">输入 ${msg.usage.prompt_tokens} · 缓存命中 ${rate}% · 输出 ${msg.usage.completion_tokens || 0}</div>`;
    }

    row.innerHTML = `
      ${isBot ? '<div class="chat-row-avatar"></div>' : ''}
      <div class="chat-row-bubble">
        <div class="chat-text">${this.formatContent(msg.content)}</div>
        ${actionCardHtml}
        ${usageHint}
      </div>
    `;

    this.messagesEl.appendChild(row);

    if (actionCardHtml) {
      this._bindActionCardEvents(row, msg);
    }
    return row;
  }

  _bindActionCardEvents(row, msg) {
    const applyBtn = row.querySelector(`.action-apply-btn[data-msg-id="${msg.id}"]`);
    if (applyBtn) {
      applyBtn.onclick = () => {
        const res = agent.applyAction(msg.actionPayload, this.currentTask, msg);
        applyBtn.disabled = true;
        applyBtn.classList.add('applied');

        if (msg.actionPayload.intent === 'update_current_task') {
          applyBtn.textContent = '✓ 已同步更新到当前事项';
          this.onTaskApplied?.(res);
        } else {
          applyBtn.textContent = `✓ 已创建 ${res.count} 项并绑定独立会话`;
          if (res.createdTasks && res.createdTasks.length > 0 && !row.querySelector('.action-jump-wrap')) {
            const jumpWrap = document.createElement('div');
            jumpWrap.className = 'action-jump-wrap';
            jumpWrap.innerHTML = res.createdTasks.map(t => `
              <button type="button" class="action-jump-btn" data-jump-task="${t.id}">
                💬 进入「${escapeHtml(t.title)}」专属会话 →
              </button>
            `).join('');
            applyBtn.parentElement.appendChild(jumpWrap);
            jumpWrap.querySelectorAll('.action-jump-btn').forEach(jb => {
              jb.onclick = () => {
                const target = state.items.find(x => x.id === jb.dataset.jumpTask);
                if (target) this.onOpenTaskSession?.(target);
              };
            });
          }
          this.onTaskApplied?.(res);
        }
      };
    }

    row.querySelectorAll('.action-jump-btn[data-jump-title]').forEach(jb => {
      jb.onclick = () => {
        const title = jb.getAttribute('data-jump-title');
        const target = state.items.find(x => x.title === title);
        if (target) this.onOpenTaskSession?.(target);
      };
    });
  }

  renderActionCard(msg) {
    const payload = msg.actionPayload;
    const applied = Boolean(msg.actionApplied);

    if (payload.intent === 'update_current_task') {
      const metaTags = [];
      if (payload.priority) metaTags.push(`优先级:${payload.priority}`);
      if (payload.due) metaTags.push(`截止:${payload.due}`);
      if (payload.durationMin) metaTags.push(`耗时:${payload.durationMin}m`);

      let subHtml = '';
      if (Array.isArray(payload.subtasks) && payload.subtasks.length) {
        subHtml = `<div class="action-subtasks"><b>步骤方案 (${payload.subtasks.length} 步)：</b><br>${
          payload.subtasks.slice(0, 6).map(s => {
            const st = typeof s === 'string' ? s : `${s.stage ? `【${s.stage}】` : ''}${s.title}${s.due ? ` (${s.due})` : ''}`;
            return `• ${escapeHtml(st)}`;
          }).join('<br>')
        }${payload.subtasks.length > 6 ? '<br>…' : ''}</div>`;
      }

      let noteHtml = '';
      if (payload.note) {
        const preview = payload.note.length > 100 ? payload.note.slice(0, 100) + '...' : payload.note;
        noteHtml = `<div class="action-note-preview"><b>执行指南：</b><br>${escapeHtml(preview)}</div>`;
      }

      return `
        <div class="action-card action-update-card">
          <div class="action-card-head">⚡ 事项专属更新方案：</div>
          ${metaTags.length ? `<div class="action-item-meta">${metaTags.map(m => `<span class="action-tag">${escapeHtml(m)}</span>`).join('')}</div>` : ''}
          ${subHtml}
          ${noteHtml}
          <button type="button" class="action-apply-btn action-update-btn ${applied ? 'applied' : ''}" data-msg-id="${msg.id}" ${applied ? 'disabled' : ''}>
            ${applied ? '✓ 已同步更新到当前事项' : '✓ 一键同步到当前事项'}
          </button>
        </div>
      `;
    }

    const tasks = payload.tasks || [];
    if (!tasks.length) return '';

    const itemsHtml = tasks.map(t => {
      let subHtml = '';
      if (t.subtasks && t.subtasks.length) {
        subHtml = `<div class="action-subtasks">${t.subtasks.slice(0, 5).map(s => {
          const txt = typeof s === 'string' ? s : `${s.stage ? `【${s.stage}】` : ''}${s.title}`;
          return `• ${escapeHtml(txt)}`;
        }).join('<br>')}${t.subtasks.length > 5 ? `<br>…共 ${t.subtasks.length} 步` : ''}</div>`;
      }
      const pName = t.projectName || t.type;
      const sched = [t.startDate, t.due].filter(Boolean).join(' ~ ');
      return `
        <div class="action-item-card">
          <div class="action-item-title">${escapeHtml(t.title)}</div>
          <div class="action-item-meta">
            ${pName ? `<span class="action-tag">${escapeHtml(pName)}</span>` : ''}
            ${t.priority ? `<span class="action-tag">${escapeHtml(t.priority)}</span>` : ''}
            ${sched ? `<span class="action-tag">📅 ${escapeHtml(sched)}</span>` : ''}
            ${t.durationMin ? `<span class="action-tag">⏱ ${t.durationMin}m</span>` : ''}
            ${t.cost ? `<span class="action-tag">¥${t.cost}</span>` : ''}
          </div>
          ${subHtml}
        </div>
      `;
    }).join('');

    let jumpHtml = '';
    if (applied) {
      const matched = tasks
        .map(t => state.items.find(x => x.title === t.title))
        .filter(Boolean);
      if (matched.length > 0) {
        jumpHtml = `<div class="action-jump-wrap">${matched.map(m =>
          `<button type="button" class="action-jump-btn" data-jump-title="${escapeHtml(m.title)}">💬 进入「${escapeHtml(m.title)}」专属会话 →</button>`
        ).join('')}</div>`;
      }
    }

    return `
      <div class="action-card">
        <div class="action-card-head">🎯 建议规划与事项（采纳后自动绑定独立会话）：</div>
        <div class="action-card-list">${itemsHtml}</div>
        <button type="button" class="action-apply-btn ${applied ? 'applied' : ''}" data-msg-id="${msg.id}" ${applied ? 'disabled' : ''}>
          ${applied ? `✓ 已加入待办并绑定独立会话` : '+ 一键加入待办并创建独立会话'}
        </button>
        ${jumpHtml}
      </div>
    `;
  }

  formatContent(text) {
    if (!text) return '';
    return escapeHtml(text)
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }

  _setGeneratingUI(isGen) {
    this._sending = isGen;
    if (!this.sendBtnEl) return;
    this.sendBtnEl.classList.toggle('is-stop', isGen);
    this.sendBtnEl.title = isGen ? '停止生成' : '发送';
    this.sendBtnEl.innerHTML = isGen
      ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
      : '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
  }

  async runManualCompaction() {
    if (agent.isGenerating) return;
    const statusRow = document.createElement('div');
    statusRow.className = 'chat-status-banner';
    statusRow.textContent = '🗜️ 正在分析并压缩早期对话上下文...';
    this.messagesEl.appendChild(statusRow);
    this.scrollToBottom();
    try {
      const res = await agent.compactSession(this.currentTask, {
        force: true,
        onProgress: txt => { statusRow.textContent = `🗜️ ${txt}`; }
      });
      statusRow.remove();
      if (res.compacted && res.message) {
        this.appendMessageElement(res.message);
      } else {
        const tip = document.createElement('div');
        tip.className = 'chat-status-banner';
        tip.textContent = `ℹ️ ${res.reason || '当前无需压缩'}`;
        this.messagesEl.appendChild(tip);
      }
      this.scrollToBottom();
      this.onStatsChanged?.(agent.getSessionStats(this.currentTask));
      return res;
    } catch (err) {
      statusRow.textContent = `✗ 压缩失败：${err.message}`;
      return { compacted: false, error: err };
    }
  }

  async handleSend() {
    if (!this.inputEl) return;
    const text = this.inputEl.value.trim();
    if (!text || agent.isGenerating) return;

    this.inputEl.value = '';

    if (!agent.isConfigured()) {
      const userMsg = createChatMessage('user', text);
      const historyList = this.currentTask
        ? (Array.isArray(this.currentTask.chatHistory) ? this.currentTask.chatHistory : (this.currentTask.chatHistory = []))
        : state.chatHistory;
      historyList.push(userMsg);
      if (this.currentTask) this.currentTask.lastChatAt = userMsg.timestamp;
      saveState();
      this.appendMessageElement(userMsg);
      emit(this.currentTask ? 'task-chat-updated' : 'chat-updated', this.currentTask ? { taskId: this.currentTask.id, history: historyList } : state.chatHistory);

      const errMsg = createChatMessage('assistant', '⚠️ 未配置或未开启 AI 服务，请先前往「设置 → AI · 云端增强」配置 DeepSeek API Key 与模型。');
      historyList.push(errMsg);
      saveState();
      this.appendMessageElement(errMsg);
      this.scrollToBottom();
      this.onStatsChanged?.(agent.getSessionStats(this.currentTask));
      return;
    }

    if (text.toLowerCase() === '/compact') {
      await this.runManualCompaction();
      return;
    }

    this._setGeneratingUI(true);

    let botRow = null;
    let reasoningEl = null;
    let textEl = null;
    let statusBanner = null;

    const ensureBotRow = () => {
      if (botRow) return;
      botRow = document.createElement('div');
      botRow.className = 'chat-row bot';
      botRow.innerHTML = `
        <div class="chat-row-avatar"></div>
        <div class="chat-row-bubble">
          <details class="chat-reasoning-box" hidden>
            <summary class="chat-reasoning-summary">🧠 深度思考中...</summary>
            <div class="chat-reasoning-content"></div>
          </details>
          <div class="chat-text streaming-text"><span class="typing-dot"></span> 正在思考并规划...</div>
        </div>
      `;
      this.messagesEl.appendChild(botRow);
      reasoningEl = botRow.querySelector('.chat-reasoning-box');
      textEl = botRow.querySelector('.chat-text');
      this.scrollToBottom();
    };

    try {
      await agent.sendMessage(
        text,
        {
          onStatus: (msg) => {
            if (!statusBanner) {
              statusBanner = document.createElement('div');
              statusBanner.className = 'chat-status-banner';
              this.messagesEl.appendChild(statusBanner);
            }
            statusBanner.textContent = `🗜️ ${msg}`;
            this.scrollToBottom();
          },
          onCompacted: (res) => {
            if (statusBanner) {
              statusBanner.remove();
              statusBanner = null;
            }
            if (res?.message) this.appendMessageElement(res.message);
            this.onStatsChanged?.(agent.getSessionStats(this.currentTask));
          },
          onUserMessage: (userMsg) => {
            if (statusBanner) {
              statusBanner.remove();
              statusBanner = null;
            }
            this.appendMessageElement(userMsg);
            ensureBotRow();
            this.onStatsChanged?.(agent.getSessionStats(this.currentTask));
          },
          onReasoning: (_rDelta, rAcc) => {
            ensureBotRow();
            if (reasoningEl) {
              reasoningEl.hidden = false;
              const rContent = reasoningEl.querySelector('.chat-reasoning-content');
              const rSummary = reasoningEl.querySelector('.chat-reasoning-summary');
              if (rSummary) rSummary.textContent = `🧠 深度思考中 (${rAcc.length} 字)...`;
              if (rContent) rContent.textContent = rAcc;
            }
            this.scrollToBottom();
          },
          onDelta: (preview) => {
            ensureBotRow();
            if (reasoningEl && !reasoningEl.hidden) {
              const rSummary = reasoningEl.querySelector('.chat-reasoning-summary');
              if (rSummary) rSummary.textContent = '🧠 深度思考已完成（点击展开）';
            }
            textEl.innerHTML = this.formatContent(preview) + '<span class="chat-cursor">▍</span>';
            this.scrollToBottom();
          },
          onComplete: (botMsg) => {
            this._setGeneratingUI(false);
            if (botRow) botRow.remove();
            this.appendMessageElement(botMsg);
            this.scrollToBottom();
            this.onStatsChanged?.(agent.getSessionStats(this.currentTask));
          },
          onError: (err) => {
            this._setGeneratingUI(false);
            ensureBotRow();
            textEl.innerHTML = `<span style="color:var(--danger)">生成出错: ${escapeHtml(err.message)}</span>`;
            this.scrollToBottom();
          }
        },
        this.currentTask
      );
    } catch (err) {
      this._setGeneratingUI(false);
      const errRow = document.createElement('div');
      errRow.className = 'chat-row bot';
      errRow.innerHTML = `
        <div class="chat-row-avatar"></div>
        <div class="chat-row-bubble">
          <div class="chat-text" style="color:var(--danger)">${escapeHtml(err.message)}</div>
        </div>
      `;
      this.messagesEl.appendChild(errRow);
      this.scrollToBottom();
    }
  }

  scrollToBottom() {
    if (this.scrollEl) {
      this.scrollEl.scrollTop = this.scrollEl.scrollHeight;
    }
  }
}
