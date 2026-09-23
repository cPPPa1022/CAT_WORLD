// presentation.js — 呈现层注册表：世界载体 → 工具清单 + 俯视 2D 场景平面图（静态 · 只画当前场景 · 有边界）
// v1.8：UI 由世界声明（§17）；插件=确定性的一切（交互点/感知/买卖/门控），AI=叙事层。
'use strict';
const { getEntity, present } = require('./store');
const { dayPart } = require('./runtime');

// ---------- 工具注册表（app id 为前后端约定；前端 APP_RENDER 渲染） ----------
const TOOL_PRESETS = {
  phone:    { id: 'phone',    name: '手机',   icon: '📱', apps: ['sms', 'contacts', 'clock', 'calendar', 'news', 'weather', 'map', 'album'], via: 'phone' },
  brick:    { id: 'brick',    name: '大哥大', icon: '📟', apps: ['sms', 'contacts'], via: 'phone' },
  // v1.46：信匣多一个「文书」页 —— 信/帖子/告示/账本 等可读文本都在这里打开（正文是对象，不是旁白）
  letter:   { id: 'letter',   name: '信匣',   icon: '✉️', apps: ['letters', 'docs', 'contacts'], via: 'letter' },
  talisman: { id: 'talisman', name: '传音符', icon: '🎴', apps: ['sms', 'contacts'], via: 'talisman' },
  radio:    { id: 'radio',    name: '收音机', icon: '📻', apps: ['news'], via: 'radio' },
  paper:    { id: 'paper',    name: '舆图',   icon: '🗺', apps: ['map'], via: null },
  compass:  { id: 'compass',  name: '罗盘',   icon: '🧭', apps: ['map'], via: null }
};

function deriveTools(carries, era, extraText) {
  const c = carries || {};
  const eraTxt = String(era || '') + String(extraText || '');
  const t = [];
  const isCult = /修|仙|志怪|灵|妖|山野/.test(eraTxt);
  const time = c.time, news = c.news;
  if (time === 'phone') { t.push(TOOL_PRESETS.phone); }
  else if (time === 'brick') { t.push(TOOL_PRESETS.brick); }
  else if (time === 'none' && isCult) { t.push(TOOL_PRESETS.talisman); }
  else if (time === 'none' || time === 'watch') { t.push(TOOL_PRESETS.letter); }
  // v1.46：纸本文书（信/帖子/告示/账本）和"计时设备"不是一回事——九十年代既有大哥大，也有纸条。
  // 世界数据里 carries.note='letter' 一直存在，但此前**没有接线** → 明明有纸条，却没有任何地方能读它。
  if (c.note === 'letter' && !t.some(x => x.id === 'letter')) t.push(TOOL_PRESETS.letter);
  if (news === 'radio') t.push(TOOL_PRESETS.radio);
  if (c.map === 'paper') t.push(TOOL_PRESETS.paper);
  else if (c.map === 'compass' || (isCult && !c.map)) t.push(TOOL_PRESETS.compass);
  return t;
}

function hasTimeDevice(data) {
  const tools = (data.meta && data.meta.tools) || [];
  if (tools.some(t => t.id === 'phone' || t.id === 'brick')) return true;
  const p = data.entities && data.entities.player;
  return !!((p && p.inventory || []).some(x => /表|怀表|手表|钟/.test(x.name || '')));
}

function mainVia(data) {
  const tools = (data.meta && data.meta.tools) || [];
  const comm = tools.find(t => t.via);
  return (comm && comm.via) || 'phone';
}

// ================= 画内交互点（插件层：确定性映射，AI 零参与） =================
const FEATURE_ACTIONS = {
  '窗':   [{ id: 'weather', label: '看看窗外', say: '我看看窗外' }],
  '雨棚': [{ id: 'weather', label: '看看外面', say: '我看看窗外' }],
  '收音机': [{ id: 'radio', label: '听一听新闻', say: '我听会儿收音机' }],
  '电视': [{ id: 'radio', label: '看电视', say: '我打开电视看看' }],
  '床':   [{ id: 'sleep', label: '睡一觉', say: '睡觉' }],
  '榻':   [{ id: 'sleep', label: '歇一歇', say: '睡觉' }],
  '柜台': [{ id: 'ask', label: '问问价钱', say: '我看看东西的价钱' }],
  '棋桌': [{ id: 'look', label: '去看棋局', say: '我去看看棋局' }]
};
function featKey(f) {
  if (/窗/.test(f)) return '窗';
  if (/雨棚|棚/.test(f)) return '雨棚';
  if (/收音机|广播|收音/.test(f)) return '收音机';
  if (/电视/.test(f)) return '电视';
  if (/床|榻/.test(f)) return '床';
  if (/柜台/.test(f)) return '柜台';
  if (/棋/.test(f)) return '棋桌';
  return null;
}
function isShopPerson(p) {
  const idn = (p.profile || {}).identity || {};
  return /老板娘|老板|掌柜|店主|当家人/.test(String(idn.职业 || '') + String(idn.身份 || '') + String((p.tags || []).join(' ')));
}
function hasCommTool(data) { return !!((data.meta && data.meta.tools || []).find(t => t.via)); }
function canSeeWeather(data) {
  const pl = getEntity(data, data.current.sceneId);
  if (!pl) return true;
  if (!(pl.tags || []).includes('室内')) return true;
  if ((pl.features || []).some(f => /窗|棚/.test(f))) return true;
  if ((pl.edges || []).length > 0) { data.__peekViaDoor = true; return true; }
  return false;
}
function canRadio(data) {
  const pl = getEntity(data, data.current.sceneId) || {};
  if ((pl.features || []).some(f => /收音机|电视|广播/.test(f))) return true;
  return !!((data.meta && data.meta.tools || []).find(t => t.id === 'radio'));
}

// ================= 俯视 2D 场景平面图（静态 · 只画当前场景 · 有边界） =================
// 画布：内宽 CW=50；行=房间平面：墙▒ / 地板· / 陈设块 + 标签；人物名字钉在所在格
/* v1.37：画布宽度**不再是常量** —— 每个模板/布局自己声明多宽。
   用户口径（2026-09-14）：「不限制，画出来怎样就是怎样（别出现 UI 错误）。
   AI 认为 100 个字符数不够，那就可以 100×100。」
   做法：宽度来自 template.w / place.layout.w；渲染端对**任何**宽度都必须成立。
   CW_DEF=50 只是老模板与兜底的默认值，不是限制。 */
const CW_DEF = 50;
const CW_MIN = 24, CW_MAX = 160;   // 下限防"画不成画"；上限防"一行几万个字符把渲染拖死"（UI 错误防线）
function normW(w) {
  const n = Math.round(Number(w) || 0);
  if (!n) return CW_DEF;
  return Math.max(CW_MIN, Math.min(CW_MAX, n));
}
// "当前画布"：模块级可变，让模板里的 B()/cap()/bot()/WALL 自动跟随 —— 模板代码一行不用改
let CW = CW_DEF;
let B = (s) => '║' + padOf(String(s), CW) + '║';
let WALL = () => '▒'.repeat(CW);          // ★ 取值函数：画布宽度是运行时可变的
function setCW(w) {
  CW = normW(w);
  B = (s) => '║' + padOf(String(s), CW) + '║';
  WALL = () => '▒'.repeat(CW);
  return CW;
}
const cwOf = (tpl) => normW((tpl && tpl.w) || CW_DEF);
// 按**显示宽度**补齐：中文/全角占 2 列。按字符数补会让中文一多就破框（实测）。
function dispW(s) { let w = 0; for (const ch of String(s == null ? '' : s)) w += (ch.codePointAt(0) > 0x2E80 ? 2 : 1); return w; }
function padOf(s, w) {
  s = String(s == null ? '' : s);
  let out = '', n = 0;
  for (const ch of s) { const cw = ch.codePointAt(0) > 0x2E80 ? 2 : 1; if (n + cw > w) break; out += ch; n += cw; }
  return out + ' '.repeat(Math.max(0, w - n));
}
const cap = () => '╔' + '═'.repeat(CW) + '╗';
const bot = () => '╚' + '═'.repeat(CW) + '╝';   // 两者都读当前 CW（setCW 后自动跟随）

const SHOP = {
  lines: [
    B(WALL()),
    B(' ╱  ╱  ╱  ╱  ✧ ✦ ✧ ✦ ✧ ✦ ✧ ✦ ✧ ✦ ✧ ╱  ╱  ╱  ╱  ╱'),
    B(' ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁'),
    B(' [货架▸ ▐（空）░    ▔▔▔ [窗▸]'),
    B(' ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·'),
    /* ── 柜台：俯视平面图画法（用户 2026-09-14 两次实测反馈后的定稿）──
       ① 用户先说「账本/算盘/糖罐看着像在柜台下面」→ 我加台面线 ▔/前缘 ▁（斜视角思路）；
       ② 用户再指出「这是上帝视角、垂直向下，不是斜面；沈姨怎么站在柜台里」→ 上一版方向错。
       俯视图正确画法：
         · 柜台 = 一个矩形框（平面轮廓），框内是台面
         · 柜台上的东西（账本/算盘/糖罐）画在框内 → 一眼就是「摆在台面上」
         · 人（沈姨/你/阿岩）画在框外地面 → 不可能再出现「人站在柜台里」
       行号与 anchors 一一对应，由 scripts/art-perspective-check.js 兜住。 */
    B(' ·  ·  ·  ·  ·┌────────────────────┐ ·  ·  ·  ·  ·'),
    B(' ·  ·  ·  ·  ·│░账本 ░算盘 ░糖罐   │ ·  ·  ·  ·  ·'),
    B(' ·  ·  ·  ·  ·│      柜 台         │ ·  ·  ·  ·  ·'),
    B(' ·  ·  ·  ·  ·└────────────────────┘ ·  ·  ·  ·  ·'),
    B(' ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·'),
    B('▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ [门▸] ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒'),
    B('')
  ],
  /* 俯视图锚点：行号与上面的矩形框画法一一对应（改画法必须同步改这里）
     counter = 柜台框内标签行（人在柜台里/柜台后）｜ items = 框内台面（台面上的东西）
     you     = 柜台南侧的空地（玩家站的地方）｜ shelf = 北墙货架｜ door = 南墙门｜ 其余为室内空地 */
  anchors: { counter: [10, 34], items: [6, 19], shelf: [3, 4], desk: [5, 30], near: [5, 42], you: [9, 24], road: [9, 22], lamp: [3, 25], door: [10, 24], bed: [1, 4] },
  slots: { shelfRow: 3, windowTag: '[窗▸]', featRow: 10, featCol: 42, doorRow: 11, doorCol: 23, doorLen: 4 }
};
const OUTDOOR = {
  lines: [
    B('─' + '·'.repeat(CW - 2) + '─'),
    B(' ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·'),
    B(' ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·'),
    B(' ·  ·  ·  ·  ·  ·  ·  ·  ◯路灯  ◯  ·  ·  ·  ·  ·'),
    B(' ┌────┐ ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  · ┌──┐'),
    B(' │民房  │ ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  · │墙 │'),
    B(' └────┘ ·  ·  ·  ·  · [路口] ░路牌 ·  ·  · └──┘'),
    B(' ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·'),
    B(' ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·'),
    B(' ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·'),
    B(' ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·'),
    B('─'.repeat(18) + '[去▸]' + '─'.repeat(Math.max(0, CW - 18 - 4)) + '──'),
    B('')
  ],
  anchors: { road: [6, 22], lamp: [3, 25], near: [7, 30], counter: [4, 30], door: [8, 4], desk: [4, 36], you: [10, 24], bed: [1, 4] },
  slots: { featRow: 9, featCol: 42, doorRow: 11, doorCol: 18, doorLen: 4 }
};
const INDOOR = {
  lines: [
    B(WALL()),
    B(' ✦ ··············· ✦ ················· ✦'),
    B(' ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇  ·  ·  ·  · ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁    '),
    B(' [床]  ░被褥  ░枕           ·  [桌]  ░茶壶'),
    B(' ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·'),
    B(' ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·'),
    B(' ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·'),
    B(' ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·'),
    B(' ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·'),
    B(' ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·'),
    B(' ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·'),
    B(' ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·'),
    B('▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ [门▸] ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒'),
    B('')
  ],
  anchors: { desk: [4, 26], bed: [3, 3], door: [10, 3], counter: [4, 30], near: [4, 42], you: [11, 24], road: [6, 22], lamp: [3, 25] },
  slots: { featRow: 10, featCol: 42, doorRow: 12, doorCol: 23, doorLen: 4 }
};


// ---------- 布局渲染（v1.28）----------
// 模板不再是"查表配方"，只提供**格式约定**（尺寸 50 列 / 边框 / 记号写法）。
// 内容来自 AI 给这个地点写的 place.layout：{ north, east, south, west, floor }。
// 为什么：模板只有 4 个且 INDOOR 是万能兜底 → 公寓/教室/办公室/医院/检查室全长一样。
function layoutTemplate(place) {
  const L = (place && place.layout) || null;
  if (!L || typeof L !== 'object') return null;
  const pick = (v, n) => (Array.isArray(v) ? v : []).map(x => String(x || '').trim()).filter(Boolean).slice(0, n);
  const tag = String((place.tags || []).join(' ')) + ' ' + String(place.name || '');
  const isShop = /店铺|杂货|铺|百货|小店|便利店|客栈|当铺/.test(tag);
  const tg = (s) => String(s).slice(0, 9);

  /* v1.39：**按画布容量放东西**（用户：画大一点，不复杂的突出结构）
     老版本每面墙写死上限（north≤3 / east≤2 / west≤2 / floor≤4）——
     画布一放大，东西还是那几件，中间和四角全是空的（100 列实测："四周摆东西、中间空荡荡"）。
     新规则：容量按**当前画布宽度**算，画布越大放得越多（上限仍然兜住，别变成杂货堆）。 */
  const capN = Math.max(2, Math.min(6, Math.floor(CW / 16)));        // 北墙
  const capSide = Math.max(1, Math.min(4, Math.floor(CW / 26)));     // 东西墙
  const capFloor = Math.max(2, Math.min(8, Math.floor(CW / 12)));    // 地面
  const capSouth = Math.max(2, Math.min(5, Math.floor(CW / 20)));    // 南墙（门两侧）
  const south = pick(L.south, capSouth), floor = pick(L.floor, capFloor);

  /* v1.40：**高度也不设限**（用户：宽高都不设限啊）。
     h 来自 place.layout.h；不给就按内容量估；夹在 8~60 行防极端值（字体由前端自适应）。 */
  const wantH = Math.round(Number(L.h) || 0);
  const north = pick(L.north, capN), east = pick(L.east, capSide), west = pick(L.west, capSide);
  const rowCount = Math.max(8, Math.min(60, wantH || (12 + Math.max(0, Math.ceil((floor.length + north.length - 6) / 2)))));

  // 沿宽度均匀铺开（左起 left 列，占满 span 列）
  const spread = (items, span, left, sym) => {
    if (!items.length) return '';
    const cells = items.map(x => (sym || '░') + tg(x));
    if (items.length === 1) return ' '.repeat(left) + cells[0];
    const used = cells.reduce((a, c) => a + dispW(c), 0);
    const room = Math.max(4, span - left);
    let gap = Math.floor((room - used) / (items.length - 1));
    if (gap < 2) gap = 2;
    while (used + gap * (items.length - 1) > room && gap > 2) gap--;
    return ' '.repeat(left) + cells.join(' '.repeat(gap));
  };

  const out = [];
  out.push(B(WALL()));                                                                   // 0 北墙
  out.push(B(spread(north, CW, 1, '▇')));                                                // 1 北墙陈设（贴墙 → ▇）
  out.push(B(''));
  // 3 西/东墙陈设（俯视图：西在左、东在右）
  const colL = west.length ? (' ' + west.map(x => '░' + tg(x)).join('  ')) : '';
  const colR = east.length ? (east.map(x => tg(x) + '░').join('  ')) : '';
  const half = Math.max(8, Math.floor(CW / 2) - 3);
  out.push(B(padOf(colL, half) + padOf(colR, CW - half)));
  out.push(B(''));
  // 5 地面陈设：按容量铺满整行
  if (floor.length) out.push(B(spread(floor, CW - 2, 1, '░')));
  // 地板行：按当前画布宽度铺满
  /* 地板：'· ' 铺满，再按画布宽度点缀 '★'（地面上的东西/痕迹）。
     为什么不是纯 · ：画布越大，中间那片空地板看着像"没画完"（100 列实测）。
     用低密度的 ★ 让空地看着像地面，而不是空白。密度随画布宽度增加。 */
  const floorRow = (marks) => {
    let s = ''; while (dispW(s) < CW) s += ' · ';
    if (!marks) return s;
    const arr = Array.from(s);
    const gap = Math.max(6, Math.floor(CW / 30) * 3);
    for (let i = 1; i < arr.length - 1; i += gap) { if (arr[i] === '·') arr[i] = '★'; }
    return arr.join('');
  };
  while (out.length < rowCount - 2) out.push(B(floorRow(out.length % 2 === 1)));
  // 12 南墙 + 门（门居中）
  const doorAt = Math.max(2, Math.floor(CW / 2) - 9);
  const southRow = '▒'.repeat(doorAt) + ' [门▸] ' + '▒'.repeat(Math.max(0, CW - doorAt - 6));
  out.push(B(southRow));
  out.push(B(''));
  return {
    kind: 'layout',
    lines: out,
    /* 落格必须在**纯半角空行**上（row 6~11）。陈设行里有全角中文，
       而 put() 用字符索引写入 —— 写在陈设行上会撑破数组让行超宽（实测破框）。
       改这里的行号前先确认那几行确实没有全角内容。 */
    anchors: {
      /* 锚点行随画布高度铺开：从第 6 行起均匀分布到南墙之前（全部是纯空地行） */
      counter: [6, 32], desk: [6, 18], seat5: [6, Math.max(20, CW - 10)], bed: [7, 8], shelf: [7, Math.max(20, CW - 14)],
      seat1: [7, 16], seat2: [8, 36], seat3: [rowCount - 5, 10], seat4: [rowCount - 5, 30],
      lamp: [rowCount - 4, Math.max(20, CW - 12)], near: [rowCount - 3, 40], door: [rowCount - 2, 5], road: [8, 22], you: [rowCount - 3, 24]
    },
    slots: { shelfRow: isShop ? 1 : null, windowTag: null, featRow: rowCount - 3, featCol: Math.max(6, CW - 8), doorRow: rowCount - 2, doorCol: Math.max(2, Math.floor(CW / 2) - 2), doorLen: 4 }
  };
}

// ---------- 场景底版 place.art（v1.31）----------
// 为什么：旧实现里画是「模板现拼」——模板只有 SHOP/INDOOR/OUTDOOR 三个全局常量，
// 实测两个不同的店 18 行里 15 行完全相同（83% 是同一个柜子）。而且 layoutFingerprint 不含
// place.layout，AI 改了格局画也不重画。用户定的口径：
//   ① 画要**存进地点**，下次直接拿出来摆或改（不是每回合现拼）
//   ② 控制**不要和上一张完全不同**（骨架稳定，改的是局部）
// 设计：base（长期骨架，很少改）+ marks（具名锚点，坐标的来源）+ rev（改过几次）。
// 关键：锚点存的是**这个地点的坐标**，所以「沈姨在柜台后面」= 她的状态 + 本店的 marks.counter，
// 而不再是模板写死的格子 —— 这才是「人物坐标会更新」的前提。
const ART_SCHEMA = 1;
const ANCHOR_KEYS = ['counter', 'desk', 'bed', 'shelf', 'door', 'road', 'lamp', 'seat1', 'seat2', 'seat3', 'seat4', 'seat5', 'near', 'you'];
// 合并锚点：模板锚点打底，画里扫出来的覆盖 —— 但**只覆盖有效值**。
// （第一版把 scanMarks 预置成全 null，结果扫不到的位置反而把模板的真锚点抹掉了，counter 直接丢了。）
function mergeMarks(fromTpl, fromArt) {
  const out = {};
  for (const k of ANCHOR_KEYS) {
    const t = (fromTpl || {})[k];
    if (Array.isArray(t)) out[k] = t;
  }
  for (const k of Object.keys(fromArt || {})) {
    const a = fromArt[k];
    if (Array.isArray(a)) out[k] = a;
  }
  return out;
}

// 从画里扫描出锚点：陈设行上的 '▇名' / '░名' / '[名▸]' 记号都是可站/可用的位置。
// 注意：只登记**扫到**的锚点，不要预置 null —— 否则合并时会用 null 覆盖掉模板给的真锚点（已踩）。
function scanMarks(lines) {
  const marks = {};
  const put1 = (k, r, c) => { if (k && !marks[k]) marks[k] = [r, c]; };
  for (let r = 0; r < lines.length; r++) {
    const s = String(lines[r] || '');
    // 陈设记号：▇ 或 ░ 后面跟名字（全角占 2 列）
    const re = /[▇░]([\u4e00-\u9fa5A-Za-z]{1,9})/g;
    let m;
    while ((m = re.exec(s))) {
      const nm = m[1];
      const col = m.index;
      if (/柜|台|counter/.test(nm)) put1('counter', r, col);
      else if (/桌|台面|桌案|榻|床/.test(nm)) put1('desk', r, col);
      else if (/床|铺|炕/.test(nm)) put1('bed', r, col);
      else if (/架|柜架|货|书/.test(nm)) put1('shelf', r, col);
      else if (/灯|烛|油灯/.test(nm)) put1('lamp', r, col);
    }
    /* 方括号写法也要认（原来只认 ░柜台）——否则改画法忘改常量就静默错位 */
    const cb = s.indexOf('[ 柜台 ]');
    if (cb >= 0) put1('counter', r, cb);
    const d = s.indexOf('[门');
    if (d >= 0) put1('door', r, d);
  }
  return marks;
}

// 取（或首次生成）这个地点的底版。存进 place.art，随世界存档持久化。
// layout 变了（AI 提议了新格局）→ 重画 base 并重新扫锚点（修 layoutFingerprint 漏 layout 的 bug）。
function ensureArt(data, place) {
  if (!place || place.type !== 'place') return null;
  const __prevCW = CW;
  try {
  // 布局可以自带宽度（AI 决定画多大）；没写就用模板/默认
  const layoutW = (place.layout && place.layout.w) ? place.layout.w : null;
  if (layoutW) setCW(layoutW);
  const tpl = templateFor(place);
  if (tpl.w) setCW(tpl.w);
  /* 指纹必须同时包含"格局"与"模板本身"。
     原来只序列化 place.layout —— 改了模板画法后已存在的存档指纹不变 → 继续用旧底版
     → 改动对新旧世界都不生效（2026-09-14 实测踩到）。模板用轻量哈希串进指纹。 */
  const tplHash = (function (t) {
    let h = 5381, s = '';
    const ls = (t && t.lines) || [];
    for (const l of ls) s += l.length + ',';
    s += '|' + Object.keys((t && t.anchors) || {}).sort().join('+') + '|' + Object.keys((t && t.slots) || {}).sort().join('+');
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  })(tpl);
  const sig = JSON.stringify((place && place.layout) || null) + '#tpl' + tplHash;
  const cur = place.art;
  if (cur && cur.schema === ART_SCHEMA && cur.base && cur.sig === sig) return cur;
  const base = tpl.lines.slice();
  const art = {
    schema: ART_SCHEMA,
    sig: sig,                                   // 格局指纹：变了才重建 base
    base: base,                                 // 长期骨架（行数组，可局部改）
    marks: mergeMarks(tpl.anchors, scanMarks(base)),   // 模板锚点 + 画里扫出来的（扫到的优先，null 不覆盖）
    slots: tpl.slots || {},
    w: CW,                                      // ★ 这张底版的画布宽度（sceneModel 靠它复现同一画布）
    rev: (cur && cur.rev ? cur.rev : 0) + 1
  };
  place.art = art;
  return art;
  } finally { setCW(__prevCW); }
}
function templateFor(place) {
  const byLayout = layoutTemplate(place);   // AI 给了布局就用它（模板退成格式约定）
  if (byLayout) return byLayout;
  const tags = (place.tags || []).join(' ');
  const name = String(place.name || '');
  if (/店铺|杂货|铺|百货|小店|便利店|客栈|当铺/.test(tags + name)) return SHOP;
  if (/室外|路口|街|路|广场|码头|巷|桥/.test(tags + name)) return OUTDOOR;
  if (/茶|棋|酒|饭|馆|食/.test(tags + name)) {
    const t = { kind: 'tea', lines: INDOOR.lines.slice(), anchors: INDOOR.anchors, slots: INDOOR.slots };
    t.lines[2] = B(' ·  ·  ·  ·  ·  ·  · ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁  ·  ·  ·');
    t.lines[3] = B(' ·  ·  ·  ·  ·  ·  ·  [ 棋 桌 ]  ·  ·  ·  ·  ·  ·  ·');
    return t;
  }
  return INDOOR;
}

// NPC → 站位（俯视平面上的格子）
function spotFor(npc) {
  const idn = (npc.profile && npc.profile.identity) || {};
  // v1.31：**当下的动作先行** —— override.reason 是"她此刻在干什么"，比身份更能决定她站在哪。
  // 旧实现把两者拼成一个字符串一起匹配，于是"柜"这个字出现在职业里就永远赢，人不会动。
  const nowDoing = String((npc.state && npc.state.override && npc.state.override.reason) || '');
  if (nowDoing) {
    if (/门口|门边|门外|檐|避雨|蹲/.test(nowDoing)) return 'door';
    if (/柜台|柜台后|算账|收银/.test(nowDoing)) return 'counter';
    if (/床边|床边|躺|睡|起不来/.test(nowDoing)) return 'bed';
    if (/桌|坐着|下棋|喝茶/.test(nowDoing)) return 'desk';
    if (/货架|理货|上货/.test(nowDoing)) return 'shelf';
    if (/路上|街上|过来|走来/.test(nowDoing)) return 'road';
  }
  const h = nowDoing + ' ' + String(idn.职业 || '') + String(idn.身份 || '') + ' ' + String((npc.tags || []).join(' '));
  if (/柜|店|老板娘|店主|掌柜|老板|当家人/.test(h)) return 'counter';
  if (/檐|门口|门边|避雨|蹲|门外|看门/.test(h)) return 'door';
  if (/茶|桌|棋|客|常客|摆棋/.test(h)) return 'desk';
  if (/床|睡|榻/.test(h)) return 'bed';
  if (/路|街|灯/.test(h)) return 'road';
  return 'near';
}

function put(grid, row, col, text) {
  const line = grid[row];
  if (!line) return;
  /* v1.37：写入前先清掉这一行的边框字符。
     原因：put() 用**字符索引**写入，行里有全角中文时"字符索引"与"显示列"不对应，
     于是末位的 ║ 有时被覆盖成空格 → fitFrame 补一个 ║ → 画面上出现两个 ║（破框，实测踩到）。
     统一由 fitFrame 收尾补边框，这里只负责"别留旧边框"。 */
  for (let i = 0; i < line.length; i++) if (line[i] === '║' || line[i] === '╔' || line[i] === '╗' || line[i] === '╚' || line[i] === '╝') line[i] = ' ';
  const t = String(text).slice(0, 8);
  let c = col;
  for (const ch of t) {
    const w = ch.codePointAt(0) > 0x2E80 ? 2 : 1;   // 全角占两列
    if (c < 0 || c >= line.length) break;
    line[c] = ch;
    if (w === 2 && c + 1 < line.length) line[c + 1] = ' ';   // 右半格让出来 —— 否则整行超宽 1，把收尾的 ║ 挤掉（实测）
    c += w;
  }
}

// ---------- 天气演出（内置库：世界状态 → 演出手册；前端按手册播放 CSS 动画） ----------
const WX_FX = [
  [/龙卷风|台风/, { kind: 'storm', shake: true, dark: 0.22, note: '风在吼……', durSec: 5 }],
  [/雷阵雨|雷雨/, { kind: 'rain-heavy', flash: true, shake: true, dark: 0.28, note: '轰——', durSec: 5.5 }],
  [/暴雨|大雨/, { kind: 'rain-heavy', dark: 0.22, note: '雨声密得像墙。', durSec: 5 }],
  [/中雨/, { kind: 'rain', dark: 0.12, note: '雨棚上噼啪响着。', durSec: 5 }],
  [/小雨|细雨|毛毛/, { kind: 'rain-light', dark: 0.06, note: '雨丝很轻。', durSec: 4.5 }],
  [/暴雪|大雪/, { kind: 'snow-heavy', dark: 0.14, note: '雪落得睁不开眼。', durSec: 5 }],
  [/雪|霜/, { kind: 'snow', dark: 0.08, note: '雪片落地无声。', durSec: 4.5 }],
  [/雾|霾|阴霾/, { kind: 'fog', dark: 0.16, note: '几步外就看不清。', durSec: 5 }],
  [/高温|酷热|热|盛夏/, { kind: 'heat', dark: 0.05, note: '热浪在扭动。', durSec: 4.5 }],
  [/雨/ , { kind: 'rain', dark: 0.1, note: '雨一直没停。', durSec: 4.5 }],
  [/阴/, { kind: 'overcast', dark: 0.18, note: '', durSec: 4 }],
  [/多云/, { kind: 'cloudy', dark: 0.08, note: '', durSec: 4 }],
  [/晴|晴空|放晴/, { kind: 'sun', dark: 0, note: '', durSec: 3.5 }]
];
// weather: 天气文本；muted=true（室内无窗/遮雨棚：不播画面，只给声音暗示）
function weatherFx(weather, muted) {
  const w = String(weather || '晴');
  const hit = WX_FX.find(x => x[0].test(w)) || WX_FX[WX_FX.length - 2];
  const fx = Object.assign({ kind: 'overcast', dark: 0, flash: false, shake: false, note: '', durSec: 4 }, hit[1]);
  if (muted) { fx.mute = true; if (fx.note) fx.note = '（隔着墙听见：' + fx.note + '）'; }
  return fx;
}

// ---------- 布局指纹（画是否要重画：场景/在场可见名/货架商品/天气/时段变了才重画） ----------
const ART_VERSION = 'v6';
function layoutFingerprint(data, nameFn) {
  const sceneId = data.current && data.current.sceneId;
  const nm = (typeof nameFn === 'function') ? nameFn : () => null;
  const place = (data.entities || {})[sceneId] || {};
  // 站位依赖：谁在场 + 各自在哪（state.location/override 变了画就该重画）
  const here = (data.current && present(data, sceneId).filter(p => p.id !== 'player')
    .map(p => p.id + ':' + (nm(p.id) || '?') + '@' + ((p.state || {}).override && (p.state || {}).override.reason || ''))).sort();
  const items = Object.values(data.entities).filter(e => e.type === 'item' && e.at === sceneId).map(e => e.id + ':' + e.name + ':' + (e.bought || 0)).sort();
  const now = (data.current && data.current.time) || '';
  const part = isNaN(parseInt(now.slice(11, 13), 10)) ? '?' : dayPart(now);
  // v1.31 修 bug：旧指纹**不含 place.layout**，所以 AI 提议了新格局、sceneModel 明明能画出来，
  // 却因为指纹"没变"直接命中缓存 → 画永远不更新。同时并入底版 rev（底版重建后必须重画）。
  const layoutSig = JSON.stringify((place && place.layout) || null);
  const artRev = (place && place.art && place.art.rev) || 0;
  return [ART_VERSION, sceneId, here.join(','), items.join(','), data.current && data.current.weather, part, layoutSig, artRev].join('|');
}

// ---------- 场景模型：俯视图 + 交互点 + 画内标记 ----------
function sceneModel(data, nameFn) {
  const __prevCW = CW;                       // 画布宽度是"当前"状态：进入时按本模板设定，退出时恢复
  try {
    const sceneId = data.current && data.current.sceneId;
    const place = getEntity(data, sceneId) || { name: '某处', tags: [], features: [] };
    // v1.31：不再每次现拼模板 —— 取这个地点的**底版**（存在 place.art，随存档持久化）
    const art0 = ensureArt(data, place);
    const tpl = art0
      ? { lines: art0.base.slice(), anchors: art0.marks, slots: art0.slots || {}, w: art0.w }
      : templateFor(place);
    if (tpl.w) setCW(tpl.w);                 // ★ 本模板声明多宽就画多宽（不声明则沿用默认 50）
    const nm = (typeof nameFn === 'function') ? nameFn : (id) => (data.entities[id] || {}).name || null;
    const here = present(data, sceneId).filter(p => p.id !== 'player');
    const items = Object.values(data.entities).filter(e => e.type === 'item' && e.at === sceneId && !e.bought);
    const lines = tpl.lines.slice();
    const marks = [];
    const interacts = [];
    const S = tpl.slots || {};
    // 货架行：物品动态组装（俯视：货架贴北墙）——价格符号跟货币（元/日元/文/灵石…）
    const moneyOf = ((data.entities && data.entities.player && data.entities.player.money) || {});
    const sym = String(moneyOf.sym || (moneyOf.currency === '文' || moneyOf.currency === '灵石' || moneyOf.currency === '物资券' || moneyOf.currency === '铜钱' ? '' : '¥') || '');
    if (S.shelfRow != null && items.length) {
      const names = items.slice(0, 3).map(i => i.name + sym + (i.price || 0));
      let str = ' [货架▸ ▐' + names.join('░ ▐') + '░';
      if (S.windowTag) str = padOf(str, Math.max(10, CW - 14)) + ' ▔▔▔ [窗▸]';   // 窗贴右墙（原写死 38）
      lines[S.shelfRow] = B(str);
      marks.push({ id: '__items', row: S.shelfRow + 1, col: lines[S.shelfRow].indexOf('[货架'), len: 5 });
      interacts.push({
        id: '__items', kind: 'items', label: '货架上的东西',
        actions: items.map(it => ({ id: 'buy:' + it.id, label: it.name + '  ' + sym + (it.price || 0) + (it.desc ? '（' + it.desc + '）' : ''), say: '买' + it.name }))
      });
      if (S.windowTag) {
        const wi = lines[S.shelfRow].indexOf(S.windowTag);
        if (wi >= 0) marks.push({ id: '__feats', row: S.shelfRow + 1, col: wi, len: 4 });
      }
    }
    // 画布
    const grid = [];
    grid.push(cap().split(''));
    for (const r of lines) grid.push(String(r).split(''));
    grid.push(bot().split(''));
    /* v1.37：模板行的左右边框先抹掉 —— 宽度可变后，"模板自带的边框"与"fitFrame 收尾补的边框"
       可能同时存在（画面上出现两个 ║）。统一由 fitFrame 负责补框。 */
    for (let i = 1; i < grid.length - 1; i++) {
      const g0 = grid[i];
      if (g0[0] === '║') g0[0] = ' ';
      if (g0[g0.length - 1] === '║') g0[g0.length - 1] = ' ';
    }
    const used = {};
    let unknown = 0;
    // 落格：先按身份挑位（柜台/门口/桌边…），**被占了就找下一个空位** ——
    // 原来第二个撞位的人直接被丢进"[N人]"，名字都画不出来（实测：两人在同一场景就中招）
    const SEAT_ORDER = ['counter', 'desk', 'bed', 'shelf', 'door', 'road', 'lamp', 'seat1', 'seat2', 'seat3', 'seat4', 'seat5', 'near'];
    for (const p of here) {
      const name = nm(p.id);
      if (!name) { unknown++; continue; }
      // v1.31：站位**优先按本回合的实际状态**（override.reason 是"她此刻在干什么"），
      // 其次才按身份猜。旧实现只看身份 → 沈姨去门口蹲着也照样画在柜台后面（实测不更新）。
      const want = spotFor(p);
      let spot = '';
      for (const c of [want].concat(SEAT_ORDER)) { if (tpl.anchors[c] && tpl.anchors[c] !== null && !used[c]) { spot = c; break; } }
      if (!spot) { unknown++; continue; }
      used[spot] = true;
      const [r, c] = tpl.anchors[spot];
      put(grid, r + 1, c, '●' + String(name).slice(0, 4));
      marks.push({ id: p.id, row: r + 1, col: c, len: Math.min(4, String(name).length) + 1, anchor: spot });
    }
    if (unknown) {
      const [r, c] = tpl.anchors.near || [4, 34];
      put(grid, r + 1, c, '[' + unknown + '人]');
      marks.push({ id: '__unknown', row: r + 1, col: c, len: 5 });
    }
    if (tpl.anchors.you) { const [r, c] = tpl.anchors.you; put(grid, r + 1, c, '[你]'); }
    // 出入口
    const exits = (place.edges || []).map(e => ({ to: e.to, name: (getEntity(data, e.to) || {}).name || e.to, minutes: e.minutes })).filter(x => x.name);
    if (exits.length && S.doorRow != null) {
      marks.push({ id: '__exits', row: S.doorRow + 1, col: S.doorCol, len: S.doorLen });
      interacts.push({ id: '__exits', kind: 'exits', label: '出口',
        actions: exits.map(x => ({ id: 'go:' + x.to, label: '去' + x.name + '（' + x.minutes + '分）', say: '去' + x.name })) });
    }
    // 特征
    const feats = [];
    for (const f of (place.features || [])) { const k = featKey(f); if (k && !feats.some(x => x.k === k)) feats.push({ k, f }); }
    if (feats.length && S.featRow != null) {
      put(grid, S.featRow + 1, S.featCol, '[▸]');
      marks.push({ id: '__feats', row: S.featRow + 1, col: S.featCol, len: 3, text: '[▸]' });
      const acts = [];
      const seenA = {};
      for (const fk of feats) for (const a of (FEATURE_ACTIONS[fk.k] || [])) { if (!seenA[a.id]) { seenA[a.id] = true; acts.push(a); } }
      interacts.push({ id: '__feats', kind: 'feats', label: feats.map(x => x.f).join(' · '), actions: acts });
    }
    // 氛围行
    const weather = String(data.current.weather || '晴').slice(0, 8);
    const now = data.current.time || '';
    const part = isNaN(parseInt(now.slice(11, 13), 10)) ? '夜' : dayPart(now);
    const indoor = /室内|店铺|宅/.test((place.tags || []).join(' '));
    const wea = (indoor && !data.current.weatherSeen) ? '天气未知' : (indoor ? ('窗外' + weather) : weather);
    const note = '┄ ' + (place.name || '某处') + ' · ' + part + (indoor ? ' · 室内' : '') + (wea ? ' · ' + wea : '') + ' ┄';
    // 逐行强制规范化到 CW 显示宽：put() 用字符索引写入，行里有全角中文时可能把数组撑长（破框）。
    // 这里做最后一道兜底 —— 宁可截掉几个字，也绝不让框歪。
    // 逐行**保证成框**：grid 的行已含两侧边框（B() 加的）。
    // 为什么需要兜底：put() 往行里写全角字符（人名/·）时，字符位不变但显示列 +1，
    // 收尾的 ║ 会被挤出去 —— 字符索引和显示列本来就无法一一对应，只能在最后强制收尾。
    /* v1.37：首尾**对称**补框。
       原来只看尾字符：首字符不是 ║ 就直接返回（不补框）—— 而 put() 之前被改成"写入前清边框"，
       于是所有中间行的首字符都成了空格 → 全都不补框 → 画变成"只有上下两条边"（实测踩到）。
       现在：先 padOf 到 CW+2，再无条件保证首尾各是一个 ║。cap/bot 那两行由 grid 直接给，不进这里。 */
    const fitFrame = (s) => {
      let o = padOf(s, CW + 2);
      if (!o) return o;
      // 上下边那一行的角是 ╔╗ / ╚╝，不要被替换成 ║
      const L0 = o.charAt(0), Ln = o.charAt(o.length - 1);
      if (L0 !== '║' && L0 !== '╔' && L0 !== '╚') o = '║' + o.slice(1);
      if (Ln !== '║' && Ln !== '╗' && Ln !== '╝') o = o.slice(0, -1) + '║';
      return o;
    };
    const art = grid.map(r => fitFrame(r.join(''))).join('\n') + '\n' + padOf(note, CW);
    // 交互清单（人物动作）
    const outI = [];
    for (const p of here) {
      const name = nm(p.id);
      if (!name) continue;
      const actions = [{ id: 'talk', label: '说说话', say: '和' + name + '说说话' }, { id: 'stare', label: '打量', say: '我打量一下' + name }];
      if (isShopPerson(p)) actions.push({ id: 'shop', label: '买东西', panel: 'goods' });
      if (hasCommTool(data) && ((data.impressions || {})[p.id] || {}).stage >= 3) actions.push({ id: 'msg', label: '发消息', panel: 'msg' });
      outI.push({ id: p.id, kind: 'person', label: name, actions });
    }
    if (unknown) outI.push({ id: '__unknown', kind: 'persons', label: '陌生面孔', actions: [{ id: 'talk', label: '打个招呼', say: '我过去打个招呼' }, { id: 'stare', label: '打量', say: '我打量一下TA' }] });
    for (const i of interacts) outI.push(i);
    return { art, marks, interacts: outI };
  } catch (e) { return { art: null, marks: [], interacts: [] }; }
  finally { setCW(__prevCW); }
}

function buildSceneArt(data, nameFn) { const m = sceneModel(data, nameFn); return m && m.art; }

module.exports = { TOOL_PRESETS, deriveTools, hasTimeDevice, mainVia, buildSceneArt, sceneModel, layoutFingerprint, canSeeWeather, canRadio, weatherFx, ensureArt, scanMarks, ART_SCHEMA };
