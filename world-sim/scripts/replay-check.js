// replay-check.js — 账本重放的对账断言（v1.86）
// 设计总稿 §3 曾写"实体的当前状态 = 最近记录重放"，而全项目从未实现 → 不变量是空的（M1）。
// v1.86 把它兑现到一个**明确划界的子集**（sceneId / memories / relations），本脚本守住它：
//   ① 走一条混合序列后，"重放结果"必须等于"内存状态"
//   ② 内存被偷偷改、账本没记 → 对账必须发现（否则这个检查本身也是空的）
'use strict';
const path = require('path'), os = require('os'), fs = require('fs');
const TMP = path.join(os.tmpdir(), 'ws-replay-' + Date.now());
process.env.WORLD_SIM_DATA = TMP; fs.mkdirSync(TMP, { recursive: true });
const { buildDemoWorld } = require('../src/world');
const { makeId } = require('../src/store');
const RT = require('../src/runtime');
const G = require('../src/game');
const REPLAY = require('../src/replay');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
console.log('');
console.log('账本重放（可重放子集：sceneId / memories / relations）');

const d = buildDemoWorld();
if (!d.id) d.id = makeId;
const frame = { beats: [{ type: 'dialogue', speaker: 'npc_1', text: '走吧' }] };
const ups = [
  { type: '记忆新增', owner: 'npc_1', content: '他答应了明天见面', tags: ['约定'], impact: 55, visible: 'scene', target: 'npc_1' },
  { type: '关系变化', target: 'npc_1', change: '熟络了些', cause: '聊开了' },
  { type: '地点变化', to: 'pl_4', cause: '去买茶' }
];
const v = RT.validateUpdates(d, ups, frame, {});
ok(v.allowed.length >= 3, '三条 Update 都通过了校验（' + v.allowed.length + '）');
G.applyUpdates(d, v.allowed, d.current.time);

const r = REPLAY.check(d);
ok(r.ok, '重放结果 == 内存状态' + (r.diff.length ? ('：' + JSON.stringify(r.diff)) : ''));
ok(r.count.memories === 1, '重放出 1 条记忆（' + r.count.memories + '）');
ok(r.count.relations === 1, '重放出 1 条关系（' + r.count.relations + '）');
ok(r.steps >= 3, '账本推进了 ' + r.steps + ' 步');
ok(d.current.sceneId === 'pl_4', '内存里场景确实变了：' + d.current.sceneId);

// 反证：内存改了、账本没记 → 必须被发现
d.relations.player.npc_1.tone = '生分';
const r2 = REPLAY.check(d);
ok(!r2.ok && r2.diff.some(x => /关系不一致/.test(x)), '账本与内存不一致时会被抓出来：' + JSON.stringify(r2.diff));

// 反证：记忆被删而账本还在 → 必须被发现
d.relations.player.npc_1.tone = '熟络了些';
const mid = Object.keys(REPLAY.replay(d).memories)[0];   // 账本里记着的那条（不是随便第一条）
delete d.memories[mid];
const r3 = REPLAY.check(d);
ok(!r3.ok && r3.diff.some(x => /记忆丢失/.test(x)), '记忆丢失会被抓出来：' + JSON.stringify(r3.diff));
console.log('');
console.log('==== replay-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
