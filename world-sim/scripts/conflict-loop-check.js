// conflict-loop-check.js — 冲突回灌必须真的可达（v1.97 · X1）
// 病（评审回执_v1.96 的 X1，两份外部评审都没发现）：
//   `const messages` 声明在 if (AI.isLive) 块内，而冲突回灌在**块外**用它 ⇒ ReferenceError
//   被 catch 吞掉 ⇒ ① 冲突永不回灌 ② 也不走"≤2 轮→autoFix→保守发布→记账" ③ 全程静默。
//   这是静态作用域问题，所以本脚本用**静态断言**守住它（正是那种能抓住 X1 的检查）。
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'src', 'game.js'), 'utf8');
const lines = src.split(/\r?\n/);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
console.log('');
console.log('冲突回灌（创造循环第③步）必须可达');

// 用括号配平找 if (AI.isLive(cfg)) 那个块（runTurn 里第二处）
const strip = (l) => l.replace(/\/\/.*$/, '').replace(/'(?:[^'\\\\]|\\\\.)*'/g, "''").replace(/"(?:[^"\\\\]|\\\\.)*"/g, '""');
const starts = [];
lines.forEach((l, i) => { if (/if \(AI\.isLive\(cfg\)\)\s*\{/.test(l)) starts.push(i + 1); });
let block = null;
for (const s of starts) {
  let depth = 0, end = -1;
  for (let i = s - 1; i < lines.length; i++) {
    for (const ch of strip(lines[i])) { if (ch === '{') depth++; else if (ch === '}') depth--; }
    if (i > s - 1 && depth <= 0) { end = i + 1; break; }
  }
  const seg = lines.slice(s - 1, end).join(String.fromCharCode(10));
  if (/messages\s*=/.test(seg)) block = { s, end };
}
ok(!!block, '找到持有 messages 的那个 isLive 块（第 ' + (block && block.s) + '~' + (block && block.end) + ' 行）');

// 关键：先去掉注释与字符串再扫（否则会撞上"解释 X1 的那段注释"本身）
/* 去注释但**保留行号**：块注释整体替换成等量空行（否则换行被吃掉、行号会漂）。 */
const blanked = src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/\/\/[^\n]*/g, '');
const nocmt = blanked.split(/\r?\n/);
const declLines = [];
nocmt.forEach((l, i) => { if (/\b(const|let|var)\s+messages\b/.test(l)) declLines.push({ n: i + 1, const: /const\s+messages/.test(l) }); });
ok(declLines.length === 1, 'messages 只有一处声明（第 ' + (declLines[0] && declLines[0].n) + ' 行）');
ok(declLines.length && !declLines[0].const, '★ 声明是 let（不是块内 const）—— 这是 X1 的根因，不许改回去');
ok(declLines.length && block && (declLines[0].n < block.s), '★ 声明在 isLive 块**之前**（函数作用域），不在块内');

const pushLines = [];
nocmt.forEach((l, i) => { if (/(^|[^.\w])messages\.push\(/.test(l)) pushLines.push(i + 1); });
ok(pushLines.length >= 4, 'messages.push 使用点 ' + pushLines.length + ' 处：' + pushLines.join(','));
const outside = block ? pushLines.filter(n => n < block.s || n > block.end) : pushLines;
ok(outside.length > 0, '其中有使用点在块外（冲突回灌）：' + JSON.stringify(outside));
ok(!block || outside.every(n => declLines[0].n < n), '★ 所有使用点都在声明之后 ⇒ 不会再抛 ReferenceError');

const loop = lines.findIndex(l => /GATE\.conflicts\(/.test(l)) + 1;
ok(loop > 0, '找到冲突检查调用（第 ' + loop + ' 行）');
const guard = lines.slice(loop - 1, loop + 8).join(String.fromCharCode(10));
ok(/!messages/.test(guard), '★ 保守发布分支带 !messages 守卫（演示模式也不会在 push 时抛错）');
console.log('');
console.log('==== conflict-loop-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
