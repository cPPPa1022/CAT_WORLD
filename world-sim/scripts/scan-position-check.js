// scan-position-check.js — 扫描落点回归（v1.88）
// 用户 2026-09-16 报案：「人物 OOC、不在场的人物在动、动机乱」。
// 根因（实测那一局）：AI 老实按提示词把陈志远的 workPlace/atStart **留空**，
// 而 canonicalizePack 的兜底 `|| places[0].id` 把空值变成了 **p1 = 玩家家**
// ⇒ 他 08:00-21:00 被日程安排在玩家屋里 ⇒ present() 判他在场、真正在屋里的温若兰被判不在场。
// 这个脚本用**那张卡的真实形状**复现并守住。
'use strict';
const path = require('path'), os = require('os'), fs = require('fs');
const TMP = path.join(os.tmpdir(), 'ws-scanpos-' + Date.now());
process.env.WORLD_SIM_DATA = TMP; fs.mkdirSync(TMP, { recursive: true });
const ROOT = path.join(__dirname, '..');
process.env.WORLD_SIM_ASSETS = ROOT;
const IMP = require(ROOT + '/src/import');
const RT = require(ROOT + '/src/runtime');
const { present } = require(ROOT + '/src/store');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
console.log('');
console.log('扫描落点：别人不许被兜进"玩家的家"');

// 复刻那一局的 pack（places 顺序决定 id：第 1 个 = 玩家住的 502 室）
const mkPack = () => ({
  meta: { name: '十二号楼二单元', era: '现代都市', theme: 'terminal', maxSeverity: 'L3', carries: { time: 'phone' } },
  player: { name: '吟行', age: '26', identity: '远程接单的程序员', origin: '邻省小城来的', backstory: '刚搬来' },
  places: [
    { id: 'p1', name: '吟行的公寓（502室）', tags: ['室内', '家'] },
    { id: 'p2', name: '五层楼道', tags: ['室内'] },
    { id: 'p3', name: '温若兰的家（501室）', tags: ['室内', '家'] },
    { id: 'p4', name: '12号楼楼下院子', tags: ['室外'] },
    { id: 'p5', name: '阳光幼儿园门口', tags: ['室外'] }
  ],
  npcs: [
    { id: 'npc1', name: '温若兰', role: '501 室住户，陈志远的妻子', surface: '端庄温婉，客气有分寸', hidden: '压抑已久', home: 'p3', workPlace: 'p3', atStart: 'p3' },
    // ★ 这一条就是那一局的形状：AI 把 workPlace/atStart 留空（提示词要求"常年在外/无固定去处就留空"）
    { id: 'npc2', name: '陈志远', role: '区域销售经理，常在外跑', surface: '体贴顾家', hidden: '并不老实', home: 'p3', workPlace: '', atStart: '' },
    { id: 'npc3', name: '陈宇轩', role: '幼儿园小班', surface: '黏妈妈', hidden: '怕生', home: 'p3', workPlace: 'p5', atStart: 'p5' }
  ],
  firstScene: '你刚搬来，站在 502 门口。', alternates: [], seeds: [], rules: ['世界按自己的规则运转']
});

const d = IMP.packToData(mkPack(), { greeting: 0 });
const npcs = Object.values(d.entities).filter(e => e.type === 'person' && e.id !== 'player');
const byName = (n) => npcs.find(e => e.name === n);

ok(!!byName('陈志远'), '三个 NPC 都落库了');
const cy = byName('陈志远');
ok(cy && (cy.state || {}).location !== 'p1', '陈志远初始位置不是玩家家（' + (cy && (cy.state || {}).location) + '）');
ok(cy && ((cy._schedule || {}).work !== 'p1'), '陈志远的工作地点不再是玩家家（' + (cy && (cy._schedule || {}).work) + '）');
ok(cy && ((cy._schedule || {}).work === (cy._schedule || {}).home), '没给工作地 → 落在**他自己家**（' + (cy && (cy._schedule || {}).home) + '）');

// 到上班时间 tick 一次：谁都不该站在玩家家
RT.tickNPCs(d, '2024-05-16T09:30:00');
const inPlayerRoom = Object.values(d.entities).filter(e => e.type === 'person' && e.id !== 'player' && (e.state || {}).location === 'p1');
ok(inPlayerRoom.length === 0, '上班时间 tick 之后，玩家屋里没有别人（实际 ' + JSON.stringify(inPlayerRoom.map(e => e.name)) + '）');
ok(present(d, 'p1').filter(p => p.id !== 'player').length === 0, 'present(p1) 里只有玩家自己（剧情：开场你一个人在屋里）');

console.log('');
console.log('人物档案：人设锚与印象档不许是空壳');
const placeholder = npcs.filter(e => /导入时锁定|^性格内核[（(]/.test(String((e.locked || {}).core || '')));
ok(placeholder.length === 0, '每个 NPC 的性格内核都有内容（没有内容的：' + JSON.stringify(placeholder.map(e => e.name)) + '）');
ok(npcs.every(e => e.name && (e.locked || {}).core), '示例：' + (cy.locked.core || '').slice(0, 46));
const noImp = npcs.filter(e => !(d.impressions || {})[e.id]);
ok(noImp.length === 0, '**所有** NPC 都有印象档（缺档的：' + JSON.stringify(noImp.map(e => e.name)) + '）');
const away = Object.entries(d.impressions || {}).filter(([id]) => id !== 'player' && !npcs.some(e => e.id === id));
ok(away.length === 0, '印象档没有多余条目');

console.log('');
console.log('反证：AI 明说"在场"的人，必须真的在玩家所在处');
const pack2 = mkPack();
pack2.npcs[1].inScene = true;   // 陈志远明说在场
const d2 = IMP.packToData(pack2, { greeting: 0 });
const cy2 = Object.values(d2.entities).find(e => e.type === 'person' && e.name === '陈志远');
ok(cy2 && (cy2.state || {}).location === 'p1', '说了在场 → 落点被校正到玩家所在处（' + (cy2 && (cy2.state || {}).location) + '）');
ok(present(d2, 'p1').some(p => p.id === cy2.id), '并且真的进了 present(p1)');

console.log('');
console.log('==== scan-position-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
