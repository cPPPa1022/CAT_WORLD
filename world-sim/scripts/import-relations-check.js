'use strict';
/* import-relations-check.js —— v2.06：把这一批"静默丢数据"的 bug 各钉一根柱子
 *
 * 存在的理由：这一批修的问题全都有同一个形状 —— **代码跑得通、界面不报错、数据悄悄地没了**。
 * 例如角色卡里的 NPC↔NPC 关系（ties）一直在被整批丢弃：卡里的 id 在 canonicalizePack
 * 里被改成了 npc1/npc2，而 ties 里还写着原来的 id，于是 [data.entities[a]] 全部为假、统统 continue。
 * 这类问题**不会**有报错、不会有红测试，只有"这个世界的人互相不认识"这种模糊体感。
 * 所以这份脚本不测"函数返回了"，测的是"数据到底进没进世界"。
 *
 * 用法：node scripts/import-relations-check.js
 */
const path = require('path'), os = require('os'), fs = require('fs');
const TMP = path.join(os.tmpdir(), 'ws-importrel-' + Date.now());
process.env.WORLD_SIM_DATA = TMP; fs.mkdirSync(TMP, { recursive: true });
const ROOT = path.join(__dirname, '..');
process.env.WORLD_SIM_ASSETS = ROOT;
const IMP = require(ROOT + '/src/import');
const WG = require(ROOT + '/src/worldgen');
const SP = require(ROOT + '/src/savepack');
const MF = require(ROOT + '/src/manifest');
const RT = require(ROOT + '/src/runtime');
const DEG = require(ROOT + '/src/degraded');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };

/* 一张"带原始 id"的卡：npcs 用 c_xxx，ties 也用 c_xxx（这是扫描器实际会产出的形状）。 */
const mkPack = () => ({
  meta: { name: '雨巷', era: '九十年代', maxSeverity: 'L3', carries: { time: 'phone' } },
  player: { name: '阿游', age: '27', identity: '在外跑腿的', backstory: '刚回来' },
  places: [
    { id: 'c_shop', name: '杂货铺', tags: ['室内'] },
    { id: 'c_lane', name: '巷口', tags: ['室外'] }
  ],
  npcs: [
    { id: 'c_shen', name: '沈姨', role: '杂货铺老板娘', surface: '热情', home: 'c_shop', atStart: 'c_shop' },
    { id: 'c_yan', name: '阿岩', role: '搬运工', surface: '话少', home: 'c_lane', atStart: 'c_lane' }
  ],
  ties: [{ a: 'c_shen', b: 'c_yan', rel: '房东与租客', how: '阿岩租了她家的后屋', since: '两年了' }],
  firstScene: '你推开杂货铺的门。', seeds: [], rules: []
});

console.log('');
console.log('[A] NPC 之间的人际关系：卡里的原始 id 必须被映射，不能整批丢');
{
  const d = IMP.packToData(mkPack());
  const ids = Object.keys(d.entities).filter(id => d.entities[id].type === 'person' && id !== 'player');
  ok(ids.length === 2, '两个 NPC 都进了世界：' + ids.join(','));
  const a = ids[0], b = ids[1];
  const has = !!(d.relations[a] && d.relations[a][b]);
  ok(has, '★ 关系网真的建起来了（' + a + ' → ' + b + '）——修之前这里是空的（原始 id 对不上，被静默丢弃）');
  ok(has && d.relations[a][b].tone === '房东与租客', '关系内容照卡里写的落库：' + (has ? d.relations[a][b].tone : '(无)'));
  ok(has && d.relations[b][a] && d.relations[b][a].tone === '房东与租客', '双向都写（反查也有）');
  ok(has && /两年了/.test(d.relations[a][b].since || ''), 'since/how 一起带过来');
}

console.log('');
console.log('[B] 兼容：用映射后的 id 写 ties 也认（老存档 / 手工包）');
{
  const p = mkPack();
  p.ties = [{ a: 'npc1', b: 'npc2', rel: '旧识' }];
  const d = IMP.packToData(p);
  ok(!!(d.relations['npc1'] && d.relations['npc1']['npc2']), '用 npc1/npc2 也建得起来');
}

console.log('');
console.log('[C] 端点不存在：不写关系，但**要记一笔**（可查，不许静默）');
{
  DEG.reset();
  const p = mkPack();
  p.ties = [{ a: 'c_shen', b: 'c_ghost', rel: '谁' }];
  const d = IMP.packToData(p);
  const v = DEG.view();
  ok(!(d.relations['npc1'] && d.relations['npc1']['npc2']), '不存在的端点不会写出关系');
  ok(v.total >= 1 && JSON.stringify(v.top).indexOf('import.js:ties') >= 0,
    '★ 静默降级账里看得到这次丢弃：' + JSON.stringify(v.top));
}

console.log('');
console.log('[D] 自环（a === b）安静跳过，不抛错');
{
  const p = mkPack();
  p.ties = [{ a: 'c_shen', b: 'c_shen', rel: '自己' }];
  let threw = '';
  try { IMP.packToData(p); } catch (e) { threw = String(e.message || e); }
  ok(!threw, '不抛错' + (threw ? '（抛了：' + threw + '）' : ''));
}

console.log('');
console.log('[E] 玩家身份档案进世界生成提示词：不许是 [object Object]');
{
  const us = { name: '老徐', age: '41', identity: '跑长途的', ability: '修车', secret: '欠着债' };
  const t = WG.userSelfText ? WG.userSelfText(us) : '';
  const sys = WG.worldGenSystem(us);
  ok(t.indexOf('[object Object]') < 0, '档案文本里没有 [object Object]');
  ok(t.indexOf('老徐') >= 0 && t.indexOf('跑长途的') >= 0 && t.indexOf('欠着债') >= 0, '玩家填的值都在：' + t.slice(0, 90));
  ok(sys.indexOf('[object Object]') < 0, '★ 系统提示词里没有 [object Object]（修之前整份档案就是这个字符串）');
  ok(sys.indexOf('老徐') >= 0, '提示词里能看到玩家的名字');
  const sys2 = WG.worldGenSystem({});
  ok(sys2.indexOf('未填写自我设定') >= 0, '空档案走"由世界替你设计身份"那条分支');
  const sys3 = WG.worldGenSystem(null);
  ok(sys3.indexOf('未填写自我设定') >= 0, 'null 档案也不炸');
}

console.log('');
console.log('[F] savepack.scan 只读：不许改传入的世界对象');
{
  const world = { entities: {}, current: { time: '1996-06-14T08:00:00' }, meta: { name: 'x' }, framework: { level: 2 } };
  const before = JSON.stringify(world);
  let threw = '';
  try { SP.scan({ __save: {}, world: world }); } catch (e) { threw = String(e.message || e); }
  ok(!threw, 'scan 不抛错' + (threw ? '（抛了：' + threw + '）' : ''));
  ok(JSON.stringify(world) === before, '★ 传入的 world 一字未改（修之前 scan 会往 framework 上补 vocab/rules）');
}

console.log('');
console.log('[G] 自述文件：带了自定义 readme 就得用它');
{
  const world = { entities: {}, current: { time: '1996-06-14T08:00:00', turnN: 3 }, meta: { name: '雨巷', era: '九十年代' } };
  const p1 = SP.pack(world, { readme: '这是我自己写的自述' });
  ok(p1.readme === '这是我自己写的自述', '★ 自定义 readme 原样带走（修之前是空字符串）');
  const p2 = SP.pack(world, {});
  ok(typeof p2.readme === 'string' && p2.readme.indexOf('#') === 0, '不给 readme 时生成骨架');
}

console.log('');
console.log('[H] 生成清单渲染：框架视图缺字段不许炸');
{
  const world = { entities: {}, current: { time: '1996-06-14T08:00:00', turnN: 1 }, meta: { name: '雨巷' }, framework: { level: 1 } };
  let threw = '', txt = '';
  try { txt = MF.readmeSkeleton(world, ''); } catch (e) { threw = String(e.message || e); }
  ok(!threw, '缺 vocab/types/rules 也不抛错' + (threw ? '（抛了：' + threw + '）' : ''));
  ok(threw || /框架档位/.test(txt), '照样把"框架档位"写出来');
}

console.log('');
console.log('[I] 记忆写入：tags 缺失不许抛');
{
  /* 注意：writeMemory 默认 by='ai'，那条路会先过"记忆写入门"，没标签的内容直接被挡在门外
     （返回 gated，不抛错）—— 那样子根本走不到 dup 扫描，测不到我们要测的那一行。
     这里按引擎自写的身份调用（by='engine'），并且补上 id 工厂。 */
  const d = { id: (p) => p + '_' + Math.random().toString(36).slice(2, 8), entities: {}, current: { time: '1996-06-14T08:00:00' }, memories: {}, experience: [], ledger: [], meta: {}, knowledge: {} };
  let threw = '';
  try { RT.writeMemory(d, { owner: 'player', content: '没写 tags 的记忆', impact: 40, t: '1996-06-14T08:00:00' }, { by: 'engine' }); } catch (e) { threw = String(e.message || e); }
  ok(!threw, 'tags 缺失时照常写' + (threw ? '（抛了：' + threw + '）' : ''));
  ok(Object.keys(d.memories).length === 1, '记忆真的进库了');
}

console.log('');
console.log('[J] 地点写成**名字**（不是 id）也要认出来');
{
  const p = mkPack();
  p.npcs[1].home = '巷口';          // 名字，不是 id —— AI 实际最常这么写
  p.npcs[1].workPlace = '巷口';
  p.npcs[1].atStart = '巷口';
  const d = IMP.packToData(p);
  const yan = Object.values(d.entities).find(e => e.type === 'person' && e.name === '阿岩');
  const lane = Object.values(d.entities).find(e => e.type === 'place' && e.name === '巷口');
  ok(!!yan && !!lane, '人和地点都在');
  ok(yan && yan.state && yan.state.location === lane.id, '★ 落点解析成地点 id（修之前 canonicalizePack 会先把名字清成空串 → 人落到 p2）');
  ok(yan && yan._schedule && yan._schedule.home === lane.id, '家也解析成地点 id');
  ok(yan && yan._schedule && yan._schedule.work === lane.id, '工作地也解析成地点 id');
}

console.log('');
console.log('==== import-relations-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
