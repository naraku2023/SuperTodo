/**
 * 任务详情工作台模块 (Task Detail Sheet)
 * 1. 顶部双 Tab：📋 安排与清单 | 💬 专属会话
 * 2. 行内快捷排期与属性控制面板（项目、状态、优先级、起止日期时段、耗时、重复、标签）
 * 3. 分类专属结构化工作区（购物明细表 / 旅游按天行程 / 心愿储蓄进度 / 计划目标验收）
 * 4. 阶段与子步骤深度管理（新建/改名/删阶段、单步展开编辑排期耗时备注、阶段内拖拽排序）
 * 5. 内置独立会话视图 (ChatSessionView)，支持 AI 一键同步并实时刷新左侧清单
 */

import {
  state,
  saveState,
  emit,
  getProjectById,
  getTaskTemplate,
  ensureTag
} from '../state.js';
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  REPEAT_OPTIONS
} from '../config.js';
import {
  calculateProgress,
  calculateShoppingStats,
  createSubtask,
  createNextRepeatTask,
  groupSubtasksByStage,
  generateId
} from '../models.js';
import {
  openEdit,
  pushLayer,
  syncBack,
  confirmDlg,
  inputDlg,
  showToast
} from './modals.js';
import { escapeHtml, fmtDue } from './list.js';
import { ChatSessionView } from './chat-panel.js';
import { agent } from '../ai/agent.js';

let currentTask = null;
let activeTab = 'plan'; // 'plan' | 'chat'
let isEditingNote = false;
let expandedSubtaskId = null;
let detailChatView = null;
const stepSortableMap = new Map();

const $ = s => document.querySelector(s);

export function openDetail(task, initialTab = 'plan') {
  if (!task) return;
  currentTask = task;
  activeTab = initialTab === 'chat' ? 'chat' : 'plan';
  isEditingNote = false;
  expandedSubtaskId = null;

  pushLayer();
  ensureDetailChatView();
  renderDetailContent();
  switchDetailTab(activeTab);

  const mask = $('#detailMask');
  const sheet = $('#detailSheet');
  if (mask) mask.hidden = false;
  if (sheet) sheet.hidden = false;
}

export function closeDetail(suppressSync = false) {
  saveCurrentInputs();
  destroyStepSortables();
  const mask = $('#detailMask');
  const sheet = $('#detailSheet');
  if (mask) mask.hidden = true;
  if (sheet) sheet.hidden = true;
  currentTask = null;
  isEditingNote = false;
  expandedSubtaskId = null;
  if (!suppressSync) syncBack();
}

window.closeDetailSheet = (suppress = false) => closeDetail(suppress);

function destroyStepSortables() {
  stepSortableMap.forEach(inst => {
    try { inst.destroy(); } catch (e) {}
  });
  stepSortableMap.clear();
}

function renderDetailChatMetrics(stats = null) {
  const row = $('#dcpMetricsRow');
  const pinBtn = $('#dcpPinBtn');
  if (!currentTask) return;
  const s = stats || agent.getSessionStats(currentTask);
  if (pinBtn) {
    pinBtn.classList.toggle('is-pinned', s.pinned);
    pinBtn.title = s.pinned ? '取消置顶' : '置顶会话';
  }
  if (row) {
    const cacheBadge = s.cacheHitRate !== null
      ? ` <span class="ctx-cache-badge">缓存 ${s.cacheHitRate}%</span>`
      : '';
    const cmpBadge = s.compactionCount > 0 ? ` · 已压缩 ${s.compactionCount} 次` : '';
    row.innerHTML = `活跃上下文 ${s.activeMessages} 条 (~${s.activeTokens} tok)${cmpBadge}${cacheBadge}`;
  }
}

function ensureDetailChatView() {
  if (detailChatView) return;
  detailChatView = new ChatSessionView({
    messagesEl: $('#detailChatMessages'),
    quickTagsEl: $('#detailChatQuickTags'),
    inputEl: $('#detailChatInput'),
    sendBtnEl: $('#detailChatSendBtn'),
    scrollEl: $('#detailChatScroll'),
    onTaskApplied: () => {
      renderDetailContent();
      showToast('已同步 AI 方案到事项安排');
    },
    onOpenTaskSession: (task) => {
      if (task) {
        currentTask = task;
        renderDetailContent();
        switchDetailTab('chat');
      }
    },
    onStatsChanged: (stats) => {
      renderDetailChatMetrics(stats);
    }
  });
}

function switchDetailTab(tabName) {
  activeTab = tabName === 'chat' ? 'chat' : 'plan';
  const planPane = $('#detailPlanPane');
  const chatPane = $('#detailChatPane');
  if (planPane) planPane.hidden = activeTab !== 'plan';
  if (chatPane) chatPane.hidden = activeTab !== 'chat';

  document.querySelectorAll('#detailTabs .detail-tab').forEach(btn => {
    btn.classList.toggle('on', btn.dataset.tab === activeTab);
  });

  if (activeTab === 'chat' && currentTask) {
    ensureDetailChatView();
    detailChatView.setTask(currentTask);
    renderDetailChatMetrics();
    const lbl = $('#dcpLabel');
    if (lbl) lbl.textContent = `「${currentTask.title}」专属独立会话`;
    setTimeout(() => $('#detailChatInput')?.focus(), 140);
  }
}

function saveCurrentInputs() {
  if (!currentTask) return;
  const titleInput = $('#detailTitleInput');
  const noteArea = $('#detailNoteTextarea');
  let changed = false;

  if (titleInput && titleInput.value.trim() && titleInput.value.trim() !== currentTask.title) {
    currentTask.title = titleInput.value.trim();
    changed = true;
  }
  if (isEditingNote && noteArea && noteArea.value !== (currentTask.note || '')) {
    currentTask.note = noteArea.value;
    changed = true;
  }
  if (changed) {
    currentTask.updated = Date.now();
    saveState();
    emit('items-changed', state.items);
  }
}

export function renderDetailContent() {
  if (!currentTask) return;
  const t = currentTask;

  // 1. 专属会话消息角标与文案
  const chatCnt = Array.isArray(t.chatHistory) ? t.chatHistory.length : 0;
  const chatBadge = $('#detailChatBadge');
  if (chatBadge) {
    chatBadge.hidden = chatCnt === 0;
    chatBadge.textContent = String(chatCnt);
  }
  const copilotDesc = $('#detailCopilotDesc');
  if (copilotDesc) {
    copilotDesc.textContent = chatCnt > 0
      ? `已有 ${chatCnt} 条专属对话记忆 · 点击继续针对此事项深度规划`
      : '独立保存此事项的对话上下文，支持细化阶段排期与生成专属清单';
  }

  // 2. 主任务完成状态与标题
  const chkCircle = $('#detailMainChkCircle');
  const priorityObj = TASK_PRIORITIES.find(p => p.id === (t.priority || 'medium')) || TASK_PRIORITIES[2];
  if (chkCircle) {
    chkCircle.classList.toggle('checked', Boolean(t.done));
    chkCircle.style.setProperty('--prio-color', priorityObj.color);
  }

  const titleInput = $('#detailTitleInput');
  if (titleInput) {
    titleInput.value = t.title || '';
    titleInput.classList.toggle('done', Boolean(t.done));
  }

  // 3. 行内快捷排期与属性面板
  renderSchedulePanel(t);

  // 4. 分类专属结构化工作区
  renderTemplateWorkspace(t);

  // 5. 阶段与子步骤
  renderDetailSubtasks();

  // 6. 执行指南
  renderGuideSection();

  // 7. 底部创建与完成时间
  const createTimeEl = $('#detailCreateTime');
  if (createTimeEl && t.created) {
    const d = new Date(t.created);
    let txt = `创建于 ${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (t.done) {
      const cd = new Date(t.completedAt || t.updated || t.created);
      txt += ` · ✓ 完成于 ${cd.getFullYear()}/${cd.getMonth() + 1}/${cd.getDate()} ${String(cd.getHours()).padStart(2, '0')}:${String(cd.getMinutes()).padStart(2, '0')}`;
    }
    createTimeEl.textContent = txt;
  }

  // 如果当前正好停留在专属会话 Tab，刷新其角标文案
  if (activeTab === 'chat' && detailChatView) {
    const lbl = $('#dcpLabel');
    if (lbl) lbl.textContent = `「${t.title}」专属独立会话`;
  }
}

/**
 * 渲染行内快捷排期与分类控制面板
 */
function renderSchedulePanel(t) {
  const panel = $('#detailSchedulePanel');
  if (!panel) return;

  const projOpts = `<option value="">📥 收集箱</option>` +
    state.projects.map(p => `<option value="${escapeHtml(p.id)}" ${t.projectId === p.id ? 'selected' : ''}>${p.icon} ${escapeHtml(p.name)}</option>`).join('');

  const statusOpts = TASK_STATUSES.filter(s => s.id !== 'done' || t.done).map(s =>
    `<option value="${s.id}" ${(t.status || 'todo') === s.id ? 'selected' : ''}>${s.icon} ${s.label}</option>`
  ).join('');

  const prioOpts = TASK_PRIORITIES.map(p =>
    `<option value="${p.id}" ${(t.priority || 'medium') === p.id ? 'selected' : ''}>${p.label}</option>`
  ).join('');

  const repOpts = REPEAT_OPTIONS.map(r =>
    `<option value="${r.id}" ${(t.repeat || 'none') === r.id ? 'selected' : ''}>${r.label}</option>`
  ).join('');

  const tagsHtml = (t.tags || []).map(tag => `
    <span class="detail-tag-pill">#${escapeHtml(tag)} <button type="button" class="tag-rm-btn" data-rm-tag="${escapeHtml(tag)}">✕</button></span>
  `).join('');

  panel.innerHTML = `
    <div class="dsp-grid">
      <label class="dsp-cell">
        <span class="dsp-lbl">项目空间</span>
        <select id="dspProject" class="dsp-ctrl">${projOpts}</select>
      </label>
      <label class="dsp-cell">
        <span class="dsp-lbl">执行状态</span>
        <select id="dspStatus" class="dsp-ctrl" ${t.done ? 'disabled' : ''}>${statusOpts}</select>
      </label>
      <label class="dsp-cell">
        <span class="dsp-lbl">优先级</span>
        <select id="dspPriority" class="dsp-ctrl">${prioOpts}</select>
      </label>
      <label class="dsp-cell">
        <span class="dsp-lbl">重复周期</span>
        <select id="dspRepeat" class="dsp-ctrl">${repOpts}</select>
      </label>
      <label class="dsp-cell">
        <span class="dsp-lbl">开始日期</span>
        <input type="date" id="dspStartDate" class="dsp-ctrl" value="${escapeHtml(t.startDate || '')}">
      </label>
      <label class="dsp-cell">
        <span class="dsp-lbl">截止日期</span>
        <input type="date" id="dspDue" class="dsp-ctrl" value="${escapeHtml(t.due || '')}">
      </label>
      <label class="dsp-cell">
        <span class="dsp-lbl">时段 (${escapeHtml(t.startTime || '--:--')}~${escapeHtml(t.endTime || '--:--')})</span>
        <div class="dsp-time-pair">
          <input type="time" id="dspStartTime" class="dsp-ctrl" value="${escapeHtml(t.startTime || '')}">
          <input type="time" id="dspEndTime" class="dsp-ctrl" value="${escapeHtml(t.endTime || '')}">
        </div>
      </label>
      <label class="dsp-cell">
        <span class="dsp-lbl">预计耗时(分钟)</span>
        <input type="number" id="dspDuration" class="dsp-ctrl" min="1" step="5" placeholder="未设" value="${t.durationMin || ''}">
      </label>
    </div>
    <div class="dsp-tags-row">
      <span class="dsp-lbl">标签：</span>
      <div class="dsp-tags-list">
        ${tagsHtml}
        <button type="button" class="dsp-add-tag-btn" id="dspAddTagBtn">+ 标签</button>
      </div>
    </div>
  `;

  // 绑定行内即时保存
  $('#dspProject').onchange = (e) => {
    const pid = e.target.value;
    const p = getProjectById(pid);
    t.projectId = pid;
    t.type = p ? p.name : '收集箱';
    if (!t.template || state.projects.some(x => x.template === t.template)) {
      t.template = p ? p.template : 'general';
    }
    t.updated = Date.now();
    saveState();
    renderDetailContent();
    emit('items-changed', state.items);
  };

  $('#dspStatus').onchange = (e) => {
    t.status = e.target.value;
    t.updated = Date.now();
    saveState();
    emit('items-changed', state.items);
  };

  $('#dspPriority').onchange = (e) => {
    t.priority = e.target.value;
    t.updated = Date.now();
    saveState();
    renderDetailContent();
    emit('items-changed', state.items);
  };

  $('#dspRepeat').onchange = (e) => {
    t.repeat = e.target.value;
    t.updated = Date.now();
    saveState();
    emit('items-changed', state.items);
  };

  $('#dspStartDate').onchange = (e) => {
    t.startDate = e.target.value;
    t.updated = Date.now();
    saveState();
    emit('items-changed', state.items);
  };

  $('#dspDue').onchange = (e) => {
    t.due = e.target.value;
    t.updated = Date.now();
    saveState();
    emit('items-changed', state.items);
  };

  $('#dspStartTime').onchange = (e) => {
    t.startTime = e.target.value;
    t.updated = Date.now();
    saveState();
    emit('items-changed', state.items);
  };

  $('#dspEndTime').onchange = (e) => {
    t.endTime = e.target.value;
    t.updated = Date.now();
    saveState();
    emit('items-changed', state.items);
  };

  $('#dspDuration').onchange = (e) => {
    const v = parseInt(e.target.value, 10);
    t.durationMin = (!isNaN(v) && v > 0) ? v : null;
    t.updated = Date.now();
    saveState();
    emit('items-changed', state.items);
  };

  panel.querySelectorAll('.tag-rm-btn').forEach(btn => {
    btn.onclick = () => {
      const rm = btn.dataset.rmTag;
      t.tags = (t.tags || []).filter(x => x !== rm);
      t.updated = Date.now();
      saveState();
      renderDetailContent();
      emit('items-changed', state.items);
    };
  });

  $('#dspAddTagBtn').onclick = () => {
    inputDlg('添加标签', `现有标签：${state.tags.join('、')}`, '', (val) => {
      if (!val) return;
      ensureTag(val);
      if (!Array.isArray(t.tags)) t.tags = [];
      if (!t.tags.includes(val)) t.tags.push(val);
      t.updated = Date.now();
      saveState();
      renderDetailContent();
      emit('items-changed', state.items);
    });
  };
}

/**
 * 渲染分类专属结构化工作区（购物 / 旅游 / 愿望 / 计划）
 */
function renderTemplateWorkspace(t) {
  const wrap = $('#detailTemplateWorkspace');
  if (!wrap) return;

  const tmpl = getTaskTemplate(t);
  if (tmpl === 'general') {
    wrap.innerHTML = '';
    return;
  }

  if (tmpl === 'shopping') {
    const items = t.extra.shoppingItems || [];
    const stats = calculateShoppingStats(t.extra);
    const budget = t.cost || stats.totalAmount || 0;
    const pct = budget > 0 ? Math.min(100, Math.round((stats.boughtAmount / budget) * 100)) : 0;

    wrap.innerHTML = `
      <div class="detail-card-section tmpl-ws tmpl-shopping">
        <div class="detail-sec-header">
          <span class="detail-sec-title">🛒 采购明细与预算控制</span>
          <span class="detail-sec-badge">已购 ${stats.boughtCount}/${stats.totalCount} · 已花 ¥${stats.boughtAmount} / 预算 ¥${budget}</span>
        </div>
        <div class="detail-progress-bar-wrap"><div class="detail-progress-bar" style="width:${pct}%"></div></div>
        <div class="shop-items-list">
          ${items.length === 0 ? '<div class="detail-subtasks-empty">暂无采购明细，可在下方添加商品名、数量与单价</div>' : items.map(si => `
            <div class="shop-row ${si.bought ? 'is-bought' : ''}" data-shop-id="${si.id}">
              <label class="step-chk-label">
                <input type="checkbox" class="step-real-chk shop-chk" ${si.bought ? 'checked' : ''}>
                <span class="step-chk-box"></span>
              </label>
              <div class="shop-main">
                <span class="shop-name">${escapeHtml(si.name)}</span>
                <span class="shop-meta">x${si.qty}${escapeHtml(si.unit || '')} · 单价 ¥${si.price}${si.store ? ` · ${escapeHtml(si.store)}` : ''}</span>
              </div>
              <span class="shop-subtotal">¥${Math.round(si.qty * si.price * 100) / 100}</span>
              <button type="button" class="step-del-btn" data-del-shop="${si.id}">✕</button>
            </div>
          `).join('')}
        </div>
        <div class="ws-add-grid shop-add-grid">
          <input type="text" id="shopAddName" class="ws-input" placeholder="物品名称">
          <input type="number" id="shopAddQty" class="ws-input sm" placeholder="数量" value="1" min="1">
          <input type="number" id="shopAddPrice" class="ws-input sm" placeholder="单价¥" min="0" step="any">
          <input type="text" id="shopAddStore" class="ws-input sm" placeholder="渠道/店铺">
          <button type="button" id="shopAddBtn" class="detail-add-step-btn">添加</button>
        </div>
      </div>
    `;

    wrap.querySelectorAll('.shop-chk').forEach(chk => {
      chk.onchange = () => {
        const sid = chk.closest('.shop-row').dataset.shopId;
        const item = t.extra.shoppingItems.find(x => x.id === sid);
        if (item) {
          item.bought = chk.checked;
          saveState();
          renderTemplateWorkspace(t);
          emit('items-changed', state.items);
        }
      };
    });
    wrap.querySelectorAll('[data-del-shop]').forEach(btn => {
      btn.onclick = () => {
        const sid = btn.dataset.delShop;
        t.extra.shoppingItems = t.extra.shoppingItems.filter(x => x.id !== sid);
        saveState();
        renderTemplateWorkspace(t);
        emit('items-changed', state.items);
      };
    });
    $('#shopAddBtn').onclick = () => {
      const name = $('#shopAddName').value.trim();
      if (!name) return;
      const qty = Math.max(1, Number($('#shopAddQty').value) || 1);
      const price = Math.max(0, Number($('#shopAddPrice').value) || 0);
      const store = $('#shopAddStore').value.trim();
      t.extra.shoppingItems.push({ id: generateId('shop'), name, qty, unit: '', price, store, bought: false });
      const newStats = calculateShoppingStats(t.extra);
      if (!t.cost || t.cost < newStats.totalAmount) t.cost = newStats.totalAmount;
      saveState();
      renderTemplateWorkspace(t);
      emit('items-changed', state.items);
    };
    return;
  }

  if (tmpl === 'travel') {
    const tp = t.extra.travelPlan;
    wrap.innerHTML = `
      <div class="detail-card-section tmpl-ws tmpl-travel">
        <div class="detail-sec-header">
          <span class="detail-sec-title">✈️ 行程与出行安排</span>
          <span class="detail-sec-badge">${tp.itinerary.length} 站安排</span>
        </div>
        <div class="travel-meta-grid">
          <label class="dsp-cell"><span class="dsp-lbl">目的地</span><input type="text" id="tpDest" class="dsp-ctrl" placeholder="城市/国家" value="${escapeHtml(tp.destination || '')}"></label>
          <label class="dsp-cell"><span class="dsp-lbl">天数</span><input type="number" id="tpDays" class="dsp-ctrl" min="1" placeholder="如 3" value="${tp.days || ''}"></label>
          <label class="dsp-cell"><span class="dsp-lbl">交通</span><input type="text" id="tpTrans" class="dsp-ctrl" placeholder="高铁/航班" value="${escapeHtml(tp.transport || '')}"></label>
          <label class="dsp-cell"><span class="dsp-lbl">住宿</span><input type="text" id="tpHotel" class="dsp-ctrl" placeholder="酒店/区域" value="${escapeHtml(tp.hotel || '')}"></label>
        </div>
        <div class="travel-itin-list">
          ${tp.itinerary.length === 0 ? '<div class="detail-subtasks-empty">暂无按天行程节点，在下方添加或让专属会话 AI 一键生成</div>' : tp.itinerary.map(row => `
            <div class="shop-row ${row.done ? 'is-bought' : ''}" data-itin-id="${row.id}">
              <label class="step-chk-label">
                <input type="checkbox" class="step-real-chk itin-chk" ${row.done ? 'checked' : ''}>
                <span class="step-chk-box"></span>
              </label>
              <div class="shop-main">
                <span class="shop-name">[${escapeHtml(row.day)}${row.timeSlot ? ' · ' + escapeHtml(row.timeSlot) : ''}] ${escapeHtml(row.place)}</span>
                <span class="shop-meta">${escapeHtml(row.activity)}${row.cost ? ` · 预计 ¥${row.cost}` : ''}</span>
              </div>
              <button type="button" class="step-del-btn" data-del-itin="${row.id}">✕</button>
            </div>
          `).join('')}
        </div>
        <div class="ws-add-grid travel-add-grid">
          <input type="text" id="itinDay" class="ws-input sm" placeholder="Day 1" value="Day 1">
          <input type="text" id="itinSlot" class="ws-input sm" placeholder="上午">
          <input type="text" id="itinPlace" class="ws-input" placeholder="地点/景点">
          <input type="text" id="itinAct" class="ws-input" placeholder="具体活动安排">
          <button type="button" id="itinAddBtn" class="detail-add-step-btn">添加</button>
        </div>
      </div>
    `;

    const saveTpMeta = () => {
      tp.destination = $('#tpDest').value.trim();
      const d = parseInt($('#tpDays').value, 10);
      tp.days = (!isNaN(d) && d > 0) ? d : null;
      tp.transport = $('#tpTrans').value.trim();
      tp.hotel = $('#tpHotel').value.trim();
      saveState();
      emit('items-changed', state.items);
    };
    ['#tpDest', '#tpDays', '#tpTrans', '#tpHotel'].forEach(sel => {
      $(sel).onchange = saveTpMeta;
    });
    wrap.querySelectorAll('.itin-chk').forEach(chk => {
      chk.onchange = () => {
        const id = chk.closest('.shop-row').dataset.itinId;
        const row = tp.itinerary.find(x => x.id === id);
        if (row) {
          row.done = chk.checked;
          saveState();
          renderTemplateWorkspace(t);
        }
      };
    });
    wrap.querySelectorAll('[data-del-itin]').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.delItin;
        tp.itinerary = tp.itinerary.filter(x => x.id !== id);
        saveState();
        renderTemplateWorkspace(t);
        emit('items-changed', state.items);
      };
    });
    $('#itinAddBtn').onclick = () => {
      const place = $('#itinPlace').value.trim();
      const activity = $('#itinAct').value.trim();
      if (!place && !activity) return;
      tp.itinerary.push({
        id: generateId('itin'),
        day: $('#itinDay').value.trim() || 'Day 1',
        timeSlot: $('#itinSlot').value.trim(),
        place,
        activity,
        cost: null,
        done: false
      });
      saveState();
      renderTemplateWorkspace(t);
      emit('items-changed', state.items);
    };
    return;
  }

  if (tmpl === 'wish') {
    const wm = t.extra.wishMeta;
    const pct = wm.targetAmount ? Math.min(100, Math.round((wm.savedAmount / wm.targetAmount) * 100)) : 0;
    wrap.innerHTML = `
      <div class="detail-card-section tmpl-ws tmpl-wish">
        <div class="detail-sec-header">
          <span class="detail-sec-title">🌟 心愿达成与储蓄进度</span>
          <span class="detail-sec-badge">${pct}%</span>
        </div>
        <div class="detail-progress-bar-wrap"><div class="detail-progress-bar" style="width:${pct}%"></div></div>
        <div class="travel-meta-grid">
          <label class="dsp-cell"><span class="dsp-lbl">已存金额 ¥</span><input type="number" id="wmSaved" class="dsp-ctrl" min="0" value="${wm.savedAmount || 0}"></label>
          <label class="dsp-cell"><span class="dsp-lbl">目标金额 ¥</span><input type="number" id="wmTarget" class="dsp-ctrl" min="1" placeholder="设定目标" value="${wm.targetAmount || ''}"></label>
        </div>
        <div class="wish-reward-row">
          <input type="text" id="wmReward" class="dsp-ctrl" placeholder="实现条件或自我奖励备注..." value="${escapeHtml(wm.rewardNote || '')}">
          <button type="button" id="wmPlusBtn" class="detail-add-step-btn">+100储蓄</button>
        </div>
      </div>
    `;
    const saveWish = () => {
      wm.savedAmount = Math.max(0, Number($('#wmSaved').value) || 0);
      const tgt = Number($('#wmTarget').value);
      wm.targetAmount = (!isNaN(tgt) && tgt > 0) ? tgt : null;
      wm.rewardNote = $('#wmReward').value.trim();
      saveState();
      renderTemplateWorkspace(t);
      emit('items-changed', state.items);
    };
    ['#wmSaved', '#wmTarget', '#wmReward'].forEach(sel => { $(sel).onchange = saveWish; });
    $('#wmPlusBtn').onclick = () => {
      wm.savedAmount = (wm.savedAmount || 0) + 100;
      saveState();
      renderTemplateWorkspace(t);
      emit('items-changed', state.items);
    };
    return;
  }

  if (tmpl === 'plan') {
    const pm = t.extra.planMeta;
    wrap.innerHTML = `
      <div class="detail-card-section tmpl-ws tmpl-plan">
        <div class="detail-sec-header">
          <span class="detail-sec-title">🎯 计划里程碑与验收标准</span>
        </div>
        <label class="dsp-cell">
          <span class="dsp-lbl">达标量化验收指标</span>
          <input type="text" id="pmMetric" class="dsp-ctrl" placeholder="例如：连续3次模考 ≥ 95分 / 完成5篇复盘笔记" value="${escapeHtml(pm.goalMetric || '')}">
        </label>
      </div>
    `;
    $('#pmMetric').onchange = (e) => {
      pm.goalMetric = e.target.value.trim();
      saveState();
      emit('items-changed', state.items);
    };
  }
}

/**
 * 渲染阶段与子步骤（支持显式阶段管理、单步编辑展开与拖拽调序）
 */
function renderDetailSubtasks() {
  if (!currentTask) return;
  destroyStepSortables();

  const listEl = $('#detailSubtasksList');
  const badgeEl = $('#detailStepsBadge');
  const barEl = $('#detailProgressBar');
  const stageSelect = $('#detailStepStageSelect');
  if (!listEl) return;

  const subtasks = currentTask.subtasks || [];
  const { total, completed, percent } = calculateProgress(subtasks);

  if (badgeEl) {
    badgeEl.textContent = total > 0 ? `${completed}/${total} 步 (${percent}%)` : '无步骤';
  }
  if (barEl) barEl.style.width = `${percent}%`;

  const stageGroups = groupSubtasksByStage(subtasks, currentTask.stages);
  const allStageNames = Array.from(new Set(
    (currentTask.stages || []).map(s => s.name).concat(subtasks.map(s => s.stage).filter(Boolean))
  ));

  if (stageSelect) {
    const prevVal = stageSelect.value;
    stageSelect.innerHTML = `<option value="">不分阶段</option>` +
      allStageNames.map(st => `<option value="${escapeHtml(st)}">${escapeHtml(st)}</option>`).join('');
    if (allStageNames.includes(prevVal)) stageSelect.value = prevVal;
    else if (allStageNames.length > 0 && !prevVal) stageSelect.value = allStageNames[allStageNames.length - 1];
  }

  if (stageGroups.length === 0) {
    listEl.innerHTML = `<div class="detail-subtasks-empty">暂无阶段与步骤，可点击右上角「+ 新建阶段」或在下方添加执行动作。</div>`;
    return;
  }

  const hasStages = stageGroups.some(g => Boolean(g.stage));
  let html = '';

  if (hasStages) {
    stageGroups.forEach((group, gIdx) => {
      const stageName = group.stage || '其他步骤';
      const isStageDone = group.total > 0 && group.completed === group.total;
      const isExplicitOther = !group.stage;

      html += `
        <div class="detail-stage-block ${isStageDone ? 'stage-all-done' : ''}" data-stage-name="${escapeHtml(group.stage)}">
          <div class="stage-header">
            <span class="stage-icon">📌</span>
            <span class="stage-name">${escapeHtml(stageName)}</span>
            <span class="stage-badge">${group.completed}/${group.total}</span>
            ${!isExplicitOther ? `
              <button type="button" class="stage-op-btn" data-ren-stage="${escapeHtml(group.stage)}" title="重命名阶段">✎</button>
              <button type="button" class="stage-op-btn danger" data-del-stage="${escapeHtml(group.stage)}" title="删除阶段">✕</button>
            ` : ''}
            <div class="stage-bar-wrap"><div class="stage-bar-fill" style="width:${group.percent}%"></div></div>
          </div>
          <div class="stage-step-items sortable-steps" data-stage-list="${escapeHtml(group.stage)}" id="stageList_${gIdx}">
            ${group.items.length === 0
              ? '<div class="stage-empty-tip">此阶段暂无步骤，可在下方选择该阶段并添加</div>'
              : group.items.map(st => renderStepRowHtml(st, allStageNames)).join('')}
          </div>
        </div>
      `;
    });
  } else {
    html = `<div class="detail-flat-steps sortable-steps" id="flatStepList">${subtasks.map(st => renderStepRowHtml(st, allStageNames)).join('')}</div>`;
  }

  listEl.innerHTML = html;

  // 绑定阶段重命名 / 删除
  listEl.querySelectorAll('[data-ren-stage]').forEach(btn => {
    btn.onclick = () => {
      const oldName = btn.dataset.renStage;
      inputDlg('重命名阶段', '输入新的阶段名称', oldName, (newName) => {
        if (!newName || newName === oldName) return;
        (currentTask.stages || []).forEach(s => { if (s.name === oldName) s.name = newName; });
        (currentTask.subtasks || []).forEach(s => { if (s.stage === oldName) s.stage = newName; });
        saveState();
        renderDetailSubtasks();
        emit('items-changed', state.items);
      });
    };
  });

  listEl.querySelectorAll('[data-del-stage]').forEach(btn => {
    btn.onclick = () => {
      const stName = btn.dataset.delStage;
      confirmDlg('删除阶段', `确定移除阶段「${stName}」吗？（其下步骤将保留并移至其他步骤）`, () => {
        currentTask.stages = (currentTask.stages || []).filter(s => s.name !== stName);
        (currentTask.subtasks || []).forEach(s => { if (s.stage === stName) s.stage = ''; });
        saveState();
        renderDetailSubtasks();
        emit('items-changed', state.items);
      }, '移除', 'delete');
    };
  });

  // 初始化阶段内步骤拖拽排序
  if (typeof Sortable !== 'undefined') {
    listEl.querySelectorAll('.sortable-steps').forEach((container, idx) => {
      const inst = new Sortable(container, {
        handle: '.step-drag-handle',
        animation: 150,
        ghostClass: 'sortable-ghost',
        onEnd: () => {
          // 按页面最新 DOM 顺序重排 currentTask.subtasks
          const orderedIds = Array.from(listEl.querySelectorAll('.detail-step-row')).map(el => el.dataset.subId);
          const map = new Map(currentTask.subtasks.map(s => [s.id, s]));
          const reordered = orderedIds.map(id => map.get(id)).filter(Boolean);
          if (reordered.length === currentTask.subtasks.length) {
            currentTask.subtasks = reordered;
            saveState();
            emit('items-changed', state.items);
          }
        }
      });
      stepSortableMap.set(`s_${idx}`, inst);
    });
  }
}

function renderStepRowHtml(st, allStageNames) {
  const isExpanded = expandedSubtaskId === st.id;
  const metaParts = [];
  if (st.due) metaParts.push(`📅 ${fmtDue(st.due)}`);
  if (st.durationMin) metaParts.push(`⏱ ${st.durationMin}m`);
  if (st.note) metaParts.push(`📝 ${st.note}`);

  return `
    <div class="detail-step-wrap ${isExpanded ? 'is-expanded' : ''}" data-sub-wrap="${st.id}">
      <div class="detail-step-row ${st.done ? 'is-done' : ''}" data-sub-id="${st.id}">
        <span class="step-drag-handle" title="拖拽调整顺序">⋮⋮</span>
        <label class="step-chk-label">
          <input type="checkbox" class="step-real-chk" ${st.done ? 'checked' : ''}>
          <span class="step-chk-box"></span>
        </label>
        <div class="step-main-col" data-expand-sub="${st.id}">
          <span class="step-title-text ${st.done ? 'done' : ''}">${escapeHtml(st.title)}</span>
          ${metaParts.length ? `<div class="step-submeta">${escapeHtml(metaParts.join(' · '))}</div>` : ''}
        </div>
        <button type="button" class="step-edit-btn" data-expand-sub="${st.id}" title="编辑排期/备注">✎</button>
        <button type="button" class="step-del-btn" data-del-sub="${st.id}" title="删除步骤">✕</button>
      </div>
      ${isExpanded ? `
        <div class="step-inline-editor" data-editor-sub="${st.id}">
          <input type="text" class="sie-title" value="${escapeHtml(st.title)}" placeholder="步骤标题">
          <div class="sie-grid">
            <select class="sie-stage">
              <option value="">不分阶段</option>
              ${allStageNames.map(n => `<option value="${escapeHtml(n)}" ${st.stage === n ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}
            </select>
            <input type="date" class="sie-due" value="${escapeHtml(st.due || '')}" title="单步截止日期">
            <input type="number" class="sie-dur" value="${st.durationMin || ''}" placeholder="耗时(分)" min="1" step="5">
          </div>
          <input type="text" class="sie-note" value="${escapeHtml(st.note || '')}" placeholder="步骤备注/交付物要求...">
          <div class="sie-actions">
            <button type="button" class="btn-filled-sm sie-save">保存步骤</button>
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

/**
 * 渲染执行指南
 */
function renderGuideSection() {
  const readEl = $('#detailGuideRead');
  const editEl = $('#detailGuideEdit');
  const textarea = $('#detailNoteTextarea');
  const editBtn = $('#detailEditNoteBtn');
  if (!readEl || !editEl) return;

  const note = (currentTask && currentTask.note) ? currentTask.note.trim() : '';

  if (isEditingNote) {
    readEl.hidden = true;
    editEl.hidden = false;
    if (textarea) textarea.value = note;
    if (editBtn) editBtn.hidden = true;
  } else {
    readEl.hidden = false;
    editEl.hidden = true;
    if (editBtn) editBtn.hidden = false;

    if (!note) {
      readEl.innerHTML = `
        <div class="guide-empty-hint" id="guideEmptyPrompt">
          暂无详细指南与备注。点击右上角 <b>✎ 编辑内容</b>，或在「专属会话」让 AI 生成落地指南...
        </div>
      `;
    } else {
      readEl.innerHTML = formatGuideMarkdown(note);
    }
  }
}

function formatGuideMarkdown(text) {
  const lines = text.split('\n');
  let html = '<div class="guide-content-flow">';
  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) {
      html += '<div class="guide-gap"></div>';
      return;
    }
    if (trimmed.startsWith('【') && trimmed.includes('】')) {
      html += `<div class="guide-section-badge">${escapeHtml(trimmed)}</div>`;
    } else if (/^(\d+[\.\、]|[-*•])\s+/.test(trimmed)) {
      const clean = trimmed.replace(/^(\d+[\.\、]|[-*•])\s+/, '');
      html += `<div class="guide-list-item"><span class="guide-bullet"></span><span class="guide-item-text">${highlightKeyTerms(escapeHtml(clean))}</span></div>`;
    } else {
      html += `<p class="guide-paragraph">${highlightKeyTerms(escapeHtml(trimmed))}</p>`;
    }
  });
  html += '</div>';
  return html;
}

function highlightKeyTerms(str) {
  return str
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/([0-9]+(?:\.[0-9]+)?(?:[分题天周个次元小时分钟套道章%]+))/g, '<span class="guide-highlight">$1</span>');
}

function onReady(fn) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fn);
  } else {
    fn();
  }
}

onReady(() => {
  initDetailEvents();
});

export function initDetailEvents() {
  $('#detailClose')?.addEventListener('click', () => closeDetail());
  $('#detailDoneBtn')?.addEventListener('click', () => closeDetail());
  $('#detailMask')?.addEventListener('click', () => closeDetail());

  // 顶部双 Tab 切换
  $('#detailTabs')?.addEventListener('click', (e) => {
    const tab = e.target.closest('.detail-tab');
    if (!tab) return;
    saveCurrentInputs();
    switchDetailTab(tab.dataset.tab);
  });

  // 快捷入口卡片切换到专属会话 Tab
  $('#detailOpenAiBtn')?.addEventListener('click', () => {
    saveCurrentInputs();
    switchDetailTab('chat');
  });

  // 专属会话 Tab 顶部按钮：置顶 / 压缩 / 导出 / 在会话中心打开 / 清空
  $('#dcpPinBtn')?.addEventListener('click', () => {
    if (!currentTask) return;
    const pinned = agent.toggleSessionPin(currentTask);
    renderDetailChatMetrics();
    showToast(pinned ? '已置顶该事项会话' : '已取消置顶');
  });
  $('#dcpCompactBtn')?.addEventListener('click', async () => {
    if (!currentTask || !detailChatView) return;
    const res = await detailChatView.runManualCompaction();
    if (res?.compacted) {
      showToast(`已压缩 ${res.checkpoint.compactedCount} 条历史上下文`);
    }
  });
  $('#dcpExportBtn')?.addEventListener('click', () => {
    if (!currentTask) return;
    const md = agent.exportSessionMarkdown(currentTask);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `supertodo-${currentTask.title.replace(/[\\/:*?"<>|]/g, '_')}.md`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('已导出事项会话 Markdown');
  });
  $('#dcpOpenInDrawerBtn')?.addEventListener('click', () => {
    if (!currentTask) return;
    window.openAiChatDrawer?.(currentTask);
  });
  $('#dcpClearChatBtn')?.addEventListener('click', () => {
    if (!currentTask) return;
    confirmDlg('清空专属会话', `确定清空「${currentTask.title}」的专属会话记录及压缩摘要吗？`, () => {
      agent.clearHistory(currentTask);
      detailChatView?.renderMessages();
      renderDetailContent();
    }, '清空', 'delete');
  });

  // 主任务完成打勾（含重复周期自动生成下一期）
  $('#detailMainChkWrap')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!currentTask) return;
    saveCurrentInputs();

    if (!currentTask.done) {
      const hasRepeat = currentTask.repeat && currentTask.repeat !== 'none';
      confirmDlg(
        '标记完成',
        hasRepeat
          ? `确定将“${currentTask.title}”标记完成吗？完成后将自动为你生成下一周期的重复事项。`
          : `确定将“${currentTask.title}”标记为已完成并移入已归档吗？`,
        () => {
          currentTask.done = true;
          currentTask.status = 'done';
          currentTask.completedAt = Date.now();
          if (hasRepeat) {
            const nextTask = createNextRepeatTask(currentTask);
            nextTask.order = -Date.now();
            state.items.unshift(nextTask);
          }
          saveState();
          renderDetailContent();
          emit('items-changed', state.items);
          showToast(hasRepeat ? '已完成当前周期，并已生成下一期安排' : '已完成并移至“已归档”');
        },
        '确认完成'
      );
    } else {
      confirmDlg(
        '恢复待办',
        `确定将“${currentTask.title}”从已归档恢复为进行中的待办吗？`,
        () => {
          currentTask.done = false;
          currentTask.status = 'todo';
          currentTask.completedAt = null;
          saveState();
          renderDetailContent();
          emit('items-changed', state.items);
          showToast('已恢复至待办清单');
        },
        '确认恢复'
      );
    }
  });

  // 删除任务（使用 App 内置 confirmDlg）
  $('#detailDelete')?.addEventListener('click', () => {
    if (!currentTask) return;
    confirmDlg('删除事项', `确定删除“${currentTask.title}”及其专属会话记录吗？`, () => {
      state.items = state.items.filter(x => x.id !== currentTask.id);
      saveState();
      closeDetail();
      emit('items-changed', state.items);
      showToast('已删除事项');
    }, '删除', 'delete');
  });

  // 编辑全属性弹窗
  $('#detailEdit')?.addEventListener('click', () => {
    if (!currentTask) return;
    const it = currentTask;
    closeDetail();
    openEdit(it);
  });

  // 新建阶段
  $('#detailAddStageBtn')?.addEventListener('click', () => {
    if (!currentTask) return;
    inputDlg('新建阶段', '输入阶段名称（如：阶段一·基础准备、行前物资）', '', (val) => {
      if (!val) return;
      if (!Array.isArray(currentTask.stages)) currentTask.stages = [];
      if (!currentTask.stages.some(s => s.name === val)) {
        currentTask.stages.push({ name: val, targetDate: '', desc: '' });
      }
      saveState();
      renderDetailSubtasks();
      emit('items-changed', state.items);
    });
  });

  // 步骤列表事件委托：删除 / 展开行内编辑 / 保存行内编辑 / 勾选
  $('#detailSubtasksList')?.addEventListener('click', (e) => {
    if (!currentTask || !currentTask.subtasks) return;
    if (e.target.closest('.step-drag-handle')) return;

    // 保存行内编辑
    const saveBtn = e.target.closest('.sie-save');
    if (saveBtn) {
      const editor = saveBtn.closest('.step-inline-editor');
      const subId = editor.dataset.editorSub;
      const sub = currentTask.subtasks.find(s => s.id === subId);
      if (sub) {
        const title = editor.querySelector('.sie-title').value.trim();
        if (title) sub.title = title;
        sub.stage = editor.querySelector('.sie-stage').value;
        sub.due = editor.querySelector('.sie-due').value;
        const dur = parseInt(editor.querySelector('.sie-dur').value, 10);
        sub.durationMin = (!isNaN(dur) && dur > 0) ? dur : null;
        sub.note = editor.querySelector('.sie-note').value.trim();
        expandedSubtaskId = null;
        saveState();
        renderDetailSubtasks();
        emit('items-changed', state.items);
      }
      return;
    }

    // 在行内编辑器内点击不触发勾选
    if (e.target.closest('.step-inline-editor')) return;

    // 展开/收起编辑面板
    const expandBtn = e.target.closest('[data-expand-sub]');
    if (expandBtn) {
      e.stopPropagation();
      const subId = expandBtn.dataset.expandSub;
      expandedSubtaskId = (expandedSubtaskId === subId) ? null : subId;
      renderDetailSubtasks();
      return;
    }

    // 删除步骤
    const delBtn = e.target.closest('[data-del-sub]');
    if (delBtn) {
      e.stopPropagation();
      const subId = delBtn.dataset.delSub;
      currentTask.subtasks = currentTask.subtasks.filter(s => s.id !== subId);
      if (expandedSubtaskId === subId) expandedSubtaskId = null;
      saveState();
      renderDetailSubtasks();
      emit('items-changed', state.items);
      return;
    }

    // 勾选步骤完成状态
    const chkWrap = e.target.closest('.step-chk-label');
    const row = e.target.closest('.detail-step-row');
    if (chkWrap && row) {
      e.preventDefault();
      const subId = row.dataset.subId;
      const sub = currentTask.subtasks.find(s => s.id === subId);
      if (!sub) return;
      sub.done = !sub.done;

      const { total, completed } = calculateProgress(currentTask.subtasks);
      if (total > 0 && completed === total && !currentTask.done) {
        saveState();
        renderDetailContent();
        emit('items-changed', state.items);
        confirmDlg(
          '全部步骤已达成',
          `“${currentTask.title}”的所有步骤已完成，是否将整个事项标记完成并归档？`,
          () => {
            currentTask.done = true;
            currentTask.status = 'done';
            currentTask.completedAt = Date.now();
            if (currentTask.repeat && currentTask.repeat !== 'none') {
              const nextTask = createNextRepeatTask(currentTask);
              nextTask.order = -Date.now();
              state.items.unshift(nextTask);
            }
            saveState();
            renderDetailContent();
            emit('items-changed', state.items);
            showToast('已完成并移至“已归档”');
          },
          '完结并归档'
        );
      } else {
        saveState();
        renderDetailContent();
        emit('items-changed', state.items);
      }
    }
  });

  // 添加新步骤（支持选择阶段、单步日期、耗时）
  const addStepAction = () => {
    if (!currentTask) return;
    const input = $('#detailNewStepInput');
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;

    const stageVal = $('#detailStepStageSelect')?.value || '';
    const dueVal = $('#detailStepDueInput')?.value || '';
    const durVal = parseInt($('#detailStepDurInput')?.value || '', 10);

    if (!Array.isArray(currentTask.subtasks)) currentTask.subtasks = [];
    const newSub = createSubtask({
      title: val,
      stage: stageVal,
      due: dueVal,
      durationMin: (!isNaN(durVal) && durVal > 0) ? durVal : null
    });
    if (newSub.stage) {
      if (!Array.isArray(currentTask.stages)) currentTask.stages = [];
      if (!currentTask.stages.some(s => s.name === newSub.stage)) {
        currentTask.stages.push({ name: newSub.stage, targetDate: '', desc: '' });
      }
    }

    currentTask.subtasks.push(newSub);
    input.value = '';
    if ($('#detailStepDueInput')) $('#detailStepDueInput').value = '';
    if ($('#detailStepDurInput')) $('#detailStepDurInput').value = '';

    saveState();
    renderDetailSubtasks();
    emit('items-changed', state.items);
  };

  $('#detailAddStepBtn')?.addEventListener('click', addStepAction);
  $('#detailNewStepInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addStepAction();
    }
  });

  // 指南阅读/编辑切换
  $('#detailEditNoteBtn')?.addEventListener('click', () => {
    isEditingNote = true;
    renderGuideSection();
    setTimeout(() => $('#detailNoteTextarea')?.focus(), 100);
  });
  $('#detailGuideRead')?.addEventListener('click', (e) => {
    if (e.target.closest('#guideEmptyPrompt')) {
      isEditingNote = true;
      renderGuideSection();
      setTimeout(() => $('#detailNoteTextarea')?.focus(), 100);
    }
  });
  $('#detailCancelNoteBtn')?.addEventListener('click', () => {
    isEditingNote = false;
    renderGuideSection();
  });
  $('#detailSaveNoteBtn')?.addEventListener('click', () => {
    if (!currentTask) return;
    const textarea = $('#detailNoteTextarea');
    if (textarea) {
      currentTask.note = textarea.value.trim();
      currentTask.updated = Date.now();
      saveState();
      emit('items-changed', state.items);
    }
    isEditingNote = false;
    renderGuideSection();
  });

  $('#detailTitleInput')?.addEventListener('blur', saveCurrentInputs);

  window.renderCurrentDetail = () => renderDetailContent();
}
