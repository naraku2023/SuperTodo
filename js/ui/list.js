/**
 * 待办事项列表渲染与拖拽排序模块
 */

import { state, saveState, emit } from '../state.js';
import { renderSubtasksHtml, toggleSubtask } from './subtasks.js';

export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function money(num) {
  return Number(num).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

export function isOverdue(dateStr) {
  if (!dateStr) return false;
  const target = new Date(dateStr + 'T23:59:59');
  return target.getTime() < Date.now();
}

export function fmtDue(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  const now = new Date();
  if (parseInt(y) === now.getFullYear()) {
    return `${parseInt(m)}月${parseInt(d)}日`;
  }
  return `${y}-${m}-${d}`;
}

export function groupKey(it) {
  return state.groupBy === 'scene' ? (it.scene || '未分组') : (it.time || '未分组');
}

export function groupOrder() {
  const base = state.groupBy === 'scene' ? state.scenes : state.times;
  const keys = ['未分组'];
  base.forEach(k => keys.unshift(k));
  return keys;
}

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

export function sortItems(list) {
  if (state.sortKey === '默认' || state.sortKey === '创建时间') return list;
  const val = i => state.sortKey === '预估花费' 
    ? (i.cost || 0) 
    : state.sortKey === '重要程度' 
      ? (i.star || 0) 
      : state.sortKey === '截止日期' 
        ? (i.due ? new Date(i.due).getTime() : Infinity) 
        : (i.title || '');

  const asc = state.sortAsc;
  list.sort((a, b) => {
    let x = val(a), y = val(b);
    if (x === y) return a.created - b.created;
    if (x === Infinity) return 1;
    if (y === Infinity) return -1;
    return asc ? (x > y ? 1 : -1) : (x < y ? 1 : -1);
  });
  return list;
}

export function sectionGroups() {
  const items = currentItems();
  const map = {};
  items.forEach(it => {
    const k = groupKey(it);
    (map[k] = map[k] || []).push(it);
  });
  const out = [];
  groupOrder().forEach(k => {
    if (map[k]) {
      out.push({
        key: k,
        items: map[k],
        done: map[k].filter(i => i.done).length,
        active: map[k].filter(i => !i.done).length
      });
    }
  });
  return out;
}

/**
 * 渲染主内容区域
 */
export function renderContent() {
  const wrap = document.querySelector('#content');
  const empty = document.querySelector('#emptyState');
  if (!wrap) return;

  if (state.view.name === 'home') {
    renderHome(wrap, empty);
  } else {
    renderList(wrap, empty);
  }
}

function renderHome(wrap, empty) {
  const groups = sectionGroups();
  const totalCount = currentItems().length;

  if (!totalCount) {
    if (empty) empty.hidden = false;
    renderEmptyText();
    wrap.innerHTML = '';
    return;
  }
  if (empty) empty.hidden = true;

  let html = '';
  groups.forEach(g => {
    const undone = g.items
      .filter(i => !i.done)
      .slice()
      .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.created - b.created);
    const preview = undone.slice(0, 4);

    html += `
      <div class="section">
        <div class="section-head" data-open="${escapeHtml(g.key)}">
          <span class="sec-caret" style="background:url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22%235f6368%22><path d=%22M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z/%22/></svg>') center/contain no-repeat"></span>
          <span class="sec-title">${escapeHtml(g.key)}</span>
          <span class="sec-count">${g.items.length}</span>
          <span class="sec-right">${undone.length ? '未完成 ' + undone.length : '全完成'}</span>
        </div>
        <div class="section-card" data-open="${escapeHtml(g.key)}">
          ${preview.map(it => secItemHTML(it)).join('')}
          <div class="sec-more" data-open2="${escapeHtml(g.key)}">
            查看全部 ${g.items.length} 项 
            <span class="ci-arrow" style="background:url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22%235f6368%22><path d=%22M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z/%22/></svg>') center/contain no-repeat;width:14px;height:14px"></span>
          </div>
        </div>
      </div>
    `;
  });

  wrap.innerHTML = html;
}

function secItemHTML(it) {
  return `
    <div class="sec-item" data-item="${it.id}">
      <span class="card-check ${it.done ? 'done' : ''}" data-done="${it.id}"></span>
      <div class="card-body">
        <div class="card-title ${it.done ? 'done' : ''}">${escapeHtml(it.title)}</div>
        <div class="card-meta">${secMeta(it)}</div>
        ${renderSubtasksHtml(it)}
      </div>
    </div>
  `;
}

function secMeta(it) {
  let h = '';
  if (it.cost) h += `<span class="cost">¥${money(it.cost)}</span>`;
  if (it.star) h += `<span class="star">${'★'.repeat(it.star)}</span>`;
  if (it.due) h += `<span class="tag ${isOverdue(it.due) && !it.done ? 'over' : ''}">${fmtDue(it.due)}</span>`;
  if (state.groupBy !== 'scene' && it.scene) h += `<span class="tag">${escapeHtml(it.scene)}</span>`;
  if (state.groupBy !== 'time' && it.time) h += `<span class="tag">${escapeHtml(it.time)}</span>`;
  return h;
}

function renderList(wrap, empty) {
  const g = sectionGroups().find(x => x.key === state.view.group);
  if (!g || !g.items.length) {
    if (empty) empty.hidden = false;
    renderEmptyText();
    wrap.innerHTML = '';
    return;
  }
  if (empty) empty.hidden = true;

  const undone = g.items.filter(i => !i.done);
  let list;
  if (state.sortKey === '默认') {
    list = undone.slice()
      .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.created - b.created)
      .concat(g.items.filter(i => i.done));
  } else {
    list = sortItems(undone.concat(g.items.filter(i => i.done)));
  }

  const draggable = state.sortKey === '默认';
  let html = '';
  list.forEach(it => {
    const drag = draggable && !it.done ? `<span class="drag-handle" data-drag="${it.id}"></span>` : '';
    html += `
      <div class="item-row" data-item="${it.id}">
        <span class="card-check ${it.done ? 'done' : ''}" data-done="${it.id}"></span>
        <div class="card-body">
          <div class="card-title ${it.done ? 'done' : ''}">${escapeHtml(it.title)}</div>
          <div class="card-meta">${fullMeta(it)}</div>
          ${renderSubtasksHtml(it)}
        </div>
        ${drag}
        <span class="chev" style="background:url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22%235f6368%22><path d=%22M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z/%22/></svg>') center/contain no-repeat"></span>
      </div>
    `;
  });

  wrap.innerHTML = html;
  initSortable(wrap);
}

function fullMeta(it) {
  let h = '';
  if (it.type) h += `<span class="tag type-blue">${escapeHtml(it.type)}</span>`;
  if (it.scene && state.groupBy !== 'scene') h += `<span class="tag">${escapeHtml(it.scene)}</span>`;
  if (it.time && state.groupBy !== 'time') h += `<span class="tag">${escapeHtml(it.time)}</span>`;
  if (it.cost) h += `<span class="cost">¥${money(it.cost)}</span>`;
  if (it.star) h += `<span class="star">${'★'.repeat(it.star)}</span>`;
  if (it.due) h += `<span class="tag ${isOverdue(it.due) && !it.done ? 'over' : ''}">${fmtDue(it.due)}</span>`;
  return h;
}

function renderEmptyText() {
  const t = document.querySelector('#emptyTitle');
  const s = document.querySelector('#emptySub');
  if (t) t.textContent = state.search ? '无搜索结果' : (state.view.name === 'home' ? '暂无事项' : '该分组暂无事项');
  if (s) s.textContent = state.search ? '换个关键词试试' : '点击右下角的 + 或让 AI 帮您规划';
}

// 绑定全局子任务展开与勾选切换函数
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
  if (typeof Sortable === 'undefined') return;
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
      const rows = Array.from(wrap.querySelectorAll('.item-row'));
      rows.forEach((r, idx) => {
        const id = r.getAttribute('data-item');
        const it = state.items.find(x => x.id === id);
        if (it) it.order = idx;
      });
      saveState();
    }
  });
}
