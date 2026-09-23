// app.js — 世界模拟器前端 v1.8 FINAL（全局委托 · 舞台模式 · 世界声明式工具）
'use strict';

let V = null;
let panelKind = null;
let phoneTab = 'home';
/* v1.98 · P0-2：忙态有**两个来源**，合成一个有效值。
   · __localBusy：本地乐观（我按下执行到回合回来这段时间）
   · __srvBusy  ：**服务端说的**（/api/state 的 view.busy —— 世界锁被别的入口占着）
   为什么要服务端那一半：短信发送按钮原来不置忙，玩家能在回合演算中途插进去一条操作；
   而"世界正忙"本来就是**世界的状态**，该由服务端说，不是前端用一个 let 猜（项目硬分界：UI 不持有世界真相）。
   注意：这只在**刷新时**同步（没有新的轮询 —— 每 2 秒重画整屏正是 v1.80 修掉的"把玩家顶回开头"那个 bug）。 */
let busy = false;
let __localBusy = false;
let __srvBusy = false;
/* v2.05（P2-1.4）：等待回合一等就是几十秒，屏幕上却只有一句不变的"生成中" ——
   玩家分不清"在跑"和"卡死了"。这里只加**已等了多久**这个观察值（估时/进度条都属于编造，
   引擎并没有可靠的进度可报）。真实耗时在 ?dev 的 LLM 行里。 */
let __busyAt = 0, __busyTick = null;
function paintBusyElapsed() {
  const p = document.querySelector('#topbar .pill.catpill');
  if (!p || !busy) return;
  const s = Math.floor((Date.now() - __busyAt) / 1000);
  p.textContent = s >= 1 ? ('生成中 · 已等 ' + s + ' 秒 ✎') : '生成中 ✎';
}
let SRVCFG = null;
let __galleryReady = false;   // 图库（第二个数据源）是否已针对当前世界载入
let __lastFxSeq = 0;          // 本回合演出（fx.js 词表）已播到的序号
let __lastDocSeq = 0;         // 文书展开（文档对象）已展开到的序号
let __expDay = '';            // v1.54「你经历过」按哪一天筛选
const BUILD = 'v2.08';
/* v1.86：**开发者字段走 /api/dev**（世界视图 /api/state 默认不含它们）。
   为什么：原来 buildView 一份 JSON 兼作世界呈现 + 设置面板 + 诊断，任何新增字段默认就对前端可见 ——
   "开发者信息不上桌"（catworld-ui 越权红线 4）只能靠纪律守。现在默认隐藏，只在 ?dev 或设置面板里取。 */
let __DEV = null;
async function loadDev() { try { const r = await api('/api/dev'); __DEV = (r && r.ok) ? r : null; } catch (e) { __DEV = null; } return __DEV; }

// ---------- 工具/app 注册表（后端 view.tools 声明；没有的 app 不渲染） ----------
/* v1.82：icon 从 emoji 改成**图标名**（见 ICONS 表）。载体面板（大哥大/信匣）的
   app 网格也跟着走同一套线性图标 —— 手机上的"应用"是软件，不是世界里的物件。 */
const APP_REG = {
  sms: { name: '消息', icon: 'sms' },
  letters: { name: '信札', icon: 'letter' },
  docs: { name: '文书', icon: 'docs' },
  contacts: { name: '通讯录', icon: 'people' },
  clock: { name: '时钟', icon: 'clock' },
  calendar: { name: '日程', icon: 'calendar' },
  news: { name: '新闻', icon: 'news' },
  weather: { name: '天气', icon: 'weather' },
  map: { name: '地图', icon: 'map' },
  album: { name: '相册', icon: 'gallery' }
};
function currentTool() { return (V && (V.tools || []).find(t => t.id === panelKind)) || null; }
function isSingleTool() { const t = currentTool(); return !!(t && t.apps && t.apps.length === 1); }

function $(s) { return document.querySelector(s); }
function toast(msg, warn) {
  try {
    const c = $('#toast');
    const t = el('div', 't' + (warn ? ' warn' : ''), msg);
    c.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; setTimeout(() => t.remove(), 450); }, 3400);
  } catch (e) { __deg("app.js", e); }
}
function el(tag, cls, text) {
  const e = document.createElement(tag);
  /* v2.05 修 C2（豆包 §6.3 🔴，P2-1.1）：**裸 <input> 没有 type 属性**，而样式表写的是
     `#modal input[type=text]` —— 属性选择器匹配的是 **content attribute**，而"没写 type"时
     type 只是 IDL 默认值（'text'），**不反射**成属性 ⇒ 19 处创建点全部漏掉主题，界面上是浏览器原生白框。
     修法（任务书方案③）：把契约上移到**创建函数**这一处 —— 以后谁建 input 都自动带上 type="text"。
     下面还有一条 CSS 兜底（给 document.createElement('input') 直接建的那些）。 */
  if (tag === 'input' && !e.hasAttribute('type')) e.setAttribute('type', 'text');
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
/* ══ v1.82 顶栏图标：一套 16×16 线性图标 ══════════════════════════════════
   为什么换：顶栏原来用 14 个 emoji（🎲📟🗺🐈📖👤🎒↩📃⋯⚙）。emoji 是**字体**不是图标——
   各系统渲染不一样、基线不齐、粗细不受控，而且"🎒=物品""↩=快照"这种映射得靠猜。
   这里用 stroke:currentColor 的线性图标：跟着按钮文字色走，不需要额外配色，
   也不需要图标字体/外部资源（world-sim 是零依赖单页应用，不能引 CDN）。
   时代感仍然落在**物件**上（大哥大/舆图的界面本身），不落在工具栏的按钮上。 */
const ICONS = {
  me:     '<circle cx="8" cy="5.4" r="2.5"/><path d="M3.2 13.4c.7-2.2 2.6-3.5 4.8-3.5s4.1 1.3 4.8 3.5"/>',
  log:    '<path d="M4 2.8h7a1.6 1.6 0 0 1 1.6 1.6v8.8H5.6A1.6 1.6 0 0 1 4 11.6z"/><path d="M4 11.6a1.6 1.6 0 0 1 1.6-1.6h7"/><path d="M6.6 5.4h3.6M6.6 7.6h3.6"/>',
  people: '<circle cx="6.2" cy="5.4" r="2.2"/><path d="M2.2 13c.5-2 2.1-3.1 4-3.1s3.5 1.1 4 3.1"/><path d="M10.6 3.6a2.2 2.2 0 0 1 0 4.3"/><path d="M11.4 9.3c1.4.3 2.4 1.3 2.8 2.8"/>',
  goods:  '<path d="M3.4 5.6h9.2l-.8 7.2a1.4 1.4 0 0 1-1.4 1.2H5.6a1.4 1.4 0 0 1-1.4-1.2z"/><path d="M6 5.6V4.4a2 2 0 0 1 4 0v1.2"/>',
  docs:   '<path d="M4 2.6h5.2L12 5.4v8H4z"/><path d="M9.2 2.6v2.8H12"/><path d="M6 8h4M6 10.2h4"/>',
  saves:  '<path d="M3.2 7.2a4.8 4.8 0 1 1 1.4 3.4"/><path d="M3 3.6v3.6h3.6"/>',
  more:   '<circle cx="3.6" cy="8" r="1.1"/><circle cx="8" cy="8" r="1.1"/><circle cx="12.4" cy="8" r="1.1"/>',
  settings:'<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M12.4 3.6L11 5M5 11l-1.4 1.4"/>',
  phone:  '<rect x="4.2" y="2.4" width="7.6" height="11.2" rx="1.4"/><path d="M6.6 4.4h2.8"/><path d="M7 11.6h2"/>',
  map:    '<path d="M2.6 4.4 6.2 3l3.6 1.4 3.6-1.4v8.2l-3.6 1.4-3.6-1.4-3.6 1.4z"/><path d="M6.2 3v8.2M9.8 4.4v8.2"/>',
  letter: '<rect x="2.6" y="3.8" width="10.8" height="8.4" rx="1.2"/><path d="M3.2 4.6 8 8.4l4.8-3.8"/>',
  gen:    '<path d="M8 2.4v3.2M8 10.4v3.2M2.4 8h3.2M10.4 8h3.2"/><path d="M4.4 4.4l1.8 1.8M9.8 9.8l1.8 1.8M11.6 4.4 9.8 6.2M6.2 9.8l-1.8 1.8"/>',
  gallery:'<rect x="2.6" y="3.4" width="10.8" height="9.2" rx="1.3"/><circle cx="6" cy="6.6" r="1.1"/><path d="M3.4 11.2 6.6 8.6l2.2 1.8 1.8-1.4 2 1.8"/>',
  play:   '<path d="M5.8 3.8 12.2 8l-6.4 4.2z"/>',
  warn:   '<path d="M8 2.6 14 13H2z"/><path d="M8 6.8v3.1"/><circle cx="8" cy="11.5" r=".55"/>',
  sms:    '<path d="M2.6 4.2h10.8v6.4H7l-3 2.2v-2.2H2.6z"/>',
  clock:  '<circle cx="8" cy="8" r="5.6"/><path d="M8 4.8V8l2.4 1.6"/>',
  calendar:'<rect x="2.6" y="3.6" width="10.8" height="9.4" rx="1.3"/><path d="M2.6 6.4h10.8M5.6 2.4v2.4M10.4 2.4v2.4"/>',
  weather:'<path d="M5 11.6h5.6a2.6 2.6 0 0 0 .2-5.2 3.4 3.4 0 0 0-6.4.9A2.4 2.4 0 0 0 5 11.6z"/>',
  pin:    '<path d="M8 14s4.4-4.2 4.4-7.4A4.4 4.4 0 0 0 3.6 6.6C3.6 9.8 8 14 8 14z"/><circle cx="8" cy="6.6" r="1.6"/>',
  sound:  '<path d="M3.2 6.2h2.4L8.6 3.8v8.4L5.6 9.8H3.2z"/><path d="M11 6.2a2.6 2.6 0 0 1 0 3.6"/>',
  card:   '<rect x="2.6" y="4" width="10.8" height="8" rx="1.2"/><rect x="4.4" y="6.2" width="2.8" height="3.6" rx=".6"/><path d="M9.2 6.6h2.4M9.2 8.6h2.4"/>',
  news:   '<path d="M2.6 4.2h8.2v7.6H4A1.4 1.4 0 0 1 2.6 10.4z"/><path d="M10.8 6h1.4a1.2 1.2 0 0 1 1.2 1.2v3.4a1.2 1.2 0 0 1-1.2 1.2"/><path d="M4.4 6.2h4.6M4.4 8.2h4.6M4.4 10.2h2.8"/>',
  globe:  '<circle cx="8" cy="8" r="5.6"/><path d="M2.6 8h10.8"/><path d="M8 2.4c1.6 1.7 2.4 3.5 2.4 5.6S9.6 11.9 8 13.6C6.4 11.9 5.6 10.1 5.6 8S6.4 4.1 8 2.4"/>',
  disk:   '<path d="M3 4.2A1.2 1.2 0 0 1 4.2 3h6.4l2.4 2.4v6.4A1.2 1.2 0 0 1 11.8 13H4.2A1.2 1.2 0 0 1 3 11.8z"/><path d="M5.6 3v3.2h4.4V3"/><rect x="5.4" y="8.6" width="5.2" height="4.4" rx=".5"/>',
  scroll: '<path d="M4.4 2.8h6.2a1 1 0 0 1 1 1v8.4a1 1 0 0 0 1 1H4.6a1 1 0 0 1-1-1V3.8a1 1 0 0 1 1-1z"/><path d="M5.6 5.6h4M5.6 7.8h4M5.6 10h2.4"/>',
  box:    '<rect x="3" y="3" width="10" height="10" rx="1.6"/>'
};
const TOOL_ICON = { device: 'phone', brick: 'phone', paper: 'map', letter: 'letter' };
function iconSVG(name) {
  return '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" '
       + 'stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
       + (ICONS[name] || ICONS.box) + '</svg>';
}
/* v1.82：开始菜单的 emoji 换成图标（和顶栏/面板同一套）。
   菜单项是按 {label, act} 拼出来的，这里统一后处理：摘掉开头的 emoji、按 act 配图标。
   幂等：第二次跑时 textContent 已经是纯文字，摘不到 emoji，只是重画一次图标。 */
const MENU_ICON = {
  gen: 'gen', import: 'docs', demo: 'gallery',
  resumeWorld: 'play', resume: 'disk', cardbox: 'card', importSave: 'letter',
  settings: 'settings', self: 'me'
};
/* 范围说明：1F000 起步 —— 麻将/多米诺/扑克牌/带圈字母都在 1F000-1F2FF，
   原来从 1F300 起会漏掉 🃏 这类。用 + 连续吃掉多个前导符号。 */
const LEAD_EMOJI = /^[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{25A0}-\u{25FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{20E3}]+\s*/u;
function skinMenuIcons(root) {
  try {
    [].slice.call(root.querySelectorAll('.menu-item')).forEach(function (b) {
      const txt = String(b.textContent).replace(LEAD_EMOJI, '');
      b.innerHTML = iconSVG(MENU_ICON[b.dataset.act] || 'box') + '<span>' + txt + '</span>';
    });
  } catch (e) { __deg("app.js", e); }
}
/* v1.81：界面文案里允许写 **粗体**（给人看的强调），渲染成 <b> 而不是把星号打出来。
   原来有 6 处（存档 / 设置 / 导入 / 框架档位）直接把 ** 显示在界面上 —— 这是"文案从提示词
   直接搬过来、中间少了一层给人看的话"的痕迹。挂在 #panel/#modal 的变更出口，
   以后新加的文案也不用再记得这件事。 */
function renderBold(root) {
  try {
    if (!root) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const hits = [];
    let n;
    while ((n = w.nextNode())) { if (n.nodeValue && n.nodeValue.indexOf('**') >= 0) hits.push(n); }
    for (const t of hits) {
      const parts = String(t.nodeValue).split('**');
      if (parts.length < 3) continue;
      const frag = document.createDocumentFragment();
      parts.forEach((seg, i) => {
        if (!seg) return;
        frag.appendChild(i % 2 ? el('b', null, seg) : document.createTextNode(seg));
      });
      if (t.parentNode) t.parentNode.replaceChild(frag, t);
    }
  } catch (e) { __deg("app.js", e); }
}
(function watchBold() {
  try {
    const mo = new MutationObserver(muts => {
      for (const mu of muts) for (const nd of mu.addedNodes) { if (nd.nodeType === 1) renderBold(nd); }
    });
    ['panel', 'modal'].forEach(id => { const e = document.getElementById(id); if (e) mo.observe(e, { childList: true, subtree: true }); });
  } catch (e) { __deg("app.js", e); }
})();
async function api(path, body) {
  const opt = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {};
  const r = await fetch(path, opt);
  /* v1.76：原来直接 r.json()，服务端返回空响应时用户只看到一句 "Unexpected end of JSON input" ——
     不知道是哪个接口、也不知道是服务端崩了还是没配对。现在把接口名带出来。 */
  const raw = await r.text();
  if (!raw) throw new Error('服务端对 ' + path + ' 返回了空响应（HTTP ' + r.status + '）—— 这一步在服务端崩了，看 %TEMP%\\worldsim.log 的 ★ 500 行');
  let j;
  try { j = JSON.parse(raw); }
  catch (e) { throw new Error('服务端返回了非 JSON（' + path + '，HTTP ' + r.status + '）：' + raw.slice(0, 80)); }
  /* v1.98 · P0-2：被**世界锁**拒绝时，err 里带 busy 标记 —— 调用方据此把它当"稍等"而不是"失败"
     （同一句话，两种处理：失败要玩家重试，忙只要等） */
  if (j && j.err) { const e = new Error(j.err); e.busy = !!j.busy; e.payload = j; throw e; }
  return j;
}
window.__errs = [];
window.onerror = function (msg, src, line) {
  try {
    window.__errs.push(String(msg).slice(0, 200) + ' @line' + (line || '?'));
    if (window.__errs.length > 20) window.__errs.shift();
    toast('页面报错：' + String(msg).slice(0, 200), true);
    // 防锁死兜底：页面报错时必然不是"正常等待中"，立刻解锁输入（若确实在请求中，回合回来后刷新）
    if (typeof busy !== 'undefined' && busy) { busy = false; __localBusy = false; __srvBusy = false; const sb = document.getElementById('send'), cmd = document.getElementById('cmd'); if (sb) { sb.disabled = false; sb.textContent = '行动'; } if (cmd) cmd.disabled = false; }
  } catch (e) { __deg("app.js", e); }
};

// ---------- 即时浮层 ----------
function showWorking(txt, step) {
  let w = document.getElementById('workingfx');
  if (!w) { w = el('div', 'workingfx'); w.id = 'workingfx'; document.body.appendChild(w); }
  w.innerHTML = '';
  w.appendChild(el('div', 'wf-spin'));
  w.appendChild(el('div', 'wf-txt', txt || '正在处理…'));
  if (step) w.appendChild(el('div', 'wf-sub', step));
}
function hideWorking() { const w = document.getElementById('workingfx'); if (w) w.remove(); }
function updateWorking(step, title) {
  const w = document.getElementById('workingfx');
  if (!w) { showWorking(title || '正在处理…', step); return; }
  if (title) { let t = w.querySelector('.wf-txt'); if (t) t.textContent = title; }
  let s = w.querySelector('.wf-sub');
  if (s) s.textContent = step;
}
function jsok() {
  /* UX 版（2026-09-19）：构建号角标**只在 ?dev 出现**。
     原注释说它是"四处指纹"的第三处 —— 那是**开发者**用来判断副本的，不是给玩家看的。
     陌生玩家在第一屏右下角读到 "JS✔ v2.06"，只会得出一个结论：这软件还没做完。 */
  if (!/(\?|&)dev/.test(location.search)) return;
  let b = document.getElementById('jsok');
  if (!b) {
    /* v2.05 修：原来是 position:fixed;left:14px;bottom:64px;z-index:300 —— 实测它正好压在
       「我说 / 我做」那一行上（z-index 300 把字盖住了一半，玩家看到"字上叠着字"）。
       改成 dock 里的一枚**静态角标**（贴在这一行最右），不进 fixed 层就永远压不到别的东西。 */
    b = el('span', 'hint');
    b.id = 'jsok';
    /* v2.05：原来写死 #2f8f6a（旧版薄荷绿，色板里早已不存在）—— 它是"世界外"的角标，
       不占任何语义色，统一走中性灰。 */
    b.style.cssText = 'margin-left:auto;color:var(--dim2);font-size:11px;';
    const qt = document.getElementById('quicktabs');
    (qt || document.body).appendChild(b);
  }
  /* v2.05 修 D2/UI-N4（豆包 + 回执都点名）：这里原来印**真实世界的实时钟**（还会走秒）。
     屏幕上的时间必须是**世界内的时间** —— 否则玩家一边看"1996 年小雨"一边看今天的钟点，
     diegetic 分层当场破功（P2-1.5 §1.1）。构建号留着：它是本项目"四处指纹"里的第三处
     （窗口标题 / 主菜单 buildline / 左下 JS✔），用来判断跑的是不是新副本。 */
  b.textContent = 'JS✔ ' + BUILD;
}

// ---------- 全局事件委托 ----------
// ---------- 未接入 AI 时：AI 相关功能（扫描/生成/卡盒开局）不可用，引导配置；演示世界/读档保留 ----------
function requireAI(what) {
  if (SRVCFG && SRVCFG.baseURL && SRVCFG.model) return true;
  toast('尚未接入 AI 模型——' + what + '需要 AI。请在下面配置一次（baseURL + apiKey + model）', true);
  openSettings();
  return false;
}
const ACTIONS = {
  gen: () => { if (!requireAI('生成世界')) return; genWorld(); },
  import: () => { if (!requireAI('扫描角色卡')) return; openImport(); },
  demo: async () => { try { const r = await api('/api/demo', {}); refresh(r.view); } catch (e) { toast('进入失败：' + e.message, true); } },
  settings: () => openSettings(),
  resume: () => openResume(),
  importSave: () => openImportSave(),
  cardbox: () => { if (!requireAI('角色卡开局')) return; openCardbox(); },
  self: () => openSelfSetup(),
  resumeWorld: async () => {
    // v1.83 修 P1-1：api() 无第二参数 = GET，而 /api/resume-current 只在 POST 分支处理
    // →「继续当前世界」原来必定 404 not found。必须传一个（哪怕空的）body。
    try { const r = await api('/api/resume-current', {}); if (r.view) { refresh(r.view); } else { toast('当前没有已加载的世界', true); } }
    catch (e) { toast('返回失败：' + e.message, true); }
  },
  more: () => toggleTools(),
  selfcheck: () => selfcheck(),
  test: () => { showWorking('测试：你看到这层=JS 活着且点击即时生效。', '1.5 秒后自动消失'); setTimeout(hideWorking, 1500); },
  refresh: () => location.reload(),
  submit: () => { const v = document.getElementById('cmd'); if (v) submit(v.value || ''); },
  diag: async () => {
    const parts = [];
    parts.push('前端：build=' + BUILD + ' delegated=' + !!window.__delegated + ' errs=' + (window.__errs || []).length + ' errList=' + JSON.stringify(window.__errs || []));
    let srv = '（无法取）';
    try { const d = await api('/api/diag'); srv = '服务端: build=' + d.build + ' live=' + d.live + ' world=' + d.world + '\n--- serverLog ---\n' + d.serverLog + '\n--- uiLog ---\n' + d.uiLog; } catch (e) { srv = 'diag接口失败：' + String(e.message || e); }
    parts.push(srv);
    const m = $('#modal');
    m.classList.remove('hidden');
    const box = el('div', 'box');
    box.appendChild(el('h2', null, '诊断（复制后发我）'));
    const ta = el('textarea'); ta.value = parts.join('\n'); ta.style.height = '320px';
    box.appendChild(ta);
    const copy = el('button', null, '全选复制');
    copy.onclick = () => { ta.select(); try { document.execCommand('copy'); toast('已复制', false); } catch (e) { toast('请手动 Ctrl+C', true); } };
    const c2 = el('button', null, '关闭'); c2.onclick = () => m.classList.add('hidden');
    box.appendChild(copy); box.appendChild(c2);
    m.innerHTML = ''; m.appendChild(box);
  }
};
if (!window.__delegated) {
  window.__delegated = true;
  console.log('v1.6 delegation registered');
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.getAttribute('data-act');
    if (act && act.indexOf('tool:') === 0) { openPanel(act.slice(5)); return; }
    if (act && ACTIONS[act]) { e.preventDefault(); ACTIONS[act](t); }
  });
}

// ---------- 菜单 ----------
async function renderStart() {
  try {
    /* UX 版（2026-09-19）：第一屏不出现版本号（"v2.06（构建 v2.06）"写了两遍，且只说明它还没做完）。
       换成一句"这是什么"的话。要看构建号：控制台 BUILD 或 ?dev。 */
    const bl = $('#buildline'); if (bl) bl.textContent = '1996 年，江南小镇。你在这里过日子。';
    $('#app').classList.add('hidden');
    $('#start').classList.remove('hidden');
    __galleryReady = false;                     // 回主菜单：下次进世界重新拉图库（可能换了世界）
    const m = $('#start-menu'); m.innerHTML = '';
    const side = $('#start-side'); side.innerHTML = '';
    let st = {};
    try { st = await api('/api/state'); } catch (e) { __deg("app.js", e); }
    const cfgS = (st && st.config) || {};
    SRVCFG = cfgS;
    const us = cfgS.userSelf || {};
    window.__userSelf = us;
    // ---- 左侧：游戏式菜单 ----
    const grp = (title, items) => {
      const g = el('div', 'menu-group');
      g.appendChild(el('div', 'menu-gt', title));
      for (const it of items) {
        const b = el('button', 'menu-item' + (it.warn ? ' warn' : ''), it.label);
        b.dataset.act = it.act;
        g.appendChild(b);
      }
      m.appendChild(g);
    };
    const startItems = [
      { label: '生成世界', act: 'gen' },
      { label: '导入世界（扫描角色卡）', act: 'import' },
      { label: '演示世界', act: 'demo' }
    ];
    const cont = [];
    if (st.currentWorld) cont.push({ label: '▶ 继续当前世界（' + st.currentWorld + '）', act: 'resumeWorld' });
    cont.push({ label: '读取存档', act: 'resume' });
    cont.push({ label: '读取角色卡开局', act: 'cardbox' });
    cont.push({ label: '导入存档文件', act: 'importSave' });
    /* v2.05 修（P2-1.9）：老玩家回来时，「继续」必须在最上面 ——
       原来第一眼看到的是「生成世界」，手一抖就把新世界开出来了（旧那局其实还在，但很容易以为没了）。
       没有存档的新玩家看到的顺序不变。 */
    if (st.currentWorld) { grp('继续游戏', cont); grp('开始游戏', startItems); }
    else { grp('开始游戏', startItems); grp('继续游戏', cont); }
    const gap = el('div', 'menu-gap'); m.appendChild(gap);
    const s1 = el('button', 'menu-item', '设置'); s1.dataset.act = 'settings'; m.appendChild(s1);
    const selfN = Object.keys(us).length;
    const s2 = el('button', 'menu-item' + (selfN ? '' : ' warn'), '设定 · 我的身份档案' + (selfN ? '（已设定 ' + selfN + ' 项）' : '（未设定）'));
    s2.dataset.act = 'self'; m.appendChild(s2);
    skinMenuIcons(m);
    m.appendChild(el('div', 'minor', '后台在跑：世界只管开一局，剩下的交给 AI（模型接入在「设置」里）'));
    // ---- 右侧：信息面板 ----
    const card = (h) => { const c = el('div', 'side-card'); c.appendChild(el('div', 'sc-h', h)); side.appendChild(c); return c; };
    const mc = card('模型状态');
    if (cfgS.baseURL && cfgS.model) {
      mc.appendChild(el('div', 'sc-b', '已连接：' + cfgS.model));
      mc.appendChild(el('div', 'sc-note', '模式：接入 AI（世界实时生成）'));
    } else {
      mc.appendChild(el('div', 'sc-b warn', '○ 未连接模型 —— 世界为演示组合'));
      const b = el('button', 'mini', '去配置模型'); b.dataset.act = 'settings'; mc.appendChild(b);
    }
    const sc2 = card('我的身份档案');
    if (selfN) {
      sc2.appendChild(el('div', 'sc-b', '[' + [us.name, us.identity].filter(Boolean).join(' · ') + ']'));
      sc2.appendChild(el('div', 'sc-note', '生成世界 / 扫描卡（NPC 模式）时自动带入；游玩中不会触发。'));
    } else {
      sc2.appendChild(el('div', 'sc-note', '未设定。设定后，「生成世界」「扫描角色卡」会自动用上它，让你在哪个世界都是同一个你。'));
    }
    const wc = card('最近存档');
    try {
      const wr = await api('/api/worlds');
      const ws = (wr.list || []).filter(w => w.id).slice(0, 3);
      if (!ws.length) wc.appendChild(el('div', 'sc-note', '（还没有——开始游戏后自动存档）'));
      for (const w of ws) {
        const row = el('div', 'startworld');
        row.appendChild(el('b', null, (w.name || '未名之地') + ''));
        const b = el('button', 'mini', '进入');
        b.onclick = async () => {
          try { const s = await api('/api/world/load', { id: w.id }); refresh(s.view); }
          catch (e) { toast('载入失败：' + e.message, true); }
        };
        row.appendChild(b);
        wc.appendChild(row);
      }
    } catch (e) { wc.appendChild(el('div', 'sc-note', '读取失败')); }
    const cc = card('角色卡盒');
    try {
      const cr = await api('/api/cards');
      const n = cr.count || 0;
      cc.appendChild(el('div', 'sc-b', '已建档 ' + n + ' 张卡'));
      if (n) {
        cc.appendChild(el('div', 'sc-note', '扫描过的卡都在这里：直接开局，不用重新扫描。'));
        const b = el('button', 'mini', '打开卡盒'); b.dataset.act = 'cardbox'; cc.appendChild(b);
      } else {
        cc.appendChild(el('div', 'sc-note', '扫描一张角色卡后自动建档，下次可直接从此开局。'));
      }
    } catch (e) { cc.appendChild(el('div', 'sc-note', '读取失败')); }
    const qc = card('快速上手');
    qc.appendChild(el('div', 'sc-note', '① 主菜单 → 设定：填一次你的身份档案'));
    qc.appendChild(el('div', 'sc-note', '② 生成世界 / 扫描角色卡 → 选一条开场 → 进入'));
    qc.appendChild(el('div', 'sc-note', '③ 在世上说话/做事；世界自行运转，岁时更替，会有大事件'));
    const tc = card('工具');
    const tt = el('div', 'side-tools');
    for (const it of [['自检', 'selfcheck', 'settings'], ['诊断', 'diag', 'docs'], ['测试', 'test', 'play']]) { const b = el('button', 'mini');
      b.innerHTML = iconSVG(it[2]) + '<span>' + it[0] + '</span>'; b.dataset.act = it[1]; tt.appendChild(b); }
    if (st.currentWorld) { const b = el('button', 'mini', '▶ 回到当前世界'); b.dataset.act = 'resumeWorld'; tt.appendChild(b); }
    tc.appendChild(tt);

    /* ── UX 版（2026-09-19）：开始界面只留一个"开始" ────────────────────
       原来：左 8 个按钮（其中 4 个是文件操作：导入世界 / 读取存档 / 导入存档文件 / 读取角色卡开局）、
       右 6 张卡（第一张是「○ 未连接模型 —— 世界为演示组合」，还有「自检 / 诊断 / 测试」）。
       陌生人在这一屏读到的是"一个还没配置好的工具"，而不是"一个能进去过日子的世界"。
       现在：标题 → 一句"这是什么" → **一个主按钮** → 其余（含右栏全部卡片）收进「更多」。
       注意：一个功能都没删，只是不再让它们挤在第一屏。 */
    const primary = el('button', 'menu-primary');
    if (st.currentWorld) { primary.textContent = '继续这局'; primary.dataset.act = 'resumeWorld'; }
    else if (cfgS.baseURL && cfgS.model) { primary.textContent = '开始一局'; primary.dataset.act = 'gen'; }
    else { primary.textContent = '看一局'; primary.dataset.act = 'demo'; }
    const sub = el('div', 'menu-sub', st.currentWorld
      ? ('当前世界：' + st.currentWorld)
      : ((cfgS.baseURL && cfgS.model) ? '由你的 AI 现场生成一个世界' : '不用配置任何东西 —— 先看一局演示世界'));
    const moreWrap = el('div', 'menu-more hidden');
    while (m.firstChild) moreWrap.appendChild(m.firstChild);      // 旧的菜单组整体搬进「更多」
    const sideEl = $('#start-side');
    if (sideEl) moreWrap.appendChild(sideEl);                     // 右栏 6 张卡也搬进来
    const grid = $('#start-grid'); if (grid) grid.classList.add('solo');
    const TG_TXT = '更多（生成 / 导入 / 存档 / 设置 / 身份 …）';
    const tg = el('button', 'menu-toggle', TG_TXT);
    tg.onclick = () => { const hid = moreWrap.classList.toggle('hidden'); tg.textContent = hid ? TG_TXT : '收起'; };
    m.appendChild(primary); m.appendChild(sub); m.appendChild(tg); m.appendChild(moreWrap);
  } catch (e) { toast('菜单渲染出错：' + String(e.message || e), true); }
}

function fmtTok(n) {
  const x = Number(n || 0);
  if (x >= 1000000) return (x / 1000000).toFixed(1) + 'M';
  if (x >= 1000) return (x / 1000).toFixed(1) + 'k';
  return String(x);
}
// 猫状态徽标（插件状态猫的字符化）：待机打盹 / 生成忙碌 / 排队 / 出错
function catFace() {
  const busyNow = (typeof busy !== 'undefined' && busy);
  if (window.__lastErr && !busyNow) return { f: '✘', t: '出错', cls: 'err' };
  const tasks = (V && V.imgTasks) || [];
  if (tasks.length && !busyNow) return { f: '☕', t: '图·' + tasks.length, cls: 'img' };
  if (busyNow) return { f: '✎', t: '生成中', cls: 'busy' };
  return { f: '😺', t: '待机', cls: 'idle' };
}
function renderStatline() {
  // 玩家不看到这一层：时间在顶栏、画图任务在舞台图条、猫已移进顶栏。
  // 只有 URL 带 ?dev 才展开（回合/LLM 用时/token/缓存 —— 开发者信息不上桌）。
  const elBox = document.getElementById('statline');
  if (!elBox) return;
  if (!/(\?|&)dev/.test(location.search)) { elBox.classList.add('hidden'); elBox.innerHTML = ''; return; }
  elBox.classList.remove('hidden');
  elBox.innerHTML = '';
  const st = (__DEV && __DEV.stats) || {};   // v1.86：AI 计量属开发者字段
  const pill = (txt, cls) => { const s = el('span', 'st-pill' + (cls ? ' ' + cls : ''), txt); elBox.appendChild(s); return s; };
  pill('回合 #' + (V.turnN || 1));
  pill('LLM ' + (st.lastMs ? (st.lastMs / 1000).toFixed(1) + 's' : '演示(mock)') + ' · 调用×' + (st.lastCalls || 0) + (V.delegates ? ' · 委派×' + V.delegates : ''));
  pill('输入 ' + fmtTok(st.tokIn) + ' / 输出 ' + fmtTok(st.tokOut) + ' · 缓存 ' + (st.cachePct || 0) + '%');
  if (st.truncated > 0) pill('截断×' + st.truncated + (st.lastFinish ? '（finish=' + st.lastFinish + '）' : ''), 'err');
  // 任务计数属于开发者信息，不上桌（要看就开 ?dev）
}
let __lastWx = null;
let __wxTimer = null;
function playWeatherFx(fx) {
  // v1.42：天气效果器原来找 #stage（已删除）→ 效果一直没生效。现在挂到 #world 里的画上。
  const s = document.getElementById('world');
  const ascii = s ? s.querySelector('.ascii') : null;
  if (!ascii || !fx) return;
  if (fx.kind === 'none') return;
  // 色温
  ascii.style.transition = 'filter 1.2s ease';
  ascii.style.filter = fx.dark ? ('brightness(' + Math.max(0.55, 1 - fx.dark) + ')') : '';
  if (fx.shake) { ascii.classList.remove('wxshake'); void ascii.offsetWidth; ascii.classList.add('wxshake'); setTimeout(() => ascii.classList.remove('wxshake'), 900); }
  // W1：天气必须挂在**场景画自己**身上。旧代码挂 ascii.parentElement（那个 section 包着整块舞台），
  // 实测雨层的 rect 比画高 158px、起点高了 243px —— 雨下在了画上方的空白里，根本没落在画上。
  const host = ascii;
  const old = host.querySelector('.wxfx');
  if (old) old.remove();
  if (fx.mute) { if (fx.note) toast(fx.note, false); return; }
  const wrap = el('div', 'wxfx ' + fx.kind);
  // W2：旧实现用 repeating-linear-gradient 铺一张斜线"布"再整体平移 —— 那不是雨，是一块滑动的布。
  // 改成真粒子：每滴一条短线段，各自有随机 x / 延迟 / 时长（远近景深与错峰）。
  if (fx.kind === 'rain' || fx.kind === 'rain-heavy' || fx.kind === 'rain-light') {
    const heavy = fx.kind === 'rain-heavy';
    const n = heavy ? 46 : (fx.kind === 'rain-light' ? 16 : 30);
    for (let i = 0; i < n; i++) {
      const d = el('i', 'drop');
      const depth = (i % 3);                         // 0 近 1 中 2 远 → 速度/透明度/长度不同
      d.style.left = ((i * 97) % 100) + '%';
      d.style.animationDuration = (heavy ? 0.42 : 0.62) * (1 + depth * 0.45) + 's';
      d.style.animationDelay = '-' + ((i * 37) % 100) / 100 * 1.6 + 's';
      d.style.opacity = String(0.75 - depth * 0.18);
      d.style.height = (heavy ? 16 : 12) - depth * 3 + 'px';
      wrap.appendChild(d);
    }
    if (fx.flash) { wrap.appendChild(el('div', 'flash')); wrap.classList.add('flash-on'); }
  } else if (fx.kind === 'storm') {
    wrap.appendChild(el('div', 'stormwind'));
    for (let i = 0; i < 34; i++) {
      const d = el('i', 'drop slant');
      d.style.left = ((i * 89) % 100) + '%';
      d.style.animationDuration = (0.5 + (i % 3) * 0.18) + 's';
      d.style.animationDelay = '-' + ((i * 53) % 100) / 100 * 1.4 + 's';
      wrap.appendChild(d);
    }
  } else if (fx.kind === 'snow' || fx.kind === 'snow-heavy') {
    for (let i = 0; i < 14; i++) { const s2 = el('span', 'flake', '❄'); s2.style.left = (i * 7.2 + (i % 3) * 2) + '%'; s2.style.animationDelay = (i * 0.23) + 's'; wrap.appendChild(s2); }
  } else if (fx.kind === 'fog') {
    wrap.appendChild(el('div', 'fogA'));
  } else if (fx.kind === 'sun') {
    wrap.appendChild(el('div', 'sunglow'));
  } else if (fx.kind === 'heat') {
    wrap.appendChild(el('div', 'heatwave'));
  } else if (fx.kind === 'cloudy' || fx.kind === 'overcast') {
    wrap.appendChild(el('div', 'cloudshade'));
  }
  host.appendChild(wrap);
  if (fx.note) toast(fx.note, false);
  if (__wxTimer) clearTimeout(__wxTimer);
  __wxTimer = setTimeout(() => { const w = host.querySelector('.wxfx'); if (w) w.remove(); ascii.style.filter = ''; }, Math.round((fx.durSec || 4.5) * 1000));
}

// ---------- v1.47 演出：**引擎原语 + 参数**（AI 用世界里的话起名，引擎负责画） ----------
// 为什么改成原语：世界的内容列不完（架空世界更是如此）。引擎只提供"我能画什么"，
// AI 自由组合；**未知原语走通用兜底，绝不静默失败**（否则就是"演了但什么都没发生"）。
// seq 去重：重绘/刷新不重播同一次演出。
function atomEl(layer, cls, tag) { const d = el(tag || 'div', 'atom ' + cls); layer.appendChild(d); return d; }
function renderAtom(layer, a, host) {
  const k = String((a && a.k) || '');
  const dur = Math.max(0.1, Number(a && a.dur) || 1.4);
  const v = (a && a.v !== undefined && a.v !== null) ? Number(a.v) : 1;
  const ascii = host.querySelector('.ascii');
  const set = (elm, k2, val) => { if (elm) elm.style[k2] = val; };
  if (k === 'unfold') {
    const d = atomEl(layer, 'atom-unfold'); d.style.animationDuration = dur + 's'; d.style.opacity = String(0.35 + 0.65 * v);
  } else if (k === 'turn') {
    const d = atomEl(layer, 'atom-turn'); d.style.animationDuration = dur + 's';
  } else if (k === 'seal') {
    const d = atomEl(layer, 'atom-seal'); d.appendChild(el('div', 'atom-seal-mark', '印'));
    d.style.animationDuration = dur + 's'; d.style.opacity = String(0.4 + 0.6 * v);
  } else if (k === 'pulse') {
    const bar = document.getElementById('topbar') || host;
    bar.classList.remove('fx-pulse'); void bar.offsetWidth; bar.classList.add('fx-pulse');
    setTimeout(() => bar.classList.remove('fx-pulse'), Math.round(dur * 1000 + 300));
  } else if (k === 'flash') {
    const d = atomEl(layer, 'atom-flash'); d.style.animationDuration = Math.max(0.12, dur * 0.5) + 's'; d.style.opacity = String(Math.min(0.7, 0.15 + v * 0.6));
  } else if (k === 'dim') {
    const d = atomEl(layer, 'atom-dim'); d.style.animationDuration = dur + 's'; d.style.background = 'rgba(0,0,0,' + Math.min(0.8, v) + ')';
  } else if (k === 'push') {
    if (ascii) {
      ascii.style.transition = 'transform ' + dur + 's ease';
      ascii.style.transform = 'scale(' + (1 + Math.min(0.5, v)) + ')';
      setTimeout(() => { set(ascii, 'transform', ''); }, Math.round(dur * 1000));
    }
  } else if (k === 'ripple') {
    const d = atomEl(layer, 'atom-ripple'); d.style.animationDuration = dur + 's'; d.style.borderColor = 'rgba(232,180,92,' + (0.25 + 0.5 * v) + ')';
  } else if (k === 'tint') {
    const hue = (a && a.hue !== undefined && a.hue !== null) ? Number(a.hue) : 38;
    const d = atomEl(layer, 'atom-tint');
    d.style.animationDuration = dur + 's';
    d.style.background = 'radial-gradient(circle at 50% 45%, hsla(' + hue + ',60%,55%,' + (0.08 + 0.28 * v) + '), transparent 70%)';
  } else if (k === 'wx') {
    playWeatherFx({ kind: String(a.w || 'overcast'), dark: 0.2, durSec: Math.max(1, dur), note: '' });
  } else {
    // ★ 通用兜底：引擎不认识的**世界自造**原语 → 也要有表现，并且留痕（不静默失败）
    const d = atomEl(layer, 'atom-unknown'); d.style.animationDuration = dur + 's';
    try { console.warn('[fx] 未知原语，走通用兜底：' + k); } catch (e) { __deg("app.js", e); }
    if (window.__errs) window.__errs.push('fx:unknown:' + k);
  }
  return k === 'pulse' ? Math.max(dur, 0.8) : Math.min(dur, 8);
}
function playFx(fx) {
  if (!fx || !fx.atoms || !fx.atoms.length) return;
  const host = document.getElementById('world');
  let maxDur = 0.6;
  if (host) {
    const layer = el('div', 'fxlayer fxrun');
    host.appendChild(layer);
    for (const a of fx.atoms) maxDur = Math.max(maxDur, renderAtom(layer, a, host));
    setTimeout(() => { try { layer.remove(); } catch (e) { __deg("app.js", e); } }, Math.round((maxDur + 0.5) * 1000));
  }
  if (fx.fxName) toast(fx.fxName, false);
}
// 文书查看器（diegetic：一封摊开的信，不是对话框）
function closeDoc() { const n = document.getElementById('docview'); if (n) n.remove(); }
function showDoc(doc, animate) {
  if (!doc) return;
  const old = document.getElementById('docview');
  if (old) old.remove();
  const mask = el('div', 'docmask');
  mask.id = 'docview';
  const paper = el('div', 'docpaper' + (animate === false ? '' : ' opening'));
  const head = el('div', 'dochead');
  head.appendChild(el('span', 'doctitle', doc.title || '（无题）'));
  const close = el('button', 'docclose', '收起 ✕');
  close.onclick = closeDoc;
  head.appendChild(close);
  paper.appendChild(head);
  /* v1.84：这份"纸"在**这个世界**里管什么（AI 起的 kind：传音符 / 玉牒 / 符诏…）
     —— 世界自己长出来的词，此前存了却从不给玩家看。默认 'doc' 不显示（没有名字就不硬安一个）。 */
  const kindWord = (doc.kind && doc.kind !== 'doc') ? String(doc.kind).slice(0, 12) : '';
  const meta = [];
  if (kindWord) meta.push(kindWord);
  if (doc.from) meta.push('来自 ' + doc.from);
  if (doc.to) meta.push('致 ' + doc.to);
  if (doc.t) meta.push(fmtStamp(doc.t));
  if (meta.length) paper.appendChild(el('div', 'docmeta', meta.join(' · ')));
  const body = el('div', 'docbody');
  String(doc.body || '').split(/\n+/).forEach(function (para) {
    if (para.trim()) body.appendChild(el('p', null, para.trim()));
  });
  paper.appendChild(body);
  if ((doc.tags || []).join('').indexOf('印') >= 0) paper.appendChild(el('div', 'docseal', '印'));
  mask.appendChild(paper);
  mask.addEventListener('click', function (e) { if (e.target === mask) closeDoc(); });
  document.body.appendChild(mask);
  setTimeout(function () { try { paper.classList.remove('opening'); } catch (e) { __deg("app.js", e); } }, 1800);
}

// v1.46 文书面板（不依赖载体的入口；信匣里也有同一页）
function panelDocs(p) {
  const docs = (V.docs || []);
  if (!docs.length) { p.appendChild(el('div', 'hint', '还没有可读的文书。世界里出现的信、帖子、告示、账本，都会收在这里。')); return; }
  p.appendChild(el('div', 'hint', '世界里给过你的可读文本都在这里——点开就是原文。'));
  for (const d of docs) {
    const row = el('div', 'conv ' + (d.read ? '' : 'hasunread'));
    row.appendChild(el('span', 'cname', (d.read ? '　' : '● ') + (d.title || '（无题）')));
    row.appendChild(el('span', 'cprev', ((d.brief || '') + ' · ' + fmtStamp(d.t || ''))));
    row.onclick = () => {
      api('/api/doc/read', { id: d.id }).then(r => { if (r && r.doc) showDoc(r.doc, true); if (r && r.view) { V = r.view; renderPanel(); } }).catch(e => toast('打开失败：' + String(e.message || e), true));
    };
    p.appendChild(row);
  }
}

// 信匣 · 文书页：世界里所有"能被读到的东西"（信/帖子/告示/账本/药方…）
function phoneAppDocs(p) {
  phoneShell(p, '文书', () => {
    const docs = (V.docs || []);
    if (!docs.length) p.appendChild(el('div', 'hint', '还没有可读的文书。世界里出现的信、帖子、告示、账本，都会收在这里。'));
    for (const d of docs) {
      const row = el('div', 'conv ' + (d.read ? '' : 'hasunread'));
      row.appendChild(el('span', 'cname', (d.read ? '　' : '● ') + (d.title || '（无题）')));
      const kw = (d.kind && d.kind !== 'doc') ? (String(d.kind).slice(0, 10) + ' · ') : '';   // v1.84：世界自己的叫法
      row.appendChild(el('span', 'cprev', (kw + (d.brief || '') + ' · ' + fmtStamp(d.t || ''))));
      row.onclick = () => {
        api('/api/doc/read', { id: d.id }).then(r => { if (r && r.doc) showDoc(r.doc, true); if (r && r.view) { V = r.view; renderPanel(); } }).catch(e => toast('打开失败：' + String(e.message || e), true));
      };
      p.appendChild(row);
    }
  });
}

function refresh(view) {
  if (!view) return;
  if (view.noWorld) { renderStart(); return; }
  const wxNew = (view.weather && view.weather.text) || (view.weather || '');
  const wxFx = view.weatherFx;
  if (wxNew !== __lastWx) { __lastWx = wxNew; setTimeout(() => playWeatherFx(wxFx), 260); }
  if (view.weatherCue && (!window.__lastCue || window.__lastCue !== view.weatherCue)) {
    window.__lastCue = view.weatherCue;
    setTimeout(() => toast(view.weatherCue, false), 800);
  }
  // v1.46 本回合演出（按 seq 只播一次）+ 文书展开（动画与正文一起到）
  if (view.fx && view.fx.seq && view.fx.seq !== __lastFxSeq) { __lastFxSeq = view.fx.seq; setTimeout(() => { try { playFx(view.fx); } catch (e) { __deg("app.js", e); } }, 220); }
  if (view.openDoc && view.openDoc.seq && view.openDoc.seq !== __lastDocSeq) { __lastDocSeq = view.openDoc.seq; setTimeout(() => { try { showDoc(view.openDoc.doc, true); } catch (e) { __deg("app.js", e); } }, 260); }
  if (/(\?|&)dev/.test(location.search)) { loadDev().then(function () { try { renderStatline(); } catch (e) { __deg("app.js", e); } }); }
  setTimeout(autoRender, 1500);
  V = view;
  if (view.config) { SRVCFG = view.config; if (view.config.userSelf) window.__userSelf = view.config.userSelf; }
  $('#start').classList.add('hidden');
  $('#app').classList.remove('hidden');
  if (!__galleryReady) {
    __galleryReady = true;                                   // 防重入
    loadGallery().then(() => { try { renderStage(); } catch (e) { __deg("app.js", e); } }); // 图库到位 → 重绘舞台（场景图/内联图卡）
  }
  /* v1.98 · P0-2：服务端说的"世界正忙"在这里生效（view.busy 由 /api/state 外挂，见 server.js） */
  try { if (view && Object.prototype.hasOwnProperty.call(view, 'busy')) setBusy(!!view.busy, true); } catch (e) { __deg("app.js", e); }
  for (const fn of [renderTopbar, renderStage, renderChips, renderPanel, renderStatline]) {
    try { fn(); } catch (e) { try { toast('界面渲染出错：' + String(e.message || e), true); } catch (e2) { __deg("app.js", e2); } }
  }
  try { jsok(); } catch (e) { __deg("app.js", e); }
}

// 图库是"第二个数据源"（图和任务分别来自 /api/gallery/list 与 /api/state）：
// 两者不同步 = 任务显示 done 但图不显示、必须手动刷新（§6.9 的真正根因）。
// 所以改成"进世界后拉一次，到位再重绘舞台"，而不是启动时拉一次空表。
// 出图收尾（统一）：重载图库列表 → 拉最新 state → 刷新界面（图卡/立绘/相册即时出现）
async function afterRenderDone() {
  try {
    await loadGallery();
    const s = await api('/api/state');
    if (s && !s.noWorld) { V = s; refresh(s); try { renderPanel(); } catch (e) { __deg("app.js", e); } }   // v1.62：出图完立刻重绘面板（否则要退出去重进，§6.9）
  } catch (e) { __deg("app.js", e); }
}
// 生图自动渲染（设置开启时：提示词就绪的任务逐条提交 ComfyUI）
let __rendering = false;
/* v1.80 用户：「信息往下拉自动给我顶到最上面」——真凶在这里。
   refresh() 每次都 setTimeout(autoRender, 1500)；autoRender 的 finally 里又 afterRenderDone() → refresh() → 再排一次。
   于是**只要有一个没出完的图任务，界面就每 2 秒重画一次**（日志实测：api state + api gallery-list 每 2 秒刷一整排），
   而每次重画都执行 s.scrollTop = 0 → 玩家被反复顶回这一幕开头。
   修法：**同一个任务在一次会话里只自动试一次**，失败就交给玩家点重试，绝不空转重画。 */
let __autoTried = {};
async function autoRender() {
  if (__rendering) return;
  if (!(SRVCFG && SRVCFG.image && SRVCFG.image.enabled && SRVCFG.image.base && SRVCFG.image.workflowJson)) return;
  const todo = ((V && V.imgTasks) || []).filter(t => (t.status === 'prompted' || t.status === 'queued') && !__autoTried[t.id]);
  if (!todo.length) return;
  for (const t of todo) __autoTried[t.id] = 1;
  __rendering = true;
  try {
    for (const t of todo) {
      try { const r = await api('/api/comfy/render', { id: t.id }); if (r.ok || r.status === 'done') toast('画面已生成', false); }
      catch (e) { __deg("app.js", e); }
    }
  } catch (e) { __deg("app.js", e); } finally {
    __rendering = false;
    afterRenderDone();
  }
}
// ---------- 舞台 ----------
function hashHue(name) {
  let h = 0; const s = String(name || '?');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}
function av(name, size) {
  const d = el('span', 'av');
  d.style.width = (size || 26) + 'px'; d.style.height = (size || 26) + 'px';
  d.style.background = 'hsl(' + hashHue(name) + ',55%,36%)';
  d.textContent = String(name || '?').slice(0, 1);
  // 头像的首字是**纯视觉**的：它和旁边的 .who 全名是同一个人的两种呈现。
  // 不标记的话，读屏/复制文本会拼成「沈沈姨」（实测）。
  d.setAttribute('aria-hidden', 'true');
  return d;
}
function spSafe(s) { if (!s) return ''; return /^[a-zA-Z]+_?\d+$/.test(String(s)) ? '？' : String(s); }
// 长文本折叠：超过 150 字 → 预览+展开按钮
function longText(text) {
  const e = el('span', null, '');
  const s = String(text || '');
  if (s.length <= 150) { e.textContent = s; return e; }
  const sh = el('span', null, s.slice(0, 140) + '……');
  const full = el('span', null, s); full.style.display = 'none';
  const b = el('button', 'mini', '展开全部');
  b.onclick = () => {
    const open = full.style.display !== 'none';
    full.style.display = open ? 'none' : 'inline';
    sh.style.display = open ? 'inline' : 'none';
    b.textContent = open ? '展开全部' : '收起';
  };
  e.appendChild(sh); e.appendChild(el('span', null, ' ')); e.appendChild(b); e.appendChild(full);
  return e;
}
// 生图是否启用（前端兜底：后端已在登记端拦，这里防旧存档残留的 imgTasks）
function imgEnabled() { return !!(SRVCFG && SRVCFG.image && SRVCFG.image.enabled); }
// 舞台主视觉：生图（渲染出来的那张）与场景画（你脑内的那张）是**同一件事的两个精度**，
// 占同一个位置——有图看图，没图看你脑内的。场景类任务（who 为空）优先于人物立绘。
function latestSceneImage() {
  if (!imgEnabled()) return null;
  const gal = (typeof __gallery !== 'undefined' ? __gallery : []);
  if (!gal.length) return null;
  const tasks = (V && V.imgTasks) || [];
  const here = (V && V.place && V.place.id) || '';
  const pick = (onlyScene) => {
    for (let i = tasks.length - 1; i >= 0; i--) {
      const t = tasks[i];
      if (t.status !== 'done') continue;
      // **必须匹配当前场景** —— 否则离开这个场景后，舞台上还一直挂着上次那张图
      // （实测 bug：走哪儿都是同一张）。老任务没有 sceneId → 不参与选图，宁可显示场景画。
      if (!t.sceneId || t.sceneId !== here) continue;
      const ids = Array.isArray(t.who) ? t.who : [];
      if (onlyScene && ids.length) continue;
      const hit = gal.find(x => x.id === t.id);
      if (hit) return hit;
    }
    return null;
  };
  return pick(true) || pick(false);
}
// 图注 = **世界事实**（谁 · 在哪），绝不是提示词。
// 引擎内部的 note / state / sceneTitle / prompt 一律不出现在界面任何角落——
// 玩家要看的是画本身，不是"这张画是怎么生成的"。
function imgCaption(o) {
  o = o || {};
  let ids = o.who;
  ids = Array.isArray(ids) ? ids : String(ids || "").split(",").filter(Boolean);
  const names = ids.map(id => { try { return nameOf(id); } catch (e) { return ""; } }).filter(Boolean).slice(0, 3);
  const plc = (V && V.place && V.place.name) || "";
  const parts = [];
  if (names.length) parts.push(names.join("、"));
  if (plc) parts.push(plc);
  return parts.join(" · ") || "画面";
}

function imgInline(ids) {
  const w = el('div', 'img-inline');
  if (!imgEnabled()) return w;                 // 关着就不画图位
  const tasks = (V && V.imgTasks) || [];
  for (const id of (ids || [])) {
    const t = tasks.find(x => x.id === id);
    if (!t) continue;
    const g0 = (typeof __gallery !== 'undefined' ? __gallery : []).find(x => x.id === id);
    if (t.status === 'done' && g0) {
      const cap = imgCaption(t);
      const im = document.createElement('img');
      im.src = '/api/gallery/img?id=' + g0.id;
      im.className = 'img-inline-img';
      im.title = cap;
      im.onclick = () => showModalImg(im.src);
      w.appendChild(im);
      w.appendChild(el('div', 'img-inline-cap', cap));
    } else if (t.status === 'rendering') {
      w.appendChild(el('span', 'img-inline-chip', '渲染中…'));
    } else if (t.status === 'fail') {
      const b = el('button', 'mini img-inline-btn', '重试');
      b.onclick = async () => { b.textContent = '渲染中…'; try { const r = await api('/api/comfy/render', { id }); if (r.ok) { toast('重试成功', false); afterRenderDone(); } else toast('失败：' + (r.err || '?'), true); } catch (err) { toast(err.message, true); } b.textContent = '重试'; };
      w.appendChild(b);
      w.appendChild(el('span', 'hint img-inline-chip', String(t.err || '').slice(0, 26)));
    } else {
      const b = el('button', 'mini img-inline-btn', '生成');
      b.onclick = async () => {
        b.textContent = '渲染中…'; b.disabled = true;
        try { const r = await api('/api/comfy/render', { id }); if (r.ok) { toast('画面已生成', false); afterRenderDone(); } else toast('失败：' + (r.err || '?'), true); }
        catch (err) { toast(err.message, true); }
        b.textContent = '生成'; b.disabled = false;
      };
      w.appendChild(b);
    }
  }
  return w;
}
function beatLine(L) {
  const e = el('div', 'beat');
  if (L.type === 'dialogue') {
    e.className = 'beat dialogue';
    const who = spSafe(L.speakerName || L.speaker || '');
    /* 排版分层（用户点名「文字要用对地方」）：台词是舞台主角，动作/神态是贴身副标题。
       ── v1.89 修正（审视 §8.3 的「五环泄漏」）──────────────────────────────
       原来这里只有一段注释说「语气不再渲染成一个标签 —— 是 Tell 不是 Show」，
       然后**把 expression/voice 降级成了 data-mood 属性**：只匹配 4 个词、改一条 2px 左边框。
       那个原则是对的，执行方式是错的：在**视觉**介质里你不说情绪，因为看得见；
       在**文字**介质里你不说情绪，就什么都没有 —— Show 要求换一种写法，不是删掉交付渠道。
       现在：expression/voice 是玩家真的会读到的文字（AI 侧已改成「写可被感知的征候，不写情绪词」）。 */
    const main = el('div', 'dlg-main');
    main.appendChild(el('span', 'who', who));
    // 动作从台词里解放出来：有独立槽位就用它，否则退回从 text 里的（）括号提取（兼容旧存档）
    let said = String(L.text == null ? '' : L.text);
    let act = L.action ? String(L.action) : '';
    const m = said.match(/^\s*[（(]([^）)]{1,60})[）)]\s*/);
    if (!act && m) { act = m[1]; said = said.slice(m[0].length); }
    // 看得见的两样并成一行（身体 + 脸），贴着说话的人
    const seen = [act, L.expression ? String(L.expression) : ''].filter(Boolean).join('，');
    if (seen) main.appendChild(el('div', 'dlg-act', seen));
    main.appendChild(el('div', 'line', '「' + said + '」'));
    // 听得见的那样放在台词下面一行 —— 它描述的是「这句话是怎么说出来的」
    if (L.voice) main.appendChild(el('div', 'dlg-cue', String(L.voice)));
    e.appendChild(av(who || '?'));
    e.appendChild(main);
  } else if (L.type === 'user-action') {
    e.className = 'beat user-action';
    e.appendChild(el('b', null, (V.playerName || '你') + ' ▸'));
    e.appendChild(document.createTextNode(L.text.replace(/^你:\s*/, '')));
  } else if (L.type === 'action') {
    // 人物动作：属于某个人 → 标注归属；无归属的才是纯叙述
    e.className = 'beat action';
    const ac = spSafe(L.actorName || L.actor || '');
    if (ac) e.appendChild(el('span', 'actor', ac));
    e.appendChild(longText(L.text));
  }
  else if (L.type === 'reaction') {
    /* v1.97：**世界对你的反应**（buildReaction：关系/情绪/记忆真的变了才有这一行）。
       它和 outcome 是两件事：outcome 是"你做的动作的确定性结果"（琥珀＝玩家的痕迹），
       reaction 是世界回给你的那一句（安静、靠左、暗色）。这一档样式一直在，只是从来没有生产端。 */
    e.className = 'beat reaction';
    e.appendChild(longText(L.text));
  }
  else if (L.type === 'outcome') {
    /* v1.89：**结果行** —— 玩家自己动作的确定性结果。
       引擎算出来的结论（「你买好了去临江的车票——30块」）原来只喂给 AI 和 records，
       玩家的屏幕上一条通道都没有。现在它是叙事流里独立的一档：安静、靠左、用 --amber
       （语义色板里 --amber 的定义正是「玩家的痕迹」）。 */
    e.className = 'beat outcome';
    e.appendChild(el('span', 'outcome-mark', '▸'));
    e.appendChild(el('span', 'outcome-text', String(L.text || '')));
  }
  else if (L.type === 'ambient') { e.className = 'beat ambient'; e.appendChild(longText(L.text)); }
  else if (L.type === 'stage-tag') { e.className = 'stage-tag'; e.textContent = L.text; }
  else { e.className = 'beat narration'; e.appendChild(longText(L.text)); }
  if (L.imgs && L.imgs.length) e.appendChild(imgInline(L.imgs)); // 生图进叙事流：图卡内联在对应 beat 之后
  return e;
}
// 增量入场游标：只有"本回合新出现的"内容才播入场动画
// （全量重绘 + 元素自带动画 = 每回合整屏重播淡入 = 闪烁）
let __drawnTo = 0, __lastScene = '';
let __storyTop = 0;   // v1.80：叙事栏滚到哪儿了（重渲染时要保住 —— 用户：「信息往下拉自动给我顶到最上面」）
function renderStage() {
  /* v1.33 新布局（《UIUX重设计方案》§3）：
     #world = 世界（场景画/场景图，直接落在背景上）
     #now   = 此刻（本回合叙事）+ 折叠的上一幕
     在场人物不再单独占一行 —— 已由顶栏的世界上下文与「你注意到」承载，
     旧版"舞台上方一排头像"是"什么都占一块"的典型。 */
  const world = $('#world');
  const s = $('#now');
  if (!world || !s) return;
  // v1.80：记住玩家滚到哪儿了（下面会把内容清空重画，清空那一刻 scrollTop 会被浏览器夹成 0）
  if (!s.__topBound) { s.__topBound = true; s.addEventListener('scroll', function () { __storyTop = s.scrollTop; }); }
  world.innerHTML = '';
  s.innerHTML = '';
  /* v1.35：场景尺寸**按复杂度给**（用户：不复杂的突出结构，复杂的可以画大一点）
     复杂度只看"这个场景里有几个可交互的东西"——它是玩家真正要读的东西：
       交互点(1) + 在场人物(2) + 场上物品(1.5) + 有场景图(2)
     1–6 分 → 40vh（把空间让给叙事：空房间没什么好看的）
     7–11   → 48vh
     12+    → 56vh（杂货铺这类：热点多，值得占屏）
     ASCII 用 font-size 等比放大，对齐不会坏（等宽字体按比例缩放仍对齐）。 */
  (function sizeScene() {
    const n = (V.interacts || []).length
      + (V.cast || []).length * 2
      + (V.shop || []).length * 1.5
      + ((V.imgTasks || []).some(t => t.status === 'done') ? 2 : 0);
    const h = n >= 12 ? 50 : (n >= 7 ? 45 : 38);
    world.dataset.complexity = n >= 12 ? 'rich' : (n >= 7 ? 'mid' : 'plain');
    world.style.setProperty('--world-h', h + 'vh');
    /* 画**填满**给它的那块（不是固定字号）：
       实测踩到两次——① 字号写死 13px，rich 场景放大后画没跟着大，高度白给；
       ② rich 档给 56vh 时叙事只剩 88px，"正在发生什么"被挤掉。
       现在：高度按复杂度定档（叙事始终留够），字号**反算**——量出行数与可用高，
       在 11–20px 之间取能填满的值（等宽字体等比缩放不破坏 50 列对齐）。 */
    fitSceneFont();
  })();
  const log = (V.sceneLog || []);
  let cur = -1;
  for (let i = 0; i < log.length; i++) { if (log[i].type === 'stage-tag') cur = i; }
  const act = cur >= 0 ? log.slice(cur) : log;
  const hist = cur > 0 ? log.slice(0, cur) : [];
  if (hist.length) {
    const fold = el('div', 'story-fold');
    /* UX 版（2026-09-19）：**默认展开**。
       原来默认收起 → 右列上半截 4 行字、下半截 330px 全空，第一印象是"这界面坏了"。
       上一幕本来就是内容：读者得知道"刚才发生了什么"才接得上。
       超过 14 行才收起（那时它确实会变成一堵墙）。 */
    const openHist = hist.length <= 14;
    const btn = el('button', 'mini', openHist ? ('▲ 收起上一幕（' + hist.length + ' 行）') : ('▼ 上一幕（' + hist.length + ' 行）'));
    const wrap = el('div', openHist ? '' : 'hidden');
    for (const L of hist) wrap.appendChild(beatLine(L));
    btn.onclick = () => { const hid = wrap.classList.toggle('hidden'); btn.textContent = hid ? ('▼ 上一幕（' + hist.length + ' 行）') : '▲ 收起上一幕'; };
    fold.appendChild(btn); fold.appendChild(wrap);
    s.appendChild(fold);
  }
  const tag = act.find(l => l.type === 'stage-tag');
  const sceneKey = tag ? tag.text : '';
  const sceneChanged = sceneKey !== __lastScene;
  // 场景图与 ASCII 是"同一件事的两个精度"：图好了就替换画，否则一直是画（设计稿 §3.4）
  const sImg = latestSceneImage();
  if (sImg) {
    const box = el('div', 'stage-img' + (sceneChanged ? ' enter' : ''));
    const im = document.createElement('img');
    im.src = '/api/gallery/img?id=' + sImg.id;
    im.onclick = () => showModalImg(im.src);
    box.appendChild(im);
    box.appendChild(el('div', 'stage-img-cap', imgCaption(sImg)));
    world.appendChild(box);
  } else if (V.sceneArt) { const wrap = el('div', 'ascii' + (sceneChanged ? ' enter' : '')); wrap.appendChild(artGrid(V.sceneArt, V.artMarks)); world.appendChild(wrap); }
  world.onclick = (ev) => { if (!ev.target.closest('.mark') && !ev.target.closest('.amenu')) closeMenu(); };
  // 增量：日志变短（换世界/读档/回退）→ 全部当新的；否则只有新增的 beat 播入场
  if (log.length < __drawnTo) __drawnTo = (cur >= 0 ? cur : 0);
  let abs = (cur >= 0 ? cur : 0);
  for (const L of act) {
    if (L.type !== 'stage-tag') {
      const e = beatLine(L);
      if (abs >= __drawnTo) e.classList.add('enter');
      s.appendChild(e);
    }
    abs++;
  }
  /* v1.97：教程提示单独一档 —— 引导不是世界内容，所以它不在 sceneLog 里（见 game.js 的注释），
     由视图字段 V.tutor 带过来；只在它产生的那个回合显示。 */
  if (V.tutor) {
    const e = el('div', 'beat tutor');
    if (abs >= __drawnTo) e.classList.add('enter');
    e.appendChild(el('span', 'tutor-mark', '◇'));
    e.appendChild(el('span', 'tutor-text', String(V.tutor)));
    s.appendChild(e);
  }
  __drawnTo = log.length;
  __lastScene = sceneKey;
  /* v1.80 用户：「信息往下拉自动给我顶到最上面」。
     原来这里**无条件** s.scrollTop = 0 —— 任何一次重渲染（点一次生图、出图完成、任何 refresh）
     都会把玩家从半路拽回这一幕的开头。现在：**换幕才跳顶；同一幕里保住你原来滚到哪儿**。 */
  const keepTop = sceneChanged ? 0 : (__storyTop || 0);
  renderImgBar(s);
  s.scrollTop = keepTop;
  if (keepTop > 0) { try { requestAnimationFrame(function () { try { s.scrollTop = keepTop; } catch (e) { __deg("app.js", e); } }); } catch (e) { __deg("app.js", e); } }
  fitSceneFont();
}
/* 场景字号规则（用户 2026-09-14 定）：
   「不限制，画出来怎样就是怎样（别出现 UI 错误）。可以做个限制：
     字符数大于多少那字号就可以减小，字符数大于多少就增加。」
   落地成两条：
     ① 列数/行数多 → 字号自动变小；少 → 自动变大；
     ② 下限 13px：到了下限还放不下就**允许滚动**（不裁、不叠、不破框）= "别出 UI 错误"。
   等宽字体等比缩放不破坏对齐，所以字号是安全的调节旋钮。 */
/* v1.81：上限从 22 提到 30 —— 宽屏并排后世界区拿到整列高度，22px 会让画停在 ~669px 宽、
   两侧仍空 250px。真正的上界由 fsByH/fsByW 两个约束给，MAX 只做兜底。 */
const ASCII_FS_MIN = 13, ASCII_FS_MAX = 30;
function fitSceneFont(force) {
  const world = $('#world');
  if (!world) return;
  const grid = world.querySelector('.artgrid');
  if (!grid) { world.style.removeProperty('--ascii-fs'); world.classList.remove('art-scroll'); return; }
  if (grid.offsetHeight <= 0) return;
  const rows = grid.querySelectorAll('.artrow').length || 1;
  // 列数从画本身量（画多大由后端/模板决定，前端不假设）
  const first = grid.querySelector('.artrow');
  const cols = Math.max(1, Math.round((first ? first.innerText.length : 50)));
  const availH = (world.clientHeight || 0) - 10;
  const availW = (world.clientWidth || 0) - 10;
  if (availH <= 40) return;
  /* v1.81：量**真实字符步进**，不要假设 1.02em ——
     Sarasa Mono 的框线/制表符实测 ≈0.586em，按 1.02 估会把可用宽度低估 1.7 倍，
     于是"宽度明明够却算成不够"，画永远填不满（实测两侧各空 400px）。 */
  let adv = 0.586;
  try {
    const n = Math.min(cols, 60);
    const probe = document.createElement('span');
    probe.textContent = '█'.repeat(n);
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:inherit;line-height:1';
    grid.appendChild(probe);
    const pw = probe.getBoundingClientRect().width;
    grid.removeChild(probe);
    const pf = parseFloat(getComputedStyle(grid).fontSize) || 16;
    if (pw > 0 && pf > 0) adv = (pw / n) / pf;   // em 相对量，与当前字号无关
  } catch (e) { __deg("app.js", e); }
  const rowF = 1.55;                             // 行距实测 ≈1.5em（.artrow 里有可点热点，撑高了行盒）
  const fsByH = availH / (rows * rowF);
  const fsByW = availW / (cols * adv);
  let fs = Math.min(ASCII_FS_MAX, fsByH, fsByW);
  fs = Math.max(ASCII_FS_MIN, Math.round(fs * 10) / 10);
  world.style.setProperty('--ascii-fs', fs + 'px');
  const needW = cols * fs * adv + 2, needH = rows * fs * rowF;
  world.classList.toggle('art-scroll', (needW > availW + 2) || (needH > availH + 2));
}
// 图任务条：摘要（简略概括而非原始触发词）+ 生图/查看按钮
function showModalImg(url) {
  const m = $('#modal'); m.classList.remove('hidden'); m.innerHTML = '';
  const bx = el('div', 'box');
  const im = document.createElement('img');
  im.src = url; im.style.cssText = 'max-width:100%;border-radius:10px;';
  bx.appendChild(im);
  const c = el('button', null, '关闭'); c.onclick = () => m.classList.add('hidden');
  bx.appendChild(c);
  m.appendChild(bx);
}
/* v1.63 生图状态条（**常驻**）：插件那套「紧凑条 → 点击开主界面」的适配版。
   数据全部来自引擎已有状态（imgTasks / config.image），零新增后端；关掉生图 = 整条消失。
   sticky 钉在叙事栏顶部：翻剧情时它一直在，不用滚回去找。 */
function renderImgBar(s) {
  if (!imgEnabled()) return;                      // 不启用 = 整条不存在（零占位、零灰条）
  const old = s.querySelector('.imgstrip'); if (old) old.remove();   // 幂等：每回合重建，不叠条
  const IC = (SRVCFG && SRVCFG.image) || {};
  const tasks = (V && V.imgTasks) || [];
  const pending = tasks.filter(t => t.status === 'prompted' || t.status === 'queued').length;
  const busy = tasks.filter(t => t.status === 'rendering').length;
  const failed = tasks.filter(t => t.status === 'fail').length;
  const wired = !!(IC.base && IC.workflowJson);
  /* v1.81：从「7 个 chip + 最多 3 条任务 chip 各带按钮」收成「一行 + 一个动作」。
     世界里不再出现生图的系统细节；看图和参数都进工作台。 */
  let cls = '', icon = 'gallery', text = '生图';
  if (!wired) { cls = 'is-warn'; icon = 'warn'; text = '没接上 ComfyUI'; }
  else if (failed) {
    const f0 = tasks.filter(t => t.status === 'fail')[0];
    cls = 'is-err'; icon = 'warn';
    text = failed + ' 张没出来' + (f0 && f0.err ? '：' + String(f0.err).slice(0, 26) : '');
  }
  else if (busy) { cls = 'is-warn'; text = '正在出图…'; }
  else if (pending) { text = pending + ' 张待出'; }
  const bar = el('div', 'imgstrip' + (cls ? ' ' + cls : ''));
  bar.title = '点这里打开生图工作台';
  const ic = el('span', 'ib-ico'); ic.innerHTML = iconSVG(icon); bar.appendChild(ic);
  bar.appendChild(el('span', 'ib-t', text));
  bar.appendChild(el('span', 'ib-go', '生图 ›'));
  bar.onclick = () => openImageEngine();
  s.insertBefore(bar, s.firstChild);           // 钉在舞台顶部
}
// ---------- 画内交互（SLG）：字符网格 + 可点标记 + 动作菜单 ----------
function artGrid(art, marks) {
  const rows = String(art || '').split('\n');
  const g = el('div', 'artgrid');
  const byRow = {};
  for (const m of (marks || [])) (byRow[m.row] = byRow[m.row] || []).push(m);
  for (let r = 0; r < rows.length; r++) {
    const line = rows[r] || '';
    const rowEl = el('div', 'artrow');
    const ms = (byRow[r] || []).slice().sort((a, b) => a.col - b.col);
    let last = 0;
    for (const m of ms) {
      if (m.col > last) rowEl.appendChild(document.createTextNode(line.slice(last, m.col)));
      const len = (m.len || (m.text ? m.text.length : 0)) || 1;
      const btn = el('button', 'mark', line.slice(m.col, m.col + len) || (m.text || '●'));
      btn.title = '';
      btn.onclick = (ev) => { ev.stopPropagation(); if (ev.preventDefault) ev.preventDefault(); showActions(m.id); };
      rowEl.appendChild(btn);
      last = m.col + len;
    }
    if (last < line.length) rowEl.appendChild(document.createTextNode(line.slice(last)));
    g.appendChild(rowEl);
  }
  return g;
}
function showActions(id) {
  closeMenu();
  const it = (V.interacts || []).find(x => x.id === id);
  if (!it) return;
  const menu = el('div', 'amenu');
  menu.id = 'amenu';
  menu.appendChild(el('span', 'amenu-t', it.label + '：'));
  for (const a of (it.actions || [])) {
    const b = el('button', 'mini', a.label);
    b.onclick = () => {
      closeMenu();
      if (a.say) { submit(a.say); }
      else if (a.panel === 'goods') { openPanel('goods'); }
      else if (a.panel === 'msg') {
        const t = (V.tools || []).find(x => (x.apps || []).indexOf('sms') >= 0);
        if (t) { openPanel(t.id); phoneTab = 'app:msg'; } else toast('没有能发消息的工具', true);
      }
    };
    menu.appendChild(b);
  }
  /* v1.42 修 bug：这里原来挂 #stage —— 该元素在 v1.33 重构时已删除，
     于是**点任何琥珀色热点都会报 "Cannot read properties of null (reading 'appendChild')"**（用户实测）。
     现在挂到 #world（菜单本来就该出现在场景里），并加兜底：找不到容器就挂 body，永不崩。 */
  const host = document.getElementById('world') || document.body;
  if (host) host.appendChild(menu);
}
function closeMenu() { const m = document.getElementById('amenu'); if (m) m.remove(); }

/* ── v1.32 顶栏渐进披露 ──────────────────────────────────────────────
   TILE_KEEP：860px 以上留在顶栏的入口数（再小由 CSS 收成 2 个）；
   其余进「⋯ 更多」浮层。层级判断依据设计纲领 §3「屏幕只放感知/认知/行动」。 */
const TILE_KEEP = 5;
function elab(b, ch) {
  if (!b) return;
  b.tabIndex = 0;
  b.onkeydown = (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); b.click(); }
  };
  if (ch) b.appendChild(ch);
}
function mountTilePanel(topbar, rest) {
  const box = el('div', 'tiles hidden');
  box.id = 'mtiles';
  box.appendChild(el('div', 'tiles-h', '更多'));
  const g = el('div', 'tiles-grid');
  const entries = (rest || []);   // 创作入口在顶栏常驻（keep=1），这里不重复摆一份
  for (const a of entries) {
    const b = el('div', 'tile');
    b.dataset.act = (a[0] === 'gen') ? 'gen' : 'tool:' + a[0];
    b.title = a[2];
    const ic = el('span', 't-i'); ic.innerHTML = iconSVG(a[1]); b.appendChild(ic);
    b.appendChild(el('span', 't-n', a[2]));
    elab(b);
    g.appendChild(b);
  }
  box.appendChild(g);
  topbar.appendChild(box);
}
function toggleTools() {
  const box = document.getElementById('mtiles');
  if (!box) return;
  const open = box.classList.toggle('hidden') === false;
  const btn = document.querySelector('.tool.more');
  if (btn) btn.classList.toggle('on', open);
}
/* v2.05：appendRailToggle() 已删除（连同 ACTIONS.rail、#rail、#railtgl 的样式）。
   它是一个"点了什么也不发生"的窄屏按钮：唤出的 #rail 永远 display:none。
   认知层内容（还悬着的事 / 你记得的）已搬进「我」面板。 */
function closeTiles() {
  const box = document.getElementById('mtiles');
  if (box) box.classList.add('hidden');
  const btn = document.querySelector('.tool.more');
  if (btn) btn.classList.remove('on');
}
document.addEventListener('click', (e) => {
  const box = document.getElementById('mtiles');
  if (!box || box.classList.contains('hidden')) return;
  /* v2.05 修（P2-1.7）：点外面会关，**点了里面的一项却不会关** ——
     于是「更多」里选了"概况/存档"，面板刚开出来就被还挂在屏幕上的菜单挡住（实测）。
     菜单就是菜单：选中一项即收起。这里在捕获阶段先收起，动作交给原来的委托处理器继续跑。 */
  if (e.target.closest('#mtiles .tile')) { closeTiles(); return; }
  if (e.target.closest('#mtiles') || e.target.closest('.tool.more')) return;
  closeTiles();
}, true);

function renderTopbar() {
  /* v1.33：顶栏 = 两行，顺序写死（设计稿 §3.1）
     第一行 .wb-ctx  = 世界上下文：地点 · 时间 · 天气（只读，是"我在哪"）
     第二行 .wb-tools= 工具与系统入口（降权）
     旧版靠 flex-wrap 自然折行，实测折成 3 行且世界上下文掉到最后一行 —— 顺序不可控。 */
  const t = $('#topbar');
  t.innerHTML = '';
  const ctx = el('div', 'wb-ctx');
  const acts = el('div', 'wb-tools');
  t.appendChild(ctx);
  const tpill = el('span', 'pill');
  tpill.innerHTML = iconSVG('clock') + '<span>' + (V.time.precise ? V.time.label : V.time.label + '（体感）') + '</span>';
  ctx.appendChild(tpill);
  if (V.weather && V.weather.unknown) {
    const wb = el('button', 'pill wx');
    wb.innerHTML = iconSVG(V.weather.via === 'sound' ? 'sound' : 'weather')
      + '<span>' + (V.weather.text || '？（去窗边看看）') + '（去窗边确认）</span>';
    wb.onclick = () => submit('我看看窗外');
    ctx.appendChild(wb);
    if (V.weather.heard && !V.weather.seen) {
      const phoneTool = (V.tools || []).find(x => ((x.apps || []).indexOf('weather') >= 0));
      if (phoneTool) {
        const mb = el('button', 'pill wx', '看手机天气');
        mb.onclick = () => { openPanel(phoneTool.id); phoneTab = 'app:weather'; };
        ctx.appendChild(mb);
      }
    }
  } else {
    const wx = V.weather && V.weather.text ? V.weather.text : (V.weather || '');
    const wp = el('span', 'pill wx'); wp.innerHTML = iconSVG('weather') + '<span>' + wx + '</span>';
    ctx.appendChild(wp);
  }
  /* 地点放最前（"我在哪"是第一信息），天气时间退后 */
  const pp = el('span', 'pill plc'); pp.innerHTML = iconSVG('pin') + '<span>' + V.place.name + '</span>';
  ctx.insertBefore(pp, ctx.firstChild);
  const msgTool = (V.tools || []).find(tool => (tool.apps || []).indexOf('sms') >= 0 || (tool.apps || []).indexOf('letters') >= 0);
  if (V.unread > 0 && msgTool) {
    const un = el('button', 'pill badge');
    un.innerHTML = iconSVG(msgTool.icon || 'sms') + '<span>未读 ' + V.unread + '</span>';
    un.dataset.act = 'tool:' + msgTool.id; ctx.appendChild(un);
  }
  /* v1.32 渐进披露：顶栏不再平铺 14 个图标（实测就是这么平铺的）。
     层级来自"世界是不是主体"——世界给的载体（大哥大/舆图）和扮演本身（我/身世/人物/物品/画面）留在台面，
     台面工具（世界书/概况/存档/创作）收进「更多」。窄屏由 CSS 再收一档（1120px 留 5，860px 留 2），不靠人记宽度。 */
  t.appendChild(acts);                     // ★ 第二行（工具）必须挂进顶栏，否则整行不渲染
  const tools = el('span', 'toolbar-top');
  /* v1.81 顶栏分组：**世界给的载体 │ 认知 │ 系统**
     旧版是一条平铺（创作 + 载体 + 我/身世/人物/物品 + 快照 + 文书）——
     三类东西同权重排在一行，"哪个是世界的、哪个是我的、哪个是软件功能"读不出来。
     keep 是"屏宽档位"，不是"要不要显示"（CSS 按三个断点收，见 style.css v1.32 段）：
       1 = 三档都留（世界给的载体 / 快照：宽度不够时它们最不该消失）
       2 = 窄屏（≤860）才收     0 = 中屏（≤1120）就收进「⋯ 更多」 */
  /* UX 版（2026-09-19）：工具按钮**带文字**。
     原来 8 个入口全是无字图标 —— 玩家不知道第二个图标是"舆图"，只能一个个点开试。
     图标负责"扫一眼",文字负责"不用猜";两者都要。 */
  const mkTool = (a) => {
    const b = el('button', 'tool lbl');
    b.innerHTML = iconSVG(a[1]) + '<span>' + a[2] + '</span>';   // a[1] = 图标名（v1.82 起不再是 emoji）
    b.title = a[2];
    b.dataset.keep = (a[3] === 1) ? '1' : (a[3] <= 4 ? '2' : '0');
    b.dataset.act = (a[0].indexOf('tool:') === 0) ? a[0] : 'tool:' + a[0];
    return b;
  };
  // A 世界给的载体（diegetic：大哥大 / 舆图 / 信匣）—— 世界给什么就显示什么
  const grpWorld = (V.tools || []).map(tool => ['tool:' + tool.id, TOOL_ICON[tool.id] || 'box', tool.name, 1]);
  /* UX 版（2026-09-19）：顶栏第二行只留"玩家第一分钟会点的"三件事 + 更多。
     原来 8 个图标 + 「更多」里再 7 项 = **17 个入口同权重平铺** —— 每个都在喊"点我"，
     结果一个都不显眼，新玩家只能靠猜。
     现在：世界给的载体（大哥大/舆图，世界给什么显示什么）+ 人物 + 我 + 更多。
     身世 / 物品 / 快照 / 文书 / 画面 / 世界书 / 概况 / 剧本 / 创作新世界 → 全部进「更多」。 */
  const grpCog = [['people', 'people', '人物', 1], ['me', 'me', '我', 1]];
  /* v1.46：可读文本的入口。世界给的载体（信匣）里有「文书」页；但对**没有信匣的世界**（比如九十年代的大哥大世界），
     纸条/账本同样存在——所以再给一个不依赖载体的面板入口。没文书时不显示（渐进披露）。 */
  const myDocs = (V.docs || []);
  const docsUnread = myDocs.filter(d => !d.read).length;
  if (docsUnread) grpCog.push(['docs', 'docs', '文书 ' + docsUnread, 1]);
  grpWorld.forEach(a => tools.appendChild(mkTool(a)));
  if (grpWorld.length) tools.appendChild(el('span', 'tb-sep'));   // 世界给的 │ 我的
  grpCog.forEach(a => tools.appendChild(mkTool(a)));
  const more = el('button', 'tool more lbl');
  more.innerHTML = iconSVG('more') + '<span>更多</span>';
  more.title = '更多（身世 / 物品 / 快照 / 文书 / 画面 / 世界书 / 概况 / 剧本 / 创作新世界）';
  more.setAttribute('aria-label', '更多面板');
  more.dataset.act = 'more';
  tools.appendChild(more);
  acts.appendChild(tools);
  /* 低频入口收进「更多」：创作新世界（开局在开始菜单也有）、画面 / 世界书 / 概况 / 存档 / 剧本 */
  const rest = [
    ['log', 'log', '身世'], ['goods', 'goods', '物品'], ['saves', 'saves', '快照'],
    ['gallery', 'gallery', '画面'], ['wi', 'log', '世界书'], ['overview', 'globe', '概况'],
    ['archive', 'scroll', '剧本'], ['gen', 'gen', '创作新世界']
  ];
  if (myDocs.length && !docsUnread) rest.unshift(['docs', 'docs', '文书']);
  mountTilePanel(acts, rest);
  const cat = catFace();
  ctx.appendChild(el('span', 'pill catpill', cat.t + ' ' + cat.f));   // 猫是"世界状态"，跟地点/时间/天气同一行
  const g = el('button', 'pill gear' + (V.mode === 'live' ? ' on' : ''));
  g.innerHTML = iconSVG('settings') + '<span>' + (V.mode === 'live' ? '设置·' + (V.apiModel || '已连接') : '设置') + '</span>';
  g.title = '设置'; g.dataset.act = 'settings'; acts.appendChild(g);   // v1.33：不再常驻显示模型状态（开发者信息不上桌）
  /* UX 版（2026-09-19）：「点一下只是帮你起个头，直接写也行」是**第一次玩才需要**的一句话。
     玩过一回合之后它就是屏幕上的噪音 —— 让它自己退场（不是删掉功能，是不再常驻）。 */
  const qh = document.querySelector('#quicktabs .qt-hint');
  if (qh && (V.turnN || 1) > 1) qh.classList.add('hidden');
}
/* v2.05：右栏渲染函数（renderRail）已删除 —— 它的挂载点 <aside id="rail"> 从 v1.33 起就带着
   legacy-hidden（display:none），但每回合仍在跑、仍往里面塞"还悬着的事/你记得的"，
   于是这两块内容**引擎在算、服务端在传、玩家一个字看不到**（P2-1.3 / §4.7）。
   现在内容搬进了「我」面板（认知层），这里只留下这一行通用截断工具供各面板复用。 */
function clip(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }
function renderChips() {
  /* v1.33：胶囊按钮组 → 一行"你注意到"的观测文本（设计稿 §5 感知层）
     理由：胶囊是按钮组语义（"该点什么"），而这里是"世界给你感知到什么"。
     点击仍然可交互（点开是场景内的动作子菜单），但视觉上不是一排按钮。 */
  const c = $('#notice');
  if (!c) return;
  c.innerHTML = '';
  const iv = (V.interacts || []);
  if (iv.length) {
    c.appendChild(el('span', 'notice-h', '你注意到'));
    for (const it of iv) {
      const b = el('button', 'notice-item', it.label || it.id);
      b.onclick = () => showActions(it.id);
      c.appendChild(b);
    }
    const cmd0 = document.getElementById('cmd');
    if (cmd0 && V.place && V.place.name) cmd0.placeholder = '你想做什么？直接写，世界会听懂';
    return;
  }
  if (true) {
    // 退回后端 affordances（旧路径，仅在没有场景交互时兜底）
    for (const a of (V.affordances || [])) {
      const b = el('button', null, a.label);
      b.onclick = () => submit(a.action);
      c.appendChild(b);
    }
  }
  // 没有任何可注意的东西时：给一句世界的空状态，而不是空白
  if (!c.childElementCount) c.appendChild(el('span', 'notice-empty', '四下里一时没什么特别的。'));
}
function applyThemeSel(t) { document.body.dataset.theme = (t && t !== 'mint') ? t : 'mint'; if (!t || t === 'mint') delete document.body.dataset.theme; }
function setBusy(b, fromServer) {
  if (fromServer) __srvBusy = !!b; else __localBusy = !!b;
  const eff = __localBusy || __srvBusy;
  busy = eff;
  const sb = $('#send'); if (sb) sb.disabled = eff;
  const cmd = $('#cmd'); if (cmd) cmd.disabled = eff;
  if (sb) sb.textContent = eff ? '世界在运转…' : '执行';   // 一屏唯一的主操作（设计稿 §8.6 busy 态）
  /* v2.05（P2-1.4）：busy 期间每秒刷新"已等 N 秒"，结束就停表（不在空闲时空转）。 */
  if (eff) { __busyAt = Date.now(); if (!__busyTick) __busyTick = setInterval(paintBusyElapsed, 1000); paintBusyElapsed(); }
  else if (__busyTick) { clearInterval(__busyTick); __busyTick = null; }
}
// ---------- 进入世界过渡（点击进入 → 遮罩过渡 → 画面） ----------
function enterTransition(title, sub) {
  const m = $('#loadmask');
  if (!m) return;
  m.classList.remove('hidden', 'dim');
  const t = m.querySelector('.lm-text'); if (t) t.textContent = title || '⏳ 世界展开中…';
  const s = m.querySelector('.lm-sub'); if (s) s.textContent = sub || '';
}
function hideTransition() {
  const m = $('#loadmask');
  if (!m) return;
  m.classList.add('dim');
  setTimeout(() => { m.classList.add('hidden'); m.classList.remove('dim'); }, 520);
}
async function submit(text) {
  if (busy || !text || !text.trim()) return;
  setBusy(true);
  $('#cmd').value = '';
  let ok = false;
  try {
    // 流式看门狗：150s 无完成 → abort → 自动回退非流式（防"生成中"永久卡死）
    const ctrl = new AbortController();
    const wdog = setTimeout(() => { try { ctrl.abort(); } catch (e) { __deg("app.js", e); } }, 150000);
    const resp = await fetch('/api/turn/stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: ctrl.signal });
    if (resp.ok && resp.headers.get('content-type') && resp.headers.get('content-type').indexOf('text/event-stream') >= 0) {
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let acc = '';
      let result = null;
      showWorking('主 AI 正在写戏…', '');
      let got = 0;
      /* v2.08 修：SSE 块同样必须跨网络分片续接。
         旧写法 chunk.split('\n\n') 把半截块当完整块：前半截 JSON.parse 抛错 continue，
         后半截没有 data: 前缀也 continue —— **两头都丢**。
         这里丢的是 ev.view（整回合结果）→ result 恒为 null → 走下面"回退为一次性生成"
         → **同一个输入被完整重跑一遍**（世界多推一次、token 翻倍），且完全静默。 */
      const eatBlock = (blk) => {
        const line = String(blk).trim();
        if (!line || line.indexOf('data:') !== 0) return;
        let ev = {};
        try { ev = JSON.parse(line.slice(5).trim()); } catch (e3) { return; }
        if (ev.d) { acc += ev.d; got += ev.d.length; updateWorking(null, '回合书写中…（已 ' + got + ' 字，完成后一次性展开）'); }
        else if (ev.view) { result = ev; }
        else if (ev.err) { throw new Error(ev.err); }
      };
      let buf = '';
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        buf += dec.decode(r.value, { stream: true });
        const blks = buf.split('\n\n');
        buf = blks.pop();                 // 尾块可能不完整，留到下一片
        for (const blk of blks) eatBlock(blk);
      }
      buf += dec.decode();                // 冲掉解码器里残留的字节
      if (buf.trim()) eatBlock(buf);      // 服务端没给结尾空行时的最后一块
      clearTimeout(wdog);
      if (result && result.view) {
        refresh(result.view);
        if (result.recalled && result.recalled.length) showRecall(result.recalled);
        ok = true;
      }
    } else clearTimeout(wdog);
    if (!ok) {
      showWorking(null, '流式未完成，回退为一次性生成…');
      const r = await api('/api/turn', { text });
      refresh(r.view);
      if (r.recalled && r.recalled.length) showRecall(r.recalled);
      ok = true;
    }
  } catch (e) {
    // 流式异常/超时 → 回退非流式一次（回合不丢）；仍失败才报错
    showWorking(null, '流式中断，回退为一次性生成…');
    try {
      const r = await api('/api/turn', { text });
      refresh(r.view);
      if (r.recalled && r.recalled.length) showRecall(r.recalled);
      ok = true;
    } catch (e2) {
      /* v1.98 · P0-2：★ 被**世界锁**拒绝不是"回合失败"。
         看门狗 abort 只断了客户端 socket —— 服务端那一回合还在跑、而且会自己 persist。
         玩家什么都没做错，只是模型慢；此时说"回合失败"是假消息（世界其实正在变）。
         所以：说人话 + 过几秒自己看一眼（不做轮询，只补看一次）。 */
      if (e2 && e2.busy) {
        toast('世界还在演算上一回合（它会自己完成）—— 稍等一下就好', false);
        setTimeout(async () => { try { const s = await api('/api/state'); if (s && !s.noWorld) { V = s; refresh(s); } } catch (e3) { __deg("app.js", e3); } }, 4000);
        ok = true;
      } else toast('回合失败：' + String(e2.message || e.message), true);
    }
  } finally { setBusy(false); hideWorking(); }
}

// ---------- 面板 ----------
function openPanel(kind) { if (busy) { toast('世界正在运转，稍等…', false); return; } panelKind = kind; phoneTab = 'home'; renderPanel(); }
function closePanel() { panelKind = null; renderPanel(); }
function renderPanel() {
  const p = $('#panel');
  if (!panelKind) { p.classList.add('hidden'); p.innerHTML = ''; return; }
  p.classList.remove('hidden');
  p.innerHTML = '';
  // 面板头（分层导航：返回 + 胶囊标题 + 状态猫）
  const head = el('div', 'panel-head');
  const x = el('button', 'close', ' ← 返回'); x.onclick = closePanel;
  head.appendChild(x);
  const tt = el('span', 'panel-title');
  const tool = currentTool();
  tt.innerHTML = iconSVG(PANEL_ICON[panelKind] || (tool ? (TOOL_ICON[tool.id] || 'box') : 'box')) + '<span>' + panelLabel(panelKind) + '</span>';
  head.appendChild(tt);
  const cat = catFace();
  head.appendChild(el('span', 'panel-cat ' + cat.cls, cat.f + ' ' + cat.t));
  p.appendChild(head);
  // 内容卡片容器
  const wrap = el('div', 'panel-body');
  p.appendChild(wrap);
  const P = wrap;
  if (currentTool()) { panelDevice(P); return; }
  if (panelKind === 'phone') panelPhone(P);
  else if (panelKind === 'map') panelMap(P);
  else if (panelKind === 'log') panelLog(P);
  else if (panelKind === 'me') panelMe(P);
  else if (panelKind === 'people') panelPeople(P);
  else if (panelKind === 'news') panelNews(P);
  else if (panelKind === 'goods') panelGoods(P);
  else if (panelKind === 'wi') panelWorldInfo(P);
  else if (panelKind === 'overview') panelOverview(P);
  else if (panelKind === 'archive') panelArchive(P);
  else if (panelKind === 'saves') panelSaves(P);
  else if (panelKind === 'gallery') panelGallery(P);
  else if (panelKind === 'docs') panelDocs(P);
}
/* v1.82：面板标题不再带 emoji —— 图标由 renderPanel 用 iconSVG 画（跟顶栏同一套）。
   这里只负责**文字**。 */
const PANEL_ICON = {
  phone: 'phone', map: 'map', me: 'me', log: 'log', people: 'people', news: 'news',
  goods: 'goods', docs: 'docs', wi: 'log', overview: 'globe', archive: 'scroll',
  saves: 'disk', gallery: 'gallery'
};
function panelLabel(k) {
  const t = (V && (V.tools || []).find(x => x.id === k));
  if (t) return t.name;
  return { phone: '手机', map: '舆图', me: '我', log: '身世日志', people: '人物', news: '新闻', goods: '物品', docs: '文书', wi: '世界书', overview: '世界概况', archive: '剧本', saves: '存档', gallery: '画面' }[k] || k;
}
// 世界声明式设备面板：app 来自工具注册表（大哥大只有消息/通讯录，信匣=信件…）
function panelDevice(p) {
  const tool = currentTool();
  const apps = (tool && tool.apps) || [];
  if (apps.length === 1) { renderApp(apps[0], p); return; }
  if (phoneTab.indexOf('chat:') === 0) { renderChat(p, phoneTab.slice(5)); return; }
  if (phoneTab.indexOf('app:') === 0) {
    const aid = phoneTab.slice(4);
    if (aid === 'msg') { phoneAppSms(p, tool && tool.id === 'letter' ? '信札' : '消息'); return; }
    if (aid === 'letters') { phoneAppSms(p, '信札'); return; }
    if (aid === 'docs') { phoneAppDocs(p); return; }
    renderApp(aid, p);
    return;
  }
  phoneHome(p, tool);
}
function renderApp(aid, p) {
  if (aid === 'sms') return phoneAppSms(p, '消息');
  if (aid === 'letters') return phoneAppSms(p, '信札');
  if (aid === 'docs') return phoneAppDocs(p);
  if (aid === 'contacts') return phoneAppContacts(p);
  if (aid === 'clock') return phoneAppClock(p);
  if (aid === 'calendar') return phoneAppCal(p);
  if (aid === 'news') return phoneAppNews(p);
  if (aid === 'weather') return phoneAppWeather(p);
  if (aid === 'map') return phoneAppMap(p);
  if (aid === 'album') return phoneAppAlbum(p);
  phoneHome(p, currentTool());
}
function nameOf(id) { if (id === 'player') return '你'; const pe = (V.people || []).find(x => x.id === id); return (pe && pe.name) ? pe.name : '？'; }
// 消息时间：今天只显 HH:MM；昨天/更早带日期（否则看不懂"9:10"是哪天的）
function relT(t) {
  const s = String(t || '');
  if (s.length < 16) return s;
  const day = s.slice(0, 10), hm = s.slice(11, 16);
  const nowD = String(((V.phoneInfo || {}).clock || '').slice(0, 10));
  if (day === nowD) return hm;
  try {
    const prev = new Date(new Date(nowD + 'T00:00:00').getTime() - 86400000).toISOString().slice(0, 10);
    if (day === prev) return '昨天 ' + hm;
  } catch (e) { __deg("app.js", e); }
  return day.slice(5) + ' ' + hm;
}
function nameOfPlace(id, map) { const n = (map || []).find(x => x.id === id); return (n && n.name) ? n.name : '某处'; }

// ---------- 手机 ----------
function phoneShell(p, appName, content) {
  const st = el('div', 'pstatus');
  st.appendChild(el('span', null, '◯'));
  st.appendChild(el('span', null, (V.time.label || '').slice(0, 5)));
  st.appendChild(el('span', null, '◯'));
  p.appendChild(st);
  if (appName) {
    const hdr = el('div', 'papp-head');
    const back = el('button', 'mini', isSingleTool() ? '‹ 返回' : '‹ 桌面');
    back.onclick = () => { if (isSingleTool()) { closePanel(); } else { phoneTab = 'home'; renderPanel(); } };
    hdr.appendChild(back);
    hdr.appendChild(el('span', 'papp-name', appName));
    p.appendChild(hdr);
    content(p);
  }
}
function phoneHome(p, tool) {
  phoneShell(p, null, null);
  const grid = el('div', 'pgrid');
  const apps = (tool && tool.apps && tool.apps.length) ? tool.apps : ['sms', 'contacts'];
  for (const a of apps) {
    const meta = APP_REG[a]; if (!meta) continue;
    const icon = el('button', 'papp', '');
    const pic = el('span', 'papp-ic'); pic.innerHTML = iconSVG(meta.icon); icon.appendChild(pic);
    icon.appendChild(el('span', 'papp-nm', meta.name));
    const cnt = a === 'sms' ? (V.unread || 0) : (a === 'calendar' ? (V.phoneInfo.claims || []).length : 0);
    if (cnt > 0) icon.appendChild(el('span', 'papp-bd', cnt));
    icon.onclick = () => { phoneTab = 'app:' + (a === 'sms' ? 'msg' : a); renderPanel(); };
    grid.appendChild(icon);
  }
  p.appendChild(grid);
}
function renderChat(p, from) {
  const name = nameOf(from);
  const back = el('button', 'mini', '‹ 消息列表');
  back.onclick = () => { const t = currentTool(); phoneTab = (t && t.id === 'letter') ? 'app:letters' : 'app:msg'; renderPanel(); };
  p.appendChild(back);
  p.appendChild(el('h4', null, name));
  const conv = (V.msgs || []).filter(m => (m.from === from && m.to === 'player') || (m.from === 'player' && m.to === from)).slice().reverse();
  for (const m of conv) {
    const me = m.from === 'player';
    const box = el('div', me ? 'bubble me' : 'bubble them');
    box.appendChild(el('div', null, m.body || ''));
    const bst = me ? (m.status === 'sent' ? ' ·已发' : (m.status === 'delivered' ? ' ·送达' : '')) : ((m.status === 'read' && !m.body) ? ' ·已读·未回' : '');
    box.appendChild(el('div', 'btime', relT(m.t) + bst));
    p.appendChild(box);
  }
  const sendRow = el('div', 'sendrow');
  const inp = el('input'); inp.placeholder = '发送给' + name + '…';
  const bt = el('button', 'mini', '发送');
  bt.onclick = async () => {
    /* v1.98 · P0-2：这条按钮原来**不置忙**（只在入口检查 busy），于是玩家能在回合演算中途
       插一条 /api/msg/send 进来 —— 正是评审认定的"前端可达的并发入口"。
       现在：忙就明说（原来静默 return，玩家以为按钮坏了），发的时候置忙。 */
    if (busy) { toast('世界正在运转，稍等…', false); return; }
    if (!inp.value) return;
    setBusy(true);
    bt.textContent = '…';
    try {
      const v = await api('/api/msg/send', { to: from, text: inp.value });
      refresh(v.view);
      if (v.view && v.view.msgReplyAt) toast('已发送 —— 大概 ' + v.view.msgReplyAt + ' 她才能看到（也可能不回）', false);
    }
    catch (e) { toast((e && e.busy) ? '世界正在运转，稍等…' : ('发送失败：' + e.message), !(e && e.busy)); bt.textContent = '发送'; }
    finally { setBusy(false); }
  };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') bt.onclick(); });
  sendRow.appendChild(inp); sendRow.appendChild(bt);
  p.appendChild(sendRow);
}
function phoneAppSms(p, title) {
  const isLetter = title === '信札';
  phoneShell(p, title || '消息', () => {
    const convs = {};
    for (const m of (V.msgs || [])) {
      if (isLetter && m.via && m.via !== 'letter') continue;
      if (!isLetter && m.via === 'letter') continue;
      const other = m.from === 'player' ? m.to : m.from;
      if (other === 'player') continue;
      if (!convs[other]) convs[other] = [];
      convs[other].push(m);
    }
    const entries = Object.keys(convs);
    if (!entries.length) p.appendChild(el('div', 'hint', '还没有消息。'));
    for (const id of entries) {
      const list = convs[id]; const last = list[0];
      const unread = list.filter(m => m.from === id && m.status === 'unread').length;
      const row = el('div', 'conv ' + (unread ? 'hasunread' : ''));
      row.appendChild(el('span', 'cname', nameOf(id) + (unread ? '  (' + unread + ')' : '')));
      const stTxt = last.status === 'sent' ? '[已发·未回]' : ((last.status === 'read' && !last.body) ? '[已读·未回]' : '');
      row.appendChild(el('span', 'cprev', ((stTxt || last.body || '') + ' · ' + relT(last.t))));
      row.onclick = () => { phoneTab = 'chat:' + id; api('/api/msg/readall', { from: id }).then(r => { V = r.view; renderPanel(); }).catch(() => { renderPanel(); }); };
      p.appendChild(row);
    }
  });
}
function phoneAppContacts(p) {
  phoneShell(p, '通讯录', () => {
    for (const c of (V.phoneInfo.contacts || [])) {
      const row = el('div', 'conv');
      row.appendChild(el('span', 'cname', '▣ ' + c.name + '（' + c.mood + '）'));
      row.onclick = () => { phoneTab = 'chat:' + c.id; api('/api/msg/readall', { from: c.id }).then(r => { V = r.view; renderPanel(); }).catch(() => { renderPanel(); }); };
      p.appendChild(row);
    }
    if (!(V.phoneInfo.contacts || []).length) p.appendChild(el('div', 'hint', '通讯录还是空的。'));
  });
}
function phoneAppClock(p) { phoneShell(p, '时钟', () => { p.appendChild(el('div', 'bigclock', (V.phoneInfo.clock || '').slice(11, 16))); p.appendChild(el('div', 'item', (V.phoneInfo.clock || '').slice(0, 10))); }); }
function phoneAppCal(p) {
  const claims = V.phoneInfo.claims || [];
  let selDate = '';
  phoneShell(p, '日历', () => {
    const nowStr = (V.phoneInfo.clock || '').slice(0, 10);
    const d = new Date(nowStr.replace(' ', 'T'));
    const y = d.getFullYear(), m = d.getMonth();
    p.appendChild(el('div', 'calhead', y + ' 年 ' + (m + 1) + ' 月'));
    const grid = el('div', 'calgrid');
    ['日', '一', '二', '三', '四', '五', '六'].forEach(w => grid.appendChild(el('div', 'calw', w)));
    const firstDay = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    for (let i = 0; i < firstDay; i++) grid.appendChild(el('div', 'cald empty', ''));
    for (let dd = 1; dd <= days; dd++) {
      const ds = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(dd).padStart(2, '0');
      const has = claims.filter(c => c.date === ds).length;
      const cell = el('button', 'cald' + (ds === nowStr ? ' today' : '') + (has ? ' has' : '') + (selDate === ds ? ' sel' : ''), String(dd));
      cell.onclick = () => { selDate = ds; refreshCalArea(); };
      grid.appendChild(cell);
    }
    p.appendChild(grid);
    const area = el('div', 'calarea');
    p.appendChild(area);
    function refreshCalArea() {
      area.innerHTML = '';
      const ds = selDate || nowStr;
      const list = claims.filter(c => c.date === ds);
      area.appendChild(el('div', 'hint', ds + (selDate && selDate !== nowStr ? '（点击日期可换天）' : '（今天）')));
      if (!list.length) area.appendChild(el('div', 'item', '这一天没有安排。'));
      for (const c of list) area.appendChild(el('div', 'item', '▸ ' + (c.when ? c.when + '  ' : '') + c.title));
      const add = el('div', 'sendrow');
      const inp = el('input'); inp.placeholder = '写下这天的安排…';
      const bt = el('button', 'mini', '记下');
      bt.onclick = async () => {
        if (!inp.value) return;
        try { const r = await api('/api/claim/save', { date: ds, title: inp.value, when: '' }); if (r.view) { V = r.view; refreshCalArea(); renderPanel(); } }
        catch (e) { toast('记下失败：' + e.message, true); }
      };
      add.appendChild(inp); add.appendChild(bt);
      area.appendChild(add);
      area.appendChild(el('div', 'hint', '日程来自你答应的事，也可以自己记。'));
    }
    refreshCalArea();
  });
}
function phoneAppNews(p) { phoneShell(p, '新闻', () => panelNews(p, true)); }
function phoneAppWeather(p) {
  const wi = (V.phoneInfo && V.phoneInfo.weatherInfo) || {};
  // 打开天气 app = 玩家确认天气（工具通道）：服务端标记 weatherSeen
  try { api('/api/wxmark', {}).catch(() => { }); } catch (e) { __deg("app.js", e); }
  phoneShell(p, '天气', () => {
    p.appendChild(el('div', 'bigclock', wi.temp || '22°C'));
    p.appendChild(el('div', 'item', '现在：' + (wi.now || '晴')));
    for (const t of (wi.trend || [])) p.appendChild(el('div', 'item', t.t + '　' + t.d));
    p.appendChild(el('div', 'hint', '（已确认当前天气）'));
  });
}
function phoneAppMap(p) {
  phoneShell(p, '地图', () => {
    const cur = V.place.id;
    for (const n of (V.map || [])) {
      const d = el('div', 'node');
      d.appendChild(el('b', n.id === cur ? 'here' : '', n.name + (n.id === cur ? ' ◀ 你在这' : (n.visited ? '' : ' · 听说'))));
      if (n.id !== cur) { const go = el('button', 'mini', '前往'); go.onclick = () => submit('去' + n.name); d.appendChild(go); }
      p.appendChild(d);
    }
    p.appendChild(el('div', 'sysnote', '你脑子里的地图：没去过的地方只有传闻。'));
  });
}

// 手机相册：本世界全部生图（时间倒序）——剧情画面自动入册；点图放大
function phoneAppAlbum(p) {
  loadGallery();
  phoneShell(p, '相册', () => {
    const list = (typeof __gallery !== 'undefined' ? __gallery : []).slice(0, 40);
    if (!list.length) { p.appendChild(el('div', 'hint', '相册是空的——剧情中的画面会自动存进来；人物面板也可生成立绘。')); return; }
    const grid = el('div', 'pgrid');
    for (const g of list) {
      const cell = el('div', 'papp', '');
      cell.style.cssText = 'border:1px solid var(--line2);border-radius:8px;padding:4px;';
      const im = document.createElement('img');
      im.src = '/api/gallery/img?id=' + g.id;
      im.style.cssText = 'width:100%;height:96px;object-fit:cover;border-radius:6px;display:block;cursor:pointer;';
      const t3 = (V && V.imgTasks || []).find(x => x.id === g.id);
      im.title = imgCaption(g);
      im.onclick = () => showModalImg(im.src);
      cell.appendChild(im);
      const cap = imgCaption(g);
      cell.appendChild(el('div', 'hint', (cap || '画面')));
      grid.appendChild(cell);
    }
    p.appendChild(grid);
    p.appendChild(el('div', 'sysnote', '相册＝这个世界出过的画面，可以当存档慢慢回味。'));
  });
}
function panelPhone(p) {
  if (phoneTab.indexOf('chat:') === 0) { renderChat(p, phoneTab.slice(5)); return; }
  if (phoneTab === 'app:msg') { phoneAppSms(p, '消息'); return; }
  if (phoneTab === 'app:contacts') { phoneAppContacts(p); return; }
  if (phoneTab === 'app:clock') { phoneAppClock(p); return; }
  if (phoneTab === 'app:cal') { phoneAppCal(p); return; }
  if (phoneTab === 'app:news') { phoneAppNews(p); return; }
  if (phoneTab === 'app:weather') { phoneAppWeather(p); return; }
  if (phoneTab === 'app:album') { phoneAppAlbum(p); return; }
  if (phoneTab === 'app:map') { phoneAppMap(p); return; }
  phoneHome(p);
}

// ---------- 其它面板 ----------
// ---------- 身世日志（角色扮演：你完全清楚的 + 隐约记得的 + 已想起的） ----------
function panelLog(p) {
  const lg = V.log || { known: [], shadows: [], recalled: [], events: [] };
  p.appendChild(el('div', 'hint', '这是"你"——不是设定页，是你自己心里清楚的事。'));
  /* v1.82：这一屏原来全是「▸ 键：值」「　· 时间　动作」这种拼字符串 + emoji 前缀，
     现在改成真正的两栏行（键/值/时间各占自己的列），emoji 全部去掉。 */
  (function () {
    const ex = V.experience;
    if (!ex || !ex.days || !ex.days.length) return;
    p.appendChild(el('h4', 'hint', '你经历过（按天 · 原文全存）'));
    if (ex.days.length > 1) {
      const bar = el('div', 'tabbar');
      const b0 = el('button', 'mini', '全部'); b0.onclick = () => { __expDay = ''; renderPanel(); };
      bar.appendChild(b0);
      for (const d of ex.days) {
        const b = el('button', 'mini', d.day.slice(5) + '（' + d.n + '）');
        b.onclick = () => { __expDay = d.day; renderPanel(); };
        bar.appendChild(b);
      }
      p.appendChild(bar);
    }
    const days = __expDay ? ex.days.filter(x => x.day === __expDay) : ex.days;
    for (const d of days) {
      const dh = el('div', 'item');
      dh.appendChild(el('span', 'it-p', String(d.day).slice(5)));
      dh.appendChild(el('span', 'it-v', d.digest ? d.digest.slice(0, 60).replace(/^[0-9-]+：/, '') : ''));
      p.appendChild(dh);
      for (const it of (d.items || []).slice(-12)) {
        const line = el('div', 'item exp-line');
        line.appendChild(el('span', 'it-p', String(it.t || '').slice(11, 16)));
        line.appendChild(el('span', 'it-v', String(it.action || '').replace(/^你[:：]\s*/, '')));
        p.appendChild(line);
        if (it.opLog) p.appendChild(el('div', 'hint exp-op', String(it.opLog).slice(0, 70)));
      }
    }
    p.appendChild(el('div', 'sysnote', '共 ' + ex.total + ' 条亲历 · 归档 ' + (ex.archiveDays || 0) + ' 天原文（不在最近的也会留档，翻得到）'));
  })();
  p.appendChild(el('h4', 'hint', '我知道的'));
  for (const k of (lg.known || [])) {
    const d = el('div', 'item');
    d.appendChild(el('span', 'it-n', k.k));
    d.appendChild(el('span', 'it-v', k.v));
    p.appendChild(d);
  }
  if (!(lg.known || []).length) p.appendChild(el('div', 'hint', '（尚未记录）'));
  p.appendChild(el('h4', 'hint', '隐约记得（剧情说到才会想起来）'));
  for (const s of (lg.shadows || [])) {
    const d = el('div', 'item');
    d.appendChild(el('span', 'it-v', s.hint));
    d.appendChild(el('span', 'it-p', '还没想起来'));
    p.appendChild(d);
  }
  if (!(lg.shadows || []).length) p.appendChild(el('div', 'hint', '暂时没有。'));
  if ((lg.recalled || []).length) {
    p.appendChild(el('h4', 'hint', '想起来了'));
    for (const s of (lg.recalled || [])) {
      const d = el('div', 'item');
      d.appendChild(el('span', 'it-n', s.hint || ''));
      d.appendChild(el('span', 'it-p', fmtStamp(s.t || '')));
      p.appendChild(d);
      p.appendChild(el('div', 'hint recall-txt', s.text));
    }
  }
  p.appendChild(el('h4', 'hint', '身世记事'));
  for (const ev of (lg.events || []).slice().reverse()) {
    const d = el('div', 'item');
    d.appendChild(el('span', 'it-p', fmtStamp(ev.t || '')));
    d.appendChild(el('span', 'it-v', ev.title || ''));
    p.appendChild(d);
  }
  if (!(lg.events || []).length) p.appendChild(el('div', 'hint', '（还没写下什么——旧事想起来时，它会记在这里）'));
}
function showRecall(recs) {
  const arr = Array.isArray(recs) ? recs : [recs];
  arr.forEach((rc, i) => setTimeout(() => {
    const d = el('div', 'recallcard');
    d.appendChild(el('div', 'rc-head', '— 你突然想起 —'));
    if (rc.hint) d.appendChild(el('div', 'rc-hint', rc.hint));
    d.appendChild(el('div', 'rc-text', rc.text || ''));
    /* v1.81：卡片原来固定在整个视口正中（top:44%; left:50%）——
       并排布局下，正中那一点正好落在场景画上，等于"世界被一张通知盖住"。
       改成钉在**叙事列**上（世界永远不被盖住，对应设计稿"第一眼是这个世界"）。
       叙事列宽度/位置每次都量，窗口缩放也不会错位。 */
    const nowBox = document.getElementById('now');
    if (nowBox) {
      const r = nowBox.getBoundingClientRect();
      d.style.left = Math.round(r.left + r.width / 2) + 'px';
      d.style.top = Math.round(r.top + Math.min(r.height * 0.42, 220)) + 'px';
      d.style.width = Math.max(200, Math.round(r.width - 28)) + 'px';
    }
    document.body.appendChild(d);
    setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 500); }, 6500);
  }, 600 + i * 2600));
}

function panelMe(p) {
  const me = V.me || {};
  const idn = me.identity || {};
  /* v1.81：原来写死 '你 · ' + me.name + '，' + 年龄 + '岁' —— 世界里 name 就是「你」、
     年龄本身已经是「27 岁」，于是显示成「你 · 你，27 岁岁」。改成分段兜底 + 去重单位。 */
  const _nm = String(me.name || idn.姓名 || '').trim();
  const _age = String(idn.年龄 || '').trim();
  const _idt = String(idn.身份 || '').trim();
  p.appendChild(el('div', 'item',
    '你' + (_nm && _nm !== '你' ? ' · ' + _nm : '')
        + (_age ? '，' + (/岁$/.test(_age) ? _age : _age + '岁') : '')
        + (_idt ? ' · ' + _idt : '')));
  if (idn.职业) p.appendChild(el('div', 'hint', '职业：' + idn.职业));
  if (me.appearance) p.appendChild(el('div', 'hint', '你注意到自己：' + me.appearance));
  if (me.backstory) p.appendChild(el('div', '', '你的来历：' + me.backstory));
  if (me.ability) p.appendChild(el('div', 'hint', '你自认的本事：' + me.ability));
  if (me.secrets) p.appendChild(el('div', 'hint', '你藏在心里的事：' + me.secrets));
  p.appendChild(el('h4', 'hint', '你的状态'));
  const st = me.state || {};
  p.appendChild(el('div', 'item', '疲劳 ' + (st.fatigue || '低') + ' · 饥饿 ' + (st.hunger || '低') + ' · 睡眠 ' + (st.sleep || '正常')));
  /* v2.05：冒号统一用全角（半角 ':' 混在中文里看着像排错了版）。 */
  if (me.money) p.appendChild(el('div', 'item', '钱：' + (me.money.cash || 0) + (me.money.digital ? '（另有电子 ' + me.money.digital + '）' : '') + (me.money.currency || '')));
  p.appendChild(el('div', 'item', '随身：' + ((me.inventory || []).join('、') || '（空）')));
  if (me.bonds && me.bonds.length) {
    p.appendChild(el('h4', 'hint', '你对人的关系'));
    for (const b of me.bonds) p.appendChild(el('div', 'item', '· ' + b.name + '：' + b.tone));
  }
  if (me.memories && me.memories.length) {
    /* v2.05：原来写「（最近）」—— 但这份列表是 funnelMemories 按**记得多牢**排的（memScore 降序），
       不是按时间。老存档里会出现"09-01"排在"06-08"后面，标题等于在骗人。改成照实说。 */
    p.appendChild(el('h4', 'hint', '你记得最牢的事'));
    for (const mm of me.memories.slice(0, 4)) p.appendChild(el('div', 'hint', '· ' + mm.content + (mm.t ? '（' + fmtStamp(mm.t).split(' ')[0] + '）' : '')));
  }
  if (me.claims && me.claims.length) {
    p.appendChild(el('h4', 'hint', '你答应过的事'));
    for (const c of me.claims) p.appendChild(el('div', 'item', '▸ ' + c.date + ' ' + (c.when ? c.when + ' ' : '') + c.title));
  }
  /* v2.05：以下两块原来渲染在隐藏的右栏里（见 clip 上方的注释），玩家看不到。
     搬进「我」面板 —— 它们是"你对这个世界的认知"，正好属于这一层。
     仍然不是任务系统：不判成败、不给建议、不催你去做什么，只把你**已经看见**的线摆出来。 */
  const loose = (V.loose || []);
  if (loose.length) {
    p.appendChild(el('h4', 'hint', '还悬着的事'));
    for (const x of loose) {
      const it = el('div', 'item', '· ' + clip(x.name, 26));
      if (x.why) it.appendChild(el('span', 'hint', '（' + clip(x.why, 20) + '）'));
      p.appendChild(it);
    }
  }
  const mineLog = (V.myLog || []).slice(-5);
  if (mineLog.length) {
    p.appendChild(el('h4', 'hint', '你记得的'));
    for (const l of mineLog) p.appendChild(el('div', 'hint', '· ' + clip(l.text, 42) + (l.t ? '（' + fmtStamp(l.t).split(' ')[0] + '）' : '')));
  }
  if (V.plans && V.plans.length) {
    p.appendChild(el('h4', 'hint', '你的出行计划'));
    for (const pl of V.plans) p.appendChild(el('div', 'item', '▸ 去' + pl.dest + '：' + ({ planned: '票还没买，先记着', aboard: '你在车上', done: '你到了', blocked: '路断了，车折返了' }[pl.status] || pl.status) + (pl.ticket ? '（已买票）' : '（未买票）') + (pl.reason ? ' · ' + pl.reason : '')));
  }
  p.appendChild(el('div', 'sysnote', '这是你对自己的认知——世界另有真相，你不需要全知道。'));
}

function panelMap(p) {
  const cur = V.place.id;
  for (const n of (V.map || [])) {
    const d = el('div', 'node');
    d.appendChild(el('b', n.id === cur ? 'here' : '', n.name + (n.id === cur ? ' ◀ 你在这' : (n.visited ? '' : ' · 听说过的'))));
    const es = (n.edges || []).map(e => nameOfPlace(e.to, V.map) + '(' + e.level + '·' + e.minutes + '分)').join(' ｜ ');
    d.appendChild(el('div', 'hint', '连通：' + es + (n.open ? ' · 开放：' + n.open : '')));
    if (n.id !== cur) { const go = el('button', 'mini', '前往'); go.onclick = () => submit('去' + n.name); d.appendChild(go); }
    p.appendChild(d);
  }
  p.appendChild(el('div', 'sysnote', '没去过的地方只有传闻；去过的地方才认得出路。'));
}
let __gallery = [];
let __portraitBusy = {};
let __lookBusy = {};   // 「TA 长什么样」按需生成：每人只请求一次（写进印象层后长期复用，0 成本）
async function loadGallery() { try { const r = await api('/api/gallery/list'); __gallery = r.list || []; } catch (e) { __deg("app.js", e); } }
function galleryImgFor(id) {
  const g = __gallery.filter(x => (x.who || '').split(',').indexOf(id) >= 0).sort((a, b) => String(b.t).localeCompare(String(a.t || '')));
  return g[0] || null;
}
// 三态立绘按钮（插件式：生成/重新生成/重试；生成中禁用）
function portraitBtn(pe, g0) {
  const latest = ((V && V.imgTasks) || []).filter(t => (t.who || []).indexOf(pe.id) >= 0).slice(-1)[0];
  const busy = __portraitBusy[pe.id];
  const b = el('button', 'mini');
  b.innerHTML = iconSVG('gallery') + '<span>' + (busy ? '生成中…' : (latest && latest.status === 'fail' ? '重试' : (g0 ? '重新生成' : '生成'))) + '</span>';
  if (busy) { b.disabled = true; return b; }
  b.onclick = async () => {
    b.textContent = '生成中…(最多1分钟)'; b.disabled = true;
    __portraitBusy[pe.id] = true;
    try {
      let r;
      if (latest && latest.status === 'fail') r = await api('/api/comfy/render', { id: latest.id });
      else r = await api('/api/comfy/person', { id: pe.id });
      if (r.ok) { toast('「' + (pe.name || pe.id) + '」立绘' + (latest && latest.status === 'fail' ? '重试成功' : '完成'), false); afterRenderDone(); }
      else toast('生成失败：' + (r.err || '?'), true);
    } catch (e) { toast('生成失败：' + e.message, true); }
    finally { __portraitBusy[pe.id] = false; }
  };
  return b;
}
function panelPeople(p) {
  loadGallery();
  for (const pe of (V.people || [])) {
    const d = el('div', 'card');
    const row = el('div', 'pc-body');
    const disName = (pe.known && pe.name && /^npc_/.test(String(pe.name)) === false) ? pe.name : '（你还不认识…）';
    /* v1.81：卡片改成「头部行（名字 · 熟悉度 …… 动作）+ 主体行（头像 + 正文）」。
       原来动作按钮竖着居中占最右，把正文列挤到 ~230px，长印象折成 4 行。 */
    const head = el('div', 'pc-head');
    head.appendChild(el('b', 'pc-name', disName));
    head.appendChild(el('span', 'pc-stage', pe.stageLabel || '只见过'));
    // 立绘卡（插件「档案-人物档案（生成立绘）」适配）
    const g0 = galleryImgFor(pe.id);
    if (g0) {
      const im = document.createElement('img');
      im.src = '/api/gallery/img?id=' + g0.id;
      im.style.cssText = 'cursor:pointer;';
      im.title = '立绘';
      im.onclick = () => { const m = $('#modal'); m.classList.remove('hidden'); m.innerHTML = ''; const bx = el('div', 'box'); bx.appendChild(el('img', null, '')); bx.querySelector('img').src = im.src; bx.querySelector('img').style.cssText = 'max-width:100%;border-radius:10px;'; bx.appendChild(el('button', null, '关闭')); bx.querySelector('button').onclick = () => m.classList.add('hidden'); m.appendChild(bx); };
      row.appendChild(im);
    } else {
      const ph = el('div', 'pc-empty'); ph.innerHTML = iconSVG('gallery');
      row.appendChild(ph);
    }
    const info = el('div', 'pc-info');
    // 「TA 长什么样」：用语言说出来的长相印象（文字立绘），不依赖生图引擎。
    // 印象随熟悉度长出来（stage 0-4）；缺了就按需让副 AI 写一次，写进印象层后永久复用。
    if (pe.look) info.appendChild(el('div', 'look-note', pe.look));
    else if (pe.stage <= 1) info.appendChild(el('div', 'hint', '你只见过一眼，还没记住脸。'));
    else info.appendChild(el('div', 'hint', '（你还没仔细看过 TA）'));
    // 按需生成/升级：只要印象层还没有 AI 写的长相，就请求一次（写进去后永久复用，0 成本）
    if (pe.stage >= 2 && !pe.lookReady) {
      if (!__lookBusy[pe.id]) {
        __lookBusy[pe.id] = true;
        api('/api/person/look', { id: pe.id }).then(r => {
          if (r && r.ok && r.look) {
            const pv = (V.people || []).find(x => x.id === pe.id); if (pv) pv.look = r.look;
            try { renderPanel(); } catch (e) { __deg("app.js", e); }
          } else { __lookBusy[pe.id] = false; }
        }).catch(() => { __lookBusy[pe.id] = false; });
      }
    }
    if (pe.traits && pe.traits.length) info.appendChild(el('div', '', '你的印象：' + pe.traits.slice(0, 3).join('；')));
    if (pe.bonds && pe.bonds.length) info.appendChild(el('div', 'hint', '你与TA：' + pe.bonds.slice(0, 3).join(' / ')));
    row.appendChild(info);
    // 生成立绘按钮（生成/重新生成/重试 三态）
    /* v2.05 修（评审 C8 "三处死功能" 里那条"未核实"）：这里原来在 portraitBtn() 返回之后
       **又赋了一次 onclick**，把 portraitBtn 内部那个 handler 整个覆盖掉 ——
       于是「重试」永远走不到：那个分支（失败任务改调 /api/comfy/render）在源码里存在、
       在运行时不可达，而且按钮的三态文案也被覆盖成固定的"立绘"。
       现在只留 portraitBtn 自己那一份（它本来就是完整实现：三态 + busy 守卫 + 失败重试）。 */
    const genB = portraitBtn(pe, g0);
    head.appendChild(genB);
    head.appendChild(genB);
    d.appendChild(head);
    d.appendChild(row);
    p.appendChild(d);
  }
  if (!(V.people || []).length) p.appendChild(el('div', 'hint', '（你还没认识人——去打个招呼吧）'));
  p.appendChild(el('div', 'sysnote', '这里是【你对 TA 的印象】，不是 TA 的全部 —— 你只记得住你注意到的那些。'));
}

// ---------- 画面（图库）：本世界全部生图，按时间倒序浏览 ----------
function panelGallery(p) {
  loadGallery();
  const imgf = el('div', null, '');
  imgf.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;';
  const list = (typeof __gallery !== 'undefined' ? __gallery : []).slice(0, 60);
  if (!list.length) imgf.appendChild(el('span', 'hint', '（还没有图——剧情中的画面会自动登记；或在人物面板生成立绘）'));
  for (const g of list) {
    const cell = el('div', 'card', '');
    cell.style.cssText = 'width:150px;padding:6px;';
    const im = document.createElement('img');
    im.src = '/api/gallery/img?id=' + g.id;
    im.style.cssText = 'width:100%;border-radius:6px;display:block;cursor:pointer;';
    im.title = imgCaption(g);
    im.onclick = () => showModalImg(im.src);
    cell.appendChild(im);
    const cap = String((V.imgTasks || []).find(x => x.id === g.id && x.title) ? (V.imgTasks.find(x => x.id === g.id)).title : (g.note || g.scene || '')).slice(0, 20);
    cell.appendChild(el('div', 'hint', (cap || '画面')));
    cell.appendChild(el('div', 'hint', fmtAgo(g.t || '') + ((g.who || '').split(',').filter(Boolean).map(n => nameOf(n)).slice(0, 2).join('、') ? ' · ' + (g.who || '').split(',').filter(Boolean).map(n => nameOf(n)).slice(0, 2).join('、') : '')));
    imgf.appendChild(cell);
  }
  p.appendChild(imgf);
  p.appendChild(el('div', 'sysnote', '按时间倒序。点图放大。'));
}
/* v1.82：ISO 时间戳不能直接上桌 —— 原来报纸上印的是 "06-14T07:00"，
   那个 T 是机器写法，1996 年的镇广播站不会这么写时间。 */
/* 画面/相册这类"世界内的东西"不该显示真实世界日期（那是世界外的时间）。
   改成"刚刚 / 12 分钟前 / 今天"N 天前"，超过一周才回落成日期。 */
function fmtAgo(iso) {
  const t = Date.parse(String(iso || ''));
  if (!t) return '';
  const d = Date.now() - t;
  if (d < 0) return fmtStamp(iso);
  if (d < 60e3) return '刚刚';
  if (d < 3600e3) return Math.floor(d / 60e3) + ' 分钟前';
  if (d < 86400e3) return Math.floor(d / 3600e3) + ' 小时前';
  if (d < 7 * 86400e3) return Math.floor(d / 86400e3) + ' 天前';
  return fmtStamp(iso).split(' ')[0];
}
/* 画面/相册这类"世界内的东西"不该显示真实世界日期（那是世界外的时间）。
   改成"刚刚 / 12 分钟前 / 3 天前"，超过一周才回落成日期。 */
function fmtStamp(iso) {
  const s = String(iso || '');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return s.slice(0, 16);
  return Number(m[2]) + '月' + Number(m[3]) + '日 ' + m[4] + ':' + m[5];
}
function panelNews(p) {
  const list = (V.news || []);
  if (!list.length) p.appendChild(el('div', 'hint', '暂无你听闻的新闻。'));
  /* v1.99 P0-5：上屏兜底 —— 严重性只认合法取值（低/中/高/灾难），写坏的值落"低"。
     老存档里可能存着引擎以前没校验时写进去的东西，渲染层不该把它原样印出来。 */
  const NEWS_SEV = ['低', '中', '高', '灾难'];
  /* v2.05：原来把枚举原样印成 "[低] 标题" —— 那是引擎的词，不是世界里的话。
     现在只在**值得叫一声**的时候挂一个词，普通消息什么都不挂（它就是普通消息）。
     颜色只借 --red 表"灾祸"，其余保持中性 —— 琥珀色是"可交互/玩家痕迹"的专用色，不挪作他用。 */
  const SEV_WORD = { '中': '要紧', '高': '大事', '灾难': '灾祸' };
  for (const n of list) {
    const d = el('div', 'card');
    const sv = NEWS_SEV.indexOf(String(n.severity || '')) >= 0 ? String(n.severity) : '低';
    const head = el('div', 'news-head');
    head.appendChild(el('b', null, n.title));
    if (SEV_WORD[sv]) head.appendChild(el('span', 'p-chip' + (sv === '灾难' ? ' sev-bad' : ''), SEV_WORD[sv]));
    d.appendChild(head);
    d.appendChild(el('div', null, n.summary));
    d.appendChild(el('div', 'hint', fmtStamp(n.t)));
    p.appendChild(d);
  }
  p.appendChild(el('div', 'sysnote', '你只看到你接触得到的新闻 —— 广播里念的、报纸上登的、街上听来的。'));
}
function panelGoods(p) {
  if (V.money) p.appendChild(el('div', 'item', '钱：' + (V.money.cash || 0) + (V.money.digital ? '（另有电子 ' + V.money.digital + '）' : '') + (V.money.currency || '') + ' · 已花' + (V.money.spent || 0) + ' 挣' + (V.money.earned || 0)));
  p.appendChild(el('h4', 'hint', '你的物品（带价的可以卖）'));
  /* v1.81：行改成「名字 · 价格 · 动作」三段（原来是拼成一个字符串再把按钮塞进去，挤成一串）*/
  for (const i of (V.inventory || [])) {
    const d = el('div', 'item');
    d.appendChild(el('span', 'it-n', i.name));
    if (i.value != null) d.appendChild(el('span', 'it-p', '可卖 ' + i.value));
    if (i.value != null && !/手机|表|钱包|行囊/.test(i.name)) { const s = el('button', 'mini', '卖'); s.onclick = () => submit('卖' + i.name); d.appendChild(s); }
    p.appendChild(d);
  }
  p.appendChild(el('h4', 'hint', '此处可见 (' + V.place.name + ')'));
  for (const it of (V.shop || [])) {
    const d = el('div', 'item');
    d.appendChild(el('span', 'it-n', it.name));
    if (it.desc) d.appendChild(el('span', 'it-d', it.desc));
    d.appendChild(el('span', 'it-p', String(it.price || 0) + ' 元'));
    const b = el('button', 'mini', '买'); b.onclick = () => submit('买' + it.name);
    d.appendChild(b); p.appendChild(d);
  }
  if (!(V.shop || []).length) p.appendChild(el('div', 'hint', '这里没什么可买的。'));
}
function panelWorldInfo(p) {
  api('/api/worldinfo/list').then(r => {
    const list = r.list || [];
    for (const e of list) {
      const card = el('div', 'card');
      card.appendChild(el('b', null, '[' + (e.keys || []).join(' / ') + '] ' + (e.enabled === false ? '（已停用）' : '')));
      card.appendChild(el('div', 'hint', e.content));
      const del = el('button', 'mini', '删除');
      del.onclick = async () => { await api('/api/worldinfo/del', { uid: e.uid }); renderPanel(); };
      card.appendChild(del);
      p.appendChild(card);
    }
    if (!list.length) p.appendChild(el('div', 'hint', '（世界书为空）'));
    p.appendChild(el('div', 'sysnote', '世界书：写下这个世界的规矩和背景。讲到相关的事时，它会起作用。'));
    const add = el('div');
    add.appendChild(el('h4', 'hint', '新增条目'));
    const kIn = el('input'); kIn.placeholder = '关键词（逗号分隔）';
    const cIn = el('input'); cIn.placeholder = '内容（≤600字）';
    const b = el('button', 'mini', '保存条目');
    b.onclick = async () => { if (!kIn.value && !cIn.value) return; await api('/api/worldinfo/save', { keys: kIn.value.split(','), content: cIn.value }); renderPanel(); };
    add.appendChild(kIn); add.appendChild(cIn); add.appendChild(b);
    p.appendChild(add);
  }).catch(e => p.appendChild(el('div', 'hint', '加载失败:' + e.message)));
}
function panelOverview(p) {
  const o = V.overview || {};
  // v1.84：势力/组织 改成"你听说过的"之后可能是空的 —— 空白行像坏了，给一句人话
  const orgTxt = (o['势力组织'] || []).join('、') || '（还没听说过什么）';
  const rows = [['时代', o.era], ['你所在', o['地区']], ['势力/组织', orgTxt], ['要闻人物', (o['要闻人物'] || []).join('、')], ['时令', o['时令']]];
  for (const row of rows) p.appendChild(el('div', 'item', row[0] + '：' + row[1]));
  p.appendChild(el('h4', 'hint', '近况（你听闻的）'));
  /* v1.97 X8：近况只列"还没过去"的新闻，所以它可能真的是空的 —— 空了就照实说，
     不要为了让面板好看而把三个月前的事端上来。顺带把时间带上（近况 ≠ 现状）。 */
  for (const n of (o['近况'] || [])) p.appendChild(el('div', 'hint', '· ' + n.title + (n.t ? '（' + fmtStamp(n.t) + '）' : '')));
  if (!(o['近况'] || []).length) p.appendChild(el('div', 'hint', '（最近没有传到你耳朵里的消息）'));
  p.appendChild(el('div', 'sysnote', '世界概况 = 你知道的世界。'));
  /* v1.81：这块是**开发者信息**（来源卡 / 世界书条目数 / 规则 / 导出 JSON），
     原来摆在认知面板里给玩家看 —— 违反"屏幕只放感知/认知/行动，系统术语不上桌"。
     按项目既有惯例（renderStatline 用的同一套）收到 ?dev 后面。
     顺手删掉一个空白的 .p-cell（渲染出来是一段莫名的空行）。 */
  if (!/(\?|&)dev/.test(location.search)) return;
  const card = el('div', 'p-card');
  card.appendChild(el('div', 'p-card-h', '世界卡 · 来源信息 [dev]'));
  const mk = (k, v) => { const c = el('div', 'p-cell'); c.appendChild(el('span', 'p-chip', k)); c.appendChild(el('span', null, String(v == null || v === '' ? '—' : v))); card.appendChild(c); };
  const dm = (__DEV && __DEV.devMeta) || {};
  mk('来源卡', dm.importSource);
  mk('世界书条目', dm.worldinfoN || 0);   // v1.86：修一处"永远显示 0"的死读（V.archives2/V.worldinfoN 世界视图里根本没有）
  mk('规则', (dm.rules || []).slice(0, 2).join('；'));
  const exp = el('button', 'mini', '导出世界档案 JSON');
  exp.onclick = async () => {
    try {
      const r = await api('/api/export/world');   // v1.83：后端只在 GET 分支处理这个路由（原来传 {} = POST → 必定 not found）
      const blob = new Blob([r.json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = (r.name || 'world') + '.json'; a.click();
      toast('已导出「' + (r.name || '') + '」', false);
    } catch (e) { toast('导出失败：' + e.message, true); }
  };
  card.appendChild(exp);
  p.appendChild(card);
}
// panelWorldInfo 后补 worldinfo 数量视图字段
function worldinfoN_() { return (V && V.worldinfo && V.worldinfo.list ? V.worldinfo.list.length : 0); }
// ---------- v1.51 导入存档文件：先扫一遍给玩家看，确认了才落地 ----------
// 原则（§26）：引擎不认识的**不许丢、不许炸、不许猜着改** —— 原样装箱 + 点名 + 留给 AI 修。
function openImportSave() {
  const m = $('#modal');
  m.classList.remove('hidden');
  const box = el('div', 'box');
  box.appendChild(el('h2', null, '导入存档文件'));
  box.appendChild(el('div', 'hint', '选一个导出过的 .worldsave.json（自带世界 + 框架 + 生成清单 + 来源卡）。导入前会先扫一遍：本机不认识的东西**原样保留**，不会丢也不会改。'));
  const file = el('input'); file.type = 'file'; file.accept = '.json';
  box.appendChild(file);
  const out = el('div'); box.appendChild(out);
  const closeB = el('button', null, '关闭'); closeB.onclick = () => m.classList.add('hidden');
  box.appendChild(closeB);
  m.innerHTML = ''; m.appendChild(box);
  file.onchange = async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    out.innerHTML = '';
    out.appendChild(el('div', 'hint', '正在读 ' + f.name + ' …'));
    let pack = null;
    try { pack = JSON.parse(await f.text()); } catch (e) { out.innerHTML = ''; out.appendChild(el('div', 'bad', '这不是一个 JSON 存档文件')); return; }
    let rep = null;
    try { const rr = await api('/api/save/scan', { pack: pack }); rep = rr.report; }
    catch (e) { out.innerHTML = ''; out.appendChild(el('div', 'bad', '扫描失败：' + e.message)); return; }
    out.innerHTML = '';
    const s = (pack && pack.__save) || {};
    out.appendChild(el('div', 'item', (s.name || '未名之地') + '（' + (s.era || '') + '）'));
    out.appendChild(el('div', 'hint', '世界里到了 ' + fmtStamp(s.worldTime || '') + (__DEV ? ' · 第 ' + (s.turnN || 0) + ' 回合 · 框架档位 ' + (s.build ? ' · 来自 ' + s.build : '') : '')));
    if (rep.counts) out.appendChild(el('div', 'hint', '生成清单 ' + rep.counts.manifest + ' 条：本机认识 ' + rep.counts.known + ' 条，不认识 ' + rep.counts.unknown + ' 条'));
    for (const e of (rep.errors || [])) out.appendChild(el('div', 'bad', e));
    for (const n of (rep.notes || [])) out.appendChild(el('div', 'hint', '· ' + n));
    for (const a of (rep.autoFixed || [])) out.appendChild(el('div', 'hint', '会自动处理：' + a));
    if ((rep.unknown || []).length) {
      out.appendChild(el('div', 'row', '本机不认识的东西（会原样保留，不丢不改）：'));
      for (const u of rep.unknown.slice(0, 12)) out.appendChild(el('div', 'hint', '　· ' + u.what + ' —— ' + u.why));
    }
    if ((rep.needsAI || []).length) {
      out.appendChild(el('div', 'row', '建议让 AI 看一眼（不会自动改）：'));
      for (const s2 of rep.needsAI.slice(0, 8)) out.appendChild(el('div', 'hint', '　· ' + s2));
    }
    if (rep.newer) out.appendChild(el('div', 'bad', '这份存档来自更新的版本——能玩，但新东西本机不认识'));
    // v1.52：AI 修复（告诉 AI 这是存档 → 判断哪里坏了 → 出补丁 → 引擎校验 → 应用 → **再扫一遍验证**）
    const fixB = el('button', null, '让 AI 修一下（修完再扫一遍）');
    fixB.onclick = async () => {
      fixB.textContent = '修复中…';
      try {
        const rr = await api('/api/save/repair', { pack: pack });
        if (rr.pack) { pack = rr.pack; }
        const box2 = el('div', 'hint');
        const vb = (rr.verify && rr.verify.before) || {}, va = (rr.verify && rr.verify.after) || {};
        box2.textContent = '修复（' + (rr.mode === 'llm' ? 'AI' : '未接模型：只跑了引擎能机械修的') + '）：'
          + '引擎自动修 ' + ((rr.auto && rr.auto.fixed.length) || 0) + ' 项，'
          + 'AI 补丁 ' + ((rr.applied || []).length) + ' 项' + (((rr.rejected || []).length) ? ('，被拒 ' + rr.rejected.length + ' 项') : '')
          + '　验证：不认识 ' + (vb.unknownN || 0) + ' → ' + (va.unknownN || 0) + '，待判断 ' + (vb.needsAI || 0) + ' → ' + (va.needsAI || 0);
        out.appendChild(box2);
        for (const s of ((rr.auto && rr.auto.fixed) || []).slice(0, 8)) out.appendChild(el('div', 'hint', '　· ' + s));
        for (const s of (rr.applied || []).slice(0, 8)) out.appendChild(el('div', 'hint', '　🤖 ' + s));
        for (const s of (rr.rejected || []).slice(0, 6)) out.appendChild(el('div', 'hint', '　✘ ' + s));
        for (const f2 of (rr.findings || []).slice(0, 8)) out.appendChild(el('div', 'hint', '　· ' + (f2.what || '') + ' —— ' + (f2.why || '')));
        if (rr.note) out.appendChild(el('div', 'hint', '　小结：' + rr.note));
        fixB.textContent = '再修一次';
      } catch (e) { toast('修复失败：' + e.message, true); fixB.textContent = '让 AI 修一下'; }
    };
    out.appendChild(fixB);
    const goB = el('button', null, rep.ok ? '确认导入（会新建一个世界）' : '不能导入（见上面的 ✘）');
    goB.disabled = !rep.ok;
    goB.onclick = async () => {
      goB.textContent = '导入中…';
      try {
        const rr = await api('/api/save/import', { pack: pack });
        if (!rr.ok) { toast('导入失败', true); goB.textContent = '确认导入'; return; }
        m.classList.add('hidden');
        refresh(rr.view);
        toast('已导入「' + (s.name || '') + '」' + (rr.boxed ? '（' + rr.boxed + ' 块不认识，已原样保留）' : '') + (rr.card ? ' · 来源卡也装进卡盒了' : '') + (rr.snapN ? ' · 存档 ' + rr.snapN + ' 格' : '') + (rr.imgN ? ' · 画面 ' + rr.imgN + ' 张' : ''), false);
      } catch (e) { toast('导入失败：' + e.message, true); goB.textContent = '确认导入'; }
    };
    out.appendChild(goB);
  };
}

/* v1.74 删除世界前的确认（用户：「删除世界的时候问需不需要把那些一起删了」）。
   原则：**一样都不默认勾** —— 不可逆的东西不替玩家选。返回 true = 已经删掉了。 */
function fmtMB(b) { return (Math.round(Number(b || 0) / 1024 / 1024 * 10) / 10) + ' MB'; }
async function askDeleteWorld(w) {
  if (!w || !w.id) return false;
  let fp = null;
  try { fp = await api('/api/world/footprint', { id: w.id }); } catch (e) { __deg("app.js", e); }
  return new Promise(function (resolve) {
    const m = $('#modal');
    m.classList.remove('hidden');
    m.innerHTML = '';
    const box = el('div', 'box');
    box.appendChild(el('h2', null, '删除「' + (w.name || '未命名') + '」'));
    const self = (fp && fp.self) || { snapN: 0, snapBytes: 0, imgN: 0, imgBytes: 0 };
    const orp = (fp && fp.orphans) || { worlds: 0, n: 0, bytes: 0 };
    const cbs = {};
    function opt(key, label, sub) {
      const row = el('div', 'row');
      const c = el('input'); c.type = 'checkbox';
      cbs[key] = c;
      row.appendChild(c);
      const t = el('div', null, '');
      t.style.cssText = 'flex:1;min-width:0;';
      t.appendChild(el('b', null, label));
      t.appendChild(el('div', 'hint', sub));
      row.appendChild(t);
      box.appendChild(row);
    }
    box.appendChild(el('div', 'hint', '世界本体一定会删。下面这些默认不动，勾了才一起删（不可恢复）：'));
    if (self.snapN) opt('withSnap', '快照 ' + self.snapN + ' 份（' + fmtMB(self.snapBytes) + '）', '每回合自动存的撤销点。删了就不能回退、也救不回误删的世界。');
    else box.appendChild(el('div', 'hint', '· 快照：没有'));
    if (self.imgN) opt('withGallery', '画面 ' + self.imgN + ' 张（' + fmtMB(self.imgBytes) + '）', '这个世界生成过的图。');
    else box.appendChild(el('div', 'hint', '· 画面：没有'));
    if (orp.worlds) {
      box.appendChild(el('div', 'sysnote', '另外：磁盘上还有 ' + orp.worlds + ' 份「没主」的旧数据（对应的世界早就删了），共 ' + fmtMB(orp.bytes) + '。'));
      opt('withOrphans', '顺手清掉这些没主的旧数据（' + fmtMB(orp.bytes) + '）', '它们不属于任何一个还进得去的世界，清了不影响你现在的存档。');   // （顺便：这个 App 的 hint 不渲染 markdown，别在里面写星号）
    }
    const row = el('div', 'row');
    const yes = el('button', null, '删除');
    const no = el('button', 'mini', '取消');
    const done = function (v) { m.classList.add('hidden'); resolve(v); };
    yes.onclick = async () => {
      yes.disabled = true; yes.textContent = '删除中…';
      try {
        const r = await api('/api/world/del', {
          id: w.id,
          withSnap: !!(cbs.withSnap && cbs.withSnap.checked),
          withGallery: !!(cbs.withGallery && cbs.withGallery.checked),
          withOrphans: !!(cbs.withOrphans && cbs.withOrphans.checked)
        });
        const bits = [];
        if (r.del && r.del.snap) bits.push('快照已清');
        if (r.del && r.del.gallery) bits.push('画面已清');
        if (r.del && r.del.orphans) bits.push('清了 ' + r.del.orphans + ' 份旧数据');
        toast('已删除' + (bits.length ? ('（' + bits.join('、') + '）') : ''), false);
        done(true);
      } catch (e) { toast('删除失败：' + e.message, true); yes.disabled = false; yes.textContent = '删除'; }
    };
    no.onclick = function () { done(false); };
    row.appendChild(yes); row.appendChild(no);
    box.appendChild(row);
    m.innerHTML = ''; m.appendChild(box);
  });
}
// ---------- v1.48 存档面板（快照）：5 个自动位（环形）+ 15 个手动位 ----------
// 用户规格：「快照就是 ai 回复完之后给存个档（类似 galgame 的快存/快读）。
//            5 个自动存档位 + 15 个手动存档位，自动的新的覆盖最旧的：1,2,3,4,5 → 6 进来则 2,3,4,5,6」
/* v1.82：拆开显示之后，这一栏只留"进度"（存档时刻由调用方单独显示）*/
function snapWhen(m) {
  if (!m) return '空位';
  if (m.corrupt) return '损坏';
  /* v2.05 修（本 agent 补充的红线违规）：存档行原来印「第 N 回合 · … · N KB」——
     回合数和文件体积是**引擎/开发者**才知道的量，屏幕上只该有世界内的时间。 */
  return m.worldT ? ('世界时间 ' + fmtStamp(m.worldT)) : '（未记录世界时间）';
}
function panelSaves(p) {
  p.appendChild(el('div', 'hint', '每次 AI 回复后**自动存一份**（5 个自动位，新的覆盖最旧的）。下面是**可以读回来的时间点**：点某一行的「读取」就回到那一刻；不想挑就点「回退一步」= 撤销上一个回合。读取前会自动留一份「你读取之前」，读错了还能回来。'));
  const bar = el('div', 'tabbar');
  const bBack = el('button', 'mini'); bBack.innerHTML = iconSVG('saves') + '<span>回退一步</span>';
  const bSave = el('button', 'mini'); bSave.innerHTML = iconSVG('disk') + '<span>快存到手动位</span>';
  const bExp = el('button', 'mini'); bExp.innerHTML = iconSVG('scroll') + '<span>导出完整包</span>';
  bExp.onclick = async () => {
    bExp.textContent = '导出中…';
    try {
      const rr = await api('/api/save/export', { full: true });
      const blob = new Blob([JSON.stringify(rr.pack, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = String(rr.name || 'world').replace(/[\\/:*?"<>|]/g, '_') + '.worldsave.json';
      document.body.appendChild(a); a.click(); a.remove();
      toast('已导出完整包：' + Math.round((rr.size || 0) / 1024) + 'KB（含来源卡 ' + (rr.hasCard ? '有' : '无') + ' · 存档 ' + (rr.snapN || 0) + ' 格 · 画面 ' + (rr.imgN || 0) + ' 张）', false);
    } catch (e) { toast('导出失败：' + e.message, true); }
    bExp.innerHTML = iconSVG('scroll') + '<span>导出完整包</span>';
  };
  bar.appendChild(bBack); bar.appendChild(bSave); bar.appendChild(bExp);
  p.appendChild(bar);
  const box = el('div', null, '');
  p.appendChild(box);
  const applyView = (r, what) => {
    if (r && r.ok && r.view) {
      V = r.view; refresh(V);
      toast('已回到 ' + what + '（' + fmtStamp((r.snap && r.snap.t) || '') + '）', false);
      closePanel();
    } else toast((r && r.err) || '读取失败', true);
  };
  bBack.onclick = () => api('/api/snapshot/stepback', {}).then(r => applyView(r, '上一个自动存档点（撤销最后一个回合）')).catch(e => toast(e.message, true));
  bSave.onclick = () => api('/api/snapshot/save', { kind: 'manual' }).then(r => {
    toast(r.ok ? ('已存到手动位 ' + r.slot) : (r.err || '存不下'), !r.ok);
    paint();
  }).catch(e => toast(e.message, true));
  let data = null;
  const find = (kind, slot) => ((data && data.list) || []).find(x => x.kind === kind && x.slot === Number(slot)) || null;
  const loadOne = (kind, slot) => api('/api/snapshot/load', { kind: kind, slot: slot }).then(r => applyView(r, (kind === 'auto' ? '自动位 ' : '手动位 ') + slot)).catch(e => toast(e.message, true));
  const saveOne = (slot) => api('/api/snapshot/save', { kind: 'manual', slot: slot }).then(r => { toast(r.ok ? ('已覆盖手动位 ' + slot) : (r.err || '存不下'), !r.ok); paint(); }).catch(e => toast(e.message, true));
  const delOne = (kind, slot) => api('/api/snapshot/del', { kind: kind, slot: slot }).then(r => { toast(r.ok ? '已删除' : (r.err || '删不掉'), !r.ok); paint(); }).catch(e => toast(e.message, true));
  function row(kind, slot, tag) {
    const m = find(kind, slot);
    /* v1.82：原来这行借用了 .conv（手机会话卡）的类名，还把
       「⟳ 自动 1　【现在】　6月14日 20:49　第 2 回合」拼成一整串塞进 .cname，
       按钮组再挂一条 inline style。现在拆成真正的列：槽位 / 标记 / 进度 / 时刻 / 动作。 */
    const line = el('div', 'item sn-row');
    line.appendChild(el('span', 'it-n', (kind === 'auto' ? '自动 ' : '手动 ') + slot));
    if (tag) line.appendChild(el('span', 'sn-tag', tag));
    line.appendChild(el('span', 'it-v sn-when', snapWhen(m)));
    /* v2.05：这一列原来是**真实世界**的存档时刻。同一行前面已经有"世界时间"，
       两个时间并排只会让人分不清哪个算数 —— 屏幕上只留世界时间，真实时刻挪进 ?dev。 */
    if (__DEV && m && !m.corrupt && m.t) line.appendChild(el('span', 'it-p', fmtStamp(m.t)));
    const btns = el('span', 'sn-btns');
    if (m && !m.corrupt) {
      const b1 = el('button', 'mini', '读取'); b1.onclick = () => loadOne(kind, slot); btns.appendChild(b1);
    }
    if (kind === 'manual') {
      const b2 = el('button', 'mini', m ? '覆盖' : '存入'); b2.onclick = () => saveOne(slot); btns.appendChild(b2);
      if (m) { const b3 = el('button', 'mini', '删'); b3.onclick = () => delOne(kind, slot); btns.appendChild(b3); }
    }
    line.appendChild(btns);
    return line;
  }
  function paint() {
    box.innerHTML = '';
    box.appendChild(el('h4', null, '自动存档（' + ((data && data.auto) || 5) + ' 位 · 新 → 旧）'));
    const autos = ((data && data.list) || []).filter(x => x.kind === 'auto');
    if (!autos.length) box.appendChild(el('div', 'hint', '（还没有自动存档——打一回合就有了）'));
    autos.forEach((m, i) => box.appendChild(row('auto', m.slot, i === 0 ? '现在' : (i === 1 ? '上一回合' : (i + 1) + ' 回合前'))));
    for (let i = 1; i <= ((data && data.auto) || 5); i++) if (!autos.some(a => a.slot === i)) box.appendChild(row('auto', i));
    box.appendChild(el('h4', null, '手动存档（' + ((data && data.manual) || 15) + ' 位）'));
    for (let i = 1; i <= ((data && data.manual) || 15); i++) box.appendChild(row('manual', i));
    if (data && data.hasPre) box.appendChild(el('div', 'sysnote', '（另外留着一份「你读取之前」的快照：' + fmtStamp((data.pre && data.pre.t) || '') + '，不占上面 20 个位）'));
  }
  paint();
  api('/api/snapshots').then(r => { data = r; paint(); }).catch(e => { box.appendChild(el('div', 'hint', '读不到存档列表：' + e.message)); });
}

function panelArchive(p) {
  p.appendChild(el('div', 'hint', '剧本存档 = 逐字原文 —— 这里存的都是当时原样说过的话。'));
  const keys = Object.keys(V.archives || {});
  if (!keys.length) p.appendChild(el('div', 'hint', '（剧情尚未落档）'));
  for (const k of keys.slice(-6)) { p.appendChild(el('h4', null, k)); for (const line of V.archives[k]) p.appendChild(el('div', 'hint', line.text || line)); }
}

// ---------- 生成 ----------
function showWorldCard(pv, setup) {
  try {
    if (pv && pv.__err) {
      const m2 = $('#modal'); m2.classList.remove('hidden'); m2.innerHTML = '';
      const bx = el('div', 'box'); bx.appendChild(el('div', 'item', '生成失败：' + pv.__err));
      const cb = el('button', 'mini', '关闭'); cb.onclick = () => m2.classList.add('hidden'); bx.appendChild(cb);
      m2.appendChild(bx); return;
    }
    const m = $('#modal');
    m.classList.remove('hidden');
    const box = el('div', 'box');
    box.appendChild(el('h2', null, 'AI 生成的新世界'));
    box.appendChild(el('div', 'item', '世界：' + (pv.name || '未名之地') + '（' + (pv.era || '时代未知') + ' · ' + (pv.weather || '') + '）'));
    let selOpening = 0;
    const ol = pv.openingList || [pv.firstScene || ''];
    if (ol.length > 1) {
      box.appendChild(el('div', 'item', '多条开场 —— 点选一条进入：'));
      const opBox = el('div');
      const rows = [];
      const paint = () => rows.forEach((rw, j) => {
        rw.textContent = (j === selOpening ? '▸ ' : '  ') + String(ol[j] || '').slice(0, 90);
        rw.style.background = j === selOpening ? 'rgba(255,255,255,0.07)' : 'transparent';
      });
      ol.forEach((op, i) => {
        const row = el('div', null, '');
        row.style.cssText = 'cursor:pointer;padding:2px 4px;border-radius:4px;margin:2px 0;white-space:pre-wrap;';
        row.onclick = () => { selOpening = i; paint(); };
        rows.push(row); opBox.appendChild(row);
      });
      paint(); box.appendChild(opBox);
    } else {
      box.appendChild(el('div', 'hint', '开场：' + String(ol[0] || '')));
    }
    box.appendChild(el('div', 'item', '人物：' + ((pv.npcs || []).join('、') || '（待你发现）')));
    box.appendChild(el('div', 'hint', '地点：' + ((pv.places || []).join('、') || '')));
    box.appendChild(el('div', 'sysnote', pv.mode === 'llm' ? '由你的 AI 模型生成（消耗 token）' : '演示组合（未接入模型）'));
    if (setup && setup.issues && setup.issues.length) {
      const st = setup.status || 'pass';
      const head = st === 'conflict' ? '你的设定以世界为准 —— 冲突（下方说明处理方式）' : (st === 'bridge' ? '▲ 你的设定补了一座桥（已写入世界规则）' : '你的设定与世界相容');
      box.appendChild(el('div', 'item', '【设定核对】' + head));
      for (const is of setup.issues) {
        const mark = is.verdict === '冲突' ? '' : (is.verdict === '需补桥' ? '▲ ' : '');
        box.appendChild(el('div', 'hint', mark + is.point + '：' + (is.advice || '')));
      }
      box.appendChild(el('div', 'hint', '（"进入"后：相容设定进入你的档案；冲突项以世界规则为准，不迁就你。）'));
    }
    const enter = el('button', null, '进入这个新世界');
    // v1.68：防连点。原来没锁 → 点几下就建几个世界（实测 19 秒建了 8 个）。
    let entering = false;
    enter.onclick = async () => {
      if (entering) return;
      entering = true; enter.disabled = true; enter.textContent = '正在落成…';
      m.classList.add('hidden');
      enterTransition('◉ 世界正在落成…', '「' + (pv.name || '新世界') + '」场景·人物·开局 组装中——马上进入');
      progStart('⏳ 正在落成世界…', '组装场景·人物·开局');
      try { const a = await api('/api/world/gen', { apply: true, greeting: selOpening }); progStop(); refresh(a.view); }
      catch (e) { progStop(); toast('进入失败：' + e.message, true); }
      hideTransition();
    };
    const again = el('button', null, '再来一个');
    again.onclick = () => { m.classList.add('hidden'); genWorld(); };
    const cancel = el('button', null, '先不换');
    cancel.onclick = () => m.classList.add('hidden');
    box.appendChild(enter); box.appendChild(again); box.appendChild(cancel);
    m.innerHTML = ''; m.appendChild(box);
  } catch (e) {
    const m2 = $('#modal'); if (m2) { m2.innerHTML = ''; m2.appendChild(el('div', 'box', '预览渲染失败：' + String(e.message || e))); }
  }
}
function openCreateWorld() {
  const m = $('#modal');
  m.classList.remove('hidden');
  const box = el('div', 'box');
  box.appendChild(el('h2', null, '✍️ 一句话创作世界'));
  box.appendChild(el('div', 'hint', '写一句话或一段（越完整越好：时代/地方/氛围/人物/冲突/你的身份……）。不写 = AI 自由发挥。'));
  const pIn = el('textarea'); pIn.placeholder = '例：赛博雨夜，一家废弃医馆二楼还亮着灯，我是来收尸的退休法医'; pIn.style.height = '64px';
  box.appendChild(pIn);
  const us = window.__userSelf || {};
  const usN = Object.keys(us).length;
  box.appendChild(el('div', 'hint', usN ? '已自动调取「我的身份档案」——可修改（只作用于本次生成；要保存到档案请去主菜单 → 设定）' : '—— 可选：我的设定（不填 = 世界里的一个外来者；填了会按 20.2 以世界为准裁决；主菜单 → 设定 可保存为档案，之后自动调取） ——'));
  const S = {};
  const fields = [['name', '姓名'], ['age', '年龄'], ['identity', '身份'], ['role', '职业'], ['ability', '能力/本事'], ['appearance', '外貌特征'], ['backstory', '来历/背景'], ['attitude', '性格/待人'], ['secret', '我在藏的事'], ['desire', '现在想做什么']];
  const grid = el('div', 'row');
  for (const [k, lab] of fields) {
    const d = el('div'); d.style.margin = '3px 0';
    d.appendChild(el('span', 'lbl', lab + ': '));
    const inp = el('input'); inp.placeholder = lab;
    inp.value = us[k] || '';
    d.appendChild(inp); S[k] = inp;
    grid.appendChild(d);
  }
  box.appendChild(grid);
  const goBtn = el('button', null, '生成新世界');
  const cancelBtn = el('button', null, '关闭');
  goBtn.onclick = async () => {
    const userSelf = {};
    for (const [k] of fields) { const v = (S[k].value || '').trim(); if (v) userSelf[k] = v; }
    m.classList.add('hidden');
    if (busy) return;
    busy = true;
    progStart('⏳ 正在生成新世界…', (pIn.value ? '解读你的一句话 + ' : '') + '连接模型生成（请勿反复点击）');   // v1.77：进度浮层（步/字数/百分比/秒）
    let done = false;
    const timer = setTimeout(() => { if (!done) updateWorking('已等待 60 秒，模型仍未返回……', '可能模型慢/端点超时/输出过大。'); }, 60000);
    try {
      const r = await api('/api/world/gen', { prompt: pIn.value.trim(), userSelf, preview: true });
      done = true; clearTimeout(timer);
      setBusy(false); progStop();
      showWorldCard(r.preview || {}, r.setup || null);
    } catch (e) {
      done = true; clearTimeout(timer);
      setBusy(false); progStop();
      showWorldCard({ __err: String(e.message || e).slice(0, 260) });
    }
  };
  cancelBtn.onclick = () => m.classList.add('hidden');
  box.appendChild(goBtn); box.appendChild(cancelBtn);
  m.innerHTML = ''; m.appendChild(box);
}
async function genWorld() {
  openCreateWorld();
}

// ---------- 继续游戏（读档/删档） ----------
/* v1.75 存储一行（在「读取存档」底部）：列各类占用 + 没主数据的独立清理入口。
   为什么要有：孤儿数据原来**只能靠"删下一个世界时顺手清"** —— 不删世界就永远清不掉。 */
async function drawStorage(host) {
  let st = null;
  try { st = await api('/api/storage', {}); } catch (e) { return; }
  if (!st || !st.ok) return;
  const wrap = el('div');
  wrap.style.cssText = 'margin-top:14px;border-top:1px solid var(--line2);padding-top:10px;';
  wrap.appendChild(el('div', 'item', '存储'));
  wrap.appendChild(el('div', 'hint', '世界本体 ' + fmtMB(st.worlds.bytes) + '（' + st.nWorlds + ' 个）· 快照 ' + fmtMB(st.snaps.bytes)
    + ' · 画面 ' + fmtMB(st.gal.bytes) + ' · 卡档 ' + fmtMB(st.cards.bytes) + '（' + st.nCards + ' 张）'));
  const orp = st.orphans || { worlds: 0, n: 0, bytes: 0 };
  if (orp.worlds) {
    wrap.appendChild(el('div', 'sysnote', '其中 ' + orp.worlds + ' 份是「没主」的旧数据（对应的世界早就删了），共 ' + fmtMB(orp.bytes) + '。'));
    const b = el('button', 'mini', '清理这 ' + orp.worlds + ' 份（' + fmtMB(orp.bytes) + '）');
    b.onclick = async () => {
      if (!confirm('清掉这些没主的数据？它们不属于任何一个还进得去的世界，删了不可恢复。')) return;
      b.disabled = true; b.textContent = '清理中…';
      try {
        const r = await api('/api/storage/clean', {});
        toast('已清掉 ' + r.gone + ' 份（约 ' + fmtMB(r.freed) + '）', false);
        if (typeof openResume === 'function') openResume(); else location.reload();
      } catch (e) { toast('清理失败：' + e.message, true); b.disabled = false; b.textContent = '重试'; }
    };
    wrap.appendChild(b);
  } else {
    wrap.appendChild(el('div', 'hint', '没有没主的数据——磁盘很干净。'));
  }
  host.appendChild(wrap);
}
/* v1.77 进度浮层：把「现在在干什么」说出来（步 / 已写字数 / 百分比 / 秒数）。
   服务端在 /api/progress 里报的是**真的东西**；百分比是按阶段估的，界面上也这么写。
   快操作（<0.5 秒）不弹，免得闪。 */
let __progTimer = null, __progShow = null, __progT0 = 0, __progShown = false, __progTitle = '';
function progStart(title, sub) {
  progStop();
  __progT0 = Date.now(); __progShown = false; __progTitle = title || '⏳ 正在处理…';
  __progShow = setTimeout(function () { __progShown = true; showWorking(__progTitle, sub || ''); }, 500);
  __progTimer = setInterval(async function () {
    let pr = null;
    try { const r = await api('/api/progress', {}); pr = r && r.prog; } catch (e) { __deg("app.js", e); }
    const secs = Math.round((Date.now() - __progT0) / 1000);
    if (!__progShown) { if (secs < 1) return; __progShown = true; showWorking(__progTitle, ''); }
    updateWorking(null, pr
      ? (pr.label + '　·　已写 ' + (pr.chars || 0) + ' 字　·　约 ' + pr.pct + '%　·　' + secs + ' 秒')
      : ('等待服务端响应…　' + secs + ' 秒'));
  }, 600);
}
function progStop() {
  if (__progShow) { clearTimeout(__progShow); __progShow = null; }
  if (__progTimer) { clearInterval(__progTimer); __progTimer = null; }
  try { hideWorking(); } catch (e) { __deg("app.js", e); }
}
async function openResume() {
  const m = $('#modal');
  m.classList.remove('hidden');
  const box = el('div', 'box');
  box.appendChild(el('h2', null, '▶ 继续游戏 · 存档'));
  const listWrap = el('div');
  box.appendChild(listWrap);
  const closeB = el('button', null, '关闭');
  closeB.onclick = () => m.classList.add('hidden');
  box.appendChild(closeB);
  m.innerHTML = ''; m.appendChild(box);
  async function draw() {
    listWrap.innerHTML = '';
    try {
      const r = await api('/api/worlds');
      const list = (r.list || []).filter(w => w.id);
      // v1.76：**没有世界时也要画存储行** —— 一个世界都没有的时候，正是你最需要清孤儿的时候（原来这里直接 return，清理入口就消失了）
      if (!list.length) { listWrap.appendChild(el('div', 'hint', '（暂无存档——创作/导入/演示后自动存档）')); await drawStorage(listWrap); return; }
      // ★ v1.50 点击路径：🃏 角色卡 →（点卡）→ 聊天 →（聊天里）→ 存档
      // 所以这里**一张卡只出现一行**（它最近的那个聊天），点进去才谈存档；不在这里摊开一堆。
      const groups = []; const byKey = {};
      for (const w of list) {
        const k = w.cardId || '';
        if (!byKey[k]) { byKey[k] = { key: k, name: w.cardName || (k ? '（卡档已不在）' : ''), items: [] }; groups.push(byKey[k]); }
        byKey[k].items.push(w);
      }
      groups.sort((a, b) => (a.key ? 0 : 1) - (b.key ? 0 : 1));
      for (const g of groups) g.items.sort((a, b) => String(b.saved || '').localeCompare(String(a.saved || '')));   // 每张卡取**最近玩过的那个聊天**
      for (const g of groups) {
        const h = el('div', 'item', (g.key ? g.name : '（没有角色卡的：演示世界 / AI 生成 / 直接导入）'));
        h.style.cssText = 'margin:12px 0 4px;font-weight:600;';
        listWrap.appendChild(h);
        /* v1.75：同卡的其他聊天**就地展开**。
           原来这里只显示最近一个，剩下的推给「卡盒」——于是"删一个旧聊天"必须先进角色卡（用户：
           「为什么还需要手动进入角色卡里面才能把那些删了？」）。折叠可以留，但**出口不能只留一个**。 */
        const renderW = (w, host) => {
          const row = el('div', 'card');
          row.appendChild(el('div', 'item', (w.name || '未名之地') + '（' + (w.era || '') + '）'));
          const bits = [];
          if (w.worldT) bits.push('世界里到了 ' + fmtStamp(w.worldT));
          /* v2.05：原来这里印「第 N 回合」和「存档于 <裸时间戳>」——
             回合数是引擎的刻度（屏幕上不出现），时间戳格式也和别处不统一。
             这一栏是**世界外**的"我开过哪几局"，所以留真实时刻，但说成玩家的话。 */
          if (w.saved) bits.push('上次打开 ' + fmtStamp(w.saved));
          if (w.id === r.current) bits.push('当前');
          row.appendChild(el('div', 'hint', bits.join(' · ')));
          const loadB = el('button', 'mini', '▶ 进入聊天');
          loadB.onclick = async () => {
            loadB.textContent = '…';
            progStart('⏳ 正在载入「' + (w.name || '世界') + '」…', '读档 + 重建视图');
            try { const s = await api('/api/world/load', { id: w.id }); progStop(); m.classList.add('hidden'); refresh(s.view); toast('已载入「' + w.name + '」', false); }
            catch (e) { progStop(); toast('载入失败：' + e.message, true); loadB.textContent = '▶ 进入聊天'; }
          };
          const delB = el('button', 'mini', '删除');
          delB.onclick = async () => {
            if (!(await askDeleteWorld(w))) return;   // v1.74：删之前问一句，快照/画面勾了才删
            draw();
          };
          row.appendChild(loadB); row.appendChild(delB);
          (host || listWrap).appendChild(row);
        };
        const others = g.key ? g.items.slice(1) : [];
        renderW(g.items[0]);
        if (others.length) {
          const sub = el('div');
          sub.style.display = 'none';
          let opened = false;
          const tg = el('button', 'mini', '▸ 展开（这张卡还有 ' + others.length + ' 个聊天）');
          tg.onclick = () => {
            opened = !opened;
            tg.textContent = (opened ? '▾ 收起' : '▸ 展开（这张卡还有 ' + others.length + ' 个聊天）');
            sub.style.display = opened ? '' : 'none';
          };
          for (const w of others) renderW(w, sub);
          listWrap.appendChild(tg);
          listWrap.appendChild(sub);
        }
        if (!g.key) for (let i2 = 1; i2 < g.items.length; i2++) renderW(g.items[i2]);
      }
      await drawStorage(listWrap);
      listWrap.appendChild(el('div', 'sysnote', '这里每张卡只摊开最近玩过的那一个聊天（点「展开」看全部）。存档（5 自动 + 15 手动）在世界内 —— 顶栏那个回转箭头图标（快照，每回合自动存）。'));
    } catch (e) { listWrap.appendChild(el('div', 'hint', '读档失败：' + e.message)); }
  }
  draw();
}

/* v1.72 读角色卡缓存：这张卡当时是怎么被理解的 —— 分析稿 + 补了什么 + 裁了什么。
   用户：「存着咯，放在开始游戏那栏 读取角色卡缓存」。 */
async function openCardCache(c) {
  const m = $('#modal');
  m.classList.remove('hidden');
  m.innerHTML = '';
  const box = el('div', 'box');
  box.appendChild(el('h2', null, '扫描记录 · ' + (c.name || '未命名')));
  const info = el('div', 'hint', '读取中…');
  box.appendChild(info);
  const body = el('div');
  box.appendChild(body);
  const closeB = el('button', null, '关闭');
  closeB.onclick = () => m.classList.add('hidden');
  box.appendChild(closeB);
  m.appendChild(box);
  let r = null;
  try { r = await api('/api/cards/cache', { id: c.id }); } catch (e) { __deg("app.js", e); }
  if (!r || !r.ok) { info.textContent = '（读不到：' + ((r && r.err) || '这张卡没有扫描记录') + '）'; return; }
  info.textContent = (r.mode === 'llm' ? 'AI 通读全卡后重建的世界' : '本地整理（没走 AI）')
    + (r.note ? ('　· ' + r.note) : '')
    + '　· 扫于 ' + String(r.scanned || '').slice(0, 16).replace('T', ' ');
  const fn = (r.filled || []).length, cn2 = (r.conflicts || []).length;
  body.appendChild(el('div', 'item', '卡里没写的，AI 补了 ' + fn + ' 处' + (cn2 ? ('；卡里自相矛盾的，裁了 ' + cn2 + ' 处') : '')));
  if (fn) {
    body.appendChild(el('div', 'grp-t', '补全（卡里没写的）'));
    for (const f of r.filled) body.appendChild(el('div', 'hint', '· ' + String((f && f.what) || f) + ((f && f.why) ? ('　（依据：' + String(f.why) + '）') : '')));
  }
  if (cn2) {
    body.appendChild(el('div', 'grp-t', '裁决（卡里自相矛盾的）'));
    for (const f of r.conflicts) body.appendChild(el('div', 'hint', '· ' + String((f && f.where) || f) + '　→ 取「' + String((f && f.took) || '') + '」' + ((f && f.why) ? ('　（' + String(f.why) + '）') : '')));
  }
  body.appendChild(el('div', 'grp-t', '分析稿（AI 通读全卡时的判断）'));
  if (!r.analysis) body.appendChild(el('div', 'hint', '（没有分析稿：这次是本地整理，或者分析那一步失败了）'));
  else {
    const pre = el('div', 'hint');
    pre.style.cssText = 'white-space:pre-wrap;max-height:280px;overflow:auto;line-height:1.7;border-left:2px solid var(--line2);padding-left:10px;';
    pre.textContent = r.analysis;
    body.appendChild(pre);
  }
}
// ---------- 角色卡盒：扫描过的卡直接开局（不是存档） ----------
async function openCardbox() {
  const m = $('#modal');
  m.classList.remove('hidden');
  const box = el('div', 'box');
  box.appendChild(el('h2', null, '角色卡盒 · 从卡开局'));
  box.appendChild(el('div', 'hint', '这里是你扫描过的角色卡档案（不是存档）：每次开局都是全新的世界实例，都不会碰你别的局。'));
  const listWrap = el('div');
  box.appendChild(listWrap);
  const closeB = el('button', null, '关闭');
  closeB.onclick = () => m.classList.add('hidden');
  box.appendChild(closeB);
  m.innerHTML = ''; m.appendChild(box);
  let openId = null;   // 展开哪张卡的"局列表"
  async function draw() {
    listWrap.innerHTML = '';
    try {
      const r = await api('/api/cards');
      const list = (r.list || []).filter(c => c.id);
      if (!list.length) { listWrap.appendChild(el('div', 'hint', '（卡盒是空的——去「导入世界」扫描一张角色卡，会自动建档。）')); return; }
      for (const c of list) {
        const mine = c.worlds || [];
        const row = el('div', 'card');
        row.appendChild(el('div', 'item', (c.name || '未命名') + ' · 世界「' + (c.worldName || '') + '」'));
        const npcNames = (c.npcs || []).slice(0, 6).join('、');
        row.appendChild(el('div', 'hint', (c.era || '时代未知') + ' · NPC ' + (c.npcs || []).length + '（' + npcNames + '） · 地点 ' + (c.placeN || 0) + ' · 开场 ' + (c.openings || 1) + ' 条' + (c.mode === 'llm' ? ' · AI 重写' : '') + ' · ' + String(c.scanned || '').slice(0, 10)));
        // ★ v1.50 点击路径：🃏 角色卡 →（点卡）→ 聊天 →（聊天里）→ 存档
        // 点开一张卡**直接进它的聊天**，不再炸开一堆"存档"列表。
        const cur = mine[0] || null;                       // 这张卡最近的那个聊天（= 这一局世界）
        if (cur) {
          const bits = [];
          if (cur.worldT) bits.push('世界里到了 ' + fmtStamp(cur.worldT));
          if (cur.saved) bits.push('上次打开 ' + fmtStamp(cur.saved));
          row.appendChild(el('div', 'sc-b', '聊天：' + (cur.name || '未命名') + '　' + bits.join(' · ')));
        } else {
          row.appendChild(el('div', 'sc-b', '聊天：（还没开过——点「进入」开始这一局）'));
        }
        const goB = el('button', 'mini', cur ? '▶ 进入聊天' : '▶ 开始这一局');
        goB.onclick = async () => {
          if (!cur) { pickOpening(c); return; }
          goB.textContent = '…';
          try { const s = await api('/api/world/load', { id: cur.id }); m.classList.add('hidden'); refresh(s.view); toast('已进入「' + (cur.name || '') + '」', false); }
          catch (e) { toast('载入失败：' + e.message, true); goB.textContent = '▶ 进入聊天'; }
        };
        const newB = el('button', 'mini', '＋ 另开一个聊天');
        newB.onclick = () => pickOpening(c);
        const cacheB = el('button', 'mini', '扫描记录');
        cacheB.title = '这张卡当时是怎么被理解、补了什么、裁了什么';
        cacheB.onclick = () => openCardCache(c);
        const delB = el('button', 'mini', '删除卡档');
        delB.onclick = async () => {
          if (!confirm('删除卡档「' + c.name + '」？不影响已经开出来的聊天。')) return;
          try { await api('/api/cards/del', { id: c.id }); toast('已删除卡档', false); draw(); }
          catch (e) { toast('删除失败：' + e.message, true); }
        };
        row.appendChild(goB); row.appendChild(cacheB); row.appendChild(newB); row.appendChild(delB);
        // 历史遗留：同一张卡以前开过多个聊天时，**默认藏着**（主点击永远是"进聊天"）
        if (mine.length > 1) {
          const moreB = el('button', 'mini', (openId === c.id ? '▾ ' : '▸ ') + '以前的聊天（' + (mine.length - 1) + '）');
          moreB.onclick = () => { openId = (openId === c.id ? null : c.id); draw(); };
          row.appendChild(moreB);
        }
        listWrap.appendChild(row);
        // 展开：这张卡开出来的每一局（点进去就是接着玩；局里面还有 20 格快照）
        if (openId === c.id) {
          const sub = el('div');
          sub.style.cssText = 'margin:2px 0 10px 14px;border-left:1px solid var(--line);padding-left:10px;';
          for (const w of mine.slice(1)) {
            const wrow = el('div', 'conv');
            const bits = [];
            if (w.worldT) bits.push('世界 ' + fmtStamp(w.worldT));
            if (w.saved) bits.push('上次打开 ' + fmtStamp(w.saved));
            wrow.appendChild(el('span', 'it-n', (w.name || '未命名的一局')));
            wrow.appendChild(el('span', 'it-d', bits.join(' · ')));
            const btns = el('span', 'sn-btns');
            const inB = el('button', 'mini', '继续');
            inB.onclick = async () => {
              inB.textContent = '…';
              try { const s = await api('/api/world/load', { id: w.id }); m.classList.add('hidden'); refresh(s.view); toast('已进入「' + (w.name || '') + '」', false); }
              catch (e) { toast('载入失败：' + e.message, true); inB.textContent = '继续'; }
            };
            const delW = el('button', 'mini', '删');
            delW.onclick = async () => {
              if (!(await askDeleteWorld(w))) return;
              draw();
            };
            btns.appendChild(inB); btns.appendChild(delW);
            wrow.appendChild(btns);
            sub.appendChild(wrow);
          }
          listWrap.appendChild(sub);
        }
      }
      listWrap.appendChild(el('div', 'sysnote', '结构：角色卡 →（点卡）→ 聊天（= 这一局世界）→（聊天里）→ 存档（5 自动 + 15 手动）。点卡就直接进聊天，不在这里列存档；要另起一条时间线才用「＋ 另开一个聊天」。'));
    } catch (e) { listWrap.appendChild(el('div', 'hint', '加载失败：' + e.message)); }
  }
  function pickOpening(c) {
    listWrap.innerHTML = '';
    const ol = c.openingList || [];
    if (!ol.length) { listWrap.appendChild(el('div', 'hint', '（这张卡没有开场信息）')); return; }
    let sel = 0;
    const rows = [];
    const paint = () => rows.forEach((rw, j) => {
      rw.textContent = (j === sel ? '▸ ' : '  ') + String(ol[j] || '').slice(0, 90);
      rw.style.background = j === sel ? 'rgba(255,255,255,0.07)' : 'transparent';
    });
    ol.forEach((op, i) => {
      const row = el('div', 'pick-row', '');
      row.onclick = () => { sel = i; paint(); };
      rows.push(row); listWrap.appendChild(row);
    });
    paint();
    listWrap.appendChild(el('div', 'item', '选一条开场，进入「' + c.worldName + '」'));
    const go = el('button', null, '▶ 进入');
    go.onclick = async () => {
      go.textContent = '…';
      try {
        const r2 = await api('/api/cards/launch', { id: c.id, greeting: sel });
        m.classList.add('hidden');
        enterTransition('◉ 世界正在落成…', '「' + c.worldName + '」场景·人物·开局 组装中——马上进入');
        refresh(r2.view);
        toast('已从卡「' + c.name + '」开局（全新的一局）', false);
        hideTransition();
      } catch (e) { toast('开局失败：' + e.message, true); go.textContent = '▶ 进入'; }
    };
    const back = el('button', 'mini', '← 返回卡盒');
    back.onclick = draw;
    listWrap.appendChild(go); listWrap.appendChild(back);
  }
  draw();
}

// ---------- 设定：我的身份档案（user 管线自动调取；游玩中不触发） ----------
function openSelfSetup() {
  const m = $('#modal');
  m.classList.remove('hidden');
  const box = el('div', 'box');
  box.appendChild(el('h2', null, '设定 · 我的身份档案'));
  box.appendChild(el('div', 'hint', '这是「你」在世界里的底子。之后凡是涉及你的生成管线（一句话生成世界、扫描角色卡当作 NPC 世界）都会自动调取这里；世界冲突以世界规则为准（20.2）。游戏进行中不会反复触发。'));
  // v1.57：+ voice（语域）—— 说话方式是设定，不是失礼（§29.2）
  const fields = [['name', '姓名'], ['age', '年龄'], ['identity', '身份'], ['role', '职业'], ['ability', '能力/本事'], ['voice', '语域（说话方式/口癖，如：粗话不离口、文白夹杂）'], ['appearance', '外貌特征'], ['backstory', '来历/背景'], ['attitude', '性格/待人'], ['secret', '我在藏的事'], ['desire', '现在想做什么']];
  const S = {};
  const grid = el('div', 'row');
  for (const [k, lab] of fields) {
    const d = el('div'); d.style.margin = '3px 0';
    d.appendChild(el('span', 'lbl', lab + ': '));
    const inp = el('input'); inp.placeholder = lab;
    inp.value = String((window.__userSelf || {})[k] || '').replace(/按设定来|^待定$|待补充/g, '').trim();
    d.appendChild(inp); S[k] = inp;
    grid.appendChild(d);
  }
  const wd = el('div'); wd.style.margin = '3px 0';
  wd.appendChild(el('span', 'lbl', '财力: '));
  const wSel = el('select');
  for (const o of [['', '不声明（按世界/剧情来）'], ['揭不开锅', '揭不开锅'], ['普通', '普通'], ['小康', '小康'], ['富裕', '富裕'], ['财力雄厚', '财力雄厚']]) { const op = el('option', null, o[1]); op.value = o[0]; wSel.appendChild(op); }
  wSel.value = String((window.__userSelf || {}).wealth || '');
  wd.appendChild(wSel); grid.appendChild(wd); S['wealth'] = wSel;
  box.appendChild(grid);
  const saveB = el('button', null, '保存档案');
  const clearB = el('button', null, '清空档案');
  const closeB = el('button', null, '关闭');
  saveB.onclick = async () => {
    const f = {};
    for (const [k] of fields) { const v = (S[k].value || '').trim(); if (v) f[k] = v; }
    try { const r = await api('/api/self', { fields: f }); window.__userSelf = r.userSelf || f; toast('身份档案已保存 ✓', false); m.classList.add('hidden'); }
    catch (e) { toast('保存失败：' + e.message, true); }
  };
  clearB.onclick = async () => {
    try { const r = await api('/api/self', { fields: {} }); window.__userSelf = r.userSelf || {}; toast('已清空档案', false); m.classList.add('hidden'); }
    catch (e) { toast('清空失败：' + e.message, true); }
  };
  closeB.onclick = () => m.classList.add('hidden');
  box.appendChild(saveB); box.appendChild(clearB); box.appendChild(closeB);
  m.innerHTML = ''; m.appendChild(box);
}

// ---------- 导入 ----------
function openImport() {
  const m = $('#modal');
  m.classList.remove('hidden');
  const box = el('div', 'box');
  box.appendChild(el('h2', null, '导入角色卡'));
  const roleSel = el('select');
  for (const o of [['npc', '角色卡 = 世界里的 NPC（普通情况）'], ['player', '角色卡 = 你扮演的角色']]) { const op = el('option', null, o[1]); op.value = o[0]; roleSel.appendChild(op); }
  box.appendChild(el('div', 'row', '这张卡是:')); box.appendChild(roleSel);
  const selfRow = el('div', 'row');
  const selfCb = el('input'); selfCb.type = 'checkbox'; selfCb.checked = true;
  selfRow.appendChild(selfCb);
  selfRow.appendChild(el('span', null, '带入我的身份档案（NPC 模式 = 世界里的"你"是我的设定；角色卡模式忽略）'));
  box.appendChild(selfRow);
  const eraIn = el('input'); eraIn.placeholder = '时代（留空 = 扫描 AI 推断）';
  box.appendChild(el('div', 'row', '时代:')); box.appendChild(eraIn);
  const ta = el('textarea'); ta.placeholder = '粘贴角色卡 JSON 文本（或上传 PNG 卡）';
  box.appendChild(ta);
  const file = el('input'); file.type = 'file'; file.accept = '.png,.json';
  box.appendChild(file);
  const runBtn = el('button', null, '扫描并进入世界');
  const closeBtn = el('button', null, '关闭');
  runBtn.onclick = async () => {
    let payload = ta.value.trim(); let src = 'text';
    if (payload && payload.indexOf('{') === 0) src = 'json';
    if (file.files && file.files[0]) {
      const f = file.files[0];
      const buf = await f.arrayBuffer();
      const arr = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
      payload = btoa(bin);
      src = f.name.endsWith('.png') ? 'png' : 'json';
    }
    if (!payload) { toast('请粘贴或选择文件', true); return; }
    runBtn.textContent = '扫描中…';
    try {
      const noSelf = !selfCb.checked;
      let useFallback = false;
      let scanId = '';
      progStart('⏳ 正在扫描角色卡…', '第 1 步：让 AI 通读全卡做分析');
      let pv = await api('/api/new', { src, payload, role: roleSel.value, era: eraIn.value || undefined, noSelf, preview: true });
      /* v1.65 丙方案：AI 扫描失败**不再静默降级**，先问（重试 / 用本地猜 / 取消）。 */
      while (pv && pv.needChoice) {
        runBtn.textContent = '扫描并进入世界';
        const c = await askScanChoice(pv.scanErr);
        if (c === 'cancel') return;
        if (c === 'fallback') useFallback = true;
        runBtn.textContent = '扫描中…';
        pv = await api('/api/new', { src, payload, role: roleSel.value, era: eraIn.value || undefined, noSelf, preview: true, fallback: useFallback });
      }
      progStop();
      if (!pv.preview) throw new Error((pv && pv.scanErr) || '预览失败');
      scanId = pv.scanId || '';   // v1.67：建世界时复用这一次的扫描结果（不再扫第二遍）
      // 多开局：由 user 点选，而不是随机/confirm
      runBtn.textContent = '扫描并进入世界';
      m.innerHTML = '';
      const b2 = el('div', 'box');
      b2.appendChild(el('h2', null, '已识别：' + (pv.preview.name || '未命名角色卡')));
      b2.appendChild(el('div', 'hint', '时代：' + (pv.preview.era || '未知') + (pv.preview.mode === 'llm' ? ' · AI 通读全卡后重建的世界' : ' · 本地整理')));
      /* v1.70：把"补了多少、裁了多少"露出来 —— 这次改动的价值就在这里（原来只照抄，现在会补全+裁决）。 */
      if (pv.preview.mode === 'llm') {
        const fn = Number(pv.preview.filledN || 0), cn = Number(pv.preview.conflictsN || 0);
        b2.appendChild(el('div', 'hint', '卡里没写的，AI 补了 ' + fn + ' 处' + (cn ? ('；卡里自相矛盾的，裁了 ' + cn + ' 处') : '') + '（都会记进生成清单，随时可查）'));
        const fl = pv.preview.filledList || [];
        if (fl.length) b2.appendChild(el('div', 'hint', '补的举例：' + fl.slice(0, 4).join('；')));
      }
      let selOpening = 0;
      const ol = pv.preview.openingList || [pv.preview.firstScene || ''];
      if (ol.length > 1) {
        b2.appendChild(el('div', 'item', '多条开场 —— 点选一条作为你的第一帧：'));
        const opBox = el('div');
        const rows = [];
        const paint = () => rows.forEach((rw, j) => {
          rw.textContent = (j === selOpening ? '▸ ' : '  ') + String(ol[j] || '').slice(0, 90);
          rw.style.background = j === selOpening ? 'rgba(255,255,255,0.07)' : 'transparent';
        });
        ol.forEach((op, i) => {
          const row = el('div', null, '');
          row.style.cssText = 'cursor:pointer;padding:2px 4px;border-radius:4px;margin:2px 0;white-space:pre-wrap;';
          row.onclick = () => { selOpening = i; paint(); };
          rows.push(row); opBox.appendChild(row);
        });
        paint(); b2.appendChild(opBox);
      } else {
        b2.appendChild(el('div', 'hint', '开场：' + String(ol[0] || '（无）')));
      }
      const go2 = el('button', null, '进入这个新世界');
      const back2 = el('button', null, '返回 / 重新扫描');
      let going2 = false;   // v1.68 防连点（卡开局同样会一点一个世界）
      go2.onclick = async () => {
        if (going2) return;
        going2 = true; go2.disabled = true; go2.textContent = '正在落成…';
        m.classList.add('hidden');
        enterTransition('◉ 世界正在落成…', '「' + (pv.preview.name || '这张卡') + '」场景·人物·开局 组装中——马上进入');
        progStart('⏳ 正在落成世界…', '把卡建成可运行的世界');
        try {
          let r = await api('/api/new', { src, payload, role: roleSel.value, era: eraIn.value || undefined, greeting: selOpening, noSelf: !selfCb.checked, fallback: useFallback, scanId: scanId });
          /* v1.67：建世界这条路上也会 needChoice（缓存没命中、重扫又失败）——必须处理，
             否则 r.view 是 undefined → 世界静默不建，界面"进去就没了"（真事故）。 */
          while (r && r.needChoice) {
            hideTransition();
            const c2 = await askScanChoice(r.scanErr);
            if (c2 === 'cancel') { runBtn.textContent = '扫描并进入世界'; return; }
            if (c2 === 'fallback') useFallback = true;
            enterTransition('◉ 世界正在落成…', '重新整理中——马上进入');
            r = await api('/api/new', { src, payload, role: roleSel.value, era: eraIn.value || undefined, greeting: selOpening, noSelf: !selfCb.checked, fallback: useFallback });
          }
          if (!r || !r.view) throw new Error((r && r.scanErr) || '没有拿到世界（服务端没返回 view）');
          progStop();
          try { refresh(r.view); } catch (e2) { toast('渲染出错：' + String(e2.message || e2), true); }
          toast('已导入「' + (r.card || '') + '」' + (r.archived ? '（已建档，下次可直接开局）' : ''), r.mode === 'heuristic');
        } catch (e) { progStop(); toast('导入失败: ' + e.message, true); }
        hideTransition();
      };
      back2.onclick = () => { m.classList.add('hidden'); openImport(); };
      b2.appendChild(go2); b2.appendChild(back2);
      m.appendChild(b2);
    } catch (e) { progStop(); toast('导入失败: ' + e.message, true); runBtn.textContent = '扫描并进入世界'; }
  };
  closeBtn.onclick = () => m.classList.add('hidden');
  box.appendChild(runBtn); box.appendChild(closeBtn);
  m.innerHTML = ''; m.appendChild(box);
}

/* v1.65 扫描失败三选一（用户选丙方案：两段式——不替你决定，也不让你卡死）。
   AI 扫描失败时弹这个，返回 'retry' | 'fallback' | 'cancel'。 */
function askScanChoice(err) {
  return new Promise(function (resolve) {
    const m = $('#modal');
    m.classList.remove('hidden');
    m.innerHTML = '';
    const b = el('div', 'box');
    b.appendChild(el('h2', null, 'AI 扫描失败'));
    b.appendChild(el('div', 'hint', '模型没有返回可用的世界包。原因：'));
    const e0 = el('div', 'bad', String(err || '未知'));
    e0.style.cssText = 'word-break:break-all;line-height:1.6;margin:6px 0;';
    b.appendChild(e0);
    b.appendChild(el('div', 'hint', '「重试」= 再让 AI 扫一次；「用本地猜」= 不再调 AI，直接按卡的正则整理（人物/地点会更糙，但马上能进）。'));
    const row = el('div', 'row');
    const bTry = el('button', null, '↻ 重试');
    const bFb = el('button', null, '用本地猜');
    const bNo = el('button', 'mini', '取消');
    const done = function (v) { m.classList.add('hidden'); resolve(v); };
    bTry.onclick = function () { done('retry'); };
    bFb.onclick = function () { done('fallback'); };
    bNo.onclick = function () { done('cancel'); };
    row.appendChild(bTry); row.appendChild(bFb); row.appendChild(bNo);
    b.appendChild(row);
    m.appendChild(b);
  });
}

// ---------- 设置 ----------
// ---------- 🎨 画面引擎（独立页）----------
// 生图不是设置里的一个折叠块 —— 它有自己的页面：接入 / 美术 / 九维外貌库。
// 这是"把两个月的心血放回它该在的位置"：九维档案在这里第一次有了正当的接触面
// （在此之前它只是生图管线里的一段隐形数据，谁都看不见）。
/* v1.63 生图主界面（照插件 Feed 的信息架构**适配**，只留引擎真缺的格子）。
   留下：状态卡 / 配图偏好与尺寸 / 图库 / 立绘册 / 最近任务（看"为什么没出"）。
   砍掉（引擎已有或重复）：画师·导演切换、扫描建档、剧情库、主题外观、AI 助理、高级与重置。
   这里所有改动**即时生效**（跟插件一致），不用点保存。 */
/* imageStudioSections 已删除 —— 被 public/studio.js 的工作台取代（v1.81）*/
async function openImageEngine() {
  /* v1.81：生图主界面已抽成独立工作台（public/studio.js + studio.css）。
     原先「设置弹窗里塞 13 个表单行 + imageStudioSections 追加式主界面」的实现已删除。
     旧实现有两个硬伤：① 同一屏两套交互契约（上面要按保存、下面即时生效）；
     ② 立绘生成后调 imageStudioSections(box) 会往同一个 box 再追加一遍全部 5 段。 */
  Studio.open();
}

/* v1.61 内容模块：一个槽位、多档互斥（用户：「预设那 6 块，感觉只需要缝一个就够了」）。
   档位列表来自真实文件夹 presets/content：丢一个 .txt 进去就多一档；选中哪档，哪档的正文才拼进 system。 */
function contentTierBlock(box) {
  box.appendChild(el('div', 'grp-t', '内容模块'));
  const tierBox = el('div'); box.appendChild(tierBox);
  const info = el('div', 'hint', '读档位…'); box.appendChild(info);
  const pathRow = el('div', 'row', '从文件夹导入档位:');
  const pathIn = el('input'); pathIn.placeholder = 'C:\\Users\\你\\Desktop\\某文件夹（里面的 .txt 全导进来）';
  const impBtn = el('button', null, '导入');
  pathRow.appendChild(pathIn); pathRow.appendChild(impBtn);
  box.appendChild(pathRow);
  function paint(r) {
    tierBox.innerHTML = '';
    for (const s of ((r && r.slots) || [])) {
      const row = el('div', 'row', s.name + ':');
      const sel = el('select');
      const op0 = el('option', null, '关（不加任何档）'); op0.value = ''; sel.appendChild(op0);
      for (const t of (s.tiers || [])) { const op = el('option', null, t.id + '（' + t.chars + ' 字）'); op.value = t.id; sel.appendChild(op); }
      sel.value = s.cur || '';
      sel.onchange = async () => {
        try { const rr = await api('/api/content/set', { slot: s.id, id: sel.value }); paint(rr.view); toast('内容模块 → ' + (sel.value || '关'), false); }
        catch (e) { toast('改不了：' + e.message, true); }
      };
      row.appendChild(sel); tierBox.appendChild(row);
    }
    info.textContent = '档位文件夹：' + ((r && r.dir) || '') + '　（一个 .txt = 一档；文件名就是档位名；开头的 # 行是说明，不进提示词）';
  }
  impBtn.onclick = async () => {
    try {
      const r = await api('/api/content/import', { from: pathIn.value });
      toast('导入 ' + ((r.added || []).length) + ' 档' + ((r.skipped || []).length ? '（跳过 ' + r.skipped.length + ' 个同名）' : ''), false);
      paint(r.view);
    } catch (e) { toast('导入失败：' + e.message, true); }
  };
  api('/api/content/list').then(paint).catch(e => { info.textContent = '读不到档位：' + e.message; });
}
async function openSettings() {
  await loadDev();   // v1.86：设置面板要显示框架档位/词汇/生成清单/AI 计量 —— 从开发者出口取
  const m = $('#modal');
  m.classList.remove('hidden');
  const box = el('div', 'box');
  box.appendChild(el('h2', null, '设置'));
  box.appendChild(el('div', 'grp-t', '模型'));
  box.appendChild(el('div', 'row', '你的名字:')); const nm = el('input'); nm.placeholder = '例：阿游'; box.appendChild(nm);
  box.appendChild(el('div', 'row', '主题:'));
  const themeSel = el('select');
  for (const o of [['mint', '终端薄荷（默认）'], ['amber', '琥珀'], ['ice', '冰蓝'], ['bright', '明亮（SnowCat 风）']]) { const op = el('option', null, o[1]); op.value = o[0]; themeSel.appendChild(op); }
  themeSel.value = localStorage.getItem('wx_theme') || 'mint';
  themeSel.onchange = () => { localStorage.setItem('wx_theme', themeSel.value); applyThemeSel(themeSel.value); toast('主题已切换', false); };
  box.appendChild(themeSel);
  if (!window.__themeBound) { window.__themeBound = true; applyThemeSel(themeSel.value); }
  /* v2.05 修 UI-N1（豆包 🔴）：这一排标签原来是**后端字段名**（baseURL / apiKey / model / token / 毫秒），
     新用户看不懂；而且下面几行还泄露了"静默退回本地猜""DeepSeek 官方允许 1~393216""finish_reason=length"。
     现在：标签说人话；术语与实现细节只在 ?dev 里出现（UI 红线：屏幕只放玩家能懂的东西）。 */
  box.appendChild(el('div', 'row', '接口地址:')); const bURL = el('input'); bURL.placeholder = 'https://api.deepseek.com/v1'; box.appendChild(bURL);
  box.appendChild(el('div', 'row', '密钥:')); const key = el('input'); key.type = 'password'; box.appendChild(key);
  box.appendChild(el('div', 'row', '模型名:')); const model = el('input'); model.placeholder = 'deepseek-chat'; box.appendChild(model);
  box.appendChild(el('div', 'row', '单次最长回复:')); const mtIn = el('input'); mtIn.placeholder = '32768（写世界时用）'; box.appendChild(mtIn);
  /* v1.43：把"输出被截断"这件事显示出来。
     以前：截断 → JSON 半截 → 解析失败 → 回退模拟，界面上只看到"AI 变笨了"，看不到病因。
     现在：这里直接显示本局被截断过几次 + 建议。 */
  box.appendChild(el('div', 'row', '等待上限（分钟）:')); const toIn = el('input'); toIn.placeholder = '15'; box.appendChild(toIn);
  box.appendChild(el('div', 'hint', '读大卡（二十万字以上）常要几分钟。等太久没回，这一趟就得重来。'));
  if (__DEV) box.appendChild(el('div', 'hint', '（毫秒）范围 30000 ~ 1800000；超时会被引擎掐断并降级到本地整理。'));
  (function () {
    const st = (__DEV && __DEV.stats) || {};   // v1.86
    const box2 = el('div', 'hint');
    if (!__DEV) return;   // v2.05：这一行是**开发者信息**（token 上限/毫秒数），只在 ?dev 里显示
    box2.textContent = '当前上限：' + ((SRVCFG && SRVCFG.maxTokens) || 32768) + ' token'
      + '（官方允许 1 ~ 393216）'
      + '　超时：' + ((SRVCFG && SRVCFG.timeoutMs) || 90000) + ' ms';
    box.appendChild(box2);
    if (__DEV && st.truncated > 0) {
      box.appendChild(el('div', 'hint', '本局有 ' + st.truncated + ' 次输出撞到长度上限（finish_reason=length）——'
        + '**已经自动续写接上了**（把写了一半的接回去让它接着说，发现重复就停），所以你不会看到「变笨/变短」。'
        + '偶尔一次无所谓；**频繁出现**说明模型在发散或卡带 —— 那时调大上限没用（一次正常输出也就几百到几千字，撞 384K 一定是它自己绕进去了）。'));
    }
  })();
  /* v2.08：档位选择器整个删掉。
     用户拍板：「这 0123 是 AI 的生成框架的权限。默认最高档，不需要调整，也不需要给玩家看到。」
     设置面板里只保留**这个世界已经长出了什么**（那是信息，不是开关）。 */
  box.appendChild(el('div', 'grp-t', '世界的框架（世界会自己长）'));
  (function () {
    const fw = (__DEV && __DEV.framework) || null;   // v1.86：框架/清单只在设置面板里（走 /api/dev）
    if (fw) {
      const bits = [];
      if ((fw.docKinds || []).length) bits.push('文书类型 ' + fw.docKinds.join('/'));
      if ((fw.fxNames || []).length) bits.push('演出名 ' + fw.fxNames.map(x => x.name).join('/'));
      if ((fw.types || []).length) bits.push('型 ' + fw.types.map(x => x.name).join('/'));
      if ((fw.rules || []).length) bits.push('律 ' + fw.rules.map(x => x.name).join('/'));
      box.appendChild(el('div', 'hint', '这个世界已经长出来的：' + (bits.join('；') || '（还没有——它会随着你玩慢慢长）')));
      const mf = (__DEV && __DEV.manifest) || {};   // v1.86
      box.appendChild(el('div', 'hint', '生成清单 ' + (mf.n || 0) + ' 条（这份存档到目前新生成过什么）' + ((mf.pending || 0) ? '　⚠ 有 ' + mf.pending + ' 条没写说明' : '')));
    }
  })();
  contentTierBlock(box);
  box.appendChild(el('div', 'row', '【多 AI 分块·可选】消息回复模型:')); const msgM = el('input'); msgM.placeholder = '留空=复用主模型'; box.appendChild(msgM);
  box.appendChild(el('div', 'hint', '留空时：主 AI/消息 AI/扫描 AI/副 AI 共用同一配置；填了只有"回复消息"走这个模型（多 AI 各负责一块）。'));
  const note = el('div', 'bad', '（未配置 = 演示模式）'); box.appendChild(note);
  const res = el('div'); box.appendChild(res);
  // ---------- 画面引擎：独立页面 ----------
  const IMGC = (SRVCFG && SRVCFG.image) || {};
  const engRow = el('div', 'grp-t');
  engRow.appendChild(el('span', null, '画面引擎'));
  engRow.appendChild(el('span', 'grp-badge' + (IMGC.enabled ? ' on' : ''), IMGC.enabled ? '● 已启用' : '● 未启用'));
  box.appendChild(engRow);
  const engBtn = el('button', 'eng-entry');
  const engIc = el('b'); engIc.innerHTML = iconSVG('gallery') + '<span>生图</span>'; engBtn.appendChild(engIc);
  engBtn.appendChild(el('span', 'hint', '配图偏好 · 分辨率 · 图库 · 立绘册'));
  engBtn.onclick = () => openImageEngine();
  box.appendChild(engBtn);
  try { const mark = () => imgGrp.classList.toggle('off', !imgOn.checked); imgOn.addEventListener('change', mark); mark(); } catch (e) { __deg("app.js", e); }
  const testBtn = el('button', null, '测试连接');
  testBtn.onclick = async () => {
    res.innerHTML = ''; res.appendChild(el('div', 'hint', '测试中…'));
    const r = await api('/api/settings/test', { baseURL: bURL.value, apiKey: key.value, model: model.value });
    res.innerHTML = '';
    if (r.ok) { res.appendChild(el('div', 'ok', '连接成功')); if (!model.value && r.models && r.models.length) { model.value = r.models[0]; } }
    else res.appendChild(el('div', 'bad', r.err));
  };
  const saveBtn = el('button', null, '保存');
  saveBtn.onclick = async () => {
    await api('/api/settings', { baseURL: bURL.value, apiKey: key.value, model: model.value, playerName: nm.value, maxTokens: parseInt(mtIn.value, 10) || 32768, timeoutMs: (parseFloat(toIn.value) ? Math.round(parseFloat(toIn.value) * 60000) : 900000), roles: { msg: { model: (msgM.value || '').trim() } } });
    toast('已保存 ✓', false);
    m.classList.add('hidden');
    try { const st2 = await api('/api/state'); if (st2.config) SRVCFG = st2.config; } catch (e) { __deg("app.js", e); }
    if (V) refresh(V); else renderStart();
  };
  const menuBtn = el('button', null, '返回主菜单');
  menuBtn.onclick = async () => { await api('/api/menu', {}); m.classList.add('hidden'); renderStart(); };
  const resetBtn = el('button', null, '删除当前世界');
  resetBtn.onclick = async () => {
    // v1.74：走同一套确认（先查出当前世界的 id，才能算它的快照/画面占用）
    try {
      const wl = await api('/api/worlds');
      const cur = ((wl.list || []).find(x => x.id === wl.current)) || null;
      if (!cur) { toast('没有正在进行的这个世界', true); return; }
      if (!(await askDeleteWorld(cur))) return;
      m.classList.add('hidden'); renderStart();
    } catch (e) { toast('删除失败：' + e.message, true); }
  };
  const quitBtn = el('button', null, '退出游戏');
  quitBtn.onclick = async () => {
    toast('正在退出…', false);
    try { await api('/api/quit', {}); } catch (e) { toast('退出请求失败：' + String(e.message || e), true); }
    try { window.close(); } catch (e) { __deg("app.js", e); }
  };
  const closeBtn = el('button', null, '关闭');
  closeBtn.onclick = () => m.classList.add('hidden');
  box.appendChild(saveBtn); box.appendChild(testBtn); box.appendChild(menuBtn); box.appendChild(resetBtn); box.appendChild(quitBtn); box.appendChild(closeBtn);
  m.innerHTML = ''; m.appendChild(box);
  api('/api/state').then(st => {
    if (st && st.config) { bURL.value = st.config.baseURL || ''; key.value = st.config.apiKey || ''; model.value = st.config.model || ''; mtIn.value = st.config.maxTokens || 32768; toIn.value = st.config.timeoutMs ? String(Math.round(st.config.timeoutMs / 60000)) : '15'; msgM.value = st.config.msgModel || ''; nm.value = st.config.playerName || '你'; if (st.config.image) { const ig = st.config.image; imgOn.checked = !!ig.enabled; imgBase.value = ig.base || ''; window.__wfJson = ig.workflowJson || ''; imgMode.value = ig.mode || 'zit'; aiPCb.checked = !!ig.aiPrompt || false; imgNeg.value = ig.neg || ''; imgStyle.value = ig.style || ''; imgQ.value = ig.qPrefix || ''; imgArtist.value = ig.artist || ''; imgPfx.value = ig.pPrefix || ''; nsfwCb.checked = !!ig.nsfw; const wfEl2 = box.querySelector('.wf-status'); if (wfEl2) wfEl2.textContent = (window.__wfJson ? ('已载入工作流（' + window.__wfJson.length + ' 字）——保存后生效') : '未载入工作流：点上方「导入工作流 JSON」选择 ComfyUI 导出文件（API 或普通导出均可）'); } }
  }).catch(() => { });
}

// ---------- 自检 ----------
async function selfcheck() {
  showWorking('正在自检……', '完成后弹出报告');
  const r = [];
  let pvData = null;
  /* v2.05：这份报告是给玩家点的按钮，屏幕上不该出现真实世界的钟（同 jsok 那条红线）。
     但"点击生效"需要一个**每次都不同**的读数 —— 所以时钟只在 ?dev 里打，平时用构建号代替。 */
  r.push('JS 探针：' + (__DEV ? (new Date().toLocaleTimeString() + ' · ') : '') + '点击已生效（' + BUILD + '）');
  try { const v = await api('/api/version'); r.push('版本接口：' + v.build); } catch (e) { r.push('版本接口失败：' + String(e.message || e)); }
  try { const s = await api('/api/state'); r.push('世界状态：' + (s.noWorld ? '菜单(无世界)' : (s.place && s.place.name))); } catch (e) { r.push('状态接口失败：' + String(e.message || e)); }
  try {
    const g = await api('/api/world/gen', { preview: true });
    r.push('生成接口：OK，预览「' + (g.preview && g.preview.name) + '」');
    pvData = g.preview || null;
  } catch (e) { r.push('生成接口失败：' + String(e.message || e)); }
  const m = $('#modal'); m.classList.remove('hidden');
  const box = el('div', 'box');
  box.appendChild(el('h2', null, '自检报告'));
  for (const line of r) box.appendChild(el('div', 'item', line));
  if (pvData) { const o = el('button', null, '打开「' + (pvData.name || '该世界') + '」预览'); o.onclick = () => { m.classList.add('hidden'); showWorldCard(pvData); }; box.appendChild(o); }
  const c = el('button', null, '关闭'); c.onclick = () => m.classList.add('hidden');
  box.appendChild(c);
  m.innerHTML = ''; m.appendChild(box);
  hideWorking();
}

// ---------- boot ----------
async function boot() {
  try {
    const ver = await api('/api/version');
    if (ver && ver.build && ver.build !== BUILD) toast('前后端版本不一致（前端 ' + BUILD + ' / 服务端 ' + ver.build + '），请完全关闭窗口重开！', true);
  } catch (e) { toast('无法确认版本（旧服务端？）——请完全关闭窗口重开！', true); }
  try {
    const st = await api('/api/state');
    if (st && st.config) { SRVCFG = st.config; if (st.config.userSelf) window.__userSelf = st.config.userSelf; }
    if (st.noWorld) { renderStart(); return; }
    refresh(st); 
  } catch (e) { toast('连接失败: ' + e.message, true); renderStart(); }
}
if (!window.__resizeBound) {
  window.__resizeBound = true;
  let t = null;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { try { fitSceneFont(); } catch (e) { __deg("app.js", e); } }, 150); });
}
if (!window.__escBound) {
  window.__escBound = true;
  /* v2.05 修（P2-1.7）：Esc 原来只关模态框。现在按**层级从外到内**逐层退：
     模态框（最上面）→「更多」菜单 → 面板。一层一层退，一次 Esc 只关一层。 */
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const mm = document.getElementById('modal');
    if (mm && !mm.classList.contains('hidden')) { mm.classList.add('hidden'); return; }
    const box = document.getElementById('mtiles');
    if (box && !box.classList.contains('hidden')) { closeTiles(); return; }
    if (panelKind) closePanel();
  });
}
(function initDock() {
  const cmdEl = $('#cmd');
  if (!cmdEl) return;
  /* v1.33：三枚重型 Tab（行动/说话/提问）→ 两枚轻量提示。
     它们**只改占位提示**，不改变任何提交逻辑——意图由后端 parseIntent 判，
     不该让玩家先选模式（设计稿 §6.2）。 */
  const qt = { say: '你说：', act: '你做：' };
  document.querySelectorAll('.qt').forEach(x => {
    x.onclick = () => {
      const k = x.dataset.k;
      document.querySelectorAll('.qt').forEach(y => y.classList.remove('hint-on'));
      x.classList.add('hint-on');
      const c = $('#cmd'); if (c) { c.placeholder = qt[k] || '你想做什么？'; c.focus(); }
    };
  });
  const sendBtn = $('#send'); if (sendBtn) { sendBtn.dataset.act = 'submit'; sendBtn.textContent = '执行'; }
  const gearBtn = document.getElementById('gear'); if (gearBtn) { gearBtn.dataset.act = 'settings'; }
  cmdEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(cmdEl.value || ''); } });
  cmdEl.addEventListener('input', () => { cmdEl.style.height = 'auto'; cmdEl.style.height = Math.min(cmdEl.scrollHeight, 160) + 'px'; });
})();
boot();
