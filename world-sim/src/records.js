// records.js — 记录层：**分类**（v1.54）
// ─────────────────────────────────────────────────────────────
// 用户 2026-09-14：「C 这个是**数据没做好分类**！」
// 于是按三轴分：
//   **轨**：客观轨（ledger / archives = 世界真相，只给 AI 与诊断）／**认知轨**（experience = 玩家亲历，可翻、天生不剧透）
//   **层**：原文（**全存，不再 200 条就丢**）／摘要（按**世界日**折叠，纯代码 0 token）／索引（人·地·事 → 指回原文，纯代码 0 token）
//   **类**：对话 / 旁白 / 事件 / 文书 / 消息
// 这一层的意义：让"**三天前那封信的原文**"查得到——它正是 §28.9 里 C 类「查不到」的根因。
'use strict';
const RET = require('./retention');   // v1.86 统一留存策略（阈值一处、溢出落盘）

/* v1.98 · P0-3：阈值**只有一处** —— 这两个数原来在本文件里各写了一遍（5000 / 400），
   和 retention.js 的策略表是两份。结果：改 CAPS 只影响一半（认知轨与日摘要还按旧数走），
   "统一留存策略"对本文件其实是失效的。现在一律读策略表（表里给 0 = 不限）。 */
const EXP_MAX = (() => { const n = Number(RET.CAPS && RET.CAPS.experience); return (isFinite(n) && n > 0) ? Math.floor(n) : 0; })();
const DAY_MAX = (() => { const n = Number(RET.CAPS && RET.CAPS.dayDigestDays); return (isFinite(n) && n > 0) ? Math.floor(n) : 0; })();

function ensure(data) {
  if (!data) return null;
  if (!Array.isArray(data.experience)) data.experience = [];
  if (!data.dayDigest || typeof data.dayDigest !== 'object') data.dayDigest = {};
  if (!data.archives || typeof data.archives !== 'object') data.archives = {};
  if (!data.current) data.current = {};
  if (!data.current.expSeq) data.current.expSeq = 0;
  return data;
}
function dayOf(iso) { return String(iso || '').slice(0, 10); }

// ---------- 认知轨：只记"玩家亲历" ----------
// entry: { t, turn, sceneId, action, people:[id], places:[id], docs:[id], kind, opLog }
function recordTurn(data, e) {
  ensure(data);
  const it = {
    id: 'exp' + (++data.current.expSeq),
    t: e.t || data.current.time,
    day: dayOf(e.t || data.current.time),
    turn: e.turn || data.current.turnN || 0,
    sceneId: e.sceneId || data.current.sceneId || '',
    kind: String(e.kind || 'act').slice(0, 12),
    action: String(e.action || '').slice(0, 160),
    opLog: String(e.opLog || '').slice(0, 200),
    people: (e.people || []).slice(0, 8),
    places: (e.places || []).slice(0, 4),
    docs: (e.docs || []).slice(0, 4)
  };
  data.experience.push(it);
  // v1.86：统一留存策略 —— 超出窗口的认知轨**落盘**（data/retention/experience.jsonl），不再丢
  data.experience = RET.cap('experience', data.experience, RET.CAPS.experience, data);
  // 顺手更新当天的摘要（纯代码，0 token）
  digestDay(data, it.day);
  return it;
}
// ---------- 原文：全存（sceneLog 要丢的那部分，进 archives，按世界日） ----------
function archiveSpill(data, keep) {
  ensure(data);
  const n = Math.max(0, (data.sceneLog || []).length - (keep || RET.CAPS.sceneLog));
  if (!n) return 0;
  const spill = data.sceneLog.splice(0, n);
  for (const l of spill) {
    const k = dayOf(l && l.t);
    if (!data.archives[k]) data.archives[k] = [];
    data.archives[k].push(l);
    // 每场（这里=每天）留 800 条，超了从老的那头砍 100（沿用 store.archivePush 的脾气）
    // v1.86：原文"全存"落在**磁盘**上（存档里只留窗口）—— 原来这里是从老的那头直接砍掉
    data.archives[k] = RET.cap('archives', data.archives[k], RET.CAPS.archivesDay, data);
  }
  return n;
}
// ---------- 摘要层：按世界日折叠（纯代码拼，0 token） ----------
function digestDay(data, day) {
  ensure(data);
  const k = day || dayOf(data.current.time);
  const items = data.experience.filter(x => x.day === k);
  if (!items.length) return '';
  const acts = items.map(x => String(x.action || '').trim()).filter(Boolean).slice(0, 6);
  const acts2 = acts.map(a => a.replace(/^你[:：]\s*/, ''));
  const who = [];
  for (const x of items) for (const p of (x.people || [])) if (who.indexOf(p) < 0) who.push(p);
  const s = acts2.join('；');
  const txt = s.length > 220 ? s.slice(0, 220) + '…' : s;
  const line = String(k) + '：' + (txt || '（这一天没什么事）') + (who.length ? '（见了 ' + who.length + ' 人）' : '');
  data.dayDigest[k] = line;
  const keys = Object.keys(data.dayDigest).sort();
  // v1.87：日摘要天数也走策略表；**被裁掉的那几天先落盘**（原文可查），不再直接 delete
  if (keys.length > DAY_MAX) {
    const cut = keys.slice(0, keys.length - DAY_MAX);
    RET.spill('dayDigest', cut.map(k2 => ({ day: k2, digest: data.dayDigest[k2] })));
    for (const k2 of cut) delete data.dayDigest[k2];
  }
  return line;
}
// ---------- 索引层：人 / 地 / 事 → 指回原文（纯代码，0 token） ----------
function index(data) {
  const byPerson = {}, byPlace = {}, byKind = {}, byDoc = {};
  for (const x of (data.experience || [])) {
    for (const p of (x.people || [])) (byPerson[p] = byPerson[p] || []).push(x.id);
    for (const p of (x.places || [])) (byPlace[p] = byPlace[p] || []).push(x.id);
    (byKind[x.kind] = byKind[x.kind] || []).push(x.id);
    for (const d of (x.docs || [])) (byDoc[d] = byDoc[d] || []).push(x.id);
  }
  return { byPerson: byPerson, byPlace: byPlace, byKind: byKind, byDoc: byDoc };
}
// 检索：按人/地/事/关键词找原文（**只找玩家亲历的**，天生不剧透）
function search(data, q) {
  const s = String((q && q.text) || '').trim();
  const out = [];
  for (const x of (data.experience || [])) {
    if (q && q.person && (x.people || []).indexOf(q.person) < 0) continue;
    if (q && q.place && (x.places || []).indexOf(q.place) < 0) continue;
    if (s && String(x.action || '').indexOf(s) < 0 && String(x.opLog || '').indexOf(s) < 0) continue;
    out.push(x);
  }
  return out.slice(-(Number((q && q.n)) || 20));
}
// 原文：从 archives（按天）取回某一天 / 关键词
function rawText(data, opts) {   // 只读：**不调 ensure**（ensure 会补结构 = 有副作用）
  const arcs = (data && data.archives) || {};
  const o = opts || {};
  const days = o.day ? [o.day] : Object.keys(arcs).sort();
  const kw = String(o.text || '').trim();
  const out = [];
  for (const d of days) {
    for (const l of (arcs[d] || [])) {
      if (kw && String(l.text || '').indexOf(kw) < 0) continue;
      out.push(l);
    }
  }
  return kw ? out.slice(-(o.n || 20)) : out.slice(-(o.n || 200));
}
// ---------- 给玩家看（按世界日分组；**只含亲历**） ----------
function view(data, opts) {
  const o = opts || {};
  const exp = (data && data.experience) || [];
  const dd = (data && data.dayDigest) || {};
  const days = Object.keys(data.dayDigest).sort().reverse();
  const pick = o.day ? [o.day] : days.slice(0, Number(o.days) || 7);
  const out = [];
  for (const d of pick) {
    const items = exp.filter(x => x.day === d).slice(-40).map(x => ({
      id: x.id, t: x.t, turn: x.turn, action: x.action, opLog: x.opLog, kind: x.kind,
      people: x.people, scene: x.sceneId
    }));
    out.push({ day: d, digest: dd[d] || '', items: items, n: exp.filter(x => x.day === d).length });
  }
  return { days: out, total: exp.length, archiveDays: Object.keys((data && data.archives) || {}).length, indexSize: Object.keys(index(data).byPerson).length };
}
module.exports = { EXP_MAX, DAY_MAX, ensure, dayOf, recordTurn, archiveSpill, digestDay, index, search, rawText, view };
