/**
 * 待办事项列表筛选、分组与卡片渲染模块
 */

import { state, saveState, getProjectById, getTaskTemplate } from '../state.js';
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  REPEAT_OPTIONS
} from '../config.js';
import {
  groupSubtasksByStage,
  getTodayYmd,
  addDaysYmd,
  calculateShoppingStats
} from '../models.js';

const PRIORITY_RANK = { urgent: 4, high: 3, medium: 2, low: 1 };
const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// 记忆折叠的分组 key
const collapsedGroups = new Set();

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
  return dateStr < getTodayYmd();
}

export function fmtDue(dateStr) {
  if (!dateStr) return '';
  const todayStr = getTodayYmd();
  const tomorrowStr = addDaysYmd(todayStr, 1);
  const yesterdayStr = addDaysYmd(todayStr, -1);

  if (dateStr === todayStr) return '今天';
  if (dateStr === tomorrowStr) return '明天';
  if (dateStr === yesterdayStr) return '昨天';

  const [y, m, d] = dateStr.split('-');
  const curYear = Number(todayStr.slice(0, 4));
  if (parseInt(y, 10) === curYear) {
    return `${parseInt(m, 10)}月${parseInt(d, 10)}日`;
  }
  return `${y}-${m}-${d}`;
}

function fmtDayHeader(ymd) {
  const today = getTodayYmd();
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const wd = WEEKDAY_CN[dt.getDay()];
  if (ymd === today) return `☀️ 今天 · ${m}月${d}日 (${wd})`;
  if (ymd === addDaysYmd(today, 1)) return `🌤 明天 · ${m}月${d}日 (${wd})`;
  return `📅 ${m}月${d}日 (${wd})`;
}

export function formatCompletedTime(ts) {
  if (!ts) return '已完结';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '已完结';

  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');

  const now = new Date();
  const isToday = now.getFullYear() === y && now.getMonth() === d.getMonth() && now.getDate() === d.getDate();
  if (isToday) return `今天 ${hh}:${mm} 完成`;
  if (now.getFullYear() === y) return `${m}-${day} ${hh}:${mm} 完成`;
  return `${y}-${m}-${day} ${hh}:${mm} 完成`;
}

/**
 * 判断事项是否命中「今日聚焦」（逾期、今日截止、今日开始或进行中且跨越今天、含今日子步骤）
 */
export function isTaskForToday(it, today = getTodayYmd()) {
  if (it.done) return false;
  if (it.due && it.due <= today) return true;
  if (it.startDate && it.startDate <= today && (!it.due || it.due >= today)) return true;
  if (Array.isArray(it.subtasks) && it.subtasks.some(s => !s.done && s.due && s.due <= today)) return true;
  return false;
}

/**
 * 判断事项是否命中「最近 7 天」
 */
export function isTaskUpcoming(it, today = getTodayYmd()) {
  if (it.done) return false;
  const end7 = addDaysYmd(today, 7);
  if (it.due && it.due <= end7) return true;
  if (it.startDate && it.startDate <= end7) return true;
  if (Array.isArray(it.subtasks) && it.subtasks.some(s => !s.done && s.due && s.due <= end7)) return true;
  return false;
}

/**
 * 统计各智能视图计数（供侧边栏和顶部胶囊使用）
 */
export function computeViewCounts() {
  const today = getTodayYmd();
  const active = state.items.filter(i => !i.done);
  return {
    today: active.filter(i => isTaskForToday(i, today)).length,
    overdue: active.filter(i => i.due && i.due < today).length,
    upcoming: active.filter(i => isTaskUpcoming(i, today)).length,
    priority: active.filter(i => i.priority === 'urgent' || i.priority === 'high' || (i.star || 0) >= 4).length,
    inbox: active.filter(i => !i.projectId).length,
    all: active.length,
    archived: state.items.filter(i => i.done).length,
    sessions: state.items.filter(i => Array.isArray(i.chatHistory) && i.chatHistory.length > 0).length
  };
}

/**
 * 过滤当前导航视图、状态筛选与搜索结果
 */
export function currentItems() {
  const today = getTodayYmd();
  let list = state.items.slice();

  const isArchive = state.navMode === 'smart' && state.smartView === 'archived';
  if (isArchive) {
    list = list.filter(i => i.done);
  } else {
    list = list.filter(i => !i.done);

    if (state.navMode === 'smart') {
      if (state.smartView === 'today') {
        list = list.filter(i => isTaskForToday(i, today));
      } else if (state.smartView === 'upcoming') {
        list = list.filter(i => isTaskUpcoming(i, today));
      } else if (state.smartView === 'priority') {
        list = list.filter(i => i.priority === 'urgent' || i.priority === 'high' || (i.star || 0) >= 4);
      } else if (state.smartView === 'inbox') {
        list = list.filter(i => !i.projectId);
      }
    } else if (state.navMode === 'project' && state.activeProjectId) {
      list = list.filter(i => i.projectId === state.activeProjectId);
    } else if (state.navMode === 'tag' && state.activeTag) {
      list = list.filter(i => Array.isArray(i.tags) && i.tags.includes(state.activeTag));
    }

    if (state.statusFilter && state.statusFilter !== 'all') {
      list = list.filter(i => (i.status || 'todo') === state.statusFilter);
    }
  }

  if (state.search) {
    const q = state.search.toLowerCase();
    list = list.filter(i => {
      const proj = getProjectById(i.projectId);
      const hay = [
        i.title,
        i.note,
        proj ? proj.name : '',
        ...(i.tags || []),
        ...(i.subtasks || []).map(s => `${s.stage || ''} ${s.title}`)
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  return list;
}

/**
 * 排序逻辑
 */
export function sortItems(list) {
  if (state.sortKey === '默认') {
    return list.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || b.created - a.created);
  }
  if (state.sortKey === '创建时间') {
    return list.slice().sort((a, b) => state.sortAsc ? a.created - b.created : b.created - a.created);
  }

  const val = i => {
    if (state.sortKey === '预估花费') return i.cost || 0;
    if (state.sortKey === '优先级' || state.sortKey === '重要程度') return PRIORITY_RANK[i.priority] || 2;
    if (state.sortKey === '截止日期') return i.due ? new Date(i.due + 'T00:00:00').getTime() : Infinity;
    return i.title || '';
  };

  const asc = state.sortAsc;
  return list.slice().sort((a, b) => {
    const x = val(a), y = val(b);
    if (x === y) return (a.order ?? 0) - (b.order ?? 0) || b.created - a.created;
    if (x === Infinity) return 1;
    if (y === Infinity) return -1;
    if (state.sortKey === '优先级' && state.sortKey === state.sortKey) {
      // 默认优先高的在前（降序），若用户切换 asc 则反转
      return asc ? (y - x) : (x - y);
    }
    return asc ? (x > y ? 1 : -1) : (x < y ? 1 : -1);
  });
}

/**
 * 按当前分组维度构造分组数组
 */
function buildGroups(sortedItems) {
  const today = getTodayYmd();
  const tomorrow = addDaysYmd(today, 1);
  const weekEnd = addDaysYmd(today, 7);

  // 1. 今日聚焦特殊分组：已逾期 / 今日安排
  if (state.navMode === 'smart' && state.smartView === 'today') {
    const overdue = sortedItems.filter(i => i.due && i.due < today);
    const todayItems = sortedItems.filter(i => !i.due || i.due >= today);
    const groups = [];
    if (overdue.length) groups.push({ key: 'overdue', title: '⚠️ 已逾期需优先处理', items: overdue, tone: 'danger' });
    if (todayItems.length) groups.push({ key: 'today', title: '☀️ 今日聚焦安排', items: todayItems });
    return groups;
  }

  // 2. 最近 7 天按具体日期分桶
  if (state.navMode === 'smart' && state.smartView === 'upcoming') {
    const buckets = new Map();
    const overdue = [];
    sortedItems.forEach(it => {
      const anchor = it.due || it.startDate || '';
      if (anchor && anchor < today) {
        overdue.push(it);
      } else if (anchor) {
        if (!buckets.has(anchor)) buckets.set(anchor, []);
        buckets.get(anchor).push(it);
      } else {
        if (!buckets.has('substep')) buckets.set('substep', []);
        buckets.get('substep').push(it);
      }
    });
    const groups = [];
    if (overdue.length) groups.push({ key: 'up_overdue', title: '⚠️ 已逾期', items: overdue, tone: 'danger' });
    Array.from(buckets.keys()).sort().forEach(k => {
      if (k === 'substep') {
        groups.push({ key: 'up_sub', title: '📌 含近期子步骤', items: buckets.get(k) });
      } else {
        groups.push({ key: `up_${k}`, title: fmtDayHeader(k), items: buckets.get(k) });
      }
    });
    return groups;
  }

  // 3. 通用分组维度
  const gb = state.groupBy || 'schedule';
  if (gb === 'none') {
    return [{ key: 'flat', title: '', items: sortedItems, flat: true }];
  }

  if (gb === 'schedule') {
    const buckets = [
      { key: 'sch_overdue', title: '⚠️ 已逾期', items: [], tone: 'danger' },
      { key: 'sch_today', title: '☀️ 今天', items: [] },
      { key: 'sch_tomorrow', title: '🌤 明天', items: [] },
      { key: 'sch_week', title: '📆 本周内', items: [] },
      { key: 'sch_later', title: '🗓 远期安排', items: [] },
      { key: 'sch_unscheduled', title: '📥 未排期', items: [] }
    ];
    sortedItems.forEach(it => {
      const anchor = it.due || it.startDate || '';
      if (!anchor) buckets[5].items.push(it);
      else if (it.due && it.due < today) buckets[0].items.push(it);
      else if (anchor <= today) buckets[1].items.push(it);
      else if (anchor === tomorrow) buckets[2].items.push(it);
      else if (anchor <= weekEnd) buckets[3].items.push(it);
      else buckets[4].items.push(it);
    });
    return buckets.filter(b => b.items.length > 0);
  }

  if (gb === 'project') {
    const map = new Map();
    sortedItems.forEach(it => {
      const key = it.projectId || '__inbox__';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(it);
    });
    const groups = [];
    state.projects.forEach(p => {
      if (map.has(p.id)) {
        groups.push({ key: `proj_${p.id}`, title: `${p.icon} ${p.name}`, items: map.get(p.id), color: p.color });
      }
    });
    if (map.has('__inbox__')) {
      groups.push({ key: 'proj_inbox', title: '📥 收集箱', items: map.get('__inbox__') });
    }
    return groups;
  }

  if (gb === 'status') {
    return ['in_progress', 'todo', 'blocked'].map(stId => {
      const meta = TASK_STATUSES.find(s => s.id === stId);
      const items = sortedItems.filter(i => (i.status || 'todo') === stId);
      return { key: `st_${stId}`, title: `${meta.icon} ${meta.label}`, items };
    }).filter(g => g.items.length > 0);
  }

  if (gb === 'priority') {
    return TASK_PRIORITIES.map(pr => {
      const items = sortedItems.filter(i => (i.priority || 'medium') === pr.id);
      return { key: `pr_${pr.id}`, title: pr.label, items, color: pr.color };
    }).filter(g => g.items.length > 0);
  }

  return [{ key: 'flat', title: '', items: sortedItems, flat: true }];
}

/**
 * 渲染主待办列表
 */
export function renderContent() {
  const wrap = document.querySelector('#content');
  const empty = document.querySelector('#emptyState');
  if (!wrap) return;

  const allItems = currentItems();
  const isArchiveMode = state.navMode === 'smart' && state.smartView === 'archived';

  if (!allItems.length) {
    if (empty) empty.hidden = false;
    renderEmptyText();
    wrap.innerHTML = '';
    return;
  }
  if (empty) empty.hidden = true;

  let html = '';

  if (isArchiveMode) {
    const sortedArchived = allItems.slice().sort((a, b) => {
      const timeA = a.completedAt || a.updated || a.created || 0;
      const timeB = b.completedAt || b.updated || b.created || 0;
      return timeB - timeA;
    });

    html += `
      <div class="archive-header-card">
        <div class="archive-header-left">
          <span class="archive-header-icon">📦</span>
          <div class="archive-header-text">
            <span class="archive-header-title">已归档清单 (${sortedArchived.length})</span>
            <span class="archive-header-desc">按完成时间倒序 · 点击左侧圆圈恢复至待办</span>
          </div>
        </div>
        ${sortedArchived.length > 0 ? `<button type="button" class="btn-clear-archive" id="clearArchiveBtn">清空归档</button>` : ''}
      </div>
      <div class="task-list archive-task-list" id="archiveList">
        ${sortedArchived.map(it => renderTaskCard(it, false)).join('')}
      </div>
    `;
    wrap.innerHTML = html;
    return;
  }

  const sorted = sortItems(allItems);
  const groups = buildGroups(sorted);
  const allowDrag = state.sortKey === '默认' && state.groupBy === 'none';

  groups.forEach(g => {
    if (g.flat) {
      html += `
        <div class="task-group active-group">
          <div class="task-list" id="undoneList">
            ${g.items.map(it => renderTaskCard(it, allowDrag)).join('')}
          </div>
        </div>
      `;
    } else {
      const isCollapsed = collapsedGroups.has(g.key);
      html += `
        <div class="task-group ${isCollapsed ? 'is-collapsed' : ''}" data-group-key="${escapeHtml(g.key)}">
          <button type="button" class="group-header group-toggle-btn ${g.tone === 'danger' ? 'is-danger' : ''}" data-toggle-group="${escapeHtml(g.key)}">
            <span class="group-caret">${isCollapsed ? '▸' : '▾'}</span>
            ${g.color ? `<span class="group-dot" style="background:${escapeHtml(g.color)}"></span>` : ''}
            <span class="group-title">${escapeHtml(g.title)}</span>
            <span class="group-count">${g.items.length}</span>
          </button>
          <div class="task-list" ${isCollapsed ? 'hidden' : ''}>
            ${g.items.map(it => renderTaskCard(it, false)).join('')}
          </div>
        </div>
      `;
    }
  });

  wrap.innerHTML = html;

  // 绑定分组折叠
  wrap.querySelectorAll('[data-toggle-group]').forEach(btn => {
    btn.onclick = () => {
      const k = btn.dataset.toggleGroup;
      if (collapsedGroups.has(k)) collapsedGroups.delete(k);
      else collapsedGroups.add(k);
      renderContent();
    };
  });

  if (allowDrag) {
    initSortable(document.querySelector('#undoneList'));
  }
}

/**
 * 单个事项卡片渲染（含优先级圆圈、排期时段、项目归属、标签、专属模板摘要与独立会话直达入口）
 */
function renderTaskCard(it, draggable) {
  const proj = getProjectById(it.projectId);
  const tmpl = getTaskTemplate(it);
  const priorityObj = TASK_PRIORITIES.find(p => p.id === (it.priority || 'medium')) || TASK_PRIORITIES[2];
  const overdue = isOverdue(it.due) && !it.done;

  // 1. 项目空间标签
  const projBadge = proj
    ? `<span class="card-proj-pill" style="--proj-color:${escapeHtml(proj.color)}">${proj.icon} ${escapeHtml(proj.name)}</span>`
    : `<span class="card-proj-pill inbox">📥 收集箱</span>`;

  // 2. 状态徽标（非默认 todo 时展示）
  let statusBadge = '';
  if (!it.done && it.status === 'in_progress') {
    statusBadge = `<span class="card-status-badge st-progress">◔ 进行中</span>`;
  } else if (!it.done && it.status === 'blocked') {
    statusBadge = `<span class="card-status-badge st-blocked">⏸ 阻塞</span>`;
  }

  // 3. 排期与时段徽标
  let scheduleBadge = '';
  if (it.startDate || it.due || it.startTime || it.durationMin) {
    const parts = [];
    if (it.startDate && it.due && it.startDate !== it.due) {
      parts.push(`${fmtDue(it.startDate)}→${fmtDue(it.due)}`);
    } else if (it.due) {
      parts.push(fmtDue(it.due));
    } else if (it.startDate) {
      parts.push(`${fmtDue(it.startDate)}起`);
    }
    if (it.startTime) {
      parts.push(it.endTime ? `${it.startTime}-${it.endTime}` : it.startTime);
    }
    if (it.durationMin) {
      parts.push(it.durationMin >= 60 && it.durationMin % 60 === 0 ? `${it.durationMin / 60}h` : `${it.durationMin}m`);
    }
    scheduleBadge = `<span class="card-due-badge ${overdue ? 'overdue' : ''}">📅 ${escapeHtml(parts.join(' '))}</span>`;
  }

  // 4. 重复徽标
  const repObj = REPEAT_OPTIONS.find(r => r.id === it.repeat);
  const repeatBadge = (it.repeat && it.repeat !== 'none' && repObj)
    ? `<span class="card-repeat-badge">🔁 ${repObj.label}</span>`
    : '';

  // 5. 分类定制结构化摘要徽标
  let tmplBadge = '';
  if (tmpl === 'shopping') {
    const st = calculateShoppingStats(it.extra);
    if (st.totalCount > 0) {
      tmplBadge = `<span class="card-tmpl-badge badge-shopping">🛒 ${st.boughtCount}/${st.totalCount}项 · ¥${st.totalAmount || it.cost || 0}</span>`;
    } else if (it.cost != null && it.cost > 0) {
      tmplBadge = `<span class="card-tmpl-badge badge-shopping">🛒 ¥${it.cost}</span>`;
    }
  } else if (tmpl === 'travel') {
    const tp = it.extra?.travelPlan;
    if (tp && (tp.destination || tp.itinerary?.length)) {
      const segs = [tp.destination, tp.days ? `${tp.days}天` : '', tp.itinerary?.length ? `${tp.itinerary.length}站` : ''].filter(Boolean).join('·');
      tmplBadge = `<span class="card-tmpl-badge badge-travel">✈️ ${escapeHtml(segs)}</span>`;
    }
  } else if (tmpl === 'wish') {
    const wm = it.extra?.wishMeta;
    if (wm && wm.targetAmount) {
      tmplBadge = `<span class="card-tmpl-badge badge-wish">🌟 ¥${wm.savedAmount || 0}/¥${wm.targetAmount}</span>`;
    } else if (it.star) {
      tmplBadge = `<span class="card-tmpl-badge badge-wish">🌟 ${'★'.repeat(it.star)}</span>`;
    }
  } else if (tmpl === 'plan') {
    const pm = it.extra?.planMeta;
    if (pm && pm.goalMetric) {
      tmplBadge = `<span class="card-tmpl-badge badge-plan">🎯 ${escapeHtml(pm.goalMetric.slice(0, 14))}</span>`;
    }
  }

  // 6. 完成时间徽标
  let completedBadge = '';
  if (it.done) {
    completedBadge = `<span class="card-completed-badge">${formatCompletedTime(it.completedAt || it.updated || it.created)}</span>`;
  }

  // 7. 标签（最多显示3个）
  let tagsHtml = '';
  if (Array.isArray(it.tags) && it.tags.length > 0) {
    tagsHtml = it.tags.slice(0, 3).map(t => `<span class="card-tag-chip">#${escapeHtml(t)}</span>`).join('');
    if (it.tags.length > 3) tagsHtml += `<span class="card-tag-chip more">+${it.tags.length - 3}</span>`;
  }

  // 8. 阶段与步骤进度条
  let subtasksProgress = '';
  if (it.subtasks && it.subtasks.length > 0) {
    const total = it.subtasks.length;
    const completed = it.subtasks.filter(s => s.done).length;
    const percent = Math.round((completed / total) * 100);
    const stageGroups = groupSubtasksByStage(it.subtasks, it.stages);
    const stageCount = stageGroups.filter(g => Boolean(g.stage)).length;
    const stagePrefix = stageCount > 1 ? `🎯 ${stageCount}阶段 · ` : '';

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

  const chatCount = Array.isArray(it.chatHistory) ? it.chatHistory.length : 0;
  const chatBtn = `
    <button type="button" class="task-chat-btn ${chatCount > 0 ? 'has-chat' : ''}" data-action="open-task-chat" data-id="${it.id}" title="${chatCount > 0 ? `进入专属会话 (${chatCount}条记录)` : '为此事项开启独立会话'}">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/></svg>
      ${chatCount > 0 ? `<span class="task-chat-count">${chatCount}</span>` : ''}
    </button>
  `;

  const dragHandle = draggable
    ? `<span class="drag-handle" data-drag="${it.id}" title="拖拽排序"></span>`
    : '';

  return `
    <div class="clean-task-card ${it.done ? 'is-done' : ''}" data-task-id="${it.id}">
      <div class="task-chk-btn" data-action="toggle-done" data-id="${it.id}" aria-label="标记完成">
        <span class="chk-circle ${it.done ? 'checked' : ''}" style="--prio-color:${escapeHtml(priorityObj.color)}"></span>
      </div>

      <div class="task-content-body" data-action="open-detail" data-id="${it.id}">
        <div class="task-title-line">
          <span class="prio-dot prio-${escapeHtml(it.priority || 'medium')}" title="${escapeHtml(priorityObj.label)}"></span>
          <span class="task-title-text ${it.done ? 'done' : ''}">${escapeHtml(it.title)}</span>
          ${statusBadge}
          ${completedBadge}
        </div>
        <div class="task-meta-pills">
          ${projBadge}
          ${scheduleBadge}
          ${repeatBadge}
          ${tmplBadge}
          ${tagsHtml}
        </div>
        ${notePreview}
        ${subtasksProgress}
      </div>

      <div class="task-right-actions">
        ${chatBtn}
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
  if (state.navMode === 'smart' && state.smartView === 'archived') {
    if (t) t.textContent = '暂无已归档事项';
    if (s) s.textContent = '打勾完成的事项会自动归档保存在这里';
    return;
  }
  if (state.search) {
    if (t) t.textContent = '无匹配搜索结果';
    if (s) s.textContent = '换个关键词试试，或切换左侧筛选条件';
    return;
  }
  if (state.navMode === 'smart' && state.smartView === 'today') {
    if (t) t.textContent = '今天暂无待处理事项';
    if (s) s.textContent = '把事项截止日期设为今天，或点击右下角 + 安排今日待办';
    return;
  }
  if (t) t.textContent = '暂无待办事项';
  if (s) s.textContent = '点击右下角 + 添加，或打开 AI 多会话中心帮你规划';
}

let sortableInstance = null;
function initSortable(wrap) {
  if (!wrap || typeof Sortable === 'undefined') return;
  if (sortableInstance) {
    sortableInstance.destroy();
    sortableInstance = null;
  }

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
