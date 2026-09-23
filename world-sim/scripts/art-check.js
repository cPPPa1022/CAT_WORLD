// art-check.js — 场景底版 place.art 回归（v1.31）
// 用法: node scripts/art-check.js
// 断言「画是地点的持久底版 + 会随演出更新」，而不是「模板现拼 + 缓存冻结」。
'use strict';
const W = require('../src/world');
const P = require('../src/presentation');
const G = require('../src/game');

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  << ' + extra : '')); }
};
const mk = () => JSON.parse(JSON.stringify(W.buildDemoWorld()));
const artFn = (d) => (id) => G.viewName(d, id);
const locOf = (m, id) => { const k = (m.marks || []).find(x => x.id === id); return k || null; };
const forever = (until) => until || '2099-01-01T00:00:00';

// ---------- 1. 底版会落地并持久化 ----------
console.log("\n[1] 画存进地点（place.art）");
(function () {
  const d = mk(); const f = artFn(d); const pl = d.entities[d.current.sceneId];
  P.sceneModel(d, f);
  ok(!!pl.art, 'place.art 已写入地点实体');
  ok(pl.art.base && pl.art.base.length > 5, '底版有内容', pl.art && pl.art.base && pl.art.base.length);
  ok((pl.art.rev || 0) >= 1, 'rev 有初值', String(pl.art && pl.art.rev));
  ok(pl.art.schema === P.ART_SCHEMA, 'schema 版本标记存在');
})();

// ---------- 2. 底版被复用，不是每回合现拼 ----------
console.log("\n[2] 底版复用（rev 不涨）");
(function () {
  const d = mk(); const f = artFn(d); const pl = d.entities[d.current.sceneId];
  P.sceneModel(d, f); const r1 = pl.art.rev; const b1 = pl.art.base;
  P.sceneModel(d, f); P.sceneModel(d, f);
  ok(pl.art.rev === r1, '连续取画不重建底版', 'rev ' + r1 + ' -> ' + pl.art.rev);
  ok(pl.art.base === b1, '底版是同一个对象（复用）');
})();

// ---------- 3. 人物坐标会更新（旧实现的病） ----------
console.log("\n[3] 人物坐标随状态更新");
(function () {
  const d = mk(); const f = artFn(d); const sid = d.current.sceneId;
  const m1 = P.sceneModel(d, f);
  const before = locOf(m1, 'npc_1');
  ok(!!before, '沈姨初始在画里');
  ok(before && before.anchor === 'counter', '沈姨初始站柜台', before && before.anchor);
  d.entities['npc_1'].state.override = { reason: '蹲在门口', place: sid, until: forever() };
  const m2 = P.sceneModel(d, f);
  const after = locOf(m2, 'npc_1');
  ok(after && after.anchor === 'door', '改去门口后锚点跟着变', after && after.anchor);
  ok(m1.art !== m2.art, '画确实变了（旧实现画不动）');
})();

// ---------- 4. 格局变了会重建底版（旧指纹漏 layout 的 bug） ----------
console.log("\n[4] 格局变化触发重建");
(function () {
  const d = mk(); const f = artFn(d); const pl = d.entities[d.current.sceneId];
  const fpBefore = P.layoutFingerprint(d, f);
  P.sceneModel(d, f); const rev = pl.art.rev; const base = pl.art.base;
  pl.layout = { north: ['货架与柜台'], east: ['门'], south: ['窗'], west: ['墙'], floor: ['水泥地'] };
  const fpAfter = P.layoutFingerprint(d, f);
  ok(fpBefore !== fpAfter, '指纹能感知 layout（旧版感知不到）');
  const m = P.sceneModel(d, f);
  ok(pl.art.rev > rev, '底版被重建', rev + ' -> ' + pl.art.rev);
  ok(pl.art.base !== base, '底版换了新内容');
  ok(pl.art.sig.indexOf('水泥地') >= 0, '新格局进了签名');
})();

// ---------- 5. 锚点是稳定的（修 scanMarks 用 null 抹掉模板锚点） ----------
console.log("\n[5] 具名锚点齐全");
(function () {
  const d = mk(); const f = artFn(d);
  P.sceneModel(d, f); const mk2 = d.entities[d.current.sceneId].art.marks;
  for (const k of ['counter', 'door', 'desk', 'you']) {
    ok(Array.isArray(mk2[k]), '锚点存在: ' + k, JSON.stringify(mk2[k]));
  }
})();

// ---------- 6. 两个不同地点不再共用同一张画 ----------
console.log("\n[6] 地点之间不串图");
(function () {
  const d = mk(); const f = artFn(d);
  const s1 = P.sceneModel(d, f).art;
  d.entities.pl_9 = { id: 'pl_9', type: 'place', name: '街尾小卖部', tags: ['室内', '店铺'], features: ['冰柜', '柜台'], edges: [], state: {} };
  d.current.sceneId = 'pl_9';
  const s2 = P.sceneModel(d, f).art;
  ok(s1 !== s2, '换地点后画不同');
  ok(!!d.entities.pl_9.art, '新地点也有自己的底版');
  const same = s1.split(String.fromCharCode(10)).filter((x, i) => x === s2.split(String.fromCharCode(10))[i]).length;
  ok(same < s1.split(String.fromCharCode(10)).length, '两地点并非逐行相同', same + ' 行相同');
})();

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);