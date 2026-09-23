// manifest.js — 生成清单（v1.51）：**这份存档到目前"新生成过什么"的账**
// ─────────────────────────────────────────────────────────────
// 用户 2026-09-14：
//   「你那个新增加的部分肯定也需要记录啊」「新生成的（是**截至到目前存档的**）」
//   「让 ai 记住，创造完之后**必须写 readme 之类的文档**，写好这些是干嘛的」
// 用途（三合一）：
//   ① 存档自述：这份存档里新生成过什么（跟存档走，只追加，跟 ledger 一个脾气）
//   ② 导入扫描的索引：不用通读全部数据去猜，先看清单就知道有没有"引擎没见过的"
//   ③ AI 修复的上下文：每条生成带 schema + note（这是干嘛的），AI 才有得可读
'use strict';
const RET = require('./retention');   // v1.86

const V = 1;
const MAX = 2000;
const NOTE_MAX = 120;

function blank() { return { v: V, items: [], counts: {} }; }
function ensure(data, defaultLevel) {
  if (!data) return null;
  if (!data.manifest || typeof data.manifest !== 'object') data.manifest = blank();
  const m = data.manifest;
  m.v = m.v || V;
  if (!Array.isArray(m.items)) m.items = [];
  if (!m.counts || typeof m.counts !== 'object') m.counts = {};
  return m;
}
function trim(s, n) { return String(s == null ? '' : s).trim().slice(0, n || 60); }
// 记一条"新生成的东西"。by = ai | card | engine | plugin
function record(data, e) {
  const m = ensure(data); if (!m) return null;
  const it = {
    t: (data.current && data.current.time) || '',
    turn: (data.current && data.current.turnN) || 0,
    kind: trim((e || {}).kind, 16),
    id: trim((e || {}).id || (e || {}).ref, 24),
    name: trim((e || {}).name, 30),
    schema: trim((e || {}).schema, 24),
    by: trim((e || {}).by || 'ai', 8),
    note: trim((e || {}).note, NOTE_MAX)
  };
  m.items.push(it);
  m.items = RET.cap('manifest', m.items, MAX, data);   // v1.86：溢出落盘（"只追加"的账不丢）
  const k = it.kind + '@' + it.by;
  m.counts[k] = (m.counts[k] || 0) + 1;
  return it;
}
// 欠账：最近这么多条里，有几条"没写说明"。**引擎不打断叙事**，只记账（下一回合用事实提醒 AI）
function pending(data, windowN) {
  const m = ensure(data); if (!m) return { n: 0, list: [] };
  const win = m.items.slice(-(windowN || 12));
  const bad = win.filter(x => x.by === 'ai' && !x.note && x.kind !== '框架');
  return { n: bad.length, list: bad.slice(-6).map(x => (x.kind || '?') + ':' + (x.name || x.id || '?')) };
}
function view(data) {
  const m = ensure(data); if (!m) return null;
  return { n: m.items.length, counts: m.counts, tail: m.items.slice(-12), pending: pending(data).n };
}
// 自述骨架（引擎拼事实 + AI 补一段世界自述 —— 见 §26.6 第 4 条）
function readmeSkeleton(data, extra) {
  const m = ensure(data); if (!m) return '';
  const fw = require('./framework');
  const f = fw.ensure(data);
  const L = [];
  L.push('# 存档自述 · ' + ((data.meta && data.meta.name) || '未名之地'));
  L.push('');
  L.push('- 时代：' + ((data.meta && data.meta.era) || '未知'));
  L.push('- 世界时间：' + ((data.current && data.current.time) || '') + '（第 ' + ((data.current && data.current.turnN) || 0) + ' 回合）');
  L.push('- 框架档位：' + (f ? f.level : 1) + '（0 关闭 / 1 词 / 2 词+型 / 3 词+型+律）');
  L.push('- 生成清单：共 ' + m.items.length + ' 条');
  const byCount = {};
  for (const it of m.items) byCount[it.by] = (byCount[it.by] || 0) + 1;
  L.push('  - 按来源：' + Object.keys(byCount).map(k => k + ' ' + byCount[k]).join('、'));
  const kinds = {};
  for (const it of m.items) kinds[it.kind] = (kinds[it.kind] || 0) + 1;
  L.push('  - 按类型：' + Object.keys(kinds).map(k => k + ' ' + kinds[k]).join('、'));
  if (f) {
    /* v2.06 修 P1-4：这一段原来直接读 f.vocab.docKinds.length / f.types.length / f.rules.length ——
       只看 m.items 有没有守卫（上面第 23 行）。框架视图来自旧档 / 手工拼的包 / 未来版本时，
       少任何一个数组都会让**整个生成清单渲染抛错**，而清单是"世界怎么长出来的"唯一账本。
       现在逐项兜底：缺了就当空数组，照常往下写。 */
    const fv = f.vocab || {};
    const dk = Array.isArray(fv.docKinds) ? fv.docKinds : [];
    const fx = (fv.fxNames && typeof fv.fxNames === 'object') ? fv.fxNames : {};
    const ftypes = Array.isArray(f.types) ? f.types : [];
    const frules = Array.isArray(f.rules) ? f.rules : [];
    if (dk.length) L.push('- 这个世界的可读文本类型：' + dk.join('、'));
    const fxn = Object.keys(fx);
    if (fxn.length) L.push('- 这个世界的演出名：' + fxn.map(k => k + '（' + (fx[k] || {}).sig + '）').join('、'));
    if (ftypes.length) L.push('- 已定的型：' + ftypes.map(t => t.name + '（' + ((t && t.fields) || []).join('/') + '）').join('；'));
    if (frules.length) L.push('- 这个世界的律：' + frules.map(r => r.name + '（' + r.form + '：' + ((r && r.items) || []).join('|') + (r.frozen ? '·已冻结' : '') + '）').join('；'));
  }
  if (data.unknown && data.unknown.length) L.push('- ⚠ 引擎不认识的东西：' + data.unknown.length + ' 块（原样保留，未改动）');
  const pd = pending(data);
  if (pd.n) L.push('- ⚠ 有 ' + pd.n + ' 条生成没写说明：' + pd.list.join('、'));
  if (extra) { L.push(''); L.push('## 世界自述（AI）'); L.push(''); L.push(String(extra).slice(0, 1200)); }
  return L.join('\n');
}
module.exports = { V, blank, ensure, record, pending, view, readmeSkeleton };
