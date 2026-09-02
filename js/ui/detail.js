/**
 * 任务详情页模块 (Task Detail Sheet)
 * 升级特性：
 * 1. 支持任务阶段性多级细分 (Stages & Sub-steps)
 * 2. 针对购物、计划、旅游、愿望、待办各分类的专属显示模板
 * 3. 宽大舒适的执行指南与落地策略画布 (优雅排版阅读模式 + 宽敞编辑模式)
 */

import { state, saveState, emit } from '../state.js';
import { calculateProgress, createSubtask, groupSubtasksByStage } from '../models.js';
import { openEdit, pushLayer, syncBack, confirmDlg, showToast } from './modals.js';
import { escapeHtml, fmtDue, isOverdue } from './list.js';

let currentTask = null;
let isEditingNote = false;

const $ = s => document.querySelector(s);

export function openDetail(task) {
  if (!task) return;
  currentTask = task;
  isEditingNote = false;

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
  isEditingNote = false;
  syncBack();
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

  // 3. 分类定制专属模板展示栏
  renderCategoryTemplate(t);

  // 4. 渲染阶段性子任务步骤清单
  renderDetailSubtasks();

  // 5. 渲染宽大舒适的执行指南与详细说明
  renderGuideSection();

  // 6. 创建时间与完成时间底部信息
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
}

/**
 * 分类定制专属模板 (Category-Specific Templates)
 */
function renderCategoryTemplate(t) {
  const metaBar = $('#detailMetaBar');
  if (!metaBar) return;

  const type = t.type || '待办';
  let html = '';

  // 基础分类标签
  html += `<span class="detail-tag type-tag type-${escapeHtml(type)}">${escapeHtml(type)}</span>`;

  // 截止日期
  if (t.due) {
    const overdue = isOverdue(t.due) && !t.done;
    html += `
      <span class="detail-tag due-tag ${overdue ? 'overdue' : ''}">
        📅 ${fmtDue(t.due)} 截止
      </span>
    `;
  }

  // 已归档完成时间标签
  if (t.done) {
    const cd = new Date(t.completedAt || t.updated || t.created);
    const timeStr = `${cd.getFullYear()}-${String(cd.getMonth() + 1).padStart(2, '0')}-${String(cd.getDate()).padStart(2, '0')} ${String(cd.getHours()).padStart(2, '0')}:${String(cd.getMinutes()).padStart(2, '0')}`;
    html += `<span class="detail-tag tag-completed-status">✓ 已归档 (${timeStr} 完成)</span>`;
  }

  // 根据分类渲染专属模块
  if (type === '购物') {
    const costText = (t.cost != null && t.cost > 0) ? `¥${t.cost}` : '未设预算';
    html += `
      <span class="detail-tag cost-tag">🛒 预算估算: ${costText}</span>
    `;
  } else if (type === '计划') {
    const stageGroups = groupSubtasksByStage(t.subtasks || []);
    const stageCount = stageGroups.filter(g => Boolean(g.stage)).length;
    if (stageCount > 0) {
      html += `<span class="detail-tag plan-tag">🎯 ${stageCount} 个执行阶段</span>`;
    }
  } else if (type === '旅游') {
    if (t.scene) {
      html += `<span class="detail-tag travel-tag">✈️ 目的地: ${escapeHtml(t.scene)}</span>`;
    }
  } else if (type === '愿望') {
    const stars = t.star ? '★'.repeat(t.star) : '★★★';
    html += `<span class="detail-tag wish-tag">🌟 心愿指数: ${stars}</span>`;
  }

  if (t.scene && type !== '旅游') {
    html += `<span class="detail-tag scene-tag">${escapeHtml(t.scene)}</span>`;
  }

  metaBar.innerHTML = html;
}

/**
 * 渲染阶段性子任务步骤（支持阶段分层与一步步打勾完结）
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
        暂无拆解步骤，可以在下方输入添加具体执行打卡清单。
      </div>
    `;
    return;
  }

  // 按阶段分组
  const stageGroups = groupSubtasksByStage(subtasks);
  const hasMultipleStages = stageGroups.length > 1 || (stageGroups.length === 1 && Boolean(stageGroups[0].stage));

  let html = '';

  if (hasMultipleStages) {
    // 渲染分阶段卡片 (Stages & Sub-steps)
    stageGroups.forEach((group, gIdx) => {
      const stageName = group.stage || '其他待办事项';
      const isStageDone = group.total > 0 && group.completed === group.total;

      html += `
        <div class="detail-stage-block ${isStageDone ? 'stage-all-done' : ''}">
          <div class="stage-header">
            <span class="stage-icon">📌</span>
            <span class="stage-name">${escapeHtml(stageName)}</span>
            <span class="stage-badge">${group.completed}/${group.total}</span>
            <div class="stage-bar-wrap">
              <div class="stage-bar-fill" style="width:${group.percent}%"></div>
            </div>
          </div>
          <div class="stage-step-items">
            ${group.items.map(st => renderStepRowHtml(st)).join('')}
          </div>
        </div>
      `;
    });
  } else {
    // 平铺渲染普通清单
    html = `<div class="detail-flat-steps">${subtasks.map(st => renderStepRowHtml(st)).join('')}</div>`;
  }

  listEl.innerHTML = html;
}

function renderStepRowHtml(st) {
  return `
    <div class="detail-step-row ${st.done ? 'is-done' : ''}" data-sub-id="${st.id}">
      <label class="step-chk-label">
        <input type="checkbox" class="step-real-chk" ${st.done ? 'checked' : ''}>
        <span class="step-chk-box"></span>
      </label>
      <span class="step-title-text ${st.done ? 'done' : ''}">${escapeHtml(st.title)}</span>
      <button type="button" class="step-del-btn" data-del-sub="${st.id}" title="删除步骤">✕</button>
    </div>
  `;
}

/**
 * 渲染宽大舒适的执行指南（阅读模式 vs 编辑模式）
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
          暂无详细指南与备注。点击右上角 <b>✎ 编辑内容</b> 补充落地步骤、备忘指南或思考心得...
        </div>
      `;
    } else {
      // 优雅富文本格式化渲染
      readEl.innerHTML = formatGuideMarkdown(note);
    }
  }
}

/**
 * 将指南文本渲染为排版舒适的结构化内容
 */
function formatGuideMarkdown(text) {
  const lines = text.split('\n');
  let html = '<div class="guide-content-flow">';

  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) {
      html += '<div class="guide-gap"></div>';
      return;
    }

    // 标题类
    if (trimmed.startsWith('【') && trimmed.includes('】')) {
      html += `<div class="guide-section-badge">${escapeHtml(trimmed)}</div>`;
    } else if (/^(\d+[\.\、]|[-*•])\s+/.test(trimmed)) {
      // 列表项或序号项
      const clean = trimmed.replace(/^(\d+[\.\、]|[-*•])\s+/, '');
      html += `
        <div class="guide-list-item">
          <span class="guide-bullet"></span>
          <span class="guide-item-text">${highlightKeyTerms(escapeHtml(clean))}</span>
        </div>
      `;
    } else {
      // 普通段落
      html += `<p class="guide-paragraph">${highlightKeyTerms(escapeHtml(trimmed))}</p>`;
    }
  });

  html += '</div>';
  return html;
}

function highlightKeyTerms(str) {
  // 高亮粗体及关键提示
  return str
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/([0-9]+(?:\.[0-9]+)?(?:[分题天周个次元小时分钟套道章%]+))/g, '<span class="guide-highlight">$1</span>');
}

// ================= 事件初始化与委托 =================

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
  // 1. 关闭按钮
  $('#detailClose')?.addEventListener('click', closeDetail);
  $('#detailDoneBtn')?.addEventListener('click', closeDetail);
  $('#detailMask')?.addEventListener('click', closeDetail);

  // 2. 主任务完成勾选（弹窗确认防误触）
  $('#detailMainChkWrap')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!currentTask) return;
    saveCurrentInputs();

    if (!currentTask.done) {
      confirmDlg(
        '完成事项确认',
        `确定将“${currentTask.title}”标记为已完成并移入已归档吗？`,
        () => {
          currentTask.done = true;
          currentTask.completedAt = Date.now();
          saveState();
          renderDetailContent();
          emit('items-changed', state.items);
          showToast('已完成并移至“已归档”');
        },
        '确认完成'
      );
    } else {
      confirmDlg(
        '恢复待办确认',
        `确定将“${currentTask.title}”从已归档中恢复为未完成待办吗？`,
        () => {
          currentTask.done = false;
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

  // 5. 步骤清单交互：单项打勾、单项删除 (一步步完结)
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

        // 若所有步骤都完成，可联动主任务（弹窗确认防误触）
        const { total, completed } = calculateProgress(currentTask.subtasks);
        if (total > 0 && completed === total && !currentTask.done) {
          saveState();
          renderDetailContent();
          emit('items-changed', state.items);

          confirmDlg(
            '全部步骤已达成',
            `“${currentTask.title}”的所有细分步骤已全部完成，是否立即将整个事项标记为已完结并归档？`,
            () => {
              currentTask.done = true;
              currentTask.completedAt = Date.now();
              saveState();
              renderDetailContent();
              emit('items-changed', state.items);
              showToast('已完成并移至“已归档”');
            },
            '完结并归档'
          );
          return;
        } else if (currentTask.done && completed < total) {
          confirmDlg(
            '取消完结状态',
            `检测到部分细分步骤被取消，是否将“${currentTask.title}”从已归档恢复为进行中的待办事项？`,
            () => {
              currentTask.done = false;
              currentTask.completedAt = null;
              saveState();
              renderDetailContent();
              emit('items-changed', state.items);
              showToast('已恢复至待办清单');
            },
            '恢复为待办'
          );
        } else {
          saveState();
          renderDetailContent();
          emit('items-changed', state.items);
        }
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

  // 7. 指南阅读模式与编辑模式切换
  $('#detailEditNoteBtn')?.addEventListener('click', () => {
    isEditingNote = true;
    renderGuideSection();
    setTimeout(() => $('#detailNoteTextarea')?.focus(), 100);
  });

  $('#guideEmptyPrompt')?.addEventListener('click', () => {
    isEditingNote = true;
    renderGuideSection();
    setTimeout(() => $('#detailNoteTextarea')?.focus(), 100);
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
      saveState();
    }
    isEditingNote = false;
    renderGuideSection();
  });

  // 8. 实时保存标题
  $('#detailTitleInput')?.addEventListener('blur', saveCurrentInputs);

  // 9. 打开此事项的专属 AI 规划顾问
  const openCopilot = () => {
    if (!currentTask) return;
    saveCurrentInputs();
    window.openAiChatDrawer?.(currentTask);
  };
  $('#detailAiBtn')?.addEventListener('click', openCopilot);
  $('#detailOpenAiBtn')?.addEventListener('click', openCopilot);

  // 暴露全局刷新方法供 AI 抽屉采纳动作后即时同步刷新
  window.renderCurrentDetail = () => renderDetailContent();
}
