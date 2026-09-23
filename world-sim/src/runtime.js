// runtime.js — 时钟/日程 tick/移动/校验器/漏斗/记忆衰减激活
'use strict';
const DEG = require('./degraded');   // v1.98：世界包写坏时留一笔（不静默放行）
const GATE = require('./gate');      // v1.99 P0-5 第 2 步：候选也是"世界提议的事"，过同一道门（只读预检）
const BUS = require('./bus');        // v2.03 P0-6 收尾：候选的**落库**走总线
const { getEntity, persons, places, present, ledgerPush } = require('./store');
const FX = require('./fx');
const FW = require('./framework');   // v1.51 世界的框架（住在存档里）

// ---------- 时间 ----------
function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function fmtISO(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); }
function addMinutes(iso, m) { const d = new Date(iso); d.setMinutes(d.getMinutes() + m); return fmtISO(d); }
function diffMin(a, b) { return Math.round((new Date(b) - new Date(a)) / 60000); }
function hourOf(iso) { return new Date(iso).getHours(); }
function dayKey(iso) { return ['sun','mon','tue','wed','thu','fri','sat'][new Date(iso).getDay()]; }

// 时段（体感）
function dayPart(iso) {
  const h = hourOf(iso);
  if (h >= 5 && h < 7) return '清晨';
  if (h >= 7 && h < 11) return '上午';
  if (h >= 11 && h < 13) return '正午';
  if (h >= 13 && h < 17) return '午后';
  if (h >= 17 && h < 19) return '傍晚';
  if (h >= 19 && h < 23) return '夜晚';
  return '深夜';
}

// 感知时间：有计时设备→精确；无→时段（设备由世界工具注册表声明）
function perceiveTime(data, iso) {
  const p = data.entities['player'];
  const tools = (data.meta && data.meta.tools) || [];
  const hasTool = tools.some(t => t.id === 'phone' || t.id === 'brick');
  const has = hasTool || (p.inventory || []).some(x => /表|怀表|手表|钟/.test(x.name || ''));
  if (has) return { precise: true, label: iso.slice(5, 16).replace('T', ' ') };
  return { precise: false, label: dayPart(iso) };
}

// 天气感知（插件状态机）：室外=直接知道；室内看过窗外/天气 app 才显示；否则未知（UI 引导去窗边）
// ---------- 天气感知（双通道：视觉≠听觉；代码定物理，AI 定条件） ----------
// 通道可行性（物理层，代码决定）：声音强度 loud 0-3 + 环境衰减 blocked
// 条件（AI 设定层）：场景状态（窗开/关、窗帘、雨棚、门）由 AI 在 updates 里提议，引擎记进 place.features
function canHearWeather(place, weather) {
  const w = String(weather || '晴');
  const feat = ((place && place.features) || []).join(' ');
  const name = String((place && place.name) || '');
  const sealed = ((place && place.tags) || []).includes('室内') && !/窗|棚|阳台|露台|廊/.test(feat + ' ' + name);
  const closed = /密封|隔音|厚墙|关窗|拉上|窗帘|遮光|紧闭/.test(feat);
  const blocked = sealed || closed;
  let loud = 0;
  if (/雷|闪电|打雷/.test(w)) loud = 3;                        // 雷声远传，隔墙无衰减
  else if (/台风|龙卷风|大风|狂风|暴风/.test(w)) loud = blocked ? 2 : 3;
  else if (/暴雨/.test(w)) loud = blocked ? 2 : 3;
  else if (/大雨|雷阵雨/.test(w)) loud = blocked ? 1 : 3;
  else if (/中雨/.test(w)) loud = blocked ? 1 : 2;
  else if (/小雨|细雨|毛毛/.test(w)) loud = 0;                 // 小雨：基本听不见
  else if (/雪|霜|雾|霾/.test(w)) loud = 0;                    // 无声
  return { loud, blocked };
}
function wxSoundText(weather, loud) {
  if (/雷|闪电/.test(weather)) return '雷声滚滚——但雨况未知';
  if (/台风|龙卷风|大风|狂风|暴风/.test(weather)) return '风在吼，隔着墙都发颤——雨况未知';
  if (/暴雨/.test(weather)) return '雨声哗哗砸在墙上——下得不小，但看不到';
  if (/大雨/.test(weather)) return loud >= 3 ? '大雨声透进来——这是场大雨，可到底下多久了？' : '雨声隔墙隐约可闻——雨不小（雨况待确认）';
  if (/中雨/.test(weather)) return '雨声隐隐传来——像是在下雨（雨况待确认）';
  return '隐约有点动静……';
}
function perceiveWeather(data, iso) {
  const place = getEntity(data, data.current.sceneId);
  const w = data.current.weather || '晴';
  if (!place) return { text: w, rough: false, seen: true, heard: true, via: 'sight' };
  const indoor = (place.tags || []).includes('室内');
  if (!indoor) return { text: w, rough: false, seen: true, heard: true, via: 'sight' };
  if (data.current.weatherSeen) return { text: w, rough: false, seen: true, heard: true, via: data.current.weatherVia || 'sight' };
  // 未确认：检查听觉通道
  const h = canHearWeather(place, w);
  if (h.loud >= 2) return { text: wxSoundText(w, h.loud), rough: true, unknown: true, seen: false, heard: true, via: 'sound', cue: '外面动静很大——想知道确切天气，去窗边看看，或者看手机/问人。' };
  if (h.loud === 1) return { text: '隐约有雨声（不太确定）', rough: true, unknown: true, seen: false, heard: true, via: 'sound-faint', cue: '隔着墙听不真切——看看窗外或手机。' };
  return { text: '未知（还没看窗外）', rough: true, unknown: true, seen: false, heard: false, via: 'none' };
}

// ---------- NPC 日程 tick（查表，零 AI） ----------
function schedulePlace(data, person, iso) {
  const st = person.state || {};
  if (st.override) {
    const until = st.override.until;
    const ts = new Date(iso).getTime(), tu = new Date(until).getTime();
    if (!isNaN(tu) && ts < tu) return st.override.place;
    delete st.override; // until 非法或已过期 → 覆盖失效（回到常规日程）
  }
  const h = hourOf(iso);
  const day = dayKey(iso);
  const ws = person._schedule;
  if (ws) {
    const hf = parseInt(ws.from, 10);
    const ht = parseInt(ws.to, 10);
    if (hf <= h && h < ht) return ws.work;
    return ws.home;
  }
  const sched = (person.profile && person.profile.schedule) || {};
  const list = sched[day] || sched.workday || [];
  for (const s of list) {
    const hf = parseInt(s.from, 10), ht = parseInt(s.to, 10);
    if (hf <= h && h < ht) return s.place;
  }
  // 默认：睡觉在家
  /* v1.87：兜底不再指向演示世界的 id（原来是无日程的人 → 'pl_3'/'pl_4'，对导入世界**这两个 id 不存在**）。
     实测症状：NPC 被塞进悬空地点 ⇒ present() 永远不认他 ⇒ "该在场的人被判成不在场"。 */
  const home = (person.indexes && person.indexes.home) || person._home || '';
  return home || null;   // 没有可去的家 → null = **不动位置**（宁可不动，也不要悬空）
}

function tickNPCs(data, iso) {
  for (const p of persons(data)) {
    if (p.id === 'player') { p.state.location = data.current.sceneId; continue; }
    const pl = schedulePlace(data, p, iso);
    // v1.83 修 P1-8：原来先赋值再比较，pl !== p.state.location 恒为 false（这个标志从来没为真过）
    // v1.87：地点必须真实存在才移动（防任何"写错的地点 id"把 NPC 变到虚空）
    if (pl && data.entities[pl]) { const was = p.state.location; p.state.location = pl; p.state.overriddenBySchedule = (pl !== was); }
  }
}

// ---------- 移动（连通图 BFS + 状态修正） ----------
const LEVEL_BASE = { '同一房间': 0, '同建筑': 3, '同街区': 8, '相邻街区': 15, '跨城区': 40 };
function moveCost(data, fromId, toId, iso) {
  const from = getEntity(data, fromId), to = getEntity(data, toId);
  if (!from || !to) return { ok: false, minutes: 0, path: [], err: '地点不存在' };
  if (fromId === toId) return { ok: true, minutes: 0, path: [fromId] };
  const adj = {};
  for (const p of places(data)) for (const e of (p.edges || [])) {
    if (!adj[p.id]) adj[p.id] = [];
    if (!adj[p.id].some(x => x.to === e.to)) adj[p.id].push(e);
    if (!adj[e.to]) adj[e.to] = [];
    if (!adj[e.to].some(x => x.to === p.id)) adj[e.to].push({ to: p.id, level: e.level, minutes: e.minutes });
  }
  // BFS
  const dist = {}, prev = {}, used = {};
  const q = [fromId]; dist[fromId] = 0;
  while (q.length) {
    const cur = q.shift();
    if (cur === toId) break;
    for (const e of (adj[cur] || [])) {
      const w = (e.minutes != null ? e.minutes : LEVEL_BASE[e.level] || 10);
      if (dist[e.to] == null || dist[cur] + w < dist[e.to]) { dist[e.to] = dist[cur] + w; prev[e.to] = cur; used[e.to] = e; q.push(e.to); }
    }
  }
  if (dist[toId] == null) return { ok: false, minutes: 0, path: [], err: '没有通路' };
  // 状态修正
  const p = data.entities['player'] || {};
  let mod = 1;
  // v1.83：原来这里是 /momodat|雨/ —— "momodat" 是个损坏的占位符（永不可能匹配），
  // 雨雾天的移动耗时加成事实上只剩"雨"这一半。按原意补回"雾"。
  if (/雾|雨/.test(data.current.weather || '')) mod *= 1.2;
  if (p.state && p.state.fatigue === '高') mod *= 1.15;
  if (hourOf(iso) >= 23 || hourOf(iso) < 5) mod *= 1.1;
  const path = []; let cur = toId;
  while (cur) { path.unshift(cur); cur = prev[cur]; }
  return { ok: true, minutes: Math.max(1, Math.round(dist[toId] * mod)), path };
}

// ---------- 消息异步回复计划（§9 信息旅程：物理运行时算"多久到/何时回"，意愿 AI 判"回不回"） ----------
// 依据 NPC 状态确定性推导"何时才能看/回消息"；连发累积延后；22:00-06:00 视为睡着 → 次日晨
function replyPlan(data, toId, nowISO, unanswered) {
  const npc = getEntity(data, toId) || {};
  const h = hourOf(nowISO);
  const night = (h >= 22 || h < 6);
  let min = 15 + Math.floor(Math.random() * 35);   // 基础 15-50 分钟
  if (night) min = 60 * 7 + Math.floor(Math.random() * 40); // 睡着 → 明早 07:00-07:40
  else if (/老板娘|老板|掌柜|店主|店员|伙计/.test(String((npc.profile || {}).identity || {}).职业 || '')) min = Math.max(min, 35 + Math.floor(Math.random() * 50)); // 在店里忙，迟些看
  const extra = Math.min(Number(unanswered || 0), 4) * 20; // 连发 → 更迟
  const due = addMinutes(nowISO, min + extra);
  return { due, baseMin: min, extra: extra / 20 };
}
function dueReplies(data, nowISO) {
  const list = data.current && data.current.pendingReplies;
  if (!Array.isArray(list)) return [];
  const out = [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (new Date(list[i].due).getTime() <= new Date(nowISO).getTime()) out.push(list.splice(i, 1)[0]);
  }
  return out;
}

// ---------- 年龄与生命（确定性；死亡=事件制，见 epoch.js 人事链 / 意外事件） ----------
function birthYearOf(p) {
  if (p && p.birthYear) return Number(p.birthYear);
  // 无出生年：按档案年龄文本回推一次（"五十多点"→不解析；"55"→可解析）
  return null;
}
function ageOf(data, person, iso) {
  const b = birthYearOf(person);
  if (b == null) return null;
  const y = parseInt(String(iso || data.current.time || '').slice(0, 4), 10);
  return Math.max(0, y - b);
}
function ageStage(a) {
  if (a == null) return null;
  if (a >= 75) return '风烛';
  if (a >= 65) return '老态';
  if (a >= 55) return '渐显';
  return null;
}
function isAlive(p) { return !p || p.state === undefined || p.state.alive !== false; }

// ---------- 白名单 ----------
// v1.46：+ 文档出现（可读文本必须落成对象，否则"打开信件"永远打不开）
//        + 演出（AI 点名效果，词表在 fx.js；校验器 = 限制区执行者）
/* v1.84：**白名单必须 ⊆ 执行器**（设计矛盾清单 M4）。原来 19 类里有 5 类没有执行器，
   校验器放行、运行时什么都不做、不报错不记账 —— AI 写了等于石沉大海。现在的处置：
     · 实现：人物离开 / 物品消耗 / 物品转移（见 game.js applyUpdates）
     · 删除：时间推进（时间归运行时，AI 不许推进）、氛围变化（由 frame.beats 的 ambient 承担）
   加断言：scripts 里新增的 updatetypes 检查会对着一份"执行器表"逐个核对。 */
/* S0：白名单**不再手写**——改从 src/contract.js 取（唯一真源）。
   原来这张表在这儿、执行器在 game.js、说明在 ai.js 的提示词里，三处靠人同步（设计矛盾清单 M4）。
   现在：contract 是源，校验器从它取白名单，提示词从它生成，contract-check.js 断言「白名单 === 执行器」。 */
const CONTRACT = require('./contract');
const UPDATE_TYPES = CONTRACT.UPDATE_TYPE_NAMES;
const DOC_BODY_MAX = 4000;   // 单份文书的正文上限（防止一封信吃掉整个存档/上下文）

// 校验器：AI 提议 → 运行时检查。返回 {allowed, errors}
// 自由度三档：校验器=【限制区】的执行者（白名单/地址存在/因果/烈度/一致性）。
// 【自由区】在 prompt 注明、【默认区】未注明——一律放行：默认自由，越线才拦。
/* v1.98 · P0-4：校验器**产出结构化拒绝**（原来只有一句人话 errors）。
   为什么：被拒的条目此前是"丢了就丢了" —— AI 不知道哪条被拒、为什么，下一回合还可能再犯同一件事。
   现在每条拒绝都带 { index, kind, reason, target }，回合内可以原样回灌给 AI，让它只重出这几条。
   errors 的形状**一个字都没改**（仍是 string[] 的人话）—— 二十多处文案被断言（updatetypes/output-hygiene）
   逐条正则匹配着，动一个字就是改契约。kind 由文案关键词推出（kindOf），所以调用点只需把 errors.push 换成 deny。 */
const KIND_BY_MSG = [
  [/白名单外类型|缺少 type/, '类型'],
  [/归属者不存在|地址不存在|目标不存在|目标非人物/, '地址'],
  [/新人物出现/, '出现'],
  [/因果/, '因果'],
  [/烈度/, '烈度'],
  [/锁定字段/, '锁定'],
  [/定性/, '定性'],
  [/时间不一致/, '时间'],
  [/可见性/, '可见性'],
  [/移动|通路/, '移动'],
  [/框架/, '框架'],
  [/文档/, '文档'],
  [/演出|原语/, '演出'],
  [/冲击力/, '冲击力'],
  [/画面↔Update|不匹配/, '画面']
];
function kindOf(reason) { const s = String(reason || ''); for (const r of KIND_BY_MSG) if (r[0].test(s)) return r[1]; return '其它'; }

// 校验器：AI 提议 → 运行时检查。返回 {allowed, errors, rejected}
// 自由度三档：校验器=【限制区】的执行者（白名单/地址存在/因果/烈度/一致性）。
// 【自由区】在 prompt 注明、【默认区】未注明——一律放行：默认自由，越线才拦。
// 第 4 个形参 ctx 目前**零引用**：留着是给"第二遍校验"用的回合内状态入口（P0-4 的修正轮），别删。
/* ---------- v2.10「有主」：可观察物必须挂在**已经存在的因**上 ----------
   为什么加：原来 `人物出现` 只要求 cause 是**非空字符串**，于是 AI 写一句「剧情需要」
   就能让一个陌生人凭空落地 —— 而 director.js 里那个默认值**就是** '剧情需要'。
   实测：一个"恰好路过的侦察兵 / 恰好知道情报的线人"是模型最顺手的拐杖。

   现在：causeRef 必须**解析得到**一个已经存在的东西（三选一，纯查表，0 token）：
     · entity —— 已存在的实体 id（"周师傅带来的"）
     · ledger —— 已有账本条目 id（"北边下来的人越来越多"那条镜头外事件；**玩家可能从没见过**）
     · beyond —— 世界上游事实 id（更远的事实，玩家永远够不到）
   解析不到 → 拒绝。**你要造人，先得有"谁把他带来的"这件事已经存在于世界上。**

   ★ 它**不禁止偶然**：`subai.js` 的镜头外事件是纯代码池（0 token），一直在产出"偶然"，
   而那些偶然在玩家视图之外 —— 所以**世界知道因果，玩家看到偶然**。这正是信息差。 */
function resolveAnchor(data, ref) {
  const r = (ref && typeof ref === 'object') ? ref : { kind: 'auto', id: String(ref == null ? '' : ref).trim() };
  const id = String(r.id || r.ref || '').trim();
  if (!id) return { ok: false, why: '引用是空的' };
  const kind = String(r.kind || 'auto');
  if ((kind === 'entity' || kind === 'auto') && data.entities && data.entities[id]) return { ok: true, kind: 'entity', id: id };
  if ((kind === 'ledger' || kind === 'auto') && (data.ledger || []).some(l => l && String(l.id) === id)) return { ok: true, kind: 'ledger', id: id };
  if ((kind === 'beyond' || kind === 'auto') && (data.beyond || []).some(b => b && String(b.id) === id)) return { ok: true, kind: 'beyond', id: id };
  return { ok: false, why: '世界上找不到这个因（' + kind + ':' + id + '）' };
}

/* ---------- v2.10.1：锚不只要**存在**，还要**说得出关系** ----------
   自评时发现的洞：上面只验"锚存在"，于是 AI 可以**乱指一条无关的账本条目** ——
   从"编一个字符串"变成"乱指一个 id"，**难度提高了，但没有堵死**。

   补法（不判语义，只判"说得出关系"）：**cause 这句人话必须带上被引用那条东西的关键词**。
     · 锚是实体   → cause 里必须出现**那个人的名字**（中文名两字起）
     · 锚是账本/上游 → cause 与那条 desc/what 必须有 **≥3 字的连续重叠**
   为什么是 3 字：中文里 3 字连续巧合的概率已经很低；而"北边下来的人越来越多" vs
   "北边下来的人多了" -> 重叠"北边下来"（4 字）-> 过关。宁松不严 ——
   它要拦的是**乱指**，不是**表达笨拙**。 */
function longestOverlap(a, b) {
  let best = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = i + best + 1; j <= a.length; j++) {
      if (b.indexOf(a.slice(i, j)) >= 0) best = Math.max(best, j - i);
    }
  }
  return best;
}
function anchorSpeaks(anchor, cause, data) {
  const c = String(cause == null ? '' : cause).replace(/s/g, '');
  if (!c) return { ok: false, why: '没写 cause（人话说明）' };
  if (anchor.kind === 'entity') {
    const e = (data.entities || {})[anchor.id] || {};
    const nm = String(e.name || '').trim().replace(/\s/g, '');
    if (!nm) return { ok: true };                       // 无名实体（地点/物）：无从对词，放行
    if (c.indexOf(nm) >= 0) return { ok: true };
    /* v2.12：实体锚放宽到 **2 字重叠** —— 锚常常是个地点（"云记旧楼"），
       而 cause 里可能只写"楼里账台的抽屉"。名字 2 字带出即算说得出关系；
       ledger/beyond 的 desc 是句子，那里仍然要 3 字（见下）。 */
    if (longestOverlap(nm, c) >= 2) return { ok: true };
    return { ok: false, why: 'cause 里没有出现「' + nm + '」这个名字 —— 说得出关系才算数' };
  }
  const src = (anchor.kind === 'ledger'
    ? (((data.ledger || []).find(x => x && String(x.id) === anchor.id) || {}).desc || '')
    : (((data.beyond || []).find(x => x && String(x.id) === anchor.id) || {}).what || '')
  ).replace(/s/g, '');
  if (longestOverlap(src, c) >= 3) return { ok: true };
  return { ok: false, why: 'cause 和「' + String(src).slice(0, 16) + '」说不到一块去（要有 3 字以上的连续重叠）' };
}
function validateUpdates(data, updates, frame, ctx) {
  const allowed = []; const errors = []; const rejected = [];
  let fxSeen = 0;   // 本回合已放行的演出数（≤1，见 fx.js）
  const list = updates || [];
  for (let i = 0; i < list.length; i++) {
    const u = list[i];
    // 唯一收口：人话进 errors（形状不变），结构化进 rejected（给 AI 的回执用）
    const deny = (reason) => { errors.push(reason); rejected.push({ index: i, kind: kindOf(reason), reason: String(reason), target: String((u && (u.target || u.owner || u.to)) || '') }); };
    if (!u || !u.type) { deny('缺少 type'); continue; }
    if (!UPDATE_TYPES.includes(u.type)) { deny('白名单外类型: ' + u.type); continue; }
    const tid = u.target;
    const isEvent = (u.type === '事件开始' || u.type === '事件结束');
    /* ★ v2.10 修（真 bug）：`人物出现` 的 target **按契约就是"新 id"**（contract.js:72 与提示词都这么写），
       而这一行原来先把"不存在的 target"全拒了 —— 于是下面那段专门给新人物写的分支
       （必须带 spawn.name / relation / 可解析的因）**永远跑不到**。
       后果：**「AI 造新角色」这条路是死的**，game.js:512-547 的 applySpawn 是死代码，
       而 195 条断言全绿（没有任何脚本测过"造一个新人成功"）。
       修法：把 `人物出现` 加进"允许 target 尚不存在"的名单（事件本来就在这份名单里）。 */
    const mayCreate = (u.type === '人物出现');
    if (tid && !isEvent && !mayCreate && !getEntity(data, tid) && tid !== 'player') { deny('地址不存在: ' + tid); continue; }
    /* ---------- v2.12「有主」推广：凡"把新东西带进玩家世界"的 Update，都要有主 ----------
       名单在 contract.js（NEEDS_ANCHOR）——加一个字就能扩到新类型。
       分界：已经在世界里的（记忆/关系/情绪/事件进展/地点变化）不需要锚，它们改的是既有事实；
             **新登场的**（人 / 物 / 文）必须有主，"凭空出现"只可能发生在它们身上。
       锚必须**存在**（resolveAnchor）**且说得出关系**（anchorSpeaks）——
       只有存在性的话，AI 乱指一条无关账目就能过关；只有相关性的话，编一句人话就能过关。 */
    const bringNew = (u.type === '人物出现') ? !getEntity(data, u.target) : true;
    if (CONTRACT.NEEDS_ANCHOR.indexOf(u.type) >= 0 && bringNew) {
      const anchor = resolveAnchor(data, u.causeRef || u.cause);
      if (!anchor.ok) { deny(u.type + '必须挂在已有的因上（causeRef 指向 entity/ledger/beyond）：' + anchor.why); continue; }
      const spoke = anchorSpeaks(anchor, u.cause, data);
      if (!spoke.ok) { deny(u.type + '：' + spoke.why); continue; }
      /* v2.11：**宽度也要有上限**。一条上游若能被无限兑现，一个「北方战事」
         就能造出无限个逃兵 —— 那比"空降一个"还假。用尽即拒（并且该结算了）。 */
      if (anchor.kind === 'beyond') {
        const b = (data.beyond || []).find(x => x && String(x.id) === anchor.id);
        if (b && (Number(b.spawned) || 0) >= (b.cap == null ? 2 : Number(b.cap))) {
          deny('这条世界上游已经用尽了（cap=' + (b.cap == null ? 2 : b.cap) + '）：「' + String(b.what || '').slice(0, 20) + '」—— 换一条因，或者让这条线结算');
          continue;
        }
      }
      u._anchor = anchor;
    }
    if (u.type === '人物出现' && !getEntity(data, u.target)) {
      const sp = u.spawn || {};
      if (!sp.name) { deny('新人物出现必须携带 spawn.name'); continue; }
      if (!u.relation) { deny('新人物出现必须声明与玩家/已知人物的关系（relation）'); continue; }
    }
    if (u.type === '印象更新' && !getEntity(data, u.target)) { deny('印象更新目标不存在'); continue; }
    if (u.type === '记忆新增') {
      const owner = u.owner || tid;
      const ow = getEntity(data, owner);
      if (!ow) { deny('记忆归属者不存在: ' + owner); continue; }
      if (!(u.impact >= 0 && u.impact <= 100)) { deny('冲击力需为0-100'); continue; }
    }
    // v1.59 开关穿透 L2：事件烈度上限（世界包 maxSeverity）必须**真的拦**——
    // 原来只在提示词里说了一句（ai.js），校验器里一个字都没有 → AI 写个 L4 也没人管。
    /* ── 事件烈度门（v1.98 · P0-5 第 1 步：**无条件执行**）────────────────────────
       原来的写法是 if (u.severity || u.sev) { ... } —— 两个洞：
         洞① 不写 severity 就整段跳过（等于没有门；AI 只要不写就绕过去了）
         洞③ 世界上限写坏（maxSeverity:'L9'/'中'）时 RANK[max] 是 undefined ⇒ 整条不成立 ⇒ 全放行
       现在：词表在 contract.js（唯一来源），三件事都必须判：
         · 显式给了合法 L 值 → 比上限
         · 显式给了 L5 → 拒（禁止级，不是"超上限"而是"取值非法"）
         · 显式给了"像 L 但写坏"（L9/l5/3）→ 拒；给了**别的词表的词**（低/中/高/灾难 = 新闻那根轴）→ 放行
         · **没写** → 按类型缺省再比（不是无条件放行）
       双轴切分（X12）保留：severity 这个键同时被新闻严重性借用，
       这里只认烈度词表，认不出来又不是"坏 L 值"的当"不是这个轴"放行。 */
    {
      const hasRaw = (u.severity !== undefined && u.severity !== null) || (u.sev !== undefined && u.sev !== null);
      const raw = (u.severity !== undefined && u.severity !== null) ? u.severity : u.sev;
      const got = hasRaw ? CONTRACT.normSev(raw) : '';
      const maxRaw = String((data.meta && data.meta.maxSeverity) || CONTRACT.MAX_DEFAULT);   // 字面量留在本文件（switches/switch-check 读它）
      const maxNorm = CONTRACT.normSev(maxRaw);
      if (!maxNorm && maxRaw) DEG.hit('runtime.js', new Error('世界包的 maxSeverity 非法：' + maxRaw + ' → 回落 ' + CONTRACT.MAX_DEFAULT));
      const max = maxNorm || CONTRACT.MAX_DEFAULT;
      if (got) {
        if (CONTRACT.BANNED_LEVELS.indexOf(got) >= 0) { deny('事件烈度 ' + got + ' 取值非法（L5 是禁止级，引擎不提供；本世界上限 ' + max + '）'); continue; }
        if (CONTRACT.RANK[got] > CONTRACT.RANK[max]) { deny('事件烈度 ' + got + ' 超过世界上限 ' + max); continue; }
      } else if (hasRaw && String(raw).trim() !== '') {
        if (CONTRACT.isLish(raw) || /^\d+$/.test(String(raw).trim())) { deny('事件烈度取值非法: ' + raw + '（合法取值 L1–L4；本世界上限 ' + max + '）'); continue; }
      } else {
        const dv = CONTRACT.sevDefault(u.type);
        if (CONTRACT.RANK[dv] > CONTRACT.RANK[max]) { deny('事件烈度 ' + dv + '（' + u.type + ' 的缺省）超过世界上限 ' + max); continue; }
      }
    }
    if (u.type === '关系变化' && !u.cause) { deny('关系变化必须带因果引用'); continue; }
    /* ── v1.84：补齐设计总稿 §129 里"声明了、校验器里却一个字都没有"的四条 ── */
    // ① 关系定性（无数值）：关系只许定性，禁止数值化
    if (u.type === '关系变化' && (typeof u.change === 'number' || /^[+-]?\d+$/.test(String(u.change == null ? '' : u.change).trim()))) {
      deny('关系变化必须定性（不许数值）: ' + u.change); continue;
    }
    // ② 锁定字段未触：locked.core 是硬事实层（导入时写定，运行期只读）
    if ((u.field && /^(locked|core)$/.test(String(u.field))) || (u.patch && (u.patch.locked || u.patch.core))) {
      deny('触碰锁定字段（locked.core 运行期只读）'); continue;
    }
    // ③ 时间一致：Update 不许自带一个跟运行时对不上的时间（≤30 分钟容差；给不出合法时间的不管）
    if (u.t) {
      const dmin = Math.abs(new Date(u.t).getTime() - new Date(data.current.time).getTime()) / 60000;
      if (isFinite(dmin) && dmin > 30) { deny('时间不一致: ' + u.t + '（当前 ' + data.current.time + '）'); continue; }
    }
    // ④ 可见性合规：只允许四个值
    if (u.visible != null && ['scene', 'public', 'pc-only', 'secret'].indexOf(String(u.visible)) < 0) {
      deny('可见性非法: ' + u.visible); continue;
    }
    /* ⑤ v1.84 移动合法（原来整条不存在 —— AI 一条 Update 就能免费瞬移玩家）：
       目标必须存在、不能是原地、必须有通路、必须带因果；耗时交给 applyUpdates 按同一套规则算。 */
    if (u.type === '地点变化') {
      const dest = String(u.to || '').trim();
      if (!dest || !getEntity(data, dest)) { deny('地点变化的目标不存在: ' + dest); continue; }
      if (dest === data.current.sceneId) { deny('地点变化的目标就是当前所在'); continue; }
      const c = moveCost(data, data.current.sceneId, dest, data.current.time);
      if (!c.ok) { deny('非法移动（没有通路）: ' + dest); continue; }
      if (!u.cause) { deny('地点变化必须带因果（因何事去了那里）'); continue; }
      u._moveMinutes = c.minutes;
    }
    if (u.type === '框架') {
      // AI 只能**提议**给世界长词/型/律；合不合法（形式、上限、边界）由引擎说了算（v2.08 起无档位）
      const c = FW.canPropose(data, u);
      if (!c.ok) { deny(c.err); continue; }
    }
    if (u.type === '文档出现') {
      // 契约：可读文本的**正文**必须落在 body 里。只写进旁白 = 玩家之后永远打不开它（实测病根）
      const title = String(u.title || u.name || '').trim();
      const body = String(u.body || '').trim();
      if (!title) { deny('文档出现必须带 title（这份文书叫什么）'); continue; }
      if (body.length < 8) { deny('文档出现必须有正文 body（' + title + '）——内容只写旁白等于打不开'); continue; }
      if (body.length > DOC_BODY_MAX) { deny('文档正文过长(>' + DOC_BODY_MAX + '字)：' + title); continue; }
      u.title = title.slice(0, 60); u.body = body.slice(0, DOC_BODY_MAX);
      // v1.47：**认得出这份文书靠它自己**（kind/aliases 由 AI 声明），不靠引擎里的名词表。
      // 架空世界的"玉牒/飞剑传书/血书/符诏"由 AI 起名 —— 引擎只限制**长度与条数**，不限制**是什么**。
      u.kind = String(u.kind || '').trim().slice(0, 16);
      u.aliases = (Array.isArray(u.aliases) ? u.aliases : []).map(x => String(x || '').trim().slice(0, 12)).filter(Boolean).slice(0, 6);
    }
    if (u.type === '演出') {
      // v1.51：名字**只要这个世界用过**，就只写名字（框架记住了它的画法）——省 token，也保证前后一致
      if (!Array.isArray(u.atoms) && u.fx) { const known = FW.resolveFx(data, u.fx); if (known) u.atoms = known; }
      // v1.47：只给**引擎原语 + 参数**，名字由 AI 用世界里的话自己起（权限边界，不是内容清单）
      const chk = FX.check(data, u, fxSeen);
      if (!chk.ok) { deny(chk.err); continue; }
      u.atoms = chk.atoms; u.fxKey = chk.key; u.fx = chk.name; fxSeen++;
    }
    if (u.type === '情绪变化' || u.type === 'NPC状态更新' || u.type === '记忆激活') {
      const t = getEntity(data, tid);
      if (!t || t.type !== 'person') { deny('目标非人物: ' + tid); continue; }
    }
    /* ── NPC 的**位置**是确定性量（日程 tick 的结果），AI 不能随手把人挪走（v1.99 · P0-4 规则内容）──
       原来这一条**根本不存在**：`NPC状态更新{field:'location', to:'pl_4'}` 直接写进 state.location，
       而 tickNPCs 下一次就按日程把人拽回去 —— 于是世界出现"人在别处又突然回来"的抖动，
       而且没有任何东西说这是错的（评审 P0-6 §2.4 点名的落点）。
       三条判据：
         ① 等于日程算出的位置 → 放行（他本来就该在那儿）
         ② 日程之外的位置：**必须有因果**且**必须有通路** → 放行，并写成 state.override（有时限，过后自动回日程）
         ③ 其余 → 拒 */
    if ((u.type === 'NPC状态更新' || u.type === '情绪变化') && String(u.field || '') === 'location' && u.to !== undefined) {
      const t = getEntity(data, tid);
      if (t && t.type === 'person' && t.id !== 'player') {
        const want = String(u.to || '');
        if (!data.entities[want]) { deny('NPC 位置变化的目标不存在: ' + want); continue; }
        const at = String(u.t || (data.current && data.current.time) || '');
        const sched = schedulePlace(data, t, at);
        if (want !== sched) {
          if (!u.cause) { deny('NPC 位置变化必须带因果（日程之外的位置要有理由）'); continue; }
          const c = sched ? moveCost(data, sched, want, at) : { ok: false };
          if (!c.ok) { deny('NPC 位置变化没有通路: ' + String(sched || '（无日程落点）') + ' → ' + want); continue; }
          u._npcOverride = { place: want, minutes: Number(u.minutes) || 60 };
        }
      }
    }
    // 画面↔Update 映射（简化：声明了可见性的必须在叙事行存在 speaker/target 引用）
    const NARRATIVE_TYPES = ['记忆新增','关系变化','情绪变化','NPC状态更新','人物出现','人物离开'];
    if (u.visible === 'scene' && frame && NARRATIVE_TYPES.includes(u.type)) {
      /* v1.83：① 记忆新增/印象更新 没有 target（归属在 owner 里）→ 原来 tid 是 undefined，
         而 b.speaker === undefined 与"没有 speaker 的旁白 beat"**恒等** ⇒ 检查永远通过（第二层空转）。
         ② 现在：先取正确的引用 id（target → owner），**没有 id 就不判**（不能凭空放行也不能凭空拒绝）。 */
      /* 引用 id 只认 target：记忆新增/印象更新的归属在 owner 里（"谁知道这件事"），
         而"画面闭合"要的是**这个人在画面里出现了** —— 没有 target 就无从按 id 比对，
         此时**不判**（既不凭空放行、也不凭空拒绝，避免误杀 demo/正常记忆写入）。 */
      const ref = tid || '';
      const hasRef = !!(ref) && (frame.beats || []).some(b => b.speaker === ref || b.actor === ref || (b.text || '').indexOf(u.type) >= 0);
      if (!ref) { allowed.push(u); continue; }
      // v1.83 修 P1-3：全函数只有这一条 **push 完没有 continue**（其余每条都有）
      // —— 于是"画面与 Update 引用不闭合"记了错却照样放行，不变量 §4 明写要拒绝的规则等于没执行。
      if (!hasRef) { deny('画面↔Update 不匹配: ' + u.type + ' / ' + ref); continue; }
    }
    allowed.push(u);
  }
  return { allowed, errors, rejected };
}

/* ---------- 记忆深度：**全项目唯一的 weight 计算点**（v2.04 · P1-2） ----------
   病（评审回执 P1-2，两份外部评审都点到）：有两套互不相干的公式 ——
     · `decayMemories` 精心算 `weight = impact × e^(-λΔt) + 随机抖动`
     · 而**真正的检索**（`memScore`）用的是原始 impact + 30 天硬窗 + 词面 Jaccard，**从来不读 weight**
   于是"活人会忘"在玩家侧不成立：三年前的高冲击记忆和三天前的寒暄，在检索里只差 impact 那 25% 的分量。
   另外 `weight` 只是 impact 的单调函数（`repeat` 加成也不参与下一轮重算）⇒ 接进去也只兑现"会忘"，兑现不了"会被勾起"。

   现在：**一个函数**，五处消费者（decayMemories / memScore / scheduler 的角色自述 / query 的按需调取 /
   游戏里的记忆激活兜底）都问它。语义是**存储层**的："这条记忆在这个人心里现在有多深"，
   与"这一刻在聊什么"无关（后者是检索层的事，见 memScore 的 relevance 项）。

   两条决定（写在这里，免得后人以为是漏的）：
     ① **保留 15% 地板**：与「记忆永远保留、遗忘只是权重衰减」一致 —— 不至于"某天突然想不起来"。
     ② **读 activations（被反复想起会更牢）**：boost = 1 + 0.15·log2(activations)，封顶 1.5×
        （activations=1 → 1.0 基线；=2 → 1.15；=9 → 1.475）。
        这是一次**行为改变**（原来加成只在写入那一刻生效、下一回合就被抹掉），
        `mem-behavior-check` 里那条"预告会红"的断言正是为这一刻写的。
     ③ **去掉随机抖动**：原来每回合 ±2 的重掷，只影响 Top-3 的边界（没人发现）；
        可一旦接进主 AI 的资料包，它就会变成"AI 每回合想起的事在跳"。 */
function memDepth(data, m, nowIso) {
  const owner = getEntity(data, m && m.owner);
  const lam = (owner && owner.trait && owner.trait.lambda) || 0.06;
  const now = new Date(nowIso || (data.current && data.current.time) || 0).getTime();
  const dt = new Date((m && m.t) || 0).getTime();
  const months = (isFinite(now) && isFinite(dt)) ? Math.max(0, (now - dt) / 86400000 / 30.44) : 0;
  const impact = Number((m && m.impact) || 0);
  const base = impact * Math.exp(-lam * months);
  /* \`log2(activations)\` 而不是 \`log2(1+activations)\`：`activations=1`（刚写下、还没被想起过）必须等于
     基线 1.0，否则"新记忆"一出生就带 15% 加成，等于把地板整体抬高一档。 */
  const boost = Math.min(1.5, 1 + 0.15 * Math.log2(Math.max(1, Number((m && m.activations) || 1))));
  return Math.max(impact * 0.15, Math.min(100, base * boost));
}
// 每回合把最新的深度写回存档（读取侧仍以 memDepth 为准，weight 只是留痕/给旧工具看）
function decayMemories(data, iso) {
  for (const m of Object.values(data.memories)) m.weight = Math.max(1, Math.round(memDepth(data, m, iso)));
}

/* ══ v1.96：**记忆的写入门** ══════════════════════════════════════════════
   文献依据（研究/07）：Sonder Engine 的对话记忆被**硬门控** ——
   只有含承诺标记或身份自白标记的台词才落盘，其余只活在 episode 里；
   线上语料 **145 条对话记忆 vs 2601 条 episode**（约 5.6% 过关）。作者明说这是设计不是缺陷。
   它还给过一次事故记录：闸门加上之前，356 行（占全库 7.3%、某一故事的三分之一）只是一句占位串
   「You register nothing new」，却照样能被塞给角色。

   **原则：把「发生了什么」和「值得记住什么」分开。**
   本项目已经有这条双轨了（records.js 的认知轨 = 什么都记；memories = 要被想起的），
   缺的是**中间那道门** —— 原来 AI 写多少条就进多少条，于是：
     · 值得记的被淹没（检索 Top4 里一半是寒暄）
     · 存档无限增长（mem-behavior-check 实测：塞 300 条后共 304 条，无清理）

   过关条件（任一）：
     ① impact ≥ GATE_IMPACT(55)  —— AI 认为这条有分量
     ② content 命中**转折/承诺/自白/生死**的标记词（这类事不必高分也得记住）
   没过关的**不丢** —— 它仍在 experience（认知轨）里，只是不会被人「想起来」。
   引擎自己写的（角色内心 / 镜头外）走另一条路：**按标签限量**，不做内容门。 */
const GATE_IMPACT = 55;
const MEM_MARKERS = /答应|约定|承诺|发誓|保证|欠|借了|还了|分手|绝交|表白|喜欢|爱上|恨|原谅|道歉|对不起|死了|去世|病了|重伤|走了|离开|搬走|辞了|结婚|离婚|怀孕|生了|秘密|其实|原来|真相|第一次|最后一次|再也|从此|瞒|骗|背叛|救|恩情|救命/;

function memGatePass(mem) {
  if (!mem) return false;
  if ((Number(mem.impact) || 0) >= GATE_IMPACT) return true;
  return MEM_MARKERS.test(String(mem.content || ''));
}

// 写记忆（去重：同归属+同标签≥2+3天内 → 合并为反复出现）
// opts.by：'ai'（默认，过内容门）｜'engine'（引擎自写，按标签限量，不过内容门）
function writeMemory(data, mem, opts) {
  const by = (opts && opts.by) || 'ai';
  data.current = data.current || {};
  const g = data.current.memGate = data.current.memGate || { pass: 0, skip: 0, capped: 0 };
  if (by === 'ai' && !memGatePass(mem)) {
    g.skip += 1;   // 没过门：不进记忆库（仍在 experience 认知轨里，可查、不丢）
    return { id: null, gated: true };
  }
  const dup = Object.values(data.memories).find(m =>
    m.owner === mem.owner && !m.absolved &&
    [...(mem.tags || [])].filter(t => (m.tags || []).includes(t)).length >= 2 &&   // v2.06：补兜底（另一侧 m.tags 有 || []，这侧没有；tags 缺失时会直接抛）
    Math.abs(new Date(m.t) - new Date(mem.t)) < 3 * 86400000
  );
  if (dup) {
    dup.repeat = true;
    dup.impact = Math.max(dup.impact, mem.impact);
    dup.lastActivation = mem.t;
    g.pass += 1;
    return { id: dup.id, deduped: true };
  }
  /* 引擎自写的「此刻」类记忆：**按标签限量**，不按内容门。
     为什么必须限量：v1.94 起角色模拟器每回合最多被问 2 次、每次都写一条——
     而那条 tags 只有一个（['此刻']），去重条件（重叠 ≥2）**永远不触发** ⇒ 线性膨胀。
     角色要有内心生活，但「内心生活」不等于「每回合一条永久记忆」。 */
  const CAP_TAGS = { '此刻': 6, '镜头外': 8 };
  const capTag = (mem.tags || []).find(t => CAP_TAGS[t] != null);
  if (capTag) {
    const same = Object.values(data.memories).filter(m => m.owner === mem.owner && (m.tags || []).indexOf(capTag) >= 0)
      .sort((a, b) => String(a.t || '').localeCompare(String(b.t || '')));
    while (same.length >= CAP_TAGS[capTag]) { const old = same.shift(); delete data.memories[old.id]; g.capped += 1; }
  }
  const id = data.id('mem');
  const m = Object.assign({ id, owner: mem.owner, content: mem.content, tags: mem.tags || [], impact: mem.impact, t: mem.t, lastActivation: mem.t, activations: 1, repeat: false }, mem.extra || {});
  m.weight = Math.max(1, Math.round(memDepth(data, m, mem.t)));   // v2.04：初值也走同一处（不再手写 impact）
  data.memories[id] = m;
  g.pass += 1;
  // 关联激活：重叠标签≥2 的旧记忆获得加成
  for (const old of Object.values(data.memories)) {
    if (old.id === id || old.owner !== mem.owner) continue;
    const ov = (old.tags || []).filter(t => (mem.tags || []).includes(t)).length;
    /* v2.04 P1-2：**不再改 weight** —— 加成由 memDepth 的 activations 项表达（改了也会被下一回合重算抹掉，
       那是"两个真相"）。这里只推进"被想起过"这件事本身。 */
    if (ov >= 2) { old.lastActivation = mem.t; old.activations = (old.activations || 1) + 1; }
  }
  return { id };
}

/* ── v1.95：记忆检索补上第三项 relevance（三因子打分）──────────────────────────
   为什么改：原来只有两项 —— 标签重叠×20 + 权重 + 时效。
   Generative Agents 的三因子是 recency / importance / **relevance**（查询与本条记忆的相似度），
   而这一项**原来根本不存在**：查询语句从未参与打分。
   后果实测（scripts/mem-recall.js，12 条标注查询）：**recall@4 = 55%**，
   而量表自己早就写着「低于目标线 75%（打分尚未引入查询语句，见交接文档 §6.32）」。

   relevance 用**字符 2-gram 的 Jaccard 相似度**近似（纯词面、0 token、零依赖）。
   它不是 embedding 的等价物 —— 真正的语义版需要一个 embedding 端点，本项目当前没有。
   但它是**严格更好**的：原来「查询里出现的那句话」对排序毫无影响。 */
function memBigrams(s) {
  const t = String(s || '').replace(/[\s，。、？！：；"'\(\)（）]/g, '');
  const g = [];
  for (let i = 0; i < t.length - 1; i++) g.push(t.slice(i, i + 2));
  return g;
}
function memJaccard(a, b) {
  const A = new Set(memBigrams(a)), B = new Set(memBigrams(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
/* 三因子打分：relevance 0.55 / importance 0.25 / recency 0.20（各自先归一化到 [0,1]）。
   **导出**给 scripts/mem-recall.js 用 —— 量表以前是「原样抄一份」，
   抄的那份永远不会跟着实现变（量表和实现分叉 = 尺子失效）。 */
function memScore(data, m, sceneTags, query) {
  const ov = (m.tags || []).filter(t => (sceneTags || []).includes(t)).length;
  const rel = Math.min(1, memJaccard(query || '', m.content) * 3 + ov * 0.25);
  const imp = Math.min(1, memDepth(data, m) / 100);   // v2.04 P1-2：读**深度**，不读原始 impact
  const days = (new Date(data.current.time) - new Date(m.t)) / 86400000;
  const rec = Math.min(1, Math.max(0, 30 - days) / 30);
  /* 0.55/0.35/0.10：recency 与 memDepth 都在计时间，必须给 recency 降权（否则同一条时间信息算两遍） */
  return rel * 0.55 + imp * 0.35 + rec * 0.10;
}
// 漏斗：硬过滤（按归属）→ 三因子软加权 → Top N。query 缺省为空串（退化成「重要 + 近」）。
function funnelMemories(data, ownerId, sceneTags, n, query) {
  const all = Object.values(data.memories).filter(m => m.owner === ownerId);
  const scored = all.map(m => ({ m: m, score: memScore(data, m, sceneTags, query) }))
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, n || 5).map(s => s.m);
}

// 环境事件候选（按时代取素材，不写死现代；副 AI-计算的"代码版"）
const ACCIDENT_POOL = ['街口传来说话声：一辆拉货的三轮车在巷口翻了，人没事，菜撒了一地。', '有人在桥头捡到一只没人认领的包，里面有几张票据。', '镇东的井台塌了一角，还好没人掉下去。'];
function accidentCandidate(data) {
  // 意外候选（轻量；L1 不伤及已知人物；重伤/死亡级意外走世界计划/副AI-计算 live）
  if (Math.random() > 0.10) return [];
  const txt = ACCIDENT_POOL[Math.floor(Math.random() * ACCIDENT_POOL.length)];
  /* v2.03：候选落库走总线（裁决点唯一） */
  const rc = BUS.commit(data, [{ kind: 'candidate', source: 'candidate', level: 'L1', item: { text: txt, type: '遭遇', t: data.current.time, expireM: 60 * 6 } }], { t: data.current.time });
  if (!rc.committed.length) return [];
  return [{ id: data.id('cand'), text: txt, type: '遭遇', expireAt: addMinutes(data.current.time, 60 * 6), sev: '低' }];
}
function envCandidates(data) {
  const era = String((data.meta && data.meta.era) || '');
  const t = data.current.time;
  const h = hourOf(t);
  let pool;
  // 判定用**词**不要用**单字** —— 原来 /修/ 会把「装修」当修仙、/末/ 会把「周末」当末世、
  // /古/ 会把「古老」当古代，于是现代都市世界会吐出「檐角风铃响了一声」这种串台的环境候选（实测）。
  if (/修仙|仙侠|修真|仙门|宗门|灵气|志怪|妖怪|精怪|武侠|江湖|山野/.test(era)) pool = ['檐角风铃响了一声，又安静了', '远处的山雾又压低了一线', '不知名的鸟在夜里叫了两声'];
  else if (/九十年代|九零年代|大哥大|BP机|BB机|寻呼|传呼|座机|程控/.test(era)) pool = ['街对面小卖部的电视机在播本地新闻', '楼下有人喊话，又没下文了', '巷口报摊收摊，卷帘门拉下一半，老板开了摩托'];
  else if (/末世|末日|废土|辐射|幸存者|丧尸|灾变|核冬/.test(era)) pool = ['风卷着灰从路面掠过去', '远处响起引擎声，很快又熄了', '收音机嗞啦响了一阵，又静了'];
  else if (/古代|古风|旧时|民国|不知年月|前朝|王朝|客栈|镖局|衙门/.test(era)) pool = ['更夫敲过一更，脚步声远了', '柜上的油灯一跳，灯芯烧短了', '街上的狗叫了两声，又静了'];
  else pool = ['雨势渐大，雨棚开始滴水', '一位骑电动车的外卖员在门口停下车避雨', '街灯亮了，有人在对面的屋檐下避雨'];
  const out = [];
  if ((h >= 19 && h <= 23) || /雨|雾/.test(String(data.current.weather || ''))) {
    const one = pool[Math.floor(Math.random() * pool.length)];
    const rc2 = BUS.commit(data, [{ kind: 'candidate', source: 'candidate', level: 'L1', item: { text: one, type: '环境', t: t, expireM: 40 } }], { t: t });
    if (rc2.committed.length) out.push({ id: data.id('cand'), text: one, type: '环境', expireAt: addMinutes(t, 40), sev: '低' });
  }
  out.push(...accidentCandidate(data));
  return out.slice(0, 3);
}

/* ---------- 候选的寿命与上限（v1.97 · X8） ----------
   候选是**一次性素材**：它由"生成它的那一刻"决定（雨夜檐下避雨的人、刚收摊的报摊）。
   过了 expireAt，它就不再属于这个世界 —— 凌晨三点响起"街对面小卖部的电视机在播本地新闻"
   是穿帮，不是惊喜。可 expireAt 自写下的第一天起就没人读过（5 处写 / 0 处读）：
   池子只进不出，一个三天前的候选会在三天后照样被当成"此刻"喂给主 AI。
   这里把它读回来，而且**只在这一处读**：谁想知道池子里还剩什么，都走 candidatesLive()。
   两条规则：① 过期即作废；② 池子上限 CAND_CAP 条，超出时按生成先后淘汰最早的
   （最早生成的也最早过期 —— 所以"淘汰最早"与"淘汰最先过期"是同一件事）。
   老存档（没有 expireAt 的候选）判不出过期，就地补一个默认寿命，之后照常走同一条规则；
   这不是"兼容分支"，是让旧数据走进同一条规则。 */
const CAND_CAP = 24;
const CAND_LIFE_MIN = 90;
const ISO_MIN_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
function candidatesLive(data, nowIso) {
  const cur = (data && data.current) || {};
  const now = nowIso || cur.time || '';
  const kept = [];
  for (const c of (cur.pendingCandidates || [])) {
    if (!c || !c.text) continue;                                  // 空壳：本来就喂不出去，不占位
    if (!ISO_MIN_RE.test(String(c.expireAt || ''))) c.expireAt = addMinutes(now, CAND_LIFE_MIN);
    if (now && String(c.expireAt) <= now) continue;                // 同为 ISO 串 ⇒ 字典序即时间序
    kept.push(c);
  }
  if (kept.length > CAND_CAP) kept.splice(0, kept.length - CAND_CAP);
  cur.pendingCandidates = kept;
  return kept;
}

// 副 AI-计算（结构化输出源）：待定候选 + 环境候选
function genCandidates(data) {
  const c = candidatesLive(data).slice();      // 先按寿命取（取完池子已清空）
  data.current.pendingCandidates = [];
  c.push(...envCandidates(data));
  /* v1.83：原来直接 slice(0,3) 丢掉其余 —— 而 pendingCandidates 已经被清空，
     那些候选**永久消失**（既没进本回合资料包，也没留到下回合）。现在把超出的放回去。
     v1.97：放回去的必然 ≤ CAND_CAP（池子本就 ≤ CAND_CAP，本回合只可能多出 3 条），不用再过一遍。 */
  const keep = c.slice(0, 3), rest = c.slice(3);
  if (rest.length) data.current.pendingCandidates = rest;
  return keep;
}

module.exports = { addMinutes, fmtISO, diffMin, hourOf, dayKey, dayPart, perceiveTime, perceiveWeather, canHearWeather, schedulePlace, tickNPCs, moveCost, validateUpdates, kindOf, memDepth, decayMemories, writeMemory, funnelMemories, memScore, memGatePass, GATE_IMPACT, MEM_MARKERS, genCandidates, envCandidates, candidatesLive, CAND_CAP, replyPlan, dueReplies, birthYearOf, ageOf, ageStage, isAlive, LEVEL_BASE, UPDATE_TYPES };