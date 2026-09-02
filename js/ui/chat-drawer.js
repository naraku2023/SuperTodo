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
    this.currentTask = null; // 当前聚焦的事项对象（若为 null 则为全局规划助手）
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
              <div class="chat-title" id="chatDrawerTitle">AI 智能规划助理</div>
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
        <div class="chat-quick-tags" id="chatQuickTags"></div>

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
      const msg = this.currentTask
        ? `确定清空针对“${this.currentTask.title}”的专属对话记录吗？`
        : '确定清空与 AI 的全局对话记录吗？';
      if (confirm(msg)) {
        agent.clearHistory(this.currentTask);
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

    // 事件委托点击快捷指令
    document.querySelector('#chatQuickTags')?.addEventListener('click', (e) => {
      const chip = e.target.closest('.quick-chip');
      if (!chip) return;
      const text = chip.getAttribute('data-prompt');
      if (text) {
        this.input.value = text;
        this.handleSend();
      }
    });

    // 监听外部打开对话抽屉事件
    window.openAiChatDrawer = (task = null) => this.open(task);
  }

  open(task = null) {
    this.currentTask = task;
    this.isOpen = true;
    this.mask.hidden = false;
    this.drawer.hidden = false;
    requestAnimationFrame(() => {
      this.drawer.classList.add('open');
      this.mask.classList.add('open');
    });

    // 更新标题与标签
    const titleEl = document.querySelector('#chatDrawerTitle');
    const badge = document.querySelector('#chatModelBadge');
    if (this.currentTask) {
      if (titleEl) titleEl.textContent = `AI 助手 · ${this.currentTask.title}`;
      if (badge) badge.textContent = `【${this.currentTask.type || '专属'}】协助`;
      this.input.placeholder = `和 AI 研讨“${this.currentTask.title}”，如：帮我细化步骤...`;
    } else {
      if (titleEl) titleEl.textContent = 'AI 智能规划助理';
      if (badge) badge.textContent = state.ai.model || '全局规划';
      this.input.placeholder = '和 AI 规划师对话，如：帮我安排下周日程...';
    }

    this.renderQuickTags();
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
      this.currentTask = null;
    }, 280);
  }

  renderQuickTags() {
    const tagsWrap = document.querySelector('#chatQuickTags');
    if (!tagsWrap) return;

    if (this.currentTask) {
      tagsWrap.innerHTML = `
        <button class="quick-chip" data-prompt="帮我把这个事项分阶段进一步细化，列出具体落地的执行清单">🎯 细化阶段步骤</button>
        <button class="quick-chip" data-prompt="针对这个事项，为我总结一份落地避坑指南与核心实操策略">💡 补充避坑指南</button>
        <button class="quick-chip" data-prompt="根据执行难点，帮我优化一下这个事项的执行节奏与截止时间">⏱ 优化时间节奏</button>
        <button class="quick-chip" data-prompt="帮我推荐接下来最关键的第一步具体行动动作">⚡ 推荐首步动作</button>
      `;
    } else {
      tagsWrap.innerHTML = `
        <button class="quick-chip" data-prompt="我打算在下个月考过驾照科目一，帮我拆解一个2周的学习计划">🎯 拆解两周考驾照计划</button>
        <button class="quick-chip" data-prompt="帮我看看今天有哪些待办事项？给出执行优先级建议">📋 梳理今日待办优先级</button>
        <button class="quick-chip" data-prompt="总结我目前的待办事项与花费预算">📊 总结事项与花费统计</button>
        <button class="quick-chip" data-prompt="针对我拖延的任务，给我3个实用的SMART执行建议">💡 给我3个执行小技巧</button>
      `;
    }
  }

  renderMessages() {
    this.messagesWrap.innerHTML = '';

    const history = this.currentTask 
      ? (this.currentTask.chatHistory || [])
      : (state.chatHistory || []);

    if (history.length === 0) {
      if (this.currentTask) {
        this.messagesWrap.innerHTML = `
          <div class="chat-welcome">
            <div class="cw-icon">🤖</div>
            <div class="cw-title">“${escapeHtml(this.currentTask.title)}” 专属协作</div>
            <div class="cw-desc">
              我是当前事项的私人顾问！你可以直接对我说：<br>
              • “帮我把这个事项细化为2~3个阶段的具体打卡清单”<br>
              • “为这个任务写一份详实的实战避坑指南”<br>
              • “根据现有步骤，补充需要采购或准备的物品”<br>
              AI 提出的优化方案支持<b>一键直接同步更新到该事项</b>！
            </div>
          </div>
        `;
      } else {
        this.messagesWrap.innerHTML = `
          <div class="chat-welcome">
            <div class="cw-icon">✨</div>
            <div class="cw-title">你好！我是你的全局 AI 规划助理</div>
            <div class="cw-desc">
              告诉我你的目标或口语记事，我可以帮你：<br>
              • 自动抽取时间、分类并录入待办<br>
              • 一键将复杂目标拆解为执行清单 (Checklist)<br>
              • 梳理优先级并生成日程复盘总结
            </div>
          </div>
        `;
      }
      return;
    }

    history.forEach(msg => {
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
    if (msg.actionPayload) {
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
          const count = agent.applyAction(msg.actionPayload, this.currentTask);
          btn.disabled = true;
          if (msg.actionPayload.intent === 'update_current_task') {
            btn.textContent = '✓ 已成功同步至当前事项！';
            if (window.renderCurrentDetail) {
              window.renderCurrentDetail();
            }
          } else {
            btn.textContent = `✓ 已成功添加 ${count} 项待办`;
          }
          btn.classList.add('applied');
        };
      }
    }
  }

  renderActionCard(payload, msgId) {
    // 1. 事项专属更新动作卡片 (update_current_task)
    if (payload.intent === 'update_current_task') {
      let subHtml = '';
      if (payload.subtasks && payload.subtasks.length) {
        subHtml = `<div class="action-subtasks"><b>细化步骤清单：</b><br>${payload.subtasks.map(s => `• ${escapeHtml(typeof s === 'string' ? s : s.title)}`).join('<br>')}</div>`;
      }
      let noteHtml = '';
      if (payload.note) {
        const preview = payload.note.length > 120 ? payload.note.slice(0, 120) + '...' : payload.note;
        noteHtml = `<div class="action-note-preview"><b>落地策略指南：</b><br>${escapeHtml(preview)}</div>`;
      }

      return `
        <div class="action-card action-update-card">
          <div class="action-card-head">⚡ 事项专属优化方案（点击一键同步）：</div>
          ${payload.title && this.currentTask && payload.title !== this.currentTask.title ? `<div class="action-item-title">📌 优化标题：${escapeHtml(payload.title)}</div>` : ''}
          ${subHtml}
          ${noteHtml}
          <button class="action-apply-btn action-update-btn" data-msg-id="${msgId}">✓ 一键更新到当前事项</button>
        </div>
      `;
    }

    // 2. 批量新建任务卡片
    const tasks = payload.tasks || [];
    if (!tasks.length) return '';

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
      }, this.currentTask);
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
