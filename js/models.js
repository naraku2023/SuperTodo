/**
 * 数据模型、日期排期计算与工厂函数
 */

const VALID_YMD = /^\d{4}-\d{2}-\d{2}$/;
const VALID_HM = /^\d{2}:\d{2}$/;
const VALID_STATUSES = ['todo', 'in_progress', 'blocked', 'done'];
const VALID_PRIORITIES = ['urgent', 'high', 'medium', 'low'];
const VALID_REPEATS = ['none', 'daily', 'weekdays', 'weekly', 'monthly'];
const VALID_TEMPLATES = ['general', 'plan', 'shopping', 'travel', 'wish'];

/**
 * 创建唯一 ID
 */
export function generateId(prefix = 'item') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * 获取本地今天的 YYYY-MM-DD 字符串
 */
export function getTodayYmd(baseDate = new Date()) {
  const y = baseDate.getFullYear();
  const m = String(baseDate.getMonth() + 1).padStart(2, '0');
  const d = String(baseDate.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 对 YYYY-MM-DD 进行天数偏移（避免 UTC 时区漂移）
 */
export function addDaysYmd(ymd, days = 0) {
  if (!ymd || !VALID_YMD.test(ymd)) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return getTodayYmd(dt);
}

/**
 * 对 YYYY-MM-DD 进行月数偏移（正确处理月底日期）
 */
function addMonthsYmd(ymd, months = 1) {
  if (!ymd || !VALID_YMD.test(ymd)) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  const target = new Date(y, m - 1 + months, 1);
  const maxDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, maxDay));
  return getTodayYmd(target);
}

/**
 * 计算跳过周末的下一工作日
 */
function nextWeekdayYmd(ymd) {
  let next = addDaysYmd(ymd, 1);
  for (let i = 0; i < 7; i++) {
    const [y, m, d] = next.split('-').map(Number);
    const day = new Date(y, m - 1, d).getDay();
    if (day !== 0 && day !== 6) return next;
    next = addDaysYmd(next, 1);
  }
  return next;
}

/**
 * 根据重复周期计算下一次的 startDate 与 due
 */
export function getNextRepeatDates(task) {
  const repeat = VALID_REPEATS.includes(task?.repeat) ? task.repeat : 'none';
  if (repeat === 'none') return { startDate: task?.startDate || '', due: task?.due || '' };

  const today = getTodayYmd();
  const baseDate = task?.due || task?.startDate || today;

  const shiftDate = (ymd) => {
    if (!ymd) return '';
    if (repeat === 'daily') return addDaysYmd(ymd, 1);
    if (repeat === 'weekdays') return nextWeekdayYmd(ymd);
    if (repeat === 'weekly') return addDaysYmd(ymd, 7);
    if (repeat === 'monthly') return addMonthsYmd(ymd, 1);
    return ymd;
  };

  let nextDue = task?.due ? shiftDate(task.due) : '';
  let nextStart = task?.startDate ? shiftDate(task.startDate) : '';

  if (!nextDue && !nextStart) {
    nextDue = shiftDate(baseDate);
  }

  return { startDate: nextStart, due: nextDue };
}

/**
 * 基于已完成的重复事项生成下一期事项副本（保留结构模板，重置进度与会话）
 */
export function createNextRepeatTask(task) {
  const { startDate, due } = getNextRepeatDates(task);
  const nextSubtasks = Array.isArray(task.subtasks)
    ? task.subtasks.map(s => createSubtask({
        title: s.title,
        stage: s.stage,
        durationMin: s.durationMin,
        note: s.note,
        done: false
      }))
    : [];

  return createTask({
    title: task.title,
    note: task.note,
    projectId: task.projectId,
    type: task.type,
    template: task.template,
    tags: task.tags,
    scene: task.scene,
    time: task.time,
    cost: task.cost,
    star: task.star,
    status: 'todo',
    priority: task.priority,
    startDate,
    due,
    startTime: task.startTime,
    endTime: task.endTime,
    durationMin: task.durationMin,
    repeat: task.repeat,
    stages: task.stages,
    subtasks: nextSubtasks,
    extra: task.extra ? {
      ...task.extra,
      shoppingItems: Array.isArray(task.extra.shoppingItems)
        ? task.extra.shoppingItems.map(si => ({ ...si, id: generateId('shop'), bought: false }))
        : []
    } : undefined
  });
}

/**
 * 创建项目空间对象
 */
export function createProject(data = {}) {
  const now = Date.now();
  return {
    id: data.id || generateId('proj'),
    name: String(data.name || '未命名项目').trim() || '未命名项目',
    icon: String(data.icon || '📁').trim() || '📁',
    color: String(data.color || '#0b57d0').trim() || '#0b57d0',
    template: VALID_TEMPLATES.includes(data.template) ? data.template : 'general',
    desc: String(data.desc || '').trim(),
    created: data.created || now
  };
}

/**
 * 创建子任务对象（支持任意前缀阶段标签、单步排期、预计耗时与备注）
 */
export function createSubtask(data = '', done = false, stage = '') {
  let title = '';
  let st = stage;
  let isDone = done;
  let id = null;
  let due = '';
  let durationMin = null;
  let note = '';

  if (typeof data === 'object' && data !== null) {
    id = data.id;
    title = String(data.title || '').trim();
    isDone = Boolean(data.done);
    st = data.stage || stage || '';
    due = (typeof data.due === 'string' && VALID_YMD.test(data.due)) ? data.due : '';
    durationMin = (data.durationMin !== null && data.durationMin !== undefined && !isNaN(data.durationMin) && Number(data.durationMin) > 0)
      ? Math.round(Number(data.durationMin))
      : null;
    note = String(data.note || '').trim();
  } else {
    title = String(data || '').trim();
  }

  // 支持【阶段一：xxx】、【出行准备】、[Day 1] 等任意阶段前缀
  if (!st && title) {
    const m = title.match(/^[【\[]([^】\]]{1,24})[】\]]\s*(.+)$/);
    if (m) {
      st = m[1].trim();
      title = m[2].trim();
    }
  }

  return {
    id: id || generateId('sub'),
    title,
    stage: String(st || '').trim(),
    due,
    durationMin,
    note,
    done: isDone
  };
}

/**
 * 规范化分类专属结构化扩展数据 extra
 */
export function normalizeTaskExtra(extra = {}) {
  const src = (extra && typeof extra === 'object') ? extra : {};

  const shoppingItems = Array.isArray(src.shoppingItems)
    ? src.shoppingItems.map(item => ({
        id: item.id || generateId('shop'),
        name: String(item.name || '').trim(),
        qty: (item.qty !== undefined && !isNaN(item.qty) && Number(item.qty) > 0) ? Number(item.qty) : 1,
        unit: String(item.unit || '').trim(),
        price: (item.price !== null && item.price !== undefined && !isNaN(item.price)) ? Number(item.price) : 0,
        store: String(item.store || '').trim(),
        bought: Boolean(item.bought)
      })).filter(it => it.name)
    : [];

  const tp = (src.travelPlan && typeof src.travelPlan === 'object') ? src.travelPlan : {};
  const travelPlan = {
    destination: String(tp.destination || '').trim(),
    days: (tp.days !== null && tp.days !== undefined && !isNaN(tp.days) && Number(tp.days) > 0) ? Math.round(Number(tp.days)) : null,
    transport: String(tp.transport || '').trim(),
    hotel: String(tp.hotel || '').trim(),
    itinerary: Array.isArray(tp.itinerary)
      ? tp.itinerary.map(row => ({
          id: row.id || generateId('itin'),
          day: String(row.day || 'Day 1').trim(),
          timeSlot: String(row.timeSlot || '').trim(),
          place: String(row.place || '').trim(),
          activity: String(row.activity || '').trim(),
          cost: (row.cost !== null && row.cost !== undefined && !isNaN(row.cost) && Number(row.cost) > 0) ? Number(row.cost) : null,
          done: Boolean(row.done)
        })).filter(row => row.place || row.activity)
      : []
  };

  const wm = (src.wishMeta && typeof src.wishMeta === 'object') ? src.wishMeta : {};
  const wishMeta = {
    savedAmount: (wm.savedAmount !== null && wm.savedAmount !== undefined && !isNaN(wm.savedAmount)) ? Math.max(0, Number(wm.savedAmount)) : 0,
    targetAmount: (wm.targetAmount !== null && wm.targetAmount !== undefined && !isNaN(wm.targetAmount) && Number(wm.targetAmount) > 0) ? Number(wm.targetAmount) : null,
    rewardNote: String(wm.rewardNote || '').trim()
  };

  const pm = (src.planMeta && typeof src.planMeta === 'object') ? src.planMeta : {};
  const planMeta = {
    goalMetric: String(pm.goalMetric || '').trim(),
    reviewNotes: String(pm.reviewNotes || '').trim()
  };

  return { shoppingItems, travelPlan, wishMeta, planMeta };
}

/**
 * 规范化显式阶段列表（支持字符串或 { name, targetDate, desc }）
 */
function normalizeStages(stages = []) {
  if (!Array.isArray(stages)) return [];
  const seen = new Set();
  const out = [];
  for (const s of stages) {
    const name = typeof s === 'string' ? s.trim() : String(s?.name || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(typeof s === 'string'
      ? { name, targetDate: '', desc: '' }
      : {
          name,
          targetDate: (typeof s.targetDate === 'string' && VALID_YMD.test(s.targetDate)) ? s.targetDate : '',
          desc: String(s.desc || '').trim()
        }
    );
  }
  return out;
}

/**
 * 创建待办事项对象
 */
export function createTask(data = {}) {
  const now = Date.now();
  const isDone = Boolean(data.done) || data.status === 'done';

  let status = VALID_STATUSES.includes(data.status) ? data.status : 'todo';
  if (isDone) status = 'done';
  else if (status === 'done') status = 'todo';

  const rawStar = (typeof data.star === 'number' && data.star >= 0 && data.star <= 5) ? Math.round(data.star) : 0;
  let priority = VALID_PRIORITIES.includes(data.priority) ? data.priority : '';
  if (!priority) {
    if (rawStar >= 5) priority = 'urgent';
    else if (rawStar >= 4) priority = 'high';
    else if (rawStar === 1) priority = 'low';
    else priority = 'medium';
  }

  const tagsSet = new Set();
  if (Array.isArray(data.tags)) {
    data.tags.forEach(t => {
      const v = String(t || '').trim();
      if (v) tagsSet.add(v);
    });
  }

  const chatHistory = Array.isArray(data.chatHistory)
    ? data.chatHistory.map(m => ({
        id: m.id || generateId('msg'),
        role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
        content: String(m.content || ''),
        actionPayload: m.actionPayload || null,
        actionApplied: Boolean(m.actionApplied),
        timestamp: m.timestamp || now
      }))
    : [];

  const lastMsgTs = chatHistory.length ? chatHistory[chatHistory.length - 1].timestamp : null;
  const subtasks = Array.isArray(data.subtasks) ? data.subtasks.map(s => createSubtask(s)) : [];
  const stages = normalizeStages(data.stages);

  // 确保 subtasks 中出现的阶段也被录入 stages 元信息中，保持一致
  const stageNames = new Set(stages.map(s => s.name));
  subtasks.forEach(s => {
    if (s.stage && !stageNames.has(s.stage)) {
      stageNames.add(s.stage);
      stages.push({ name: s.stage, targetDate: '', desc: '' });
    }
  });

  return {
    id: data.id || generateId('item'),
    title: String(data.title || '').trim(),
    note: String(data.note || '').trim(),

    // 分类与项目归属
    projectId: typeof data.projectId === 'string' ? data.projectId.trim() : '',
    type: String(data.type || '待办').trim(),
    template: VALID_TEMPLATES.includes(data.template) ? data.template : '',
    tags: Array.from(tagsSet),
    scene: String(data.scene || '').trim(),
    time: String(data.time || '').trim(),

    // 排期与执行控制
    status,
    priority,
    startDate: (typeof data.startDate === 'string' && VALID_YMD.test(data.startDate)) ? data.startDate : '',
    due: (typeof data.due === 'string' && VALID_YMD.test(data.due)) ? data.due : '',
    startTime: (typeof data.startTime === 'string' && VALID_HM.test(data.startTime)) ? data.startTime : '',
    endTime: (typeof data.endTime === 'string' && VALID_HM.test(data.endTime)) ? data.endTime : '',
    durationMin: (data.durationMin !== null && data.durationMin !== undefined && !isNaN(data.durationMin) && Number(data.durationMin) > 0)
      ? Math.round(Number(data.durationMin))
      : null,
    repeat: VALID_REPEATS.includes(data.repeat) ? data.repeat : 'none',

    // 价值与完成
    cost: (data.cost !== null && data.cost !== undefined && data.cost !== '' && !isNaN(data.cost)) ? Number(data.cost) : null,
    star: rawStar,
    done: isDone,
    completedAt: isDone ? (data.completedAt || now) : null,
    order: (typeof data.order === 'number') ? data.order : 0,
    created: data.created || now,
    updated: data.updated || data.created || now,

    // 阶段与子步骤
    stages,
    subtasks,

    // 分类专属结构化数据
    extra: normalizeTaskExtra(data.extra),

    // 一事项一独立会话
    sessionId: data.sessionId || generateId('sess'),
    chatHistory: chatHistory.map(m => ({
      ...m,
      kind: m.kind || 'normal',
      usage: m.usage || null,
      checkpoint: m.checkpoint || null
    })),
    lastChatAt: data.lastChatAt || lastMsgTs || null,
    sessionMeta: createSessionMeta(data.sessionMeta)
  };
}

/**
 * 估算文本 Token 数（中文约 1.5 字/token，ASCII 约 4 字符/token）
 */
export function estimateTokens(text) {
  if (!text) return 0;
  const s = String(text);
  let nonAscii = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 127) nonAscii++;
  }
  const ascii = s.length - nonAscii;
  return Math.ceil(nonAscii / 1.5 + ascii / 4);
}

/**
 * 创建会话生命周期与压缩元数据
 */
export function createSessionMeta(data = {}) {
  const src = (data && typeof data === 'object') ? data : {};
  return {
    pinned: Boolean(src.pinned),
    compactions: Array.isArray(src.compactions) ? src.compactions.slice(-20) : [],
    activeSummary: String(src.activeSummary || ''),
    compactedUpToMsgId: src.compactedUpToMsgId || null,
    totalTokensUsed: Number(src.totalTokensUsed) || 0,
    totalCacheHitTokens: Number(src.totalCacheHitTokens) || 0,
    lastUsage: (src.lastUsage && typeof src.lastUsage === 'object') ? src.lastUsage : null
  };
}

/**
 * 创建一次上下文压缩检查点记录
 */
export function createCompactionCheckpoint({
  summary = '',
  compactedUpToMsgId = null,
  compactedCount = 0,
  tokenBefore = 0,
  tokenAfter = 0
}) {
  return {
    id: generateId('cmp'),
    timestamp: Date.now(),
    summary: String(summary || ''),
    compactedUpToMsgId,
    compactedCount,
    tokenBefore,
    tokenAfter
  };
}

/**
 * 创建聊天对话消息对象
 */
export function createChatMessage(role, content, actionPayload = null, actionApplied = false, extra = {}) {
  return {
    id: generateId('msg'),
    role, // 'user' | 'assistant' | 'system'
    kind: extra.kind || 'normal', // 'normal' | 'checkpoint'
    content: String(content || ''),
    actionPayload,
    actionApplied: Boolean(actionApplied),
    usage: extra.usage || null,
    checkpoint: extra.checkpoint || null,
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
 * 计算购物清单统计汇总
 */
export function calculateShoppingStats(extra) {
  const items = extra?.shoppingItems || [];
  const totalCount = items.length;
  const boughtCount = items.filter(i => i.bought).length;
  let totalAmount = 0;
  let boughtAmount = 0;
  items.forEach(i => {
    const line = (Number(i.qty) || 1) * (Number(i.price) || 0);
    totalAmount += line;
    if (i.bought) boughtAmount += line;
  });
  return {
    totalCount,
    boughtCount,
    totalAmount: Math.round(totalAmount * 100) / 100,
    boughtAmount: Math.round(boughtAmount * 100) / 100
  };
}

/**
 * 将子任务按阶段 (Stage) 归类分组，同时保留显式新建的空阶段
 */
export function groupSubtasksByStage(subtasks = [], explicitStages = []) {
  const normalizedExplicit = normalizeStages(explicitStages);
  const hasExplicit = normalizedExplicit.length > 0;
  const hasSubtaskStage = Array.isArray(subtasks) && subtasks.some(s => Boolean(s.stage));

  if (!hasExplicit && !hasSubtaskStage) {
    if (!Array.isArray(subtasks) || subtasks.length === 0) return [];
    return [{
      stage: '',
      meta: null,
      items: subtasks,
      ...calculateProgress(subtasks)
    }];
  }

  const map = new Map();
  const metaMap = new Map();

  // 先按显式阶段顺序占位（保证空阶段也会显示）
  normalizedExplicit.forEach(st => {
    metaMap.set(st.name, st);
    if (!map.has(st.name)) map.set(st.name, []);
  });

  (subtasks || []).forEach(s => {
    const stKey = s.stage || '其他步骤';
    if (!map.has(stKey)) map.set(stKey, []);
    map.get(stKey).push(s);
  });

  const groups = [];
  map.forEach((items, stage) => {
    groups.push({
      stage,
      meta: metaMap.get(stage) || null,
      items,
      ...calculateProgress(items)
    });
  });
  return groups;
}
