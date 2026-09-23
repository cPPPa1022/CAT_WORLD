// record-check.js — v1.54 红线：**记录层分类**（原文全存 / 日摘要 / 索引 / 双轨）
// 用户 2026-09-14：「C 这个是**数据没做好分类**！」——修的就是"三天前的原文查不到"这件事。
'use strict';
const REC = require('../src/records');
const G = require('../src/game');
const AI = require('../src/ai');
const W = require('../src/world');

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (x ? '  << ' + x : '')); } };
const mk = () => { const d = JSON.parse(JSON.stringify(W.buildDemoWorld())); d.id = (p) => p + '__c' + Math.random().toString(36).slice(2, 7); return d; };
const noAI = { llm: { baseURL: '', apiKey: '', model: '' } };

// ---------- [1] 原文：全存，不再 200 条丢老的 ----------
console.log('\n[1] 原文（全存）');
(function () {
  const d = mk(); REC.ensure(d);
  const had = d.sceneLog.length;
  for (let i = 0; i < 260; i++) d.sceneLog.push({ t: '1996-06-14T20:00:00', type: 'narration', text: '第' + i + '句' });
  const n = REC.archiveSpill(d, 200);
  ok(n === had + 260 - 200, '溢出 ' + n + ' 条被**归档**（不是丢掉）', String(n));
  ok(d.sceneLog.length === 200, 'sceneLog 仍是 200（上限不变，行为兼容）');
  ok(Object.keys(d.archives).length === 1, 'archives 按**世界日**分桶');
  ok((REC.rawText(d, { text: '第0句' })[0] || {}).text === '第0句', '★ 被挤出去的最早那句**还查得回来**（这就是 C 类「查不到」的根因修复）');
  ok(REC.rawText(d, { day: '1996-06-14', n: 500 }).length === n, '按天取回原文也行（' + n + ' 条）');
})();

// ---------- [2] 认知轨：只记玩家亲历 ----------
console.log('\n[2] 认知轨（只记亲历）');
(function () {
  const d = mk(); REC.ensure(d);
  const it = REC.recordTurn(d, { t: '1996-06-14T21:00:00', turn: 3, action: '你: 打开纸条', people: ['npc_1'], places: ['pl_1'], kind: 'read', opLog: '你打开了帖子' });
  ok(it.id && it.day === '1996-06-14' && it.turn === 3, '条目字段齐（id/世界日/回合）');
  ok(it.people[0] === 'npc_1' && it.places[0] === 'pl_1', '带上了人/地（索引的原料）');
  // 客观轨（玩家不在场的事）不进认知轨
  const led = d.ledger.length;
  d.ledger.push({ t: '1996-06-14T22:00:00', type: '镜头外事件', target: 'npc_2', desc: '阿岩在别处干了件事' });
  ok(d.experience.length === 1 && JSON.stringify(d.experience).indexOf('阿岩在别处干了件事') < 0, '★ 客观轨的事**不会**混进认知轨（双轨分离）');
  ok(d.ledger.length === led + 1, 'ledger 照常（只追加，不被影响）');
})();

// ---------- [3] 摘要：按世界日折叠（0 token） ----------
console.log('\n[3] 摘要层（0 token）');
(function () {
  const d = mk(); REC.ensure(d);
  REC.recordTurn(d, { t: '1996-06-14T21:00:00', action: '你: 打开纸条', people: ['npc_1'], kind: 'read' });
  REC.recordTurn(d, { t: '1996-06-14T21:10:00', action: '你: 我看看窗外', kind: 'peek' });
  REC.recordTurn(d, { t: '1996-06-15T09:00:00', action: '你: 去老茶馆', people: ['npc_2'], kind: 'move' });
  const ks = Object.keys(d.dayDigest).sort();
  ok(ks.length === 2 && ks[0] === '1996-06-14' && ks[1] === '1996-06-15', '一天一条摘要', JSON.stringify(ks));
  ok(/打开纸条/.test(d.dayDigest['1996-06-14']) && /见了 1 人/.test(d.dayDigest['1996-06-14']), '摘要是"做了什么 + 见了谁"（纯代码拼，不花 token）', d.dayDigest['1996-06-14']);
  ok(d.dayDigest['1996-06-15'].indexOf('打开纸条') < 0, '不同天不串味');
})();

// ---------- [4] 索引：人 / 地 / 事 → 指回原文 ----------
console.log('\n[4] 索引层（0 token）');
(function () {
  const d = mk(); REC.ensure(d);
  const a = REC.recordTurn(d, { t: '1996-06-14T21:00:00', action: '你: 问沈姨', people: ['npc_1'], places: ['pl_1'], kind: 'say' });
  REC.recordTurn(d, { t: '1996-06-14T21:20:00', action: '你: 找阿岩', people: ['npc_2'], places: ['pl_4'], kind: 'say' });
  const ix = REC.index(d);
  ok(ix.byPerson['npc_1'] && ix.byPerson['npc_1'][0] === a.id, '按人索到条目');
  ok((ix.byPlace['pl_4'] || []).length === 1 && (ix.byKind['say'] || []).length === 2, '按地点 / 按事类型也能索');
  ok(REC.search(d, { person: 'npc_1' }).length === 1 && REC.search(d, { text: '阿岩' }).length === 1, '检索：按人 / 按关键词');
  ok(REC.search(d, { person: 'npc_1' })[0].action.indexOf('沈姨') >= 0, '检索结果指回**原文那一句**');
})();

// ---------- [5] 接进回合管线 ----------
console.log('\n[5] 回合管线');
(async function () {
  const d = mk(); REC.ensure(d);
  const before = (d.experience || []).length;
  await G.runTurn(d, '打开纸条', noAI);
  ok((d.experience || []).length === before + 1, '★ 走一回合 → 认知轨自动 +1（不用 AI 记，引擎记）', String((d.experience || []).length));
  const last = d.experience[d.experience.length - 1];
  ok(last && last.kind === 'read' && last.action.indexOf('纸条') >= 0, '记的是这一回合做了什么', JSON.stringify(last && last.action));
  const v = G.buildView(d);
  ok(v.experience && v.experience.days && v.experience.days.length >= 1, '玩家视图里有「你经历过」（按天）', JSON.stringify(v.experience && v.experience.total));
  const pack = AI.packetFor(d, { action: 'x', memories: [], candidates: [] });
  ok(pack.indexOf('最近几天(按世界日折叠·你亲历的)') >= 0, '★ 资料包把「最近几天」给 AI（它才知道前因后果）', '');
  ok(/打开纸条/.test(pack), '摘要内容真的进了资料包');
})();

// ---------- [6] 跟着存档走 ----------
console.log('\n[6] 存档往返');
(function () {
  const d = mk(); REC.ensure(d);
  REC.recordTurn(d, { t: '1996-06-14T21:00:00', action: '你: 打开纸条', people: ['npc_1'], kind: 'read' });
  for (let i = 0; i < 260; i++) d.sceneLog.push({ t: '1996-06-14T20:00:00', type: 'narration', text: '第' + i + '句' });
  REC.archiveSpill(d, 200);
  const round = JSON.parse(JSON.stringify(d));
  ok(round.experience.length === 1 && round.dayDigest['1996-06-14'], '往返后认知轨与摘要都在');
  ok(Object.keys(round.archives).length === 1 && REC.rawText(round, { text: '第0句' }).length === 1, '往返后归档原文也在');
})();

setTimeout(() => {
  console.log('\n==== record-check: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exitCode = fail ? 1 : 0;
}, 300);
