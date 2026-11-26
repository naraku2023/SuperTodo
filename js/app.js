/**
 * 应用程序主入口 (Main Application Entry)
 */

import {
  state,
  loadState,
  saveState,
  on,
  applyColorMode,
  toggleColorMode,
  getProjectById
} from './state.js';
import { SMART_VIEWS, GROUP_BY_OPTIONS } from './config.js';
import { createNextRepeatTask } from './models.js';
import { renderContent, computeViewCounts, escapeHtml } from './ui/list.js';
import {
  syncNativeState,
  consumeWidgetToggles,
  consumePendingAction
} from './native-bridge.js';
import {
  buildStars,
  openAdd,
  openSettings,
  openSort,
  openInfo,
  openProjectModal,
  pushLayer,
  syncBack,
  closeTopLayer,
  onReady,
  showToast,
  confirmDlg,
  inputDlg,
  alertDlg
} from './ui/modals.js';
import { openDetail } from './ui/detail.js';
import { ChatDrawer } from './ui/chat-drawer.js';

const $ = s => document.querySelector(s);

let chatDrawer = null;

function renderDrawerNav() {
  const nav = $('#drawerNav');
  if (!nav) return;

  const counts = computeViewCounts();

  // 1. 智能日程视图
  let html = `<div class="dnav-title">智能日程</div>`;
  SMART_VIEWS.filter(v => v.id !== 'archived').forEach(v => {
    const isOn = state.navMode === 'smart' && state.smartView === v.id;
    const cnt = counts[v.id] ?? 0;
    const overdueDot = (v.id === 'today' && counts.overdue > 0)
      ? `<span class="dnav-overdue-dot" title="有 ${counts.overdue} 项已逾期">${counts.overdue}逾期</span>`
      : '';
    html += `
      <button type="button" class="dnav-item ${isOn ? 'on' : ''}" data-nav="smart" data-view="${v.id}">
        <span class="dnav-emoji">${v.icon}</span>
        <span class="dnav-t">${v.name}</span>
        ${overdueDot}
        <span class="dnav-count">${cnt}</span>
      </button>
    `;
  });

  // 2. 项目清单空间
  html += `
    <div class="dnav-title-row">
      <span class="dnav-title">项目清单空间</span>
      <button type="button" class="dnav-title-add" id="dnavAddProj" title="新建项目空间">＋ 新建</button>
    </div>
  `;
  state.projects.forEach(p => {
    const isOn = state.navMode === 'project' && state.activeProjectId === p.id;
    const cnt = state.items.filter(i => !i.done && i.projectId === p.id).length;
    html += `
      <div class="dnav-proj-row ${isOn ? 'on' : ''}">
        <button type="button" class="dnav-item ${isOn ? 'on' : ''}" data-nav="project" data-proj-id="${p.id}">
          <span class="dnav-proj-dot" style="background:${escapeHtml(p.color)}"></span>
          <span class="dnav-emoji">${p.icon}</span>
          <span class="dnav-t">${escapeHtml(p.name)}</span>
          <span class="dnav-count">${cnt}</span>
        </button>
        <button type="button" class="dnav-proj-edit" data-edit-proj="${p.id}" title="编辑项目">✎</button>
      </div>
    `;
  });

  // 3. 多维标签筛选
  html += `
    <div class="dnav-title-row">
      <span class="dnav-title">标签</span>
      <button type="button" class="dnav-title-add" id="dnavAddTag" title="新增标签">＋ 新增</button>
    </div>
    <div class="dnav-tags-cloud">
      ${state.tags.map(t => {
        const isOn = state.navMode === 'tag' && state.activeTag === t;
        return `<button type="button" class="dnav-tag-chip ${isOn ? 'on' : ''}" data-nav="tag" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</button>`;
      }).join('')}
    </div>
  `;

  // 4. 独立会话中心入口 + 已归档
  html += `
    <div class="dnav-sep"></div>
    <button type="button" class="dnav-item" id="dnavOpenChatCenter">
      <span class="dnav-emoji">💬</span>
      <span class="dnav-t">事项独立会话中心</span>
      <span class="dnav-count">${counts.sessions}</span>
    </button>
    <button type="button" class="dnav-item ${state.navMode === 'smart' && state.smartView === 'archived' ? 'on' : ''}" data-nav="smart" data-view="archived">
      <span class="dnav-emoji">📦</span>
      <span class="dnav-t">已归档事项</span>
      <span class="dnav-count ${counts.archived > 0 ? 'highlight-archived' : ''}">${counts.archived}</span>
    </button>
  `;

  nav.innerHTML = html;
}

function renderHomeToolbar() {
  const toolbar = $('#homeToolbar');
  const smartRow = $('#smartPillsRow');
  const groupRow = $('#groupByPills');
  const statusWrap = $('#statusFilterSelectWrap');
  const statusSelect = $('#statusFilterSelect');
  if (!toolbar || !smartRow || !groupRow) return;

  const counts = computeViewCounts();
  const isArchived = state.navMode === 'smart' && state.smartView === 'archived';

  // 顶部智能视图快捷胶囊
  let pillsHtml = SMART_VIEWS.filter(v => v.id !== 'archived').map(v => {
    const isOn = state.navMode === 'smart' && state.smartView === v.id;
    const cnt = counts[v.id] ?? 0;
    return `
      <button type="button" class="smart-pill ${isOn ? 'on' : ''}" data-smart="${v.id}">
        <span>${v.icon}</span>
        <span>${v.name}</span>
        <span class="sp-cnt">${cnt}</span>
      </button>
    `;
  }).join('');

  if (state.navMode === 'project' && state.activeProjectId) {
    const p = getProjectById(state.activeProjectId);
    if (p) {
      pillsHtml = `<button type="button" class="smart-pill on active-scope" data-clear-scope="1">${p.icon} ${escapeHtml(p.name)} ✕</button>` + pillsHtml;
    }
  } else if (state.navMode === 'tag' && state.activeTag) {
    pillsHtml = `<button type="button" class="smart-pill on active-scope" data-clear-scope="1">#${escapeHtml(state.activeTag)} ✕</button>` + pillsHtml;
  }

  smartRow.innerHTML = pillsHtml;

  // 分组维度与状态筛选行（在今日/最近7天/已归档时隐藏分组选项，避免冗余）
  const hideGrouping = isArchived || (state.navMode === 'smart' && (state.smartView === 'today' || state.smartView === 'upcoming'));
  const filterRow = $('#viewFilterRow');
  if (filterRow) filterRow.hidden = isArchived;

  if (hideGrouping) {
    groupRow.innerHTML = `<span class="vf-hint">${state.smartView === 'today' ? '按逾期与今日安排自动聚合' : '按日期时间轴自动分组'}</span>`;
  } else {
    groupRow.innerHTML = GROUP_BY_OPTIONS.map(g => `
      <button type="button" class="vf-gb-chip ${(state.groupBy || 'schedule') === g.id ? 'on' : ''}" data-gb="${g.id}">
        ${g.label}
      </button>
    `).join('');
  }

  if (statusWrap && statusSelect) {
    statusWrap.hidden = isArchived;
    statusSelect.value = state.statusFilter || 'all';
  }
}

function updateAppTitle() {
  const t = $('#appTitle');
  const back = $('#backBtn');
  const ham = $('#hamburger');
  const sortBtn = $('#appbarSortBtn');

  let title = '全部待办';
  let isDefaultHome = false;

  if (state.navMode === 'smart') {
    const sv = SMART_VIEWS.find(v => v.id === state.smartView);
    title = sv ? `${sv.icon} ${sv.name}` : '全部待办';
    isDefaultHome = state.smartView === 'all';
  } else if (state.navMode === 'project') {
    const p = getProjectById(state.activeProjectId);
    title = p ? `${p.icon} ${p.name}` : '项目空间';
  } else if (state.navMode === 'tag') {
    title = `#${state.activeTag || '标签'}`;
  }

  if (t) t.textContent = title;
  if (back) back.hidden = isDefaultHome;
  if (ham) ham.hidden = !isDefaultHome;
  if (sortBtn) {
    sortBtn.hidden = state.navMode === 'smart' && state.smartView === 'archived';
    sortBtn.classList.toggle('on', state.sortKey !== '默认');
  }
}

let bannerDismissed = false;
let nativeSyncTimer = null;

function scheduleNativeSync() {
  clearTimeout(nativeSyncTimer);
  nativeSyncTimer = setTimeout(() => {
    syncNativeState(state);
  }, 150);
}

function renderAlertBanner() {
  const wrap = $('#alertBannerWrap');
  const banner = $('#alertBanner');
  if (!wrap || !banner) return;

  const isArchived = state.navMode === 'smart' && state.smartView === 'archived';
  if (bannerDismissed || isArchived || state.reminders?.inAppBanner === false) {
    wrap.hidden = true;
    return;
  }

  const counts = computeViewCounts();
  if (counts.overdue === 0 && counts.today === 0) {
    wrap.hidden = true;
    return;
  }

  const isOverdue = counts.overdue > 0;
  wrap.hidden = false;
  banner.className = `alert-banner ${isOverdue ? 'is-overdue' : 'is-today'}`;

  const icon = isOverdue ? '🚨' : '☀️';
  const title = isOverdue
    ? `你有 ${counts.overdue} 项已逾期${counts.today > counts.overdue ? `，今日共 ${counts.today} 项待处理` : ''}`
    : `今日共有 ${counts.today} 项聚焦安排`;
  const sub = isOverdue ? '建议立即点击处理逾期事项，避免继续积压' : '点击一键进入今日聚焦视图，逐项推进';

  banner.innerHTML = `
    <div class="ab-left" data-ab-action="go-today">
      <span class="ab-icon">${icon}</span>
      <div class="ab-text">
        <div class="ab-title">${escapeHtml(title)}</div>
        <div class="ab-sub">${escapeHtml(sub)}</div>
      </div>
    </div>
    <div class="ab-actions">
      <button type="button" class="ab-go-btn" data-ab-action="go-today">去处理</button>
      <button type="button" class="ab-close-btn" data-ab-action="dismiss" aria-label="暂收起">✕</button>
    </div>
  `;
}

export function render() {
  updateAppTitle();
  renderDrawerNav();
  renderHomeToolbar();
  renderAlertBanner();
  renderContent();
}

function backHome() {
  state.navMode = 'smart';
  state.smartView = 'all';
  state.activeProjectId = null;
  state.activeTag = null;
  state.statusFilter = 'all';
  state.search = '';
  saveState();
  render();
}

let lastBackTs = 0;
export function handleGlobalBack() {
  const now = Date.now();
  if (now - lastBackTs < 220) return true;
  lastBackTs = now;

  if (closeTopLayer()) return true;

  const searchbar = $('#searchbar');
  if ((searchbar && !searchbar.hidden) || state.search) {
    if (searchbar) searchbar.hidden = true;
    const topBar = $('.appbar-top');
    if (topBar) topBar.hidden = false;
    state.search = '';
    const sInput = $('#searchInput');
    if (sInput) sInput.value = '';
    saveState();
    render();
    return true;
  }

  const isDefaultHome = state.navMode === 'smart' && state.smartView === 'all';
  if (!isDefaultHome) {
    backHome();
    return true;
  }

  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
    window.Capacitor.Plugins.App.exitApp();
  }
  return false;
}

window.handleGlobalBack = handleGlobalBack;

function toggleDone(id) {
  const it = state.items.find(x => x.id === id);
  if (!it) return;

  if (!it.done) {
    const hasRepeat = it.repeat && it.repeat !== 'none';
    confirmDlg(
      '标记完成',
      hasRepeat
        ? `确定将“${it.title}”标记完成吗？完成后将自动生成下一周期的重复事项。`
        : `确定将“${it.title}”标记为已完成并移入归档吗？`,
      () => {
        it.done = true;
        it.status = 'done';
        it.completedAt = Date.now();
        if (hasRepeat) {
          const nextTask = createNextRepeatTask(it);
          nextTask.order = -Date.now();
          state.items.unshift(nextTask);
        }
        saveState();
        render();
        showToast(hasRepeat ? '已完成当前周期，已自动生成下一期安排' : '已完成并移至“已归档”');
      },
      '确认完成'
    );
  } else {
    confirmDlg(
      '恢复待办',
      `确定将“${it.title}”从已归档恢复为待办事项吗？`,
      () => {
        it.done = false;
        it.status = 'todo';
        it.completedAt = null;
        saveState();
        render();
        showToast('已恢复至待办清单');
      },
      '确认恢复'
    );
  }
}

function openDrawer() {
  pushLayer();
  renderDrawerNav();
  $('#drawerMask').hidden = false;
  $('#drawer').hidden = false;
}

function closeDrawer() {
  $('#drawerMask').hidden = true;
  $('#drawer').hidden = true;
  syncBack();
}

/**
 * 应用来自桌面小组件的勾选队列与通知/小组件深链动作
 */
function processNativeBridgeEvents() {
  const toggledIds = consumeWidgetToggles();
  if (toggledIds.length > 0) {
    let changed = false;
    toggledIds.forEach(tid => {
      const it = state.items.find(x => x.id === tid);
      if (it && !it.done) {
        it.done = true;
        it.status = 'done';
        it.completedAt = Date.now();
        if (it.repeat && it.repeat !== 'none') {
          const nextTask = createNextRepeatTask(it);
          nextTask.order = -Date.now();
          state.items.unshift(nextTask);
        }
        changed = true;
      }
    });
    if (changed) {
      saveState();
      render();
      showToast(`已在桌面完成 ${toggledIds.length} 项待办`);
    }
  }

  const action = consumePendingAction();
  if (action) {
    if (action === 'quick_add') {
      openAdd();
    } else if (action === 'open_today') {
      state.navMode = 'smart';
      state.smartView = 'today';
      state.activeProjectId = null;
      state.activeTag = null;
      saveState();
      render();
    } else if (action.startsWith('open_task:')) {
      const tid = action.slice('open_task:'.length);
      const target = state.items.find(x => x.id === tid);
      if (target) {
        openDetail(target, 'plan');
      }
    }
  }
}

window.__onSuperTodoNativeResume = () => {
  processNativeBridgeEvents();
  scheduleNativeSync();
};
window.__onSuperTodoNativeAction = () => {
  processNativeBridgeEvents();
};

async function init() {
  await loadState();
  applyColorMode();
  buildStars();

  chatDrawer = new ChatDrawer();
  chatDrawer.init();
  window.chatDrawerInstance = chatDrawer;

  on('items-changed', () => {
    render();
    scheduleNativeSync();
  });
  on('saved', () => {
    render();
    scheduleNativeSync();
  });
  on('task-chat-updated', () => render());

  processNativeBridgeEvents();
  render();
  syncNativeState(state);

  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
    window.Capacitor.Plugins.App.addListener('backButton', () => {
      handleGlobalBack();
    });
  }
}

onReady(() => {
  init();

  $('#hamburger')?.addEventListener('click', openDrawer);
  $('#drawerClose')?.addEventListener('click', closeDrawer);
  $('#drawerMask')?.addEventListener('click', closeDrawer);
  $('#backBtn')?.addEventListener('click', handleGlobalBack);

  // 左侧抽屉导航交互
  $('#drawerNav')?.addEventListener('click', (e) => {
    if (e.target.closest('#dnavAddProj')) {
      closeDrawer();
      openProjectModal(null, (proj) => {
        state.navMode = 'project';
        state.activeProjectId = proj.id;
        saveState();
        render();
      });
      return;
    }

    if (e.target.closest('#dnavAddTag')) {
      inputDlg('新增标签', '输入新标签名', '', (nm) => {
        if (!nm) return;
        if (state.tags.includes(nm)) {
          alertDlg('提示', '该标签已存在');
          return;
        }
        state.tags.push(nm);
        saveState();
        renderDrawerNav();
      });
      return;
    }

    const editProjBtn = e.target.closest('[data-edit-proj]');
    if (editProjBtn) {
      e.stopPropagation();
      const proj = getProjectById(editProjBtn.dataset.editProj);
      if (proj) {
        closeDrawer();
        openProjectModal(proj);
      }
      return;
    }

    if (e.target.closest('#dnavOpenChatCenter')) {
      closeDrawer();
      chatDrawer?.open(null);
      return;
    }

    const navBtn = e.target.closest('[data-nav]');
    if (!navBtn) return;

    const navType = navBtn.dataset.nav;
    if (navType === 'smart') {
      state.navMode = 'smart';
      state.smartView = navBtn.dataset.view || 'all';
      state.activeProjectId = null;
      state.activeTag = null;
    } else if (navType === 'project') {
      state.navMode = 'project';
      state.activeProjectId = navBtn.dataset.projId;
      state.activeTag = null;
    } else if (navType === 'tag') {
      state.navMode = 'tag';
      state.activeTag = navBtn.dataset.tag;
      state.activeProjectId = null;
    }

    saveState();
    closeDrawer();
    render();
  });

  // 顶部智能视图与分组/状态筛选
  $('#homeToolbar')?.addEventListener('click', (e) => {
    const clearScope = e.target.closest('[data-clear-scope]');
    if (clearScope) {
      state.navMode = 'smart';
      state.smartView = 'all';
      state.activeProjectId = null;
      state.activeTag = null;
      saveState();
      render();
      return;
    }

    const smartBtn = e.target.closest('[data-smart]');
    if (smartBtn) {
      state.navMode = 'smart';
      state.smartView = smartBtn.dataset.smart;
      state.activeProjectId = null;
      state.activeTag = null;
      saveState();
      render();
      return;
    }

    const gbBtn = e.target.closest('[data-gb]');
    if (gbBtn) {
      state.groupBy = gbBtn.dataset.gb;
      saveState();
      render();
    }
  });

  $('#statusFilterSelect')?.addEventListener('change', (e) => {
    state.statusFilter = e.target.value || 'all';
    saveState();
    render();
  });

  $('#alertBannerWrap')?.addEventListener('click', (e) => {
    const act = e.target.closest('[data-ab-action]')?.dataset.abAction;
    if (act === 'dismiss') {
      bannerDismissed = true;
      renderAlertBanner();
    } else if (act === 'go-today') {
      state.navMode = 'smart';
      state.smartView = 'today';
      state.activeProjectId = null;
      state.activeTag = null;
      saveState();
      render();
    }
  });

  $('#drawerSettings')?.addEventListener('click', () => {
    closeDrawer();
    openSettings();
  });
  $('#drawerTheme')?.addEventListener('click', toggleColorMode);
  $('#drawerInfo')?.addEventListener('click', () => {
    closeDrawer();
    openInfo();
  });

  // 主内容区卡片交互委托（打勾 / 直达该事项专属会话 / 打开详情）
  $('#content')?.addEventListener('click', (e) => {
    if (e.target.closest('.drag-handle')) return;

    const doneBtn = e.target.closest('[data-action="toggle-done"]');
    if (doneBtn) {
      e.stopPropagation();
      toggleDone(doneBtn.dataset.id);
      return;
    }

    const chatBtn = e.target.closest('[data-action="open-task-chat"]');
    if (chatBtn) {
      e.stopPropagation();
      const it = state.items.find(x => x.id === chatBtn.dataset.id);
      if (it) openDetail(it, 'chat');
      return;
    }

    const detailBtn = e.target.closest('[data-action="open-detail"]');
    if (detailBtn) {
      e.stopPropagation();
      const it = state.items.find(x => x.id === detailBtn.dataset.id);
      if (it) openDetail(it, 'plan');
      return;
    }

    const clearArchiveBtn = e.target.closest('#clearArchiveBtn');
    if (clearArchiveBtn) {
      e.stopPropagation();
      const doneCount = state.items.filter(i => i.done).length;
      if (doneCount === 0) return;
      confirmDlg('清空归档', `确定彻底清空所有已归档事项吗？共 ${doneCount} 项，清空后不可恢复。`, () => {
        state.items = state.items.filter(i => !i.done);
        saveState();
        render();
        showToast('已清空归档事项');
      }, '清空', 'delete');
    }
  });

  // 顶部搜索
  $('#searchBtn')?.addEventListener('click', () => {
    $('.appbar-top').hidden = true;
    $('#searchbar').hidden = false;
    $('#searchInput').focus();
  });
  $('#searchBackBtn')?.addEventListener('click', () => {
    $('#searchbar').hidden = true;
    $('.appbar-top').hidden = false;
    state.search = '';
    $('#searchInput').value = '';
    render();
  });
  $('#searchInput')?.addEventListener('input', (e) => {
    state.search = e.target.value.trim();
    render();
  });

  $('#appbarSortBtn')?.addEventListener('click', openSort);
  $('#fab')?.addEventListener('click', () => openAdd());
  $('#fabAi')?.addEventListener('click', () => {
    chatDrawer?.open(null);
  });
});
