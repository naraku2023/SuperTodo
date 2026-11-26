<div align="center">

# SuperTodo · 超级清单

一款轻量、优雅且支持深度日程规划的现代化智能待办与清单应用。  
基于开源项目 **[PaidaxingTuT/SuperTodo](https://github.com/PaidaxingTuT/SuperTodo)**（MIT License）进行深度二次开发：升级智能日程与项目空间、分类专属结构化工作区、**一事项一独立 AI 会话**（适配 2026 DeepSeek V4 与长会话上下文压缩），以及 **Android 原生定时提醒与小米 4×2 桌面小组件**。

[![Release](https://img.shields.io/github/v/release/naraku2023/SuperTodo?color=blue&label=Release)](https://github.com/naraku2023/SuperTodo/releases)
[![Upstream](https://img.shields.io/badge/Based%20on-PaidaxingTuT%2FSuperTodo-6e7681)](https://github.com/PaidaxingTuT/SuperTodo)
[![Platform](https://img.shields.io/badge/Platform-Android%20%7C%20Web-brightgreen)](#)
[![Tech Stack](https://img.shields.io/badge/Stack-HTML5%20%2B%20CSS3%20%2B%20ES%20Modules%20%2B%20Android-F7DF1E?logo=javascript&logoColor=black)](#)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

<br/>

<img src="screenshots/title.png" alt="SuperTodo" width="720" style="max-width: 100%; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.12);" />

</div>

---

## 核心特性

### 1. 智能日程视图 + 项目清单空间 + 多维标签
- **智能日程聚合**：内置 `☀️ 今日聚焦`（自动聚合逾期与今日安排）、`📆 最近7天`（按日期时间轴分桶）、`🔥 高优先级`、`📥 收集箱`、`📋 全部待办` 与 `📦 已归档`。
- **自定义项目空间与多标签**：支持自定义 Emoji 图标、颜色与结构化模板（通用 / 计划 / 购物 / 旅行 / 心愿），支持多标签筛选、状态过滤及 `按日程 / 按项目 / 按状态 / 按优先级 / 平铺` 多维分组折叠。

### 2. 深度事项安排与结构化工作区
- **完整排期与控制**：支持执行状态（待启动 / 进行中 / 阻塞等待 / 已完成）、P1~P4 四级优先级、起止日期与具体时段、预计耗时、重复周期（每天 / 工作日 / 每周 / 每月，完成后自动生成下一期安排）。
- **强化阶段与子步骤**：支持手动新建/重命名/删除阶段，支持单步排期日期、耗时、备注行内编辑与拖拽排序（SortableJS）。
- **分类专属结构化工作区**：
  - **购物与预算**：采购明细表（品名 / 数量 / 单价 / 渠道 / 已购勾选）与预算支出进度条；
  - **旅行与行程**：目的地、天数、交通住宿概览与按天行程节点表；
  - **心愿与储蓄**：目标金额、已存进度条与一键 `+100` 储蓄记录；
  - **计划与里程碑**：量化验收指标与阶段达成进度条。

### 3. 真正「一事项一独立会话」与 DeepSeek V4 上下文压缩
- **双入口独立记忆**：每个事项详情页内置 `💬 专属会话` Tab（列表卡片可直接点击气泡图标直达），同时 AI 抽屉支持在「全局规划总管」与所有事项独立会话间切换、置顶、按进行中/已归档筛选及导出 Markdown；全局对话创建的事项自动绑定上下文到该事项独立会话。
- **适配 2026 DeepSeek V4**：原生支持 `deepseek-flash`（V4.1-Flash）与 `deepseek-v4-pro`（V4-Pro），支持统一 `thinking` 开关与 `reasoning_effort`（`low / high / max`）调节，配合静态前缀置顶 + 动态状态尾部注入，最大化命中 DeepSeek 自动磁盘前缀缓存。
- **非破坏性上下文压缩（Compaction）**：借鉴 DeepSeek Harness 设计，达到阈值（默认 `40 条 / 32K tokens`，支持三档调节）自动触发，或随时点击 `🗜️ 压缩` / 发送 `/compact` 手动触发——完整原始记录无损保留供回溯，模型侧替换为结构化中文 Markdown 检查点摘要，并由 IndexedDB 全量主存 + LocalStorage 容错降级镜像保障长期使用不丢记录。

### 4. 原生定时提醒与小米手机 4×2 桌面小组件
- **首页警示与系统闹钟**：首页顶部展示醒目的逾期/今日聚焦横幅；Android 端通过原生 `AlarmManager` + 高优悬浮通知通道提供每日今日早报、晚间复盘与具体时段事项到点闹钟（重启/改时区自动恢复）。
- **小米 HyperOS / MIUI 专项适配**：设置页内置 `通知与悬浮`、`精准闹钟`、`省电无限制`、`自启动管理` 一键跳转与即时测试通知按钮。
- **4×2 桌面原生小组件**：22dp 圆角适配日夜桌面，自动按 `逾期 > 今日 > 高优` 展示前 6 项，支持直接在桌面打勾完成、点击进入事项详情与右上角 `＋` 快速新建。

---

## 技术栈

- **前端核心**：纯原生 HTML5 / CSS3（CSS Variables + Modern Flexbox/Grid）/ Vanilla JavaScript（ES6+ Modules），零构建工具依赖。
- **拖拽交互**：[Sortable.js](https://github.com/SortableJS/Sortable)
- **原生封装与扩展**：Capacitor 8 + 原生 Java（`AlarmManager` 定时提醒、`AppWidgetProvider` 4×2 桌面小组件、`DownloadManager` 应用内下载、小米系统权限桥接）。
- **AI 接口**：深度适配 DeepSeek V4 API，同时兼容标准 OpenAI 格式接口（通义千问 / OpenAI 等）。
- **自动化构建**：GitHub Actions 自动封装 Capacitor Android 工程、注入原生提醒与小组件模块、校验固定签名并发布 Release APK。

---

## 快速开始

### 1. Web 本地运行
```bash
git clone https://github.com/naraku2023/SuperTodo.git
cd SuperTodo
python -m http.server 8000
```
浏览器访问 `http://localhost:8000` 即可体验核心清单与 AI 会话能力。

### 2. Android APK 安装与小米桌面小组件配置
1. 前往 [Releases 页面](https://github.com/naraku2023/SuperTodo/releases) 下载最新 `SuperTodo-X.Y.Z.apk` 安装。
2. 打开 App → 左上角菜单 → **设置 → 🔔 定时提醒与小米桌面小组件**：点击 **立即发送测试提醒**，并通过下方 4 个快捷按钮配齐小米系统权限。
3. 在小米手机桌面长按空白处（或双指捏合）→ **添加小部件** → 最底部 **安卓小部件** → 找到 **「超级清单」** 拖到桌面即可。

---

## 项目结构

```plaintext
SuperTodo/
├── .github/workflows/      # GitHub Actions 自动化编译、原生注入、签名校验与 Release
├── js/                     # 纯原生 ES Modules 前端源码
│   ├── ai/                 # DeepSeek V4 客户端、KV 缓存友好提示词与上下文压缩引擎
│   ├── ui/                 # 列表筛选分组、详情工作台、多会话抽屉、弹窗与子步骤组件
│   ├── app.js              # 应用主调度、导航、警示横幅与原生事件响应
│   ├── config.js           # 智能视图、项目空间模板、DeepSeek V4 与压缩默认配置
│   ├── models.js           # 数据模型、重复周期推演、Token 估算与检查点工厂
│   ├── native-bridge.js    # 小组件数据构造、定时闹钟调度与 Android JSBridge
│   └── state.js            # IndexedDB 主存 + LocalStorage 容错降级持久化与数据迁移
├── native-android/         # 原生 Android 源码与资源（CI 构建时自动注入）
│   ├── java/com/dax/supertodo/
│   │   ├── MainActivity.java           # JSBridge、原生下载监听与小米权限跳转
│   │   ├── NativeStore.java            # 原生配置与小组件勾选队列存储
│   │   ├── ReminderReceiver.java       # 每日早晚报、精确事项闹钟与开机恢复广播
│   │   ├── ReminderScheduler.java      # AlarmManager 调度与高优悬浮通知构建
│   │   └── SuperTodoWidgetProvider.java # 4×2 可缩放桌面小组件 Provider
│   └── res/                # 小组件日夜双色配色、圆角背景与 XML 布局
├── index.html              # 主页面、详情工作台、多会话与设置 DOM 结构
├── style.css               # 响应式样式、日夜间主题配色与卡片/工作区样式
├── CHANGELOG.md            # 版本更新历史
├── debug.keystore          # Android 固定调试签名证书
└── LICENSE                 # MIT License
```

---

## 致谢与开源许可

- 本项目基于 **[PaidaxingTuT/SuperTodo](https://github.com/PaidaxingTuT/SuperTodo)** 二次开发，感谢原作者 [PaidaxingTuT](https://github.com/PaidaxingTuT) 提供的优秀基础架构、主题系统、Capacitor 封装与自动化签名流水线。
- 本项目继续遵循 [MIT License](LICENSE) 开源协议。
