'use strict';
/* ui-shell-check.js —— 壳层设计不变量（v1.81）
   存在意义：这一轮改出来的东西（一域一色 / 并排布局 / 内容原语 / 顶栏分组）
   都是"没人守着就会被改回去"的那类。每条断言都对应一个踩过的坑。
   纯文本断言，不起服务；失败以非零退出。 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const studio = fs.readFileSync(path.join(ROOT, 'public/studio.css'), 'utf8');
const tokens = fs.readFileSync(path.join(ROOT, 'public/tokens.css'), 'utf8');
const style = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
const studioJs = fs.readFileSync(path.join(ROOT, 'public/studio.js'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const electron = fs.readFileSync(path.join(ROOT, 'electron-main.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✔', m)) : (fail++, console.log('  ✘ FAIL:', m)); };

// ── 壳层令牌（窗口域）──
ok(/--sh-canvas:/.test(studio) && /--sh-accent:/.test(studio) && /--sh-hairline:/.test(studio),
  'studio.css 定义了 --sh-* 壳层令牌');
ok(/\[hidden\]\s*\{\s*display\s*:\s*none\s*!important/.test(studio),
  '[hidden]{display:none !important} 必须在（否则 .fields{display:grid} 会压过它，三个 tab 同时显示）');
ok(/#panel\s*\{[^}]*background:var\(--sh-surface-1\)/.test(studio.replace(/\n/g, ' ')),
  '#panel 外壳用壳层色板（--sh-surface-1），不是世界色板');

// ── 一域一色：世界域状态条 / 窗口域工作台 ──
ok(/\.imgstrip/.test(studio) && !/\.imgbar/.test(studio),
  '生图状态条是 .imgstrip（不叫 .imgbar —— 旧名会继承 tokens.css 里的 display:none）');
ok(!/\.imgbar|\.imgchip/.test(app + style + tokens),
  '旧的 .imgbar/.imgchip 已从代码与样式中清干净');
ok(/--sh-accent:#5e6ad2/.test(studio) && /--accent:#e8b45c/.test(tokens),
  '一域一色：窗口域薰衣草 #5e6ad2（studio.css）≠ 世界域琥珀 #e8b45c（tokens.css）');
ok(/\.imgstrip:hover[^}]*var\(--accent\)/.test(studio.replace(/\n/g, ' ')) && !/\.imgstrip[^}]*var\(--sh-accent\)/.test(studio.replace(/\n/g, ' ')),
  '世界域状态条穿世界的衣服（用 var(--accent) 而不是 var(--sh-accent)）');

// ── 并排布局（世界拿到整列高度）──
ok(/@media \(min-width:1100px\)/.test(tokens) && /#layout\s*\{[^}]*flex-direction:row/.test(tokens.replace(/\n/g, ' ')),
  '宽屏 ≥1100px 走并排布局（#layout flex-direction:row）');
ok(/#now\s*\{[^}]*flex:0 0 420px/.test(tokens.replace(/\n/g, ' ')),
  '并排时叙事列固定 420px（#now flex:0 0 420px）');

// ── 窄列里台词不能被行内图挤成竖排 ──
ok(/#now \.beat\.dialogue\s*\{\s*flex-wrap:wrap/.test(tokens),
  '对话行 flex-wrap:wrap（行内图换行到下一行，不跟台词抢宽度）');
ok(/#now \.beat\.dialogue \.dlg-main\{\s*min-width:min\(100%, ?15em\)/.test(tokens),
  '.dlg-main 有宽度下限 min(100%,15em)（min-width:0 允许被压到零 → 台词变竖排单字）');

// ── 场景字号：量真实步进，不假设 1.02em ──
ok(/ASCII_FS_MAX = 30/.test(app), 'ASCII_FS_MAX = 30（22 会把宽屏上的画卡在 669px）');
ok(/adv = \(pw \/ n\) \/ pf/.test(app),
  'fitSceneFont 量真实字符步进（假设 1.02em 会把可用宽度低估 1.7 倍）');
ok(!/fsByW = availW \/ \(cols \* 1\.02\)/.test(app), 'fitSceneFont 里不再有写死的 1.02 步进假设');

// ── 顶栏分组 ──
ok(/\.tb-sep/.test(tokens) && /tb-sep/.test(app), '顶栏分组分隔符 .tb-sep 在（世界给的载体 │ 认知 │ 系统）');

// ── 回忆卡不许盖住世界 ──
ok(/animation:recallIn/.test(style) && !/\.recallcard\s*\{[^}]*animation:fadeUp/.test(style.replace(/\n/g, ' ')),
  '回忆卡用自己的 recallIn 关键帧（借 fadeUp 会顶掉 translate(-50%,-50%)，入场时右移出屏）');
ok(/getElementById\('now'\)/.test(app) && /rc-text/.test(app),
  '回忆卡按叙事列定位（世界永远不被盖住）');

// ── 顶栏图标系统（v1.82）──
ok(/const ICONS = \{/.test(app) && /function iconSVG\(/.test(app), 'app.js 有一套线性图标表 ICONS + iconSVG()');
ok((app.match(/^  [a-z]+:\s*'</gm) || []).length >= 12, 'ICONS 至少 12 个图标（载体/认知/系统三组 + 兜底）');
ok(/b\.innerHTML = iconSVG\(a\[1\]\)/.test(app), '顶栏按钮用 iconSVG 渲染（不再把 emoji 当图标）');
ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test((app.match(/const grpCog = \[[^\]]*\]/) || [''])[0]),
  '认知组不再用 emoji（emoji 是字体不是图标：各系统渲染不同、基线不齐、粗细不可控）');
ok(/#worldbar #topbar \.tool svg \{ display:block; width:16px; height:16px; \}/.test(tokens),
  'SVG 显式定尺寸（换掉 emoji 后 font-size 管不到 svg）');

// ── 面板文案与标题（v1.82）──
ok(/const PANEL_ICON = \{/.test(app), 'PANEL_ICON 映射存在（面板标题走 iconSVG，与顶栏同一套）');
ok(/function skinMenuIcons/.test(app) && /skinMenuIcons\(m\)/.test(app),
  '开始菜单的 emoji 换成图标（skinMenuIcons 后处理，和顶栏同一套）');
ok(/LEAD_EMOJI = \/\^\[\\u\{1F000\}-/.test(app),
  'LEAD_EMOJI 从 1F000 起（从 1F300 起会漏掉 🃏 这类 1F0xx 区的符号）');
ok(/function fmtAgo/.test(app) && /fmtAgo\(g\.t/.test(app),
  '画面/相册用相对时间（fmtAgo）——世界内的东西不该显示真实世界日期');
ok(/function fmtStamp/.test(app) && !/\.slice\(5, ?16\)/.test(app),
  'ISO 时间戳不直接上桌（fmtStamp → "6月14日 07:00"，原来报纸上印的是 06-14T07:00）');
ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test((app.match(/function panelLabel\(k\)[\s\S]*?\n\}/) || [''])[0]),
  'panelLabel 不带 emoji（只返回文字）');
{
  const notes = (app.match(/sysnote',\s*'((?:[^'\\]|\\.)*)'/g) || []).join(' ');
  ok(notes.length > 0 && !/知识门控|数据库|缓存|注入主 AI|World Info|外貌库|九维档案|提示词|认知地图/.test(notes),
    '面板 sysnote 里没有系统术语（屏幕只放感知/认知/行动 —— 世界的真相与进度不上桌）');
}

ok(!/function imageStudioSections/.test(app), 'app.js 里的 imageStudioSections 已删除');
ok(/Studio\.open\(\)/.test(app) && /window\.Studio|var Studio =/.test(studioJs),
  'openImageEngine 委托给 Studio（工作台在 public/studio.js）');
ok(/studio\.css/.test(html) && /studio\.js/.test(html), 'index.html 引入了 studio.css / studio.js');

// ── 面板内容结构（v1.82）──
{
  /* 只看代码行，不看注释 —— 注释里保留 emoji 是为了说明"原来长这样" */
  let inBlock = false;                       // 逐行跟踪 /* */ 状态（多行注释的续行不以 * 开头）
  const code = app.split('\n').filter(l => {
    if (inBlock) { if (l.indexOf('*/') >= 0) inBlock = false; return false; }
    if (/^\s*\/\//.test(l)) return false;
    if (/^\s*\/\*/.test(l)) { if (l.indexOf('*/') < 0) inBlock = true; return false; }
    return true;
  }).join('\n');
  ok(!/🖼|🎨|🔁|💾|📃|👤|📚|🌍|📜|🗺|📟|🎲|🐈|📖|🎒|↩|⬇|🔧|📋|⚡|✨|📥|🎁|🗂|🃏|📄/.test(code),
    '代码里没有「emoji 当图标」（一律走 iconSVG；⚠ 作为语义警告符号保留）');
}
ok(/'sn-btns'/.test(app) && /\.sn-btns/.test(studio) && !/btns\.style\.cssText/.test(app),
  '存档/世界列表行用 .sn-btns 原语（不再写 inline style）');
ok(/el\('div', 'item sn-row'\)/.test(app) && /\.sn-row/.test(studio),
  '存档槽位行拆成真正的列（槽位 / 标记 / 进度 / 时刻 / 动作）');
ok(!/'conv ' \+ \(m &&/.test(app), '存档槽位不再借用 .conv（手机会话卡）的类名');
ok(/const APP_REG = \{[\s\S]*?icon: 'sms'/.test(app),
  '载体面板的 app 图标也是图标名（不是 emoji）');

// ── 版本号四处同步 ──
const b = (server.match(/const BUILD = '([^']+)'/) || [])[1];
ok(!!b && b === (app.match(/const BUILD = '([^']+)'/) || [])[1], 'server.js 与 app.js 的 BUILD 一致 (' + b + ')');
ok(!!b && electron.indexOf(b) >= 0, 'electron-main.js 窗口标题带同一个版本号');

console.log('==== ui-shell-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
