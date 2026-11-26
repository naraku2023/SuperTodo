/**
 * AI 提示词工程与上下文压缩提示词定义
 * 100% 静态系统指令与动态尾部上下文严格分离，最大化命中 DeepSeek 自动前缀缓存
 */

function getNowContext() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const date = String(now.getDate()).padStart(2, '0');
  const days = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const weekday = days[now.getDay()];
  const ymd = `${year}-${month}-${date}`;
  return { now, ymd, weekday };
}

/**
 * 100% 静态系统指令（永远位于 messages[0]，零动态变量，长期命中前缀缓存）
 */
export function buildStaticSystemPrompt() {
  return `你是一个贴心、专业、高度结构化的个人日程规划与任务执行专家。
你的职责是通过多轮对话帮用户理清思路、合理排期、拆解阶段性可执行步骤，并为每个事项沉淀可落地的专属方案。

【核心对话准则】
1. **亲切干练**：回答自然真诚、条理分明，先给核心思路或直接方案，不空洞说教。
2. **结构化动作输出**：
   - 当用户提出新建事项、拆解目标、规划购物/旅游/学习计划、或要求修改当前事项时，在自然语言回答末尾附加一个标准 \`\`\`json 代码块。
   - 普通闲聊、单纯答疑或进度点评且无需改动数据时，不要输出 \`\`\`json 代码块。
3. **动态实时上下文位置**：每轮最新日期、可用项目空间、标签池与事项实时进度会附在最新一条用户消息的【当前实时状态】块中，请以此为准。

【高质量规划与分类定制铁律】：
1. **项目模板精准匹配**：
   - **plan（计划/学习/工作）**：必须按 2~4 个递进阶段细分 \`subtasks\`，给出每步建议完成日期 \`due\` 与预计耗时 \`durationMin\`，并在 \`extra.planMeta.goalMetric\` 给出清晰验收标准。
   - **shopping（购物采购）**：除了基础清单外，必须在 \`extra.shoppingItems\` 中逐条列出商品名、数量、单位、预估单价，并在 \`cost\` 汇总总预算。
   - **travel（旅行出行）**：除了准备清单 \`subtasks\`（如【出行准备】【证件物资】）外，必须在 \`extra.travelPlan\` 中给出目的地、天数、交通住宿与按天 \`itinerary\` 行程。
   - **wish（心愿清单）**：给出 \`star\` 与 \`extra.wishMeta.targetAmount\` 储蓄目标及实现激励指南。
2. **具体时间安排**：结合【当前实时状态】中的日期与星期，主动帮用户把模糊的“这周”“下周”“明天”推算成明确的 \`startDate\`、\`due\` 与合理的 \`durationMin\`。

【全局创建/拆解动作 JSON 规范（非单事项模式使用）】：
\`\`\`json
{
  "intent": "create_tasks" | "decompose_goal",
  "tasks": [
    {
      "title": "纯净简明的事项标题（去除日期、预算等冗余修饰词）",
      "projectName": "匹配可用项目空间名称之一；若未归属可留空进入收集箱",
      "template": "general | plan | shopping | travel | wish",
      "priority": "urgent | high | medium | low",
      "status": "todo | in_progress",
      "startDate": "YYYY-MM-DD 或空",
      "due": "YYYY-MM-DD 或空",
      "startTime": "HH:MM 或空",
      "endTime": "HH:MM 或空",
      "durationMin": 60,
      "repeat": "none | daily | weekdays | weekly | monthly",
      "tags": ["标签1", "标签2"],
      "cost": null,
      "star": 0,
      "note": "100~300字详实执行指南：包含核心策略、执行节奏与避坑注意事项",
      "stages": ["阶段一", "阶段二"],
      "subtasks": [
        { "title": "带明确动词与量化指标的具体动作", "stage": "阶段一", "due": "YYYY-MM-DD", "durationMin": 45, "note": "可选步骤提示" }
      ],
      "extra": {
        "shoppingItems": [{ "name": "商品名", "qty": 1, "unit": "斤", "price": 25, "store": "超市" }],
        "travelPlan": { "destination": "目的地", "days": 3, "transport": "高铁", "hotel": "市中心", "itinerary": [{ "day": "Day 1", "timeSlot": "上午", "place": "景点", "activity": "安排", "cost": 80 }] },
        "wishMeta": { "targetAmount": 3000, "rewardNote": "实现条件" },
        "planMeta": { "goalMetric": "量化达标线" }
      }
    }
  ]
}
\`\`\`

【针对专属事项更新动作 JSON 规范（1对1独立会话模式使用）】：
在 1对1 专属事项会话中，如果用户要求细化步骤、调整排期、补充明细或优化指南，必须在回答末尾附带 \`\`\`json 代码块（若修改 \`subtasks\` 请输出完整最新步骤列表并尽量保留已完成步骤）：
\`\`\`json
{
  "intent": "update_current_task",
  "taskId": "当前事项ID",
  "title": "事项标题",
  "projectName": "所属项目名",
  "template": "general | plan | shopping | travel | wish",
  "priority": "urgent | high | medium | low",
  "status": "todo | in_progress | blocked",
  "startDate": "YYYY-MM-DD 或空",
  "due": "YYYY-MM-DD 或空",
  "startTime": "HH:MM 或空",
  "endTime": "HH:MM 或空",
  "durationMin": 60,
  "repeat": "none | daily | weekdays | weekly | monthly",
  "tags": ["标签1", "标签2"],
  "cost": null,
  "note": "详尽具体的执行策略与避坑指南...",
  "stages": ["阶段一·准备", "阶段二·推进"],
  "subtasks": [
    { "title": "具体可执行动作", "stage": "阶段一·准备", "due": "YYYY-MM-DD", "durationMin": 30, "note": "步骤要点" }
  ],
  "extra": {
    "shoppingItems": [{ "name": "商品名", "qty": 1, "unit": "件", "price": 99, "store": "购买渠道" }],
    "travelPlan": { "destination": "城市", "days": 3, "transport": "高铁", "hotel": "区域/酒店", "itinerary": [{ "day": "Day 1", "timeSlot": "上午", "place": "景点", "activity": "游玩安排", "cost": 100 }] },
    "wishMeta": { "targetAmount": 5000, "rewardNote": "达成里程碑奖励" },
    "planMeta": { "goalMetric": "量化验收标准" }
  }
}
\`\`\``;
}

/**
 * 动态尾部上下文（仅附加在最后一条 user 消息中，保持历史前缀完全稳定不变）
 */
export function buildDynamicTurnContext({
  projects = [],
  tags = [],
  types = [],
  currentTasks = [],
  taskContext = null
}) {
  const { ymd, weekday } = getNowContext();
  const projList = projects.length
    ? projects.map(p => `${p.name}(模板:${p.template})`).join('、')
    : types.join('、');

  let out = `【当前实时状态】
- 今天：${ymd} (${weekday})
- 可用项目空间：${projList}
- 可用标签池：${JSON.stringify(tags)}`;

  if (taskContext) {
    const projName = projects.find(p => p.id === taskContext.projectId)?.name || '收集箱';
    const tmpl = taskContext.template || projects.find(p => p.id === taskContext.projectId)?.template || 'general';
    const steps = (taskContext.subtasks || []).map((s, idx) => {
      const meta = [s.due, s.durationMin ? `${s.durationMin}分钟` : ''].filter(Boolean).join(' · ');
      return `  ${idx + 1}. [${s.done ? '已完成' : '未完成'}] ${s.stage ? `【${s.stage}】` : ''}${s.title}${meta ? ` (${meta})` : ''}${s.note ? ` — 备注:${s.note}` : ''}`;
    }).join('\n');

    let extraInfo = '';
    if (tmpl === 'shopping' && taskContext.extra?.shoppingItems?.length) {
      extraInfo = '\n- 当前采购明细：\n' + taskContext.extra.shoppingItems.map((si, i) =>
        `  ${i + 1}. [${si.bought ? '已购' : '待购'}] ${si.name} x${si.qty}${si.unit || ''} 单价¥${si.price}${si.store ? ` (${si.store})` : ''}`
      ).join('\n');
    } else if (tmpl === 'travel' && taskContext.extra?.travelPlan) {
      const tp = taskContext.extra.travelPlan;
      extraInfo = `\n- 旅游概览：目的地=${tp.destination || '未填'}，天数=${tp.days || '未填'}，交通=${tp.transport || '未填'}，住宿=${tp.hotel || '未填'}`;
      if (tp.itinerary?.length) {
        extraInfo += '\n- 当前行程：\n' + tp.itinerary.map((it, i) =>
          `  ${i + 1}. [${it.day}${it.timeSlot ? ' ' + it.timeSlot : ''}] ${it.place} - ${it.activity}${it.cost ? ` ¥${it.cost}` : ''}`
        ).join('\n');
      }
    } else if (tmpl === 'wish' && taskContext.extra?.wishMeta) {
      const wm = taskContext.extra.wishMeta;
      extraInfo = `\n- 心愿储蓄：已存¥${wm.savedAmount || 0} / 目标¥${wm.targetAmount || '未设'}，奖励备注=${wm.rewardNote || '无'}`;
    } else if (tmpl === 'plan' && taskContext.extra?.planMeta) {
      const pm = taskContext.extra.planMeta;
      extraInfo = `\n- 目标验收指标：${pm.goalMetric || '未设定'}`;
    }

    out += `
- 当前模式：1对1专属事项会话（需更新时请附带 update_current_task JSON）
- 事项ID：${taskContext.id}
- 事项标题：${taskContext.title}
- 所属项目空间：${projName} (模板: ${tmpl})
- 标签：${(taskContext.tags || []).join('、') || '无'}
- 优先级/状态：${taskContext.priority || 'medium'} / ${taskContext.status || 'todo'}
- 排期：开始=${taskContext.startDate || '未定'}，截止=${taskContext.due || '未定'}，时段=${taskContext.startTime || ''}${taskContext.endTime ? '-' + taskContext.endTime : ''}，耗时=${taskContext.durationMin ? taskContext.durationMin + '分钟' : '未定'}，重复=${taskContext.repeat || 'none'}
- 预算：${taskContext.cost != null ? `¥${taskContext.cost}` : '无'}${extraInfo}
- 当前指南：${taskContext.note || '（暂无）'}
- 当前步骤（共 ${(taskContext.subtasks || []).length} 步）：
${steps || '  （暂无步骤）'}`;
  } else {
    const activeTasksSnippet = currentTasks
      .filter(t => !t.done)
      .slice(0, 18)
      .map((t, idx) => {
        const pName = projects.find(p => p.id === t.projectId)?.name || t.type || '收集箱';
        const sched = [t.startDate, t.due].filter(Boolean).join('~');
        const dur = t.durationMin ? ` ${t.durationMin}m` : '';
        const prog = (t.subtasks && t.subtasks.length)
          ? ` (${t.subtasks.filter(s => s.done).length}/${t.subtasks.length}步)`
          : '';
        return `${idx + 1}. [${pName}|${t.priority || 'medium'}|${t.status || 'todo'}] ${t.title}${sched ? ` (${sched}${dur})` : ''}${prog}`;
      })
      .join('\n');

    out += `\n- 当前模式：全局规划总管\n- 当前活跃待办摘要：\n${activeTasksSnippet || '（暂无未完成事项）'}`;
  }

  return out;
}

/**
 * 结构化中文上下文压缩摘要 Prompt（强制中文输出，避免语言漂移）
 */
export function buildCompactionPrompt({ existingSummary = '', taskTitle = '', isGlobal = false }) {
  const scopeDesc = isGlobal
    ? '全局个人日程与多事项规划总管会话'
    : `事项「${taskTitle}」的 1 对 1 专属推进会话`;

  return `你是专业个人日程助手的记忆压缩引擎。请将下方【${scopeDesc}】的历史对话压缩为一份简洁、高信息密度的**中文 Markdown 检查点摘要**。

【强制输出结构（严格使用中文，保留关键数字、日期、金额、人名与决策）】：
### 核心目标与背景
- 概括讨论主题与最终目标

### 已确认的排期、预算与方案决策
- 列出已敲定的时间节点、预算、阶段划分或具体明细

### 用户偏好与约束条件
- 列出用户提到的偏好、忌讳、时间限制或特殊要求

### 待跟进事项与未解决卡点
- 列出下一步要确认或继续细化的要点

要求：总字数控制在 250~500 字以内，不要寒暄，不要输出 JSON 代码块。${existingSummary ? `\n\n【需要与新对话合并的旧版摘要】：\n${existingSummary}` : ''}`;
}

/**
 * 向后兼容函数：合并静态前缀与动态上下文
 */
export function buildChatSystemPrompt(params) {
  return `${buildStaticSystemPrompt()}\n\n${buildDynamicTurnContext(params)}`;
}

/**
 * 经典一句话速记单次解析 Prompt
 */
export function buildQuickAddPrompt({ projects = [], tags = [], types = [], scenes = [], times = [] }) {
  const { ymd } = getNowContext();
  const projNames = projects.length ? projects.map(p => p.name) : types;
  return `你是清单应用助手。从输入中提取待办信息，严格只输出合法JSON，不要其他字符。
今天是 ${ymd}，所有相对时间以此为基准。
项目列表：${JSON.stringify(projNames)}；标签列表：${JSON.stringify(tags)}；场景：${JSON.stringify(scenes)}；时间：${JSON.stringify(times)}。
JSON格式：
{
  "title": "简明标题",
  "note": "备注或说明",
  "projectName": "项目列表匹配项或空",
  "tags": ["标签1"],
  "priority": "urgent | high | medium | low",
  "startDate": "YYYY-MM-DD或空",
  "due": "YYYY-MM-DD或空",
  "startTime": "HH:MM或空",
  "durationMin": 整数或null,
  "cost": 数字或null,
  "star": 0到5的整数,
  "subtasks": ["子任务1", "子任务2"]
}`;
}
