'use strict';
const fs = require('node:fs');
const path = require('node:path');
const IMP = require('../src/import');
(async () => {
  const dir = path.join(process.env.USERPROFILE || 'C:\\Users\\qwe', 'Desktop', '角色卡');
  for (const f of ['0.85.png', '07c8904ab2ccb380.png', '100.png']) {
    const buf = fs.readFileSync(path.join(dir, f));
    const card = IMP.parseSource('png', buf.toString('base64'));
    const scan = await IMP.scanCard(card, { llm: { baseURL: '', apiKey: '', model: '' } });
    const pk = scan.pack;
    const data = IMP.packToData(pk);
    console.log('=== ' + f + ' ===');
    console.log('  卡名=' + card.name.slice(0, 18) + ' | spec(v3字段库)= phi:' + card.phi.slice(0, 8) + (card.userPersona ? ' UP:' + card.userPersona.slice(0, 10) : '') + ' talk:' + card.talkativeness + ' worldExt:' + card.worldExt.slice(0, 6));
    console.log('  世界书条目=' + Object.keys(data.worldinfo || {}).length + ' | 规则数=' + (data.meta.rules || []).length + ' | 规则前2=' + (data.meta.rules || []).slice(0, 2).map(r => r.slice(0, 30)).join(' | '));
    const idn = ((data.entities.player.profile || {}).identity || {});
    console.log('  玩家身份=' + String(idn.身份 || '').slice(0, 26));
  }
})();
