// ui-loop-check.js — 「下拉被顶回最上面」与「点生图说任务不存在」的回归（v1.80）
'use strict';
const fs = require('fs'); const path = require('path');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
console.log('');
console.log('叙事栏不该自己往上跳；规则装配出来的图任务也该能出图');
const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const sv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

// ① 死循环（真凶）
ok(/let __autoTried = \{\};/.test(ui), '★ 有 __autoTried（同一任务一次会话只自动试一次）');
ok(/status === 'prompted' \|\| t\.status === 'queued'\) && !__autoTried\[t\.id\]/.test(ui), '★★ autoRender 跳过已经试过的任务 —— 断掉 refresh↔autoRender 的死循环');
ok(/for \(const t of todo\) __autoTried\[t\.id\] = 1;/.test(ui), '★ 试过就记上');

// ② 滚动位置
ok(/let __storyTop = 0;/.test(ui), '★ 记住玩家滚到哪儿了');
ok(/s\.addEventListener\('scroll', function \(\) \{ __storyTop = s\.scrollTop; \}\)/.test(ui), '★ 滚动时更新（容器每次重画内容会被清空 → 之后读不到旧值）');
ok(/const keepTop = sceneChanged \? 0 : \(__storyTop \|\| 0\)/.test(ui), '★★ **换幕才跳顶，同一幕里保住位置**（原来是无条件 scrollTop = 0）');
ok(!/renderImgBar\(s\);\n  s\.scrollTop = 0;/.test(ui), '★ 那行无条件的 scrollTop = 0 没了');

// ③ 生图任务判定
ok(/find\(t => t\.id === id && \(t\.ai \|\| t\.prompt\)\)/.test(sv), '★★ 有 prompt 就算可渲染（规则装配的任务 ai 是 null，原来被判「任务不存在」）');
ok(!/find\(t => t\.id === id && t\.ai\)/.test(sv), '★ 旧的 t.ai 判断没了');

console.log('');
console.log('==== ui-loop-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
