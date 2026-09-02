/**
 * 全局配置与常量定义
 */

export const STORAGE_KEY = 'listapp.data.v2';
export const APP_VERSION = 'v1.7.7';
export const REPO_API = 'https://api.github.com/repos/PaidaxingTuT/SuperTodo';

export const DEFAULTS = {
  types: ['购物', '待办', '计划', '旅游', '愿望'],
  scenes: ['家里', '学校', '出差', '网上', '线下'],
  times: ['今天', '今年', '明年', '以后再说']
};

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
  '创建时间',
  '截止日期',
  '重要程度',
  '预估花费',
  '标题'
];

export const AI_PROVIDERS = [
  {
    name: 'DeepSeek',
    base: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    tip: '性价比极高，中文对话与时间/目标拆解能力极强'
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
