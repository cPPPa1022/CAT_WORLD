'use strict';
const S = require('../src/scheduler');
const data = { id: (p) => p + '__x1', current: { sceneId: 'p1', time: '2026-05-21T20:00:00', imgTasks: [] }, entities: { p1: { name: '练功房' }, npc1: { name: '莎夏', state: { mood: '娇媚' }, profile: { visual: { anchor: '脸型瓜子，眼宽:眼高≈3:1，金发120cm，蓝瞳，146cm，白薄纱裙', dynamic: {} } } } }, knowledge: { knownPeople: ['npc1'] }, meta: { era: '现代日本' } };
(async () => {
  const r = await S.dispatch(data, { image: {} }, 'image', { img: { who: ['npc1'], state: '娇媚，眼尾微眯', scene: '练功房', note: '午后光' } });
  const t = (data.current.imgTasks || [])[0];
  console.log('ok?', !!t, '| status=' + (t && t.status));
  console.log('prompt=' + (t && String(t.prompt).slice(0, 180)));
  process.exit(0);
})().catch(e => { console.error('E', e.message); process.exit(2); });
