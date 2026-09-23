'use strict';
// rel-check.js — 关系线验证：导入卡的 rel/bond → relations/impressions/actor包线索
const fs = require('node:fs');
const path = require('node:path');
const IMP = require('../src/import');
(async () => {
  const dir = path.join(process.env.USERPROFILE || 'C:\\Users\\qwe', 'Desktop', '角色卡');
  const buf = fs.readFileSync(path.join(dir, '0.85.png'));
  const card = IMP.parseSource('png', buf.toString('base64'));
  const pack = IMP.heuristicPack(card);
  const data = IMP.packToData(pack);
  for (const nid of Object.keys(data.relations)) {
    if (nid === 'player') continue;
    const rel = (data.relations.player || {})[nid] || {};
    const imp = (data.impressions || {})[nid] || {};
    console.log(nid, '| tone=' + String(rel.tone), '| stage=' + imp.stage, '| bonds=' + (imp.bonds || []).join(','));
  }
  // actor 包线索（模拟 scheduler 的组装）
  const npc = Object.values(data.entities).find(e => e.type === 'person' && e.id !== 'player');
  const relTone = ((data.relations && data.relations.player && data.relations.player[npc.id]) || {}).tone;
  console.log('actor 关系行 =>', '关系：' + relTone + '（你与这名玩家：认识多久/什么关系，说话语气由此定）');
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(2); });