'use strict';
(async () => {
  const B = 'http://127.0.0.1:3886';
  const post = (p, b) => fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(r => r.json());
  await post('/api/demo', {});
  const t1 = await post('/api/turn', { text: '你好' });
  const t2 = await post('/api/turn', { text: '我想赊账' });
  const view = t2.view;
  const checks = {
    recalledRaw: JSON.stringify(t1.recalled || t2.recalled || []),
    sceneArt: view.sceneArt ? view.sceneArt.split('\n').slice(0, 3).join(' | ') : null,
    logRecalled: JSON.stringify((view.log || {}).recalled),
    logEvents: JSON.stringify((view.log || {}).events),
    meBonds: JSON.stringify((view.me || {}).bonds),
    people: JSON.stringify((view.people || []).map(p => ({ id: p.id, name: p.name }))),
    castFrom: JSON.stringify((view.msgs || []).map(m => ({ from: m.from, body: String(m.body || '').slice(0, 20) })))
  };
  for (const k of Object.keys(checks)) console.log(k + ' = ' + checks[k]);
  await post('/api/quit', {});
})().catch(e => { console.error(e); process.exit(1); });
