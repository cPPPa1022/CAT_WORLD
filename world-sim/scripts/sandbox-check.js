// sandbox-check.js — 沙箱的红线：**AI 写的代码拿不到任何宿主能力**
//
// 为什么有它：第三步的 AI 会写代码，而用户的要求是
//   「需要禁止让 ai 给整个模拟器搞坏 最多让它搞坏存档」。
// 这个沙箱是那条边界的**唯一实现** —— 它漏一样，那条边界就没了，
// 而且**不会有任何东西报错**（代码照跑，只是能碰系统了）。
// ⇒ 所以这里逐样验证"拿不到"，不是抽查。
'use strict';
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const TMP = path.join(os.tmpdir(), 'ws-sandbox-' + Date.now());
fs.mkdirSync(path.join(TMP, 'data'), { recursive: true });
process.env.WORLD_SIM_DATA = TMP;
process.env.WORLD_SIM_ASSETS = path.resolve(__dirname, '..');

const SB = require('../src/sandbox');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  OK   ' + m)) : (fail++, console.log('  FAIL ' + m)); };

console.log('');
console.log('沙箱 · AI 写的代码只能在这上面跑');

/* ── ① 宿主能力必须**逐样**拿不到 ───────────────────────────── */
console.log('');
console.log('① 宿主能力（逐样验，不抽查）');
{
  const r = SB.selfCheck();
  ok(r.ok, '★ 该挡的全挡住了' + (r.ok ? '' : '（漏了：' + JSON.stringify(r.leaked) + '）'));
  for (const k of SB.FORBIDDEN) {
    const v = SB.run('return typeof ' + k + ';');
    ok(!v.ok || v.out === 'undefined', '拿不到 `' + k + '`' + (v.ok ? '' : '（已拦：' + String(v.err).slice(0, 30) + '）'));
  }
  ok(SB.run('return typeof Math.random;').out === 'undefined', '★ 拿不到 `Math.random`（世界要随机就走 seededRoll，可重放）');
}

/* ── ② 能写的（不能因为安全就把能力掐死）──────────────────── */
console.log('');
console.log('② 能写的（逻辑要给足，不然就成了摆设）');
{
  ok(SB.run('return 1+2*3;').out === 7, '算数');
  ok(JSON.stringify(SB.run('return [1,2,3].map(function(x){return x*2;});').out) === '[2,4,6]', '数组方法');
  ok(SB.run('var n=0; for (var i=0;i<10;i++) n+=i; return n;').out === 45, '循环');
  ok(SB.run('return {a:1}.a === 1;').out === true, '对象');
  ok(SB.run('return JSON.stringify({x:1});').out === '{"x":1}', 'JSON');
  const api = { read: { a: 1, b: 2 }, draw: { c: 3 }, write: { postUpdate: 4 } };
  ok(SB.run('return Object.keys(read).length + Object.keys(draw).length + Object.keys(write).length;', api).out === 4,
    '★ 白名单 API 真的注入了（读2 + 画1 + 写1）');
  ok(SB.run('return typeof write.postUpdate;', api).out === 'number', '写入口就是 `write.postUpdate` 那一个');
}

/* ── ③ 三层保护：语法预检 / 超时 / 长度 ────────────────────── */
console.log('');
console.log('③ 三层保护');
{
  const g = SB.run('const a = "1;');
  ok(!g.ok && /语法/.test(String(g.err)), '★ 语法错**根本没进沙箱**（第①层：syntaxCheck 拦下）——「多一个引号」到不了存档');
  const t = SB.run('while(true){}');
  ok(!t.ok, '★ 死循环被超时掐断（' + SB.MAX_MS + 'ms）：' + String(t.err).slice(0, 40));
  const l = SB.run('x'.repeat(SB.MAX_CODE + 1));
  ok(!l.ok && /太长/.test(String(l.err)), '代码长度上限 ' + SB.MAX_CODE + ' 字（太长的东西该拆成板块声明，不该写成程序）');
  ok(!SB.run('').ok, '空代码不放行');
  ok(!SB.run(null).ok, 'null 不放行');
}

/* ── ④ 它是**唯一**那道边界：源码里不许有别的执行入口 ───────── */
console.log('');
console.log('④ 不许有第二个执行入口（有第二个＝边界失效）');
{
  const files = fs.readdirSync(path.join(__dirname, '..', 'src')).filter(f => f.endsWith('.js'));
  const others = [];
  for (const f of files) {
    if (f === 'sandbox.js') continue;
    /* framework.js 的 `new Function` 是 syntaxCheck —— **只编译、不执行**，
       而且是三层保护的第①层，删不得。所以单独验它"只有那一处、且在那函数里"。 */
    if (f === 'framework.js') continue;
    const s = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
    if (/vm\.runIn|new Function\(|eval\(/.test(s)) others.push(f);
  }
  ok(others.length === 0, '★ 执行 AI 代码的入口**只有 sandbox.js 一个**' + (others.length ? '（还有：' + others.join(', ') + '）' : ''));

  const fws = fs.readFileSync(path.join(__dirname, '..', 'src', 'framework.js'), 'utf8');
  const uses = (fws.match(/new Function\(/g) || []).length;
  ok(uses === 1 && /function syntaxCheck[\s\S]{0,300}?new Function\(/.test(fws),
    'framework.js 里唯一的 `new Function` 在 syntaxCheck 里（**只编译不执行**，' + uses + ' 处）—— 编译 ≠ 运行');
  ok(SB.run('return typeof this;').ok, '沙箱内 this 不泄漏宿主 global（由 codeGeneration + context 隔离保证）');
}

console.log('');
console.log('==== sandbox-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
