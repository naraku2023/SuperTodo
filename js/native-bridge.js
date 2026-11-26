/**
 * 原生 Android 桥接与桌面小组件 / 定时提醒调度数据构造器
 * 在 Web 浏览器环境自动平滑降级
 */

import { getTodayYmd, addDaysYmd } from './models.js';
import { getProjectById, getProjectByName } from './state.js';

const PRIORITY_RANK = { urgent: 4, high: 3, medium: 2, low: 1 };

export function getBridge() {
  if (typeof window !== 'undefined' && window.SuperTodoAndroid) {
    return window.SuperTodoAndroid;
  }
  return null;
}

export function isNativeAndroid() {
  return Boolean(getBridge());
}

/**
 * 构造发送给 Android 4x2 桌面小组件的结构化 JSON 负载
 * 排序权重：已逾期 > 今日安排 > 高优先级(P1/P2) > 近期未完成，最多取 6 条
 */
export function buildWidgetPayload(items = [], projects = [], nowDate = new Date()) {
  const today = getTodayYmd(nowDate);
  const tomorrow = addDaysYmd(today, 1);

  const active = items.filter(i => !i.done);
  const overdueItems = active.filter(i => i.due && i.due < today);
  const todayItems = active.filter(i =>
    (i.due && i.due === today) ||
    (i.startDate && i.startDate <= today && (!i.due || i.due >= today))
  );
  const tomorrowItems = active.filter(i => i.due && i.due === tomorrow);

  const doneTodayCount = items.filter(i => {
    if (!i.done || !i.completedAt) return false;
    return getTodayYmd(new Date(i.completedAt)) === today;
  }).length;

  const scoreItem = (it) => {
    const isOverdue = Boolean(it.due && it.due < today);
    const isToday = Boolean(
      (it.due && it.due === today) ||
      (it.startDate && it.startDate <= today && (!it.due || it.due >= today))
    );
    const prio = PRIORITY_RANK[it.priority] || 2;
    let tier = 1;
    if (isOverdue) tier = 4;
    else if (isToday) tier = 3;
    else if (prio >= 3) tier = 2;
    return { tier, prio, due: it.due || '9999-99-99', time: it.startTime || '99:99', order: it.order ?? 0 };
  };

  const sorted = active.slice().sort((a, b) => {
    const sa = scoreItem(a);
    const sb = scoreItem(b);
    if (sb.tier !== sa.tier) return sb.tier - sa.tier;
    if (sb.prio !== sa.prio) return sb.prio - sa.prio;
    if (sa.due !== sb.due) return sa.due.localeCompare(sb.due);
    if (sa.time !== sb.time) return sa.time.localeCompare(sb.time);
    return sa.order - sb.order;
  });

  const topItems = sorted.slice(0, 6).map(it => {
    const proj = projects.find(p => p.id === it.projectId) || getProjectById?.(it.projectId) || getProjectByName?.(it.type);
    const overdue = Boolean(it.due && it.due < today);
    const dueToday = Boolean(it.due && it.due === today);

    const metaParts = [];
    if (overdue) metaParts.push(`已逾期(${it.due.slice(5)})`);
    else if (dueToday) metaParts.push(it.startTime ? `今天 ${it.startTime}` : '今天截止');
    else if (it.due) metaParts.push(it.due.slice(5));
    else if (it.startDate && it.startDate <= today) metaParts.push('进行中');

    if (it.durationMin) {
      metaParts.push(it.durationMin >= 60 && it.durationMin % 60 === 0 ? `${it.durationMin / 60}h` : `${it.durationMin}m`);
    }
    if (proj) metaParts.push(proj.name);

    return {
      id: it.id,
      title: it.title || '未命名事项',
      meta: metaParts.join(' · ') || '待办安排',
      priority: it.priority || 'medium',
      overdue,
      dueToday,
      projName: proj ? proj.name : '收集箱'
    };
  });

  return {
    updatedAt: nowDate.getTime(),
    overdueCount: overdueItems.length,
    todayCount: todayItems.length,
    tomorrowCount: tomorrowItems.length,
    activeCount: active.length,
    doneTodayCount,
    items: topItems
  };
}

/**
 * 构造原生系统定时闹钟调度 JSON（早报 + 晚间复盘 + 未来7天有具体时段的事项）
 */
export function buildReminderSchedule(stateObj, nowTs = Date.now()) {
  const rem = stateObj.reminders || {};
  const enabled = rem.enabled !== false;
  const horizonTs = nowTs + 7 * 86400000;
  const taskAlarms = [];

  if (enabled && rem.taskExactEnabled !== false) {
    (stateObj.items || []).forEach(it => {
      if (it.done) return;
      const dateStr = it.due || it.startDate;
      if (!dateStr || !it.startTime) return;
      const [y, m, d] = dateStr.split('-').map(Number);
      const [hh, mm] = it.startTime.split(':').map(Number);
      if (!y || !m || !d || isNaN(hh) || isNaN(mm)) return;
      const triggerAt = new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
      if (triggerAt > nowTs + 15000 && triggerAt <= horizonTs) {
        const proj = (stateObj.projects || []).find(p => p.id === it.projectId);
        taskAlarms.push({
          id: it.id,
          title: it.title,
          detail: [proj ? `${proj.icon} ${proj.name}` : '', it.durationMin ? `预计 ${it.durationMin} 分钟` : '', it.note ? it.note.slice(0, 40) : ''].filter(Boolean).join(' · ') || '事项时间已到，请及时处理',
          triggerAt
        });
      }
    });
    taskAlarms.sort((a, b) => a.triggerAt - b.triggerAt);
  }

  return {
    enabled,
    morningEnabled: enabled && rem.morningEnabled !== false,
    morningTime: rem.morningTime || '08:30',
    eveningEnabled: enabled && rem.eveningEnabled !== false,
    eveningTime: rem.eveningTime || '21:00',
    taskAlarms: taskAlarms.slice(0, 20)
  };
}

/**
 * 同步状态到原生小组件与闹钟调度器
 */
export function syncNativeState(stateObj) {
  const bridge = getBridge();
  if (!bridge) return false;
  try {
    const widgetPayload = buildWidgetPayload(stateObj.items, stateObj.projects);
    const reminderPayload = buildReminderSchedule(stateObj);
    bridge.syncWidgetData?.(JSON.stringify(widgetPayload));
    bridge.scheduleReminders?.(JSON.stringify(reminderPayload));
    return true;
  } catch (e) {
    console.warn('syncNativeState failed:', e);
    return false;
  }
}

export function requestNotificationPermission() {
  const bridge = getBridge();
  if (bridge?.requestNotificationPermission) {
    bridge.requestNotificationPermission();
    return true;
  }
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
  return false;
}

export function sendTestNotification(stateObj) {
  const bridge = getBridge();
  if (bridge?.sendTestNotification) {
    syncNativeState(stateObj);
    bridge.sendTestNotification();
    return { mode: 'native', ok: true };
  }
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification('☀️ 超级清单 · 测试提醒', { body: '网页版预览：原生 Android APK 内将触发高优悬浮通知与闹钟震动' });
    return { mode: 'web', ok: true };
  }
  return { mode: 'toast', ok: true };
}

export function openXiaomiPermission(type) {
  const bridge = getBridge();
  if (bridge?.openXiaomiPermission) {
    bridge.openXiaomiPermission(String(type || 'notification'));
    return true;
  }
  return false;
}

export function getNativeStatus() {
  const bridge = getBridge();
  if (!bridge?.getNativeStatus) {
    return { isNative: false, hasNotificationPerm: false, canExactAlarm: false };
  }
  try {
    return JSON.parse(bridge.getNativeStatus());
  } catch (e) {
    return { isNative: true, hasNotificationPerm: true, canExactAlarm: true };
  }
}

export function consumeWidgetToggles() {
  const bridge = getBridge();
  if (!bridge?.consumeWidgetToggles) return [];
  try {
    const raw = bridge.consumeWidgetToggles();
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

export function consumePendingAction() {
  const bridge = getBridge();
  if (!bridge?.consumePendingAction) return '';
  try {
    return String(bridge.consumePendingAction() || '');
  } catch (e) {
    return '';
  }
}
