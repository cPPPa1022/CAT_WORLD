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

ok(C.UPDATE_TYPE_NAMES.length === 21, '契约 21 类（实得 ' + C.UPDATE_TYPE_NAMES.length + '）');   // v3.1：+设定补全（开局编译）；v3.20：+钱款变动/账目（钱与账）

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

/* ---------- 槽位限长：也必须只有一处（v2.09 加） ----------
   为什么加这条：contract.js 里原来躺着一份 **全项目没人用过**的 BEAT_SLOTS，
   它写 action≤20 / expression≤12 / voice≤12；而真提示词（ai.js）写 30/20/16、
   代码截断（sweepThink）切 60/40/32 —— **一个号称"单一真源"的文件，三处三个数**。
   这份断言守着：数字只能出自一处，改了契约，提示词和截断同时跟着变。 */
{
  const aiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'ai.js'), 'utf8');
  ok(!!C.BEAT_LIMITS && C.BEAT_LIMITS.expression && C.BEAT_LIMITS.expression.hard === 20,
    '契约里有 BEAT_LIMITS（expression.hard=20）');
  ok(/BEAT_LIMITS\.\w+\.hard/.test(aiSrc), '★ 提示词的字数**从契约取**（不再手写 ≤N字）');
  ok(/BEAT_LIMITS/.test(aiSrc), '★ 截断也从契约取');
  /* 收准范围：只守 sweepThink 里那四个**槽位**的截断（ai.js 别处还有 unrelated 的 .slice(0,N)，
     例如 ai.js:668 的性格内核 60 字 —— 那是资料包字段，不是 beat 槽位，不该被这条断言牵连）。 */
  const sweepSrc = aiSrc.slice(aiSrc.indexOf('function sweepThink'), aiSrc.indexOf('function stripJson'));
  ok(/LIM\.action\.cut/.test(sweepSrc) && /LIM\.expression\.cut/.test(sweepSrc)
    && /LIM\.voice\.cut/.test(sweepSrc) && /LIM\.tone\.cut/.test(sweepSrc),
    '★ sweepThink 的四个槽位截断**全部**从契约取');
  ok(!/slice\(0, \d+\)/.test(sweepSrc.replace(/LIM\.\w+\.cut/g, 'CUT')),
    '★ sweepThink 里没有写死的字数（改契约就同时改提示词与截断）');
  ok(!('BEAT_SLOTS' in C), '★ 死掉的 BEAT_SLOTS 已移除（没人用、又和真提示词对不上的那份副本）');
}

console.log('');
console.log('pass=' + pass + ' fail=' + fail);
process.exitCode = fail ? 1 : 0;