// anchor-check.js — 「有主」系统的断言（v2.10）
// 用法：node scripts/anchor-check.js
//
// 一条不变量：**玩家能看见的每一样东西，都必须有主。**
//   —— 凡是"凭空出现在玩家世界里的东西"，都必须能沿 causeRef 走回一个**已经存在**的因。
//
// 为什么单独一个脚本：这条不变量跨"校验器 / 资料包 / 提示词"三处（给规矩必须同时给工具），
// 而原来的 cause 只是"非空字符串"——AI 写一句「剧情需要」就能过，director.js 的默认值
// **就是**那句。实测后果：一个"恰好路过的侦察兵/恰好知道情报的线人"可以凭空落地。
'use strict';
const RT = require('../src/runtime');
const W = require('../src/world');
const fs = require('node:fs');
const path = require('node:path');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
/* 注意：JSON 往返会把 data.id 这个**函数**剥掉（framework-check 的 mk 里专门补了回来）。
   不补的话，任何走 ledgerPush 的路径都会以 "data.id is not a function" 静默失败 —— 我第一版就栽在这。 */
const mk = () => { const d = JSON.parse(JSON.stringify(W.buildDemoWorld())); d.id = (p) => p + '_a' + Math.random().toString(36).slice(2, 7); d.current.turnN = 1; return d; };
const spawn = (extra) => Object.assign({
  type: '人物出现', target: 'npc_新面孔', relation: '陌生人',
  spawn: { name: '一个穿军装的年轻人', appearance: '靴子磨破了' },
  cause: '镇口来了个生面孔'
}, extra || {});

console.log('');
console.log('[1] 没有锚 -> 拒（人话 cause 不算数）');
{
  const v = RT.validateUpdates(mk(), [spawn()], {}, {});
  ok(v.allowed.length === 0, '★ 只给 cause 人话、不给 causeRef -> 拒');
  ok(/挂在已有的因上/.test(v.errors.join('|')), '拒绝理由说清了"要挂在已有的因上"：' + String(v.errors[0] || '').slice(0, 40));
}

console.log('');
console.log('[2] 锚指向不存在的东西 -> 拒');
{
  const v = RT.validateUpdates(mk(), [spawn({ causeRef: { kind: 'ledger', id: '根本不存在的条目' } })], {}, {});
  ok(v.allowed.length === 0, '★ 锚解析不到 -> 拒');
}

console.log('');
console.log('[3] 三种锚都认（全部纯查表，0 token）');
{
  const d1 = mk();
  d1.ledger.push({ id: 'led_off_1', t: d1.current.time, type: '镜头外事件', target: '镇子', desc: '北边下来的人越来越多' });
  const v1 = RT.validateUpdates(d1, [spawn({ cause: '北边下来的人越来越多，镇口多了个生面孔', causeRef: { kind: 'ledger', id: 'led_off_1' } })], {}, {});
  ok(v1.allowed.length === 1, '★ 锚 = 一条已有的「镜头外事件」-> 过（**玩家可能从没见过它**，这是伏笔）');

  const d2 = mk();
  const someone = Object.keys(d2.entities).find(k => k !== 'player');
  const nm = d2.entities[someone].name;
  const v2 = RT.validateUpdates(d2, [spawn({ cause: nm + '带来的生面孔', causeRef: { kind: 'entity', id: someone } })], {}, {});
  ok(v2.allowed.length === 1, '★ 锚 = 一个已有实体 -> 过（"' + nm + '带来的"）');

  const d3 = mk();
  d3.beyond = [{ id: 'by_war', what: '北方战事，败局已定', visible: 'secret' }];
  const v3 = RT.validateUpdates(d3, [spawn({ cause: '北方战事打输了，有人一路往南走', causeRef: { kind: 'beyond', id: 'by_war' } })], {}, {});
  ok(v3.allowed.length === 1, '★ 锚 = 世界上游事实 -> 过（更远的因，玩家永远够不到）');
}

console.log('');
console.log('[3.5] ★ 锚存在、但"说不到一块去" -> 拒（v2.10.1 补的洞）');
{
  /* 自评时发现的洞：只验"锚存在"，AI 就能**乱指一条无关的账本条目** ——
     从"编一个字符串"变成"乱指一个 id"。下面两条就是那道新门。 */
  const d = mk();
  d.ledger.push({ id: 'led_off_9', t: d.current.time, type: '镜头外事件', target: '镇子', desc: '沈姨的账本上记过你半个多月' });
  const v = RT.validateUpdates(d, [spawn({ cause: '北边打仗，来了个逃兵', causeRef: { kind: 'ledger', id: 'led_off_9' } })], {}, {});
  ok(v.allowed.length === 0, '★ 锚存在、但 cause 和它说不到一块 -> 拒（拦"乱指"）');
  ok(/说不到一块去/.test(v.errors.join('|')), '拒绝理由点明了是"说不到一块去"');

  const d2 = mk();
  const someone = Object.keys(d2.entities).find(k => k !== 'player');
  const v2 = RT.validateUpdates(d2, [spawn({ cause: '一个陌生人自己走来的', causeRef: { kind: 'entity', id: someone } })], {}, {});
  ok(v2.allowed.length === 0, '★ 锚是实体、但 cause 里没提那个人的名字 -> 拒');
}

console.log('');
console.log('[4] 另外两条硬要求没被放松');
{
  const d = mk();
  d.ledger.push({ id: 'x1', t: d.current.time, type: '镜头外事件', target: '镇子', desc: '镇口来了个生面孔' });
  const v = RT.validateUpdates(d, [spawn({ causeRef: { kind: 'ledger', id: 'x1' }, relation: '' })], {}, {});
  ok(v.allowed.length === 0 && /relation/.test(v.errors.join('|')), 'relation 仍然是硬要求');
  const v2 = RT.validateUpdates(d, [spawn({ causeRef: { kind: 'ledger', id: 'x1' }, spawn: {} })], {}, {});
  ok(v2.allowed.length === 0 && /spawn\.name/.test(v2.errors.join('|')), 'spawn.name 仍然是硬要求');
}

console.log('');
console.log('[5] 给规矩必须同时给工具（资料包里要有可引用的 id）');
{
  const aiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'ai.js'), 'utf8');
  ok(/镜头外近况\(你不在场时发生的\)'[\s\S]{0,220}l\.id/.test(aiSrc),
    '★ 资料包的「镜头外近况」带上条目 **id**（否则 AI 看得见那些事、却拿不到可引用的东西）');
  ok(/causeRef/.test(aiSrc), '★ 提示词里写了 causeRef 的用法');
}

console.log('');
console.log('[6] ★ 上游用尽即拒（宽度也要有上限）');
{
  /* 没有上限的话，一个「北方战事」能造出无限个逃兵 —— 那比"空降一个"还假。 */
  const d = mk();
  d.beyond = [{ id: 'by_war2', what: '北方战事打输了', visible: 'secret', spawned: 2, cap: 2 }];
  const v = RT.validateUpdates(d, [spawn({ cause: '北方战事打输了，有人往南逃', causeRef: { kind: 'beyond', id: 'by_war2' } })], {}, {});
  ok(v.allowed.length === 0 && /已经用尽/.test(v.errors.join('|')), '★ 兑现满 cap -> 拒（否则一个战事造出无限逃兵）');

  const d2 = mk();
  d2.beyond = [{ id: 'by_w3', what: '北方战事打输了', visible: 'secret', spawned: 1, cap: 2 }];
  const v2 = RT.validateUpdates(d2, [spawn({ cause: '北方战事打输了，有人往南逃', causeRef: { kind: 'beyond', id: 'by_w3' } })], {}, {});
  ok(v2.allowed.length === 1, '★ 还没满 -> 过');
}

console.log('');
console.log('[7] 「世界上游」这一类真的接通了（契约 <-> 执行器 <-> 账本）');
{
  const C = require('../src/contract');
  const G = require('../src/game');
  ok(C.UPDATE_TYPE_NAMES.indexOf('世界上游') >= 0, '契约里有「世界上游」这一类');
  const d = mk();
  const n0 = (d.beyond || []).length;
  const applied = G.applyUpdates(d, [{ type: '世界上游', what: '北方战事，败局已定', yields: ['逃兵', '难民'], cap: 2 }], d.current.time);
  ok(applied === 1 && (d.beyond || []).length === n0 + 1, '★ 执行器能落库（beyond 多了一条）');
  ok(d.beyond[0] && d.beyond[0].cap === 2 && d.beyond[0].visible === 'secret', '默认 secret、cap 生效');
  ok((d.ledger || []).some(l => l.type === '世界上游'), '落账（可追溯）');
}

console.log('');
console.log('==== anchor-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
