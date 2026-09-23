'use strict';
const G = require('../src/game');
const W = require('../src/world');
(async () => {
  const cfg = { llm: { baseURL: '', apiKey: '', model: '' } };
  const d = W.buildDemoWorld();
  // 1) 玩家发消息
  const s1 = await G.sendMessage(d, 'npc_1', '在吗？', cfg);
  console.log('[1] 发送后 status=', s1.status, '| 预计回复=', s1.view.msgReplyAt, '| pendingReplies=', (d.current.pendingReplies || []).length);
  // 2) 等 20 分钟 → 未到期（无回复、消息仍 sent）
  const t1 = await G.runTurn(d, '等20分钟', cfg);
  const msgsAfter = d.messages.filter(m => m.from !== 'player').slice(-1)[0];
  console.log('[2] +20min：最末对方消息=', msgsAfter ? (msgsAfter.body || '(无)') : '(无)', '| 玩家消息status=', d.messages.filter(m => m.from === 'player').slice(-1)[0].status, '| pending=', (d.current.pendingReplies || []).length);
  // 3) 再等 1 小时 → 到期：生成回复（演示=mock，'在吗'+烦躁→已读不回）
  const t2 = await G.runTurn(d, '等60分钟', cfg);
  const last = d.messages.filter(m => m.from === 'npc_1' && m.to === 'player').slice(-1)[0];
  console.log('[3] +80min：回复=', last ? JSON.stringify({ body: last.body, status: last.status, note: last.note, t: last.t.slice(11, 16) }) : '(无)', '| pending=', (d.current.pendingReplies || []).length, '| opLog=', t2.frame ? '(帧见下)' : '');
  console.log('[4] 场景日志尾=', d.sceneLog.slice(-2).map(l => l.text || '').join(' | ').slice(0, 90));
})();
