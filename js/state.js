/**
 * 响应式状态管理、本地持久化、旧版数据无缝迁移与主题控制
 */

import { STORAGE_KEY, DEFAULTS, DEFAULT_PROJECTS, DEFAULT_TAGS, PALETTE, COMPACTION_DEFAULTS } from './config.js';
import { createTask, createProject, createSessionMeta } from './models.js';

// 旧版分类名称到默认项目 ID 的映射
const LEGACY_TYPE_MAP = {
  '待办': 'proj_todo',
  '日常待办': 'proj_todo',
  '计划': 'proj_plan',
  '长期计划': 'proj_plan',
  '购物': 'proj_shop',
  '购物采购': 'proj_shop',
  '旅游': 'proj_travel',
  '旅行出行': 'proj_travel',
  '愿望': 'proj_wish',
  '心愿清单': 'proj_wish',
  '工作学习': 'proj_work'
};

// 全局响应式状态
export const state = {
  items: [],
  projects: DEFAULT_PROJECTS.map(p => createProject(p)),
  tags: DEFAULT_TAGS.slice(),
  types: DEFAULTS.types.slice(),
  scenes: DEFAULTS.scenes.slice(),
  times: DEFAULTS.times.slice(),

  // 导航与过滤视图状态
  navMode: 'smart',         // 'smart' | 'project' | 'tag'
  smartView: 'all',         // 'today' | 'upcoming' | 'priority' | 'inbox' | 'all' | 'archived'
  activeProjectId: null,
  activeTag: null,
  statusFilter: 'all',      // 'all' | 'todo' | 'in_progress' | 'blocked'
  groupBy: 'schedule',      // 'schedule' | 'project' | 'status' | 'priority' | 'none'

  // 保留兼容旧字段
  type: '全部',
  sortKey: '默认',
  sortAsc: true,
  view: { name: 'home' },
  search: '',

  // 外观与 AI 设置
  theme: '#0b57d0',
  colorMode: 'system',      // system | light | dark
  ai: {
    enabled: false,
    base: 'https://api.deepseek.com',
    key: '',
    model: 'deepseek-flash',
    thinkingMode: 'disabled',
    autoCompact: COMPACTION_DEFAULTS.autoCompact,
    compactThresholdMsgs: COMPACTION_DEFAULTS.thresholdMessages,
    compactThresholdTokens: COMPACTION_DEFAULTS.thresholdTokens
  },
  // 全局规划总管对话历史与压缩元数据
  chatHistory: [],
  globalSessionMeta: createSessionMeta(),

  // 原生定时提醒与桌面小组件设置
  reminders: {
    enabled: true,
    morningEnabled: true,
    morningTime: '08:30',
    eveningEnabled: true,
    eveningTime: '21:00',
    taskExactEnabled: true,
    inAppBanner: true
  }
};

// 事件订阅发布中心
const listeners = new Map();

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event)?.delete(fn);
}

export function emit(event, data) {
  listeners.get(event)?.forEach(fn => fn(data));
}

// ================= 项目与标签查询辅助 =================

export function getProjectById(projectId) {
  if (!projectId) return null;
  return state.projects.find(p => p.id === projectId) || null;
}

export function getProjectByName(name) {
  if (!name) return null;
  const target = String(name).trim();
  const mappedId = LEGACY_TYPE_MAP[target];
  if (mappedId) {
    const byMapped = getProjectById(mappedId);
    if (byMapped) return byMapped;
  }
  return state.projects.find(p => p.name === target) || null;
}

export function getTaskTemplate(task) {
  if (!task) return 'general';
  if (task.template) return task.template;
  const proj = getProjectById(task.projectId);
  if (proj && proj.template) return proj.template;
  return 'general';
}

export function syncLegacyTypes() {
  state.types = state.projects.map(p => p.name);
}

export function ensureTag(tagName) {
  const v = String(tagName || '').trim();
  if (!v) return;
  if (!state.tags.includes(v)) {
    state.tags.push(v);
  }
}

// ================= IndexedDB 双轨持久化 =================
const DB_NAME = 'SuperTodo_Persistent_DB';
const STORE_NAME = 'app_data';

function openIDB() {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.indexedDB) return resolve(null);
    const req = window.indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => resolve(null);
  });
}

async function idbSave(key, val) {
  try {
    const db = await openIDB();
    if (!db) return;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(val, key);
  } catch (e) {}
}

async function idbLoad(key) {
  try {
    const db = await openIDB();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

/**
 * 迁移并规范化旧版 v1.x/v2.0 数据到项目空间 + 多标签 + 独立会话结构
 */
export function migrateLegacyData(data) {
  if (!data || typeof data !== 'object') return;

  // 1. 项目空间迁移
  if (Array.isArray(data.projects) && data.projects.length) {
    state.projects = data.projects.map(p => createProject(p));
  } else {
    state.projects = DEFAULT_PROJECTS.map(p => createProject(p));
    // 把旧版自定义的 types 自动升格为项目空间
    if (Array.isArray(data.types)) {
      const extraColors = PALETTE.slice();
      data.types.forEach((tName, idx) => {
        const clean = String(tName || '').trim();
        if (!clean) return;
        const mappedId = LEGACY_TYPE_MAP[clean];
        const exists = (mappedId && state.projects.some(p => p.id === mappedId))
          || state.projects.some(p => p.name === clean);
        if (!exists) {
          state.projects.push(createProject({
            name: clean,
            icon: '📁',
            color: extraColors[idx % extraColors.length],
            template: 'general'
          }));
        }
      });
    }
  }
  syncLegacyTypes();

  // 2. 多标签集合迁移
  const tagSet = new Set(Array.isArray(data.tags) && data.tags.length ? data.tags : DEFAULT_TAGS);
  if (Array.isArray(data.scenes)) {
    data.scenes.forEach(s => { if (s && String(s).trim()) tagSet.add(String(s).trim()); });
  }
  state.tags = Array.from(tagSet);

  if (Array.isArray(data.scenes) && data.scenes.length) state.scenes = data.scenes.slice();
  if (Array.isArray(data.times) && data.times.length) state.times = data.times.slice();

  // 3. 事项迁移与结构补全
  if (Array.isArray(data.items)) {
    state.items = data.items.map(raw => {
      const task = createTask(raw);

      // 若旧数据尚未绑定 projectId，根据 type 映射
      if (!task.projectId && raw.projectId !== '') {
        const matched = getProjectByName(task.type);
        if (matched) {
          task.projectId = matched.id;
          task.type = matched.name;
          if (!task.template) task.template = matched.template;
        }
      } else if (task.projectId) {
        const proj = getProjectById(task.projectId);
        if (proj) {
          task.type = proj.name;
          if (!task.template) task.template = proj.template;
        }
      }

      // 将旧版非空 scene 并入 tags
      if (task.scene && !task.tags.includes(task.scene)) {
        task.tags.push(task.scene);
        ensureTag(task.scene);
      }

      // 将任务自身标签同步至全局标签池
      task.tags.forEach(t => ensureTag(t));
      return task;
    });
  }

  // 4. 视图与偏好设置迁移
  if (['smart', 'project', 'tag'].includes(data.navMode)) {
    state.navMode = data.navMode;
  }
  if (['today', 'upcoming', 'priority', 'inbox', 'all', 'archived'].includes(data.smartView)) {
    state.smartView = data.smartView;
  }
  if (data.activeProjectId && getProjectById(data.activeProjectId)) {
    state.activeProjectId = data.activeProjectId;
  }
  if (data.activeTag && state.tags.includes(data.activeTag)) {
    state.activeTag = data.activeTag;
  }
  if (['all', 'todo', 'in_progress', 'blocked'].includes(data.statusFilter)) {
    state.statusFilter = data.statusFilter;
  }
  if (['schedule', 'project', 'status', 'priority', 'none'].includes(data.groupBy)) {
    state.groupBy = data.groupBy;
  } else if (data.groupBy === 'scene' || data.groupBy === 'time') {
    state.groupBy = 'schedule';
  }
  if (data.sortKey) state.sortKey = data.sortKey;
  if (typeof data.sortAsc === 'boolean') state.sortAsc = data.sortAsc;

  if (data.theme) state.theme = data.theme;
  if (data.colorMode) state.colorMode = data.colorMode;
  if (data.ai) {
    let migratedModel = data.ai.model || 'deepseek-flash';
    let migratedThinking = data.ai.thinkingMode || 'disabled';
    if (migratedModel === 'deepseek-chat') {
      migratedModel = 'deepseek-flash';
    } else if (migratedModel === 'deepseek-reasoner') {
      migratedModel = 'deepseek-flash';
      if (!data.ai.thinkingMode) migratedThinking = 'high';
    }
    const isOldDefaultThresh = data.ai.compactThresholdMsgs === 16 && data.ai.compactThresholdTokens === 12000;
    state.ai = Object.assign({
      enabled: false,
      base: 'https://api.deepseek.com',
      key: '',
      model: 'deepseek-flash',
      thinkingMode: 'disabled',
      autoCompact: COMPACTION_DEFAULTS.autoCompact,
      compactThresholdMsgs: COMPACTION_DEFAULTS.thresholdMessages,
      compactThresholdTokens: COMPACTION_DEFAULTS.thresholdTokens
    }, data.ai, {
      model: migratedModel,
      thinkingMode: migratedThinking,
      ...(isOldDefaultThresh ? {
        compactThresholdMsgs: COMPACTION_DEFAULTS.thresholdMessages,
        compactThresholdTokens: COMPACTION_DEFAULTS.thresholdTokens
      } : {})
    });
  }
  if (Array.isArray(data.chatHistory)) {
    state.chatHistory = data.chatHistory.map(m => ({
      ...m,
      kind: m.kind || 'normal',
      usage: m.usage || null,
      checkpoint: m.checkpoint || null
    }));
  }
  state.globalSessionMeta = createSessionMeta(data.globalSessionMeta);
  if (data.reminders && typeof data.reminders === 'object') {
    state.reminders = Object.assign({
      enabled: true,
      morningEnabled: true,
      morningTime: '08:30',
      eveningEnabled: true,
      eveningTime: '21:00',
      taskExactEnabled: true,
      inAppBanner: true
    }, data.reminders);
  }
}

/**
 * 从 IndexedDB / LocalStorage 加载数据（以完整度最高的副本为准，防止配额降级覆盖完整记录）
 */
export async function loadState() {
  try {
    let lsData = null;
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY + '_backup');
    if (raw) {
      try { lsData = JSON.parse(raw); } catch (e) {}
    }

    const idbData = await idbLoad('backup_payload');
    let data = null;

    if (idbData && lsData) {
      if (lsData._lsTrimmed) {
        data = idbData;
      } else {
        data = (idbData._savedAt || 0) > (lsData._savedAt || 0) ? idbData : lsData;
      }
    } else {
      data = idbData || lsData;
    }

    if (!data) return;

    migrateLegacyData(data);
    saveState();
  } catch (err) {
    console.error('Failed to load state:', err);
  }
}

/**
 * 构造轻量 LocalStorage 降级镜像（当超出 5MB 配额时保留摘要与最近 6 条对话）
 */
function buildTrimmedPayload(fullPayload) {
  return {
    ...fullPayload,
    _lsTrimmed: true,
    chatHistory: (fullPayload.chatHistory || []).slice(-6),
    items: (fullPayload.items || []).map(it => ({
      ...it,
      chatHistory: Array.isArray(it.chatHistory) ? it.chatHistory.slice(-6) : []
    }))
  };
}

/**
 * 双轨持久化保存（IndexedDB 全量主存 + LocalStorage 容错降级镜像）
 */
export function saveState() {
  try {
    syncLegacyTypes();
    const payload = {
      _savedAt: Date.now(),
      items: state.items,
      projects: state.projects,
      tags: state.tags,
      types: state.types,
      scenes: state.scenes,
      times: state.times,
      navMode: state.navMode,
      smartView: state.smartView,
      activeProjectId: state.activeProjectId,
      activeTag: state.activeTag,
      statusFilter: state.statusFilter,
      groupBy: state.groupBy,
      sortKey: state.sortKey,
      sortAsc: state.sortAsc,
      theme: state.theme,
      colorMode: state.colorMode,
      ai: state.ai,
      chatHistory: state.chatHistory,
      globalSessionMeta: state.globalSessionMeta,
      reminders: state.reminders
    };

    // 1. 优先写入全量副本到 IndexedDB
    idbSave('backup_payload', payload);

    // 2. 同步写入 LocalStorage，如遇 QuotaExceededError 则自动降级写轻量镜像
    try {
      const json = JSON.stringify(payload);
      localStorage.setItem(STORAGE_KEY, json);
      localStorage.setItem(STORAGE_KEY + '_backup', json);
    } catch (quotaErr) {
      try {
        const trimmedJson = JSON.stringify(buildTrimmedPayload(payload));
        localStorage.removeItem(STORAGE_KEY + '_backup');
        localStorage.setItem(STORAGE_KEY, trimmedJson);
      } catch (e2) {}
    }

    emit('saved', state);
  } catch (err) {
    console.error('Failed to save state:', err);
  }
}

// ================= 主题与深浅色模式 =================
const colorModeQuery = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : { matches: false, addEventListener: () => {} };

export function isDarkMode() {
  return state.colorMode === 'dark' || (state.colorMode === 'system' && colorModeQuery.matches);
}

function hexToHsl(hex) {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const num = parseInt(c, 16);
  const r = (num >> 16) / 255, g = ((num >> 8) & 255) / 255, b = (num & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0, s = 0, l = (mx + mn) / 2;
  if (d) {
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = h * 60;
  }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

function hslToCss(h, s, l) {
  return `hsl(${h},${s}%,${l}%)`;
}

export function applyTheme(hex) {
  if (typeof document === 'undefined') return;
  const h = hexToHsl(hex);
  const dark = isDarkMode();
  const soft = dark
    ? hslToCss(h[0], Math.min(55, h[1]), 26)
    : hslToCss(h[0], Math.min(92, h[1] + 5), Math.max(87, Math.min(94, 92 + (h[2] - 55) * 0.4)));
  const faint = dark
    ? hslToCss(h[0], Math.min(35, h[1]), 18)
    : hslToCss(h[0], Math.min(42, h[1]), Math.max(95, Math.min(97, 95)));
  const deep = hslToCss(h[0], Math.min(96, h[1]), Math.max(22, Math.round(h[2] * 0.86)));
  const ink = dark ? hslToCss(h[0], Math.min(92, h[1] + 5), 72) : hex;

  const root = document.documentElement;
  root.style.setProperty('--primary', hex);
  root.style.setProperty('--primary-ink', ink);
  root.style.setProperty('--primary-soft', soft);
  root.style.setProperty('--primary-faint', faint);
  root.style.setProperty('--primary-deep', deep);
  root.style.setProperty('--on-primary', '#fff');

  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.setAttribute('content', dark ? '#111318' : hex);
}

export function applyColorMode() {
  if (typeof document === 'undefined') return;
  const dark = isDarkMode();
  const root = document.documentElement;
  root.dataset.colorMode = dark ? 'dark' : 'light';
  applyTheme(state.theme);

  const btn = document.querySelector('#drawerTheme');
  if (btn) {
    const label = dark ? '切换到日间模式' : '切换到夜间模式';
    btn.setAttribute('aria-label', label);
    btn.title = label;
  }
}

export function toggleColorMode() {
  state.colorMode = isDarkMode() ? 'light' : 'dark';
  saveState();
  applyColorMode();
}

if (colorModeQuery && colorModeQuery.addEventListener) {
  colorModeQuery.addEventListener('change', () => {
    if (state.colorMode === 'system') applyColorMode();
  });
}
