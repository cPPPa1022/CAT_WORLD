// app.js — 世界模拟器前端 v1.8 FINAL（全局委托 · 舞台模式 · 世界声明式工具）
'use strict';

let V = null;
let panelKind = null;
let phoneTab = 'home';
let busy = false;
let SRVCFG = null;
let __galleryReady = false;   // 图库（第二个数据源）是否已针对当前世界载入
const BUILD = 'v1.32';

// ---------- 工具/app 注册表（后端 view.tools 声明；没有的 app 不渲染） ----------
const APP_REG = {
  sms: { name: '消息', icon: '✉' },
  letters: { name: '信札', icon: '✉' },
  contacts: { name: '通讯录', icon: '👤' },
  clock: { name: '时钟', icon: '🕐' },
  calendar: { name: '日程', icon: '📅' },
  news: { name: '新闻', icon: '📰' },
  weather: { name: '天气', icon: '☁' },
  map: { name: '地图', icon: '🗺' },
  album: { name: '相册', icon: '🖼' }
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
  } catch (e) { }
}
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
async function api(path, body) {
  const opt = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {};
  const r = await fetch(path, opt);
  const j = await r.json();
  if (j && j.err) throw new Error(j.err);
  return j;
}
window.__errs = [];
window.onerror = function (msg, src, line) {
  try {
    window.__errs.push(String(msg).slice(0, 200) + ' @line' + (line || '?'));
    if (window.__errs.length > 20) window.__errs.shift();
    toast('⚠ 页面报错：' + String(msg).slice(0, 200), true);
    // 防锁死兜底：页面报错时必然不是"正常等待中"，立刻解锁输入（若确实在请求中，回合回来后刷新）
    if (typeof busy !== 'undefined' && busy) { busy = false; const sb = document.getElementById('send'), cmd = document.getElementById('cmd'); if (sb) { sb.disabled = false; sb.textContent = '行动'; } if (cmd) cmd.disabled = false; }
  } catch (e) { }
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
  let b = document.getElementById('jsok');
  if (!b) { b = el('div', 'hint'); b.id = 'jsok'; b.style.cssText = 'position:fixed;left:14px;bottom:64px;z-index:300;color:#2f8f6a;font-size:11px;'; document.body.appendChild(b); }
  b.textContent = 'JS✔ ' + BUILD + ' · ' + new Date().toLocaleTimeString();
}

// ---------- 全局事件委托 ----------
// ---------- 未接入 AI 时：AI 相关功能（扫描/生成/卡盒开局）不可用，引导配置；演示世界/读档保留 ----------
function requireAI(what) {
  if (SRVCFG && SRVCFG.baseURL && SRVCFG.model) return true;
  toast('⚠ 尚未接入 AI 模型——' + what + '需要 AI。请在下面配置一次（baseURL + apiKey + model）', true);
  openSettings();
  return false;
}
const ACTIONS = {
  gen: () => { if (!requireAI('生成世界')) return; genWorld(); },
  import: () => { if (!requireAI('扫描角色卡')) return; openImport(); },
  demo: async () => { try { const r = await api('/api/demo', {}); refresh(r.view); } catch (e) { toast('进入失败：' + e.message, true); } },
  settings: () => openSettings(),
  resume: () => openResume(),
  cardbox: () => { if (!requireAI('角色卡开局')) return; openCardbox(); },
  self: () => openSelfSetup(),
  resumeWorld: async () => {
    try { const r = await api('/api/resume-current'); if (r.view) { refresh(r.view); } else { toast('当前没有已加载的世界', true); } }
    catch (e) { toast('返回失败：' + e.message, true); }
  },
  more: () => toggleTools(),
  rail: () => { const r = document.getElementById('rail'); if (r) r.classList.toggle('open'); },   // 窄屏右栏抽屉（宽屏无此按钮）
  selfcheck: () => selfcheck(),
  test: () => { showWorking('⚡ 测试：你看到这层=JS 活着且点击即时生效。', '1.5 秒后自动消失'); setTimeout(hideWorking, 1500); },
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
    box.appendChild(el('h2', null, '📋 诊断（复制后发我）'));
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
    const bl = $('#buildline'); if (bl) bl.textContent = 'AI 驱动的世界模拟 · ' + BUILD + '（构建 ' + BUILD + '）';
    $('#app').classList.add('hidden');
    $('#start').classList.remove('hidden');
    __galleryReady = false;                     // 回主菜单：下次进世界重新拉图库（可能换了世界）
    const m = $('#start-menu'); m.innerHTML = '';
    const side = $('#start-side'); side.innerHTML = '';
    let st = {};
    try { st = await api('/api/state'); } catch (e) { }
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
    grp('开始游戏', [
      { label: '✨ 生成世界', act: 'gen' },
      { label: '📥 导入世界（扫描角色卡）', act: 'import' },
      { label: '🎁 演示世界', act: 'demo' }
    ]);
    const cont = [];
    if (st.currentWorld) cont.push({ label: '▶ 继续当前世界（' + st.currentWorld + '）', act: 'resumeWorld' });
    cont.push({ label: '🗂 读取存档', act: 'resume' });
    cont.push({ label: '🃏 读取角色卡开局', act: 'cardbox' });
    grp('继续游戏', cont);
    const gap = el('div', 'menu-gap'); m.appendChild(gap);
    const s1 = el('button', 'menu-item', '⚙ 设置'); s1.dataset.act = 'settings'; m.appendChild(s1);
    const selfN = Object.keys(us).length;
    const s2 = el('button', 'menu-item' + (selfN ? '' : ' warn'), '👤 设定 · 我的身份档案' + (selfN ? '（已设定 ' + selfN + ' 项）' : '（未设定）'));
    s2.dataset.act = 'self'; m.appendChild(s2);
    m.appendChild(el('div', 'minor', '后台在跑：世界只管开一局，剩下的交给 AI（模型接入在 ⚙ 设置）'));
    // ---- 右侧：信息面板 ----
    const card = (h) => { const c = el('div', 'side-card'); c.appendChild(el('div', 'sc-h', h)); side.appendChild(c); return c; };
    const mc = card('模型状态');
    if (cfgS.baseURL && cfgS.model) {
      mc.appendChild(el('div', 'sc-b', '⬤ 已连接：' + cfgS.model));
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
    for (const it of [['🔧 自检', 'selfcheck'], ['📋 诊断', 'diag'], ['⚡ 测试', 'test']]) { const b = el('button', 'mini', it[0]); b.dataset.act = it[1]; tt.appendChild(b); }
    if (st.currentWorld) { const b = el('button', 'mini', '▶ 回到当前世界'); b.dataset.act = 'resumeWorld'; tt.appendChild(b); }
    tc.appendChild(tt);
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
  const st = V.stats || {};
  const pill = (txt, cls) => { const s = el('span', 'st-pill' + (cls ? ' ' + cls : ''), txt); elBox.appendChild(s); return s; };
  pill('回合 #' + (V.turnN || 1));
  pill('LLM ' + (st.lastMs ? (st.lastMs / 1000).toFixed(1) + 's' : '演示(mock)') + ' · 调用×' + (st.lastCalls || 0) + (V.delegates ? ' · 委派×' + V.delegates : ''));
  pill('输入 ' + fmtTok(st.tokIn) + ' / 输出 ' + fmtTok(st.tokOut) + ' · 缓存 ' + (st.cachePct || 0) + '%');
  // 任务计数属于开发者信息，不上桌（要看就开 ?dev）
}
let __lastWx = null;
let __wxTimer = null;
function playWeatherFx(fx) {
  const s = $('#stage');
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
  if (fx.mute) { if (fx.note) toast('🔊 ' + fx.note, false); return; }
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
  if (fx.note) toast('🌦 ' + fx.note, false);
  if (__wxTimer) clearTimeout(__wxTimer);
  __wxTimer = setTimeout(() => { const w = host.querySelector('.wxfx'); if (w) w.remove(); ascii.style.filter = ''; }, Math.round((fx.durSec || 4.5) * 1000));
}
function refresh(view) {
  if (!view) return;
  if (view.noWorld) { renderStart(); return; }
  const wxNew = (view.weather && view.weather.text) || (view.weather || '');
  const wxFx = view.weatherFx;
  if (wxNew !== __lastWx) { __lastWx = wxNew; setTimeout(() => playWeatherFx(wxFx), 260); }
  if (view.weatherCue && (!window.__lastCue || window.__lastCue !== view.weatherCue)) {
    window.__lastCue = view.weatherCue;
    setTimeout(() => toast('🔊 ' + view.weatherCue, false), 800);
  }
  setTimeout(autoRender, 1500);
  V = view;
  if (view.config) { SRVCFG = view.config; if (view.config.userSelf) window.__userSelf = view.config.userSelf; }
  $('#start').classList.add('hidden');
  $('#app').classList.remove('hidden');
  if (!__galleryReady) {
    __galleryReady = true;                                   // 防重入
    loadGallery().then(() => { try { renderStage(); } catch (e) { } }); // 图库到位 → 重绘舞台（场景图/内联图卡）
  }
  for (const fn of [renderTopbar, renderStage, renderRail, renderChips, renderPanel, renderStatline]) {
    try { fn(); } catch (e) { try { toast('界面渲染出错：' + String(e.message || e), true); } catch (e2) { } }
  }
  try { jsok(); } catch (e) { }
}

// 图库是"第二个数据源"（图和任务分别来自 /api/gallery/list 与 /api/state）：
// 两者不同步 = 任务显示 done 但图不显示、必须手动刷新（§6.9 的真正根因）。
// 所以改成"进世界后拉一次，到位再重绘舞台"，而不是启动时拉一次空表。
// 出图收尾（统一）：重载图库列表 → 拉最新 state → 刷新界面（图卡/立绘/相册即时出现）
async function afterRenderDone() {
  try {
    await loadGallery();
    const s = await api('/api/state');
    if (s && !s.noWorld) { V = s; refresh(s); }
  } catch (e) { }
}
// 生图自动渲染（设置开启时：提示词就绪的任务逐条提交 ComfyUI）
let __rendering = false;
async function autoRender() {
  if (__rendering) return;
  if (!(SRVCFG && SRVCFG.image && SRVCFG.image.enabled && SRVCFG.image.base && SRVCFG.image.workflowJson)) return;
  const todo = ((V && V.imgTasks) || []).filter(t => t.status === 'prompted' || t.status === 'queued');
  if (!todo.length) return;
  __rendering = true;
  try {
    for (const t of todo) {
      try { const r = await api('/api/comfy/render', { id: t.id }); if (r.ok || r.status === 'done') toast('🖼 画面已生成', false); }
      catch (e) { }
    }
  } catch (e) { } finally {
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
      w.appendChild(el('div', 'img-inline-cap', '🖼 ' + cap));
    } else if (t.status === 'rendering') {
      w.appendChild(el('span', 'img-inline-chip', '🖼 渲染中…'));
    } else if (t.status === 'fail') {
      const b = el('button', 'mini img-inline-btn', '🔁 重试');
      b.onclick = async () => { b.textContent = '渲染中…'; try { const r = await api('/api/comfy/render', { id }); if (r.ok) { toast('🖼 重试成功', false); afterRenderDone(); } else toast('失败：' + (r.err || '?'), true); } catch (err) { toast(err.message, true); } b.textContent = '🔁 重试'; };
      w.appendChild(b);
      w.appendChild(el('span', 'hint img-inline-chip', String(t.err || '').slice(0, 26)));
    } else {
      const b = el('button', 'mini img-inline-btn', '🎨 生成');
      b.onclick = async () => {
        b.textContent = '渲染中…'; b.disabled = true;
        try { const r = await api('/api/comfy/render', { id }); if (r.ok) { toast('🖼 画面已生成', false); afterRenderDone(); } else toast('失败：' + (r.err || '?'), true); }
        catch (err) { toast(err.message, true); }
        b.textContent = '🎨 生成'; b.disabled = false;
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
    // 排版分层（用户点名「文字要用对地方」）：
    //   台词 = 舞台主角（最大最亮）；动作/神态 = 贴身副标题（贴着说话的人）；
    //   语气**不再渲染成一个独立标签** —— 把情绪直接写成一个词告诉玩家，是 Tell 不是 Show。
    const main = el('div', 'dlg-main');
    main.appendChild(el('span', 'who', who));
    // 动作从台词里解放出来：有独立槽位就用它，否则退回从 text 里的（）括号提取（兼容旧存档）
    let said = String(L.text == null ? '' : L.text);
    let act = L.action ? String(L.action) : '';
    const m = said.match(/^\s*[（(]([^）)]{1,60})[）)]\s*/);
    if (!act && m) { act = m[1]; said = said.slice(m[0].length); }
    if (act) main.appendChild(el('div', 'dlg-act', act));
    main.appendChild(el('div', 'line', '「' + said + '」'));
    // 神态/语气只做**视觉修饰**（颜色/字重），不占文字位
    if (L.expression || L.voice) {
      main.dataset.mood = String(L.expression || L.voice).slice(0, 8);
      main.classList.add('has-mood');
    }
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
  else if (L.type === 'ambient') { e.className = 'beat ambient'; e.appendChild(longText(L.text)); }
  else if (L.type === 'stage-tag') { e.className = 'stage-tag'; e.textContent = L.text; }
  else { e.className = 'beat narration'; e.appendChild(longText(L.text)); }
  if (L.imgs && L.imgs.length) e.appendChild(imgInline(L.imgs)); // 生图进叙事流：图卡内联在对应 beat 之后
  return e;
}
// 增量入场游标：只有"本回合新出现的"内容才播入场动画
// （全量重绘 + 元素自带动画 = 每回合整屏重播淡入 = 闪烁）
let __drawnTo = 0, __lastScene = '';
function renderStage() {
  const s = $('#stage');
  s.innerHTML = '';
  // 在场人物栏：放最上面（画占主导，人物在画之上）
  const cast = (V.cast || []).filter(c => c.id !== 'player');
  if (cast.length) {
    const row = el('div', 'stage-cast top');
    row.appendChild(el('span', 'cast-label', '在场 ·'));
    for (const c of cast) {
      const cc = el('button', 'cast-card');
      const cname = spSafe(c.name || '');
      cc.appendChild(av(cname || '?', 30));
      cc.appendChild(el('span', 'cast-name', cname || '？'));
      cc.appendChild(el('span', 'cast-mood', (c.mood || '') + ''));
      cc.dataset.act = 'tool:people';
      row.appendChild(cc);
    }
    s.appendChild(row);
  }
  const log = (V.sceneLog || []);
  let cur = -1;
  for (let i = 0; i < log.length; i++) { if (log[i].type === 'stage-tag') cur = i; }
  const act = cur >= 0 ? log.slice(cur) : log;
  const hist = cur > 0 ? log.slice(0, cur) : [];
  if (hist.length) {
    const fold = el('div', 'story-fold');
    const btn = el('button', 'mini', '▼ 上一幕（' + hist.length + ' 行）');
    const wrap = el('div', 'hidden');
    for (const L of hist) wrap.appendChild(beatLine(L));
    btn.onclick = () => { const hid = wrap.classList.toggle('hidden'); btn.textContent = hid ? ('▼ 上一幕（' + hist.length + ' 行）') : '▲ 收起上一幕'; };
    fold.appendChild(btn); fold.appendChild(wrap);
    s.appendChild(fold);
  }
  const tag = act.find(l => l.type === 'stage-tag');
  const sceneKey = tag ? tag.text : '';
  const sceneChanged = sceneKey !== __lastScene;
  if (tag) { const card = el('div', 'scene-card' + (sceneChanged ? ' enter' : '')); card.appendChild(el('div', 'sc-tag', tag.text.replace(/\[|\]/g, ''))); s.appendChild(card); }
  const sImg = latestSceneImage();
  if (sImg) {
    const box = el('div', 'stage-img' + (sceneChanged ? ' enter' : ''));
    const im = document.createElement('img');
    im.src = '/api/gallery/img?id=' + sImg.id;
    im.onclick = () => showModalImg(im.src);
    box.appendChild(im);
    box.appendChild(el('div', 'stage-img-cap', imgCaption(sImg)));
    s.appendChild(box);
  } else if (V.sceneArt) { const wrap = el('div', 'ascii' + (sceneChanged ? ' enter' : '')); wrap.appendChild(artGrid(V.sceneArt, V.artMarks)); s.appendChild(wrap); }
  s.onclick = (ev) => { if (!ev.target.closest('.mark') && !ev.target.closest('.amenu')) closeMenu(); };
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
  __drawnTo = log.length;
  __lastScene = sceneKey;
  renderImgBar(s);
  s.scrollTop = 0;
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
function renderImgBar(s) {
  if (!imgEnabled()) return;                   // 生图关着：不显示画面任务条
  const tasks = (V && V.imgTasks) || [];
  if (!tasks.length) return;
  const bar = el('div', 'imgbar');
  bar.appendChild(el('span', 'imgbar-t', '🎬 画面'));
  for (const t of tasks.slice(-3)) {
    const it = el('span', 'imgchip');
    const sum = imgCaption(t);
    it.appendChild(el('span', null, '🖼 ' + sum));
    if (t.status === 'done') {
      const g0 = (typeof __gallery !== 'undefined' ? __gallery : []).find(x => x.id === t.id);
      const b = el('button', 'mini', '查看');
      b.onclick = () => { if (g0) showModalImg('/api/gallery/img?id=' + g0.id); };
      it.appendChild(b);
    } else if (t.status === 'prompted' || t.status === 'queued') {
      const b = el('button', 'mini', '🎨 生图');
      b.onclick = async () => {
        b.textContent = '渲染中…';
        try { const r = await api('/api/comfy/render', { id: t.id }); if (r.ok) { toast('🖼 完成：' + sum, false); afterRenderDone(); } else toast('失败：' + (r.err || '?'), true); }
        catch (e) { toast(e.message, true); }
        b.textContent = '🎨 生图';
      };
      it.appendChild(b);
    } else if (t.status === 'fail') {
      it.appendChild(el('span', 'hint', '失败：' + String(t.err || '？').slice(0, 40)));
      const rb = el('button', 'mini', '🔁 重试');
      rb.onclick = async () => {
        rb.textContent = '渲染中…'; rb.disabled = true;
        try { const r = await api('/api/comfy/render', { id: t.id }); if (r.ok) { toast('🖼 重试成功', false); afterRenderDone(); } else toast('失败：' + (r.err || '?'), true); }
        catch (e) { toast(e.message, true); }
        rb.textContent = '🔁 重试'; rb.disabled = false;
      };
      it.appendChild(rb);
    }
    bar.appendChild(it);
  }
  s.appendChild(bar);
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
  $('#stage').appendChild(menu);
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
    b.appendChild(el('span', 't-i', a[1]));
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
function appendRailToggle() {
  const b = el('button', 'pill gear rail-toggle', '▤ 面板');
  b.id = 'railtgl';
  b.title = '展开/收起右栏（窄屏可用）';
  b.dataset.act = 'rail';
  document.body.appendChild(b);
}
document.addEventListener('click', (e) => {
  const box = document.getElementById('mtiles');
  if (!box || box.classList.contains('hidden')) return;
  if (e.target.closest('#mtiles') || e.target.closest('.tool.more')) return;
  box.classList.add('hidden');
  const btn = document.querySelector('.tool.more');
  if (btn) btn.classList.remove('on');
}, true);

function renderTopbar() {
  const t = $('#topbar');
  t.innerHTML = '';
  t.appendChild(el('span', 'pill', V.time.precise ? '🕐 ' + V.time.label : '🌘 ' + V.time.label + '（体感）'));
  if (V.weather && V.weather.unknown) {
    const icon = (V.weather.via === 'sound') ? '🔊' : '❄';
    const wb = el('button', 'pill wx', icon + ' ' + (V.weather.text || '？（去窗边看看）') + '（去窗边确认）');
    wb.onclick = () => submit('我看看窗外');
    t.appendChild(wb);
    if (V.weather.heard && !V.weather.seen) {
      const phoneTool = (V.tools || []).find(x => ((x.apps || []).indexOf('weather') >= 0));
      if (phoneTool) {
        const mb = el('button', 'pill wx', '📱 看手机天气');
        mb.onclick = () => { openPanel(phoneTool.id); phoneTab = 'app:weather'; };
        t.appendChild(mb);
      }
    }
  } else {
    const wx = V.weather && V.weather.text ? V.weather.text : (V.weather || '');
    t.appendChild(el('span', 'pill wx', '❄ ' + wx));
  }
  t.appendChild(el('span', 'pill plc', '⌖ ' + V.place.name));
  const msgTool = (V.tools || []).find(tool => (tool.apps || []).indexOf('sms') >= 0 || (tool.apps || []).indexOf('letters') >= 0);
  if (V.unread > 0 && msgTool) { const un = el('button', 'pill badge', (msgTool.icon || '📟') + ' 未读 ' + V.unread); un.dataset.act = 'tool:' + msgTool.id; t.appendChild(un); }
  /* v1.32 渐进披露：顶栏不再平铺 14 个图标（实测就是这么平铺的）。
     层级来自"世界是不是主体"——世界给的载体（大哥大/舆图）和扮演本身（我/身世/人物/物品/画面）留在台面，
     台面工具（世界书/概况/存档/创作）收进「更多」。窄屏由 CSS 再收一档（1120px 留 5，860px 留 2），不靠人记宽度。 */
  const tools = el('span', 'toolbar-top');
  const tl = [['gen', '🎲', '创作新世界', 1]];
  for (const tool of (V.tools || [])) tl.push(['tool:' + tool.id, tool.icon, tool.name, 1]);
  tl.push(['me', '🐈', '我', 2], ['log', '📖', '身世', 3], ['people', '👤', '人物', 4], ['goods', '🎒', '物品', 5]);
  const rest = [['gallery', '🎨', '画面'], ['wi', '📚', '世界书'], ['overview', '🌍', '概况'], ['archive', '📜', '存档']];
  for (const a of tl) {
    const b = el('button', 'tool', a[1]);
    b.title = a[2];
    /* keep 是"屏宽档位"，不是"要不要显示"（CSS 按三个断点收，见 style.css v1.32 段）：
       1 = 三档都留（世界给的载体 + 创作入口，宽度不够时它们最不该消失）
       2 = 窄屏（≤860）才收
       0 = 中屏（≤1120）就收进「⋯ 更多」 */
    const core = (a[0] === 'gen' || a[0].indexOf('tool:') === 0);
    b.dataset.keep = core ? '1' : (a[3] <= 4 ? '2' : '0');
    b.dataset.act = a[0] === 'gen' ? 'gen' : (a[0].indexOf('tool:') === 0 ? a[0] : 'tool:' + a[0]);
    tools.appendChild(b);
  }
  const more = el('button', 'tool more', '⋯');
  more.title = '更多（世界书 / 概况 / 存档 / 画面 / 创作）'; more.setAttribute('aria-label', '更多面板');
  more.dataset.act = 'more';
  tools.appendChild(more);
  t.appendChild(tools);
  mountTilePanel(t, rest);
  if (!document.getElementById('railtgl')) appendRailToggle();
  const cat = catFace();
  t.appendChild(el('span', 'pill catpill', '🐱 ' + cat.t + ' ' + cat.f));
  const rfr = el('button', 'pill gear', '↻ 刷新'); rfr.title = '刷新'; rfr.dataset.act = 'refresh'; t.appendChild(rfr);
  const g = el('button', 'pill gear' + (V.mode === 'live' ? ' on' : ''), (V.mode === 'live' ? '⚙ 设置·' + (V.apiModel || '已连接') : '⚙ 设置·未接模型'));
  g.title = '设置'; g.dataset.act = 'settings'; t.appendChild(g);
}
function renderRail() {
  const r = $('#rail');
  r.innerHTML = '';
  // 工具入口只在顶栏出现（原来这里还有一排，是重复的——两处摆同一批东西）
  r.appendChild(el('h4', null, '在场'));
  for (const c of (V.cast || [])) {
    const it = el('div', 'item', c.id === 'player' ? '【你】' : c.name);
    if (c.id !== 'player') it.appendChild(el('span', ' hint', ' (' + (c.mood || '') + ')'));
    r.appendChild(it);
  }
  r.appendChild(el('h4', null, '你的状态'));
  const meC = (V.cast || []).find(c => c.id === 'player');
  if (meC && meC.state) r.appendChild(el('div', 'item', '疲劳:' + (meC.state.fatigue || '低') + ' 饥饿:' + (meC.state.hunger || '低')));
  if (V.money) r.appendChild(el('div', 'item', '钱:' + (V.money.cash || 0) + (V.money.digital ? ' +电' + V.money.digital : '')));
  // ---- 认知面板：你记得的东西 ----
  const mv = V.me || {};
  const short = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; };
  const claims = (mv.claims || []).slice(-3);
  if (claims.length) {
    r.appendChild(el('h4', null, '我答应过的事'));
    for (const c of claims) r.appendChild(el('div', 'item hint', short(c.title, 14) + (c.when ? ' · ' + short(c.when, 8) : '')));
  }
  const bonds = (mv.bonds || []).filter(b => b && b.name).slice(0, 6);
  if (bonds.length) {
    r.appendChild(el('h4', null, '我知道的人'));
    for (const b of bonds) {
      const it = el('div', 'item', b.name);
      it.appendChild(el('span', ' hint', ' ' + short(String(b.tone || '').split('（')[0], 8)));
      r.appendChild(it);
    }
  }
  const heard = (V.news || []).slice(-2);
  if (heard.length) {
    r.appendChild(el('h4', null, '我听说过的事'));
    for (const n of heard) r.appendChild(el('div', 'item hint', short(n.title || n.summary, 16)));
  }
  // 你记得的：只含玩家亲历的事（后端 myLogView 已把客观账本滤掉）。这里是"你的记忆"，不是世界真相。
  const mine = (V.myLog || []).slice(-3);
  if (mine.length) {
    r.appendChild(el('h4', null, '你记得的'));
    for (const l of mine) r.appendChild(el('div', 'item hint', short(l.text, 20)));
  }
}
function renderChips() {
  const c = $('#chips');
  c.innerHTML = '';
  // 「你注意到」：场景里可交互的人与物（= 场景画上的那些标记，同一份数据）
  const iv = (V.interacts || []);
  if (iv.length) {
    c.appendChild(el('span', 'chips-h', '你注意到'));
    for (const it of iv) {
      const b = el('button', null, it.label || it.id);
      b.onclick = () => showActions(it.id);
      c.appendChild(b);
    }
  } else {
    // 退回后端 affordances（旧路径，仅在没有场景交互时兜底）
    for (const a of (V.affordances || [])) {
      const b = el('button', null, a.label);
      b.onclick = () => submit(a.action);
      c.appendChild(b);
    }
  }
  // 输入框引导：场景相关，不是通用例句
  const cmd = document.getElementById('cmd');
  if (cmd && V.place && V.place.name) cmd.placeholder = '在' + V.place.name + '，你要做什么？　（Enter 开口）';
}
function applyThemeSel(t) { document.body.dataset.theme = (t && t !== 'mint') ? t : 'mint'; if (!t || t === 'mint') delete document.body.dataset.theme; }
function setBusy(b) {
  busy = b;
  const sb = $('#send'); if (sb) sb.disabled = b;
  const cmd = $('#cmd'); if (cmd) cmd.disabled = b;
  if (sb) sb.textContent = b ? '…' : '行动';
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
    const wdog = setTimeout(() => { try { ctrl.abort(); } catch (e) { } }, 150000);
    const resp = await fetch('/api/turn/stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: ctrl.signal });
    if (resp.ok && resp.headers.get('content-type') && resp.headers.get('content-type').indexOf('text/event-stream') >= 0) {
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let acc = '';
      let result = null;
      showWorking('主 AI 正在写戏…', '');
      let got = 0;
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        const chunk = dec.decode(r.value, { stream: true });
        for (const blk of chunk.split('\n\n')) {
          const line = blk.trim();
          if (!line || line.indexOf('data:') !== 0) continue;
          let ev = {};
          try { ev = JSON.parse(line.slice(5).trim()); } catch (e3) { continue; }
          if (ev.d) { acc += ev.d; got += ev.d.length; updateWorking(null, '回合书写中…（已 ' + got + ' 字，完成后一次性展开）'); }
          else if (ev.view) { result = ev; }
          else if (ev.err) { throw new Error(ev.err); }
        }
      }
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
    } catch (e2) { toast('回合失败：' + String(e2.message || e.message), true); }
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
  const tt = el('span', 'panel-title', panelLabel(panelKind)); head.appendChild(tt);
  const cat = catFace();
  head.appendChild(el('span', 'panel-cat ' + cat.cls, '🐱 ' + cat.f + ' ' + cat.t));
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
  else if (panelKind === 'gallery') panelGallery(P);
}
function panelLabel(k) {
  const t = (V && (V.tools || []).find(x => x.id === k));
  if (t) return t.icon + ' ' + t.name;
  return { phone: '📱 手机', map: '🗺 地图', me: '🐈 我', log: '📖 身世日志', people: '👤 人物', news: '📰 新闻', goods: '🎒 物品', wi: '📚 世界书', overview: '🌍 世界概况', archive: '📜 存档', gallery: '🎨 画面' }[k] || k;
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
    renderApp(aid, p);
    return;
  }
  phoneHome(p, tool);
}
function renderApp(aid, p) {
  if (aid === 'sms') return phoneAppSms(p, '消息');
  if (aid === 'letters') return phoneAppSms(p, '信札');
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
  } catch (e) { }
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
    icon.appendChild(el('span', 'papp-ic', meta.icon));
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
    if (!inp.value || busy) return;
    bt.textContent = '…';
    try {
      const v = await api('/api/msg/send', { to: from, text: inp.value });
      refresh(v.view);
      if (v.view && v.view.msgReplyAt) toast('已发送 —— 大概 ' + v.view.msgReplyAt + ' 她才能看到（也可能不回）', false);
    }
    catch (e) { toast('发送失败：' + e.message, true); bt.textContent = '发送'; }
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
  try { api('/api/wxmark', {}).catch(() => { }); } catch (e) { }
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
      cell.appendChild(el('div', 'hint', '🖼 ' + (cap || '画面')));
      grid.appendChild(cell);
    }
    p.appendChild(grid);
    p.appendChild(el('div', 'sysnote', '相册=世界画面库（可当存档回味；同一提示词自动复用缓存不重画）。'));
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
  p.appendChild(el('h4', 'hint', '📖 我知道的'));
  for (const k of (lg.known || [])) p.appendChild(el('div', 'item logrow', '▸ ' + k.k + '：' + k.v));
  if (!(lg.known || []).length) p.appendChild(el('div', 'hint', '（尚未记录）'));
  p.appendChild(el('h4', 'hint', '🌫 隐约记得（剧情说到才会想起来）'));
  for (const s of (lg.shadows || [])) p.appendChild(el('div', 'item dim', '▸ ' + s.hint + '　——还没想起来'));
  if (!(lg.shadows || []).length) p.appendChild(el('div', 'hint', '暂时没有。'));
  if ((lg.recalled || []).length) {
    p.appendChild(el('h4', 'hint', '✨ 想起来了'));
    for (const s of (lg.recalled || [])) {
      p.appendChild(el('div', 'item', '▸ ' + (s.hint || '') + '（' + String(s.t || '').slice(5, 16) + '）'));
      p.appendChild(el('div', 'hint recall-txt', '　' + s.text));
    }
  }
  p.appendChild(el('h4', 'hint', '📜 身世记事'));
  for (const ev of (lg.events || []).slice().reverse()) p.appendChild(el('div', 'hint', '· ' + String(ev.t || '').slice(5, 16) + '　——' + (ev.title || '')));
  if (!(lg.events || []).length) p.appendChild(el('div', 'hint', '（还没写下什么——旧事想起来时，它会记在这里）'));
}
function showRecall(recs) {
  const arr = Array.isArray(recs) ? recs : [recs];
  arr.forEach((rc, i) => setTimeout(() => {
    const d = el('div', 'recallcard');
    d.appendChild(el('div', 'rc-head', '— 你突然想起 —'));
    if (rc.hint) d.appendChild(el('div', 'rc-hint', rc.hint));
    d.appendChild(el('div', 'rc-text', rc.text || ''));
    document.body.appendChild(d);
    setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 500); }, 6500);
  }, 600 + i * 2600));
}

function panelMe(p) {
  const me = V.me || {};
  const idn = me.identity || {};
  p.appendChild(el('div', 'item', '你 · ' + (me.name || '你') + (idn.年龄 ? '，' + idn.年龄 + '岁' : '') + (idn.身份 ? ' · ' + idn.身份 : '')));
  if (idn.职业) p.appendChild(el('div', 'hint', '职业：' + idn.职业));
  if (me.appearance) p.appendChild(el('div', 'hint', '你注意到自己：' + me.appearance));
  if (me.backstory) p.appendChild(el('div', '', '你的来历：' + me.backstory));
  if (me.ability) p.appendChild(el('div', 'hint', '你自认的本事：' + me.ability));
  if (me.secrets) p.appendChild(el('div', 'hint', '你藏在心里的事：' + me.secrets));
  p.appendChild(el('h4', 'hint', '你的状态'));
  const st = me.state || {};
  p.appendChild(el('div', 'item', '疲劳:' + (st.fatigue || '低') + ' 饥饿:' + (st.hunger || '低') + ' 睡眠:' + (st.sleep || '正常')));
  if (me.money) p.appendChild(el('div', 'item', '钱:' + (me.money.cash || 0) + (me.money.digital ? '(+电子 ' + me.money.digital + ')' : '') + (me.money.currency || '')));
  p.appendChild(el('div', 'item', '随身：' + ((me.inventory || []).join('、') || '（空）')));
  if (me.bonds && me.bonds.length) {
    p.appendChild(el('h4', 'hint', '你对人的关系'));
    for (const b of me.bonds) p.appendChild(el('div', 'item', '· ' + b.name + '：' + b.tone));
  }
  if (me.memories && me.memories.length) {
    p.appendChild(el('h4', 'hint', '你会记得的事（最近）'));
    for (const mm of me.memories.slice(0, 4)) p.appendChild(el('div', 'hint', '· ' + mm.content + '（' + (mm.t || '').slice(5, 10) + '）'));
  }
  if (me.claims && me.claims.length) {
    p.appendChild(el('h4', 'hint', '你答应过的事'));
    for (const c of me.claims) p.appendChild(el('div', 'item', '▸ ' + c.date + ' ' + (c.when ? c.when + ' ' : '') + c.title));
  }
  if (V.plans && V.plans.length) {
    p.appendChild(el('h4', 'hint', '你的出行计划'));
    for (const pl of V.plans) p.appendChild(el('div', 'item', '▸ 去' + pl.dest + '：' + ({ planned: '计划中', aboard: '在路上', done: '已到达', blocked: '被拦下' }[pl.status] || pl.status) + (pl.ticket ? '（已买票）' : '（未买票）') + (pl.reason ? ' · ' + pl.reason : '')));
  }
  p.appendChild(el('div', 'sysnote', '这是你对自己的认知——世界另有真相，你不需要全知道。'));
}

function panelMap(p) {
  const cur = V.place.id;
  for (const n of (V.map || [])) {
    const d = el('div', 'node');
    d.appendChild(el('b', n.id === cur ? 'here' : '', n.name + (n.id === cur ? ' ◀ 你在这' : (n.visited ? '' : ' · 听说过的'))));
    const es = (n.edges || []).map(e => nameOfPlace(e.to, V.map) + '(' + e.level + '·' + e.minutes + '分)').join(' ｜ ');
    d.appendChild(el('div', 'hint', '连通: ' + es + (n.open ? ' · 开放:' + n.open : '')));
    if (n.id !== cur) { const go = el('button', 'mini', '前往'); go.onclick = () => submit('去' + n.name); d.appendChild(go); }
    p.appendChild(d);
  }
  p.appendChild(el('div', 'sysnote', '认知地图：没去过的地方不显示细节；传闻只留灰点。'));
}
let __gallery = [];
let __portraitBusy = {};
let __lookBusy = {};   // 「TA 长什么样」按需生成：每人只请求一次（写进印象层后长期复用，0 成本）
async function loadGallery() { try { const r = await api('/api/gallery/list'); __gallery = r.list || []; } catch (e) { } }
function galleryImgFor(id) {
  const g = __gallery.filter(x => (x.who || '').split(',').indexOf(id) >= 0).sort((a, b) => String(b.t).localeCompare(String(a.t || '')));
  return g[0] || null;
}
// 三态立绘按钮（插件式：生成/重新生成/重试；生成中禁用）
function portraitBtn(pe, g0) {
  const latest = ((V && V.imgTasks) || []).filter(t => (t.who || []).indexOf(pe.id) >= 0).slice(-1)[0];
  const busy = __portraitBusy[pe.id];
  const b = el('button', 'mini', busy ? '生成中…' : (latest && latest.status === 'fail' ? '🔁 重试' : (g0 ? '↻ 重新生成' : '🎨 生成')));
  if (busy) { b.disabled = true; return b; }
  b.onclick = async () => {
    b.textContent = '生成中…(最多1分钟)'; b.disabled = true;
    __portraitBusy[pe.id] = true;
    try {
      let r;
      if (latest && latest.status === 'fail') r = await api('/api/comfy/render', { id: latest.id });
      else r = await api('/api/comfy/person', { id: pe.id });
      if (r.ok) { toast('🖼 「' + (pe.name || pe.id) + '」立绘' + (latest && latest.status === 'fail' ? '重试成功' : '完成'), false); afterRenderDone(); }
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
    const row = el('div', 'p-cell');
    const disName = (pe.known && pe.name && /^npc_/.test(String(pe.name)) === false) ? pe.name : '（你还不认识…）';
    // 立绘卡（插件「档案-人物档案（生成立绘）」适配）
    const g0 = galleryImgFor(pe.id);
    if (g0) {
      const im = document.createElement('img');
      im.src = '/api/gallery/img?id=' + g0.id;
      im.style.cssText = 'width:84px;height:84px;object-fit:cover;border-radius:8px;border:1px solid var(--line2);flex-shrink:0;cursor:pointer;';
      im.title = '立绘';
      im.onclick = () => { const m = $('#modal'); m.classList.remove('hidden'); m.innerHTML = ''; const bx = el('div', 'box'); bx.appendChild(el('img', null, '')); bx.querySelector('img').src = im.src; bx.querySelector('img').style.cssText = 'max-width:100%;border-radius:10px;'; bx.appendChild(el('button', null, '关闭')); bx.querySelector('button').onclick = () => m.classList.add('hidden'); m.appendChild(bx); };
      row.appendChild(im);
    } else {
      const ph = el('div', 'p-empty', '🖼');
      ph.style.cssText = 'width:84px;height:84px;display:flex;align-items:center;justify-content:center;border:1px dashed var(--line2);border-radius:8px;flex-shrink:0;font-size:22px;';
      row.appendChild(ph);
    }
    const info = el('div', null, '');
    info.style.cssText = 'flex:1;min-width:0;';
    info.appendChild(el('b', null, disName + ' · ' + (pe.stageLabel || '只见过')));
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
            try { renderPanel(); } catch (e) { }
          } else { __lookBusy[pe.id] = false; }
        }).catch(() => { __lookBusy[pe.id] = false; });
      }
    }
    if (pe.traits && pe.traits.length) info.appendChild(el('div', '', '你的印象：' + pe.traits.slice(0, 3).join('；')));
    if (pe.bonds && pe.bonds.length) info.appendChild(el('div', 'hint', '你与TA：' + pe.bonds.slice(0, 3).join(' / ')));
    if (g0) info.appendChild(el('div', 'hint', '🖼 立绘'));
    row.appendChild(info);
    // 生成立绘按钮（生成/重新生成/重试 三态）
    const genB = portraitBtn(pe, g0);
    genB.style.alignSelf = 'center';
    genB.onclick = async () => {
      if (__portraitBusy[pe.id]) return;
      genB.textContent = '生成中…(30s)';
      __portraitBusy[pe.id] = true;
      try {
        const r = await api('/api/comfy/person', { id: pe.id });
        if (r.ok) { toast('🖼 「' + disName + '」立绘完成', false); afterRenderDone(); }
        else toast('生成失败：' + (r.err || '?'), true);
      } catch (e) { toast('生成失败：' + e.message, true); }
      finally { __portraitBusy[pe.id] = false; genB.textContent = '🎨 立绘'; }
    };
    row.appendChild(genB);
    d.appendChild(row);
    p.appendChild(d);
  }
  if (!(V.people || []).length) p.appendChild(el('div', 'hint', '（你还没认识人——去打个招呼吧）'));
  p.appendChild(el('div', 'sysnote', '这里是【你对人物的印象】，不是 TA 的全部；立绘由生图引擎按外貌库生成。'));
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
    cell.appendChild(el('div', 'hint', '🖼 ' + (cap || '画面')));
    cell.appendChild(el('div', 'hint', String(g.t || '').slice(5, 16) + ((g.who || '').split(',').filter(Boolean).map(n => nameOf(n)).slice(0, 2).join('、') ? ' · ' + (g.who || '').split(',').filter(Boolean).map(n => nameOf(n)).slice(0, 2).join('、') : '')));
    imgf.appendChild(cell);
  }
  p.appendChild(imgf);
  p.appendChild(el('div', 'sysnote', '图为引擎按人物九维档案+导演笔记生成（同提示词自动复用缓存，不重画）。'));
}
function panelNews(p) {
  const list = (V.news || []);
  if (!list.length) p.appendChild(el('div', 'hint', '暂无你听闻的新闻。'));
  for (const n of list) { const d = el('div', 'card'); d.appendChild(el('b', null, '[' + n.severity + '] ' + n.title)); d.appendChild(el('div', null, n.summary)); d.appendChild(el('div', 'hint', (n.t || '').slice(5, 16))); p.appendChild(d); }
  p.appendChild(el('div', 'sysnote', '你只看到你接触得到的新闻（知识门控）。'));
}
function panelGoods(p) {
  if (V.money) p.appendChild(el('div', 'item', '钱:' + (V.money.cash || 0) + (V.money.digital ? '(+电子 ' + V.money.digital + ')' : '') + (V.money.currency || '') + ' · 已花' + (V.money.spent || 0) + ' 挣' + (V.money.earned || 0)));
  p.appendChild(el('h4', 'hint', '你的物品（带价的可以卖）'));
  for (const i of (V.inventory || [])) {
    const d = el('div', 'item', '· ' + i.name + (i.value != null ? '（可卖 ' + i.value + '）' : ''));
    if (i.value != null && !/手机|表|钱包|行囊/.test(i.name)) { const s = el('button', 'mini', '卖'); s.onclick = () => submit('卖' + i.name); d.appendChild(s); }
    p.appendChild(d);
  }
  p.appendChild(el('h4', 'hint', '此处可见 (' + V.place.name + ')'));
  for (const it of (V.shop || [])) { const d = el('div', 'item', it.name + ' ' + (it.price || 0) + (it.desc ? ' ' + it.desc : '')); const b = el('button', 'mini', '买'); b.onclick = () => submit('买' + it.name); d.appendChild(b); p.appendChild(d); }
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
    p.appendChild(el('div', 'sysnote', '世界书 = 酒馆 World Info：命中关键词时注入主 AI。'));
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
  const rows = [['时代', o.era], ['你所在', o['地区']], ['势力/组织', (o['势力组织'] || []).join('、')], ['要闻人物', (o['要闻人物'] || []).join('、')], ['时令', o['时令']]];
  for (const row of rows) p.appendChild(el('div', 'item', row[0] + '：' + row[1]));
  p.appendChild(el('h4', 'hint', '近况（你听闻的）'));
  for (const n of (o['近况'] || [])) p.appendChild(el('div', 'hint', '· ' + n.title));
  p.appendChild(el('div', 'sysnote', '世界概况 = 你知道的世界。'));
  // 世界卡（来源卡信息 + 导出）
  const card = el('div', 'p-card');
  card.appendChild(el('div', 'p-card-h', '世界卡 · 来源信息'));
  card.appendChild(el('div', 'p-cell', null)); 
  const mk = (k, v) => { const c = el('div', 'p-cell'); c.appendChild(el('span', 'p-chip', k)); c.appendChild(el('span', null, String(v == null || v === '' ? '—' : v))); card.appendChild(c); };
  mk('来源卡', V.meta && V.meta.importSource);
  mk('世界书条目', ((V.archives2 || {}).n || (V.worldinfoN || 0)));
  mk('规则', ((V.meta && V.meta.rules) || []).slice(0, 2).join('；'));
  const exp = el('button', 'mini', '导出世界档案 JSON');
  exp.onclick = async () => {
    try {
      const r = await api('/api/export/world', {});
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
function panelArchive(p) {
  p.appendChild(el('div', 'hint', '剧本存档 = 逐字原文（给人看）。AI 只看数据库事实。'));
  const keys = Object.keys(V.archives || {});
  if (!keys.length) p.appendChild(el('div', 'hint', '（剧情尚未落档）'));
  for (const k of keys.slice(-6)) { p.appendChild(el('h4', null, k)); for (const line of V.archives[k]) p.appendChild(el('div', 'hint', line.text || line)); }
}

// ---------- 生成 ----------
function showWorldCard(pv, setup) {
  try {
    if (pv && pv.__err) {
      const m2 = $('#modal'); m2.classList.remove('hidden'); m2.innerHTML = '';
      const bx = el('div', 'box'); bx.appendChild(el('div', 'item', '✘ 生成失败：' + pv.__err));
      const cb = el('button', 'mini', '关闭'); cb.onclick = () => m2.classList.add('hidden'); bx.appendChild(cb);
      m2.appendChild(bx); return;
    }
    const m = $('#modal');
    m.classList.remove('hidden');
    const box = el('div', 'box');
    box.appendChild(el('h2', null, '✨ AI 生成的新世界'));
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
    box.appendChild(el('div', 'sysnote', pv.mode === 'llm' ? '⬤ 由你的 AI 模型生成（消耗 token）' : '⚪ 演示组合（未接入模型）'));
    if (setup && setup.issues && setup.issues.length) {
      const st = setup.status || 'pass';
      const head = st === 'conflict' ? '✘ 你的设定以世界为准 —— 冲突（下方说明处理方式）' : (st === 'bridge' ? '▲ 你的设定补了一座桥（已写入世界规则）' : '✔ 你的设定与世界相容');
      box.appendChild(el('div', 'item', '【设定核对】' + head));
      for (const is of setup.issues) {
        const mark = is.verdict === '冲突' ? '✘ ' : (is.verdict === '需补桥' ? '▲ ' : '✔ ');
        box.appendChild(el('div', 'hint', mark + is.point + '：' + (is.advice || '')));
      }
      box.appendChild(el('div', 'hint', '（"进入"后：相容设定进入你的档案；冲突项以世界规则为准，不迁就你。）'));
    }
    const enter = el('button', null, '进入这个新世界');
    enter.onclick = async () => {
      m.classList.add('hidden');
      enterTransition('◉ 世界正在落成…', '「' + (pv.name || '新世界') + '」场景·人物·开局 组装中——马上进入');
      try { const a = await api('/api/world/gen', { apply: true, greeting: selOpening }); refresh(a.view); }
      catch (e) { toast('进入失败：' + e.message, true); }
      hideTransition();
    };
    const again = el('button', null, '再来一个');
    again.onclick = () => { m.classList.add('hidden'); genWorld(); };
    const cancel = el('button', null, '先不换');
    cancel.onclick = () => m.classList.add('hidden');
    box.appendChild(enter); box.appendChild(again); box.appendChild(cancel);
    m.innerHTML = ''; m.appendChild(box);
  } catch (e) {
    const m2 = $('#modal'); if (m2) { m2.innerHTML = ''; m2.appendChild(el('div', 'box', '✘ 预览渲染失败：' + String(e.message || e))); }
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
  box.appendChild(el('div', 'hint', usN ? '✅ 已自动调取「我的身份档案」——可修改（只作用于本次生成；要保存到档案请去主菜单 → 设定）' : '—— 可选：我的设定（不填 = 世界里的一个外来者；填了会按 20.2 以世界为准裁决；主菜单 → 设定 可保存为档案，之后自动调取） ——'));
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
  const goBtn = el('button', null, '🚀 生成新世界');
  const cancelBtn = el('button', null, '关闭');
  goBtn.onclick = async () => {
    const userSelf = {};
    for (const [k] of fields) { const v = (S[k].value || '').trim(); if (v) userSelf[k] = v; }
    m.classList.add('hidden');
    if (busy) return;
    busy = true;
    showWorking('◉ 已收到点击 · 正在生成新世界……', (pIn.value ? '解读你的一句话 + ' : '') + '连接模型生成（请勿反复点击）');
    let done = false;
    const timer = setTimeout(() => { if (!done) updateWorking('⚠ 已等待 60 秒，模型仍未返回……', '可能模型慢/端点超时/输出过大。'); }, 60000);
    try {
      const r = await api('/api/world/gen', { prompt: pIn.value.trim(), userSelf, preview: true });
      done = true; clearTimeout(timer);
      setBusy(false); hideWorking();
      showWorldCard(r.preview || {}, r.setup || null);
    } catch (e) {
      done = true; clearTimeout(timer);
      setBusy(false); hideWorking();
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
      if (!list.length) { listWrap.appendChild(el('div', 'hint', '（暂无存档——创作/导入/演示后自动存档）')); return; }
      for (const w of list) {
        const row = el('div', 'card');
        const head = el('div', 'item', '🗂 ' + (w.name || '未名之地') + '（' + (w.era || '') + '）');
        row.appendChild(head);
        if (w.saved) row.appendChild(el('div', 'hint', '存档于 ' + String(w.saved).slice(0, 16).replace('T', ' ')));
        const loadB = el('button', 'mini', '▶ 进入');
        loadB.onclick = async () => {
          loadB.textContent = '…';
          try { const s = await api('/api/world/load', { id: w.id }); m.classList.add('hidden'); refresh(s.view); toast('已载入「' + w.name + '」', false); }
          catch (e) { toast('载入失败：' + e.message, true); loadB.textContent = '▶ 进入'; }
        };
        const delB = el('button', 'mini', '删除');
        delB.onclick = async () => {
          if (!confirm('删除存档「' + w.name + '」？不可恢复。')) { draw(); return; }
          try { await api('/api/world/del', { id: w.id }); toast('已删除', false); } catch (e) { toast('删除失败：' + e.message, true); }
          draw();
        };
        row.appendChild(loadB); row.appendChild(delB);
        listWrap.appendChild(row);
      }
    } catch (e) { listWrap.appendChild(el('div', 'hint', '读档失败：' + e.message)); }
  }
  draw();
}

// ---------- 角色卡盒：扫描过的卡直接开局（不是存档） ----------
async function openCardbox() {
  const m = $('#modal');
  m.classList.remove('hidden');
  const box = el('div', 'box');
  box.appendChild(el('h2', null, '🃏 角色卡盒 · 从卡开局'));
  box.appendChild(el('div', 'hint', '这里是你扫描过的角色卡档案（不是存档）：每次开局都是全新的世界实例，都不会碰你别的局。'));
  const listWrap = el('div');
  box.appendChild(listWrap);
  const closeB = el('button', null, '关闭');
  closeB.onclick = () => m.classList.add('hidden');
  box.appendChild(closeB);
  m.innerHTML = ''; m.appendChild(box);
  async function draw() {
    listWrap.innerHTML = '';
    try {
      const r = await api('/api/cards');
      const list = (r.list || []).filter(c => c.id);
      if (!list.length) { listWrap.appendChild(el('div', 'hint', '（卡盒是空的——去「导入世界」扫描一张角色卡，会自动建档。）')); return; }
      for (const c of list) {
        const row = el('div', 'card');
        row.appendChild(el('div', 'item', '🃏 ' + (c.name || '未命名') + ' · 世界「' + (c.worldName || '') + '」'));
        const npcNames = (c.npcs || []).slice(0, 6).join('、');
        row.appendChild(el('div', 'hint', (c.era || '时代未知') + ' · NPC ' + (c.npcs || []).length + '（' + npcNames + '） · 地点 ' + (c.placeN || 0) + ' · 开场 ' + (c.openings || 1) + ' 条' + (c.mode === 'llm' ? ' · AI 重写' : '') + ' · ' + String(c.scanned || '').slice(0, 10)));
        const goB = el('button', 'mini', '▶ 开局');
        goB.onclick = () => pickOpening(c);
        const delB = el('button', 'mini', '删除');
        delB.onclick = async () => {
          if (!confirm('删除卡档「' + c.name + '」？不影响已生成的世界。')) return;
          try { await api('/api/cards/del', { id: c.id }); toast('已删除卡档', false); draw(); }
          catch (e) { toast('删除失败：' + e.message, true); }
        };
        row.appendChild(goB); row.appendChild(delB);
        listWrap.appendChild(row);
      }
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
  box.appendChild(el('h2', null, '👤 设定 · 我的身份档案'));
  box.appendChild(el('div', 'hint', '这是「你」在世界里的底子。之后凡是涉及你的生成管线（一句话生成世界、扫描角色卡当作 NPC 世界）都会自动调取这里；世界冲突以世界规则为准（20.2）。游戏进行中不会反复触发。'));
  const fields = [['name', '姓名'], ['age', '年龄'], ['identity', '身份'], ['role', '职业'], ['ability', '能力/本事'], ['appearance', '外貌特征'], ['backstory', '来历/背景'], ['attitude', '性格/待人'], ['secret', '我在藏的事'], ['desire', '现在想做什么']];
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
  const saveB = el('button', null, '💾 保存档案');
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
      const pv = await api('/api/new', { src, payload, role: roleSel.value, era: eraIn.value || undefined, noSelf, preview: true });
      if (!pv.preview) throw new Error('预览失败');
      // 多开局：由 user 点选，而不是随机/confirm
      runBtn.textContent = '扫描并进入世界';
      m.innerHTML = '';
      const b2 = el('div', 'box');
      b2.appendChild(el('h2', null, '✦ 已识别：' + (pv.preview.name || '未命名角色卡')));
      b2.appendChild(el('div', 'hint', '时代：' + (pv.preview.era || '未知') + (pv.preview.mode === 'llm' ? ' · 由 AI 语义重写为本世界格式' : ' · 本地整理')));
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
      go2.onclick = async () => {
        m.classList.add('hidden');
        enterTransition('◉ 世界正在落成…', '「' + (pv.preview.name || '这张卡') + '」场景·人物·开局 组装中——马上进入');
        try {
          const r = await api('/api/new', { src, payload, role: roleSel.value, era: eraIn.value || undefined, greeting: selOpening, noSelf: !selfCb.checked });
          try { refresh(r.view); } catch (e2) { toast('渲染出错：' + String(e2.message || e2), true); }
          toast('已导入「' + (r.card || '') + '」' + (r.archived ? '（已建档，下次可直接开局）' : ''), r.mode === 'heuristic');
        } catch (e) { toast('导入失败: ' + e.message, true); }
        hideTransition();
      };
      back2.onclick = () => { m.classList.add('hidden'); openImport(); };
      b2.appendChild(go2); b2.appendChild(back2);
      m.appendChild(b2);
    } catch (e) { toast('导入失败: ' + e.message, true); runBtn.textContent = '扫描并进入世界'; }
  };
  closeBtn.onclick = () => m.classList.add('hidden');
  box.appendChild(runBtn); box.appendChild(closeBtn);
  m.innerHTML = ''; m.appendChild(box);
}

// ---------- 设置 ----------
// ---------- 🎨 画面引擎（独立页）----------
// 生图不是设置里的一个折叠块 —— 它有自己的页面：接入 / 美术 / 九维外貌库。
// 这是"把两个月的心血放回它该在的位置"：九维档案在这里第一次有了正当的接触面
// （在此之前它只是生图管线里的一段隐形数据，谁都看不见）。
async function openImageEngine() {
  const m = $('#modal');
  m.classList.remove('hidden');
  const box = el('div', 'box');
  const cf = (SRVCFG && SRVCFG.image) || {};

  const head = el('div', 'eng-head');
  const back0 = el('button', 'mini', '← 返回设置');
  back0.onclick = () => openSettings();
  head.appendChild(back0);
  head.appendChild(el('b', 'eng-title', '🎨 画面引擎'));
  box.appendChild(head);

  // ── 接入 ──
  box.appendChild(el('div', 'grp-t', '接入'));
  const onRow = el('div', 'row');
  const imgOn = el('input'); imgOn.type = 'checkbox';
  onRow.appendChild(imgOn); onRow.appendChild(el('span', null, '启用生图（本地 ComfyUI；不启用时零影响，世界照常玩）'));
  box.appendChild(onRow);

  box.appendChild(el('div', 'row', 'ComfyUI 地址:'));
  const imgBase = el('input'); imgBase.placeholder = 'http://127.0.0.1:8181';
  box.appendChild(imgBase);

  const wfRow = el('div', 'row');
  const wfFile = el('input'); wfFile.type = 'file'; wfFile.accept = '.json'; wfFile.style.display = 'none';
  const wfBtn = el('button', 'mini', '📄 导入工作流 JSON');
  const wfs = el('span', 'hint', '');
  wfBtn.onclick = () => wfFile.click();
  wfFile.onchange = async () => {
    if (!wfFile.files || !wfFile.files[0]) return;
    const f = wfFile.files[0];
    try {
      const txt = await f.text();
      const r = await api('/api/image/workflow', { name: f.name, jsonText: txt });
      if (!r.ok) { toast('导入失败：' + (r.err || '?'), true); return; }
      window.__wfJson = txt;
      wfs.textContent = '✔ ' + f.name;
      toast('工作流已导入（立即生效）', false);
      const st2 = await api('/api/state'); if (st2.config) SRVCFG = st2.config;
    } catch (e) { toast('导入失败：' + e.message, true); }
  };
  wfRow.appendChild(wfBtn); wfRow.appendChild(wfs);
  box.appendChild(wfRow);

  const connBtn = el('button', 'mini', '🔌 测试 ComfyUI 连接');
  const connRes = el('div', 'hint', '');
  connBtn.onclick = async () => {
    connRes.textContent = '测试中…'; connRes.className = 'hint';
    try {
      const r = await api('/api/comfy/test', { base: imgBase.value.trim() || undefined });
      connRes.textContent = r.ok ? ('✔ 连接成功' + (r.comfy ? '（ComfyUI ' + r.comfy + '）' : '') + (r.models && r.models.length ? ' · ' + r.models.join('/') : '')) : ('✘ ' + (r.err || '连接失败'));
      connRes.className = r.ok ? 'ok' : 'bad';
    } catch (e) { connRes.textContent = '✘ ' + String(e.message || e); connRes.className = 'bad'; }
  };
  box.appendChild(connBtn); box.appendChild(connRes);

  // ── 美术 ──
  box.appendChild(el('div', 'grp-t', '美术'));
  const aiPRow = el('div', 'row');
  const aiPCb = el('input'); aiPCb.type = 'checkbox';
  aiPRow.appendChild(aiPCb); aiPRow.appendChild(el('span', null, 'AI 润色（默认关：规则装配直出，零模型）'));
  box.appendChild(aiPRow);

  box.appendChild(el('div', 'row', '美术模式:'));
  const imgMode = el('select');
  for (const o of [['zit', 'zit 中文自然语言'], ['anime', 'anime 英文描述'], ['anime_tag', 'anime_tag 英文标签'], ['nsfw', 'nsfw 直给（世界规则声明时）']]) { const op = el('option', null, o[1]); op.value = o[0]; imgMode.appendChild(op); }
  box.appendChild(imgMode);

  box.appendChild(el('div', 'row', '画风预设（ZIT 模式生效）:'));
  const imgStyle = el('select');
  for (const o of [['', '（无）'], ['柯达金200胶片质感，暖黄色调，细腻胶片颗粒，复古写实质感', '🎞 柯达金胶片'], ['水墨写意画，宣纸质感，墨色浓淡晕染，大面积留白，东方写意意境', '🖌 水墨写意'], ['水彩画风格，半透明叠色水痕，水彩纸纹理，自然晕染过渡', '🎨 水彩'], ['日系柔和色调，低对比，胶片颗粒细，空气感通透', '🌸 日系柔和'], ['冷调赛博风，霓虹蓝紫，金属反光，颗粒感', '🌃 冷调赛博'], ['深色电影质感，暗部饱满，侧逆光，戏剧性氛围', '🎬 深色电影']]) { const op = el('option', null, o[1]); op.value = o[0]; imgStyle.appendChild(op); }
  box.appendChild(imgStyle);

  box.appendChild(el('div', 'row', '负面提示词:')); const imgNeg = el('input'); imgNeg.placeholder = 'lowres, bad anatomy, blur…（注入工作流负面节点）'; box.appendChild(imgNeg);
  box.appendChild(el('div', 'row', '前置提示词（所有模式）:')); const imgPfx = el('input'); imgPfx.placeholder = '如固定构图/镜头偏好，逗号分隔'; box.appendChild(imgPfx);
  box.appendChild(el('div', 'row', 'Anime 质量前缀:')); const imgQ = el('input'); imgQ.placeholder = 'masterpiece, best quality'; box.appendChild(imgQ);
  box.appendChild(el('div', 'row', 'Anime 艺术家标签:')); const imgArtist = el('input'); imgArtist.placeholder = '@artist_name'; box.appendChild(imgArtist);
  const nsfwRow = el('div', 'row');
  const nsfwCb = el('input'); nsfwCb.type = 'checkbox';
  nsfwRow.appendChild(nsfwCb); nsfwRow.appendChild(el('span', null, 'NSFW 增强（配图义务：成人场景如实配图、色气点进提示词）'));
  box.appendChild(nsfwRow);

  // ── 九维外貌库（引擎工作台）──
  box.appendChild(el('div', 'grp-t', '九维外貌库'));
  const libBox = el('div', 'vlib');
  libBox.appendChild(el('div', 'hint', '读取中…'));
  box.appendChild(libBox);
  api('/api/visual/lib').then(r => {
    libBox.innerHTML = '';
    if (!r || !r.ok) { libBox.appendChild(el('div', 'bad', (r && r.err) || '读取失败（先进入一个世界）')); return; }
    const list = r.list || [];
    const full = list.filter(x => x.filled === r.dims.length).length;
    libBox.appendChild(el('div', 'hint', '这个世界共 ' + list.length + ' 人 · ' + full + ' 人档案齐全 · ' + (list.length - full) + ' 人缺维度（缺维度的人在生图时会漂）'));
    for (const p of list) {
      const row = el('div', 'vlib-row');
      const t = el('div', 'vlib-t');
      t.appendChild(el('b', null, p.name));
      t.appendChild(el('span', 'hint', '  ' + p.filled + '/' + r.dims.length + (p.hasPortrait ? '   🖼 有立绘' : '')));
      row.appendChild(t);
      if (p.missing && p.missing.length) row.appendChild(el('div', 'hint', '⚠ 缺：' + p.missing.join('、')));
      const det = el('div', 'vlib-det hidden');
      for (const k of r.dims) { const v = (p.nine || {})[k]; if (v) det.appendChild(el('div', 'vlib-dim', k + '：' + String(v))); }
      if (!det.childElementCount) det.appendChild(el('div', 'hint', '（还没有九维档案——这个人生图时会只画场景）'));
      row.appendChild(det);
      const tg = el('button', 'mini', '展开档案');
      tg.onclick = () => { const hid = det.classList.toggle('hidden'); tg.textContent = hid ? '展开档案' : '收起'; };
      row.appendChild(tg);
      libBox.appendChild(row);
    }
  }).catch(e => { libBox.innerHTML = ''; libBox.appendChild(el('div', 'bad', '读取失败：' + e.message)); });

  // ── 底部 ──
  const saveBtn = el('button', null, '保存');
  saveBtn.onclick = async () => {
    await api('/api/settings', { image: {
      enabled: imgOn.checked, base: imgBase.value.trim(),
      workflow: ((SRVCFG && SRVCFG.image && SRVCFG.image.workflow) || ''),
      workflowJson: window.__wfJson || (SRVCFG && SRVCFG.image && SRVCFG.image.workflowJson) || '',
      mode: imgMode.value, aiPrompt: aiPCb.checked, neg: imgNeg.value.trim(), style: imgStyle.value,
      qPrefix: imgQ.value.trim(), artist: imgArtist.value.trim(), pPrefix: imgPfx.value.trim(), nsfw: nsfwCb.checked
    } });
    toast('画面引擎设置已保存 ✓', false);
    try { const st2 = await api('/api/state'); if (st2.config) SRVCFG = st2.config; } catch (e) { }
    openImageEngine();
  };
  const backBtn = el('button', null, '返回设置');
  backBtn.onclick = () => openSettings();
  const closeBtn = el('button', null, '关闭');
  closeBtn.onclick = () => m.classList.add('hidden');
  box.appendChild(saveBtn); box.appendChild(backBtn); box.appendChild(closeBtn);

  m.innerHTML = '';
  m.appendChild(box);

  // 回填当前配置
  try {
    const st = await api('/api/state');
    const c = (st && st.config && st.config.image) || {};
    imgOn.checked = !!c.enabled; imgBase.value = c.base || '';
    if (c.mode) imgMode.value = c.mode;
    if (typeof c.aiPrompt === 'boolean') aiPCb.checked = c.aiPrompt;
    if (c.neg) imgNeg.value = c.neg;
    if (c.style) imgStyle.value = c.style;
    if (c.qPrefix) imgQ.value = c.qPrefix;
    if (c.artist) imgArtist.value = c.artist;
    if (c.pPrefix) imgPfx.value = c.pPrefix;
    if (typeof c.nsfw === 'boolean') nsfwCb.checked = c.nsfw;
    wfs.textContent = c.workflow ? ('✔ ' + c.workflow) : '（未导入工作流）';
  } catch (e) { }
}

function openSettings() {
  const m = $('#modal');
  m.classList.remove('hidden');
  const box = el('div', 'box');
  box.appendChild(el('h2', null, '⚙ 设置'));
  box.appendChild(el('div', 'grp-t', '模型'));
  box.appendChild(el('div', 'row', '你的名字:')); const nm = el('input'); nm.placeholder = '例：阿游'; box.appendChild(nm);
  box.appendChild(el('div', 'row', '主题:'));
  const themeSel = el('select');
  for (const o of [['mint', '终端薄荷（默认）'], ['amber', '琥珀'], ['ice', '冰蓝'], ['bright', '明亮（SnowCat 风）']]) { const op = el('option', null, o[1]); op.value = o[0]; themeSel.appendChild(op); }
  themeSel.value = localStorage.getItem('wx_theme') || 'mint';
  themeSel.onchange = () => { localStorage.setItem('wx_theme', themeSel.value); applyThemeSel(themeSel.value); toast('主题已切换', false); };
  box.appendChild(themeSel);
  if (!window.__themeBound) { window.__themeBound = true; applyThemeSel(themeSel.value); }
  box.appendChild(el('div', 'row', 'baseURL:')); const bURL = el('input'); bURL.placeholder = 'https://api.deepseek.com/v1'; box.appendChild(bURL);
  box.appendChild(el('div', 'row', 'apiKey:')); const key = el('input'); key.type = 'password'; box.appendChild(key);
  box.appendChild(el('div', 'row', 'model:')); const model = el('input'); model.placeholder = 'deepseek-chat'; box.appendChild(model);
  box.appendChild(el('div', 'row', '输出上限（token）:')); const mtIn = el('input'); mtIn.placeholder = '32768（世界生成）'; box.appendChild(mtIn);
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
  engBtn.appendChild(el('b', null, '🎨 画面引擎'));
  engBtn.appendChild(el('span', 'hint', '接入 ComfyUI · 美术规则 · 九维外貌库'));
  engBtn.onclick = () => openImageEngine();
  box.appendChild(engBtn);
  try { const mark = () => imgGrp.classList.toggle('off', !imgOn.checked); imgOn.addEventListener('change', mark); mark(); } catch (e) { }
  const testBtn = el('button', null, '测试连接');
  testBtn.onclick = async () => {
    res.innerHTML = ''; res.appendChild(el('div', 'hint', '测试中…'));
    const r = await api('/api/settings/test', { baseURL: bURL.value, apiKey: key.value, model: model.value });
    res.innerHTML = '';
    if (r.ok) { res.appendChild(el('div', 'ok', '✔ 连接成功')); if (!model.value && r.models && r.models.length) { model.value = r.models[0]; } }
    else res.appendChild(el('div', 'bad', '✘ ' + r.err));
  };
  const saveBtn = el('button', null, '保存');
  saveBtn.onclick = async () => {
    await api('/api/settings', { baseURL: bURL.value, apiKey: key.value, model: model.value, playerName: nm.value, maxTokens: parseInt(mtIn.value, 10) || 32768, roles: { msg: { model: (msgM.value || '').trim() } } });
    toast('已保存 ✓', false);
    m.classList.add('hidden');
    try { const st2 = await api('/api/state'); if (st2.config) SRVCFG = st2.config; } catch (e) { }
    if (V) refresh(V); else renderStart();
  };
  const menuBtn = el('button', null, '返回主菜单');
  menuBtn.onclick = async () => { await api('/api/menu', {}); m.classList.add('hidden'); renderStart(); };
  const resetBtn = el('button', null, '删除当前世界');
  resetBtn.onclick = async () => {
    if (!confirm('删除当前世界存档？不可恢复。')) return;
    await api('/api/reset', {}); m.classList.add('hidden'); renderStart();
  };
  const quitBtn = el('button', null, '退出游戏');
  quitBtn.onclick = async () => {
    toast('正在退出…', false);
    try { await api('/api/quit', {}); } catch (e) { toast('退出请求失败：' + String(e.message || e), true); }
    try { window.close(); } catch (e) { }
  };
  const closeBtn = el('button', null, '关闭');
  closeBtn.onclick = () => m.classList.add('hidden');
  box.appendChild(saveBtn); box.appendChild(testBtn); box.appendChild(menuBtn); box.appendChild(resetBtn); box.appendChild(quitBtn); box.appendChild(closeBtn);
  m.innerHTML = ''; m.appendChild(box);
  api('/api/state').then(st => {
    if (st && st.config) { bURL.value = st.config.baseURL || ''; key.value = st.config.apiKey || ''; model.value = st.config.model || ''; mtIn.value = st.config.maxTokens || 32768; msgM.value = st.config.msgModel || ''; nm.value = st.config.playerName || '你'; if (st.config.image) { const ig = st.config.image; imgOn.checked = !!ig.enabled; imgBase.value = ig.base || ''; window.__wfJson = ig.workflowJson || ''; imgMode.value = ig.mode || 'zit'; aiPCb.checked = !!ig.aiPrompt || false; imgNeg.value = ig.neg || ''; imgStyle.value = ig.style || ''; imgQ.value = ig.qPrefix || ''; imgArtist.value = ig.artist || ''; imgPfx.value = ig.pPrefix || ''; nsfwCb.checked = !!ig.nsfw; const wfEl2 = box.querySelector('.wf-status'); if (wfEl2) wfEl2.textContent = (window.__wfJson ? ('✔ 已载入工作流（' + window.__wfJson.length + ' 字）——保存后生效') : '未载入工作流：点上方「导入工作流 JSON」选择 ComfyUI 导出文件（API 或普通导出均可）'); } }
  }).catch(() => { });
}

// ---------- 自检 ----------
async function selfcheck() {
  showWorking('🔧 正在自检……', '完成后弹出报告');
  const r = [];
  let pvData = null;
  r.push('JS 探针：' + (new Date().toLocaleTimeString()) + '（点击生效）');
  try { const v = await api('/api/version'); r.push('版本接口：' + v.build); } catch (e) { r.push('版本接口失败：' + String(e.message || e)); }
  try { const s = await api('/api/state'); r.push('世界状态：' + (s.noWorld ? '菜单(无世界)' : (s.place && s.place.name))); } catch (e) { r.push('状态接口失败：' + String(e.message || e)); }
  try {
    const g = await api('/api/world/gen', { preview: true });
    r.push('生成接口：OK，预览「' + (g.preview && g.preview.name) + '」');
    pvData = g.preview || null;
  } catch (e) { r.push('生成接口失败：' + String(e.message || e)); }
  const m = $('#modal'); m.classList.remove('hidden');
  const box = el('div', 'box');
  box.appendChild(el('h2', null, '🔧 自检报告'));
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
    if (ver && ver.build && ver.build !== BUILD) toast('⚠ 前后端版本不一致（前端 ' + BUILD + ' / 服务端 ' + ver.build + '），请完全关闭窗口重开！', true);
  } catch (e) { toast('⚠ 无法确认版本（旧服务端？）——请完全关闭窗口重开！', true); }
  try {
    const st = await api('/api/state');
    if (st && st.config) { SRVCFG = st.config; if (st.config.userSelf) window.__userSelf = st.config.userSelf; }
    if (st.noWorld) { renderStart(); return; }
    refresh(st); 
  } catch (e) { toast('连接失败: ' + e.message, true); renderStart(); }
}
if (!window.__escBound) {
  window.__escBound = true;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { const mm = document.getElementById('modal'); if (mm && !mm.classList.contains('hidden')) mm.classList.add('hidden'); } });
}
(function initDock() {
  const cmdEl = $('#cmd');
  if (!cmdEl) return;
  const qt = { act: '我', say: '我说：', ask: '我在想，' };
  document.querySelectorAll('.qt').forEach(x => {
    x.onclick = () => { const k = x.dataset.k; const pre = qt[k] || ''; $('#cmd').focus(); $('#cmd').value = pre; };
  });
  const sendBtn = $('#send'); if (sendBtn) { sendBtn.dataset.act = 'submit'; }
  const gearBtn = document.getElementById('gear'); if (gearBtn) { gearBtn.dataset.act = 'settings'; }
  cmdEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(cmdEl.value || ''); } });
  cmdEl.addEventListener('input', () => { cmdEl.style.height = 'auto'; cmdEl.style.height = Math.min(cmdEl.scrollHeight, 160) + 'px'; });
})();
boot();
