'use strict';
// card-vs-world.js — 对比卡原设 vs 软件启发式扫描产物 vs 玩家视角
const fs = require('node:fs');
const path = require('node:path');
const IMP = require('../src/import');
(async () => {
  const dir = path.join(process.env.USERPROFILE || 'C:\\Users\\qwe', 'Desktop', '角色卡');
  const f = process.argv[2] || 'a9492de01478ca73.png';
  const card = IMP.parseSource('png', fs.readFileSync(path.join(dir, f)).toString('base64'));
  console.log('========== 卡原设 ==========');
  console.log('卡名:', card.name);
  console.log('description:', String(card.description || '').slice(0, 500));
  console.log('personality:', String(card.personality || '').slice(0, 400));
  console.log('scenario:', String(card.scenario || '').slice(0, 300));
  console.log('first_mes:', String(card.first_mes || '').slice(0, 400));
  const wb = card.character_book && Array.isArray(card.character_book.entries) ? card.character_book.entries : [];
  console.log('世界书条目:', wb.length, wb.slice(0, 6).map(e => (e.keys || []).join('|') + '→' + String(e.content || '').slice(0, 60)).join(' ; '));
  console.log('========== 启发式扫描产物 ==========');
  const pack = IMP.heuristicPack(card);
  console.log('meta:', JSON.stringify(pack.meta));
  console.log('places:', (pack.places || []).map(p => p.name).join('/'));
  for (const n of (pack.npcs || [])) console.log('NPC骨架:', JSON.stringify({ id: n.id, name: n.name, surface: n.surface, roll: n.role, desire: n.desire, rel: n.rel, bond: n.bond }));
  console.log('玩家身份: ', pack.player && pack.player.identity);
  console.log('世界规则: ', JSON.stringify(pack.rules || []));
  console.log('seeds: ', JSON.stringify((pack.seeds || []).slice(0, 3)));
  console.log('========== 世界（packToData）==========');
  const data = IMP.packToData(pack);
  for (const id of Object.keys(data.entities)) {
    const e = data.entities[id];
    if (e.type !== 'person' || id === 'player') continue;
    console.log('— ' + e.name + ' 档案:');
    console.log('  identity:', JSON.stringify(e.profile.identity));
    console.log('  surface.待人:', e.profile.surface.待人);
    console.log('  background.经历:', String(e.profile.background.经历 || '').slice(0, 150));
    console.log('  locked:', e.locked.core);
    const rel = (data.relations.player || {})[id] || {};
    console.log('  玩家关系:', rel.tone);
    const imp = data.impressions[id] || {};
    console.log('  玩家印象:', JSON.stringify({ stage: imp.stage, seen: imp.seen, bonds: imp.bonds }));
    console.log('  玩家可见知识(knownPeople):', data.knowledge.knownPeople.includes(id));
  }
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(2); });