/**
 * AI 多会话抽屉中心 (Chat Drawer & Long-term Session Lifecycle Manager)
 * 支持：多事项独立会话切换、置顶、活跃/已归档筛选、上下文仪表盘、一键压缩与清理归档原文
 */

import { state, getProjectById } from '../state.js';
import { agent } from '../ai/agent.js';
import { ChatSessionView } from './chat-panel.js';
import { pushLayer, syncBack, isBackSuppressed, confirmDlg, showToast } from './modals.js';
import { escapeHtml } from './list.js';

export class ChatDrawer {
  constructor() {
    this.mask = null;
    this.drawer = null;
    this.sessionMenu = null;
    this.sessionView = null;
    this.isOpen = false;
    this.isSessionMenuOpen = false;
    this.sessionFilterScope = 'all'; // 'all' | 'active' | 'archived'
    this.currentTask = null;
    this._closeTimer = null;
  }

  init() {
    this.renderDom();
    this.sessionView = new ChatSessionView({
      messagesEl: document.querySelector('#chatMessages'),
      quickTagsEl: document.querySelector('#chatQuickTags'),
      inputEl: document.querySelector('#chatInput'),
      sendBtnEl: document.querySelector('#chatSendBtn'),
      scrollEl: document.querySelector('#chatBody'),
      onTaskApplied: () => {
        if (window.renderCurrentDetail) window.renderCurrentDetail();
      },
      onOpenTaskSession: (task) => {
        if (task) this.switchSession(task);
      },
      onStatsChanged: (stats) => {
        this.renderContextBar(stats);
      }
    });
    this.bindEvents();
  }

  renderDom() {
    const html = `
      <div class="chat-mask" id="chatMask" hidden></div>
      <div class="chat-drawer" id="chatDrawer" hidden>
        <div class="chat-header">
          <button type="button" class="chat-session-trigger" id="chatSessionTrigger" title="切换会话">
            <div class="chat-avatar"></div>
            <div class="chat-header-text">
              <div class="chat-title-row">
                <span class="chat-title" id="chatDrawerTitle">全局规划总管</span>
                <span class="chat-switch-caret">▾</span>
              </div>
              <div class="chat-model-badge" id="chatModelBadge">独立多会话中心</div>
            </div>
          </button>
          <div class="chat-actions">
            <button type="button" class="chat-btn-icon" id="chatPinBtn" title="置顶/取消置顶会话" aria-label="置顶会话">📌</button>
            <button type="button" class="chat-btn-icon" id="chatOpenTaskBtn" title="查看该事项安排" aria-label="查看该事项安排" hidden>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
            </button>
            <button type="button" class="chat-btn-icon" id="chatClearBtn" title="清空当前会话" aria-label="清空当前会话">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M16 9v10H8V9h8m-1.5-6h-5l-1 1H5v2h14V4h-3.5l-1-1zM18 7H6v12c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7z"/></svg>
            </button>
            <button type="button" class="chat-btn-icon" id="chatCloseBtn" title="关闭" aria-label="关闭">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
          </div>
        </div>

        <!-- 上下文状态与压缩管理条 -->
        <div class="chat-context-bar" id="chatContextBar">
          <div class="ctx-metrics" id="chatCtxMetrics">上下文 0 条 · ~0 tok</div>
          <div class="ctx-actions">
            <button type="button" class="ctx-action-btn" id="chatCompactBtn" title="将早期对话压缩为摘要检查点（保留完整记录）">🗜️ 压缩</button>
            <button type="button" class="ctx-action-btn" id="chatExportBtn" title="导出此会话 Markdown">📄 导出</button>
          </div>
        </div>

        <!-- 多会话切换与管理面板 -->
        <div class="chat-session-panel" id="chatSessionPanel" hidden>
          <div class="csp-search-wrap">
            <input type="search" id="chatSessionFilter" class="csp-search" placeholder="搜索事项或开启指定事项独立会话..." autocomplete="off">
            <div class="csp-filter-tabs" id="cspScopeTabs">
              <button type="button" class="csp-scope-btn on" data-scope="all">全部</button>
              <button type="button" class="csp-scope-btn" data-scope="active">进行中</button>
              <button type="button" class="csp-scope-btn" data-scope="archived">已归档</button>
            </div>
          </div>
          <div class="csp-list" id="chatSessionList"></div>
          <div class="csp-foot-bar">
            <button type="button" class="csp-prune-btn" id="cspPruneBtn">🧹 整理已归档会话（保留摘要，释放空间）</button>
          </div>
        </div>

        <div class="chat-body" id="chatBody">
          <div class="chat-messages" id="chatMessages"></div>
        </div>

        <div class="chat-quick-tags" id="chatQuickTags"></div>

        <div class="chat-footer">
          <div class="chat-input-wrap">
            <textarea id="chatInput" rows="1" placeholder="输入目标或安排，输入 /compact 可压缩上下文..." autocomplete="off"></textarea>
            <button type="button" class="chat-send-btn" id="chatSendBtn" aria-label="发送">
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
    this.sessionMenu = document.querySelector('#chatSessionPanel');
  }

  bindEvents() {
    this.mask.onclick = () => this.close();
    document.querySelector('#chatCloseBtn').onclick = () => this.close();

    document.querySelector('#chatSessionTrigger').onclick = () => {
      this.toggleSessionMenu();
    };

    document.querySelector('#chatSessionFilter').oninput = () => {
      this.renderSessionList();
    };

    document.querySelector('#cspScopeTabs')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.csp-scope-btn');
      if (!btn) return;
      this.sessionFilterScope = btn.dataset.scope || 'all';
      document.querySelectorAll('#cspScopeTabs .csp-scope-btn').forEach(b => {
        b.classList.toggle('on', b.dataset.scope === this.sessionFilterScope);
      });
      this.renderSessionList();
    });

    document.querySelector('#cspPruneBtn').onclick = () => {
      const res = agent.pruneArchivedSessions();
      if (res.cleanedTasks > 0) {
        showToast(`已整理 ${res.cleanedTasks} 个归档会话，精简 ${res.removedMessages} 条旧消息`);
        this.renderSessionList();
      } else {
        showToast('暂无需要清理的冗长归档会话');
      }
    };

    document.querySelector('#chatPinBtn').onclick = () => {
      const pinned = agent.toggleSessionPin(this.currentTask);
      this._updateHeader();
      showToast(pinned ? '已置顶该会话' : '已取消置顶');
      if (this.isSessionMenuOpen) this.renderSessionList();
    };

    document.querySelector('#chatCompactBtn').onclick = async () => {
      const res = await this.sessionView.runManualCompaction();
      if (res?.compacted) {
        showToast(`已压缩 ${res.checkpoint.compactedCount} 条历史上下文`);
        this._updateHeader();
      }
    };

    document.querySelector('#chatExportBtn').onclick = () => {
      const md = agent.exportSessionMarkdown(this.currentTask);
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = (this.currentTask ? this.currentTask.title : '全局规划总管').replace(/[\\/:*?"<>|]/g, '_');
      a.href = url;
      a.download = `supertodo-chat-${safeName}.md`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('已导出会话 Markdown');
    };

    document.querySelector('#chatOpenTaskBtn').onclick = () => {
      if (!this.currentTask) return;
      const target = this.currentTask;
      this.close();
      import('./detail.js').then(m => m.openDetail(target, 'plan'));
    };

    document.querySelector('#chatClearBtn').onclick = () => {
      const msg = this.currentTask
        ? `确定清空「${this.currentTask.title}」的专属独立会话记录及压缩摘要吗？`
        : '确定清空「全局规划总管」的历史对话及压缩摘要吗？';
      confirmDlg('清空会话记录', msg, () => {
        agent.clearHistory(this.currentTask);
        this.sessionView.renderMessages();
        this._updateHeader();
        if (this.isSessionMenuOpen) this.renderSessionList();
      }, '清空', 'delete');
    };

    window.openAiChatDrawer = (task = null) => this.open(task);
  }

  renderContextBar(stats = null) {
    const metricsEl = document.querySelector('#chatCtxMetrics');
    if (!metricsEl) return;
    const s = stats || agent.getSessionStats(this.currentTask);
    const cacheBadge = s.cacheHitRate !== null
      ? ` <span class="ctx-cache-badge">缓存 ${s.cacheHitRate}%</span>`
      : '';
    const cmpBadge = s.compactionCount > 0 ? ` · 已压缩 ${s.compactionCount} 次` : '';
    metricsEl.innerHTML = `活跃上下文 ${s.activeMessages} 条 (~${s.activeTokens} tok)${cmpBadge}${cacheBadge}`;
  }

  toggleSessionMenu(force = null) {
    this.isSessionMenuOpen = force !== null ? force : !this.isSessionMenuOpen;
    if (this.sessionMenu) {
      this.sessionMenu.hidden = !this.isSessionMenuOpen;
    }
    document.querySelector('#chatSessionTrigger')?.classList.toggle('menu-open', this.isSessionMenuOpen);
    if (this.isSessionMenuOpen) {
      const filterInput = document.querySelector('#chatSessionFilter');
      if (filterInput) filterInput.value = '';
      this.renderSessionList();
    }
  }

  renderSessionList() {
    const listEl = document.querySelector('#chatSessionList');
    if (!listEl) return;

    const q = (document.querySelector('#chatSessionFilter')?.value || '').trim().toLowerCase();
    const globalStats = agent.getSessionStats(null);

    let html = `
      <button type="button" class="csp-item ${!this.currentTask ? 'active' : ''}" data-session-id="global">
        <span class="csp-icon">${globalStats.pinned ? '📌' : '✨'}</span>
        <div class="csp-info">
          <div class="csp-name">全局规划总管</div>
          <div class="csp-preview">${globalStats.totalMessages} 条 · 活跃 ~${globalStats.activeTokens} tok${globalStats.compactionCount ? ` · 压缩${globalStats.compactionCount}次` : ''}</div>
        </div>
        ${!this.currentTask ? '<span class="csp-badge">当前</span>' : ''}
      </button>
    `;

    const activeSessions = state.items
      .filter(it => Array.isArray(it.chatHistory) && it.chatHistory.length > 0)
      .filter(it => {
        if (this.sessionFilterScope === 'active') return !it.done;
        if (this.sessionFilterScope === 'archived') return Boolean(it.done);
        return true;
      })
      .filter(it => !q || it.title.toLowerCase().includes(q))
      .sort((a, b) => {
        const pinDiff = (b.sessionMeta?.pinned ? 1 : 0) - (a.sessionMeta?.pinned ? 1 : 0);
        if (pinDiff !== 0) return pinDiff;
        return (b.lastChatAt || b.updated || 0) - (a.lastChatAt || a.updated || 0);
      });

    if (activeSessions.length > 0) {
      html += `<div class="csp-section-title">📌 事项独立会话 (${activeSessions.length})</div>`;
      html += activeSessions.map(it => {
        const proj = getProjectById(it.projectId);
        const icon = it.sessionMeta?.pinned ? '📌' : (proj ? proj.icon : '📥');
        const st = agent.getSessionStats(it);
        const lastMsg = [...it.chatHistory].reverse().find(m => m.kind !== 'checkpoint');
        const preview = lastMsg ? lastMsg.content.replace(/\n/g, ' ').slice(0, 32) : '';
        const isCurrent = this.currentTask && this.currentTask.id === it.id;
        return `
          <button type="button" class="csp-item ${isCurrent ? 'active' : ''}" data-session-id="${it.id}">
            <span class="csp-icon">${icon}</span>
            <div class="csp-info">
              <div class="csp-name">${escapeHtml(it.title)}${it.done ? ' <span class="csp-done-tag">已归档</span>' : ''}</div>
              <div class="csp-preview">${st.totalMessages}条 · ~${st.activeTokens}tok${st.compactionCount ? ` · 压缩${st.compactionCount}次` : ''}${preview ? ` · ${escapeHtml(preview)}` : ''}</div>
            </div>
            ${isCurrent ? '<span class="csp-badge">当前</span>' : ''}
          </button>
        `;
      }).join('');
    }

    if (this.sessionFilterScope !== 'archived') {
      const untouchedTasks = state.items
        .filter(it => !it.done && (!it.chatHistory || it.chatHistory.length === 0))
        .filter(it => !q || it.title.toLowerCase().includes(q))
        .slice(0, 10);

      if (untouchedTasks.length > 0) {
        html += `<div class="csp-section-title">＋ 为事项开启专属独立会话</div>`;
        html += untouchedTasks.map(it => {
          const proj = getProjectById(it.projectId);
          const icon = proj ? proj.icon : '📥';
          const isCurrent = this.currentTask && this.currentTask.id === it.id;
          return `
            <button type="button" class="csp-item ${isCurrent ? 'active' : ''}" data-session-id="${it.id}">
              <span class="csp-icon">${icon}</span>
              <div class="csp-info">
                <div class="csp-name">${escapeHtml(it.title)}</div>
                <div class="csp-preview">点击开启此事项的一对一独立会话</div>
              </div>
              ${isCurrent ? '<span class="csp-badge">当前</span>' : '<span class="csp-start">开启</span>'}
            </button>
          `;
        }).join('');
      }
    }

    listEl.innerHTML = html;

    listEl.querySelectorAll('.csp-item').forEach(btn => {
      btn.onclick = () => {
        const sid = btn.dataset.sessionId;
        if (sid === 'global') {
          this.switchSession(null);
        } else {
          const target = state.items.find(x => x.id === sid);
          if (target) this.switchSession(target);
        }
        this.toggleSessionMenu(false);
      };
    });
  }

  switchSession(task = null) {
    if (agent.isGenerating) {
      agent.stopGeneration();
    }
    this.currentTask = task || null;
    this._updateHeader();
    this.sessionView.setTask(this.currentTask);
  }

  _updateHeader() {
    const titleEl = document.querySelector('#chatDrawerTitle');
    const badge = document.querySelector('#chatModelBadge');
    const openTaskBtn = document.querySelector('#chatOpenTaskBtn');
    const pinBtn = document.querySelector('#chatPinBtn');
    const stats = agent.getSessionStats(this.currentTask);

    if (pinBtn) {
      pinBtn.classList.toggle('is-pinned', stats.pinned);
      pinBtn.title = stats.pinned ? '取消置顶会话' : '置顶会话';
    }

    if (this.currentTask) {
      const proj = getProjectById(this.currentTask.projectId);
      if (titleEl) titleEl.textContent = this.currentTask.title;
      if (badge) {
        badge.textContent = `${proj ? proj.icon + ' ' + proj.name : '📥 收集箱'} · 独立会话 (${stats.totalMessages}) · 点击切换`;
      }
      if (openTaskBtn) openTaskBtn.hidden = false;
    } else {
      const sessionTotal = state.items.filter(i => i.chatHistory && i.chatHistory.length > 0).length;
      if (titleEl) titleEl.textContent = '全局规划总管';
      if (badge) {
        badge.textContent = `${state.ai.model || 'deepseek-flash'} · ${sessionTotal} 个事项独立会话 · 点击切换`;
      }
      if (openTaskBtn) openTaskBtn.hidden = true;
    }

    this.renderContextBar(stats);
  }

  open(task = null) {
    clearTimeout(this._closeTimer);
    this.currentTask = task || null;
    this.isOpen = true;
    this.toggleSessionMenu(false);

    pushLayer();
    this.mask.hidden = false;
    this.drawer.hidden = false;
    requestAnimationFrame(() => {
      this.drawer.classList.add('open');
      this.mask.classList.add('open');
    });

    this._updateHeader();
    this.sessionView.setTask(this.currentTask);
    setTimeout(() => document.querySelector('#chatInput')?.focus(), 220);
  }

  close() {
    if (!this.isOpen) return;
    if (this.isSessionMenuOpen) {
      this.toggleSessionMenu(false);
    }
    this.isOpen = false;
    this.drawer.classList.remove('open');
    this.mask.classList.remove('open');
    clearTimeout(this._closeTimer);
    this._closeTimer = setTimeout(() => {
      if (!this.isOpen) {
        this.drawer.hidden = true;
        this.mask.hidden = true;
      }
    }, 280);
    if (!isBackSuppressed()) {
      syncBack();
    }
  }
}
