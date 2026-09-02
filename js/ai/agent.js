/**
 * 对话代理中枢与意图动作解析
 */

import { state, saveState, emit } from '../state.js';
import { createTask, createSubtask, createChatMessage } from '../models.js';
import { AIClient } from './client.js';
import { buildChatSystemPrompt } from './prompts.js';

class AIAgent {
  constructor() {
    this.client = null;
    this.abortController = null;
    this.isGenerating = false;
  }

  initClient() {
    this.client = new AIClient({
      base: state.ai.base,
      key: state.ai.key,
      model: state.ai.model
    });
  }

  isConfigured() {
    return Boolean(state.ai.enabled && state.ai.base && state.ai.key);
  }

  /**
   * 从 AI 的完整回复文本中分离出自然回复与结构化动作 JSON
   */
  parseResponse(rawText) {
    let text = rawText;
    let actionPayload = null;

    // 匹配 ```json ... ``` 或 ``` ... ``` 包含的 JSON 块
    const jsonBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/i;
    const match = rawText.match(jsonBlockRegex);

    if (match) {
      try {
        const jsonStr = match[1].trim();
        const parsed = JSON.parse(jsonStr);
        if (parsed && typeof parsed === 'object' && parsed.intent) {
          actionPayload = parsed;
          // 从气泡正文中移除 JSON 代码块，保留清爽优雅的口语回复
          text = rawText.replace(match[0], '').trim();
        }
      } catch (e) {
        // 如果 JSON 解析失败，尝试从文本中搜寻首个有效 JSON 对象
        try {
          const firstBrace = rawText.indexOf('{');
          const lastBrace = rawText.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace > firstBrace) {
            const possibleJson = rawText.slice(firstBrace, lastBrace + 1);
            const parsed = JSON.parse(possibleJson);
            if (parsed && parsed.intent) {
              actionPayload = parsed;
              text = rawText.slice(0, firstBrace).trim();
            }
          }
        } catch (err) {}
      }
    }

    return { displayText: text || '已为您分析并整理好以下事项：', actionPayload };
  }

  /**
   * 发起多轮对话流式生成
   */
  async sendMessage(userText, { onDelta, onComplete, onError }) {
    if (!this.isConfigured()) {
      throw new Error('未配置或未开启 AI 服务，请先前往「设置」配置 API Key');
    }

    this.initClient();

    // 取消上一次未结束的请求
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();
    this.isGenerating = true;

    // 记录用户消息
    const userMsg = createChatMessage('user', userText);
    state.chatHistory.push(userMsg);
    saveState();
    emit('chat-updated', state.chatHistory);

    // 构造请求消息序列 (System + 最近对话历史)
    const systemPrompt = buildChatSystemPrompt({
      types: state.types,
      scenes: state.scenes,
      times: state.times,
      currentTasks: state.items
    });

    const messages = [{ role: 'system', content: systemPrompt }];

    // 取最近 6 轮对话保持上下文记忆
    const recentHistory = state.chatHistory.slice(-12);
    for (const msg of recentHistory) {
      messages.push({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      });
    }

    let fullOutput = '';

    try {
      await this.client.chatStream({
        messages,
        signal: this.abortController.signal,
        onChunk: (delta, accumulated) => {
          fullOutput = accumulated;
          // 流式阶段过滤掉后面的 json 代码块
          const previewText = accumulated.replace(/```(?:json)?[\s\S]*$/, ' \n*(正在提炼任务规划...)*');
          onDelta?.(previewText);
        },
        onDone: (accumulated) => {
          this.isGenerating = false;
          const { displayText, actionPayload } = this.parseResponse(accumulated);

          // 保存助手回复
          const botMsg = createChatMessage('assistant', displayText, actionPayload);
          state.chatHistory.push(botMsg);
          saveState();
          emit('chat-updated', state.chatHistory);

          onComplete?.(botMsg);
        },
        onError: (err) => {
          this.isGenerating = false;
          onError?.(err);
        }
      });
    } catch (err) {
      this.isGenerating = false;
      if (err.name !== 'AbortError') {
        onError?.(err);
      }
    }
  }

  /**
   * 应用 AI 提议的操作动作（新建任务、拆解目标等）
   */
  applyAction(actionPayload) {
    if (!actionPayload || !actionPayload.tasks || !Array.isArray(actionPayload.tasks)) {
      return 0;
    }

    let addedCount = 0;
    for (const t of actionPayload.tasks) {
      const taskObj = createTask({
        title: t.title || '新待办事项',
        note: t.note || '',
        type: state.types.includes(t.type) ? t.type : (state.types[0] || '待办'),
        scene: state.scenes.includes(t.scene) ? t.scene : (state.scenes[0] || ''),
        time: state.times.includes(t.time) ? t.time : (state.times[0] || ''),
        cost: t.cost,
        due: t.due,
        star: t.star || 0,
        subtasks: Array.isArray(t.subtasks) ? t.subtasks.map(s => createSubtask(typeof s === 'string' ? s : s.title)) : []
      });

      // 放置到该分类顶部
      taskObj.order = -Date.now();
      state.items.unshift(taskObj);
      addedCount++;
    }

    saveState();
    emit('items-changed', state.items);
    return addedCount;
  }

  stopGeneration() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.isGenerating = false;
  }

  clearHistory() {
    state.chatHistory = [];
    saveState();
    emit('chat-updated', state.chatHistory);
  }
}

export const agent = new AIAgent();
