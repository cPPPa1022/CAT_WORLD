'use strict';
// contract-check.js - S0 契约断言：白名单 <-> 执行器 <-> 提示词，三处必须一致
// 用法：node scripts/contract-check.js   失败时非零退出
const fs = require('node:fs');
const path = require('node:path');
const C = require('../src/contract');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  OK  ' + m)) : (fail++, console.log('  FAIL ' + m)); };

// 从 game.js 的 applyUpdates 里**静态提取**实际实现的类型（不手抄第 4 份）
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'game.js'), 'utf8');
const i0 = src.indexOf('function applyUpdates');
if (i0 < 0) { console.log('  FAIL 找不到 applyUpdates'); process.exit(1); }
let i1 = src.indexOf('\nfunction ', i0 + 10);
if (i1 < 0) i1 = src.length;
const body = src.slice(i0, i1);
const impl = new Set();
const re = /u\.type\s*===\s*'([^']+)'/g;
let m;
while ((m = re.exec(body))) impl.add(m[1]);

console.log('contract: ' + C.UPDATE_TYPE_NAMES.length + ' 类 | applyUpdates 实现: ' + impl.size + ' 类');

ok(C.UPDATE_TYPE_NAMES.length === 18, '契约 18 类（实得 ' + C.UPDATE_TYPE_NAMES.length + '）');   // v3.1：+设定补全（开局编译）

const bad = C.assertContract(impl);
ok(bad.length === 0, 'assertContract 干净' + (bad.length ? ' -> ' + bad.join(' ; ') : ''));

for (const t of C.UPDATE_TYPE_NAMES) ok(impl.has(t), '有执行器: ' + t);
for (const t of impl) ok(C.UPDATE_TYPE_NAMES.indexOf(t) >= 0, '执行器类型已登记进白名单: ' + t);

// 提示词块必须覆盖全表（M4 的另一半：SYSTEM 从来没列全过）
const block = C.promptUpdatesBlock();
for (const t of C.UPDATE_TYPE_NAMES) ok(block.indexOf(t) >= 0, '提示词块含: ' + t);

/* v2.03 · P0-6 收尾：**动作效果**也走同一套规矩 ——
   静态提取 applyCustom 里真的实现了的效果类型（不手抄），与 contract 的白名单对账。 */
const dirSrc2 = fs.readFileSync(path.join(__dirname, '..', 'src', 'director.js'), 'utf8');   // applyCustom 住在 director.js
const di = dirSrc2.indexOf('async function applyCustom');
const dj = di < 0 ? -1 : dirSrc2.indexOf('\nfunction ', di + 10);
const fxBody = di < 0 ? '' : dirSrc2.slice(di, dj > 0 ? dj : dirSrc2.length);
if (di < 0) { console.log('  FAIL 找不到 applyCustom'); process.exit(1); }
const fxImpl = new Set();
const reFx = /fx\.type\s*===\s*'([^']+)'/g;
let mf;
while ((mf = reFx.exec(fxBody))) fxImpl.add(mf[1]);
// effects 表在 director.js，执行在 game.js —— 两边都要对得上
ok(C.ACTION_EFFECT_NAMES.length === 8, '动作效果 8 类（实得 ' + C.ACTION_EFFECT_NAMES.length + '）');
ok(fxImpl.size >= 8, 'applyCustom 实现了 ' + fxImpl.size + ' 类效果');
const badFx = C.assertContract(null, fxImpl);
const onlyFx = badFx.filter(x => /动作效果|applyCustom/.test(x));
ok(onlyFx.length === 0, '动作效果三处一致（白名单 / 执行器）' + (onlyFx.length ? ' -> ' + onlyFx.join(' ; ') : ''));
for (const t of C.ACTION_EFFECT_NAMES) ok(fxImpl.has(t), '动作效果有执行器: ' + t);
for (const t of fxImpl) ok(C.ACTION_EFFECT_NAMES.indexOf(t) >= 0, '执行器的效果已登记进白名单: ' + t);
const dirSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'director.js'), 'utf8');
ok(/const EFFECTS = CONTRACT\.ACTION_EFFECT_NAMES/.test(dirSrc), 'director 的效果白名单取自 contract（唯一真源，不再各存一份）');

// runtime 的白名单必须就是 contract 的那一份（防止有人又抄回去）
const RT = require('../src/runtime');
const rtList = RT.UPDATE_TYPES || [];
ok(rtList.length === C.UPDATE_TYPE_NAMES.length && rtList.every((x, i) => x === C.UPDATE_TYPE_NAMES[i]), 'runtime.js 的白名单 === contract（同一份）');

console.log('');
console.log('pass=' + pass + ' fail=' + fail);
process.exitCode = fail ? 1 : 0;