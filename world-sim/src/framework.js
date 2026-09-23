// framework.js — 世界的框架：**住在存档内部**（v1.51）
// ─────────────────────────────────────────────────────────────
// 用户 2026-09-14 的原则与拍板：
//   「框架无论怎么调整都只是在存档内部——这个框架才是这个模拟器真正活起来的点！世界是会进步发展的！」
//   「三种都要（写入设置里面，让用户选择），共 4 种 0 1 2 3」
// 分层（世界能自己长到哪一层，由**档位**决定；档位存在存档里，跟着存档走）：
//   0 = 关闭（= v1.50 行为，什么都不长）
//   1 = 词：文书类型 / 演出名（名字→原语）/ 机构 / 身份
//   2 = 词+型：结构模板（门派有山门·掌门·戒律；一封信有寄信人·落款·印）
//   3 = 词+型+律：世界的规则（**只允许 枚举/布尔/区间，不许公式、不许算术**）
// 边界没松：**原语仍是引擎的能力**（世界只能给名字，不能给画法）；**律只是事实，不是算盘**。
'use strict';
const RET = require('./retention');   // v1.86

const V = 1;
const LOG_MAX = 400;
const WORD_MAX = 60;      // 每类词的上限（旧的挤出去，但 log 里留着）
const RULE_FORMS = ['enum', 'bool', 'range'];
const RULE_ITEMS_MAX = 12;   // 枚举项上限

function blank(level) { return { v: V, level: normLevel(level), vocab: { docKinds: [], fxNames: {}, orgs: [], roles: [] }, types: [], rules: [], log: [], createdAt: '' }; }
// 档位归一：**越界的数字往上夹**（9 → 3，不是掉回 1）——导入别人存档时不该平白丢能力，
// 但"根本不是数字"才回落到默认 1。
function normLevel(n) {
  if (n === undefined || n === null || n === '') return 1;
  const x = Number(n);
  if (!isFinite(x)) return 1;
  return Math.max(0, Math.min(3, Math.round(x)));
}
function ensure(data, defaultLevel) {
  if (!data) return null;
  let f = data.framework;
  if (!f || typeof f !== 'object') {
    data.framework = blank(defaultLevel);
    data.framework.createdAt = (data.current && data.current.time) || '';
    log(data, { what: '框架建立', name: (data.meta && data.meta.name) || '', by: 'engine', lv: data.framework.level });
    return data.framework;
  }
  f.v = f.v || V;
  f.level = normLevel(f.level === undefined ? defaultLevel : f.level);
  f.vocab = f.vocab || { docKinds: [], fxNames: {}, orgs: [], roles: [] };
  if (!Array.isArray(f.vocab.docKinds)) f.vocab.docKinds = [];
  if (!f.vocab.fxNames || typeof f.vocab.fxNames !== 'object') f.vocab.fxNames = {};
  if (!Array.isArray(f.vocab.orgs)) f.vocab.orgs = [];
  if (!Array.isArray(f.vocab.roles)) f.vocab.roles = [];
  if (!Array.isArray(f.types)) f.types = [];
  if (!Array.isArray(f.rules)) f.rules = [];
  if (!Array.isArray(f.log)) f.log = [];
  return f;
}
function level(data, defaultLevel) { const f = ensure(data, defaultLevel); return f ? f.level : 1; }
function setLevel(data, n) {
  const f = ensure(data); if (!f) return null;
  const old = f.level, nv = normLevel(n);
  if (old !== nv) { f.level = nv; log(data, { what: '框架档位', name: String(old) + ' → ' + String(nv), by: 'player' }); }
  return f.level;
}
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
  const f = ensure(data); if (!f || f.level < 1) return null;
  const k = trim(kind, 16);
  if (k && k !== 'doc' && push(f.vocab.docKinds, k)) log(data, { what: '+文书类型', name: k, by: 'ai' });
  return k;
}
function learnFxName(data, name, atoms) {
  const f = ensure(data); if (!f || f.level < 1) return null;
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
  const f = ensure(data); if (!f || f.level < 1) return null;
  const arr = f.vocab[slot]; if (!Array.isArray(arr)) return null;
  const w = trim(word, 16);
  if (w && push(arr, w)) log(data, { what: '+' + slot, name: w, by: 'ai' });
  return w;
}
// ---------- 档 2：型（结构模板：只有栏位，没有值、没有公式） ----------
function learnType(data, name, fields) {
  const f = ensure(data); if (!f || f.level < 2) return null;
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
  if (f.level < 3) return { ok: false, err: '这个世界没开「律」（框架档位 ' + f.level + ' < 3）' };
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
// 校验器用（**纯函数，无副作用**）：这个提案按当前档位合不合法
function canPropose(data, u) {
  const f = ensure(data); if (!f) return { ok: false, err: '没有框架' };
  const slot = String((u && (u.slot || u.what)) || '').trim();
  if (slot === 'rule' || slot === 'rules') {
    if (f.level < 3) return { ok: false, err: '这个世界没开「律」（框架档位 ' + f.level + ' < 3）' };
    const form = String((u && u.form) || '').trim();
    if (!has(RULE_FORMS, form)) return { ok: false, err: '律只允许 enum / bool / range（收到 ' + (form || '空') + '）——不许公式、不许算术' };
    if (!trim((u || {}).name, 20)) return { ok: false, err: '律必须有 name' };
    if (form === 'enum' && !(Array.isArray(u.items) && u.items.length)) return { ok: false, err: 'enum 律必须给 items' };
    if (form === 'range' && !(isFinite(Number(u.min)) && isFinite(Number(u.max)) && Number(u.max) > Number(u.min))) return { ok: false, err: 'range 律必须给 min < max' };
    return { ok: true, slot: 'rules' };
  }
  if (slot === 'type' || slot === 'types') {
    if (f.level < 2) return { ok: false, err: '这个世界没开「型」（框架档位 ' + f.level + ' < 2）' };
    if (!trim((u || {}).name, 20)) return { ok: false, err: '型必须有 name' };
    if (!(Array.isArray(u.fields) && u.fields.filter(Boolean).length)) return { ok: false, err: '型必须有 fields（栏位清单）' };
    return { ok: true, slot: 'types' };
  }
  if (slot === 'org' || slot === 'role' || slot === 'orgs' || slot === 'roles') {
    if (f.level < 1) return { ok: false, err: '这个世界的框架关着（档位 0）' };
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
    if (f.level < 2) return { ok: false, err: '这个世界没开「型」（框架档位 ' + f.level + ' < 2）' };
    const t = learnType(data, u.name, u.fields);
    return t ? { ok: true, slot: 'types', name: t.name } : { ok: false, err: '型必须有 name 和 fields（栏位）' };
  }
  if (slot === 'org' || slot === 'role' || slot === 'orgs' || slot === 'roles') {
    if (f.level < 1) return { ok: false, err: '这个世界的框架关着（档位 0）' };
    const k = slot.indexOf('org') === 0 ? 'orgs' : 'roles';
    const w = learnWord(data, k, u.name);
    return w ? { ok: true, slot: k, name: w } : { ok: false, err: '要一个词' };
  }
  return { ok: false, err: '框架提案的 slot 只允许 org/role/type/rule（收到 ' + (slot || '空') + '）' };
}
// ---------- 给提示词 ----------
function promptBlock(data) {
  const f = ensure(data); if (!f) return '';
  const lv = f.level;
  if (lv <= 0) return '（框架档位 0：**不要**给世界新增词汇/型/律——只用引擎已有的东西）';
  const v = f.vocab;
  const out = [];
  out.push('档位 ' + lv + '（' + (lv === 1 ? '词' : lv === 2 ? '词+型' : '词+型+律') + '）');
  if (v.docKinds.length) out.push('可读文本类型：' + v.docKinds.slice(-16).join('、'));
  const fxn = Object.keys(v.fxNames).slice(-12).map(k => k + '(' + v.fxNames[k].sig + ')');
  if (fxn.length) out.push('你用过的演出名（**直接用名字就行**，引擎知道怎么画）：' + fxn.join('、'));
  if (v.orgs.length) out.push('机构：' + v.orgs.slice(-8).join('、'));
  if (v.roles.length) out.push('身份：' + v.roles.slice(-8).join('、'));
  if (lv >= 2 && f.types.length) out.push('已定的型：' + f.types.slice(-6).map(t => t.name + '(' + t.fields.join('/') + ')').join('；'));
  if (lv >= 3 && f.rules.length) out.push('这个世界的律：' + f.rules.filter(r => !r.frozen).slice(-8).map(r => r.name + '=' + r.items.join('|')).join('；'));
  return out.join('；');
}
function vocabView(data) {
  const f = ensure(data); if (!f) return null;
  return {
    level: f.level,
    docKinds: f.vocab.docKinds.slice(-20),
    fxNames: Object.keys(f.vocab.fxNames).slice(-12).map(k => ({ name: k, sig: f.vocab.fxNames[k].sig, n: f.vocab.fxNames[k].n })),
    types: (f.types || []).slice(-8),
    rules: (f.rules || []).slice(-8),
    logTail: f.log.slice(-6),
    words: f.log.length
  };
}
module.exports = { V, RULE_FORMS, RULE_ITEMS_MAX, blank, ensure, level, setLevel, log, canPropose, applyProposal, learnDocKind, learnFxName, resolveFx, learnWord, learnType, learnRule, freeze, checkProposal, promptBlock, vocabView };
