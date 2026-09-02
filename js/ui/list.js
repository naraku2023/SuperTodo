/**
 * 待办事项列表渲染模块
 * 极简直观设计：告别混乱标签，大点击热区，点击卡片展开详情，仅点击编辑按钮才进入修改
 */

import { state, saveState, emit } from '../state.js';
import { groupSubtasksByStage } from '../models.js';
import { renderSubtasksHtml, toggleSubtask } from './subtasks.js';

export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function isOverdue(dateStr) {
  if (!dateStr) return false;
  const target = new Date(dateStr + 'T23:59:59');
  return target.getTime() < Date.now();
}

export function fmtDue(dateStr) {
  if (!dateStr) return '';
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  
  const tomorrow = new Date(now.getTime() + 86400000);
  const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

  if (dateStr === todayStr) return '今天';
  if (dateStr === tomorrowStr) return '明天';

  const [y, m, d] = dateStr.split('-');
  if (parseInt(y) === now.getFullYear()) {
    return `${parseInt(m)}月${parseInt(d)}日`;
  }
  return `${y}-${m}-${d}`;
}

/**
 * 过滤当前分类及搜索结果
 */
export function currentItems() {
  let list = state.items.slice();
  if (state.type !== '全部') {
    list = list.filter(i => i.type === state.type);
  }
  if (state.search) {
    const q = state.search.toLowerCase();
    list = list.filter(i => (i.title + (i.note || '')).toLowerCase().includes(q));
  }
  return list;
}

/**
 * 排序逻辑
 */
export function sortItems(list) {
  if (state.sortKey === '默认' || state.sortKey === '创建时间') {
    return list.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || b.created - a.created);
  }
  const val = i => state.sortKey === '预估花费' 
    ? (i.cost || 0) 
    : state.sortKey === '重要程度' 
      ? (i.star || 0) 
      : state.sortKey === '截止日期' 
        ? (i.due ? new Date(i.due).getTime() : Infinity) 
        : (i.title || '');

  const asc = state.sortAsc;
  return list.slice().sort((a, b) => {
    let x = val(a), y = val(b);
    if (x === y) return a.created - b.created;
    if (x === Infinity) return 1;
    if (y === Infinity) return -1;
    return asc ? (x > y ? 1 : -1) : (x < y ? 1 : -1);
  });
}

/**
 * 渲染主待办列表（直观、极简、清晰）
 */
export function renderContent() {
  const wrap = document.querySelector('#content');
  const empty = document.querySelector('#emptyState');
  if (!wrap) return;

  const allItems = currentItems();
  if (!allItems.length) {
    if (empty) empty.hidden = false;
    renderEmptyText();
    wrap.innerHTML = '';
    return;
  }
  if (empty) empty.hidden = true;

  const undoneItems = sortItems(allItems.filter(i => !i.done));
  const doneItems = allItems.filter(i => i.done);

  let html = '';

  // 1. 未完成事项列表
  if (undoneItems.length > 0) {
    html += `
      <div class="task-group active-group">
        <div class="group-header">
          <span class="group-title">待办事项</span>
          <span class="group-count">${undoneItems.length}</span>
        </div>
        <div class="task-list" id="undoneList">
          ${undoneItems.map(it => renderTaskCard(it, true)).join('')}
        </div>
      </div>
    `;
  }

  // 2. 已完成事项列表（折叠式展示，不抢占视觉）
  if (doneItems.length > 0) {
    html += `
      <div class="task-group completed-group">
        <details class="completed-details" ${undoneItems.length === 0 ? 'open' : ''}>
          <summary class="completed-summary">
            <span class="cs-title">已完成</span>
            <span class="cs-count">${doneItems.length}</span>
          </summary>
          <div class="task-list done-list">
            ${doneItems.map(it => renderTaskCard(it, false)).join('')}
          </div>
        </details>
      </div>
    `;
  }

  wrap.innerHTML = html;
  initSortable(document.querySelector('#undoneList'));
}

/**
 * 单个事项卡片渲染
 */
function renderTaskCard(it, isUndone) {
  const hasSubtasks = it.subtasks && it.subtasks.length > 0;
  const overdue = isOverdue(it.due) && !it.done;
  const draggable = state.sortKey === '默认' && isUndone;

  let dueBadge = '';
  if (it.due) {
    dueBadge = `
      <span class="card-due-badge ${overdue ? 'overdue' : ''}">
        <span class="due-icon">📅</span> ${fmtDue(it.due)}
      </span>
    `;
  }

  // 分类定制徽标
  let categoryBadge = '';
  const type = it.type || '待办';
  if (type === '购物' && it.cost != null && it.cost > 0) {
    categoryBadge = `<span class="card-tmpl-badge badge-shopping">🛒 ¥${it.cost}</span>`;
  } else if (type === '愿望' && it.star) {
    categoryBadge = `<span class="card-tmpl-badge badge-wish">🌟 ${'★'.repeat(it.star)}</span>`;
  } else if (type === '旅游' && it.scene) {
    categoryBadge = `<span class="card-tmpl-badge badge-travel">✈️ ${escapeHtml(it.scene)}</span>`;
  }

  let subtasksProgress = '';
  if (hasSubtasks) {
    const total = it.subtasks.length;
    const completed = it.subtasks.filter(s => s.done).length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    
    // 检查是否包含阶段划分
    const stageGroups = groupSubtasksByStage(it.subtasks);
    const stageCount = stageGroups.filter(g => Boolean(g.stage)).length;
    const stagePrefix = stageCount > 1 ? `🎯 ${stageCount}个阶段 · ` : '';

    subtasksProgress = `
      <div class="card-subtasks-summary">
        <span class="subtasks-summary-text">${stagePrefix}☑ ${completed}/${total} 步 (${percent}%)</span>
        <div class="subtasks-summary-bar">
          <div class="subtasks-summary-fill" style="width:${percent}%"></div>
        </div>
      </div>
    `;
  }

  let notePreview = '';
  if (it.note) {
    const cleanNote = it.note.replace(/\n/g, ' ');
    notePreview = `<div class="card-note-text">${escapeHtml(cleanNote)}</div>`;
  }

  const dragHandle = draggable 
    ? `<span class="drag-handle" data-drag="${it.id}" title="拖拽排序"></span>` 
    : '';

  return `
    <div class="clean-task-card ${it.done ? 'is-done' : ''}" data-task-id="${it.id}">
      <!-- 左侧打勾圆圈：点击仅切换整体完成状态 -->
      <div class="task-chk-btn" data-action="toggle-done" data-id="${it.id}" aria-label="标记完成">
        <span class="chk-circle ${it.done ? 'checked' : ''}"></span>
      </div>

      <!-- 中间主体：点击直接进入清晰的任务详情页，支持一步步打勾完结与查阅完整指南 -->
      <div class="task-content-body" data-action="open-detail" data-id="${it.id}">
        <div class="task-title-line">
          <span class="task-title-text ${it.done ? 'done' : ''}">${escapeHtml(it.title)}</span>
          ${categoryBadge}
          ${dueBadge}
        </div>
        ${notePreview}
        ${subtasksProgress}
      </div>

      <!-- 右侧操作区：拖拽手柄与进入详情箭头 -->
      <div class="task-right-actions">
        ${dragHandle}
        <button type="button" class="task-detail-arrow" data-action="open-detail" data-id="${it.id}" aria-label="查看详情">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41 1.41z"/>
          </svg>
        </button>
      </div>
    </div>
  `;
}

function renderEmptyText() {
  const t = document.querySelector('#emptyTitle');
  const s = document.querySelector('#emptySub');
  if (t) t.textContent = state.search ? '无搜索结果' : '暂无待办事项';
  if (s) s.textContent = state.search ? '换个关键词试试' : '点击右下角 + 添加，或让 AI 帮您规划';
}

// 绑定全局子任务展开/收起切换
window.toggleSubtasksCollapse = function(taskId) {
  const listEl = document.querySelector(`#subList_${taskId}`);
  const btnEl = document.querySelector(`#subChevron_${taskId}`);
  if (!listEl) return;
  const isHidden = listEl.hidden;
  listEl.hidden = !isHidden;
  if (btnEl) btnEl.textContent = isHidden ? '▴' : '▾';
};

// 监听子任务勾选点击
document.addEventListener('change', (e) => {
  const chk = e.target.closest('.subtask-chk');
  if (!chk) return;
  const row = chk.closest('.subtask-row');
  if (!row) return;
  const taskId = row.getAttribute('data-task-id');
  const subId = row.getAttribute('data-sub-id');
  if (taskId && subId) {
    toggleSubtask(taskId, subId);
  }
});

let sortableInstance = null;
function initSortable(wrap) {
  if (!wrap || typeof Sortable === 'undefined') return;
  if (sortableInstance) {
    sortableInstance.destroy();
    sortableInstance = null;
  }
  if (state.sortKey !== '默认') return;

  sortableInstance = new Sortable(wrap, {
    handle: '.drag-handle',
    animation: 180,
    ghostClass: 'sortable-ghost',
    dragClass: 'sortable-drag',
    onEnd: () => {
      const rows = Array.from(wrap.querySelectorAll('.clean-task-card'));
      rows.forEach((r, idx) => {
        const id = r.getAttribute('data-task-id');
        const it = state.items.find(x => x.id === id);
        if (it) it.order = idx;
      });
      saveState();
    }
  });
}
