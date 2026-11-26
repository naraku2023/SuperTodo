/**
 * 全局配置与常量定义
 */

export const STORAGE_KEY = 'listapp.data.v2';
export const APP_VERSION = 'v1.8.0';
export const REPO_API = 'https://api.github.com/repos/naraku2023/SuperTodo';

// 保留兼容旧版的默认标签
export const DEFAULTS = {
  types: ['日常待办', '长期计划', '购物采购', '旅行出行', '心愿清单', '工作学习'],
  scenes: ['家里', '公司', '学校', '出差', '线上', '外出'],
  times: ['今天', '本周', '本月', '今年', '以后再说']
};

// 智能日程视图
export const SMART_VIEWS = [
  { id: 'today', name: '今日聚焦', icon: '☀️' },
  { id: 'upcoming', name: '最近7天', icon: '📆' },
  { id: 'priority', name: '高优先级', icon: '🔥' },
  { id: 'inbox', name: '收集箱', icon: '📥' },
  { id: 'all', name: '全部待办', icon: '📋' },
  { id: 'archived', name: '已归档', icon: '📦' }
];

// 默认项目清单空间
export const DEFAULT_PROJECTS = [
  { id: 'proj_todo', name: '日常待办', icon: '✅', color: '#0b57d0', template: 'general', desc: '日常琐事与即时任务' },
  { id: 'proj_plan', name: '长期计划', icon: '🎯', color: '#7c2d92', template: 'plan', desc: '阶段目标、考证与成长路线' },
  { id: 'proj_shop', name: '购物采购', icon: '🛒', color: '#188038', template: 'shopping', desc: '清单明细、单价与预算控制' },
  { id: 'proj_travel', name: '旅行出行', icon: '✈️', color: '#007372', template: 'travel', desc: '目的地、交通住宿与按天行程' },
  { id: 'proj_wish', name: '心愿清单', icon: '🌟', color: '#e8710a', template: 'wish', desc: '心愿目标、储蓄进度与奖励' },
  { id: 'proj_work', name: '工作学习', icon: '💼', color: '#1565c0', template: 'plan', desc: '项目推进、学习提升与复盘' }
];

// 项目空间可选 Emoji 图标
export const PROJECT_ICONS = ['✅', '🎯', '🛒', '✈️', '🌟', '💼', '📚', '🏠', '💪', '🎨', '💡', '💰', '🚗', '🎮', '🏥', '📝'];

// 默认多维标签
export const DEFAULT_TAGS = ['重要', '紧急', '学习', '健康', '家庭', '线上', '外出', '深度工作'];

// 任务执行状态
export const TASK_STATUSES = [
  { id: 'todo', label: '待启动', icon: '○' },
  { id: 'in_progress', label: '进行中', icon: '◔' },
  { id: 'blocked', label: '阻塞等待', icon: '⏸' },
  { id: 'done', label: '已完成', icon: '●' }
];

// 任务优先级
export const TASK_PRIORITIES = [
  { id: 'urgent', label: 'P1 紧急', short: 'P1', color: '#d93025' },
  { id: 'high', label: 'P2 高优', short: 'P2', color: '#e8710a' },
  { id: 'medium', label: 'P3 普通', short: 'P3', color: '#0b57d0' },
  { id: 'low', label: 'P4 低优', short: 'P4', color: '#8992a2' }
];

// 重复周期选项
export const REPEAT_OPTIONS = [
  { id: 'none', label: '不重复' },
  { id: 'daily', label: '每天' },
  { id: 'weekdays', label: '工作日' },
  { id: 'weekly', label: '每周' },
  { id: 'monthly', label: '每月' }
];

// 分类专属结构化模板类型
export const PROJECT_TEMPLATES = [
  { id: 'general', label: '通用待办' },
  { id: 'plan', label: '计划与里程碑' },
  { id: 'shopping', label: '购物与预算' },
  { id: 'travel', label: '旅行与行程' },
  { id: 'wish', label: '心愿与储蓄' }
];

// 首页列表分组方式
export const GROUP_BY_OPTIONS = [
  { id: 'schedule', label: '按日程' },
  { id: 'project', label: '按项目' },
  { id: 'status', label: '按状态' },
  { id: 'priority', label: '按优先级' },
  { id: 'none', label: '平铺' }
];

export const PALETTE = [
  '#0b57d0', // 默认经典蓝
  '#0f6b3c', // 森林绿
  '#b3261e', // 宝石红
  '#7c2d92', // 优雅紫
  '#007372', // 青碧
  '#e8710a', // 活力橙
  '#d01884', // 蔷薇粉
  '#37474f', // 极简灰
  '#1565c0', // 湛蓝
  '#2e7d32'  // 自然绿
];

export const SORT_OPTIONS = [
  '默认',
  '截止日期',
  '优先级',
  '创建时间',
  '预估花费',
  '标题'
];

export const AI_PROVIDERS = [
  {
    name: 'DeepSeek Flash (V4.1 · 推荐)',
    base: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    tip: '1M上下文，极速低价，支持自动缓存与可选思考模式'
  },
  {
    name: 'DeepSeek Pro (V4-Pro)',
    base: 'https://api.deepseek.com',
    model: 'deepseek-v4-pro',
    tip: '1M上下文旗舰模型，适合复杂长期目标深度推演'
  },
  {
    name: '通义千问 (Qwen)',
    base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    tip: '阿里百炼官方兼容易用，长文本理解出色'
  },
  {
    name: 'OpenAI',
    base: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    tip: '极速响应，结构化输出精准'
  }
];

export const THINKING_MODES = [
  { id: 'disabled', label: '关闭思考（极速省费）' },
  { id: 'low', label: '轻度思考 (low)' },
  { id: 'high', label: '深度思考 (high)' },
  { id: 'max', label: '极限思考 (max)' }
];

export const COMPACTION_DEFAULTS = {
  autoCompact: true,
  thresholdMessages: 40,
  thresholdTokens: 32000,
  keepRecentMessages: 6
};
