// memory-depth-check.js — 记忆深度：一套算法（v2.04 · P1-2）
// 病（两份外部评审都点到）：两套互不相干的公式 —— decayMemories 算 weight，而检索 memScore 用原始 impact。
// 于是"活人会忘"在玩家侧不成立；而且 weight 只是 impact 的单调函数 + 每回合 ±2 随机抖动。
// 修：**一个函数** memDepth（唯一计算点），五个消费者共用；去掉随机；激活次数真的参与。
'use strict';
const path = require('path'), os = require('os'), fs = require('fs');
const TMP = path.join(os.tmpdir(), 'ws-memdepth-' + Date.now());
process.env.WORLD_SIM_DATA = TMP; fs.mkdirSync(TMP, { recursive: true });
const ROOT = path.join(__dirname, '..');
process.env.WORLD_SIM_ASSETS = ROOT;
const { buildDemoWorld } = require(ROOT + '/src/world');
const RT = require(ROOT + '/src/runtime');
const RP = require(ROOT + '/src/replay');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const mem = (o) => Object.assign({ id: 'mx', owner: 'player', content: 'c', tags: ['t'], impact: 50, t: '1996-06-14T20:00:00', activations: 1, lastActivation: '1996-06-14T20:00:00', repeat: false }, o || {});
const mk = () => { const d = buildDemoWorld(); d.impressions = {}; return d; };

console.log('');
console.log('记忆深度：一套算法 / 三条性质 / 没有第二真相');

// ── ① 三条性质（用同一个函数测，不抄公式） ──
{
  const d = mk();
  const now = '1996-06-14T20:00:00';
  const base = RT.memDepth(d, mem({ impact: 50, t: now }), now);
  ok(Math.abs(base - 50) < 0.01, '刚写下的记忆 = 冲击力（activations=1 是基线，不带加成）：' + base);
  const older = RT.memDepth(d, mem({ impact: 50, t: '1994-06-14T20:00:00' }), now);
  ok(older < base, '★ 越旧越浅（两年后 ' + older.toFixed(1) + ' ＜ ' + base + '）');
  const hotter = RT.memDepth(d, mem({ impact: 80, t: now }), now);
  ok(hotter > base, '★ 冲击力越大越深（80 → ' + hotter + '）');
  const recalled = RT.memDepth(d, mem({ impact: 50, t: now, activations: 9 }), now);
  ok(recalled > base && recalled <= 50 * 1.5 + 0.01, '★ 被反复想起更深（activations=9 → ' + recalled.toFixed(1) + '，封顶 1.5×）');
  const floor = RT.memDepth(d, mem({ impact: 20, t: '1900-01-01T00:00:00' }), '1996-06-14T20:00:00');
  ok(Math.abs(floor - 3) < 0.01, '★ 15% 地板（永远不会真的忘）：' + floor);
  const badT = RT.memDepth(d, mem({ impact: 50, t: '' }), now);
  ok(isFinite(badT) && badT > 0, '时间缺失/坏掉时**不产生 NaN**（老档重建出来的记忆缺 t）：' + badT);
  const two = [RT.memDepth(d, mem({ t: '1993-01-01T00:00:00', activations: 5 }), now), RT.memDepth(d, mem({ t: '1993-01-01T00:00:00', activations: 5 }), now)];
  ok(two[0] === two[1], '★ 同输入同输出（随机抖动去掉了 —— 接进主 AI 后"想起的事"不许自己跳）');
}
// ── ② 检索真的读深度：旧存档里写死的 weight 不是第二真相 ──
{
  const d = mk();
  const T = ['杂货铺', '冲突'];
  d.memories['m_deep'] = mem({ id: 'm_deep', tags: T, impact: 90, t: '1996-06-01T10:00:00', weight: 1 });        // 存档里被人为压到 1
  d.memories['m_shallow'] = mem({ id: 'm_shallow', tags: T, impact: 20, t: '1996-06-01T10:00:00', weight: 999 }); // 存档里被人为抬到 999
  const top = RT.funnelMemories(d, 'player', T, 2).map(m => m.id);
  ok(top[0] === 'm_deep', '★ 排序按**现算的深度**，不按存档里的 weight（被压到 1 的那条仍然排前面）：' + JSON.stringify(top));
  // 时间差：同 impact，新的排前
  const d2 = mk();
  d2.memories['m_old'] = mem({ id: 'm_old', tags: T, impact: 50, t: '1995-05-01T10:00:00' });
  d2.memories['m_new'] = mem({ id: 'm_new', tags: T, impact: 50, t: '1996-06-14T10:00:00' });
  const top2 = RT.funnelMemories(d2, 'player', T, 2).map(m => m.id);
  ok(top2[0] === 'm_new', '★ 同 impact 时新的在前（"会忘"在检索里真的成立了）：' + JSON.stringify(top2));
  const d3 = mk();
  d3.memories['m_a'] = mem({ id: 'm_a', content: '同一件事里的甲', tags: T, impact: 50, t: '1996-06-14T10:00:00' });
  d3.memories['m_b'] = mem({ id: 'm_b', content: '同一件事里的乙', tags: T, impact: 50, t: '1996-06-14T10:00:00', activations: 6 });
  const top3 = RT.funnelMemories(d3, 'player', T, 2).map(m => m.id);
  ok(top3[0] === 'm_b', '★ 其余全同时，被反复想起的那条在前：' + JSON.stringify(top3));
}
// ── ③ 唯一计算点：五个消费者都问它（源码级） ──
{
  const rt = fs.readFileSync(ROOT + '/src/runtime.js', 'utf8');
  const qy = fs.readFileSync(ROOT + '/src/query.js', 'utf8');
  const sc = fs.readFileSync(ROOT + '/src/scheduler.js', 'utf8');
  const gm = fs.readFileSync(ROOT + '/src/game.js', 'utf8');
  ok((rt.match(/function memDepth/g) || []).length === 1, '函数只有一处实现');
  ok(/memDepth\(data, m\)/.test(rt) || /memDepth\(data, m, /.test(rt), 'memScore 用 memDepth');
  ok(!/const imp = \(Number\(m\.impact\) \|\| 0\) \/ 100/.test(rt), '★ memScore 里**不再**直接读原始 impact（那正是断线处）');
  ok(/RT\.memDepth\(data, b/.test(qy), '按需调取按深度排');
  ok(/RT\.memDepth\(data, b/.test(sc), '角色自述（scheduler）按深度取前 3');
  ok(/RT\.memDepth\(data, b, nowIso\)/.test(gm), '记忆激活兜底按深度找那条"被勾起的"');
  ok(!/m\.weight = Math\.min\(100, m\.weight \+ 8\)/.test(gm), '★ 游戏里不再手改 weight（加成由 memDepth 表达）');
  ok(!/old\.weight = Math\.min\(100, old\.weight \+/.test(rt), '★ 写入时的关联激活不再手改 weight（两个真相）');
  ok(!/Math\.random\(\) \* 4 - 2/.test(rt), '★ 衰减里没有随机抖动');
}
// ── ④ 回档不改变深浅（P1-2 的坑之一） ──
{
  const d = mk();
  d.ledger.push({ id: 'l1', t: '1996-06-14T20:00:00', type: '记忆新增', target: 'player', ref: 'mem_x', d: { memId: 'mem_x', owner: 'player', content: '账本里的这条', tags: ['a', 'b'], impact: 60 } });
  const r = RP.replay(d);
  ok(r.memories.mem_x && r.memories.mem_x.t === '1996-06-14T20:00:00', '重放把账本那一刻的时间带上了（原来没有 t）');
  const rb = RP.rebuild(d);
  const m = d.memories.mem_x;
  ok(!!m && m.weight === undefined, '★ 重建出来的记忆**不带 weight**（原来写的是 impact —— 等于回档把所有记忆变深）');
  const dep = RT.memDepth(d, m, '1996-06-14T20:30:00');
  ok(isFinite(dep) && dep > 0 && dep <= 60, '★ 而且它的深度现算得出来（不用 weight 兜底）：' + dep.toFixed(1));
}
console.log('');
console.log('==== memory-depth-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
