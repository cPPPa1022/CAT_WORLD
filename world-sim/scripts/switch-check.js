// switch-check.js — 开关**穿透度**断言（v1.59）：直接读源码核对，缺一层即红。
'use strict';
const fs = require('fs'); const path = require('path');
const { LAYERS, SWITCHES } = require('../src/switches');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const cache = {};
function src(f) { if (cache[f] === undefined) { try { cache[f] = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { cache[f] = null; } } return cache[f]; }
console.log('');
console.log('开关穿透度（七层）—— 缺一层 = 体验上「开了没用 / 关了还有」');
console.log('');
for (const s of SWITCHES) {
  console.log('[' + s.id + '] ' + s.name + '  （' + s.setting + '）');
  for (const c of s.checks) {
    const text = src(c.file);
    const hit = !!text && c.re.test(text);
    if (hit) { pass++; console.log('   OK   ' + c.L + '  ' + (c.note || '') + '  [' + c.file + ']'); }
    else { fail++; console.log('   MISS ' + c.L + '  **缺**：' + (c.note || '') + '  [应在 ' + c.file + ' 里]'); }
  }
}
console.log('');
console.log('==== switch-check: ' + pass + ' passed, ' + fail + ' failed ====');
if (fail) console.log('（MISS 就是欠账表：这些层没有检查点，开关在体验上就是不完整的）');
process.exitCode = fail ? 1 : 0;
