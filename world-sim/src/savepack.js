// savepack.js — 自足的存档：导出 / 导入 / 扫描（v1.51）
// ─────────────────────────────────────────────────────────────
// 用户 2026-09-14：
//   「存档是存储当前回合所有数据，**是独立的**」「存档的标准是**直接导入就可使用**（也要设置导出）」
//   「存档导入也需要**扫一遍**，这样子就算出现了**插件（原生不是引擎生出来的）不认识也可能导入**」
// 三条原则（§26.1）：
//   ① 引擎不认识的东西：**不许丢、不许炸、不许猜着改** → 原样装箱 + 点名 + 留给 AI 修
//   ② 创造必须自述（schema + note）→ 清单既做目录也做扫描索引
//   ③ AI 只提议、引擎提交（导入与修复同理）
'use strict';
const FX = require('./fx');
const FW = require('./framework');
const MF = require('./manifest');

const PACK_V = 1;                                  // 包格式版本（引擎当前认识的最高版本）
// 适配器注册表：引擎认识的 schema（不认识的 → unknown 箱）
const KNOWN_SCHEMAS = {
  'fw.doc.v1': '可读文书', 'fw.fx.v1': '演出', 'fw.types.v1': '型', 'fw.rules.v1': '律',
  'fw.orgs.v1': '机构', 'fw.roles.v1': '身份', 'fw.docKinds.v1': '文书类型',
  'ent.person.v1': '人物', 'ent.place.v1': '地点', 'ent.item.v1': '物品', 'card.v1': '角色卡',
  'save.import.v1': '导入留痕'   // 引擎自己写的（否则下一次扫描会把自己的记录当成「不认识」）
};
const UNKNOWN_MAX = 200;

function nowIso() { return new Date().toISOString(); }
// ---------- 导出 ----------
function pack(data, opts) {
  const o = opts || {};
  const out = {
    __save: {
      v: PACK_V,
      build: o.build || '',
      exportedAt: nowIso(),
      name: (data.meta && data.meta.name) || '未名之地',
      era: (data.meta && data.meta.era) || '',
      worldTime: (data.current && data.current.time) || '',
      turnN: (data.current && data.current.turnN) || 0,
      manifestN: MF.ensure(data).items.length,
      unknownN: (data.unknown || []).length,
      hasCard: !!(o.card),
      hasSnapshots: !!o.snapshots
    },
    world: data,
    /* v2.06 修 P1-4：原来写 `o.readme ? '' : MF.readmeSkeleton(data, o.readme)` —— 两个分支都拿不到
       o.readme：带了自定义 readme 时**导出空字符串**，不带时才生成骨架。现在照直说。 */
    readme: o.readme ? String(o.readme) : MF.readmeSkeleton(data, '')
  };
  if (o.card) out.card = o.card;                    // 来源卡（不带的话导入后卡盒里没有这张卡）
  // ★ 完整包：快照（20 格）+ 画面（base64）——用户 2026-09-14 定「存档就是完整包」
  if (o.snapshots) { out.snapshots = o.snapshots; out.__save.hasSnapshots = true; out.__save.snapN = (o.snapshots || []).length; }
  if (o.images) { out.images = o.images; out.__save.hasImages = true; out.__save.imgN = (o.images || []).length; }
  return out;
}
// ---------- 扫描（导入前；也用 dryRun 给玩家看报告）----------
// 返回 { ok, report, unknown }。**不修改任何东西**。
// v1.56：世界自己**声明过**的 schema（插件自报通道）→ 扫描时算「认识」
function knownOf(data) {
  const out = Object.assign({}, KNOWN_SCHEMAS);
  const ds = (data && data.schemas) || {};
  for (const k of Object.keys(ds)) { if (k) out[k] = (ds[k] && (ds[k].hint || ds[k].plugin)) || '世界声明的类型'; }
  return out;
}
function scan(p) {
  const rep = { ok: false, newer: false, errors: [], notes: [], unknown: [], autoFixed: [], needsAI: [], counts: {} };
  const KN = knownOf(p && p.world);
  if (!p || typeof p !== 'object') { rep.errors.push('这不是一个存档文件'); return rep; }
  const s = p.__save || {};
  if (!p.world || typeof p.world !== 'object') { rep.errors.push('存档里没有 world（世界数据）'); return rep; }
  const w = p.world;
  if (!w.entities || !w.current) { rep.errors.push('世界数据不完整（缺 entities / current）'); return rep; }
  if (Number(s.v) > PACK_V) { rep.newer = true; rep.notes.push('这份存档来自更新的版本（包 v' + s.v + ' > 本机 v' + PACK_V + '）——能导入，但新东西本机不认识'); }
  rep.counts.manifest = 0; rep.counts.known = 0; rep.counts.unknown = 0;
  // ① 生成清单里，schema 认不认识的
  // ★ scan **绝不修改任何东西**：一律「防御式读取」，不调 ensure（ensure 会补结构 = 有副作用）
  const m = (w.manifest && Array.isArray(w.manifest.items)) ? w.manifest : { items: [] };
  for (const it of m.items) {
    rep.counts.manifest++;
    if (!it.schema) { rep.counts.unknown++; rep.unknown.push({ what: (it.kind || '?') + ':' + (it.name || it.id || ''), why: '这条生成没写 schema（谁也不知道它是什么类型）', kept: true }); continue; }
    if (KN[it.schema]) { rep.counts.known++; continue; }
    rep.counts.unknown++;
    rep.unknown.push({ what: (it.kind || '?') + ':' + (it.name || it.id || ''), why: 'schema「' + it.schema + '」不是本机认识的类型（可能是插件或更新版本生成的）', kept: true });
  }
  // ② 框架里，演出名用的原语本机认不认识（这是最真实的"插件/未来版本"场景）
  /* v2.06 修 P1-4：这里原来直接拿 w.framework 的**真对象**再就地补字段（`f.vocab = ...` 写在原对象上）——
     scan() 于是会改到调用方的世界对象，而"导出完整包"那条路传进来的就是**内存里的真世界**。
     现在整份读成规范化副本：只读，不写。 */
  const wf = (w.framework && typeof w.framework === 'object') ? w.framework : {};
  const f = {
    vocab: {
      docKinds: Array.isArray(wf.vocab && wf.vocab.docKinds) ? wf.vocab.docKinds.slice() : [],
      fxNames: (wf.vocab && wf.vocab.fxNames && typeof wf.vocab.fxNames === 'object') ? wf.vocab.fxNames : {}
    },
    types: Array.isArray(wf.types) ? wf.types : [],
    rules: Array.isArray(wf.rules) ? wf.rules : []
  };
  for (const name of Object.keys(f.vocab.fxNames)) {
    const atoms = ((f.vocab.fxNames[name] || {}).atoms) || [];   // v2.06：条目为 null/缺字段时不炸
    const bad = atoms.map(a => a && a.k).filter(k => !FX.hasAtom(k));
    if (bad.length) { rep.counts.unknown++; rep.unknown.push({ what: '演出名:' + name, why: '它用了本机没有的原语：' + bad.join('/'), kept: true }); rep.needsAI.push('演出名「' + name + '」用了本机不认识的原语（' + bad.join('/') + '）——可以让 AI 看它原本想演什么，改配到本机已有的原语上'); }
  }
  // ③ 律的形式：不认识的先留着，不改
  for (const r of (f.rules || [])) {
    if (FW.RULE_FORMS.indexOf(r.form) < 0) { rep.counts.unknown++; rep.unknown.push({ what: '律:' + r.name, why: '形式「' + r.form + '」本机不认识（只认 enum/bool/range）', kept: true }); rep.needsAI.push('律「' + r.name + '」形式不认识（' + r.form + '）——要么让 AI 改成 enum/bool/range，要么原样留着不用'); }
  }
  // ⑤ 缺清单（老存档 / 手工拼的包）
  if (!rep.counts.manifest) rep.notes.push('这份存档没有生成清单（老档或手工包）——导入后从这一刻起开始记');
  // ⑥ 不带卡
  if (s.hasCard === false || !p.card) rep.notes.push('包里没带来源角色卡——导入后卡盒里不会有这张卡（世界书/开场可能缺一块）');
  // ⑦ 清单里的欠账（AI 当时没写说明）
  const badItems = m.items.slice(-12).filter(x => x.by === 'ai' && !x.note && x.kind !== '框架');
  const pd = { n: badItems.length, list: badItems.slice(-6).map(x => (x.kind || '?') + ':' + (x.name || x.id || '?')) };
  if (pd.n) rep.needsAI.push('有 ' + pd.n + ' 条生成没写说明（' + pd.list.join('、') + '）——可以让 AI 读一遍上下文补上"这是干嘛的"');
  rep.ok = rep.errors.length === 0;
  return rep;
}
// ---------- 导入（提交端）----------
// 只做"引擎能自动做的"：补结构、改 id、把不认识的装箱；**不猜着改内容**。
function install(p, opts) {
  const o = opts || {};
  const rep = scan(p);
  if (!rep.ok) return { ok: false, report: rep };
  const src = p.world;
  const d = JSON.parse(JSON.stringify(src));         // 深拷：不动原包
  const made = [];
  // 老档/外来档补结构
  if (!d.knowledge) { d.knowledge = { visited: [], knownPlaces: [], knownPeople: [], phoneContacts: [], readMsgs: [], heardNews: [], knownDocs: [] }; made.push('补 knowledge'); }
  if (!d.knowledge.knownDocs) { d.knowledge.knownDocs = []; made.push('补 knownDocs'); }
  MF.ensure(d);
  FW.ensure(d);   // v2.08：不再有档位，导入时也不需要"夹到本机最高档"
  if (d.current) { delete d.current.artCache; delete d.current.sceneArtAI; }
  if (!Array.isArray(d.unknown)) d.unknown = [];
  // 不认识的：**原样装箱**（一个字不改），并留痕
  let boxed = 0;
  for (const u of rep.unknown) {
    if (d.unknown.length >= UNKNOWN_MAX) break;
    d.unknown.push({ t: nowIso(), schema: (u.what || '').split(':')[0], what: u.what, why: u.why, by: 'import', blob: null });
    boxed++;
  }
  for (const it of (MF.ensure(d).items || [])) {
    if (!it.schema || !knownOf(d)[it.schema]) {
      const hit = d.unknown.find(x => x.what === ((it.kind || '?') + ':' + (it.name || it.id || '')));
      if (hit) hit.blob = it;                        // 原样保存这条清单（round-trip 安全）
    }
  }
  d.imported = { at: nowIso(), build: (p.__save && p.__save.build) || '', from: (p.__save && p.__save.name) || '', packV: (p.__save && p.__save.v) || 0, unknownN: boxed };
  MF.record(d, { kind: '导入', id: '', name: (p.__save && p.__save.name) || '', schema: 'save.import.v1', by: 'engine', note: '从存档文件导入（' + boxed + ' 块不认识，已原样保留）' });
  // 完整包：把快照与画面原样交给调用方落盘（本模块不做 IO）
  return {
    ok: true, world: d, made: made, boxed: boxed, report: rep,
    card: p.card || null, readme: (p.readme || ''),
    snapshots: Array.isArray(p.snapshots) ? p.snapshots : [],
    images: Array.isArray(p.images) ? p.images : []
  };
}
module.exports = { PACK_V, KNOWN_SCHEMAS, knownOf, pack, scan, install };
