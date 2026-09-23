// query-check.js — v1.55 红线：**知识三档尺子** + **按需调取（查询协议）**
// 用户拍板：读**不设限制**（还原优先）；查不到**不许编**；玩家还没认识的，只能给"看得见的样子"。
'use strict';
const Q = require('../src/query');
const K = require('../src/knowledge');
const AI = require('../src/ai');
const W = require('../src/world');

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (x ? '  << ' + x : '')); } };
const mk = () => {
  const d = JSON.parse(JSON.stringify(W.buildDemoWorld())); d.id = (p) => p + '__q' + Math.random().toString(36).slice(2, 7);
  d.impressions.npc_x = { stage: 1, seen: '背着帆布工具袋', nameKnown: null };
  d.entities.npc_x = { id: 'npc_x', type: 'person', name: '周师傅', profile: { appearance: { 标志物: '背着帆布工具袋' }, surface: { 待人: '寡言' } }, state: { location: d.current.sceneId, mood: '平静' } };
  return d;
};

// ---------- [1] 知识三档 ----------
console.log('\n[1] 知识三档尺子（确知 / 可推断 / 秘密）');
(function () {
  const d = mk();
  ok(K.person(d, 'npc_1').tier === 'known', '认识的人（印象 stage 4）→ **确知**（可以用真名）');
  const g = K.person(d, 'npc_x');
  ok(g.tier === 'inferable' && /工具袋/.test(g.as), '★ 见过但不知名字 → **可推断**，且给的是「看得见的样子」', JSON.stringify(g));
  ok(g.mustNot === '周师傅', '★ 同时把真名记进「不许说」清单');
  ok(K.person(d, 'npc_zzz').tier === 'secret', '没印象的人 → **秘密**');
  ok(K.doc(d, 'doc_note1').tier === 'known', '手上的文书 → 确知');
  const d2 = mk(); d2.knowledge.knownDocs = [];
  ok(K.doc(d2, 'doc_note1').tier === 'secret', '没见过的文书 → 秘密（门控）');
  ok(K.place(d, 'pl_1').tier === 'known' && K.place(d, 'pl_6').tier !== 'known', '去过的地方确知；没去过的不确知');
  ok(K.mustNotSay(d).indexOf('周师傅') >= 0, '负面清单里有那个不该说的名字');
  ok(K.leaks(d, '周师傅说，沈姨在店里。').length === 1, '★ 泄露检测：文本里出现了不该出现的名字 → 抓出来');
  ok(K.leaks(d, '沈姨在店里。').length === 0, '该说的名字不误伤');
})();

// ---------- [2] 目录：这里有什么 + 不会有什么 ----------
console.log('\n[2] 目录（含负面清单）');
(function () {
  const d = mk();
  const c = Q.catalog(d);
  ok(c.rows.some(r => r[0] === '文书' && /份可读/.test(r[1])), '目录有表名 + 条数');
  ok(c.rows.some(r => r[0] === '你亲历'), '目录里有「你亲历」（v1.54 认知轨）');
  ok(c.negatives.some(x => /没有网络新闻|没有报纸/.test(x)), '★ 负面清单：这个世界**不会有什么**（B2：1900 不会有智能手机）');
  const t = Q.renderCatalog(d);
  ok(/怎么问/.test(t) && /不设条数上限|不设限制/.test(t), '目录里带「怎么问」的引导');
})();

// ---------- [3] 查得到 ----------
console.log('\n[3] 查到（只读 / 带出处）');
(function () {
  const d = mk();
  const before = JSON.stringify(d);
  const r = Q.resolve(d, { items: [{ what: 'person', id: 'npc_1' }, { what: 'doc', id: 'doc_note1' }, { what: 'framework' }, { what: 'records' }] });
  ok(r.items.length >= 3, '多条 items 一次查完（' + r.items.length + ' 条）');
  ok(r.items.every(x => x.what && (x.by !== undefined)), '每条都带类型与来源（带出处）');
  ok(JSON.stringify(d) === before, '★ 查询**只读**：一个字都没改存档');
  ok(r.bytes > 0, '回执带字数（AI 自己看得见尺寸）');
})();

// ---------- [4] 门控降级（A 类：有，但你这个视角不该看到全部） ----------
console.log('\n[4] 门控降级');
(function () {
  const d = mk();
  const r = Q.resolve(d, { what: 'person', id: 'npc_x' });
  const it = r.items[0];
  ok(!!it && /工具袋/.test(it.title) && it.text.indexOf('周师傅') < 0, '★ 回执里给的是可见称呼，**全文没有真名**', JSON.stringify(it && it.title));
  ok(it.text.indexOf('不许写出真名') >= 0, '★ 回执**明写**「不许写出真名」（这句话就是 OOC 的闸门）');
  ok(r.notes.some(n => /不许叫出真名/.test(n)), '另有一条门控提示（notes）');
  const r2 = Q.resolve(mk(), { what: 'doc', id: 'doc_nope' });
  ok(r2.misses.length === 1 && r2.misses[0].kind === 'badref', 'D 类：引用不存在 → badref');
})();

// ---------- [5] 四类「查不到」 ----------
console.log('\n[5] 四类「查不到」都有类型和下一步');
(function () {
  const d = mk();
  const bad = Q.resolve(d, { what: 'person', id: 'npc_9' }).misses[0];
  ok(bad.kind === 'badref' && /可能想找/.test(bad.suggest || ''), 'D：假 id → 给候选', JSON.stringify(bad.suggest));
  const d2 = mk(); d2.knowledge.knownDocs = [];
  const gated = Q.resolve(d2, { what: 'doc', id: 'doc_note1' }).misses[0];
  ok(gated.kind === 'gated' && /不要引用/.test(gated.suggest || ''), 'A：门控 → 明确"还没到你手上，不要引用"');
  const absent = Q.resolve(mk(), { what: 'unknown' }).misses[0];
  ok(absent.kind === 'absent', 'B：世界里真的没有 → absent（可以创造）');
  const r = Q.resolve(mk(), { what: 'zzz' });
  ok(r.misses[0].kind === 'badref' && /可用：/.test(r.misses[0].suggest || ''), 'unknown what → 给可用清单');
})();

// ---------- [6] 不设条数上限（用户拍板） ----------
console.log('\n[6] 读不设限');
(function () {
  const d = mk();
  for (let i = 0; i < 80; i++) d.documents['doc_b' + i] = { id: 'doc_b' + i, title: '文书' + i, body: '正文'.repeat(20), t: 'T' };
  d.knowledge.knownDocs = Object.keys(d.documents);
  const r = Q.resolve(d, { what: 'docs' });
  ok(r.items.length === Object.keys(d.documents).length, '★ 80+ 份文书**全部返回**（不是只给 3 条）', String(r.items.length));
})();

// ---------- [7] 分页与提示词 ----------
console.log('\n[7] 分页 / 提示词');
(function () {
  const d = mk();
  d.documents.doc_long = { id: 'doc_long', title: '长信', body: '字'.repeat(6000), t: 'T' };
  d.knowledge.knownDocs.push('doc_long');
  const r = Q.resolve(d, { what: 'doc', id: 'doc_long', limit: 1000 });
  ok(r.items[0].len === 6000 && r.items[0].more === 5000, '长文本**分页**：给 1000 字 + 告诉你还有 5000', JSON.stringify({ len: r.items[0].len, more: r.items[0].more }));
  ok(/还有 5000 字/.test(Q.render(r)), '回执里写明"要就再查"（不是硬砍）');
  const sys = AI.SYSTEM(mk(), { llm: {} }, false);
  ok(/按需调取 · 你自己去查/.test(sys), '提示词含「按需调取」条');
  ok(/查不到就不许编/.test(sys), '★ 提示词明写：查不到不许编');
  ok(/不许写出真名/.test(sys), '★ 提示词明写：回执说不能说名字的，一个字都不许写');
})();

console.log('\n==== query-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
