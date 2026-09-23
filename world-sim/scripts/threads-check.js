'use strict';
// threads-check.js — v1.93 **「悬着的线」唯一推导点**断言
//
// 为什么要它：这是一个**已经发生过两次**的病 —— 同一件事多份实现，然后慢慢分叉。
//   第一次：知识门控 7 份（M6）→ 收敛成 gate.nameOf
//   第二次：「悬着的线」3 份（ai.js 的未了的事 / game.js 的 looseEndsView / storyteller.js 的 threads）
//          → 收敛成 threads.js
// 收敛本身不难，难的是**守住它**：下一次有人要「顺手再推一遍」时，这份脚本会红。
// 用法：node scripts/threads-check.js   失败非零退出
const fs = require('node:fs');
const path = require('node:path');
const TH = require('../src/threads');
const AI = require('../src/ai');
const W = require('../src/world');
const G = require('../src/game');
const ST = require('../src/storyteller');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  OK  ' + m)) : (fail++, console.log('  FAIL ' + m)); };
const newWorld = () => { const d = W.buildDemoWorld(); d.id = (p) => p + '_' + Math.random().toString(36).slice(2, 8); return d; };

// ---------- 1 · 唯一实现：折叠只许出现在 threads.js ----------
const SRC = path.join(__dirname, '..', 'src');
const offenders = [];
for (const f of fs.readdirSync(SRC)) {
  if (!f.endsWith('.js') || f === 'threads.js') continue;
  const t = fs.readFileSync(path.join(SRC, f), 'utf8');
  // 折叠的指纹：往 opened[] 里放/删 target
  if (/opened\[/.test(t)) offenders.push(f);
}
ok(offenders.length === 0, '★ 折叠只出现在 threads.js' + (offenders.length ? (' —— 又出现了第二份: ' + offenders.join(', ')) : ''));

// ---------- 2 · 两个受众：无门控差异时内容一致 ----------
{
  const d = newWorld();
  const here = d.current.sceneId;
  d.knowledge.visited = d.knowledge.visited || [];
  if (d.knowledge.visited.indexOf(here) < 0) d.knowledge.visited.push(here);
  d.ledger.push({ id: 't1', t: d.current.time, type: '事件开始', target: '看得见的事', cause: 'a', scene: here, visible: 'scene' });
  const ai = TH.list(d, 'ai').map(x => x.name);
  const pl = TH.list(d, 'player').map(x => x.name);
  ok(ai.indexOf('看得见的事') >= 0 && pl.indexOf('看得见的事') >= 0, '同一个推导服务两个受众（两处都看得到）');
}

// ---------- 3 · 门控只作用于玩家（叙述者看得到世界真相） ----------
{
  const d = newWorld();
  const here = d.current.sceneId;
  d.knowledge.visited = (d.knowledge.visited || []).concat([here]);
  d.ledger.push({ id: 's1', t: d.current.time, type: '事件开始', target: '秘密的事', scene: here, visible: 'secret' });
  d.ledger.push({ id: 's2', t: d.current.time, type: '事件开始', target: '别处的事', scene: 'pl_99', visible: 'scene' });
  const ai = TH.list(d, 'ai').map(x => x.name);
  const pl = TH.list(d, 'player').map(x => x.name);
  ok(pl.indexOf('秘密的事') < 0, '★ 玩家看不到 secret（门控在唯一执行点里）');
  ok(pl.indexOf('别处的事') < 0, '★ 玩家看不到没去过的地方的事');
  ok(ai.indexOf('秘密的事') >= 0 && ai.indexOf('别处的事') >= 0, '★ 叙述者两样都看得到（它是叙述者，不是玩家）');
  ok(TH.count(d) === ai.length, 'count() 数的是**世界欠着多少事**（不过滤），不是玩家知道多少');
}

// ---------- 4 · 上限写在表里 ----------
{
  const d = newWorld();
  const here = d.current.sceneId;
  d.knowledge.visited = (d.knowledge.visited || []).concat([here]);
  for (let i = 0; i < 10; i++) d.ledger.push({ id: 'c' + i, t: d.current.time, type: '事件开始', target: '事' + i, scene: here, visible: 'scene' });
  ok(TH.list(d, 'ai').length === TH.CAP.ai, 'ai 上限 = ' + TH.CAP.ai + '（实得 ' + TH.list(d, 'ai').length + '）');
  ok(TH.list(d, 'player').length === TH.CAP.player, 'player 上限 = ' + TH.CAP.player + '（实得 ' + TH.list(d, 'player').length + '）');
}

// ---------- 5 · 了结：三处同时消失 ----------
{
  const d = newWorld();
  const here = d.current.sceneId;
  d.knowledge.visited = (d.knowledge.visited || []).concat([here]);
  /* 注意：演示世界**开局就带着一条没关的线**（world.js 种了一条「口角」），
     所以这里必须算基数 —— 不能假设「开局是 0 条」（我第一次就写错在这里）。 */
  const baseN = TH.count(d);
  const baseL = G.buildView(d).loose.length;
  d.ledger.push({ id: 'x1', t: d.current.time, type: '事件开始', target: '要了结的事', scene: here, visible: 'scene' });
  ok(TH.count(d) === baseN + 1, '开了一条：count ' + baseN + ' → ' + TH.count(d));
  ok(G.buildView(d).loose.length === baseL + 1, '开了一条：玩家侧 ' + baseL + ' → ' + G.buildView(d).loose.length);
  d.ledger.push({ id: 'x2', t: d.current.time, type: '事件结束', target: '要了结的事', scene: here, visible: 'scene' });
  ok(TH.count(d) === baseN && G.buildView(d).loose.length === baseL, '★ 了结之后三处同时回到基数（' + baseN + ' 条）');
}

// ---------- 6 · 三个出口真的都走这一个实现 ----------
{
  const d = newWorld();
  const here = d.current.sceneId;
  d.knowledge.visited = (d.knowledge.visited || []).concat([here]);
  d.ledger.push({ id: 'y1', t: d.current.time, type: '事件开始', target: '三分支一致', cause: 'c', scene: here, visible: 'scene' });
  const pl = TH.list(d, 'player');
  ok(JSON.stringify(G.buildView(d).loose.map(x => x.name)) === JSON.stringify(pl.map(x => x.name)), 'game.js 的 looseEndsView ≡ list(data,player)（已是薄壳）');
  ok(ST.threads(d) === TH.count(d), 'storyteller 的 threads ≡ count()');
  const pack = JSON.parse(AI.packetFor(d, { memories: [], candidates: [], action: 'x' }));
  ok(String(pack['未了的事']).indexOf('三分支一致') >= 0, '★ 主 AI 的资料包「未了的事」也走同一个推导');
}

console.log('');
console.log('pass=' + pass + ' fail=' + fail);
process.exitCode = fail ? 1 : 0;