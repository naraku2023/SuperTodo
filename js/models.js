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
 * 创建子任务对象
 */
export function createSubtask(title = '', done = false) {
  return {
    id: generateId('sub'),
    title: String(title).trim(),
    done: Boolean(done)
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
    order: (typeof data.order === 'number') ? data.order : 0,
    created: data.created || now,
    // 子任务列表
    subtasks: Array.isArray(data.subtasks) 
      ? data.subtasks.map(s => typeof s === 'string' ? createSubtask(s) : { id: s.id || generateId('sub'), title: s.title || '', done: Boolean(s.done) })
      : []
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
 * 计算子任务完成进度
 */
export function calculateProgress(subtasks = []) {
  if (!Array.isArray(subtasks) || subtasks.length === 0) {
    return { total: 0, completed: 0, percent: 0 };
  }
  const completed = subtasks.filter(s => s.done).length;
  const total = subtasks.length;
  const percent = Math.round((completed / total) * 100);
  return { total, completed, percent };
}
