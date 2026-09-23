// updatetypes-check.js — 白名单 ⊆ 执行器 + 校验器四条（v1.84）
// 为什么有它：v1.84 之前 UPDATE_TYPES 有 19 类，其中 5 类**没有执行器**
// （校验器放行、运行时什么都不做、不报错不记账）—— AI 写了等于石沉大海，而没有任何断言守着。
// 这个脚本把"契约必须等于实现"钉死；顺带验校验器补上的四条（移动合法/锁定字段/时间一致/可见性）。
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
process.env.WORLD_SIM_DATA = process.env.WORLD_SIM_DATA || path.join(ROOT, '..', '.tmp-smoke', 'data-ut');
process.env.WORLD_SIM_ASSETS = process.env.WORLD_SIM_ASSETS || ROOT;
const fs = require('fs');
const { buildDemoWorld } = require(ROOT + '/src/world');
const { makeId } = require(ROOT + '/src/store');
const RT = require(ROOT + '/src/runtime');
const G = require(ROOT + '/src/game');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const mk = () => { const d = buildDemoWorld(); if (!d.id) d.id = makeId; return d; };

// ── 1. 白名单 ⊆ 执行器（对着源码扫，不靠人记）──
const src = fs.readFileSync(ROOT + '/src/game.js', 'utf8');
const body = src.slice(src.indexOf('function applyUpdates'), src.indexOf('// 存量清洗'));
const handled = new Set([...body.matchAll(/u\.type === '([^']+)'/g)].map(m => m[1]));
const types = RT.UPDATE_TYPES;
console.log('== 白名单 ⊆ 执行器 ==');
const orphan = types.filter(t => !handled.has(t));
ok(orphan.length === 0, '白名单 ' + types.length + ' 类全部有执行器' + (orphan.length ? ('；**没有执行器的**：' + orphan.join('/')) : ''));
ok(types.indexOf('时间推进') < 0, "删掉了 '时间推进'（时间归运行时）");
ok(types.indexOf('氛围变化') < 0, "删掉了 '氛围变化'（由 beats 的 ambient 承担）");
ok(handled.has('人物离开') && handled.has('物品消耗') && handled.has('物品转移'), '人物离开 / 物品消耗 / 物品转移 已有执行器');

// ── 2. 校验器四条 ──
console.log('');
console.log('== 校验器 ==');
const d1 = mk();
const frame = { beats: [{ type: 'dialogue', speaker: 'npc_1', text: '走吧' }] };
const V = (u) => RT.validateUpdates(d1, [u], frame, {});
ok(V({ type: '地点变化', to: 'pl_4', cause: '去买茶' }).allowed.length === 1, '有通路 + 带因果 → 放行');
ok(V({ type: '地点变化', to: 'pl_4' }).errors.some(e => /因果/.test(e)), '地点变化不带因果 → 拒绝');
ok(V({ type: '地点变化', to: '不存在的地方', cause: 'x' }).errors.some(e => /不存在/.test(e)), '目标不存在 → 拒绝');
ok(V({ type: '地点变化', to: 'pl_1', cause: 'x' }).errors.some(e => /就是当前所在/.test(e)), '目标=当前场景 → 拒绝');
ok(V({ type: '关系变化', target: 'npc_1', change: 8, cause: 'x' }).errors.some(e => /定性/.test(e)), '关系变化给数字 → 拒绝（无数值）');
ok(V({ type: '关系变化', target: 'npc_1', change: '更生分了', cause: '争执' }).allowed.length === 1, '定性描述 → 放行');
ok(V({ type: '印象更新', target: 'npc_1', note: 'x', field: 'locked' }).errors.some(e => /锁定字段/.test(e)), '触碰 locked 字段 → 拒绝');
ok(V({ type: '记忆新增', owner: 'npc_1', content: 'x', tags: ['冲突'], impact: 40, t: '2030-01-01T00:00:00' }).errors.some(e => /时间不一致/.test(e)), 'Update 自带离谱时间 → 拒绝');
ok(V({ type: '记忆新增', owner: 'npc_1', content: 'x', tags: ['冲突'], impact: 40, visible: 'whatever' }).errors.some(e => /可见性/.test(e)), "visible: 'whatever' → 拒绝");
ok(V({ type: '记忆新增', owner: 'npc_1', content: 'x', tags: ['冲突'], impact: 40, visible: 'pc-only' }).allowed.length === 1, 'visible: pc-only → 放行');

// ── 3. 新执行器真的改世界 ──
console.log('');
console.log('== 执行器实际效果 ==');
{
  const d = mk();
  const v = RT.validateUpdates(d, [{ type: '地点变化', to: 'pl_4', cause: '去买茶' }], frame, {});
  const t0 = d.current.time;
  G.applyUpdates(d, v.allowed, d.current.time);
  ok(d.current.sceneId === 'pl_4', 'AI 让玩家移动 → 场景真的变了（' + d.current.sceneId + '）');
  ok(new Date(d.current.time) > new Date(t0), '移动消耗了时间（' + t0.slice(11, 16) + ' → ' + d.current.time.slice(11, 16) + '）');
  ok((d.knowledge.knownPlaces || []).indexOf('pl_4') >= 0 && (d.knowledge.visited || []).indexOf('pl_4') >= 0, '去过/知道的地方都记上了');
}
{
  const d = mk();
  d.entities.player.inventory.push({ id: 'it_x', name: '一包瓜子' });
  G.applyUpdates(d, [{ type: '物品消耗', item: '瓜子' }], d.current.time);
  ok(!d.entities.player.inventory.some(x => x.name === '瓜子'), '物品消耗 → 背包里真的没了');
  const d2 = mk();
  G.applyUpdates(d2, [{ type: '物品转移', item: '一张车票', to: 'player', cause: '他塞给你' }], d2.current.time);
  ok(d2.entities.player.inventory.some(x => x.name === '一张车票'), '物品转移(收下) → 进背包');
  G.applyUpdates(d2, [{ type: '物品转移', item: '一张车票', to: 'npc_1', cause: '检票' }], d2.current.time);
  ok(!d2.entities.player.inventory.some(x => x.name === '一张车票'), '物品转移(给出) → 出背包');
}
{
  const d = mk();
  G.applyUpdates(d, [{ type: '人物离开', target: 'npc_1', cause: '打烊回家' }], d.current.time);
  const npc = d.entities.npc_1;
  ok(!!npc.state.override && npc.state.override.place !== 'pl_1', '人物离开 → 写了日程覆盖（去向 ' + (npc.state.override || {}).place + '）');
  RT.tickNPCs(d, RT.addMinutes(d.current.time, 60));
  ok(npc.state.location === npc.state.override.place, '★ 下一回合 tickNPCs **没有**把人拽回日程（覆盖生效）');
}
console.log('');
console.log('PASS=' + pass + ' FAIL=' + fail);
process.exitCode = fail ? 1 : 0;
