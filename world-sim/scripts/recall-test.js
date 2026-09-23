'use strict';
// 身世回想冒烟（真字符版本，避免控制台编码坑）
const W = require('../src/world');
const G = require('../src/game');
(async () => {
  const cfg = { llm: { baseURL: '', apiKey: '', model: '' } };
  const d = W.buildDemoWorld();
  let r;
  r = await G.runTurn(d, '你好', cfg);
  console.log('[1] 你好 → recalls:', JSON.stringify(r.recalled.map(x => x.id)));
  r = await G.runTurn(d, '我想赊账', cfg);
  console.log('[2] 我想赊账 → recalls:', JSON.stringify(r.recalled.map(x => x.id)), '| hint:', (r.recalled[0] || {}).hint);
  r = await G.runTurn(d, '我听会儿收音机', cfg);
  console.log('[3] 听收音机 → recalls:', JSON.stringify(r.recalled.map(x => x.id)));
  r = await G.runTurn(d, '阿岩到底是谁', cfg);
  console.log('[4] 阿岩是谁 → recalls:', JSON.stringify(r.recalled.map(x => x.id)));
  console.log('[5] log: known=' + r.view.log.known.length + ' shadows=' + r.view.log.shadows.length + ' recalled=' + r.view.log.recalled.length + ' events=' + r.view.log.events.length);
})();
