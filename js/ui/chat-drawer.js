/**
 * AI 多轮对话侧边/半屏抽屉组件 (Chat Drawer)
 * 适配移动端交互、流式打字与一键交互卡片
 */

import { state } from '../state.js';
import { agent } from '../ai/agent.js';

export class ChatDrawer {
  constructor() {
    this.container = null;
    this.mask = null;
    this.drawer = null;
    this.messagesWrap = null;
    this.input = null;
    this.sendBtn = null;
    this.isOpen = false;
  }

  init() {
    this.renderDom();
    this.bindEvents();
  }

  renderDom() {
    // 注入抽屉遮罩与面板容器
    const html = `
      <div class="chat-mask" id="chatMask" hidden></div>
      <div class="chat-drawer" id="chatDrawer" hidden>
        <div class="chat-header">
          <div class="chat-header-info">
            <div class="chat-avatar"></div>
            <div>
              <div class="chat-title">AI 智能规划助理</div>
              <div class="chat-model-badge" id="chatModelBadge">DeepSeek</div>
            </div>
          </div>
          <div class="chat-actions">
            <button class="chat-btn-icon" id="chatClearBtn" title="清空对话" aria-label="清空对话">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M16 9v10H8V9h8m-1.5-6h-5l-1 1H5v2h14V4h-3.5l-1-1zM18 7H6v12c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7z"/></svg>
            </button>
            <button class="chat-btn-icon" id="chatCloseBtn" title="关闭" aria-label="关闭">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
          </div>
        </div>

        <!-- 对话主体流 -->
        <div class="chat-body" id="chatBody">
          <div class="chat-messages" id="chatMessages"></div>
        </div>

        <!-- 快捷指令标签栏 -->
        <div class="chat-quick-tags" id="chatQuickTags">
          <button class="quick-chip" data-prompt="我打算在下个月考过驾照科目一，帮我拆解一个2周的学习计划">🎯 拆解两周考驾照计划</button>
          <button class="quick-chip" data-prompt="帮我看看今天有哪些待办事项？给出执行优先级建议">📋 梳理今日待办优先级</button>
          <button class="quick-chip" data-prompt="总结我目前的待办事项与花费预算">📊 总结事项与花费统计</button>
          <button class="quick-chip" data-prompt="针对我拖延的任务，给我3个实用的SMART执行建议">💡 给我3个执行小技巧</button>
        </div>

        <!-- 底部输入框 -->
        <div class="chat-footer">
          <div class="chat-input-wrap">
            <textarea id="chatInput" rows="1" placeholder="和 AI 规划师对话，如：帮我安排下周日程..." autocomplete="off"></textarea>
            <button class="chat-send-btn" id="chatSendBtn" aria-label="发送">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;

    const div = document.createElement('div');
    div.innerHTML = html;
    document.body.appendChild(div);

    this.mask = document.querySelector('#chatMask');
    this.drawer = document.querySelector('#chatDrawer');
    this.messagesWrap = document.querySelector('#chatMessages');
    this.input = document.querySelector('#chatInput');
    this.sendBtn = document.querySelector('#chatSendBtn');
  }

  bindEvents() {
    this.mask.onclick = () => this.close();
    document.querySelector('#chatCloseBtn').onclick = () => this.close();
    
    document.querySelector('#chatClearBtn').onclick = () => {
      if (confirm('确定清空与 AI 的对话记录吗？')) {
        agent.clearHistory();
        this.renderMessages();
      }
    };

    // 发送按钮
    this.sendBtn.onclick = () => this.handleSend();

    // 回车发送 (移动端换行Shift+Enter)
    this.input.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    };

    // 快捷指令
    document.querySelectorAll('.quick-chip').forEach(chip => {
      chip.onclick = () => {
        const text = chip.getAttribute('data-prompt');
        this.input.value = text;
        this.handleSend();
      };
    });

    // 监听外部打开对话抽屉事件
    window.openAiChatDrawer = () => this.open();
  }

  open() {
    this.isOpen = true;
    this.mask.hidden = false;
    this.drawer.hidden = false;
    requestAnimationFrame(() => {
      this.drawer.classList.add('open');
      this.mask.classList.add('open');
    });

    // 更新模型显示
    const badge = document.querySelector('#chatModelBadge');
    if (badge) {
      badge.textContent = state.ai.model || '未连接';
    }

    this.renderMessages();
    setTimeout(() => this.input.focus(), 250);
  }

  close() {
    this.isOpen = false;
    this.drawer.classList.remove('open');
    this.mask.classList.remove('open');
    setTimeout(() => {
      this.drawer.hidden = true;
      this.mask.hidden = true;
    }, 280);
  }

  renderMessages() {
    this.messagesWrap.innerHTML = '';

    if (state.chatHistory.length === 0) {
      this.messagesWrap.innerHTML = `
        <div class="chat-welcome">
          <div class="cw-icon">✨</div>
          <div class="cw-title">你好！我是你的 AI 规划助理</div>
          <div class="cw-desc">
            告诉我你的目标或口语记事，我可以帮你：<br>
            • 自动抽取时间、分类并录入待办<br>
            • 一键将复杂目标拆解为执行清单 (Checklist)<br>
            • 梳理优先级并生成复盘总结
          </div>
        </div>
      `;
      return;
    }

    state.chatHistory.forEach(msg => {
      this.appendMessageElement(msg);
    });

    this.scrollToBottom();
  }

  appendMessageElement(msg) {
    const isBot = msg.role === 'assistant';
    const row = document.createElement('div');
    row.className = `chat-row ${isBot ? 'bot' : 'user'}`;
    row.id = `msg_${msg.id}`;

    let actionCardHtml = '';
    if (msg.actionPayload && msg.actionPayload.tasks && msg.actionPayload.tasks.length > 0) {
      actionCardHtml = this.renderActionCard(msg.actionPayload, msg.id);
    }

    row.innerHTML = `
      ${isBot ? '<div class="chat-row-avatar"></div>' : ''}
      <div class="chat-row-bubble">
        <div class="chat-text">${this.formatContent(msg.content)}</div>
        ${actionCardHtml}
      </div>
    `;

    this.messagesWrap.appendChild(row);

    // 绑定动作卡片的一键应用按钮
    if (actionCardHtml) {
      const btn = row.querySelector(`.action-apply-btn[data-msg-id="${msg.id}"]`);
      if (btn) {
        btn.onclick = () => {
          const count = agent.applyAction(msg.actionPayload);
          btn.disabled = true;
          btn.textContent = `✓ 已成功添加 ${count} 项待办`;
          btn.classList.add('applied');
        };
      }
    }
  }

  renderActionCard(payload, msgId) {
    const tasks = payload.tasks || [];
    let itemsHtml = '';
    tasks.forEach(t => {
      let subHtml = '';
      if (t.subtasks && t.subtasks.length) {
        subHtml = `<div class="action-subtasks">${t.subtasks.map(s => `• ${escapeHtml(typeof s === 'string' ? s : s.title)}`).join('<br>')}</div>`;
      }

      itemsHtml += `
        <div class="action-item-card">
          <div class="action-item-title">${escapeHtml(t.title)}</div>
          <div class="action-item-meta">
            ${t.type ? `<span class="action-tag">${escapeHtml(t.type)}</span>` : ''}
            ${t.due ? `<span class="action-tag">${escapeHtml(t.due)}</span>` : ''}
            ${t.cost ? `<span class="action-tag">¥${t.cost}</span>` : ''}
          </div>
          ${subHtml}
        </div>
      `;
    });

    return `
      <div class="action-card">
        <div class="action-card-head">🎯 建议规划与待办（点击即可一键采纳）：</div>
        <div class="action-card-list">${itemsHtml}</div>
        <button class="action-apply-btn" data-msg-id="${msgId}">+ 一键加入待办清单</button>
      </div>
    `;
  }

  formatContent(text) {
    if (!text) return '';
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  async handleSend() {
    const text = this.input.value.trim();
    if (!text || agent.isGenerating) return;

    this.input.value = '';
    this.sendBtn.disabled = true;

    // 创建临时机器人的占位气泡
    const botRow = document.createElement('div');
    botRow.className = 'chat-row bot';
    botRow.innerHTML = `
      <div class="chat-row-avatar"></div>
      <div class="chat-row-bubble">
        <div class="chat-text streaming-text"><span class="typing-dot"></span> 思考规划中...</div>
      </div>
    `;
    this.messagesWrap.appendChild(botRow);
    this.scrollToBottom();

    const textEl = botRow.querySelector('.chat-text');

    try {
      await agent.sendMessage(text, {
        onDelta: (preview) => {
          textEl.innerHTML = this.formatContent(preview) + '<span class="chat-cursor">▍</span>';
          this.scrollToBottom();
        },
        onComplete: (botMsg) => {
          this.sendBtn.disabled = false;
          // 用正式渲染替换临时节点
          botRow.remove();
          this.appendMessageElement(botMsg);
          this.scrollToBottom();
        },
        onError: (err) => {
          this.sendBtn.disabled = false;
          textEl.innerHTML = `<span style="color:var(--danger)">生成出错: ${err.message}</span>`;
          this.scrollToBottom();
        }
      });
    } catch (err) {
      this.sendBtn.disabled = false;
      textEl.innerHTML = `<span style="color:var(--danger)">错误: ${err.message}</span>`;
    }
  }

  scrollToBottom() {
    const body = document.querySelector('#chatBody');
    if (body) {
      body.scrollTop = body.scrollHeight;
    }
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
