'use strict';
/* ══════════════════════════════════════════════════════════════════════════
   creator.js — v3.12 · 世界模板创造：**触发 → 批准 → 调用 → 落库 → 上屏**
   ──────────────────────────────────────────────────────────────────────────
   用户 2026-09-27 拍板（原话）：
     「这个效果 就是那个生成框架 一般般啊…为什么放开权限 让它大胆的造？（第三步）
      7000+token输入 0.5 说的还是太死 限制它的发挥 **只保留基础游玩的核心 其余的全部放开**。
      就如同调取档案那样子 **把该给的资料给了 剩下的自己生成**」
     「不管加了或者未加 **都需要留痕**」
     「**权限很大**，但需要禁止让 ai 给整个模拟器搞坏，**最多让它搞坏存档**」
     「第三步出现异常 要么**修复** 要么**重新弄**」
   于是这一节就是那条链的**调用者**（此前 creatorPromptBlock 只有断言脚本引用过，
   没有任何运行时调用点 —— 所以用户体感"和以前没差别"）：

     AI 负责想：数据类 AI 每回合顺手在 frame 里说一句「想加什么/为什么」（**0 额外 token**）
     ★ v3.17 起：**判断权交给 AI**（判断指令每回合搭在资料包里）—— 代码只留防重入（同一回合一次）与四道闸
     引擎负责造：把该给的资料给足 → 一次 llmJSONDeep → checkPanel 校验 → logProposal 留痕
     界面负责显示：buildView().panels（内容来源决定行从哪来；门控逐条过滤）

   三条不许破的红线（用户自己拍的）：
     · 写入只有一条路（发 Update）—— 这里产出的板块**只声明**，不直接写存档字段；
     · 门控不可绕 —— 行数据逐条过 gate（panelGate），过不了的整条丢掉、不连累整块；
     · 爆炸半径 = 存档 —— 板块是存档里的数据，坏了能修（repair 认得板块）或回退默认。
   ══════════════════════════════════════════════════════════════════════════ */
const DEG = require('./degraded');
const FW = require('./framework');

/* 一局最多留几个模块（**存档保险，不是「该造几个」的规定**：旧的挤出去） */
const PANELS_MAX = 120;
const ROWS_MAX = 60;              // 一个模块最多渲染几行（超出由 enforceKeep 归档）
/* ── 小工具（v3.17 修复：删冷却闸时连它们一起被删掉了，导致 fw is not defined）── */
function fw(data) { try { return FW.ensure(data); } catch (e) { DEG.hit('creator.js:fw', e); return null; } }
function nowT(data) { return String((data && data.current && data.current.time) || ''); }
function dayOf(data) { return nowT(data).slice(0, 10); }
function yearOf(data) { return nowT(data).slice(0, 4); }
function turnOf(data) { return (data && data.current && data.current.turnN) || 0; }
/* ---------- 落库：校验 → 去重 → 留痕（**采纳和未采纳都记**） ---------- */
function addPanels(data, panels, why, by) {
  const f = fw(data); if (!f) return { kept: [], dropped: [] };
  f.panels = f.panels || [];
  const kept = [], dropped = [];
  for (const p of (panels || [])) {
    const name = (p && p.shape && (p.shape.name || p.shape.id)) || '（没名字）';
    const chk = FW.checkPanel(p);
    if (!chk.ok) { dropped.push({ name: name, why: chk.errs.join('；') }); continue; }
    /* 语法预检：板块里带代码也只**编译不执行**（多一个引号进不了存档） */
    if (p.shape && p.shape.code) {
      const sc = FW.syntaxCheck(p.shape.code);
      if (!sc || !sc.ok) { dropped.push({ name: name, why: '语法预检没过：' + String((sc && sc.err) || '') }); continue; }
    }
    const id = String((p.shape && p.shape.id) || '').replace(/[^\w\-]/g, '').slice(0, 24) || ('p' + (f.panels.length + 1));
    if (f.panels.some(x => x.shape && x.shape.id === id)) { dropped.push({ name: name, why: '已经有同名板块了（id=' + id + '）' }); continue; }
    const rec = {
      shape: Object.assign({}, p.shape, FW.normShape(Object.assign({}, p.shape, { id: id }))),   // v3.19：呈现（mount/layout/style/kind）归一化
      source: p.source, when: String(p.when || '').slice(0, 40),
      keep: FW.normKeep(p.keep),          // ★ v3.17：留多少（缺就默认 80 条 / 90 天）
      retire: FW.normRetire(p.retire),    // ★ v3.17：什么时候死、谁判、死了干嘛
      born: { turn: turnOf(data), at: nowT(data), why: String(p.why || why || '').slice(0, 160) },   // 有头：出生留痕
      why: String(p.why || why || '').slice(0, 160), by: by || 'ai',
      at: nowT(data), turn: turnOf(data)
    };
    f.panels.push(rec); kept.push(rec);
    if (f.panels.length > PANELS_MAX) f.panels.shift();
  }
  for (const k of kept) FW.logProposal(data, { what: '板块 · ' + (k.shape.name || k.shape.id), why: k.why, scope: (k.source && k.source.kind) || '', state: '已采纳' });
  for (const d of dropped) FW.logProposal(data, { what: '板块 · ' + d.name, why: d.why, scope: '', state: '未采纳', note: d.why });
  return { kept: kept, dropped: dropped };
}

/* ---------- 上屏：内容来源决定行从哪来 ---------- */
function readPath(data, path) {
  try {
    let cur = data;
    for (const k of String(path || '').split('.')) { if (cur == null) return null; cur = cur[k]; }
    return cur == null ? null : cur;
  } catch (e) { DEG.hit('creator.js:readPath', e); return null; }
}
function cellsOf(data, item, list) {
  if (item == null) return null;
  /* ★ 行本来就是「一串格子」时直接用 —— 主 AI 用 panelData 喂进来的就是这种（实测漏了这一支：
     数组落进下面的对象分支，键取不到 ⇒ 整行变空格 ⇒ 被门控当空行丢掉，板块看起来永远没内容）。 */
  if (Array.isArray(item)) {
    const cells = item.slice(0, 6).map(v => (v == null ? '' : (typeof v === 'object' ? JSON.stringify(v).slice(0, 40) : String(v).slice(0, 80))));
    return cells.length ? cells : null;
  }
  if (typeof item === 'string' || typeof item === 'number') {
    const id = String(item);
    let nm = id;
    try { const G = require('./game'); nm = G.viewName ? (G.viewName(data, id) || id) : id; } catch (e) { nm = id; }
    return [nm];
  }
  if (typeof item === 'object') {
    const vals = [];
    const keys = (list && list.length) ? list : Object.keys(item).slice(0, 4);
    for (const k of keys) {
      const v = item[k];
      if (v == null) { vals.push(''); continue; }
      vals.push(typeof v === 'object' ? JSON.stringify(v).slice(0, 40) : String(v).slice(0, 60));
    }
    return vals.length ? vals : null;
  }
  return [String(item)];
}
function rowsFor(data, p) {
  const f = fw(data) || {};
  const s = p.source || {};
  const id = p.shape && p.shape.id;
  const list = (p.shape && p.shape.list) || [];
  if (s.kind === 'view' && s.of) {
    const v = readPath(data, s.of);
    if (Array.isArray(v)) return v.slice(-ROWS_MAX).map(x => cellsOf(data, x, list)).filter(Boolean);
    if (v && typeof v === 'object') return Object.keys(v).slice(0, ROWS_MAX).map(k => cellsOf(data, v[k], list)).filter(Boolean);
    return [];
  }
  const stored = (f.panelRows || {})[id];
  if (Array.isArray(stored) && stored.length) return stored.slice(-ROWS_MAX).map(x => cellsOf(data, x, list)).filter(Boolean);
  return [];
}
/* 给界面的板块清单（含已门控的行） */
function panelView(data) {
  const f = fw(data); if (!f) return [];
  const out = [];
  for (const p of (f.panels || [])) {
    if (p.retired) continue;                 // ★ v3.17：退休的收进档案，不再占位（玩家侧与资料包都不再列）
    let rows = [];
    try { rows = rowsFor(data, p) || []; } catch (e) { DEG.hit('creator.js:rows', e); rows = []; }
    /* 门控逐条过滤：过不了的那一行丢掉，**不连累整块**（framework.panelGate 的既有语义） */
    try { rows = FW.panelGate(data, rows, (r) => (r && r.length && String(r[0] || '').trim()) ? r : null); } catch (e2) { DEG.hit('creator.js:gate', e2); }
    out.push({
      id: (p.shape && p.shape.id) || '',
      name: (p.shape && p.shape.name) || '',
      group: (p.shape && p.shape.group) || '',      // v3.16：分类（玩家侧与目录都按它收纳）
      mount: (p.shape && p.shape.mount) || 'panel',  // v3.19：挂在哪儿（浮层/整页/页签组/气泡）
      layout: (p.shape && p.shape.layout) || 'list', // v3.19：怎么排（列表/表格/卡片流/时间线）
      style: (p.shape && p.shape.style) || '',       // v3.19：风格（AI 按世界写）
      kind: (p.shape && p.shape.kind) || 'read',     // v3.19：只读 / 能发能回
      icon: (p.shape && p.shape.icon) || 'box',
      list: (p.shape && p.shape.list) || [],
      rows: rows,
      source: (p.source && p.source.kind) || '',
      when: p.when || '',
      why: p.why || ''
    });
  }
  return out;
}
/* 主 AI 每回合顺手产出的行（inline 类板块用；0 额外调用） */
function addRows(data, id, rows) {
  const f = fw(data); if (!f || !id) return 0;
  f.panelRows = f.panelRows || {};
  const arr = f.panelRows[id] = f.panelRows[id] || [];
  let n = 0;
  for (const r of (rows || [])) {
    if (r == null) continue;
    arr.push(typeof r === 'object' ? r : String(r));
    n++;
  }
  while (arr.length > ROWS_MAX) arr.shift();
  return n;
}

/* ---------- 提示词：把该给的资料给了，剩下的自己生成 ---------- */
function creatorSystem(data) {
  return [
    '你是【世界模拟器】的**世界模板创造者**。这一局"长什么样"，由你说了算。',
    '',
    '【你的权限（已经给到这个份上，就别再交一份「跟默认长得差不多」的东西）】',
    '· 布局 / 页签 / 名称 / 图标 / 栏目 / 排序 / 交互点 / 器物界面 / 板块内容 —— 全归你。',
    '· 做事只有三条线：读（读存档/读投影/读门控）· 画（加页签/加按钮/显示/用演出原语）· 写（**只有「发 Update」一条**）。',
    '· 演出原语是引擎的能力：**你给名字，引擎给画法**（不许发明新画法）。',
    '',
    '【判断不了就编 —— 这里是创造层，空着才是错】',
    '· 「编事实」是错的（谁是谁、谁认识谁、已经发生过什么 —— 那是读卡那两步的活儿，宁可留空）；',
    '· 「编世界」是你的本职：**没有依据的地方合理编一个**，并说清依据（卡里哪句 / 世界基调 / 时代常识）；',
    '· **禁止留空、禁止占位串**（待定 / 未知 / 暂无 / 待补全）：空着的界面不是谨慎，是没做。',
    '',
    FW.creatorPromptBlock(data),
    '',
    '【它长什么样，也归你 —— 引擎只给你「能挂在哪儿」】',
    '· 挂载方式（shape.mount）：**overlay 浮层**（随时扫一眼、不打断正文，像一块悬浮窗）/ **panel 整页**（要专心读的东西）/ **tabs 页签组**（一台器物或一个系统里的几个功能）/ **bubble 气泡**（事情发生就冒一下）。',
    '· 排法（shape.layout）：**list 列表** / **table 表格** / **cards 卡片流** / **timeline 时间线** —— 同一份数据，你挑最合这个世界的那种。',
    '· **风格（shape.style）由你按这个世界的剧本写**：1994 年东北农村 → 铁皮、白瓷缸、手写、大队部黑板、户口本；赛博都市 → 玻璃、发光边框、等宽字。引擎不指定任何风格。',
    '· 交互（shape.kind）：**read** 只读；**messages** 能发能回（**走引擎既有的消息链路，所以「回复」是免费的**，不用你写收发）。',
    '· 硬红线：不许盖住正文、不许压住输入框、**同时挂着的浮层最多 ' + FW.OVERLAY_MAX + ' 个**（多的自己收进页签组）。',
    '【只输出 JSON】{"panels":[{"shape":{id,name,icon,group,mount,layout,style,kind,list},"source":{...},"when":"...","why":"一句话：这个板块为什么属于这个世界"}]}',
    '造多少由**这个剧本**说了算：该有几样就几样，不必凑数、也不必省着。造不出来就输出 {"panels":[]} —— 那也是个诚实的答案。'
  ].join(String.fromCharCode(10));
}
/* 「把该给的资料给足」：世界概要 + 人物 + 地点 + 器物 + 已有板块 + 最近场景 */
function creatorContext(data, hint) {
  const meta = (data && data.meta) || {};
  const cur = (data && data.current) || {};
  const ents = Object.values((data && data.entities) || {});
  const persons = ents.filter(e => e && e.type === 'person' && e.id !== 'player').slice(0, 24)
    .map(e => { let as = e.name || e.id; try { const G = require('./game'); as = G.viewName(data, e.id) || as; } catch (er) { } return as + '（' + e.id + '）：' + String(((e.profile || {}).identity || {}).身份 || '').slice(0, 30); });
  const places = ents.filter(e => e && e.type === 'place').slice(0, 24).map(e => (e.name || e.id) + '（' + e.id + '）');
  const tools = ((data && data.meta && data.meta.tools) || []).map(t => t.name + '（' + t.id + '）');
  const f = fw(data) || {};
  const mine = (f.panels || []).map(p => (p.shape && p.shape.name) || '?');
  const tail = ((data && data.sceneLog) || []).slice(-8).map(l => String(l.text || '').slice(0, 90));
  return [
    '【这一局】' + (meta.name || '未名之地') + ' · ' + (meta.era || meta.eraLabel || '时代未知')
      + ' · 世界时间 ' + nowT(data) + ' · 第 ' + turnOf(data) + ' 回合',
    meta.note ? ('世界在讲什么：' + String(meta.note).slice(0, 300)) : '',
    '【玩家】' + String(((data.entities || {}).player || {}).name || '你') + '：' + JSON.stringify(((data.entities || {}).player || {}).profile ? (((data.entities.player.profile || {}).identity) || {}) : {}).slice(0, 200),
    '【人物（' + persons.length + '）】' + persons.join('；'),
    '【地点（' + places.length + '）】' + places.join('；'),
    '【器物】' + (tools.join('、') || '（没有随身器物）'),
    '【这一局已经有的板块】' + (mine.join('、') || '（还没有）') + ' —— 别重复造。',
    '【最近发生了什么】' + tail.join(' / '),
    '【这一回合它自己提的理由】' + String((hint && hint.why) || '（没说）'),
    '【输出】只输出 JSON：{"panels":[{shape,source,when,why}]}'
  ].filter(Boolean).join(String.fromCharCode(10));
}
/* 真的去造一次（这是全项目唯一一个"造框架"的调用点） */
async function create(data, cfg, hint) {
  const AI = require('./ai');     // lazy：framework ← ai 是一条环，顶层 require 会炸
  const out = await AI.llmJSONDeep(cfg, [
    { role: 'system', content: AI.withCharter(creatorSystem(data)) },
    { role: 'user', content: creatorContext(data, hint) + reviewBlockForPrompt(data) }
  ], { panels: [] }, AI.cfgMax(cfg), null);   // ★ 上限跟着设置走（用户拍过：全部调用都走设置那个；字面数字会被 llm-config-check 抓）
  const panels = (out && Array.isArray(out.panels)) ? out.panels : [];
  /* v3.17：**送审回执**（淘汰规则的另两种形态：纯 AI 判 / 代码+AI 送审）——搭在同一次调用里，0 额外开销。 */
  let review = null;
  try { review = applyReview(data, out && out.review); } catch (e) { DEG.hit('creator.js:review', e); }
  return { panels: panels, why: (hint && hint.why) || String((out && out.why) || ''), review: review };
}
/* ══ ★ v3.15 · 建档第三步的「世界建立」 ══════════════════════════════════════
   用户 2026-09-27：「那你前面改的是啥？我的意思你没搞懂吗？」
   —— 他要的是：**建档那一步（第三步）就把这一局「造出来」**，不是等回合里 AI 偶尔提一句。
   实测过为什么必须这样：靠山屯那局建档时 creator 一次都没跑（第三步只补字段），
   唯一一次创造是第 2 回合碰巧触发的，而且造出来的是两个**空板块**（inline 类要等下一回合才有行）。
   所以这一版：**建档跑完就造一次** —— 一次造齐；每个板块**必须带 1~3 行首批内容**（建档时没有「下一回合」，空壳就是没做）。
   写入照旧只有 postUpdate 一条路：这里产出的只是「声明 + 首批内容」，不直接改存档字段。 */
function openingSystem(data) {
  const L = [creatorSystem(data), ''];
  L.push('【这一次是**建档第三步 · 世界建立**】这个世界刚建好，还没走过任何一回合。');
  L.push('你要做的：**把这一局「长什么样」一次定下来** —— 它有哪些器物界面 / 册子 / 名单 / 风声 / 节目单……按这个世界的年代与生活方式来，不要照抄别的世界。');
  /* ★ v3.16（用户 2026-09-27 纠正）：「既然是创造 那就是**按照剧本去生成贴切的系统和模块**
     你为什么这么着急的要去给它规定死？」—— 所以这里原来那句「**3~6 个板块**」删掉了：
     数量不设限（随剧情、随时长，上百个都可以，靠**分类**组织而不是靠上限）；
     类型也不规定（按这个世界真实存在什么信息载体来）。剩下的只有一条：**每一格都要能活**。 */
  L.push('要求：**贴**。这个世界是个什么剧本、什么年代、什么活法，就长什么样的系统与模块 —— 数量不设限（该几样就几样，随着剧情长也行）。');
  L.push('硬要求（只有这一条）：');
  L.push('  · **每一格都要能活**：写清内容从哪来（source）；建档时能带 1~3 行首批内容（rows）就带上 —— 建档没有「下一回合」，空壳第一眼就是空的。');
  L.push('  · **分类**（shape.group）：给每一格一个自己的分类名（例如 信息流 / 名录 / 账册 / 器物 / 杂项），玩家那一侧按分类收纳 —— 上百格也不乱。');
  L.push('  · **它长什么样也归你**：mount（overlay 浮层 / panel 整页 / tabs 页签组 / bubble 气泡）· layout（list/table/cards/timeline）· style（**按这个世界的剧本写风格**）· kind（read 只读 / messages 能发能回）。');
  L.push('    想象一下：这个世界的「系统」如果做成一块**悬浮窗**，它该是什么材质、什么字、什么边框？**那是你要回答的问题。**');
  L.push('  · 造出来的东西要**像这个世界自己的**：1994 年的东北农村不会有朋友圈，但会有工地册、代销点价目、屯里风声、作业本。');
  L.push('【输出】只输出 JSON：{"panels":[{shape:{id,name,icon,list},source,when,why,rows:[["…","…"]]}]}');
  return L.join(String.fromCharCode(10));
}
async function openingCreate(data, cfg) {
  const AI = require('./ai');
  const out = await AI.llmJSONDeep(cfg, [
    { role: 'system', content: AI.withCharter(openingSystem(data)) },
    { role: 'user', content: creatorContext(data, { why: '建档第三步：世界建立（这一局刚建好，还没走过一回合）' }) }
  ], { panels: [] }, AI.cfgMax(cfg), null);
  const panels = (out && Array.isArray(out.panels)) ? out.panels : [];
  const res = addPanels(data, panels, '建档第三步：世界建立', 'ai');
  let rows = 0;
  for (const p of panels) {
    if (!p || !p.shape || !p.shape.id || !Array.isArray(p.rows)) continue;
    const id = String(p.shape.id).replace(/[^\w\-]/g, '').slice(0, 24);
    if (!id) continue;
    rows += addRows(data, id, p.rows);
  }
  markCreated(data, '建档第三步：' + res.kept.map(k => (k.shape && k.shape.name) || '').filter(Boolean).join('、'));
  return { ok: res.kept.length > 0, kept: res.kept, dropped: res.dropped, why: '' };
}
/* 一回合一次的完整流程（game.runTurn 调它；任何异常都不许连累回合） */
async function maybeCreate(data, cfg, hint) {
  try {
    /* ★ v3.17（用户 2026-09-27）：**决策权交给 AI，代码不再用冷却/预算否决** ——
       「这个请求还是让 ai 自己判断 我们可以写个提示词…交由 ai 自己根据上面的情况判断是否调用和调用到何种程度」。
       判据由 judgeBlock() 每回合喂给它（局面 + 判据 + 软约束），它说 want 就执行。
       代码只留一道防重入：**同一回合最多一次**（不是内容闸，是防止一次输出里循环调用自己）。 */
    if (data && data.current && data.current.creatorUsedTurn === turnOf(data)) return { ok: false, why: '这一回合已经改过一次了' };
    if (!(hint && hint.want)) return { ok: false, why: '这一回合它没提' };
    if (data && data.current) data.current.creatorUsedTurn = turnOf(data);
    const r = await create(data, cfg, hint);
    const res = addPanels(data, r.panels, r.why, 'ai');
    if (res.kept.length) { markCreated(data, res.kept.map(k => k.shape.name).join('、')); addRows(data, null, null); }
    return { ok: res.kept.length > 0, kept: res.kept, dropped: res.dropped, why: okc.eraFree ? '时代节点（免冷却）' : '' };
  } catch (e) {
    DEG.hit('creator.js:maybeCreate', e);
    return { ok: false, why: String((e && e.message) || e) };
  }
}

/* 改过一次就记一笔（局面信息要给 AI 看：「上一次改是第几回合、改了啥」） */
function markCreated(data, note) {
  const f = fw(data); if (!f) return null;
  const rec = { turn: turnOf(data), day: dayOf(data), year: yearOf(data), t: nowT(data), note: String(note || '').slice(0, 60) };
  (f.created = f.created || []).push(rec);
  if (f.created.length > 60) f.created.shift();
  return rec;
}
module.exports = { markCreated, addPanels, rowsFor, panelView, addRows, creatorSystem, openingSystem, creatorContext, create, maybeCreate, openingCreate };

/* ══ ★ v3.17 · 善后与有头有尾：内容寿命 · 归档（降级不是删） · 淘汰规则 ══════════
   用户 2026-09-27 定：
     · 「需要固定死 禁止无限流内容」→ 每格有 keep（条数/天数，谁先到谁生效）
     · 「还需要有一个模块啊 那就是**淘汰规则**…各种检测机制 或是代码（检测时间）
        或是 ai 调取到这个东西认为这个东西已经没用了 或是代码+ai（每隔 1 年游戏时间
        代码会将这模块发给 ai 判断是否过时）」
     · 「需要有善后工作 并且要有头有尾」
     · 归档的去向：「存档里是 2~81 条 那 1 还会被 ai 看到吗？还是会放进**沉寂库**？」
       → 答案：**平时看不到（否则等于没归档），查得到（query），而且折叠成一句留在眼前那一轨**。
   三层可见性：玩家（档案里可翻）· AI 顺手看（看不到）· AI 主动查（query what:'archive'）。 */

/* 归档一条：不是删，是降级。带出处（哪一格 / 哪一轮 / 什么时间）。 */
function archivePush(data, id, rows, why) {
  const f = fw(data); if (!f) return 0;
  f.archive = f.archive || [];
  let n = 0;
  for (const r of (rows || [])) {
    f.archive.push({ panel: String(id || ''), turn: turnOf(data), at: nowT(data), why: String(why || '').slice(0, 60), row: r });
    n++;
  }
  const MAX = 2000;                       // 沉寂库也有限（旧的挤掉，不再留痕 —— 它就是最后一道）
  if (f.archive.length > MAX) f.archive.splice(0, f.archive.length - MAX);
  return n;
}
/* 折叠成一句：代码兜底（0 token）——把被挤掉的那些行的第一格拼成一句话留在眼前那一轨 */
function foldDigest(data, id, rows) {
  const f = fw(data); if (!f) return '';
  f.panelDigest = f.panelDigest || {};
  const bits = (rows || []).map(r => String((Array.isArray(r) ? r[r.length - 1] : r) || '')).filter(Boolean).slice(-6);
  const line = bits.join('；').slice(0, 120);
  if (!line) return '';
  const prev = String(f.panelDigest[id] || '');
  f.panelDigest[id] = (prev ? (prev + '　' + line) : line).slice(-400);
  return line;
}
/* 每回合跑（0 token）：按 keep 把超出的行归档 + 折叠摘要 */
function enforceKeep(data) {
  const f = fw(data); if (!f || !(f.panels || []).length) return 0;
  let dropped = 0;
  for (const p of f.panels) {
    if (!p || !p.shape || !p.shape.id) continue;
    const k = p.keep = FW.normKeep(p.keep);
    if (k.noDrop) continue;                                  // 账本类：声明不淘汰
    const arr = ((f.panelRows || {})[p.shape.id]) || [];
    let cut = 0;
    if (arr.length > k.rows) cut = arr.length - k.rows;
    if (cut > 0) {
      const gone = arr.splice(0, cut);
      archivePush(data, p.shape.id, gone, '超出 ' + k.rows + ' 条');
      foldDigest(data, p.shape.id, gone);
      dropped += gone.length;
      try { FW.logProposal(data, { what: '归档 · ' + ((p.shape && p.shape.name) || p.shape.id), why: '超出寿命（' + k.rows + ' 条）', scope: p.source && p.source.kind, state: '已采纳', note: gone.length + ' 条进沉寂库' }); } catch (e) { }
    }
  }
  return dropped;
}
/* 纯代码淘汰：谁声明了 who='code' 且「超过 keep.days 天没有新内容」→ 退休（归档 + 留痕 + 待世界内交代） */
function retireByCode(data) {
  const f = fw(data); if (!f || !(f.panels || []).length) return [];
  const out = [];
  const nowMs = new Date(nowT(data)).getTime();
  for (const p of (f.panels || [])) {
    if (!p || p.retired) continue;
    const r = p.retire = FW.normRetire(p.retire);
    if (r.who !== 'code') continue;
    const arr = ((f.panelRows || {})[(p.shape || {}).id]) || [];
    const last = p.lastAt || (p.born && p.born.at) || '';   // 没有行也要会老（从出生时刻起算）
    const days = last ? Math.round((nowMs - new Date(last).getTime()) / 86400000) : 0;
    if (days > FW.normKeep(p.keep).days) {
      p.retired = { turn: turnOf(data), at: nowT(data), why: r.check || ('超过 ' + FW.normKeep(p.keep).days + ' 天没有新内容'), note: '' };
      archivePush(data, (p.shape || {}).id, arr, '退休：' + (p.retired.why || ''));
      if (f.panelRows) f.panelRows[(p.shape || {}).id] = [];
      /* 世界内要有一句交代（代码写不了人话）→ 挂进送审队列，下一次生成框架调用时由 AI 补 */
      (f.review = f.review || []).push({ id: (p.shape || {}).id, name: (p.shape || {}).name || '', kind: '要一句话交代', why: p.retired.why });
      try { FW.logProposal(data, { what: '退休 · ' + ((p.shape && p.shape.name) || p.shape.id), why: p.retired.why, scope: 'code', state: '已采纳', note: '已归档，等一句世界内的交代' }); } catch (e) { }
      out.push(p.shape.id);
    }
  }
  return out;
}
/* 该送审的：① 代码+AI 的年度送审（每 1 年游戏时间）② 等世界内交代的 ③ 纯 AI 的（由主 AI 顺手判，这里只汇总） */
function reviewDue(data) {
  const f = fw(data); if (!f) return [];
  const q = (f.review = f.review || []);
  const year = yearOf(data);
  for (const p of (f.panels || [])) {
    if (!p || p.retired) continue;
    const r = FW.normRetire(p.retire);
    if (r.who === 'code+ai' && p.lastReviewYear !== year) { p.lastReviewYear = year; q.push({ id: (p.shape || {}).id, name: (p.shape || {}).name || '', kind: '年度送审', why: '每 1 年游戏时间送审一次' }); }
  }
  return q;
}
/* AI 的送审回执：{ keep:[id], retire:[{id, note}], rebuild:[{id, why}] } */
function applyReview(data, out) {
  const f = fw(data); if (!f) return { retired: 0, kept: 0 };
  const o = out || {};
  let retired = 0, kept = 0;
  const byId = {};
  for (const p of (f.panels || [])) byId[(p.shape || {}).id] = p;
  for (const it of (Array.isArray(o.retire) ? o.retire : [])) {
    const id = String((it && it.id) || ''); const p = byId[id];
    if (!p || p.retired) continue;
    p.retired = { turn: turnOf(data), at: nowT(data), why: String((it && it.why) || 'AI 判定过时').slice(0, 80), note: String((it && it.note) || '').slice(0, 120) };
    const rows = ((f.panelRows || {})[id]) || [];
    archivePush(data, id, rows, '退休：' + p.retired.why);
    if (f.panelRows) f.panelRows[id] = [];
    try { FW.logProposal(data, { what: '退休 · ' + ((p.shape && p.shape.name) || id), why: p.retired.why, scope: 'ai', state: '已采纳', note: p.retired.note || '（世界内交代：' + p.retired.note + '）' }); } catch (e) { }
    retired++;
  }
  for (const it of (Array.isArray(o.keep) ? o.keep : [])) { const p = byId[String((it && it.id) || it)]; if (p && p.retired && !p.retired.why) { delete p.retired; kept++; } }
  f.review = [];
  return { retired: retired, kept: kept };
}
/* 给 query 的沉寂库视图（AI 主动查得到；带门控由 query 侧套） */
function archiveView(data, q) {
  const f = fw(data); if (!f) return [];
  const arr = f.archive || [];
  const kw = String((q && q.q) || '').trim();
  const from = (q && q.from != null) ? Number(q.from) : null;
  const to = (q && q.to != null) ? Number(q.to) : null;
  const who = String((q && q.person) || '').trim();
  let rows = arr;
  if (kw) rows = rows.filter(x => JSON.stringify(x.row || '').indexOf(kw) >= 0);
  if (from != null) rows = rows.filter(x => Number(x.turn) >= from);
  if (to != null) rows = rows.filter(x => Number(x.turn) <= to);
  if (who) rows = rows.filter(x => JSON.stringify(x.row || '').indexOf(who) >= 0);
  return rows.slice(-(Number((q && q.n) || 40)));
}
/* 送审清单（拼进生成框架那次调用的 user；没有送审项就是空串，0 字节） */
function reviewBlockForPrompt(data) {
  const q = reviewDue(data);
  if (!q.length) return '';
  const L = ['', '【送审 · 这些模块该退休了吗】'];
  for (const it of q) L.push('- ' + it.id + '（' + it.name + '）：' + it.kind + ' · ' + it.why);
  L.push('你可以让它们退休（归档，不删）——退休时**必须给一句世界内的交代**（这件事在世界里是怎么收尾的）。');
  L.push('输出里附：review = { keep:[id...], retire:[{id, why, note}] }（note = 那句世界内的交代）。');
  return L.join(String.fromCharCode(10));
}
/* 每回合喂给主 AI 的「生成框架 · 局面与判据」（0 额外调用：搭在它本来就要输出的 frame 里） */
function judgeBlock(data) {
  /* 任何异常都不许连累回合：局面那段（会读存档字段）包在 try 里，判据与软约束是常量、永远给得出来。 */
  let 局面 = '（局面读不到，照常判断即可）';
  try { 局面 = judgeSituation(data); } catch (e) { DEG.hit('creator.js:judge', e); }
  return [
    '【生成框架 · 要不要改这一局（你自己判断，代码不拦你）】',
    局面,
    '判据（你说了算）：该放手 —— 这个世界明显缺一件该有的东西、时代往前走了、玩家卡在一件本该有系统管的事上；',
    '  该拦自己 —— 刚改过、跟已有模块重复、说不清内容从哪来、只是「想要」而不是「需要」。',
    '软约束（**不是闸，是提醒**）：**一次性改到位**，别一点一点挤；单次**最好不要超过 5 个模块**（开局铺地基那次可以 8~12 个）；',
    '  宁可少而准，不要多而杂 —— **造一堆长得差不多的格子，等于没造**。',
    '输出：frame.creator = { want: true|false, why: "一句话理由", scope: "这次想动什么（一句话）" }；不想改就 want:false 或省略。'
  ].join(String.fromCharCode(10));
}
function judgeSituation(data) {
  const f = fw(data) || {};
  const ps = panelView(data);
  const byGroup = {};
  for (const p of ps) { const k = p.group || '未分类'; byGroup[k] = (byGroup[k] || 0) + 1; }
  const createdArr = f.created || [];
  const last = createdArr[createdArr.length - 1] || null;
  const retired = (f.panels || []).filter(p => p.retired).length;
  const live = ps.length;
  return [
    '局面：这一局「' + String(((data.meta || {}).name) || '') + '」· ' + String(((data.meta || {}).era || (data.meta || {}).eraLabel) || '') + ' · 第 ' + turnOf(data) + ' 回合 · ' + nowT(data),
    '已有的：' + (ps.length ? (Object.keys(byGroup).map(k => k + '(' + byGroup[k] + ')').join('、') + '；已退休 ' + retired + ' 个') : '还没有模块'),
    last ? ('上一次改：第 ' + (last.turn || 0) + ' 回合（' + String(last.note || '').slice(0, 40) + '）') : '上一次改：还没改过'
  ].join(String.fromCharCode(10));
}

module.exports = module.exports || {};
Object.assign(module.exports, { archivePush, foldDigest, enforceKeep, retireByCode, reviewDue, applyReview, archiveView, judgeBlock });
