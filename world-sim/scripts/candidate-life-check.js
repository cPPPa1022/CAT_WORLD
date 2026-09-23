// candidate-life-check.js — 候选的寿命与上限（v1.97 · X8）
// 候选池此前只进不出：expireAt 写 5 处、读 0 处。于是三天前为"雨夜"生成的那个候选，
// 会在三天后照样被当成"此刻"喂给主 AI。这个脚本守三条：过期即作废 / 池子有上限 / 上限淘汰最早。
'use strict';
const path = require('path'), os = require('os'), fs = require('fs');
const TMP = path.join(os.tmpdir(), 'ws-candlife-' + Date.now());
process.env.WORLD_SIM_DATA = TMP; fs.mkdirSync(TMP, { recursive: true });
const ROOT = path.join(__dirname, '..');
process.env.WORLD_SIM_ASSETS = ROOT;
const { buildDemoWorld } = require(ROOT + '/src/world');
const { makeId } = require(ROOT + '/src/store');
const RT = require(ROOT + '/src/runtime');
const AI = require(ROOT + '/src/ai');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const mk = () => { const d = buildDemoWorld(); if (!d.id) d.id = makeId; d.impressions = {}; return d; };
const cand = (id, text, expireAt) => ({ id: id, text: text, type: '事件', expireAt: expireAt, sev: '低' });
const T0 = '1996-06-14T20:00:00';

console.log('');
console.log('候选寿命：过期即作废 / 池子有上限 / 不动新数据');

// ── ① 过期即作废 ──
{
  const d = mk();
  d.current.time = T0;
  d.current.pendingCandidates = [cand('c1', '过期的候选', '1996-06-14T19:00:00')];
  ok(RT.candidatesLive(d).length === 0, '过期候选不出池（1 条过期 → 0 条）');
  ok((d.current.pendingCandidates || []).length === 0, '过期候选被就地清掉（池子不留）');
  d.current.pendingCandidates = [cand('c2', '还没过期的候选', '1996-06-14T21:00:00')];
  ok(RT.candidatesLive(d).length === 1, '没过期的照常留着');
  ok(!!d.current.pendingCandidates[0] && d.current.pendingCandidates[0].id === 'c2', '读一次不改动没过期的那条');
}
// ── ② 老数据（没有 expireAt）不静默丢弃 ──
{
  const d = mk();
  d.current.time = T0;
  d.current.pendingCandidates = [{ id: 'c3', text: '老存档的候选', type: '环境' }];
  const keep = RT.candidatesLive(d);
  ok(keep.length === 1 && !!keep[0].expireAt, '没有 expireAt 的旧候选：补一个默认寿命（不静默丢弃）');
  ok(String(keep[0].expireAt) > T0, '补的寿命从"现在"起算，不是立刻判死');
}
// ── ③ 上限与淘汰顺序 ──
{
  const d = mk();
  d.current.time = T0;
  d.current.pendingCandidates = [];
  for (let i = 0; i < 100; i++) d.current.pendingCandidates.push(cand('c' + i, '候选' + i, RT.addMinutes(T0, 600)));
  const cap = RT.candidatesLive(d);
  ok(cap.length === RT.CAND_CAP, '池子上限生效（塞 100 条 → ' + RT.CAND_CAP + ' 条，实际 ' + cap.length + '）');
  ok(cap[0].id === 'c' + (100 - RT.CAND_CAP), '淘汰的是**最早**生成的那批（从 c' + (100 - RT.CAND_CAP) + ' 起）');
  ok(cap[cap.length - 1].id === 'c99', '最新生成的一定留在池子里');
  d.current.pendingCandidates = [{ id: 'x', type: '事件' }, cand('c5', '有文字的候选', '1996-06-14T21:00:00')];
  ok(RT.candidatesLive(d).length === 1, '没有 text 的空壳不占池子（反正也喂不出去）');
}
// ── ④ genCandidates 走的是同一道门 ──
{
  const d = mk();
  d.current.time = T0;
  d.current.weather = '晴';
  d.current.pendingCandidates = [cand('old', '过期的', '1996-06-14T10:00:00'), cand('new', '没过期的', '1996-06-14T23:00:00')];
  const got = RT.genCandidates(d);
  ok(got.some(c => c.id === 'new'), 'genCandidates 把没过期的候选交出去');
  ok(!got.some(c => c.id === 'old'), 'genCandidates 不会把过期的候选交出去（本回合资料包里没有它）');
}
// ── ⑤ 接线（读的人真的读的是这一处） ──
{
  const ab = (pool) => {
    const d = mk();
    d.current.time = T0;
    d.current.pendingCandidates = pool;
    d.current.pendingReplies = [];
    d.relations = { player: {} };                       // 关系不带张力，避免别的加分项混进来
    d.sceneLog = [{ t: T0, type: 'narration', text: '屋里很安静。' }];
    const add = (id) => { d.entities[id] = { id: id, type: 'person', name: id, state: { location: d.current.sceneId }, profile: {} }; };
    add('npc_a'); add('npc_b'); add('npc_c');            // 三个在场 ⇒ +2；候选那一条决定过不过 3 分线
    return AI.thinkBudget(d, { kind: 'act' }, { action: '我看了看货架' }, false);
  };
  const live = ab([cand('L', '还没过期', '1996-06-14T23:00:00')]);
  const dead = ab([cand('D', '已经过期', '1996-06-14T10:00:00')]);
  ok(live === 'medium' && dead === 'none', 'thinkBudget 只把"还有效的候选"算作有候选（有效→' + live + ' / 过期→' + dead + '）');
}
console.log('');
console.log('==== candidate-life-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
