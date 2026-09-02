/**
 * 响应式状态管理、本地持久化与主题控制
 */

import { STORAGE_KEY, DEFAULTS } from './config.js';
import { createTask } from './models.js';

// 全局响应式状态
export const state = {
  items: [],
  types: DEFAULTS.types.slice(),
  scenes: DEFAULTS.scenes.slice(),
  times: DEFAULTS.times.slice(),
  type: '全部',             // 当前选中类型
  groupBy: 'scene',         // 分组维度: scene | time
  sortKey: '默认',          // 排序维度: 默认 | 创建 | 花费 | 重要 | 日期
  sortAsc: true,
  view: { name: 'home' },   // home | { name: 'list', group, groupKey }
  search: '',
  theme: '#0b57d0',
  colorMode: 'system',      // system | light | dark
  ai: {
    enabled: false,
    base: 'https://api.deepseek.com',
    key: '',
    model: 'deepseek-chat'
  },
  // AI 对话历史（持久化最近 30 条会话）
  chatHistory: []
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

/**
 * 从 LocalStorage 加载数据并平滑迁移旧版本数据
 */
// IndexedDB 双轨持久化支持（确保覆盖安装、版本升级或系统清理时数据 100% 留存）
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
 * 从 LocalStorage 或 IndexedDB 加载数据并平滑迁移
 */
export async function loadState() {
  try {
    let data = null;
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY + '_backup');
    if (raw) {
      try { data = JSON.parse(raw); } catch (e) {}
    }

    // 若 LocalStorage 为空（如覆盖安装后初次读取），尝试从 IndexedDB 继承恢复
    if (!data) {
      data = await idbLoad('backup_payload');
    }

    if (!data) return;

    if (Array.isArray(data.items)) {
      state.items = data.items.map(it => createTask(it));
    }
    if (Array.isArray(data.types) && data.types.length) {
      state.types = data.types.slice();
    }
    if (Array.isArray(data.scenes) && data.scenes.length) {
      state.scenes = data.scenes.slice();
    }
    if (Array.isArray(data.times) && data.times.length) {
      state.times = data.times.slice();
    }
    if (data.type && (data.type === '全部' || state.types.includes(data.type))) {
      state.type = data.type;
    }
    if (data.groupBy === 'scene' || data.groupBy === 'time') {
      state.groupBy = data.groupBy;
    }
    if (data.theme) state.theme = data.theme;
    if (data.colorMode) state.colorMode = data.colorMode;
    if (data.ai) {
      state.ai = Object.assign({
        enabled: false,
        base: 'https://api.deepseek.com',
        key: '',
        model: 'deepseek-chat'
      }, data.ai);
    }
    if (Array.isArray(data.chatHistory)) {
      state.chatHistory = data.chatHistory.slice(-30);
    }

    // 确保 LocalStorage 立即保持最新镜像
    saveState();
  } catch (err) {
    console.error('Failed to load state:', err);
  }
}

/**
 * 双轨持久化保存 (LocalStorage + IndexedDB)
 */
export function saveState() {
  try {
    const payload = {
      items: state.items,
      types: state.types,
      scenes: state.scenes,
      times: state.times,
      theme: state.theme,
      colorMode: state.colorMode,
      ai: state.ai,
      chatHistory: state.chatHistory.slice(-30)
    };
    const json = JSON.stringify(payload);
    localStorage.setItem(STORAGE_KEY, json);
    localStorage.setItem(STORAGE_KEY + '_backup', json);
    idbSave('backup_payload', payload);
    emit('saved', state);
  } catch (err) {
    console.error('Failed to save state:', err);
  }
}

// ================= 主题与深浅色模式 =================
const colorModeQuery = window.matchMedia('(prefers-color-scheme: dark)');

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

// 监听系统深色模式切换
colorModeQuery.addEventListener('change', () => {
  if (state.colorMode === 'system') applyColorMode();
});
