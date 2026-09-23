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
const mk = () => JSON.parse(JSON.stringify(W.buildDemoWorld()));
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
  const v1 = RT.validateUpdates(d1, [spawn({ causeRef: { kind: 'ledger', id: 'led_off_1' } })], {}, {});
  ok(v1.allowed.length === 1, '★ 锚 = 一条已有的「镜头外事件」-> 过（**玩家可能从没见过它**，这是伏笔）');

  const d2 = mk();
  const someone = Object.keys(d2.entities).find(k => k !== 'player');
  const v2 = RT.validateUpdates(d2, [spawn({ causeRef: { kind: 'entity', id: someone } })], {}, {});
  ok(v2.allowed.length === 1, '★ 锚 = 一个已有实体 -> 过（"周师傅带来的"）');

  const d3 = mk();
  d3.beyond = [{ id: 'by_war', what: '北方战事，败局已定', visible: 'secret' }];
  const v3 = RT.validateUpdates(d3, [spawn({ causeRef: { kind: 'beyond', id: 'by_war' } })], {}, {});
  ok(v3.allowed.length === 1, '★ 锚 = 世界上游事实 -> 过（更远的因，玩家永远够不到）');
}

console.log('');
console.log('[4] 另外两条硬要求没被放松');
{
  const d = mk();
  d.ledger.push({ id: 'x1', t: d.current.time, type: '镜头外事件', target: '镇子', desc: 'x' });
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
console.log('==== anchor-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
