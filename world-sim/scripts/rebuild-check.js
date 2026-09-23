// rebuild-check.js — 账本重建（v1.87）
// M2 的第二半：上一步只能"对账"（发现问题），这一步要能**按账本修回去**。
// 边界：只动"账本才有权威"的三样（sceneId / memories / relations）；账本里没有的一律不动
// （账本自己会被留存裁剪，裁剪区间里的老记忆不该被重建抹掉）。
'use strict';
const path = require('path'), os = require('os'), fs = require('fs');
const TMP = path.join(os.tmpdir(), 'ws-rebuild-' + Date.now());
process.env.WORLD_SIM_DATA = TMP; fs.mkdirSync(TMP, { recursive: true });
const { buildDemoWorld } = require('../src/world');
const { makeId } = require('../src/store');
const RT = require('../src/runtime');
const G = require('../src/game');
const REPLAY = require('../src/replay');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
console.log('');
console.log('账本重建（发现不一致 → 按账本修回去）');

const d = buildDemoWorld();
if (!d.id) d.id = makeId;
const frame = { beats: [{ type: 'dialogue', speaker: 'npc_1', text: '走吧' }] };
const v = RT.validateUpdates(d, [
  { type: '记忆新增', owner: 'npc_1', content: '他答应了明天见面', tags: ['约定'], impact: 55, visible: 'scene', target: 'npc_1' },
  { type: '关系变化', target: 'npc_1', change: '熟络了些', cause: '聊开了' },
  { type: '地点变化', to: 'pl_4', cause: '去买茶' }
], frame, {});
G.applyUpdates(d, v.allowed, d.current.time);
ok(REPLAY.check(d).ok, '重建前：账本与内存一致');

// 制造三类损坏（模拟"AI 犯病把存档搞坏"/外部工具乱写）
const mid = Object.keys(REPLAY.replay(d).memories)[0];
d.memories[mid].content = '（被人改过了）';
d.relations.player.npc_1.tone = '仇人';
d.current.sceneId = 'pl_1';
const bad = REPLAY.check(d);
ok(bad.ok === false && bad.diff.length >= 3, '三处损坏都被对账发现：' + JSON.stringify(bad.diff));

const rb = REPLAY.rebuild(d);
ok(rb.applied.memories >= 1 && rb.applied.relations >= 1 && rb.applied.sceneId === 1, '重建动作：' + JSON.stringify(rb.applied));
ok(rb.check.ok === true, '重建后对账通过' + (rb.check.diff.length ? ('：' + JSON.stringify(rb.check.diff)) : ''));
ok(d.memories[mid].content === '他答应了明天见面', '记忆内容被按账本改回：' + d.memories[mid].content);
ok(d.relations.player.npc_1.tone === '熟络了些', '关系被按账本改回：' + d.relations.player.npc_1.tone);
ok(d.current.sceneId === 'pl_4', '场景被按账本改回：' + d.current.sceneId);

// 边界：账本里没有的东西不许被"重建"抹掉
const before = Object.keys(d.memories).length;
d.memories['mem_off_book'] = { id: 'mem_off_book', owner: 'npc_1', content: '账本裁剪之前的老记忆', tags: [], impact: 40, weight: 40, t: '', lastActivation: '', activations: 1, repeat: false };
REPLAY.rebuild(d);
ok(d.memories['mem_off_book'] && Object.keys(d.memories).length === before + 1, '账本里没有的老记忆**没被抹掉**（边界正确）');

console.log('');
console.log('==== rebuild-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
