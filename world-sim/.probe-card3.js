'use strict';
const fs = require('node:fs');
const rec = JSON.parse(fs.readFileSync('C:\\Users\\qwe\\AppData\\Roaming\\world-sim\\data\\cards\\c__muem2r2gjnnn7.json', 'utf8'));
console.log('卡记录的键: ' + Object.keys(rec).join(', '));
console.log('有原卡正文吗: ' + ['card', 'source', 'text', 'raw', 'cardText'].filter(k => rec[k]).join(',') || '（没有）');
const pk = rec.pack || {};
console.log('pack.player 的键: ' + Object.keys(pk.player || {}).join(','));
console.log('pack.npcs 条数: ' + (pk.npcs || []).length + '  names=' + (pk.npcs || []).map(n => n.name).join('/'));
console.log('pack.firstScene 前 200 字: ' + String(pk.firstScene || '').slice(0, 200));
