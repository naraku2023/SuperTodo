/**
 * 应用程序主入口 (Main Application Entry)
 * 纯原生 ES Modules 架构，解耦调度与生命周期管理
 */

import { state, loadState, saveState, on, applyColorMode, toggleColorMode } from './state.js';
import { renderContent, escapeHtml } from './ui/list.js';
import { buildStars, openAdd, openEdit, openSettings, openSort, openInfo, pushLayer, syncBack, closeTopLayer, onReady, showToast, confirmDlg } from './ui/modals.js';
import { openDetail } from './ui/detail.js';
import { ChatDrawer } from './ui/chat-drawer.js';

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

// 初始化 AI 多轮对话抽屉实例
let chatDrawer = null;

function renderDrawerNav() {
  const nav = $('#drawerNav');
  if (!nav) return;

  const activeTotal = state.items.filter(i => !i.done).length;
  const archivedTotal = state.items.filter(i => i.done).length;

  let html = `
    <button class="dnav-item dnav-all ${state.type === '全部' ? 'on' : ''}" data-t="全部">
      <span class="dnav-ic" style="background:url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22%235f6368%22><path d=%22M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z%22/></svg>') center/contain no-repeat"></span>
      <span class="dnav-t">全部待办</span>
      <span class="dnav-c">${activeTotal}</span>
    </button>
  `;

  state.types.forEach((t, idx) => {
    const cnt = state.items.filter(i => !i.done && i.type === t).length;
    html += `
      <button class="dnav-item ${state.type === t ? 'on' : ''}" data-t="${escapeHtml(t)}" data-idx="${idx}" data-kind="type">
        <span class="dnav-ic" style="background:url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22%235f6368%22><path d=%22M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z%22/></svg>') center/contain no-repeat"></span>
        <span class="dnav-t">${escapeHtml(t)}</span>
        <span class="dnav-c">${cnt}</span>
      </button>
    `;
  });

  html += `<button class="dnav-item dnav-add" id="dnavAdd"><span class="dnav-ic">+</span><span class="dnav-t">新增类型</span></button>`;

  // 专属已完成归档箱分区
  html += `
    <div class="dnav-sep"></div>
    <button class="dnav-item dnav-archived ${state.type === '已归档' ? 'on' : ''}" data-t="已归档">
      <span class="dnav-ic" style="background:url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22%235f6368%22><path d=%22M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z%22/></svg>') center/contain no-repeat"></span>
      <span class="dnav-t">已归档事项</span>
      <span class="dnav-c ${archivedTotal > 0 ? 'highlight-archived' : ''}">${archivedTotal}</span>
    </button>
  `;

  nav.innerHTML = html;
}

function updateAppTitle() {
  const t = $('#appTitle');
  const back = $('#backBtn');
  const ham = $('#hamburger');
  const sortBtn = $('#appbarSortBtn');
  const gb = $('#homeGroupby');

  if (state.view.name === 'home') {
    if (t) t.textContent = state.type === '全部' ? '全部待办' : state.type;
    if (back) back.hidden = true;
    if (ham) ham.hidden = false;
    if (sortBtn) sortBtn.hidden = state.type === '已归档';
    if (gb) gb.hidden = true;
  } else {
    if (t) t.textContent = state.view.group || '分组详情';
    if (back) back.hidden = false;
    if (ham) ham.hidden = true;
    if (sortBtn) sortBtn.hidden = false;
    if (gb) gb.hidden = true;
  }
}

export function render() {
  updateAppTitle();
  renderDrawerNav();
  renderContent();
}

function enterGroup(key) {
  pushLayer();
  state.view = { name: 'list', group: key };
  state.sortKey = '默认';
  render();
}

function backHome() {
  state.view = { name: 'home' };
  state.sortKey = '默认';
  render();
}

function toggleDone(id) {
  const it = state.items.find(x => x.id === id);
  if (!it) return;

  if (!it.done) {
    // 事项完结时弹窗确认以防误触
    confirmDlg(
      '标记完成',
      `确定将“${it.title}”标记为已完成并移入归档吗？`,
      () => {
        it.done = true;
        it.completedAt = Date.now();
        saveState();
        render();
        showToast('已完成并移至“已归档”');
      },
      '确认完成'
    );
  } else {
    // 已完结事项恢复时弹窗确认
    confirmDlg(
      '恢复待办',
      `确定将“${it.title}”从已归档恢复为待办事项吗？`,
      () => {
        it.done = false;
        it.completedAt = null;
        saveState();
        render();
        showToast('已恢复至待办清单');
      },
      '确认恢复'
    );
  }
}

// 汉堡抽屉开关
function openDrawer() {
  pushLayer();
  $('#drawerMask').hidden = false;
  $('#drawer').hidden = false;
}

function closeDrawer() {
  $('#drawerMask').hidden = true;
  $('#drawer').hidden = true;
  syncBack();
}

// 初始化主入口
async function init() {
  await loadState();
  applyColorMode();
  buildStars();

  chatDrawer = new ChatDrawer();
  chatDrawer.init();
  window.chatDrawerInstance = chatDrawer;

  // 状态变更响应
  on('items-changed', () => render());
  on('saved', () => render());

  render();

  // 绑定原生 Android 物理返回键（通过 Capacitor App 插件检测）
  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
    window.Capacitor.Plugins.App.addListener('backButton', () => {
      const closed = closeTopLayer();
      if (!closed) {
        // 如果顶层无任何遮罩且处于二级页面，则返回首页
        if (state.view.name !== 'home') {
          backHome();
        } else {
          // 首页再次按返回退出应用
          window.Capacitor.Plugins.App.exitApp();
        }
      }
    });
  }
}

// 绑定全局 DOM 事件
onReady(() => {
  init();

  // 汉堡菜单与返回
  $('#hamburger')?.addEventListener('click', openDrawer);
  $('#drawerClose')?.addEventListener('click', closeDrawer);
  $('#drawerMask')?.addEventListener('click', closeDrawer);
  $('#backBtn')?.addEventListener('click', () => {
    backHome();
    syncBack();
  });

  // 汉堡抽屉点击选择类型
  $('#drawerNav')?.addEventListener('click', (e) => {
    const item = e.target.closest('.dnav-item');
    if (!item) return;
    if (item.id === 'dnavAdd') {
      import('./ui/modals.js').then(m => {
        m.inputDlg('新增类型', '输入新类型名称', '', (nm) => {
          if (!nm) return;
          if (state.types.includes(nm)) {
            m.alertDlg('提示', '该类型已存在');
            return;
          }
          state.types.push(nm);
          saveState();
          render();
        });
      });
      return;
    }
    state.type = item.dataset.t;
    state.view = { name: 'home' };
    closeDrawer();
    render();
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

  // 分组维度切换
  $('#groupBySeg')?.addEventListener('click', (e) => {
    const seg = e.target.closest('.seg');
    if (!seg) return;
    state.groupBy = seg.dataset.gb;
    state.view = { name: 'home' };
    saveState();
    $$('#groupBySeg .seg').forEach(s => s.classList.toggle('on', s.dataset.gb === state.groupBy));
    render();
  });

  // 主内容区点击委托（精准划分：打勾、进入详情页）
  $('#content')?.addEventListener('click', (e) => {
    if (e.target.closest('.drag-handle')) return;

    // 1. 点击左侧圆圈：快速切换主任务完成状态
    const doneBtn = e.target.closest('[data-action="toggle-done"]');
    if (doneBtn) {
      e.stopPropagation();
      toggleDone(doneBtn.dataset.id);
      return;
    }

    // 2. 点击卡片主体或详情箭头：进入专属任务详情页 (可查阅完整指南并一步步打勾完结)
    const detailBtn = e.target.closest('[data-action="open-detail"]');
    if (detailBtn) {
      e.stopPropagation();
      const it = state.items.find(x => x.id === detailBtn.dataset.id);
      if (it) openDetail(it);
      return;
    }

    // 3. 一键清空所有已归档事项
    const clearArchiveBtn = e.target.closest('#clearArchiveBtn');
    if (clearArchiveBtn) {
      e.stopPropagation();
      const doneCount = state.items.filter(i => i.done).length;
      if (doneCount === 0) return;
      if (confirm(`确定彻底清空所有已归档事项吗？共 ${doneCount} 项，清空后不可恢复。`)) {
        state.items = state.items.filter(i => !i.done);
        saveState();
        render();
        showToast('已清空归档事项');
      }
      return;
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
    if (state.view.name !== 'home') state.view = { name: 'home' };
    render();
  });

  // 排序按钮
  $('#appbarSortBtn')?.addEventListener('click', openSort);

  // 浮动按钮：+ 键打开常规添加，AI 键呼出 AI 规划助手
  $('#fab')?.addEventListener('click', () => openAdd());
  $('#fabAi')?.addEventListener('click', () => {
    chatDrawer?.open();
  });
});
