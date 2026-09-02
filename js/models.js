/**
 * 数据模型与工厂函数
 */

/**
 * 创建唯一ID
 */
export function generateId(prefix = 'item') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * 创建子任务对象（支持阶段性分组 stage）
 */
export function createSubtask(data = '', done = false, stage = '') {
  let title = '';
  let st = stage;
  let isDone = done;
  let id = null;

  if (typeof data === 'object' && data !== null) {
    id = data.id;
    title = String(data.title || '').trim();
    isDone = Boolean(data.done);
    st = data.stage || stage || '';
  } else {
    title = String(data || '').trim();
  }

  // 自动从诸如 "【阶段一：考纲梳理】精读大纲" 中提取 stage 标签
  if (!st) {
    const m = title.match(/^[【\[](阶段[^】\]]+)[】\]]\s*(.*)$/);
    if (m) {
      st = m[1];
      title = m[2] ? m[2].trim() : title;
    }
  }

  return {
    id: id || generateId('sub'),
    title,
    stage: String(st || '').trim(),
    done: isDone
  };
}

/**
 * 创建待办事项对象
 */
export function createTask(data = {}) {
  const now = Date.now();
  return {
    id: data.id || generateId('item'),
    title: String(data.title || '').trim(),
    note: String(data.note || '').trim(),
    type: String(data.type || '待办').trim(),
    scene: String(data.scene || '').trim(),
    time: String(data.time || '').trim(),
    cost: (data.cost !== null && data.cost !== undefined && !isNaN(data.cost)) ? Number(data.cost) : null,
    due: (typeof data.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.due)) ? data.due : '',
    star: (typeof data.star === 'number' && data.star >= 0 && data.star <= 5) ? Math.round(data.star) : 0,
    done: Boolean(data.done),
    completedAt: data.completedAt || (data.done ? (data.completedAt || now) : null),
    order: (typeof data.order === 'number') ? data.order : 0,
    created: data.created || now,
    // 子任务列表
    subtasks: Array.isArray(data.subtasks) 
      ? data.subtasks.map(s => createSubtask(s))
      : [],
    // 事项专属 AI 对话流历史
    chatHistory: Array.isArray(data.chatHistory) ? data.chatHistory : []
  };
}

/**
 * 创建聊天对话消息对象
 */
export function createChatMessage(role, content, actionPayload = null) {
  return {
    id: generateId('msg'),
    role, // 'user' | 'assistant' | 'system'
    content: String(content || ''),
    actionPayload, // { type: 'create_tasks' | 'decompose_goal' | 'update_tasks' | 'query_summary', tasks: [...], targetId: ... }
    timestamp: Date.now()
  };
}

/**
 * 计算任务或步骤完成进度
 */
export function calculateProgress(subtasks = []) {
  if (!Array.isArray(subtasks) || subtasks.length === 0) {
    return { total: 0, completed: 0, percent: 0 };
  }
  const total = subtasks.length;
  const completed = subtasks.filter(s => s.done).length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { total, completed, percent };
}

/**
 * 将子任务按阶段 (Stage) 智能归类分组
 */
export function groupSubtasksByStage(subtasks = []) {
  if (!Array.isArray(subtasks) || subtasks.length === 0) return [];
  
  const hasStage = subtasks.some(s => Boolean(s.stage));
  if (!hasStage) {
    return [{
      stage: '',
      items: subtasks,
      ...calculateProgress(subtasks)
    }];
  }

  const map = new Map();
  subtasks.forEach(s => {
    const stKey = s.stage || '其他待办步骤';
    if (!map.has(stKey)) {
      map.set(stKey, []);
    }
    map.get(stKey).push(s);
  });

  const groups = [];
  map.forEach((items, stage) => {
    groups.push({
      stage,
      items,
      ...calculateProgress(items)
    });
  });
  return groups;
}
