'use strict';
const fs = require('node:fs');
const fp = 'C:\\Users\\qwe\\AppData\\Roaming\\world-sim\\data\\cards\\c__muem2r2gjnnn7.json';
const rec = JSON.parse(fs.readFileSync(fp, 'utf8'));
console.log('卡名: ' + rec.name + ' | era=' + rec.era + ' | mode=' + rec.mode);
console.log('pack.meta 的键: ' + Object.keys((rec.pack || {}).meta || {}).join(', '));
console.log('pack 顶层键: ' + Object.keys(rec.pack || {}).join(', '));
const a = String(rec.analysis || '');
console.log('analysis 长度: ' + a.length + ' 字');
console.log('analysis 的小标题: ' + (a.match(/^#+\s*.*$/gm) || []).join(' | '));
/* 打印 §一 与 §六 —— 这两段就是"身份证"的原料 */
const cut = (start, end) => { const i = a.indexOf(start); if (i < 0) return '(没找到 ' + start + ')'; const j = end ? a.indexOf(end, i + 1) : -1; return a.slice(i, j > 0 ? j : i + 1200); };
console.log('\n════ §一（这是个什么世界）════\n' + cut('## 一', '## 二').slice(0, 900));
console.log('\n════ §六（什么最重要 = 核心冲突/谁的欲望）════\n' + cut('## 六', '## 七').slice(0, 900));
