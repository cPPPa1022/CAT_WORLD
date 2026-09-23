// ui-layout-check.js — UI 布局红线（离线、不需要浏览器）
// 这两个 bug 都是"玩家一眼看到、代码里却没有任何东西会报警"的类型：
//   ① 按钮错位/被挡：面板盖住顶栏、窄屏抽屉按钮压在发送按钮上（实测重叠 48×28）
//   ② 按钮看不出是什么：<button class="pill"> 没清掉浏览器默认白底 → 深色界面上一块白斑
// 断言方式：读 CSS 规则本身（谁能覆盖谁），因为这两个问题的根因都在"层级与默认样式"。
'use strict';
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
const css = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✔', m)) : (fail++, console.log('  ✘ FAIL:', m)); };
const blockOf = (src, sel) => { const i = src.indexOf(sel); if (i < 0) return ''; const j = src.indexOf('}', i); return src.slice(i, j < 0 ? i + 400 : j + 1); };

const TK = css('tokens.css');
const ST = css('style.css');

// [1] 面板弹层不许盖住顶栏（玩家会看到"按钮被挡住"）
{
  const b = blockOf(TK, '#panel {');
  ok(/top:\s*(1[0-9]{2}|\d{3})px\s*!important/.test(b), '面板弹层 top ≥ 100px（让开顶栏两行）—— 现状：' + (b.match(/top:[^;]+/) || ['(未设置)'])[0]);
  ok(/z-index:\s*[0-4][0-9]\s*!important/.test(b), '面板弹层 z-index < 顶栏（50）—— 现状：' + (b.match(/z-index:[^;]+/) || ['(未设置)'])[0]);
}

// [2] 死 UI 不许回来：旧右栏（#rail）与它的抽屉按钮（#railtgl / .rail-toggle）在 v2.05 整块删除。
//     这条断言的前身是"宽屏必须把抽屉按钮 display:none !important"——当年它压在「执行」按钮上。
//     v2.05 查清了根因：#rail 从 v1.33 起就一直带着 legacy-hidden（display:none），
//     那个按钮唤出的抽屉**永远不可能显示任何东西**，窄屏上纯粹是个"点了没反应"的按钮。
//     所以这一节改成两条更强的断言：这套死 UI 一处都不许出现；且不许再有它的样式残留。
{
  const IDX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const AJ = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  const ST2 = css('style.css');
  // 只看活代码：注释里保留"这套东西为什么被删"的说明是好事，不该被这条断言误伤。
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');
  const all = strip([TK, ST2, IDX, AJ].join('\n'));
  const hit = (all.match(/#railtgl|rail-toggle|id="rail"|#rail[\s.{:]/g) || []);
  ok(hit.length === 0, '右栏抽屉这套死 UI 已从 tokens.css / style.css / index.html / app.js 全部删除' + (hit.length ? '（残留 ' + hit.length + ' 处：' + hit.slice(0, 3).join(',') + '）' : ''));
  ok(!/appendRailToggle|ACTIONS\.rail/.test(strip(AJ)), 'app.js 里不再有 appendRailToggle / ACTIONS.rail');
}

// [3] 顶栏 pill 是 <button>：必须清掉浏览器默认外观（白底会让深色界面上出现白斑）
{
  const b = blockOf(TK, '#worldbar #topbar .pill {');
  ok(/background:\s*transparent/.test(b), '顶栏 pill 显式 background:transparent（清掉浏览器默认白底）');
  ok(/appearance:\s*none/.test(b), '顶栏 pill 显式 appearance:none');
  const sB = blockOf(ST, 'header#topbar .pill {');
  ok(!/background:\s*(#f|#e|rgb\(2[0-9]{2})/i.test(sB), '旧样式表里没有给 pill 设浅色底（现状：' + (sB.match(/background:[^;]+/) || ['(未设背景)'])[0] + '）');
}

// [4] 场景热点不许长得像 UI 控件（琥珀底 + 描边 = 字符画上贴贴纸，用户实测反馈）
{
  const b = blockOf(TK, '#world .mark {');
  ok(/background:\s*transparent\s*!important/.test(b), '场景热点静止时背景透明（不许像按钮）');
  ok(/box-shadow:\s*none\s*!important/.test(b), '场景热点静止时无描边');
  ok(/color:\s*inherit\s*!important/.test(b), '场景热点字色继承（与周围的画一致）');
}

// [5] 代码里引用的元素 id，必须在 HTML 里存在（或在代码里动态创建）
//     为什么要有这条：v1.33 重构删掉了 #stage，但 showActions() 还在往它挂菜单 ——
//     于是**点场景热点必崩**（"Cannot read properties of null (reading 'appendChild')"，用户实测）。
//     这类错在代码里完全看不出来，只有点到那一步才炸。
{
  const app = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const refs = new Set();
  for (const m of app.matchAll(/\$\('#([a-zA-Z0-9_-]+)'\)/g)) refs.add(m[1]);
  for (const m of app.matchAll(/getElementById\('([a-zA-Z0-9_-]+)'\)/g)) refs.add(m[1]);
  const inHtml = new Set(); for (const m of html.matchAll(/id="([a-zA-Z0-9_-]+)"/g)) inHtml.add(m[1]);
  const dynamic = new Set(); for (const m of app.matchAll(/\.id\s*=\s*'([a-zA-Z0-9_-]+)'/g)) dynamic.add(m[1]);
  const missing = [...refs].filter(x => !inHtml.has(x) && !dynamic.has(x));
  ok(missing.length === 0, '代码引用的 ' + refs.size + ' 个元素 id 都存在（缺失：' + JSON.stringify(missing) + '）');
}

console.log('\n==== ui-layout-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
