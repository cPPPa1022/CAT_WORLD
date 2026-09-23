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

function blank() { return { v: V, vocab: { docKinds: [], fxNames: {}, orgs: [], roles: [] }, types: [], rules: [], log: [], createdAt: '' }; }
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
// ---------- 给提示词 ----------
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
module.exports = { V, RULE_FORMS, RULE_ITEMS_MAX, blank, ensure, log, canPropose, applyProposal, learnDocKind, learnFxName, resolveFx, learnWord, learnType, learnRule, freeze, checkProposal, promptBlock, vocabView };
