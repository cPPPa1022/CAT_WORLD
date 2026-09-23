'use strict';
const G = require('../src/game');
const W = require('../src/world');
const IMP = require('../src/import');
const WG = require('../src/worldgen');
function show(world, label, ids) {
  const out = ids.map(id => id + ' => ' + G.resolveSpeaker(world, id));
  console.log('[' + label + '] ' + out.join('  |  '));
}
const demo = W.buildDemoWorld();
show(demo, '演示世界(实体npc_1/npc_2)', ['npc1', 'npc_1', 'npc2', 'npc_2', '沈姨', 'player', 'npc9']);
const rand = IMP.packToData(WG.randomPack('九十年代 小城'));
const randIds = Object.values(rand.entities).filter(e => e.type === 'person').map(e => e.id);
show(rand, '随机组合世界(实体' + randIds.join('/') + ')', randIds.concat(['npc1', 'npc_1', 'npc2']));
const card = { name: '柳如烟', description: '街边小店老板娘', first_mes: '你推门进来' };
const imp = IMP.packToData(IMP.heuristicPack(card));
show(imp, '导入卡世界(柳如烟)', ['npc1', 'npc_1', '柳如烟', 'player']);
console.log('--- 演示世界 mockMain 说话的 speaker ---');
const cfg = { llm: { baseURL: '', apiKey: '', model: '' } };
(async () => {
  const r = await G.runTurn(demo, '你好', cfg);
  const dBeat = (r.frame.beats || []).find(b => b.type === 'dialogue');
  console.log('mock speaker id =', dBeat && dBeat.speaker, '→ 场景日志显示 =', r.view.sceneLog.slice(-4).map(l => l.speaker).filter(Boolean).join(','));
})();
