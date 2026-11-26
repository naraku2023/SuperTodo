/**
 * 弹窗与交互对话框模块 (Modals, Project Space Editor & Dialogs)
 */

import {
  state,
  saveState,
  emit,
  applyTheme,
  getProjectById,
  ensureTag,
  migrateLegacyData
} from '../state.js';
import {
  createTask,
  createProject,
  createSubtask,
  getTodayYmd,
  addDaysYmd
} from '../models.js';
import {
  PALETTE,
  SORT_OPTIONS,
  AI_PROVIDERS,
  TASK_PRIORITIES,
  PROJECT_ICONS
} from '../config.js';
import { escapeHtml } from './list.js';
import { renderModalSubtasksEditor } from './subtasks.js';
import { agent } from '../ai/agent.js';
import {
  isNativeAndroid,
  requestNotificationPermission,
  sendTestNotification,
  openXiaomiPermission,
  getNativeStatus
} from '../native-bridge.js';

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

let backSuppress = false;
let codeBack = false;

export function isBackSuppressed() {
  return backSuppress;
}

export function onReady(fn) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fn);
  } else {
    fn();
  }
}

export function showToast(msg, duration = 2200) {
  let toast = document.querySelector('#appToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'appToast';
    toast.className = 'app-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

export function pushLayer() {
  history.pushState({ l: 1 }, '');
}

export function syncBack() {
  codeBack = true;
  history.back();
}

export function closeTopLayer() {
  backSuppress = true;

  // 1. 通用模态确认/警告/输入对话框
  if ($('#dlgModal') && !$('#dlgModal').hidden) {
    dlgClose();
    backSuppress = false;
    return true;
  }

  // 2. 项目空间编辑弹窗
  if ($('#projectModal') && !$('#projectModal').hidden) {
    closeProjectModal();
    backSuppress = false;
    return true;
  }

  // 3. AI 多会话抽屉及其内部会话菜单
  if (window.chatDrawerInstance && window.chatDrawerInstance.isOpen) {
    if (window.chatDrawerInstance.isSessionMenuOpen) {
      window.chatDrawerInstance.toggleSessionMenu(false);
    } else {
      window.chatDrawerInstance.close();
    }
    backSuppress = false;
    return true;
  }

  // 4. 事项编辑 / 长按菜单 / 排序 / 设置 / 关于
  if ($('#modal') && !$('#modal').hidden) { hideModal(); backSuppress = false; return true; }
  if ($('#ctxModal') && !$('#ctxModal').hidden) { closeCtx(); backSuppress = false; return true; }
  if ($('#sortModal') && !$('#sortModal').hidden) { closeSort(); backSuppress = false; return true; }
  if ($('#setModal') && !$('#setModal').hidden) { closeSettings(); backSuppress = false; return true; }
  if ($('#infoModal') && !$('#infoModal').hidden) { closeInfo(); backSuppress = false; return true; }

  // 5. 左侧汉堡抽屉
  if ($('#drawer') && !$('#drawer').hidden) {
    $('#drawerMask').hidden = true;
    $('#drawer').hidden = true;
    backSuppress = false;
    return true;
  }

  // 6. 任务详情工作台
  const detailSheet = $('#detailSheet');
  if (detailSheet && !detailSheet.hidden) {
    if (window.closeDetailSheet) {
      window.closeDetailSheet(true);
    } else {
      detailSheet.hidden = true;
      const dm = $('#detailMask');
      if (dm) dm.hidden = true;
    }
    backSuppress = false;
    return true;
  }

  backSuppress = false;
  return false;
}

window.addEventListener('popstate', () => {
  if (codeBack) {
    codeBack = false;
    return;
  }
  if (window.handleGlobalBack) {
    window.handleGlobalBack();
  } else {
    closeTopLayer();
  }
});

// ================= 通用对话框 =================
let dlgCallback = null;
let dlgCancelCallback = null;

export function alertDlg(title, msg, onOk) {
  dlgOpen({ title, msg, icon: 'info', okText: '我知道了', onOk });
}

export function confirmDlg(title, msg, onOk, okText = '确定', type = 'normal') {
  dlgOpen({ title, msg, icon: type === 'delete' ? 'delete' : 'question', showCancel: true, okText, onOk });
}

export function inputDlg(title, msg, initial, onOk, onCancel) {
  dlgOpen({ title, msg, icon: 'edit', showCancel: true, showInput: true, inputValue: initial, okText: '确定', onOk, onCancel });
}

function dlgOpen({ title, msg, icon = 'info', showCancel = false, showInput = false, inputValue = '', okText = '确定', onOk, onCancel }) {
  pushLayer();
  $('#dlgTitle').textContent = title || '';
  $('#dlgMsg').textContent = msg || '';
  $('#dlgMsg').hidden = !msg;

  const inWrap = $('#dlgInputWrap');
  const input = $('#dlgInput');
  inWrap.hidden = !showInput;
  if (showInput) {
    input.value = inputValue || '';
    setTimeout(() => { input.focus(); input.select(); }, 120);
  }

  $('#dlgCancel').hidden = !showCancel;
  $('#dlgOk').textContent = okText;

  const ic = $('#dlgIcon');
  ic.className = 'dlg-icon' + (icon === 'delete' ? ' danger' : '');
  ic.innerHTML = icon === 'delete'
    ? '<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>'
    : '<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>';

  dlgCallback = onOk || null;
  dlgCancelCallback = onCancel || null;
  $('#dlgMask').hidden = false;
  $('#dlgModal').hidden = false;
}

export function dlgClose() {
  $('#dlgMask').hidden = true;
  $('#dlgModal').hidden = true;
  if (!backSuppress) syncBack();
}

onReady(() => {
  $('#dlgOk')?.addEventListener('click', () => {
    const val = $('#dlgInput').value.trim();
    const cb = dlgCallback;
    dlgClose();
    if (cb) cb(val);
  });
  $('#dlgCancel')?.addEventListener('click', () => {
    const cb = dlgCancelCallback;
    dlgClose();
    if (cb) cb();
  });
});

// ================= 添加 / 编辑事项弹窗 =================
let editId = null;
let editStar = 0;
let editPriority = 'medium';
let editTags = [];
let editSubtasks = [];

export function buildStars() {
  const s = $('#fStars');
  if (!s || s.children.length > 0) return;
  for (let i = 1; i <= 5; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'star-b';
    b.dataset.v = i;
    b.textContent = '★';
    b.onclick = () => {
      editStar = (editStar === i) ? 0 : i;
      $$('.star-b').forEach((st, idx) => st.classList.toggle('on', idx < editStar));
    };
    s.appendChild(b);
  }
}

function renderProjectSelect(selectedId = '') {
  const sel = $('#fProject');
  if (!sel) return;
  sel.innerHTML = `<option value="">📥 收集箱（暂不归类）</option>` +
    state.projects.map(p => `<option value="${escapeHtml(p.id)}">${p.icon} ${escapeHtml(p.name)}</option>`).join('');
  sel.value = selectedId || '';
}

function renderPriorityChips() {
  const wrap = $('#fPrioritySeg');
  if (!wrap) return;
  wrap.innerHTML = TASK_PRIORITIES.map(p => `
    <button type="button" class="seg-chip prio-chip ${editPriority === p.id ? 'on' : ''}" data-prio="${p.id}" style="--chip-col:${p.color}">
      ${escapeHtml(p.label)}
    </button>
  `).join('');

  wrap.querySelectorAll('.prio-chip').forEach(btn => {
    btn.onclick = () => {
      editPriority = btn.dataset.prio;
      renderPriorityChips();
    };
  });
}

function renderModalTags() {
  const wrap = $('#fTagsSeg');
  if (!wrap) return;
  wrap.innerHTML = state.tags.map(t => `
    <button type="button" class="seg-chip tag-toggle-chip ${editTags.includes(t) ? 'on' : ''}" data-tag="${escapeHtml(t)}">
      #${escapeHtml(t)}
    </button>
  `).join('') + `<button type="button" class="seg-chip mini" id="fAddTagBtn" title="新增标签">+</button>`;

  wrap.querySelectorAll('.tag-toggle-chip').forEach(btn => {
    btn.onclick = () => {
      const t = btn.dataset.tag;
      if (editTags.includes(t)) {
        editTags = editTags.filter(x => x !== t);
      } else {
        editTags.push(t);
      }
      renderModalTags();
    };
  });

  $('#fAddTagBtn').onclick = () => {
    inputDlg('新增标签', '输入标签名（如：重要、复习、出差）', '', (val) => {
      if (!val) return;
      ensureTag(val);
      if (!editTags.includes(val)) editTags.push(val);
      saveState();
      renderModalTags();
    });
  };
}

export function openAdd(pref = null) {
  editId = null;
  editStar = (pref && pref.star) || 0;
  editPriority = (pref && pref.priority) || (state.navMode === 'smart' && state.smartView === 'priority' ? 'high' : 'medium');
  editTags = Array.isArray(pref?.tags) ? pref.tags.slice() : (state.navMode === 'tag' && state.activeTag ? [state.activeTag] : []);
  editSubtasks = (pref && pref.subtasks) ? pref.subtasks.map(s => createSubtask(s)) : [];

  $('#modalTitle').textContent = '新建事项';
  $('#fTitle').value = (pref && pref.title) || '';
  $('#fNote').value = (pref && pref.note) || '';
  $('#fCost').value = (pref && pref.cost != null) ? pref.cost : '';
  $('#fStartDate').value = (pref && pref.startDate) || '';
  $('#fDue').value = (pref && pref.due) || (state.navMode === 'smart' && state.smartView === 'today' ? getTodayYmd() : '');
  $('#fStartTime').value = (pref && pref.startTime) || '';
  $('#fEndTime').value = (pref && pref.endTime) || '';
  $('#fDuration').value = (pref && pref.durationMin) || '';
  $('#fRepeat').value = (pref && pref.repeat) || 'none';
  $('#fStatus').value = (pref && pref.status) || 'todo';
  $('#fTemplate').value = (pref && pref.template) || '';

  // 默认项目归属
  let defaultProjId = '';
  if (pref && pref.projectId !== undefined) {
    defaultProjId = pref.projectId;
  } else if (state.navMode === 'project' && state.activeProjectId) {
    defaultProjId = state.activeProjectId;
  } else if (state.navMode === 'smart' && state.smartView === 'inbox') {
    defaultProjId = '';
  } else {
    defaultProjId = state.projects[0]?.id || '';
  }

  renderProjectSelect(defaultProjId);
  renderPriorityChips();
  renderModalTags();

  const moreDetails = $('#moreOptionsDetails');
  if (moreDetails) moreDetails.open = Boolean(pref && (pref.cost || pref.star || pref.template));

  $$('.star-b').forEach((s, i) => s.classList.toggle('on', i < editStar));
  $('#modalDelete').hidden = true;

  renderModalSubtasks();
  showModal();
}

export function openEdit(it) {
  editId = it.id;
  editStar = it.star || 0;
  editPriority = it.priority || 'medium';
  editTags = Array.isArray(it.tags) ? it.tags.slice() : [];
  editSubtasks = (it.subtasks || []).map(s => Object.assign({}, s));

  $('#modalTitle').textContent = '编辑事项';
  $('#fTitle').value = it.title || '';
  $('#fNote').value = it.note || '';
  $('#fCost').value = (it.cost !== null && it.cost !== undefined) ? it.cost : '';
  $('#fStartDate').value = it.startDate || '';
  $('#fDue').value = it.due || '';
  $('#fStartTime').value = it.startTime || '';
  $('#fEndTime').value = it.endTime || '';
  $('#fDuration').value = it.durationMin || '';
  $('#fRepeat').value = it.repeat || 'none';
  $('#fStatus').value = (it.status && it.status !== 'done') ? it.status : 'todo';
  $('#fTemplate').value = it.template || '';

  renderProjectSelect(it.projectId || '');
  renderPriorityChips();
  renderModalTags();

  const moreDetails = $('#moreOptionsDetails');
  if (moreDetails) {
    moreDetails.open = Boolean(it.cost || it.star || it.template);
  }

  $$('.star-b').forEach((s, i) => s.classList.toggle('on', i < editStar));
  $('#modalDelete').hidden = false;

  renderModalSubtasks();
  showModal();
}

function renderModalSubtasks() {
  let subWrap = $('#modalSubtasksWrap');
  if (!subWrap) {
    subWrap = document.createElement('div');
    subWrap.id = 'modalSubtasksWrap';
    $('#modalBody').appendChild(subWrap);
  }
  renderModalSubtasksEditor(subWrap, editSubtasks);
}

function showModal() {
  pushLayer();
  $('#modalMask').hidden = false;
  $('#modal').hidden = false;
  setTimeout(() => $('#fTitle').focus(), 140);
}

export function hideModal() {
  $('#modal').hidden = true;
  $('#modalMask').hidden = true;
  if (!backSuppress) syncBack();
}

onReady(() => {
  // 快捷日期与快捷耗时按钮
  document.addEventListener('click', (e) => {
    const qbtn = e.target.closest('.qdue-btn');
    if (qbtn) {
      const dueInput = $('#fDue');
      const startInput = $('#fStartDate');
      if (!dueInput) return;
      if (qbtn.dataset.clear) {
        dueInput.value = '';
        if (startInput) startInput.value = '';
      } else if (qbtn.dataset.weekend) {
        const now = new Date();
        const day = now.getDay();
        const diff = day === 0 ? 0 : (6 - day);
        dueInput.value = addDaysYmd(getTodayYmd(), diff);
      } else {
        const days = parseInt(qbtn.dataset.days || '0', 10);
        dueInput.value = addDaysYmd(getTodayYmd(), days);
      }
      return;
    }

    const durBtn = e.target.closest('.qdur-btn');
    if (durBtn) {
      const durInput = $('#fDuration');
      if (durInput) durInput.value = durBtn.dataset.min;
    }
  });

  $('#fAddProjectBtn')?.addEventListener('click', () => {
    openProjectModal(null, (createdProj) => {
      renderProjectSelect(createdProj.id);
    });
  });

  $('#modalSave')?.addEventListener('click', () => {
    const title = $('#fTitle').value.trim();
    if (!title) {
      $('#fTitle').focus();
      return;
    }

    const projectId = $('#fProject').value || '';
    const proj = getProjectById(projectId);
    const tplOverride = $('#fTemplate').value || '';
    const durVal = parseInt($('#fDuration').value, 10);

    const taskData = {
      title,
      note: $('#fNote').value.trim(),
      projectId,
      type: proj ? proj.name : '收集箱',
      template: tplOverride || (proj ? proj.template : 'general'),
      tags: editTags.slice(),
      status: $('#fStatus').value || 'todo',
      priority: editPriority,
      startDate: $('#fStartDate').value || '',
      due: $('#fDue').value || '',
      startTime: $('#fStartTime').value || '',
      endTime: $('#fEndTime').value || '',
      durationMin: (!isNaN(durVal) && durVal > 0) ? durVal : null,
      repeat: $('#fRepeat').value || 'none',
      cost: isNaN(parseFloat($('#fCost').value)) ? null : parseFloat($('#fCost').value),
      star: editStar,
      subtasks: editSubtasks.filter(s => s.title.trim() !== '').map(s => createSubtask(s)),
      updated: Date.now()
    };

    if (editId) {
      const idx = state.items.findIndex(x => x.id === editId);
      if (idx !== -1) {
        const existing = state.items[idx];
        state.items[idx] = createTask({
          ...existing,
          ...taskData,
          done: existing.done,
          status: existing.done ? 'done' : taskData.status,
          completedAt: existing.completedAt,
          sessionId: existing.sessionId,
          chatHistory: existing.chatHistory,
          lastChatAt: existing.lastChatAt,
          extra: existing.extra,
          stages: existing.stages
        });
      }
    } else {
      const newTask = createTask(taskData);
      newTask.order = -Date.now();
      state.items.unshift(newTask);
    }

    saveState();
    hideModal();
    emit('items-changed', state.items);
  });

  $('#modalDelete')?.addEventListener('click', () => {
    if (!editId) return;
    confirmDlg('删除事项', '确定要彻底删除这条事项及其专属会话记录吗？', () => {
      state.items = state.items.filter(x => x.id !== editId);
      saveState();
      hideModal();
      emit('items-changed', state.items);
    }, '删除', 'delete');
  });

  $('#modalClose')?.addEventListener('click', hideModal);
  $('#modalCancel')?.addEventListener('click', hideModal);
  $('#modalMask')?.addEventListener('click', hideModal);
});

// ================= 项目空间新建 / 编辑弹窗 =================
let editingProjectId = null;
let editingProjIcon = '📁';
let editingProjColor = '#0b57d0';
let projectSavedCb = null;

export function openProjectModal(project = null, onSaved = null) {
  editingProjectId = project ? project.id : null;
  editingProjIcon = project ? project.icon : PROJECT_ICONS[0];
  editingProjColor = project ? project.color : PALETTE[0];
  projectSavedCb = onSaved;

  $('#projectModalTitle').textContent = project ? '编辑项目空间' : '新建项目空间';
  $('#pName').value = project ? project.name : '';
  $('#pTemplate').value = project ? project.template : 'general';
  $('#pDesc').value = project ? (project.desc || '') : '';
  $('#projectDelete').hidden = !project || state.projects.length <= 1;

  renderProjectEditorPickers();
  pushLayer();
  $('#projectMask').hidden = false;
  $('#projectModal').hidden = false;
  setTimeout(() => $('#pName').focus(), 140);
}

function renderProjectEditorPickers() {
  const iconGrid = $('#pIconGrid');
  if (iconGrid) {
    iconGrid.innerHTML = PROJECT_ICONS.map(ic => `
      <button type="button" class="emoji-btn ${editingProjIcon === ic ? 'on' : ''}" data-ic="${ic}">${ic}</button>
    `).join('');
    iconGrid.querySelectorAll('.emoji-btn').forEach(b => {
      b.onclick = () => {
        editingProjIcon = b.dataset.ic;
        renderProjectEditorPickers();
      };
    });
  }

  const colorGrid = $('#pColorGrid');
  if (colorGrid) {
    colorGrid.innerHTML = PALETTE.map(hex => `
      <button type="button" class="pal-sw ${editingProjColor === hex ? 'on' : ''}" style="background:${hex}" data-hex="${hex}"></button>
    `).join('');
    colorGrid.querySelectorAll('.pal-sw').forEach(sw => {
      sw.onclick = () => {
        editingProjColor = sw.dataset.hex;
        renderProjectEditorPickers();
      };
    });
  }
}

export function closeProjectModal() {
  $('#projectMask').hidden = true;
  $('#projectModal').hidden = true;
  if (!backSuppress) syncBack();
}

onReady(() => {
  $('#projectClose')?.addEventListener('click', closeProjectModal);
  $('#projectCancel')?.addEventListener('click', closeProjectModal);
  $('#projectMask')?.addEventListener('click', closeProjectModal);

  $('#projectSave')?.addEventListener('click', () => {
    const name = $('#pName').value.trim();
    if (!name) {
      $('#pName').focus();
      return;
    }

    let savedProj = null;
    if (editingProjectId) {
      const p = getProjectById(editingProjectId);
      if (p) {
        p.name = name;
        p.icon = editingProjIcon;
        p.color = editingProjColor;
        p.template = $('#pTemplate').value || 'general';
        p.desc = $('#pDesc').value.trim();
        state.items.forEach(it => {
          if (it.projectId === p.id) {
            it.type = p.name;
          }
        });
        savedProj = p;
      }
    } else {
      savedProj = createProject({
        name,
        icon: editingProjIcon,
        color: editingProjColor,
        template: $('#pTemplate').value || 'general',
        desc: $('#pDesc').value.trim()
      });
      state.projects.push(savedProj);
    }

    saveState();
    closeProjectModal();
    renderSetTags();
    emit('items-changed', state.items);
    if (projectSavedCb && savedProj) projectSavedCb(savedProj);
    showToast(editingProjectId ? '已更新项目空间' : '已创建项目空间');
  });

  $('#projectDelete')?.addEventListener('click', () => {
    if (!editingProjectId || state.projects.length <= 1) return;
    const p = getProjectById(editingProjectId);
    confirmDlg('删除项目空间', `确定删除「${p?.name}」吗？该项目下的事项将保留并移入收集箱。`, () => {
      state.projects = state.projects.filter(x => x.id !== editingProjectId);
      state.items.forEach(it => {
        if (it.projectId === editingProjectId) {
          it.projectId = '';
          it.type = '收集箱';
        }
      });
      if (state.activeProjectId === editingProjectId) {
        state.navMode = 'smart';
        state.smartView = 'all';
        state.activeProjectId = null;
      }
      saveState();
      closeProjectModal();
      renderSetTags();
      emit('items-changed', state.items);
      showToast('项目已删除，事项移入收集箱');
    }, '删除', 'delete');
  });
});

// ================= 上下文菜单（供外部调用） =================
export function closeCtx() {
  $('#ctxMask').hidden = true;
  $('#ctxModal').hidden = true;
  if (!backSuppress) syncBack();
}

// ================= 设置弹窗 (Settings) =================
export function openSettings() {
  pushLayer();
  renderPalette();
  renderSetTags();
  renderAiSettings();
  renderReminderSettings();
  $('#setMask').hidden = false;
  $('#setModal').hidden = false;
}

export function closeSettings() {
  $('#setMask').hidden = true;
  $('#setModal').hidden = true;
  if (!backSuppress) syncBack();
}

function renderPalette() {
  const p = $('#palette');
  if (!p) return;
  p.innerHTML = PALETTE.map(hex => `
    <button class="pal-sw ${state.theme === hex ? 'on' : ''}" style="background:${hex}" data-hex="${hex}" aria-label="主题色 ${hex}"></button>
  `).join('');

  p.querySelectorAll('.pal-sw').forEach(sw => {
    sw.onclick = () => {
      state.theme = sw.dataset.hex;
      saveState();
      applyTheme(state.theme);
      renderPalette();
    };
  });
}

function renderSetTags() {
  const projWrap = $('#setProjects');
  if (projWrap) {
    projWrap.innerHTML = state.projects.map(p => `
      <span class="tag set-proj-chip" data-proj-id="${p.id}" style="border-color:${escapeHtml(p.color)}">
        ${p.icon} ${escapeHtml(p.name)}
      </span>
    `).join('') + `<button type="button" class="tag-add" id="setAddProjBtn">+ 新建项目</button>`;
  }

  const tagsWrap = $('#setTags');
  if (tagsWrap) {
    tagsWrap.innerHTML = state.tags.map((t, idx) => `
      <span class="tag set-tag" data-idx="${idx}">#${escapeHtml(t)}</span>
    `).join('') + `<button type="button" class="tag-add" id="setAddTagBtn">+ 新增标签</button>`;
  }
}

function renderReminderSettings() {
  const rem = state.reminders || {};
  if ($('#remMorningEnabled')) $('#remMorningEnabled').checked = rem.morningEnabled !== false;
  if ($('#remMorningTime')) $('#remMorningTime').value = rem.morningTime || '08:30';
  if ($('#remEveningEnabled')) $('#remEveningEnabled').checked = rem.eveningEnabled !== false;
  if ($('#remEveningTime')) $('#remEveningTime').value = rem.eveningTime || '21:00';
  if ($('#remTaskExactEnabled')) $('#remTaskExactEnabled').checked = rem.taskExactEnabled !== false;
  if ($('#remInAppBanner')) $('#remInAppBanner').checked = rem.inAppBanner !== false;

  const tip = $('#remStatusTip');
  if (tip) {
    if (!isNativeAndroid()) {
      tip.textContent = '当前为网页预览模式；打包安装 Android APK 后将自动启用小米桌面小组件与系统级闹钟提醒。';
    } else {
      const st = getNativeStatus();
      tip.textContent = `通知权限：${st.hasNotificationPerm ? '已开启 ✓' : '未开启 ✗'} · 精准闹钟：${st.canExactAlarm ? '已授权 ✓' : '需授权'}`;
    }
  }
}

function renderAiStorageSummary() {
  const el = $('#aiStorageSummary');
  if (!el) return;
  const sessionsCount = state.items.filter(i => Array.isArray(i.chatHistory) && i.chatHistory.length > 0).length;
  const msgCount = (state.chatHistory?.length || 0) + state.items.reduce((acc, it) => acc + (it.chatHistory?.length || 0), 0);
  const kb = Math.round(JSON.stringify(state.items).length / 1024);
  el.textContent = `当前已保存 ${sessionsCount} 个事项独立会话 · 共 ${msgCount} 条对话 · 占用约 ${kb} KB（IndexedDB 主存）`;
}

function renderAiSettings() {
  $('#aiEnabled').checked = Boolean(state.ai.enabled);
  $('#aiBase').value = state.ai.base || 'https://api.deepseek.com';
  $('#aiKey').value = state.ai.key || '';
  $('#aiModel').value = state.ai.model || 'deepseek-flash';
  if ($('#aiThinkingMode')) $('#aiThinkingMode').value = state.ai.thinkingMode || 'disabled';
  if ($('#aiAutoCompact')) $('#aiAutoCompact').checked = state.ai.autoCompact !== false;
  if ($('#aiCompactThreshold')) {
    const cur = `${state.ai.compactThresholdMsgs || 40}:${state.ai.compactThresholdTokens || 32000}`;
    $('#aiCompactThreshold').value = ['24:16000', '40:32000', '80:64000'].includes(cur) ? cur : '40:32000';
  }
  renderAiStorageSummary();

  const testStatus = $('#aiTestStatus');
  if (testStatus) {
    testStatus.textContent = '';
    testStatus.className = 'ai-test-status';
  }

  let presetBox = $('#aiPresetBox');
  if (!presetBox) {
    presetBox = document.createElement('div');
    presetBox.id = 'aiPresetBox';
    presetBox.className = 'ai-preset-box';
    const baseField = $('#aiBase').closest('.fld');
    baseField.parentNode.insertBefore(presetBox, baseField);
  }

  presetBox.innerHTML = `
    <div class="preset-label">快捷预设服务商：</div>
    <div class="preset-btns">
      ${AI_PROVIDERS.map(p => `<button type="button" class="btn-chip ${state.ai.model === p.model && state.ai.base === p.base ? 'on' : ''}" data-name="${p.name}" title="${escapeHtml(p.tip || '')}">${p.name}</button>`).join('')}
    </div>
  `;

  presetBox.querySelectorAll('.btn-chip').forEach(btn => {
    btn.onclick = () => {
      const p = AI_PROVIDERS.find(x => x.name === btn.dataset.name);
      if (p) {
        $('#aiBase').value = p.base;
        $('#aiModel').value = p.model;
        state.ai.base = p.base;
        state.ai.model = p.model;
        saveState();
        renderAiSettings();
        showToast(`已切换至 ${p.name}`);
      }
    };
  });
}

onReady(() => {
  $('#setClose')?.addEventListener('click', closeSettings);
  $('#setMask')?.addEventListener('click', closeSettings);

  const syncAiState = (autoEnable = false) => {
    const keyVal = $('#aiKey').value.trim();
    if (autoEnable && keyVal && !$('#aiEnabled').checked) {
      $('#aiEnabled').checked = true;
    }
    state.ai.enabled = $('#aiEnabled').checked;
    state.ai.base = $('#aiBase').value.trim();
    state.ai.key = keyVal;
    state.ai.model = $('#aiModel').value.trim() || 'deepseek-flash';
    if ($('#aiThinkingMode')) state.ai.thinkingMode = $('#aiThinkingMode').value || 'disabled';
    if ($('#aiAutoCompact')) state.ai.autoCompact = $('#aiAutoCompact').checked;
    if ($('#aiCompactThreshold')) {
      const [m, t] = ($('#aiCompactThreshold').value || '40:32000').split(':').map(Number);
      state.ai.compactThresholdMsgs = m || 40;
      state.ai.compactThresholdTokens = t || 32000;
    }
    saveState();
  };

  $('#aiEnabled')?.addEventListener('change', () => syncAiState(false));
  $('#aiBase')?.addEventListener('input', () => syncAiState(false));
  $('#aiKey')?.addEventListener('input', () => syncAiState(true));
  $('#aiModel')?.addEventListener('input', () => syncAiState(false));
  $('#aiThinkingMode')?.addEventListener('change', () => syncAiState(false));
  $('#aiAutoCompact')?.addEventListener('change', () => syncAiState(false));
  $('#aiCompactThreshold')?.addEventListener('change', () => syncAiState(false));

  $('#aiTestBtn')?.addEventListener('click', async () => {
    syncAiState(true);
    const btn = $('#aiTestBtn');
    const statusEl = $('#aiTestStatus');
    if (!state.ai.key) {
      if (statusEl) {
        statusEl.textContent = '请先输入 DeepSeek API Key';
        statusEl.className = 'ai-test-status err';
      }
      $('#aiKey')?.focus();
      return;
    }
    btn.disabled = true;
    btn.textContent = '正在测试连通性...';
    if (statusEl) {
      statusEl.textContent = `正在请求 ${state.ai.model}...`;
      statusEl.className = 'ai-test-status testing';
    }
    try {
      const res = await agent.testConnection({
        base: state.ai.base,
        key: state.ai.key,
        model: state.ai.model,
        thinkingMode: state.ai.thinkingMode
      });
      if (statusEl) {
        statusEl.textContent = `✓ 连接成功 (${res.model} · ${res.latencyMs}ms)`;
        statusEl.className = 'ai-test-status ok';
      }
      showToast('DeepSeek API 连接测试成功');
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = `✗ ${err.message}`;
        statusEl.className = 'ai-test-status err';
      }
    } finally {
      btn.disabled = false;
      btn.textContent = '测试 DeepSeek / API 连接';
    }
  });

  // 定时提醒设置绑定
  const syncReminderState = () => {
    if (!state.reminders) state.reminders = {};
    state.reminders.morningEnabled = Boolean($('#remMorningEnabled')?.checked);
    state.reminders.morningTime = $('#remMorningTime')?.value || '08:30';
    state.reminders.eveningEnabled = Boolean($('#remEveningEnabled')?.checked);
    state.reminders.eveningTime = $('#remEveningTime')?.value || '21:00';
    state.reminders.taskExactEnabled = Boolean($('#remTaskExactEnabled')?.checked);
    state.reminders.inAppBanner = Boolean($('#remInAppBanner')?.checked);
    state.reminders.enabled = Boolean(
      state.reminders.morningEnabled ||
      state.reminders.eveningEnabled ||
      state.reminders.taskExactEnabled
    );
    saveState();
  };

  ['#remMorningEnabled', '#remMorningTime', '#remEveningEnabled', '#remEveningTime', '#remTaskExactEnabled', '#remInAppBanner'].forEach(sel => {
    $(sel)?.addEventListener('change', () => {
      if ((sel === '#remMorningEnabled' || sel === '#remEveningEnabled' || sel === '#remTaskExactEnabled') && $(sel)?.checked) {
        requestNotificationPermission();
      }
      syncReminderState();
    });
  });

  $('#remTestBtn')?.addEventListener('click', () => {
    requestNotificationPermission();
    const res = sendTestNotification(state);
    if (res.mode === 'native') {
      showToast('已发送系统高优悬浮测试提醒');
    } else {
      showToast('已触发测试提醒（安装 APK 后可在小米桌面触发系统悬浮通知）');
    }
    renderReminderSettings();
  });

  $('#setModal')?.addEventListener('click', (e) => {
    const miBtn = e.target.closest('[data-mi-perm]');
    if (miBtn) {
      const ok = openXiaomiPermission(miBtn.dataset.miPerm);
      if (!ok) {
        showToast('请安装 Android APK 后在小米手机上使用一键权限跳转');
      }
    }
  });

  $('#setModal')?.addEventListener('click', (e) => {
    const projChip = e.target.closest('.set-proj-chip');
    if (projChip) {
      const p = getProjectById(projChip.dataset.projId);
      if (p) openProjectModal(p);
      return;
    }

    if (e.target.closest('#setAddProjBtn')) {
      openProjectModal(null);
      return;
    }

    const tag = e.target.closest('.set-tag');
    if (tag) {
      const idx = +tag.dataset.idx;
      const cur = state.tags[idx];
      confirmDlg('删除标签', `确定删除标签「#${cur}」吗？相关事项中也会移除该标签。`, () => {
        state.tags.splice(idx, 1);
        state.items.forEach(it => {
          if (Array.isArray(it.tags)) it.tags = it.tags.filter(t => t !== cur);
        });
        if (state.activeTag === cur) {
          state.navMode = 'smart';
          state.smartView = 'all';
          state.activeTag = null;
        }
        saveState();
        renderSetTags();
        emit('items-changed', state.items);
      }, '删除', 'delete');
      return;
    }

    if (e.target.closest('#setAddTagBtn')) {
      inputDlg('新增标签', '输入新标签名称', '', (val) => {
        if (!val) return;
        if (state.tags.includes(val)) {
          alertDlg('提示', '该标签已存在');
          return;
        }
        state.tags.push(val);
        saveState();
        renderSetTags();
        emit('items-changed', state.items);
      });
    }
  });

  $('#exportBtn')?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `supertodo-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  $('#importBtn')?.addEventListener('click', () => {
    $('#importFile')?.click();
  });

  $('#importFile')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        migrateLegacyData(data);
        saveState();
        closeSettings();
        emit('items-changed', state.items);
        alertDlg('导入成功', `已成功恢复 ${state.items.length} 条事项与项目配置`);
      } catch (err) {
        alertDlg('错误', '备份文件格式解析失败');
      }
    };
    reader.readAsText(file);
  });

  $('#clearBtn')?.addEventListener('click', () => {
    confirmDlg('清空数据', '警告：此操作将清空所有待办、项目配置与专属会话记录，不可撤销！', () => {
      localStorage.clear();
      location.reload();
    }, '清空全部', 'delete');
  });
});

// ================= 排序弹窗 =================
export function openSort() {
  pushLayer();
  const list = $('#sortOptions');
  list.innerHTML = SORT_OPTIONS.map(opt => `
    <label class="radio-row">
      <input type="radio" name="sortOpt" value="${opt}" ${state.sortKey === opt ? 'checked' : ''}>
      <span>${opt}</span>
    </label>
  `).join('');

  $('#sortAsc').checked = state.sortAsc;
  $('#sortMask').hidden = false;
  $('#sortModal').hidden = false;

  list.querySelectorAll('input[type=radio]').forEach(r => {
    r.onchange = () => {
      state.sortKey = r.value;
      saveState();
      emit('items-changed', state.items);
    };
  });
}

export function closeSort() {
  $('#sortMask').hidden = true;
  $('#sortModal').hidden = true;
  if (!backSuppress) syncBack();
}

onReady(() => {
  $('#sortClose')?.addEventListener('click', closeSort);
  $('#sortMask')?.addEventListener('click', closeSort);
  $('#sortAsc')?.addEventListener('change', (e) => {
    state.sortAsc = e.target.checked;
    saveState();
    emit('items-changed', state.items);
  });
});

// ================= 信息弹窗 (About) =================
export function openInfo() {
  pushLayer();
  $('#infoMask').hidden = false;
  $('#infoModal').hidden = false;
}

export function closeInfo() {
  $('#infoMask').hidden = true;
  $('#infoModal').hidden = true;
  if (!backSuppress) syncBack();
}

onReady(() => {
  $('#infoClose')?.addEventListener('click', closeInfo);
  $('#infoMask')?.addEventListener('click', closeInfo);
  $('#infoRepo')?.addEventListener('click', () => {
    window.open('https://github.com/naraku2023/SuperTodo', '_blank');
  });
});
