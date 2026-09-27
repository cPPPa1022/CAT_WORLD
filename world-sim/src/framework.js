// framework.js — 世界的框架：**住在存档内部**（v1.51）；v2.08 起**取消 0/1/2/3 档位**
// ─────────────────────────────────────────────────────────────
// 用户 2026-09-14：「框架无论怎么调整都只是在存档内部——这个框架才是这个模拟器真正活起来的点！世界是会进步发展的！」
// 用户 2026-09-23 拍板删档位：「这 0123 是 AI 的生成框架的权限。默认最高档，不需要调整，也不需要给玩家看到。」
// 为什么删（三条实测）：
//   ① 4 档只有档 1 在工作 —— types/rules 在真实游玩里从未产出过一条；
//   ② opening.js 开局临时设 3、完了还原，而 setLevel 一律记 by:'player'
//      ——**引擎改了权限却签玩家的名**，权限日志在说谎；
//   ③ 防滥用已由各表上限覆盖（rules≤20 / types≤30 / WORD_MAX=60），
//      "这次不要它长"另有 freeze() —— 档位是多余的第二道锁。
// 能力现在**永远全开**：世界可以长词、长型、长律。
// ★ 边界没松（这两条是 mod 系统的宪法，与档位无关、**不许跟着删**）：
//   **原语仍是引擎的能力**（世界只能给名字，不能给画法）；
//   **律只是事实，不是算盘**（只允许 枚举/布尔/区间，不许公式、不许算术）。
//   （用户原话见 opening.js:9：「框架档位的所有权限仅能修改存档里的任何事物，但禁止动模拟器里的根代码」）
'use strict';
const RET = require('./retention');   // v1.86

const V = 1;
const LOG_MAX = 400;
const WORD_MAX = 60;      // 每类词的上限（旧的挤出去，但 log 里留着）
const RULE_FORMS = ['enum', 'bool', 'range'];
const RULE_ITEMS_MAX = 12;   // 枚举项上限

function blank() {
  return {
    v: V,
    vocab: { docKinds: [], fxNames: {}, orgs: [], roles: [] },
    types: [], rules: [], log: [], createdAt: '',
    /* v3.5 · 世界模板创造（用户 2026-09-26 谈定）—— 三样都**住在存档里**，
       坏也只坏这一个存档（「最多让它搞坏存档」）。 */
    panels: [],       // 这局独有的板块（AI 造的页签/功能；必须带「内容从哪来」）
    proposals: [],    // 框架提议留痕 —— **含未采纳的**（「不管是加了或者未加 都需要留痕」）
    seed: ''          // 确定性骰子种子（可重放；见 seededRoll）
  };
}
function ensure(data) {
  if (!data) return null;
  let f = data.framework;
  if (!f || typeof f !== 'object') {
    data.framework = blank();
    data.framework.createdAt = (data.current && data.current.time) || '';
    log(data, { what: '框架建立', name: (data.meta && data.meta.name) || '', by: 'engine' });
    return data.framework;
  }
  f.v = f.v || V;
  /* v2.08：老存档里可能还留着 framework.level —— **读到时忽略**（不迁移、不报错、不动它）。
     档位已不存在，能力永远全开；那个字段就让它跟着老存档自然留着。 */
  f.vocab = f.vocab || { docKinds: [], fxNames: {}, orgs: [], roles: [] };
  if (!Array.isArray(f.vocab.docKinds)) f.vocab.docKinds = [];
  if (!f.vocab.fxNames || typeof f.vocab.fxNames !== 'object') f.vocab.fxNames = {};
  if (!Array.isArray(f.vocab.orgs)) f.vocab.orgs = [];
  if (!Array.isArray(f.vocab.roles)) f.vocab.roles = [];
  if (!Array.isArray(f.types)) f.types = [];
  if (!Array.isArray(f.rules)) f.rules = [];
  if (!Array.isArray(f.log)) f.log = [];
  /* v3.5：老存档没有这三样 —— **缺就补空的，不迁移、不报错、不动它**
     （照 framework.level 那条老规矩，见上面 v2.08 那段）。 */
  if (!Array.isArray(f.panels)) f.panels = [];
  if (!Array.isArray(f.proposals)) f.proposals = [];
  if (!f.seed) f.seed = seedOf(data, f);
  return f;
}
/* v2.08 删：level() / setLevel() 整个移除。
   它们存在的唯一作用是让"世界能长到哪一层"成为一个可调开关，
   而那个开关实测在说谎 —— opening.js 调用它做 1→3→1，日志却记 by:'player'。 */
function log(data, entry) {
  const f = data && data.framework ? data.framework : null;
  if (!f) return null;
  const e = Object.assign({ t: (data.current && data.current.time) || '' }, entry || {});
  f.log.push(e);
  f.log = RET.cap('frameworkLog', f.log, LOG_MAX, data);   // v1.86：演化日志溢出落盘
  return e;
}
function has(a, s) { return a.indexOf(s) >= 0; }
function trim(s, n) { return String(s == null ? '' : s).trim().slice(0, n || 16); }
function push(arr, s, max) { if (s && !has(arr, s)) { arr.push(s); if (arr.length > (max || WORD_MAX)) arr.shift(); return true; } return false; }

// ---------- 档 1：词 ----------
function learnDocKind(data, kind) {
  const f = ensure(data); if (!f) return null;
  const k = trim(kind, 16);
  if (k && k !== 'doc' && push(f.vocab.docKinds, k)) log(data, { what: '+文书类型', name: k, by: 'ai' });
  return k;
}
function learnFxName(data, name, atoms) {
  const f = ensure(data); if (!f) return null;
  const k = trim(name, 16);
  if (!k || !Array.isArray(atoms) || !atoms.length) return null;
  const sig = atoms.map(a => a.k + (a.v != null ? ':' + a.v : '')).join('+');
  const cur = f.vocab.fxNames[k];
  if (!cur) { f.vocab.fxNames[k] = { atoms: atoms, sig: sig, n: 1, t: (data.current && data.current.time) || '' }; log(data, { what: '+演出名', name: k, sig: sig, by: 'ai' }); }
  else {
    cur.n = (cur.n || 1) + 1;
    cur.t = (data.current && data.current.time) || cur.t;
    if (cur.sig !== sig) { cur.atoms = atoms; cur.sig = sig; log(data, { what: '~演出名改配', name: k, sig: sig, by: 'ai' }); }
  }
  return f.vocab.fxNames[k];
}
function resolveFx(data, name) {
  const f = ensure(data); if (!f) return null;
  const rec = f.vocab.fxNames[trim(name, 16)];
  return rec && Array.isArray(rec.atoms) ? rec.atoms : null;
}
function learnWord(data, slot, word) {
  const f = ensure(data); if (!f) return null;
  const arr = f.vocab[slot]; if (!Array.isArray(arr)) return null;
  const w = trim(word, 16);
  if (w && push(arr, w)) log(data, { what: '+' + slot, name: w, by: 'ai' });
  return w;
}
// ---------- 档 2：型（结构模板：只有栏位，没有值、没有公式） ----------
function learnType(data, name, fields) {
  const f = ensure(data); if (!f) return null;
  const n = trim(name, 20);
  const fs = (Array.isArray(fields) ? fields : []).map(x => trim(x, 12)).filter(Boolean).slice(0, 12);
  if (!n || !fs.length) return null;
  const cur = f.types.find(x => x.name === n);
  if (cur) { cur.fields = fs; cur.n = (cur.n || 1) + 1; log(data, { what: '~型改栏位', name: n, sig: fs.join('/'), by: 'ai' }); }
  else { f.types.push({ name: n, fields: fs, n: 1, t: (data.current && data.current.time) || '' }); if (f.types.length > 30) f.types.shift(); log(data, { what: '+型', name: n, sig: fs.join('/'), by: 'ai' }); }
  return f.types.find(x => x.name === n);
}
// ---------- 档 3：律（**只有事实，没有算盘**） ----------
// 只允许 enum / bool / range；不许公式、不许算术。返回 {ok, err, rule}
function learnRule(data, spec) {
  const f = ensure(data); if (!f) return { ok: false, err: '没有框架' };
  const name = trim((spec || {}).name, 20);
  const form = String((spec || {}).form || '').trim();
  if (!name) return { ok: false, err: '律必须有 name（这条规则叫什么）' };
  if (!has(RULE_FORMS, form)) return { ok: false, err: '律只允许三种形式：enum / bool / range（收到 ' + (form || '空') + '）——不许公式、不许算术' };
  let items = [];
  if (form === 'enum') {
    items = (Array.isArray(spec.items) ? spec.items : []).map(x => trim(x, 10)).filter(Boolean).slice(0, RULE_ITEMS_MAX);
    if (!items.length) return { ok: false, err: 'enum 律必须给 items（枚举项），最多 ' + RULE_ITEMS_MAX + ' 个' };
  } else if (form === 'range') {
    const lo = Number(spec.min), hi = Number(spec.max);
    if (!isFinite(lo) || !isFinite(hi) || hi <= lo) return { ok: false, err: 'range 律必须给 min < max 的两个数' };
    items = [String(lo), String(hi)];
  } else { items = ['真', '假']; }
  const scope = trim(spec.scope, 20) || '本世界';
  const why = trim(spec.why, 60);
  const cur = f.rules.find(x => x.name === name);
  if (cur) { cur.form = form; cur.items = items; cur.scope = scope; cur.why = why; cur.n = (cur.n || 1) + 1; log(data, { what: '~律改定义', name: name, sig: form + ':' + items.join(','), by: 'ai' }); return { ok: true, rule: cur }; }
  const rule = { name: name, form: form, items: items, scope: scope, why: why, n: 1, t: (data.current && data.current.time) || '', frozen: false };
  f.rules.push(rule);
  if (f.rules.length > 20) f.rules.shift();
  log(data, { what: '+律', name: name, sig: form + ':' + items.join(','), by: 'ai' });
  return { ok: true, rule: rule };
}
// 玩家随时能冻结/降档：已有律**不删**（留痕），只是不再生效
function freeze(data, on) {
  const f = ensure(data); if (!f) return null;
  for (const r of f.rules) r.frozen = !!on;
  log(data, { what: on ? '冻结律' : '解冻律', name: '全部 ' + f.rules.length + ' 条', by: 'player' });
  return f.rules.length;
}
// 校验器用（**纯函数，无副作用**）：这个提案合不合法（按 mod 边界，不按档位）
function canPropose(data, u) {
  const f = ensure(data); if (!f) return { ok: false, err: '没有框架' };
  const slot = String((u && (u.slot || u.what)) || '').trim();
  if (slot === 'rule' || slot === 'rules') {
    const form = String((u && u.form) || '').trim();
    if (!has(RULE_FORMS, form)) return { ok: false, err: '律只允许 enum / bool / range（收到 ' + (form || '空') + '）——不许公式、不许算术' };
    if (!trim((u || {}).name, 20)) return { ok: false, err: '律必须有 name' };
    if (form === 'enum' && !(Array.isArray(u.items) && u.items.length)) return { ok: false, err: 'enum 律必须给 items' };
    if (form === 'range' && !(isFinite(Number(u.min)) && isFinite(Number(u.max)) && Number(u.max) > Number(u.min))) return { ok: false, err: 'range 律必须给 min < max' };
    return { ok: true, slot: 'rules' };
  }
  if (slot === 'type' || slot === 'types') {
    if (!trim((u || {}).name, 20)) return { ok: false, err: '型必须有 name' };
    if (!(Array.isArray(u.fields) && u.fields.filter(Boolean).length)) return { ok: false, err: '型必须有 fields（栏位清单）' };
    return { ok: true, slot: 'types' };
  }
  if (slot === 'org' || slot === 'role' || slot === 'orgs' || slot === 'roles') {
    if (!trim((u || {}).name, 16)) return { ok: false, err: '要一个词' };
    return { ok: true, slot: slot.indexOf('org') === 0 ? 'orgs' : 'roles' };
  }
  return { ok: false, err: '框架提案的 slot 只允许 org/role/type/rule（收到 ' + (slot || '空') + '）' };
}
// 提交端（有副作用）：把提案真正落进框架
function applyProposal(data, u) {
  const c = canPropose(data, u);
  if (!c.ok) return c;
  return checkProposal(data, u);
}
// 校验器用：给 AI 的框架提案做闸门（AI 只能提议，引擎提交）
function checkProposal(data, u) {
  const f = ensure(data); if (!f) return { ok: false, err: '没有框架' };
  const slot = String((u && (u.slot || u.what)) || '').trim();
  if (slot === 'rule' || slot === 'rules') {
    const r = learnRule(data, { name: u.name, form: u.form, items: u.items, min: u.min, max: u.max, scope: u.scope, why: u.why });
    return r.ok ? { ok: true, slot: 'rules', name: r.rule.name } : r;
  }
  if (slot === 'type' || slot === 'types') {
    const t = learnType(data, u.name, u.fields);
    return t ? { ok: true, slot: 'types', name: t.name } : { ok: false, err: '型必须有 name 和 fields（栏位）' };
  }
  if (slot === 'org' || slot === 'role' || slot === 'orgs' || slot === 'roles') {
    const k = slot.indexOf('org') === 0 ? 'orgs' : 'roles';
    const w = learnWord(data, k, u.name);
    return w ? { ok: true, slot: k, name: w } : { ok: false, err: '要一个词' };
  }
  return { ok: false, err: '框架提案的 slot 只允许 org/role/type/rule（收到 ' + (slot || '空') + '）' };
}
/* ══════════════════════════════════════════════════════════════════════════
   v3.5 · 世界模板创造 —— 用户 2026-09-26 谈定的形状
   ──────────────────────────────────────────────────────────────────────────
   这一节的所有规矩都来自用户原话，逐条对应：

     「A 是创造 从 0.5 到 1…0.5 就是基础中的基础，不值得 ai 重复去写的内容」
        → 0.5 壳在 presentation.js 的 SHELL；这里是「1」要做的事
     「写入是代码负责的」
        → CREATOR_API.write **只有一条路**：发 Update。19 种 Update 的校验/门控/记账全部继续生效
     「不管是加了或者未加 都需要留痕」
        → logProposal：**采纳和未采纳都记**（「没加的不管」= 未采纳的到此为止，不自动重试）
     「朋友圈如何生成？」
        → checkPanel：板块声明**必须**写「内容从哪来」。没来源的板块 = 死板块 = 又一个摆设
     「不认识 刚认识没多久 那掷骰子呗 这种都是概率问题（视好感咯）」
        → seededRoll：骰子**必须确定性可重放**（否则 replay / 三投影 / 快照会破）
     「它与其它代码模块是否兼容」
        → forbidDirectWrite：CREATOR_API 之外的一切都是后门
   ══════════════════════════════════════════════════════════════════════════ */

/* ---------- 内容来源五类（板块声明的必填项） ----------
   成本差三个数量级，所以**必须显式选**，不许"没来源"：
     view     已有数据的视图（0）        —— 通讯录就是 contacts 换个看法
     inline   主 AI 顺手产出（0 额外）    —— 它每回合本来就在跑，多输出 1~2 条
     event    事件驱动·复用已有（0）      —— 上游"镇上要修路" → 自动一条动态
     periodic 专用生成器·定期（**持续烧**）—— 朋友圈每天要凑够 N 条 → 必须带频率上限
     onDemand 按需生成·一次性（**只烧一次**）—— 一封信寄来了，写它的内容 */
/* ★ v3.16（用户 2026-09-27 纠正）：原来这里的 periodic 写的是「专用生成器·定期（持续烧 token，必须带 everyMinutes）」——
   那是**按真实时间刷新**的思路，而这个世界里**时间是玩家推进的**（只在他行动时前进）。
   用户原话：「为什么是几分钟就要刷新？时间是 user 推进的 **每回合是否发新的朋友圈是有个判定的**」。
   所以：turn = **回合驱动**（每回合由主 AI 顺手判一次「这一格这一回合要不要更新」，0 额外调用；该发才发）；
   periodic 保留成**旧档别名**，语义等同 turn（名字不再撒谎）。 */
const CONTENT_SOURCES = ['view', 'inline', 'event', 'turn', 'onDemand'];
const CONTENT_SOURCE_ALIAS = { periodic: 'turn' };
const CONTENT_SOURCE_DOC = {
  view: '已有数据的视图（0 token，随时有）',
  inline: '主 AI 每回合顺手产 1~2 条（0 额外调用）',
  event: '事件驱动·复用已有事件（0 token）',
  turn: '回合驱动：每回合顺手判一次「这一回合要不要更新」（0 额外调用，该发才发）',
  onDemand: '按需生成·一次性（玩家点开时才生成，只烧一次）'
};
/* 板块声明必填三项：长什么样 / 内容从哪来 / 什么时候更新 */
const PANEL_REQUIRED = ['shape', 'source', 'when'];
/* ★ v3.17 · 内容寿命与淘汰（用户 2026-09-27 定）：
   · keep  = 这一格留多少（条数 / 天数，谁先到谁生效）——**不许无限流**；缺就补默认。
   · retire= 这一格什么时候该死、谁判、死了干嘛 —— **有头有尾**；缺就补默认。 */
/* ★ v3.19（用户 2026-09-27）：「为什么要全部塞进更多里面呢？做成一个**悬浮窗**…例如那个系统做成一个**科技风**的悬浮窗不行吗？
   这些东西**不是让你去写** 这也是我做这个生成框架的初心 —— **你写提示词 去指导那个 ai 如何写**」。
   所以：引擎只给**能力**（能挂在哪儿、能怎么排、能不能交互），**形式与风格全由 AI 按这个世界的剧本来定**。
   这四个都是「可选，缺就补默认」—— 缺了不许拒整块（它不是生死项，是表现形式）。 */
const MOUNTS = ['overlay', 'panel', 'tabs', 'bubble'];          // 浮层 / 整页 / 收进一个页签组 / 冒个气泡
const LAYOUTS = ['list', 'table', 'cards', 'timeline'];          // 同一份数据的四种排法
const PANEL_KINDS = ['read', 'messages'];                        // 只读 / 能发能回（消息类走引擎既有链路）
const OVERLAY_MAX = 3;                                           // 红线：同时挂着的浮层上限（不许把屏幕贴满）
function normShape(sh) {
  const o = (sh && typeof sh === 'object') ? sh : {};
  return {
    id: String(o.id || '').replace(/[^\w\-]/g, '').slice(0, 24),
    name: trim(o.name, 24) || '（没名字的一格）',
    icon: trim(o.icon, 20) || 'box',
    group: trim(o.group, 16) || '',
    list: Array.isArray(o.list) ? o.list.slice(0, 6).map(x => trim(x, 12)) : [],
    mount: MOUNTS.indexOf(String(o.mount || '')) >= 0 ? String(o.mount) : 'panel',
    layout: LAYOUTS.indexOf(String(o.layout || '')) >= 0 ? String(o.layout) : 'list',
    kind: PANEL_KINDS.indexOf(String(o.kind || '')) >= 0 ? String(o.kind) : 'read',
    style: trim(o.style, 60) || ''      // 风格词表由 AI 按世界写（铁皮白瓷 / 玻璃发光 / 手写体…），引擎不指定
  };
}
const KEEP_DEFAULT = { rows: 80, days: 90 };
const RETIRE_DEFAULT = { who: 'code', check: '超过 ' + KEEP_DEFAULT.days + ' 天没有新内容', then: '归档（不删）' };
const RETIRE_WHO = ['code', 'ai', 'code+ai'];
function normKeep(k) {
  const o = (k && typeof k === 'object') ? k : {};
  const rows = Number(o.rows) > 0 ? Math.min(500, Math.floor(Number(o.rows))) : KEEP_DEFAULT.rows;
  const days = Number(o.days) > 0 ? Math.min(3650, Math.floor(Number(o.days))) : KEEP_DEFAULT.days;
  return { rows: rows, days: days, noDrop: !!o.noDrop };   // noDrop：这一格不许淘汰（账本类）
}
function normRetire(r) {
  const o = (r && typeof r === 'object') ? r : {};
  const who = RETIRE_WHO.indexOf(String(o.who || '')) >= 0 ? String(o.who) : RETIRE_DEFAULT.who;
  return { who: who, when: trim(o.when, 60) || '', check: trim(o.check, 60) || RETIRE_DEFAULT.check, then: trim(o.then, 60) || RETIRE_DEFAULT.then };
}

/* 板块声明的校验器。**缺「内容从哪来」一律不建** ——
   用户的问题正是「这个板块需要更新内容，例如朋友圈，那这个朋友圈如何生成？」
   答案就是：**建之前先答出来**。答不出的板块建出来就是死的。 */
function checkPanel(p) {
  const o = p || {};
  const errs = [];
  if (!o.shape || typeof o.shape !== 'object') errs.push('缺「长什么样」（shape）');
  if (!o.when) errs.push('缺「什么时候更新」（when）');
  const s = o.source;
  if (!s || typeof s !== 'object' || !s.kind) {
    errs.push('★ 缺「内容从哪来」（source）—— 没有来源的板块会变成死板块，也就是又一个摆设');
  } else if (CONTENT_SOURCES.indexOf(CONTENT_SOURCE_ALIAS[s.kind] || s.kind) < 0) {
    errs.push('内容来源「' + s.kind + '」不在五类里（' + CONTENT_SOURCES.join('/') + '）');
  } else if (s.kind === 'view' && !trim(s.of, 40)) {
    errs.push('(a) 已有数据的视图必须说清看的是**哪份数据**（of）');
  } else if (s.kind === 'onDemand' && !trim(s.trigger, 60)) {
    errs.push('(e) 按需一次性必须说清**触发条件**（trigger）');
  }
  return errs.length ? { ok: false, errs: errs } : { ok: true, source: CONTENT_SOURCE_ALIAS[s.kind] || s.kind };
}

/* ---------- 创造者 API：AI 写代码时**唯一**能用的一组 ----------
   三条线（用户拍板「需要开的口子就按照你说的做」）：
     读：读存档 / 读投影 / 读门控 —— **没有绕过门控直接拿 entities 的入口**
     画：加页签 / 加按钮 / 显示 / 用原语 —— 只能在这上面做增量（0.5 壳之上）
     写：★ **只有发 Update 一条** —— 这一条让 19 种 Update 的校验、门控、记账全部继续生效 */
const CREATOR_API = {
  v: 1,
  read: {
    loadSave: { name: '读存档', desc: '读这个存档的字段 —— **已过门控**，你看到的是玩家此刻该看到的' },
    projection: { name: '读投影', desc: 'ledger（客观事件）/ memories（某人记得什么）/ impressions（玩家认知）' },
    gateView: { name: '读门控', desc: '问「谁能看到什么」：谁认识谁、这个名字现在能不能说出来' }
  },
  draw: {
    addPanel: { name: '加页签', desc: '声明一个新页签（必须带「内容从哪来」，见 checkPanel）' },
    addAction: { name: '加按钮', desc: '声明一个新交互点' },
    show: { name: '显示', desc: '往叙事流里放东西（走 0.5 壳的渲染，不重画）' },
    useAtom: { name: '用原语', desc: '组合演出原语（fx.js 的 ATOMS）—— **你给名字，引擎给画法**' }
  },
  write: {
    postUpdate: { name: '发 Update', desc: '★ 写入的**唯一**一条路 —— 校验/门控/记账全部继续生效' }
  }
};

/* 关卡：`CREATOR_API` 之外的一切都是后门。
   为什么必须有：一个能直接改 `entities[id].name` 的入口，
   就能同时绕过**名字门控**和**全部记账** —— 而那种错不会有任何东西响。 */
function forbidDirectWrite(what) {
  return {
    ok: false,
    err: '★ 不许直接改存档：' + (what || '未知操作')
      + '。写入只能走 CREATOR_API.write.postUpdate（= 发 Update）'
  };
}

/* 门控版读 —— **AI 读到的是"玩家该看到的"，不是存档原样**。
   ⚠️ lazy require：framework.js 在依赖链上很早（ai.js 就依赖它），
      顶层 require gate.js 会形成环；放到函数里就没有这个问题。 */
function gateView(data, id) {
  try {
    const G = require('./gate');
    const e = (data && data.entities && data.entities[id]) || null;
    if (!e) return null;
    return { id: id, name: (typeof G.nameOf === 'function') ? G.nameOf(data, id) : (e.name || '') };
  } catch (e2) {
    return null;
  }
}

/* 板块内容也要过门控 —— **朋友圈 / 通讯录是天然的泄漏口**。
   一个「通讯录」页签如果不过门控，就能把**还没认识的人的名字全列出来**，
   而且不会有任何东西报错。⇒ 所有 view 类板块读取时必须走这里。 */
function panelGate(data, items, pick) {
  const out = [];
  const arr = Array.isArray(items) ? items : [];
  for (let i = 0; i < arr.length; i++) {
    try {
      const v = pick ? pick(arr[i], i) : arr[i];
      if (v) out.push(v);
    } catch (e) { /* 单个条目的门控失败 → 丢掉它，不许连累整块 */ }
  }
  return out;
}

/* ---------- 提议留痕：**采纳和未采纳都记** ----------
   用户原话：「不管是加了或者未加 都需要留痕 为什么加？没加的不管。」
   ⇒ 两种都写进 `framework.proposals`；未采纳的**到此为止，不自动重试**
     （没有 retryProposal / resubmit 这类东西 —— 那会变成重复烧 token）。 */
const PROPOSAL_STATES = ['已采纳', '未采纳'];
function logProposal(data, p) {
  const f = ensure(data); if (!f) return null;
  const o = p || {};
  const rec = {
    t: (data.current && data.current.time) || '',
    what: trim(o.what, 40),
    why: trim(o.why, 80),
    scope: trim(o.scope, 16),
    state: (o.state === '未采纳') ? '未采纳' : '已采纳',
    note: trim(o.note, 60)
  };
  f.proposals.push(rec);
  if (f.proposals.length > 120) f.proposals.splice(0, f.proposals.length - 120);
  return rec;
}
function proposalView(data) {
  const f = ensure(data); if (!f) return null;
  return {
    n: f.proposals.length,
    kept: f.proposals.filter(x => x.state === '已采纳').length,
    dropped: f.proposals.filter(x => x.state === '未采纳').length,
    tail: f.proposals.slice(-8)
  };
}

/* ---------- 确定性骰子 ----------
   用户原话：「不认识 刚认识没多久 那掷骰子呗 这种都是概率问题（视好感咯）」
   ⇒ 但骰子**必须可重放**（replay / 三投影 / 快照都靠确定性）。
     用 FNV-1a 从「存档种子 + 这件事的名字」算，**不用 Math.random()**。 */
function hash32(s) {
  let h = 2166136261;
  const t = String(s == null ? '' : s);
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function seedOf(data, f) {
  const m = (data && data.meta) || {};
  return hash32('ws|' + ((f && f.createdAt) || '') + '|' + (m.name || '') + '|' + (m.era || '')).toString(36);
}
/* pct = 0~1 的概率（**有依据才给** —— 关系亲疏 + 开局文本里到底有没有写）。
   同一个存档 + 同一件事 ⇒ 永远同一个结果。 */
function seededRoll(data, key, pct) {
  const f = ensure(data); if (!f) return false;
  if (!f.seed) f.seed = seedOf(data, f);
  const v = (hash32(f.seed + '|' + String(key == null ? '' : key)) % 100000) / 100000;
  return v < (Number(pct) || 0);
}

/* ---------- 写入前语法预检 ----------
   用户原话：「无非就是代码写多了一个破折号和引号之类的」。
   ⇒ 那就在**写进存档之前**挡住：`new Function` 只编译不执行，纯本地、**0 token**。
     语法错的代码根本进不了存档 —— 连"存档炸"都省了。 */
function syntaxCheck(code) {
  const s = String(code == null ? '' : code);
  if (!s.trim()) return { ok: false, err: '空的' };
  try {
    /* eslint-disable-next-line no-new-func */
    new Function(s);
    return { ok: true };
  } catch (e) {
    return { ok: false, err: String((e && e.message) || e) };
  }
}

/* ---------- 给「创造框架」那一步的提示词块 ----------
   用户原话：「我们是做一个**指导** 一个**案例** 告诉它这么做，
             并且告诉它**模拟器支持啥**，需要**如何去写**对应的框架代码或功能」
             「不需要像真实的世界那样子 那样做不过来 我们可以做一些
               **简单的 好实现的 大家都知道的** 例如朋友圈」

   所以这一块必须有三样，缺一不可：
     ① 引擎支持什么（0.5 壳 + 创造者 API + 内容来源 + 演出原语）—— 它的**词汇表**
     ② 怎么填（板块声明必填三项）
     ③ **一个正样例**（填对了长什么样）—— 用户点名要的"一个案例"
   缺 ③ 的话，模型只能靠猜格式；缺 ① 的话，它会写引擎没有的东西（= 又一个摆设）。 */
function creatorPromptBlock(data) {
  /* ⚠️ lazy require：presentation → runtime → framework 是一条环，
     顶层 require presentation 会炸。放函数里就没有这个问题（同 gateView）。 */
  let shell = [], core = [], openParts = [];
  let atoms = [];
  try { const S = require('./presentation').SHELL || {}; shell = S.parts || []; core = S.core || shell; openParts = S.open || []; } catch (e) { shell = []; }
  try { atoms = Object.keys(require('./fx').ATOMS || {}); } catch (e) { atoms = []; }
  const f = ensure(data);
  const mine = (f && f.panels) || [];

  const out = [];
  out.push('【这一步你要做什么】把"这一局长什么样"造出来：有哪些工具、叫什么、有哪些页签、怎么排。');
  /* ★ v3.11（用户 2026-09-27）：「0.5 说的还是太死 限制它的发挥。只保留基础游玩的核心，其余的全部放开」——
     原来这里写的是「这 8 样都是基础中的基础，你只在上头做增量，不许重画」，等于把创造的边界画在了门口。
     现在只把**没有它就不能玩**的四样划成红线，其余全部交给它。 */
  out.push('【0.5 · 只有这四样】' + core.map(s => s.name + '（' + s.desc + '）').join(' · ')
    + ' —— **没有它就不能玩**，这四样别重画。');
  if (openParts.length) out.push('【其余全部放开】' + openParts.map(s => s.name + '（' + s.desc + '）').join(' · ')
    + ' —— 已经搭好了，但**你可以改、可以换一种做法、可以拿它们当素材**（列出来只为别重复造轮子，不是不许动）。');
  out.push('【这一局长什么样，全归你】布局 / 页签 / 名称 / 栏目 / 排序 / 交互点 / 器物界面 / 板块内容 ——'
    + ' 只要走下面这张 API 表，想怎么造就怎么造。**权限给到这个份上，就别再交一份「跟默认长得差不多」的东西。**');
  out.push('【判断不了就编 —— 这里是创造层，空着才是错】');
  out.push('  · 「编事实」是错的（谁是谁、谁认识谁、已经发生过什么 —— 那是读卡那两步的活儿，宁可留空）；');
  out.push('  · 「编世界」是你的本职：**没有依据的地方合理编一个**，并说清依据（卡里哪句 / 世界基调 / 时代常识）；');
  out.push('  · **禁止留空、禁止占位串**（待定 / 未知 / 暂无 / 待补全）：空着的界面不是谨慎，是没做。');
  out.push('【你能用的全部】'
    + '读：' + Object.keys(CREATOR_API.read).map(k => CREATOR_API.read[k].name).join('/')
    + '；画：' + Object.keys(CREATOR_API.draw).map(k => CREATOR_API.draw[k].name).join('/')
    + '；写：**只有「发 Update」一条**（别的路一律是后门，会被拒）。');
  out.push('【演出原语】' + atoms.join('/')
    + ' —— **你给名字，引擎给画法**（例：把 unfold+seal 叫「火漆封缄裂开」）。不许发明新画法。');
  out.push('【每个板块必须答三件事】长什么样（shape）/ **内容从哪来**（source）/ 什么时候更新（when）。'
    + '内容来源只能是这五类：'
    + CONTENT_SOURCES.map(k => k + '=' + CONTENT_SOURCE_DOC[k]).join('；')
    + '。**答不出「内容从哪来」的板块不许建** —— 建出来就是死板块（又一个摆设）。');
  out.push('【案例 · 一张 2026 年的卡，这么写】'
    + JSON.stringify({
      panels: [{
        shape: { id: 'feed', name: '朋友圈', icon: 'album', list: ['谁', '什么时候', '写了什么', '配图'] },
        source: { kind: 'inline', note: '主 AI 每回合顺手产出 1~2 条，不额外多花一次调用' },
        when: '回合'
      }, {
        shape: { id: 'contacts', name: '通讯录', icon: 'contacts', list: ['谁', '怎么联系'] },
        source: { kind: 'view', of: 'knowledge.phoneContacts' },
        when: '有变化时'
      }],
      why: '卡设定是 2026 年 —— 该有即时通信与图片分享；九十年代的卡不要这些'
    }));
  out.push('【两条边界】'
    + '① **原语是引擎的能力**（你只能组合，不能发明画法）；'
    + '② **门控不可绕** —— 朋友圈/通讯录里出现的人，必须是**玩家此刻该认识的**，'
    + '不许因为"排版自由"就把还不认识的人列出来。');
  if (mine.length) out.push('【这局已经有的板块】' + mine.map(p => (p.shape && p.shape.name) || '?').join('、') + '（别重复造）');
  return out.join(String.fromCharCode(10));
}

/* ---------- 给提示词 ---------- */
function promptBlock(data) {
  const f = ensure(data); if (!f) return '';
  /* v2.08：不再有档位。这一段改成**直接告诉 AI 世界已经长出了什么 + 它还能长什么**，
     末尾写清边界（原语不归它、律只能是事实）——这本来就是"AI 的权限说明"，不是玩家的设置。 */
  const v = f.vocab;
  const out = [];
  if (v.docKinds.length) out.push('可读文本类型：' + v.docKinds.slice(-16).join('、'));
  const fxn = Object.keys(v.fxNames).slice(-12).map(k => k + '(' + v.fxNames[k].sig + ')');
  if (fxn.length) out.push('你用过的演出名（**直接用名字就行**，引擎知道怎么画）：' + fxn.join('、'));
  if (v.orgs.length) out.push('机构：' + v.orgs.slice(-8).join('、'));
  if (v.roles.length) out.push('身份：' + v.roles.slice(-8).join('、'));
  if (f.types.length) out.push('已定的型：' + f.types.slice(-6).map(t => t.name + '(' + t.fields.join('/') + ')').join('；'));
  if (f.rules.length) out.push('这个世界的律：' + f.rules.filter(r => !r.frozen).slice(-8).map(r => r.name + '=' + r.items.join('|')).join('；'));
  out.push('这个世界还能长：新词（文书类型/演出名/机构/身份）、新型（结构模板）、新律（世界的规则）。'
    + '两条边界不变：**原语是引擎的能力**（演出名只能用引擎已有的原语组合，不能发明画法）；'
    + '**律只是事实，不是算盘**（只允许 枚举/布尔/区间，不许公式、不许算术）。'
    + '值得长才长：能反复用、说得清、不和已有的东西打架。');
  return out.join('；');
}
function vocabView(data) {
  const f = ensure(data); if (!f) return null;
  return {
    docKinds: f.vocab.docKinds.slice(-20),
    fxNames: Object.keys(f.vocab.fxNames).slice(-12).map(k => ({ name: k, sig: f.vocab.fxNames[k].sig, n: f.vocab.fxNames[k].n })),
    types: (f.types || []).slice(-8),
    rules: (f.rules || []).slice(-8),
    logTail: f.log.slice(-6),
    words: f.log.length
  };
}
module.exports = {
  V, RULE_FORMS, RULE_ITEMS_MAX, blank, ensure, log, canPropose, applyProposal,
  learnDocKind, learnFxName, resolveFx, learnWord, learnType, learnRule, freeze,
  checkProposal, promptBlock, vocabView,
  /* v3.5 · 世界模板创造 */
  CONTENT_SOURCES, CONTENT_SOURCE_DOC, CONTENT_SOURCE_ALIAS, PANEL_REQUIRED, checkPanel,
  KEEP_DEFAULT, RETIRE_DEFAULT, RETIRE_WHO, normKeep, normRetire,
  MOUNTS, LAYOUTS, PANEL_KINDS, OVERLAY_MAX, normShape,
  CREATOR_API, forbidDirectWrite, gateView, panelGate,
  PROPOSAL_STATES, logProposal, proposalView,
  hash32, seedOf, seededRoll, syntaxCheck, creatorPromptBlock
};
