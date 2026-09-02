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

  // 如果所有子任务都完成，可以建议或联动主任务
  const { total, completed } = calculateProgress(task.subtasks);
  if (total > 0 && completed === total) {
    task.done = true;
  } else if (task.done && completed < total) {
    task.done = false;
  }

  saveState();
  emit('items-changed', state.items);
}

/**
 * 在编辑弹窗中渲染子任务列表与动态输入项
 */
export function renderModalSubtasksEditor(container, subtasks = []) {
  container.innerHTML = `
    <div class="modal-subtasks-editor">
      <div class="subtasks-edit-header">
        <label class="fld-label">执行步骤清单 (Checklist)</label>
        <button type="button" class="btn-line btn-sm" id="btnAddSubtaskItem">+ 增加步骤</button>
      </div>
      <div class="subtasks-edit-rows" id="subtasksEditRows"></div>
    </div>
  `;

  const rowsWrap = container.querySelector('#subtasksEditRows');
  const renderRows = (items) => {
    rowsWrap.innerHTML = items.map((st, idx) => `
      <div class="subtask-edit-row" data-index="${idx}">
        <span class="subtask-edit-num">${idx + 1}.</span>
        <input type="text" class="subtask-edit-input" value="${escapeHtml(st.title)}" placeholder="步骤描述...">
        <button type="button" class="subtask-edit-del" aria-label="删除步骤">✕</button>
      </div>
    `).join('');

    // 绑定删除事件
    rowsWrap.querySelectorAll('.subtask-edit-del').forEach((btn, idx) => {
      btn.onclick = () => {
        subtasks.splice(idx, 1);
        renderRows(subtasks);
      };
    });

    // 绑定输入改变
    rowsWrap.querySelectorAll('.subtask-edit-input').forEach((input, idx) => {
      input.oninput = (e) => {
        subtasks[idx].title = e.target.value;
      };
    });
  };

  renderRows(subtasks);

  container.querySelector('#btnAddSubtaskItem').onclick = () => {
    subtasks.push(createSubtask(''));
    renderRows(subtasks);
    // 聚焦到新增加的输入框
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
