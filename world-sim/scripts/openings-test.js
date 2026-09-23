'use strict';
const fs = require('node:fs');
const path = require('node:path');
const IMP = require('../src/import');
(async () => {
  const dir = path.join(process.env.USERPROFILE || 'C:\\Users\\qwe', 'Desktop', '角色卡');
  const buf = fs.readFileSync(path.join(dir, '07c8904ab2ccb380.png'));
  const card = IMP.parseSource('png', buf.toString('base64'));
  console.log('[1] 卡备选开局=', (card.alternates || []).length, '| 主开场=', card.first_mes.slice(0, 18));
  const scan = await IMP.scanCard(card, { llm: { baseURL: '', apiKey: '', model: '' } });
  const d0 = IMP.packToData(scan.pack);
  console.log('[2] 默认(0) usedGreeting=', String(d0.meta.usedGreeting || '').slice(0, 20));
  const dl = IMP.packToData(scan.pack, { greeting: (d0.meta.greetings || []).length - 1 });
  console.log('[3] 主开场 usedGreeting=', String(dl.meta.usedGreeting || '').slice(0, 20));
  const dx = IMP.packToData(scan.pack, { greeting: 99 });
  console.log('[4] 越界用=最后一条(主开场)=', String(dx.meta.usedGreeting || '').slice(0, 20) === String(dl.meta.usedGreeting || '').slice(0, 20));
  const da = IMP.packToData(scan.pack, { greeting: 0 });
  console.log('[5] 第一条(备用0) 首帧=', (da.sceneLog.find(l => l.type === 'narration') || {}).text.slice(0, 20), '| 与主开场不同=', String(da.meta.usedGreeting || '').slice(0, 20) !== String(dl.meta.usedGreeting || '').slice(0, 20));
})();