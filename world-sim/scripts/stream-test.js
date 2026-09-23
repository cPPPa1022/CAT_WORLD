'use strict';
const B = 'http://127.0.0.1:3885';
(async () => {
  const post = (p, b) => fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(r => r.json());
  const demo = await post('/api/demo', {});
  const resp = await fetch(B + '/api/turn/stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '你好' }) });
  const ct = resp.headers.get('content-type') || '';
  const text = await resp.text();
  console.log('[1] ct=' + ct.split(';')[0] + ' | 有view=' + (text.indexOf('"view"') >= 0) + ' | 有delta字段=' + (text.indexOf('"d"') >= 0) + ' | len=' + text.length);
  const t2 = await post('/api/turn', { text: '我看看窗外' });
  console.log('[2] turn intent=' + t2.intent.kind + ' | art=' + !!t2.view.sceneArt + ' | lastCalls=' + t2.view.stats.lastCalls);
  await post('/api/quit', {});
})().catch(e => { console.error(e); process.exit(1); });
