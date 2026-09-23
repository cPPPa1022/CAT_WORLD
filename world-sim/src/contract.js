// contract.js — **契约单一真源**（S0）
// ─────────────────────────────────────────────────────────────
// 为什么需要它（设计矛盾清单 M4 / M5 的根因）：
//   Update 的契约原来散在三处且靠人同步 ——
//     ① runtime.js 的 UPDATE_TYPES 白名单（校验器放行什么）
//     ② game.js applyUpdates 的 if/else 链（运行时真的做什么）
//     ③ ai.js SYSTEM 里那句手写说明（告诉 AI 能写什么，而且**从来没列全过表**）
//   三处不同步的后果实测过：19 类里有 5 类没有执行器 —— 校验器放行、运行时什么都不做、
//   AI 写了等于石沉大海，而且不报错不记账。
//
// 现在的规矩：**这张表是唯一真源**。
//   · 校验器从它取白名单
//   · 提示词从它**生成**（不再手抄）
//   · scripts/contract-check.js 断言「表里的每一类都有执行器」
//   · 新增一类 Update，只需要在这张表 + applyUpdates 各加一处，断言会把不一致变成红灯
'use strict';

// ---------- 事件烈度（L1–L4）的唯一词表（v1.98 · P0-5 第 1 步） ----------
/* 设计总稿 §167：L1/L2 日常、L3 重大、L4 灾难，**L5 禁止**（引擎不提供这一级）。
   为什么搬到这里：烈度是 Update 契约的一部分（AI 提议 → 引擎裁决），
   而原来它散在 runtime.js 的一句 truthy 判断里，有**两个洞**：
     洞① 不写 severity 就整段跳过（等于没门）；洞③ 世界上限写坏了就全放行。
   注意：这和 **news.severity（低/中/高/灾难，直接上屏的那根轴）不是一回事** ——
   同名不同义是历史包袱，这里划清：事件那根决定"引擎放不放行"，新闻那根只管"怎么呈现"。 */
const LEVELS = ['L1', 'L2', 'L3', 'L4'];
const BANNED_LEVELS = ['L5'];          // 禁止级：写了它不是"超上限"，是"取值非法"
const MAX_DEFAULT = 'L2';
const RANK = { L1: 1, L2: 2, L3: 3, L4: 4 };
function normSev(x) {
  const t = String(x == null ? '' : x).trim().toUpperCase();
  return (LEVELS.indexOf(t) >= 0 || BANNED_LEVELS.indexOf(t) >= 0) ? t : '';
}
// "像烈度值但写坏了"（L9 / l5 / " L2" / 纯数字）—— 与"根本不是这根轴"（低/中/高/灾难）要分开
function isLish(x) { return /^L\s*\d/i.test(String(x == null ? '' : x).trim()); }
/* **两轴之间的桥**（v1.99 · P0-5 第 2 步）：
   AI 写新闻时用的是"严重性"（低/中/高/灾难，上屏那根轴），而引擎裁决用的是 L 级。
   两侧各自有词表（低…在 knowledge.NEWS_SEV，L 级在本文件），桥只此一处 ——
   引擎自产/AI 自产的新闻都靠它算出该走哪一级门，不需要再抄一张表。 */
/* 写入总线（bus.js）允许创建的**实体**类型（v2.01 · P0-6）：
   与 director 的 KINDS 对齐，但这里只管"能落成实体"的那几种 —— news/event/city 不是实体。 */
const CREATE_TYPES = ['person', 'place', 'item', 'org', 'action'];   // action = 动作注册表条目（不是实体）

/* 动作效果的**唯一白名单**（v2.03 · P0-6 收尾）：原来这张表长在 director.js 里，
   而"AI 生成动作时的提示词 / 校验 / 有没有人实现"这三件事各写各的。
   现在表在这里（与 UPDATE_TYPES 同一套规矩）：`exec` = 真的有人实现它。 */
const ACTION_EFFECTS = [
  { type: 'deduct_money', exec: 'applyCustom', hint: 'amount：够则扣（先电子后现金），不够 → 拒并留痕' },
  { type: 'earn_money',   exec: 'applyCustom', hint: 'amount：进账（落账）' },
  { type: 'add_item',     exec: 'applyCustom', hint: 'name：进背包（落账，ref 指物品 id）' },
  { type: 'add_entity',   exec: 'applyCustom', hint: 'kind,name,atScene：**await** 造出来（不再是 fire-and-forget）' },
  { type: 'move_to',      exec: 'applyCustom', hint: 'place：按 moveCost 花时间、记去过的地方、落账' },
  { type: 'send_msg',     exec: 'applyCustom', hint: 'to,text：写进 messages + 排一条待回复' },
  { type: 'ledger',       exec: 'applyCustom', hint: 'desc：只落一条账（世界事实）' },
  { type: 'set_flag',     exec: 'applyCustom', hint: 'key,value：写 current.flags' }
];
const ACTION_EFFECT_NAMES = ACTION_EFFECTS.map(x => x.type);

const LEVEL_FROM_NEWS = { 低: 'L1', 中: 'L2', 高: 'L3', 灾难: 'L4' };
function levelFromNews(x) { return LEVEL_FROM_NEWS[String(x == null ? '' : x).trim()] || ''; }

/* 每一类 Update 的**缺省烈度**：不给就按它算，而不是"跳过不判"。
   17 类里只有"事件开始/结束"是事件轴上的东西（缺省 L2）；其余写操作本身不带烈度（L1）。 */
const SEV_DEFAULT = { 事件开始: 'L2', 事件结束: 'L2' };
function sevDefault(type) { return SEV_DEFAULT[String(type || '')] || 'L1'; }

// ---------- Update 契约 ----------
// exec = 执行器名（game.js applyUpdates 里的实现）。空字符串 = **还没实现**，断言会报红。
// hint = 生成提示词时给 AI 看的约束（只写人话，不写引擎词汇）。
const UPDATE_TYPES = [
  { type: '地点变化',     exec: 'applyMove',     hint: '带 cause；只能去**有通路**的地方，耗时会算' },
  { type: '人物离开',     exec: 'applyLeave',    hint: '带 cause；走的人在场景里会真的离开' },
  { type: '人物出现',     exec: 'applySpawn',    hint: '必须带 spawn{name,appearance,role} + cause + relation —— 禁止凭空登场' },
  { type: '物品获取',     exec: 'applyItemGet',  hint: 'item: 东西的名字' },
  { type: '物品消耗',     exec: 'applyItemUse',  hint: 'item: 用掉了什么（实际扣减由引擎做）' },
  { type: '物品转移',     exec: 'applyItemMove', hint: 'item + to/from（涉及玩家的一侧由引擎改，另一端交给叙事）' },
  { type: '关系变化',     exec: 'applyRelation', hint: '**定性描述，不许数字**；带 cause' },
  { type: '记忆新增',     exec: 'applyMemory',   hint: 'owner + content + tags + impact 0-100' },
  { type: '记忆激活',     exec: 'applyRecall',   hint: 'target=谁想起；带 ref 或 content 片段指向哪一条' },
  { type: '事件开始',     exec: 'applyEvent',    hint: 'target=事件名；带 cause。开了要记得关' },
  { type: '事件结束',     exec: 'applyEvent',    hint: 'target=同一事件名' },
  { type: '情绪变化',     exec: 'applyMood',     hint: 'target=人物；to=新情绪（定性）' },
  { type: 'NPC状态更新',  exec: 'applyNpcState', hint: 'target + field + to。**进出本场景必须报这条**（field:location）' },
  { type: '印象更新',     exec: 'applyImpression', hint: 'target + note：玩家此刻对 TA 的印象，一句话' },
  { type: '文档出现',     exec: 'applyDoc',      hint: 'title + body（正文全文）+ kind/aliases。**正文必须落在这里**，只写旁白等于玩家永远打不开' },
  { type: '演出',        exec: 'applyFx',       hint: 'fx=你用世界内的话起的名字 + atoms[{k,v}]。一回合最多 1 条' },
  { type: '框架',        exec: 'applyFramework', hint: 'slot(name) + fields/items + why：给这个世界添新词/型/律（不能删改已有的）' },
  /* v3.1 · 开局编译专用（用户 2026-09-19 定的第 4 条）：把"世界的声明"落成"这个人的字段"。
     为什么必须单独一类：白名单原来只有"本回合发生了什么"，没有"把这个人的档案补全"——
     于是生成世界里，玩家的身份/样貌/性格、NPC 的关系、谁知道谁，全都没人写。 */
  { type: '设定补全',    exec: 'applySettingFill', hint: 'target + fields{槽位:值} + why（可选 relations[{with,tone,how}]）：**只补空字段**，已有的一字不改；不新增实体；不许占位串' }
];

const UPDATE_TYPE_NAMES = UPDATE_TYPES.map(function (x) { return x.type; });

// 生成 SYSTEM 里那段「updates 只能写这些 type」——**不再手抄**。
// 这也顺手修掉 M4 的另一半：原来提示词里只有两个例子，**从来没列全过表**。
function promptUpdatesBlock() {
  const parts = UPDATE_TYPES.map(function (x) { return x.type + '（' + x.hint + '）'; });
  return '【updates 只能写这些 type，引擎逐条校验，写别的会被打回】' + parts.join('·')
    + '。**时间由运行时推进，不要写“时间推进”**；氛围用 beats 里的 ambient，不要单独写一条。';
}

// ---------- Frame 契约 ----------
const BEAT_TYPES = ['dialogue', 'action', 'ambient', 'narration'];
/* ---------- beats 槽位限长：**唯一真源**（v2.09 重建） ----------
   原来这里是 BEAT_SLOTS —— 一段**全项目从没有人用过**的声明（只有"定义"和"导出"两处），
   而且数字还是过时的：它写 action≤20 / expression≤12 / voice≤12，
   而真正的提示词（ai.js:409）写 30/20/16、代码截断（sweepThink）切 60/40/32。
   **一份号称"单一真源"的文件，自己躺着一份没人用又对不上的副本** —— 这是"每次扫描都能扫出问题"的最小样本。

   现在改成**会真的被用**的表：
     · hard = 提示词里给 AI 的字数契约（ai.js 从它**生成**那段槽位说明）
     · cut  = 代码实际截断的上限（安全网，不是契约；0 = 不截）
   两个数放同一行，是因为 v1.89 出过事故：契约给 20 字、代码切 12 字，
   **提示词里答应的东西被静默砍掉一半** —— 根因就是这两个数分居两处、靠人同步。 */
const BEAT_LIMITS = {
  action:     { hard: 30, cut: 60 },   // dialogue beat 的「她身体在做什么」
  expression: { hard: 20, cut: 40 },   // 看得见的征候
  voice:      { hard: 16, cut: 32 },   // 听得见的征候
  actText:    { hard: 40, cut: 0 },    // action beat 的「动作本身」（不截断）
  tone:       { hard: 8,  cut: 8  }    // 旧槽位（兼容旧档/演示 AI），前端已不渲染成标签
};

// ---------- requests 契约（世界导演） ----------
const REQUEST_KINDS = ['event', 'person', 'place', 'item', 'action', 'news', 'city', 'org'];

// ---------- 上下文投影分层（S1） ----------
// 端上实测：DeepSeek 是**服务端前缀缓存**，命中价比未命中便宜约 31×；
// 而「不变的东西放前面」是唯一法则（catworld-harness 4.5）。
// 原来资料包**第一个字段就是「当前时间」** ⇒ user 消息从第 1 个字符就不同 ⇒ 实测缓存率仅 29%。
//
// 所以字段顺序不是风格问题，是钱的问题 —— 把它变成**声明的**，而不是碰巧的。
// scripts/context-order-check.js 会断言：资料包的实际键序 = stable 段在前、volatile 段在后。
const CONTEXT_TIERS = {
  // tier 1 · 稳定（慢变）：整局游戏里基本不变 → 放最前，吃前缀缓存
  stable: [
    '你的名字',
    '感知提示',
    '演出可用的引擎原语(名字由你自己起)',
    '你的身份',
    '你的自我设定',
    '玩家的语域(他的说话方式·**照常反应，不许评价**)',
    '你的身世(你本人完全清楚的)',
    '隐约记得(未想起;NPC可用话头勾起,回想由系统判定)',
    '你的装备/工具',
    '这个世界的框架(它自己长出来的词·直接用，别再重新发明)',
    '这个世界已有的动作',
    '你手上的文书(可直接引用；已存在的不要重复创建)'
    /* 注意：**目录不在这一层**。它虽然长得像「世界设定」，但内容是**计数**
       （消息 N 条 / 事件流 N 条 / 你亲历 N 条）——每回合都在变，放稳定段等于白放。
       实测：把它放稳定段时，两回合的共享前缀从 1371 掉到 1029（正是它在作怪）。 */
  ],
  // tier 2 · 每回合变：放最后
  volatile: [
    '当前时间',
    '天气',
    '地点',
    '目录(这里有什么·先看它再决定要不要查)',
    '在场人物(全部)',
    '上一位说话者',
    '画面里刚出现但不在本场景的人',
    '相关记忆Top',
    '副AI事件候选',
    '世界书命中',
    '命中但未解锁(玩家不知道·禁止写进画面)',
    '创造欠账(上回合有生成没写说明)',
    '离线简报',
    '最近几天(按世界日折叠·你亲历的)',
    '最近场景原文',
    '本条行动',
    '本回合玩家操作',
    '未了的事',
    // v1.91 叙事者：只在节拍到点时非空（空 = 零字节，照抄内容模块槽位的做法）
    '世界节拍',
    // v1.94 角色分工：引擎先问过在场的人，这里是他们的原话
    '他们自己开口了',
    '世界近况(世界演算/新闻动态)',
    '镜头外近况(你不在场时发生的)',
    '角色委派建议',
    // 本条原来拼在 system 末尾（game.js）——intent.kind 一变，system 整块就失效。
    // 它属于「本轮变动」，语义上就该跟资料包走，放在最后。
    '本回合模块说明'
  ]
};
const CONTEXT_ORDER = CONTEXT_TIERS.stable.concat(CONTEXT_TIERS.volatile);

// ---------- 断言（纯函数，返回问题清单；空数组 = 通过） ----------
// execSet: 运行时**实际实现**的类型集合（game.js 导出 EXECUTED_TYPES）
/* `execSet` = applyUpdates 里真的实现了的 Update 类型集合；`fxSet` = applyCustom 里实现了的效果集合。
   两个都可选 —— 只传一个时，另一个不做"实现面"的对账（仍然查表内自洽与提示词覆盖）。 */
function assertContract(execSet, fxSet) {
  const bad = [];
  const seen = {};
  for (const x of UPDATE_TYPES) {
    if (seen[x.type]) bad.push('重复类型: ' + x.type);
    seen[x.type] = 1;
    if (!x.exec) bad.push('白名单类型没有执行器: ' + x.type);
  }
  if (execSet) {
    for (const x of UPDATE_TYPES) {
      if (!execSet.has(x.type)) bad.push('白名单放行但运行时没实现: ' + x.type);
    }
    for (const t of execSet) {
      if (UPDATE_TYPE_NAMES.indexOf(t) < 0) bad.push('运行时实现了但不在白名单: ' + t);
    }
  }
  const block = promptUpdatesBlock();
  for (const x of UPDATE_TYPES) {
    if (block.indexOf(x.type) < 0) bad.push('提示词块漏了类型: ' + x.type);
  }
  /* v2.03：动作效果表也走同一套规矩（唯一真源 → 提示词 → 执行器，三处一致）。
     `execSet` 是可选第二参数：applyCustom 里真的实现了的效果类型集合。 */
  const seenFx = {};
  for (const x of ACTION_EFFECTS) {
    if (seenFx[x.type]) bad.push('重复动作效果: ' + x.type);
    seenFx[x.type] = 1;
    if (!x.exec) bad.push('动作效果没有执行器: ' + x.type);
  }
  if (fxSet) {
    for (const x of ACTION_EFFECTS) if (!fxSet.has(x.type)) bad.push('动作效果白名单里有、但 applyCustom 没实现: ' + x.type);
    for (const t of fxSet) if (ACTION_EFFECT_NAMES.indexOf(t) < 0) bad.push('applyCustom 实现了、但不在白名单: ' + t);
  }
  return bad;
}

// 资料包键序断言：返回第一个错位的字段
function assertContextOrder(keys) {
  let phase = 0; // 0 = 还在 stable 段，1 = 已进入 volatile 段
  for (const k of keys) {
    const isStable = CONTEXT_TIERS.stable.indexOf(k) >= 0;
    const isVolatile = CONTEXT_TIERS.volatile.indexOf(k) >= 0;
    if (!isStable && !isVolatile) return { ok: false, why: '未知字段（未登记分层）: ' + k };
    if (isStable && phase === 1) return { ok: false, why: '稳定字段出现在易变字段之后: ' + k };
    if (isVolatile) phase = 1;
  }
  return { ok: true, why: '' };
}

module.exports = {
  // v1.98 P0-5：事件烈度的唯一词表（runtime 的烈度门 / storyteller 的预设推导 / 导入的世界包都读这里）
  LEVELS: LEVELS, BANNED_LEVELS: BANNED_LEVELS, MAX_DEFAULT: MAX_DEFAULT, RANK: RANK,
  normSev: normSev, isLish: isLish, sevDefault: sevDefault, LEVEL_FROM_NEWS: LEVEL_FROM_NEWS, levelFromNews: levelFromNews,
  CREATE_TYPES: CREATE_TYPES, ACTION_EFFECTS: ACTION_EFFECTS, ACTION_EFFECT_NAMES: ACTION_EFFECT_NAMES,
  UPDATE_TYPES: UPDATE_TYPES, UPDATE_TYPE_NAMES: UPDATE_TYPE_NAMES,
  promptUpdatesBlock: promptUpdatesBlock,
  BEAT_TYPES: BEAT_TYPES, BEAT_LIMITS: BEAT_LIMITS, REQUEST_KINDS: REQUEST_KINDS,
  CONTEXT_TIERS: CONTEXT_TIERS, CONTEXT_ORDER: CONTEXT_ORDER,
  assertContract: assertContract, assertContextOrder: assertContextOrder
};