// conflict-produce-check.js — 冲突**产生端**必须真的会响（v1.97）
// 为什么有它：X1 修好的是"冲突**处理**端"（回灌/保守发布）。但如果 `GATE.conflicts` 永远返回空，
// 那半条链仍然是假的 —— 变成另一种"假强壮"。所以本脚本对**六条规则逐条造冲突**，
// 断言它们真的会响，并且干净输入不误报。
// 顺带守住用户 2026-09 报案的那条症状：**不在场的人在动** → 必须报 kind='位置'。
'use strict';
const path = require('path'), os = require('os'), fs = require('fs');
const TMP = path.join(os.tmpdir(), 'ws-conflict-' + Date.now());
process.env.WORLD_SIM_DATA = TMP; fs.mkdirSync(TMP, { recursive: true });
const ROOT = path.join(__dirname, '..');
process.env.WORLD_SIM_ASSETS = ROOT;
const { buildDemoWorld } = require(ROOT + '/src/world');
const { makeId } = require(ROOT + '/src/store');
const GATE = require(ROOT + '/src/gate');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const mk = () => { const d = buildDemoWorld(); if (!d.id) d.id = makeId; d.impressions = {}; d.knowledge.knownPeople = []; d.manifest = { v: 1, items: [], counts: {} }; delete d.unknown; return d; };
const kinds = (cs) => cs.map(c => c.kind).join(',');
console.log('');
console.log('冲突产生端：六条规则逐条必须会响');

// ① 生死
{
  const d = mk();
  d.entities.npc_2.state.alive = false;
  const cs = GATE.conflicts(d, [], { beats: [{ type: 'dialogue', speaker: 'npc_2', text: '我回来了' }] }, {});
  ok(cs.some(c => c.kind === '生死'), '① 已故者开口 → 报「生死」（' + kinds(cs) + '）');
}
// ② 位置 —— 就是用户报案的"不在场的人在动"
{
  const d = mk();
  d.entities.npc_2.state.location = 'pl_4';          // 他在别处
  const cs = GATE.conflicts(d, [], { beats: [{ type: 'dialogue', speaker: 'npc_2', text: '我进来坐坐' }] }, {});
  ok(cs.some(c => c.kind === '位置'), '② ★ 不在场的人在本场景说话 → 报「位置」（' + kinds(cs) + '）');
  const cs2 = GATE.conflicts(d, [], { beats: [{ type: 'action', actor: 'npc_2', text: '他推门进来' }] }, {});
  ok(cs2.some(c => c.kind === '位置'), '② 用 actor 写也一样被抓（' + kinds(cs2) + '）');
}
// ③ 门控（这条同时验证 v1.97 的 secret 档修复真的连到了输出侧）
{
  const d = mk();
  d.entities.npc_2.name = '独门秘境癸';
  d.impressions.npc_2 = { stage: 0, seen: '', traits: [], notes: [], bonds: [], nameKnown: '独门秘境癸' };  // 空档 = 没见过
  const cs = GATE.conflicts(d, [], { beats: [{ type: 'narration', text: '独门秘境癸站在门口，看了你一眼' }] }, {});
  ok(cs.some(c => c.kind === '门控'), '③ ★ 画面里出现玩家不该知道的名字 → 报「门控」（' + kinds(cs) + '）');
  d.impressions.npc_2 = { stage: 2, seen: '背着帆布工具袋', traits: [], notes: [], bonds: [], nameKnown: '独门秘境癸' };
  const cs2 = GATE.conflicts(d, [], { beats: [{ type: 'narration', text: '独门秘境癸站在门口，看了你一眼' }] }, {});
  ok(!cs2.some(c => c.kind === '门控'), '③ 认识之后不再报（不误报）');
}
// ④ 时间
{
  const d = mk();
  const cs = GATE.conflicts(d, [{ type: '记忆新增', owner: 'npc_1', t: '1990-01-01T00:00:00' }], {}, {});
  ok(cs.some(c => c.kind === '时间'), '④ Update 自带的时间早于当前 → 报「时间」（' + kinds(cs) + '）');
}
// ⑤ 撞车
{
  const d = mk();
  d.manifest.items.push({ t: d.current.time, turn: d.current.turnN, kind: '文档', name: '一封家书', id: 'doc_x' });
  const cs = GATE.conflicts(d, [{ type: '文档出现', title: '一封家书', body: '正文正文正文' }], {}, {});
  ok(cs.some(c => c.kind === '撞车'), '⑤ 同一份文书短期重复登记 → 报「撞车」（' + kinds(cs) + '）');
}
// ⑥ 引用 unknown 箱
{
  const d = mk();
  d.unknown = [{ what: '某块不认识的东西', why: '引擎不认识' }];
  const cs = GATE.conflicts(d, [{ type: '印象更新', target: '某块不认识的东西', note: 'x' }], {}, {});
  ok(cs.some(c => c.kind === '引用'), '⑥ 引用 unknown 箱里的东西 → 报「引用」（' + kinds(cs) + '）');
}
// 干净输入不误报
{
  const d = mk();
  d.impressions.npc_1 = { stage: 4, seen: '腰间别着钥匙', traits: [], notes: [], bonds: [], nameKnown: '沈姨' };
  const cs = GATE.conflicts(d, [{ type: '记忆新增', owner: 'npc_1', t: d.current.time }], { beats: [{ type: 'dialogue', speaker: 'npc_1', text: '要死咯' }] }, {});
  ok(cs.length === 0, '★ 干净输入零误报（实际 ' + kinds(cs) + '）');
}
// 回灌载荷可用
{
  const cs = [{ kind: '位置', why: '某人不在场', ref: 'npc_2', fix: '改成电话里' }];
  const txt = GATE.render(cs);
  ok(/冲突回执/.test(txt) && /位置/.test(txt) && /只改这几处/.test(txt), '★ render(cs) 产出的回灌指令可用（' + String(txt).length + ' 字）');
}
// 链两端真的接上了（静态）
{
  const gm = fs.readFileSync(path.join(ROOT, 'src', 'game.js'), 'utf8');
  const blanked = gm.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '');
  ok(/GATE\.conflicts\(/.test(blanked), 'game.js 调用了 GATE.conflicts（产生端）');
  ok(/content: GATE\.render\(cs\)/.test(blanked), '★ 冲突被 render 成回灌指令并 push 进 messages（处理端）');
  const i = blanked.indexOf('GATE.conflicts('), j = blanked.indexOf('GATE.render(cs)');
  ok(i > 0 && j > i, '顺序正确（先检冲突、再回灌）');
  ok(!/const messages = \[/.test(blanked), '★ messages 不是块内 const（X1 不许回来）');
}
console.log('');
console.log('==== conflict-produce-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
