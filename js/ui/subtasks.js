/**
 * 子任务 (Subtasks / Checklist) 交互组件
 */

import { state, saveState, emit } from '../state.js';
import { calculateProgress, createSubtask } from '../models.js';

/**
 * 渲染主列表卡片上的子任务进度条与折叠区域
 */
export function renderSubtasksHtml(task) {
  if (!task.subtasks || task.subtasks.length === 0) {
    return '';
  }

  const { total, completed, percent } = calculateProgress(task.subtasks);
  const isAllDone = total > 0 && completed === total;

  let subtaskItemsHtml = '';
  task.subtasks.forEach(st => {
    subtaskItemsHtml += `
      <div class="subtask-row ${st.done ? 'done' : ''}" data-task-id="${task.id}" data-sub-id="${st.id}">
        <label class="subtask-chk-wrap">
          <input type="checkbox" class="subtask-chk" ${st.done ? 'checked' : ''}>
          <span class="subtask-box"></span>
        </label>
        <span class="subtask-title">${escapeHtml(st.title)}</span>
      </div>
    `;
  });

  return `
    <div class="task-subtasks-box" data-task-id="${task.id}">
      <div class="subtasks-summary" onclick="event.stopPropagation(); window.toggleSubtasksCollapse('${task.id}')">
        <span class="subtasks-badge ${isAllDone ? 'all-done' : ''}">
          <span class="st-icon">☑</span> ${completed}/${total} 步骤
        </span>
        <div class="subtasks-bar-wrap">
          <div class="subtasks-bar" style="width: ${percent}%;"></div>
        </div>
        <span class="subtasks-toggle-btn" id="subChevron_${task.id}">▾</span>
      </div>
      <div class="subtasks-list-collapse" id="subList_${task.id}" hidden>
        ${subtaskItemsHtml}
      </div>
    </div>
  `;
}

/**
 * 切换子任务完成状态
 */
export function toggleSubtask(taskId, subtaskId) {
  const task = state.items.find(t => t.id === taskId);
  if (!task || !task.subtasks) return;

  const sub = task.subtasks.find(s => s.id === subtaskId);
  if (!sub) return;

  sub.done = !sub.done;

  const { total, completed } = calculateProgress(task.subtasks);
  if (total > 0 && completed === total) {
    task.done = true;
    task.status = 'done';
    task.completedAt = Date.now();
  } else if (task.done && completed < total) {
    task.done = false;
    task.status = 'in_progress';
    task.completedAt = null;
  }

  saveState();
  emit('items-changed', state.items);
}

/**
 * 在新建/编辑弹窗中渲染子任务编辑器（支持阶段名 + 单步截止日期 + 标题）
 */
export function renderModalSubtasksEditor(container, subtasks = []) {
  container.innerHTML = `
    <div class="modal-subtasks-editor">
      <div class="subtasks-edit-header">
        <label class="fld-label" style="margin:0">阶段与执行步骤</label>
        <button type="button" class="btn-line btn-sm" id="btnAddSubtaskItem">+ 增加步骤</button>
      </div>
      <div class="subtasks-edit-rows" id="subtasksEditRows"></div>
    </div>
  `;

  const rowsWrap = container.querySelector('#subtasksEditRows');
  const renderRows = (items) => {
    if (!items.length) {
      rowsWrap.innerHTML = '<div class="subtask-edit-empty">暂无步骤，点击右上角「+ 增加步骤」拆解具体动作</div>';
      return;
    }

    rowsWrap.innerHTML = items.map((st, idx) => `
      <div class="subtask-edit-row" data-index="${idx}">
        <span class="subtask-edit-num">${idx + 1}.</span>
        <input type="text" class="subtask-edit-stage" value="${escapeHtml(st.stage || '')}" placeholder="阶段(可选)">
        <input type="text" class="subtask-edit-input" value="${escapeHtml(st.title || '')}" placeholder="步骤动作描述...">
        <input type="date" class="subtask-edit-due" value="${escapeHtml(st.due || '')}" title="单步截止日期">
        <button type="button" class="subtask-edit-del" aria-label="删除步骤">✕</button>
      </div>
    `).join('');

    rowsWrap.querySelectorAll('.subtask-edit-del').forEach((btn, idx) => {
      btn.onclick = () => {
        subtasks.splice(idx, 1);
        renderRows(subtasks);
      };
    });

    rowsWrap.querySelectorAll('.subtask-edit-stage').forEach((input, idx) => {
      input.oninput = (e) => {
        subtasks[idx].stage = e.target.value.trim();
      };
    });

    rowsWrap.querySelectorAll('.subtask-edit-input').forEach((input, idx) => {
      input.oninput = (e) => {
        subtasks[idx].title = e.target.value;
      };
    });

    rowsWrap.querySelectorAll('.subtask-edit-due').forEach((input, idx) => {
      input.onchange = (e) => {
        subtasks[idx].due = e.target.value;
      };
    });
  };

  renderRows(subtasks);

  container.querySelector('#btnAddSubtaskItem').onclick = () => {
    const lastStage = subtasks.length ? (subtasks[subtasks.length - 1].stage || '') : '';
    subtasks.push(createSubtask({ title: '', stage: lastStage }));
    renderRows(subtasks);
    const inputs = rowsWrap.querySelectorAll('.subtask-edit-input');
    if (inputs.length) inputs[inputs.length - 1].focus();
  };
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
