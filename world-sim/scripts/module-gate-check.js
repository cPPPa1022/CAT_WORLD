'use strict';
// module-gate-check.js — v1.91 **属性级开关检查**（补上缺的那一类）
//
// 为什么要有它：
//   `switches.js` 原来的每一条检查都是**源码正则** —— 它回答的是「有没有这段代码」，
//   **回答不了「产物里有没有这个词」**。于是漏掉了一个正则全绿、体验却坏着的 bug：
//     `【导演笔记不许进正文】画面笔记 / 生图提示词 / 镜头机位 / 景深构图 / 打光` 这一段是**常驻的**，
//     生图关掉时照样在提示词里；而 L1 查的是 `/cfg2\.image && cfg2\.image\.enabled/` ——
//     只要 ai.js 里**某处**还有这个闸门，它就绿。
//     （gate.js v1.58 记的正是同一条报案：「我明明没开生图模块，却还是有对应的提示词」。）
//
// 本脚本的判据换了一种：**不看源码，看产物**。
//   关掉一个模块 → 它的词汇在 SYSTEM / 资料包里出现次数必须是 **0**；
//   开启一个模块 → 它的词汇必须**真的出现**（防止「把整段删掉」也算修好）。
// 词表与探针写在 switches.js 的 vocab / onVocab / probe 里（声明一处，量一处）。
// 用法：node scripts/module-gate-check.js   失败非零退出
const AI = require('../src/ai');
const W = require('../src/world');
const SW = require('../src/switches');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  OK  ' + m)) : (fail++, console.log('  FAIL ' + m)); };
const count = (hay, needle) => hay.split(needle).length - 1;

const world = () => { const d = W.buildDemoWorld(); d.id = (p) => p + '_' + Math.random().toString(36).slice(2, 8); return d; };

const cases = SW.SWITCHES.filter(s => s.vocab && s.vocab.length && s.probe);
ok(cases.length >= 1, '注册表里有可做属性检查的开关（实得 ' + cases.length + ' 个）');

for (const s of cases) {
  console.log('');
  console.log('【' + s.name + '】' + s.setting);
  const dOff = world(), dOn = world();
  let offText = '', onText = '';
  try {
    if (s.probe.what === 'SYSTEM') {
      offText = AI.SYSTEM(dOff, s.probe.off || {});
      onText = s.probe.on ? AI.SYSTEM(dOn, s.probe.on) : '';
    }
  } catch (e) { ok(false, '构造产物抛错: ' + e.message); continue; }
  // 资料包也要干净（它是另一个出口）
  let packOff = '';
  try { packOff = AI.packetFor(dOff, { memories: [], candidates: [], action: 'x' }); } catch (e) { packOff = ''; }

  const leaks = [];
  for (const w of s.vocab) {
    const n = count(offText, w) + count(packOff, w);
    if (n) leaks.push(w + '×' + n);
  }
  ok(leaks.length === 0, '★ 关闭时：模块词汇在 SYSTEM + 资料包里出现 **0** 次' + (leaks.length ? (' —— 泄漏: ' + leaks.join(' / ')) : ''));

  if (s.probe.on) {
    const missing = (s.onVocab || []).filter(w => count(onText, w) === 0);
    ok(missing.length === 0, '★ 开启时：模块词汇真的出现（防止「删光也算修好」）' + (missing.length ? (' —— 缺: ' + missing.join(' / ')) : ''));
    ok(onText.length > offText.length, '开启比关闭多出内容（+' + (onText.length - offText.length) + ' 字符）');
  }
}

console.log('');
console.log('pass=' + pass + ' fail=' + fail);
process.exitCode = fail ? 1 : 0;