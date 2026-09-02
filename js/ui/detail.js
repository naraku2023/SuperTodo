/**
 * 任务详情页模块 (Task Detail Sheet)
 * 提供大字标题、独立步骤清单（支持一步步打勾完结）、进度条联动、执行指南查阅与快速修改
 */

import { state, saveState, emit, pushLayer, syncBack, backSuppress } from '../state.js';
import { calculateProgress, createSubtask } from '../models.js';
import { openEdit } from './modals.js';
import { escapeHtml, fmtDue, isOverdue } from './list.js';

let currentTask = null;

const $ = s => document.querySelector(s);

export function openDetail(task) {
  if (!task) return;
  currentTask = task;

  pushLayer();
  renderDetailContent();

  const mask = $('#detailMask');
  const sheet = $('#detailSheet');
  if (mask) mask.hidden = false;
  if (sheet) sheet.hidden = false;
}

export function closeDetail() {
  saveCurrentInputs();
  const mask = $('#detailMask');
  const sheet = $('#detailSheet');
  if (mask) mask.hidden = true;
  if (sheet) sheet.hidden = true;
  currentTask = null;
  if (!backSuppress) syncBack();
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
  if (noteArea && noteArea.value !== (currentTask.note || '')) {
    currentTask.note = noteArea.value;
    changed = true;
  }
  if (changed) {
    saveState();
  }
}

export function renderDetailContent() {
  if (!currentTask) return;
  const t = currentTask;

  // 1. 主任务完成状态
  const chkCircle = $('#detailMainChkCircle');
  if (chkCircle) {
    chkCircle.classList.toggle('checked', Boolean(t.done));
  }

  // 2. 主任务标题输入框
  const titleInput = $('#detailTitleInput');
  if (titleInput) {
    titleInput.value = t.title || '';
    titleInput.classList.toggle('done', Boolean(t.done));
  }

  // 3. 标签与截止日期栏
  const metaBar = $('#detailMetaBar');
  if (metaBar) {
    let metaHtml = `<span class="detail-tag type-tag">${escapeHtml(t.type || '待办')}</span>`;
    if (t.due) {
      const overdue = isOverdue(t.due) && !t.done;
      metaHtml += `
        <span class="detail-tag due-tag ${overdue ? 'overdue' : ''}">
          📅 ${fmtDue(t.due)} 截止
        </span>
      `;
    }
    if (t.scene) metaHtml += `<span class="detail-tag">${escapeHtml(t.scene)}</span>`;
    if (t.cost) metaHtml += `<span class="detail-tag cost-tag">¥${t.cost}</span>`;
    metaBar.innerHTML = metaHtml;
  }

  // 4. 渲染子任务步骤清单与进度
  renderDetailSubtasks();

  // 5. 详细说明与指南 textarea
  const noteArea = $('#detailNoteTextarea');
  if (noteArea) {
    noteArea.value = t.note || '';
  }

  // 6. 创建时间与底部信息
  const createTimeEl = $('#detailCreateTime');
  if (createTimeEl && t.created) {
    const d = new Date(t.created);
    createTimeEl.textContent = `创建于 ${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

/**
 * 渲染详情页子步骤（支持一步步打勾完结）
 */
function renderDetailSubtasks() {
  if (!currentTask) return;
  const listEl = $('#detailSubtasksList');
  const badgeEl = $('#detailStepsBadge');
  const barEl = $('#detailProgressBar');
  if (!listEl) return;

  const subtasks = currentTask.subtasks || [];
  const { total, completed, percent } = calculateProgress(subtasks);

  if (badgeEl) {
    badgeEl.textContent = total > 0 ? `${completed}/${total} 步 (${percent}%)` : '无步骤';
  }
  if (barEl) {
    barEl.style.width = `${percent}%`;
  }

  if (total === 0) {
    listEl.innerHTML = `
      <div class="detail-subtasks-empty">
        暂无拆解步骤，可以在下方输入添加具体的执行打卡清单。
      </div>
    `;
    return;
  }

  let html = '';
  subtasks.forEach(st => {
    html += `
      <div class="detail-step-row ${st.done ? 'is-done' : ''}" data-sub-id="${st.id}">
        <!-- 步骤勾选框：点击仅切换该步骤，实现一步步打勾完结 -->
        <label class="step-chk-label">
          <input type="checkbox" class="step-real-chk" ${st.done ? 'checked' : ''}>
          <span class="step-chk-box"></span>
        </label>
        <span class="step-title-text ${st.done ? 'done' : ''}">${escapeHtml(st.title)}</span>
        <button type="button" class="step-del-btn" data-del-sub="${st.id}" title="删除步骤">✕</button>
      </div>
    `;
  });

  listEl.innerHTML = html;
}

// 事件委托监听
document.addEventListener('DOMContentLoaded', () => {
  initDetailEvents();
});

export function initDetailEvents() {
  // 1. 关闭按钮
  $('#detailClose')?.addEventListener('click', closeDetail);
  $('#detailDoneBtn')?.addEventListener('click', closeDetail);
  $('#detailMask')?.addEventListener('click', closeDetail);

  // 2. 主任务完成勾选
  $('#detailMainChkWrap')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!currentTask) return;
    currentTask.done = !currentTask.done;
    saveState();
    renderDetailContent();
    emit('items-changed', state.items);
  });

  // 3. 删除任务
  $('#detailDelete')?.addEventListener('click', () => {
    if (!currentTask) return;
    if (confirm(`确定删除任务“${currentTask.title}”吗？`)) {
      state.items = state.items.filter(x => x.id !== currentTask.id);
      saveState();
      closeDetail();
      emit('items-changed', state.items);
    }
  });

  // 4. 打开全属性编辑
  $('#detailEdit')?.addEventListener('click', () => {
    if (!currentTask) return;
    const it = currentTask;
    closeDetail();
    openEdit(it);
  });

  // 5. 步骤清单内的交互：一步步打勾完成、删除步骤
  $('#detailSubtasksList')?.addEventListener('click', (e) => {
    if (!currentTask || !currentTask.subtasks) return;

    // 删除步骤
    const delBtn = e.target.closest('[data-del-sub]');
    if (delBtn) {
      e.stopPropagation();
      const subId = delBtn.dataset.delSub;
      currentTask.subtasks = currentTask.subtasks.filter(s => s.id !== subId);
      saveState();
      renderDetailSubtasks();
      emit('items-changed', state.items);
      return;
    }

    // 勾选/取消勾选具体步骤 (一步步完结)
    const row = e.target.closest('.detail-step-row');
    if (row) {
      const subId = row.dataset.subId;
      const sub = currentTask.subtasks.find(s => s.id === subId);
      if (sub) {
        sub.done = !sub.done;

        // 如果所有步骤都已完成，联动将主任务完成；反之若还有未完步骤则保持主任务激活
        const { total, completed } = calculateProgress(currentTask.subtasks);
        if (total > 0 && completed === total) {
          currentTask.done = true;
        } else if (currentTask.done && completed < total) {
          currentTask.done = false;
        }

        saveState();
        renderDetailContent();
        emit('items-changed', state.items);
      }
    }
  });

  // 6. 添加新步骤
  const addStepAction = () => {
    if (!currentTask) return;
    const input = $('#detailNewStepInput');
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;

    if (!Array.isArray(currentTask.subtasks)) {
      currentTask.subtasks = [];
    }
    currentTask.subtasks.push(createSubtask(val));
    input.value = '';
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

  // 7. 实时保存标题和指南文本
  $('#detailTitleInput')?.addEventListener('blur', saveCurrentInputs);
  $('#detailNoteTextarea')?.addEventListener('blur', saveCurrentInputs);
}
