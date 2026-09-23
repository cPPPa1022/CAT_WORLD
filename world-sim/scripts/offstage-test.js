'use strict';
const G = require('../src/game');
const W = require('../src/world');
(async () => {
  const cfg = { llm: { baseURL: '', apiKey: '', model: '' } };
  const d = W.buildDemoWorld();
  d.current.turnN = 6; // 下回合触发第7回合并发
  const r = await G.runTurn(d, '你好', cfg);
  const off = (d.ledger || []).filter(l => l.type === '镜头外事件');
  console.log('[1] 7回合触发镜头外事件数=', off.length, '| 内容=', off.slice(-1).map(l => l.desc).join(''));
  console.log('[2] opLog含镜头外=', String(r.frame ? '演示帧无oplog' : ''), '| ledger条数=', d.ledger.length);
  const npcMems = Object.values(d.memories).filter(m => m.tags && m.tags.indexOf('镜头外') >= 0);
  console.log('[3] 相关NPC记忆写入=', npcMems.map(m => m.owner + ':' + m.content.slice(0, 18)).join(' | '));
  const r2 = await G.runTurn(d, '谢谢你', cfg);
  console.log('[4] 第8回合再触发=', (d.ledger || []).filter(l => l.type === '镜头外事件').length, '(期望仍1)');
  console.log('[5] packetsim: 无 frame 报错即可', '| time=', d.current.time);
})();
