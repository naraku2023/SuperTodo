/**
 * 弹窗与交互对话框模块 (Modals & Dialogs)
 */

import { state, saveState, emit, applyTheme, applyColorMode } from '../state.js';
import { createTask, createSubtask } from '../models.js';
import { PALETTE, SORT_OPTIONS, AI_PROVIDERS, REPO_API } from '../config.js';
import { escapeHtml } from './list.js';
import { renderModalSubtasksEditor } from './subtasks.js';

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

// 返回栈控制
let backSuppress = false;
let codeBack = false;

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
  const detailSheet = $('#detailSheet');
  if (detailSheet && !detailSheet.hidden) {
    detailSheet.hidden = true;
    const dm = $('#detailMask');
    if (dm) dm.hidden = true;
    backSuppress = false;
    return true;
  }
  if (!$('#dlgModal').hidden) { dlgClose(); backSuppress = false; return true; }
  if (!$('#modal').hidden) { hideModal(); backSuppress = false; return true; }
  if (!$('#ctxModal').hidden) { closeCtx(); backSuppress = false; return true; }
  if (!$('#sortModal').hidden) { closeSort(); backSuppress = false; return true; }
  if (!$('#setModal').hidden) { closeSettings(); backSuppress = false; return true; }
  if (!$('#infoModal').hidden) { closeInfo(); backSuppress = false; return true; }
  if (window.chatDrawerInstance && window.chatDrawerInstance.isOpen) {
    window.chatDrawerInstance.close();
    backSuppress = false;
    return true;
  }
  if (!$('#drawer').hidden) {
    $('#drawerMask').hidden = true;
    $('#drawer').hidden = true;
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
  closeTopLayer();
});

// ================= 通用对话框 (Alert / Confirm / Prompt) =================
let dlgCallback = null, dlgCancelCallback = null;

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
    setTimeout(() => { input.focus(); input.select(); }, 150);
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

// 绑定对话框确定/取消按钮
onReady( () => {
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

function segHTML(kind) {
  const arr = kind === 'type' ? state.types : kind === 'scene' ? state.scenes : state.times;
  return arr.map(v => `<button type="button" class="seg-chip" data-k="${kind}" data-v="${escapeHtml(v)}">${escapeHtml(v)}</button>`).join('')
    + `<button type="button" class="seg-chip mini" data-add="${kind}">+</button>`;
}

export function openAdd(pref) {
  editId = null;
  editStar = (pref && pref.star) || 0;
  editSubtasks = (pref && pref.subtasks) ? pref.subtasks.map(s => typeof s === 'string' ? createSubtask(s) : s) : [];

  $('#modalTitle').textContent = '新建事项';
  $('#fTitle').value = (pref && pref.title) || '';
  $('#fNote').value = (pref && pref.note) || '';
  $('#fCost').value = (pref && pref.cost != null) ? pref.cost : '';
  $('#fDue').value = (pref && pref.due) || '';

  // 默认折叠更多选项，保持创建极简
  const moreDetails = $('#moreOptionsDetails');
  if (moreDetails) moreDetails.open = false;

  $('#fTypeSeg').innerHTML = segHTML('type');
  $('#fSceneSeg').innerHTML = segHTML('scene');
  $('#fTimeSeg').innerHTML = segHTML('time');

  // 默认预选当前筛选的类型
  if (state.type !== '全部') {
    const tc = $(`#fTypeSeg .seg-chip[data-v="${state.type}"]`);
    if (tc) tc.classList.add('on');
  } else if ($('#fTypeSeg .seg-chip')) {
    $('#fTypeSeg .seg-chip').classList.add('on');
  }

  // 预选当前所在分组
  if (state.view.name === 'list' && state.view.group && state.view.group !== '未分组') {
    const kind = state.groupBy === 'scene' ? 'Scene' : 'Time';
    const sel = `#f${kind}Seg .seg-chip[data-v="${escapeHtml(state.view.group)}"]`;
    const el = $(sel);
    if (el) el.classList.add('on');
  }

  if (pref) {
    if (pref.type) setSeg('type', pref.type);
    if (pref.scene) setSeg('scene', pref.scene);
    if (pref.time) setSeg('time', pref.time);
  }

  $$('.star-b').forEach((s, i) => s.classList.toggle('on', i < editStar));
  $('#modalDelete').hidden = true;

  // 渲染子任务编辑器
  renderModalSubtasks();
  showModal();
}

export function openEdit(it) {
  editId = it.id;
  editStar = it.star || 0;
  editSubtasks = (it.subtasks || []).map(s => Object.assign({}, s));

  $('#modalTitle').textContent = '编辑事项';
  $('#fTitle').value = it.title;
  $('#fNote').value = it.note || '';
  $('#fCost').value = (it.cost !== null && it.cost !== undefined) ? it.cost : '';
  $('#fDue').value = it.due || '';

  // 如果原本就有高级字段，才展开更多选项
  const moreDetails = $('#moreOptionsDetails');
  if (moreDetails) {
    moreDetails.open = Boolean(it.cost || it.star || it.scene || it.time);
  }

  $('#fTypeSeg').innerHTML = segHTML('type');
  $('#fSceneSeg').innerHTML = segHTML('scene');
  $('#fTimeSeg').innerHTML = segHTML('time');

  setSeg('type', it.type);
  setSeg('scene', it.scene || '');
  setSeg('time', it.time || '');

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
    const body = $('#modalBody');
    body.appendChild(subWrap);
  }
  renderModalSubtasksEditor(subWrap, editSubtasks);
}

function setSeg(kind, val) {
  const k = kind.charAt(0).toUpperCase() + kind.slice(1);
  const el = $(`#f${k}Seg .seg-chip[data-v="${val}"]`);
  if (el) el.classList.add('on');
}

function segSel(kind) {
  const k = kind.charAt(0).toUpperCase() + kind.slice(1);
  const el = $(`#f${k}Seg .seg-chip.on`);
  return el ? el.dataset.v : '';
}

function showModal() {
  pushLayer();
  $('#modalMask').hidden = false;
  $('#modal').hidden = false;
  setTimeout(() => $('#fTitle').focus(), 150);
}

export function hideModal() {
  $('#modal').hidden = true;
  $('#modalMask').hidden = true;
  if (!backSuppress) syncBack();
}

// 绑定事项弹窗内的快捷分类与子任务
document.addEventListener('click', (e) => {
  // 快捷日期选择处理
  const qbtn = e.target.closest('.qdue-btn');
  if (qbtn) {
    const dueInput = document.querySelector('#fDue');
    if (dueInput) {
      if (qbtn.dataset.clear) {
        dueInput.value = '';
      } else {
        const days = parseInt(qbtn.dataset.days || '0', 10);
        const d = new Date(Date.now() + days * 86400000);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        dueInput.value = `${y}-${m}-${day}`;
      }
    }
    return;
  }

  const chip = e.target.closest('.seg-chip:not(.mini)');
  if (chip) {
    const p = chip.parentElement;
    p.querySelectorAll('.seg-chip').forEach(c => c.classList.remove('on'));
    chip.classList.add('on');
    return;
  }

  const add = e.target.closest('.seg-chip.mini');
  if (add) {
    const kind = add.dataset.add;
    const kindName = { type: '类型', scene: '场景', time: '时间' }[kind];
    inputDlg(`新增${kindName}`, `输入新${kindName}名称`, '', (val) => {
      if (!val) return;
      const arr = kind === 'type' ? state.types : kind === 'scene' ? state.scenes : state.times;
      if (arr.includes(val)) {
        alertDlg('提示', `该${kindName}已存在`);
        return;
      }
      arr.push(val);
      saveState();
      const k = kind.charAt(0).toUpperCase() + kind.slice(1);
      $(`#f${k}Seg`).innerHTML = segHTML(kind);
      setSeg(kind, val);
    });
  }
});

// 保存与删除事项
onReady( () => {
  $('#modalSave')?.addEventListener('click', () => {
    const title = $('#fTitle').value.trim();
    if (!title) {
      $('#fTitle').focus();
      return;
    }

    const taskData = {
      title,
      note: $('#fNote').value.trim(),
      type: segSel('type') || state.types[0],
      scene: segSel('scene'),
      time: segSel('time'),
      cost: isNaN(parseFloat($('#fCost').value)) ? null : parseFloat($('#fCost').value),
      due: $('#fDue').value || '',
      star: editStar,
      subtasks: editSubtasks.filter(s => s.title.trim() !== '')
    };

    if (editId) {
      const idx = state.items.findIndex(x => x.id === editId);
      if (idx !== -1) {
        state.items[idx] = Object.assign(state.items[idx], taskData);
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
    confirmDlg('删除事项', '确定要删除这条事项吗？', () => {
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

// ================= 设置弹窗 (Settings) =================
export function openSettings() {
  pushLayer();
  renderPalette();
  renderSetTags();
  renderAiSettings();
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
  const renderList = (id, kind) => {
    const wrap = $(id);
    const arr = kind === 'type' ? state.types : kind === 'scene' ? state.scenes : state.times;
    wrap.innerHTML = arr.map((t, idx) => `
      <span class="tag set-tag" data-kind="${kind}" data-idx="${idx}">${escapeHtml(t)}</span>
    `).join('') + `<button class="tag-add" data-add="${kind}">+ 添加</button>`;
  };

  renderList('#setTypes', 'type');
  renderList('#setScenes', 'scene');
  renderList('#setTimes', 'time');
}

function renderAiSettings() {
  $('#aiEnabled').checked = Boolean(state.ai.enabled);
  $('#aiBase').value = state.ai.base || 'https://api.deepseek.com';
  $('#aiKey').value = state.ai.key || '';
  $('#aiModel').value = state.ai.model || 'deepseek-chat';

  // 注入预设服务商快捷按钮
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
      ${AI_PROVIDERS.map(p => `<button type="button" class="btn-chip" data-name="${p.name}">${p.name}</button>`).join('')}
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
      }
    };
  });
}

// 绑定设置弹窗内部事件
onReady( () => {
  $('#setClose')?.addEventListener('click', closeSettings);
  $('#setMask')?.addEventListener('click', closeSettings);

  // AI 字段变动自动保存
  const syncAiState = () => {
    state.ai.enabled = $('#aiEnabled').checked;
    state.ai.base = $('#aiBase').value.trim();
    state.ai.key = $('#aiKey').value.trim();
    state.ai.model = $('#aiModel').value.trim() || 'deepseek-chat';
    saveState();
  };

  $('#aiEnabled')?.addEventListener('change', syncAiState);
  $('#aiBase')?.addEventListener('input', syncAiState);
  $('#aiKey')?.addEventListener('input', syncAiState);
  $('#aiModel')?.addEventListener('input', syncAiState);

  // 标签点击重命名 / 删除
  $('#setModal')?.addEventListener('click', (e) => {
    const tag = e.target.closest('.set-tag');
    if (tag) {
      const kind = tag.dataset.kind;
      const idx = +tag.dataset.idx;
      const arr = kind === 'type' ? state.types : kind === 'scene' ? state.scenes : state.times;
      const cur = arr[idx];

      confirmDlg(`管理标签`, `对「${cur}」进行操作：`, () => {
        // 删除逻辑
        if (arr.length <= 1) {
          alertDlg('提示', '至少保留一项');
          return;
        }
        arr.splice(idx, 1);
        state.items.forEach(it => {
          if (kind === 'type' && it.type === cur) it.type = state.types[0];
          else if (kind === 'scene' && it.scene === cur) it.scene = '';
          else if (kind === 'time' && it.time === cur) it.time = '';
        });
        saveState();
        renderSetTags();
        emit('items-changed', state.items);
      }, '删除', 'delete');
      return;
    }

    const add = e.target.closest('.tag-add');
    if (add) {
      const kind = add.dataset.add;
      const kindName = { type: '类型', scene: '场景', time: '时间' }[kind];
      inputDlg(`新增${kindName}`, `输入新${kindName}名称`, '', (val) => {
        if (!val) return;
        const arr = kind === 'type' ? state.types : kind === 'scene' ? state.scenes : state.times;
        if (arr.includes(val)) {
          alertDlg('提示', `该${kindName}已存在`);
          return;
        }
        arr.push(val);
        saveState();
        renderSetTags();
        emit('items-changed', state.items);
      });
    }
  });

  // 备份与清空
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
        if (data.items) state.items = data.items.map(it => createTask(it));
        if (data.types) state.types = data.types;
        if (data.scenes) state.scenes = data.scenes;
        if (data.times) state.times = data.times;
        saveState();
        closeSettings();
        emit('items-changed', state.items);
        alertDlg('导入成功', `已成功恢复 ${state.items.length} 条待办事项`);
      } catch (err) {
        alertDlg('错误', '备份文件格式解析失败');
      }
    };
    reader.readAsText(file);
  });

  $('#clearBtn')?.addEventListener('click', () => {
    confirmDlg('清空数据', '警告：此操作将清空所有待办与设置，不可撤销！', () => {
      localStorage.clear();
      location.reload();
    }, '清空全部', 'delete');
  });
});

// ================= 排序弹窗 (Sort) =================
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

onReady( () => {
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

onReady( () => {
  $('#infoClose')?.addEventListener('click', closeInfo);
  $('#infoMask')?.addEventListener('click', closeInfo);
  $('#infoRepo')?.addEventListener('click', () => {
    window.open('https://github.com/PaidaxingTuT/SuperTodo', '_blank');
  });
});
