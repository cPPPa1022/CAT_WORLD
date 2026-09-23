'use strict';
const G = require('../src/game');
const W = require('../src/world');
(async () => {
  const cfg = { llm: { baseURL: '', apiKey: '', model: '' } };
  const d = W.buildDemoWorld();
  const r = await G.runTurn(d, '你好', cfg);
  console.log('=== 输入：你好 ===');
  for (const b of (r.frame.beats || [])) console.log('[' + b.type + '] ' + (b.text || ''));
  console.log('-- 限制检查 --');
  const all = JSON.stringify(r.frame);
  console.log('出现"你说："/"你说:"=', /你说[：:]/.test(all) ? '是(违规)' : '否(OK)');
  console.log('beats 数量=', (r.frame.beats || []).length);
  const r2 = await G.runTurn(d, '我想赊账', cfg);
  console.log('=== 输入：我想赊账 ===');
  for (const b of (r2.frame.beats || [])) console.log('[' + b.type + '] ' + (b.text || ''));
  console.log('回想=', JSON.stringify(r2.recalled.map(x => x.id)), '(期待 j_shenyi)');
})();
