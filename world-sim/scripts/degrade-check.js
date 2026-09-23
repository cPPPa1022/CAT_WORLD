// degrade-check.js — 静默降级的棘轮（v1.86）
// 为什么有它：全项目曾有 121 处 `catch (e) { }`，一个回合里十几处静默降级 ——
// 任何一环失败都表现为"AI 好像变笨了"，而代码层面没有任何记录。
// v1.86 给它们全部接上统一计数（src/degraded.js），这个脚本守住两件事：
//   ① 计数机制真的好使；② **静默 catch 的数量只许减、不许增**（棘轮）。
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const fs = require('fs');
const DEG = require(ROOT + '/src/degraded');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };

const BASELINE = 133;   // v1.86 改造后的实际点位；新增静默 catch 会让这条红

const files = fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.js')).map(f => 'src/' + f).concat(['server.js', 'electron-main.js']);
let silent = 0, instrumented = 0;
for (const rel of files) {
  const s = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  silent += (s.match(/catch\s*\([A-Za-z_$][\w$]*\)\s*\{\s*\}/g) || []).length;
  instrumented += (s.match(/DEG\.hit\(/g) || []).length;
}
console.log('静默 catch 现状');
ok(instrumented >= BASELINE, '已接上计数的点位 ' + instrumented + ' 处（基线 ' + BASELINE + '）');
ok(silent <= 3, '仍未接计数的空 catch = ' + silent + ' 处（新增会被这条抓住）');

console.log('');
console.log('计数机制');
DEG.reset();
DEG.hit('a.js', new Error('x'));
DEG.hit('a.js', new Error('y'));
DEG.hit('b.js', new Error('z'));
const v = DEG.view();
ok(v.total === 3 && v.top[0].where === 'a.js' && v.top[0].n === 2, '按模块计数正确：' + JSON.stringify(v.top));
ok(!!v.top[0].last && v.recent.length === 3, '最近错误样本可见：' + JSON.stringify(v.recent[v.recent.length - 1]));
DEG.reset();
ok(DEG.view().total === 0, 'reset 清空');

console.log('');
console.log('出口');
const sv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
ok(/degraded: \(function/.test(sv), '/api/diag 暴露 degraded');
ok(/require\('\.\/src\/degraded'\)/.test(sv), 'server.js 已 require degraded');
console.log('');
console.log('==== degrade-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
