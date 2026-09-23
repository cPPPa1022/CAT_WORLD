
'use strict';
const fs = require('fs');
const p = 'src/import.js';
const raw = fs.readFileSync(p, 'utf8');
const lines = raw.split(/\r?\n/);
// 1) 多余逗号 ',, → '
let fixed = 0;
for (let i = 0; i < lines.length; i++) {
  if (lines[i] && lines[i].endsWith(',,')) { lines[i] = lines[i].slice(0, -1); fixed++; }
}
// 2) 删除 scanSystem 之外的残留 out=[...] 块
const outIdx = [];
for (let i = 0; i < lines.length; i++) if (lines[i] && lines[i].trim() === 'const out = [' && !(lines[i-1] && lines[i-1].indexOf('function scanSystem') >= 0)) outIdx.push(i);
let removed = 0;
for (let k = outIdx.length - 1; k >= 0; k--) {
  let s = outIdx[k], e = s;
  for (let i = s + 1; i < lines.length; i++) { if (lines[i] === '  }' || lines[i] === '}') { e = i; break; } }
  lines.splice(s, e - s + 1); removed++;
}
fs.writeFileSync(p, lines.join(String.fromCharCode(10)), 'utf8');
console.log('逗号修复 ' + fixed + '，残块删除 ' + removed);
