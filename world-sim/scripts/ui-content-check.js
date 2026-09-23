'use strict';
/* ui-content-check.js —— 「内容真的上了屏吗」（v2.05 · P2-1 的缺口补上）
 *
 * 为什么要有它（这一批 UI 活儿的教训）：
 *   v1.33 把右栏从版面里撤掉时，<aside id="rail"> 被留在 DOM 上并加了 legacy-hidden
 *   （display:none !important），而 renderRail() 照旧每回合往里塞东西 ——
 *   「还悬着的事」(V.loose) 和「你记得的」(V.myLog) 于是**引擎在算、服务端在传、
 *   玩家一个字看不到**，整整六个版本没有任何东西报警。
 *   原因：既有断言全是"CSS 规则对不对"（ui-layout-check）/"壳层令牌在不在"（ui-shell-check），
 *   没有一条断言问**服务端给的字段有没有一条到屏幕的路**。
 *   这份脚本补的就是这一条：它是"字段 → 屏幕"的棘轮，不是样式检查。
 *
 * 纯文本断言 + 一个内存里的演示世界（不起服务）；失败以非零退出。
 * 用法：node scripts/ui-content-check.js
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
process.env.WORLD_SIM_DATA = process.env.WORLD_SIM_DATA || path.join(require('os').tmpdir(), 'ws-ui-content-' + process.pid);
process.env.WORLD_SIM_ASSETS = process.env.WORLD_SIM_ASSETS || ROOT;
const W = require('../src/world');
const G = require('../src/game');

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const AJ = read('public/app.js');
/* v3.1：board.js 也是客户端渲染器（它接的就是 renderStage）—— 棘轮必须一起看，
   否则界面上真的用到的字段会被判成"没人用"。 */
const BD = read('public/board.js');
const CLI = AJ + String.fromCharCode(10) + BD;
const IDX = read('public/index.html');
const ST = read('public/style.css');
const TK = read('public/tokens.css');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✔ ' + m)) : (fail++, console.log('  ✘ FAIL: ' + m)); };

/* ── [1] 「字段 → 屏幕」棘轮 ─────────────────────────────────────────────
   把 buildView 真正发出去的字段列出来，逐个问：客户端有没有引用它？
   引用不到的必须登记在下面这张表里并写清原因 —— 不许"悄悄没人用"。 */
{
  const d = W.buildDemoWorld();
  d.id = (p) => p + '_' + Math.random().toString(36).slice(2, 8);
  const v = G.buildView(d);
  const keys = Object.keys(v);
  /* 已登记：这些字段是**故意不给玩家看的**（给 AI 的资料包用 / 引擎内部对账 / 别处消费）。 */
  const KNOWN = {
    busy: 'server.js 外挂的"世界正忙"标志（/api/state 才有，buildView 里没有也不该有）'
  };
  const used = (k) => new RegExp('(V|v|view|s|tt|o)\\s*\\.\\s*' + k + '\\b').test(CLI) || CLI.indexOf("'" + k + "'") >= 0;
  const missing = keys.filter((k) => !used(k) && !(k in KNOWN));
  ok(keys.length > 20, 'buildView 发出去的字段读到了（' + keys.length + ' 个）');
  ok(missing.length === 0, '★ 每个外发字段都有客户端落点' + (missing.length ? '（没人用：' + missing.join(', ') + '）' : ''));
  /* 这一条是 v2.05 那两个 bug 的正面断言：认知层内容必须在**看得见**的面板里。 */
  const meBody = (AJ.match(/function panelMe\(p\) \{[\s\S]*?\n\}/) || [''])[0];
  ok(/V\.loose/.test(meBody), '「还悬着的事」(V.loose) 渲染在「我」面板里（可见容器）');
  ok(/V\.myLog/.test(meBody), '「你记得的」(V.myLog) 渲染在「我」面板里（可见容器）');
}

/* ── [2] 死容器棘轮：写进去却永远看不见的挂载点不许再出现 ───────────── */
{
  /* 只看活代码：注释里保留"这东西为什么被删"的说明是好事，不该被这条断言误伤
     （本文件 v2.05 删除的那批东西，注释里全都点名了）。 */
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');
  const all = strip(AJ + IDX + ST + TK);
  ok(!/legacy-hidden/.test(all), '没有 legacy-hidden 这类"留着节点但 display:none"的死容器');
  ok(!/renderRail/.test(all), 'renderRail 已删除（它当年就是往死容器里写的那个函数）');
  ok(!/getElementById\('rail'\)/.test(AJ), 'app.js 不再去找已删除的 #rail');
}

/* ── [3] 屏幕上只能是世界内的时间 ───────────────────────────────────── */
{
  ok(!/toLocaleTimeString|toTimeString|toLocaleDateString/.test(AJ.replace(/__DEV \?[^\n]*/g, '')),
    'app.js 不印真实世界的钟（?dev 门后的诊断读数除外）');
  ok(!/new Date\)\.getHours\(/.test(AJ), 'app.js 不直接取真实钟点（getHours）');
  ok(/b\.textContent = 'JS✔ ' \+ BUILD/.test(AJ), '左下角标只印构建号，不印实时钟（v2.05 修）');
  const when = (AJ.match(/function snapWhen\(m\) \{[\s\S]*?\n\}/) || [''])[0];
  const whenCode = when.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  ok(/世界时间/.test(whenCode), '存档行的时间列说"世界时间"');
  ok(!/fmtStamp\(m\.t\)/.test(whenCode.replace(/__DEV[^\n]*/g, '')), '存档行不再印真实世界的存档时刻（只在 ?dev 里）');
  ok(!/turnN|回合/.test(whenCode), '存档行不再印"第 N 回合"（引擎刻度不上桌）');
}

/* ── [4] 开发者词表必须在 ?dev 门后 ─────────────────────────────────── */
{
  const sl = (AJ.match(/function renderStatline\(\) \{[\s\S]*?\n\}/) || [''])[0];
  ok(/dev/.test(sl) && /location\.search/.test(sl), 'developer 状态条自带 ?dev 判断');
  ok(/回合 #/.test(sl), '「回合 #」只出现在 ?dev 状态条里');
  const outside = AJ.replace(sl, '');
  ok(!/回合 #/.test(outside), '其他地方不再出现「回合 #」');
}

/* ── [5] 交互面：输入框统一套主题（v2.05 的白框根因） ───────────────── */
{
  ok(/^input:not\(\[type=checkbox\]\)[^{]*\{[^}]*background:#0a1017/m.test(ST),
    'style.css 有一条**全局** input 主题规则（任何位置都不会漏出原生白框）');
  ok(/input:not\(\[type=checkbox\]\)/.test(ST) && !/input\[type=text\]\s*\{/.test(ST),
    '不再只给 [type=text] 上色（属性选择器匹配不到裸 input）');
  ok(/#modal input:not\(\[type\]\)/.test(ST), '#modal 里补了"裸 input"那一支');
}

/* ── [6] 菜单/弹层的出口：选完要收、Esc 要逐层退 ───────────────────── */
{
  ok(/function closeTiles\(\)/.test(AJ), '有 closeTiles() 这一个收菜单的出口');
  ok(/e\.target\.closest\('#mtiles \.tile'\)\) \{ closeTiles\(\); return; \}/.test(AJ),
    '★ 点「更多」里的某一项就收菜单（v2.05 修：原来面板开了菜单还挂在屏幕上挡着）');
  const esc = (AJ.match(/if \(!window\.__escBound\) \{[\s\S]*?\n\}/) || [''])[0];
  ok(/closeTiles\(\)/.test(esc), 'Esc 会收「更多」菜单');
  ok(/closePanel\(\)/.test(esc), 'Esc 会关面板（一次一层）');
  ok(/panelKind/.test(esc), 'Esc 只在面板真的开着时才关（不误伤）');
}

/* ── [7] 等待回合要有观察值（不是只有一句不变的"生成中"） ───────────── */
{
  ok(/function paintBusyElapsed\(\)/.test(AJ), '有"已等 N 秒"的重绘函数');
  const sb = (AJ.match(/function setBusy\(b, fromServer\) \{[\s\S]*?\n\}/) || [''])[0];
  ok(/paintBusyElapsed\(\)/.test(sb), '★ setBusy 里真的调它（忙碌时每秒刷新）');
  ok(/clearInterval\(__busyTick\)/.test(sb), '不忙时停表（不在空闲时空转）');
}

/* ── [8] 开始菜单：有存档时"继续"排在最上面 ───────────────────────── */
{
  const m = AJ.match(/if \(st\.currentWorld\) \{ grp\('继续游戏', cont\); grp\('开始游戏', startItems\); \}/);
  ok(!!m, '★ 有当前世界时「继续游戏」在「开始游戏」之前（v2.05 修：老玩家第一眼不该是"生成世界"）');
  ok(/else \{ grp\('开始游戏', startItems\); grp\('继续游戏', cont\); \}/.test(AJ), '没有存档时顺序照旧（新玩家先看到"开始游戏"）');
}

console.log('\n==== ui-content-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
