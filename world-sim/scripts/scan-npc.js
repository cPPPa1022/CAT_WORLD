'use strict';
(async () => {
  const B = 'http://127.0.0.1:3886';
  const post = (p, b) => fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(r => r.json());
  const demo = await post('/api/demo', {});
  const view = demo.view;
  const hits = [];
  (function walk(v, path) {
    if (typeof v === 'string') { if (v.indexOf('npc_1') >= 0 || v.indexOf('npc_2') >= 0) hits.push(path + ' = ' + v.slice(0, 80)); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, path + '[' + i + ']')); return; }
    if (v && typeof v === 'object') { for (const k of Object.keys(v)) walk(v[k], path + '.' + k); }
  })(view, 'view');
  console.log('==== 含 npc_1/npc_2 的字段 ====');
  console.log(hits.join('\n') || '(无)');
  // 关键字段抽查
  console.log('cast=', JSON.stringify(view.cast));
  console.log('interacts labels=', JSON.stringify(view.interacts.map(x => ({ id: x.id, label: x.label }))));
  console.log('log.shadows=', JSON.stringify(view.log.shadows));
  await post('/api/quit', {});
})().catch(e => { console.error(e); process.exit(1); });
