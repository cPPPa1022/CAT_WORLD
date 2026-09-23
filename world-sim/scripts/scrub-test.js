'use strict';
const G = require('../src/game');
const W = require('../src/world');
(async () => {
  const d = W.buildDemoWorld();
  d.sceneLog.push({ t: d.current.time, type: 'dialogue', speaker: 'npc1', tone: '缓和', text: '（脏数据模拟）' });
  const cfg = { llm: { baseURL: '', apiKey: '', model: '' } };
  const r = await G.runTurn(d, '你好', cfg);
  const dirty = r.view.sceneLog.filter(l => l.text === '（脏数据模拟）')[0];
  console.log('清洗后脏行 speaker =', JSON.stringify(dirty && dirty.speaker));
})();
