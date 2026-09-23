// server.js — 本地 Web 服务（静态 UI + JSON API）—— v1.6 多世界管理
'use strict';
const DEG = require('./src/degraded');
const RET = require('./src/retention');   // v1.87 统一留存策略（阈值表 + 溢出落盘）
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { makeStore, makeId, resBase, resAssets, loadMeta, saveMeta, worldsDir, worldFile, cardsDir, cardFile, writeAtomic, loadWorldFile } = require('./src/store');
const { buildDemoWorld } = require('./src/world');
const AI = require('./src/ai');
const G = require('./src/game');
const IMP = require('./src/import');
const OPEN = require('./src/opening');   // v3.1 开局编译：把世界的声明翻译成这个人的字段
const WG = require('./src/worldgen');
const PRES = require('./src/presentation');
const SCHED = require('./src/scheduler');
const VIS = require('./src/visual');
const CONTENT = require('./src/content');   // v1.61 内容模块槽位

const BUILD = 'v2.08';
/* v1.84：存档 schema 版本。原来**世界数据零版本字段**，loadWorld 里 8 段"字段缺失就补"的迁移
   只能靠猜年代（ai.js 里还有一条用 timeoutMs===90000 猜年代的同类病）。现在：档里带版本，
   迁移有了明确边界，且迁移动作会进生成清单留痕（设计总稿 §26.3 要求"修复必须留痕"）。 */
const SCHEMA = 1;
let cfg = AI.loadConfig();
const PORT = Number(process.env.PORT) || Number(cfg.port) || 3088;
const BASE = resBase();
const ASSETS = resAssets();
const PUBLIC = path.join(ASSETS, 'public');

// ---------- 运行时状态 ----------
let menuMode = true;      // 主菜单优先：启动不自动进入世界
let current = null;       // 当前世界数据（内存）
let currentId = null;     // 当前世界 id（文件 = data/worlds/<id>.json）
let previewPack = null;   // /api/world/gen 挂起的预览包
const SCAN_CACHE = new Map();   // v1.67 扫描结果缓存（预览 → 建世界复用，不再扫两遍）
/* v1.77 进度频道：扫描/建世界这种要等 AI 半分钟的操作，界面得能说出「现在在干什么」。
   用户原话：「扫描的时候正在改什么（等待ai回复中/正在书写中：多少字）和载入世界的时候的百分比数字」。
   服务端只报**真的东西**：阶段名 + 已收字数（流式增量）+ 一个**按阶段估**的百分比；界面每 0.6 秒来拿一次。 */
let __imgBusySince = 0;   // v1.79：队列占用开始时间（看门狗用）
/* v1.83 修 P1-4：回合并发锁。前端流式有 150s 看门狗，超时 abort 后会**再发一次 /api/turn**，
   而 abort 只断客户端 socket —— 服务端那一回合仍在跑、并且会 persist()+autoSnap()。
   于是"一个动作跑两个回合"：世界时间推两次、token 双倍。这里同一时间只放行一个回合。 */
/* v1.98 · P0-2：世界级单写锁（src/worldlock.js）。
   原来只有一个 __turnBusy，只守 /api/turn 与 /api/turn/stream 两条入口 ——
   而会改世界的入口有三十多条（评审回执 P0-2 §3 的 A/B/C 三组）。
   现在锁的**唯一执行点**在 HTTP 分发器里（见下面的 WL.enter），
   哪条入口需要锁声明在 worldlock.js 的 REQUIRED 表里；那条表有静态自检（world-lock-check.js）。
   锁超时：**动态**取"配置的单次请求超时 + 5 分钟"，夹在 [10, 45] 分钟 ——
   玩家可以把 llm.timeoutMs 调到 30 分钟（ai.js 的 clamp 上限），固定的 10 分钟会误杀一个正常的长回合。 */
const WL = require('./src/worldlock');
WL.configure({ onForceRelease: (m) => GL(m) });
function lockTimeoutMs() {
  const t = Number((cfg.llm && cfg.llm.timeoutMs) || 900000) || 900000;
  return Math.max(10 * 60000, Math.min(45 * 60000, t + 5 * 60000));
}
let PROG = null;
function progSet(label, pct) {
  PROG = { label: String(label || ''), pct: Math.max(0, Math.min(100, Math.round(Number(pct) || 0))), chars: (PROG && PROG.chars) || 0, t0: (PROG && PROG.t0) || Date.now() };
}
function progChars(n) { if (PROG) PROG.chars = Math.max(0, Number(n) || 0); }
function progClear() { PROG = null; }
let previewMode = '';
let previewSelf = null;   // 用户自定义的玩家设定（User 设定，20.1）
let previewSetup = null;  // 设定核对结果（20.2 以世界为准）

const GL = (line) => {
  try { fs.appendFileSync(path.join(os.tmpdir(), 'worldsim.log'), new Date().toISOString() + ' [gen] ' + line + '\n'); } catch (e) { DEG.hit("server.js", e); }
};
function tailFile(f, n) {
  try {
    const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
    return lines.slice(-(n || 40)).join('\n');
  } catch (e) { return '（无日志或不可读）'; }
}

/* v1.75 存量回填：/api/new 这条路上建出来的世界，cardId 一直是空的（见下面的修复）。
   按「世界名 == 卡的 worldName」唯一匹配补上；匹配不唯一就不动（宁可不填，别挂错卡）。 */
function backfillCardIds() {
  try {
    const meta = loadMeta();
    const cards = meta.cards || [];
    let n = 0;
    for (const w of (meta.worlds || [])) {
      if (w.cardId) continue;
      const hit = cards.filter(c => c && c.worldName && c.worldName === w.name);
      if (hit.length === 1) { w.cardId = hit[0].id; n++; }
    }
    if (n) { saveMeta(meta); console.log('[world] 回填 cardId ' + n + ' 条'); }
  } catch (e) { DEG.hit("server.js", e); }
}
// ---------- 世界存取（多世界：meta.json 注册表 + worlds/<id>.json） ----------
function saveWorld(data, name) {
  const id = makeId('w');
  try { data.meta = data.meta || {}; data.meta.schema = SCHEMA; } catch (e) { DEG.hit("server.js", e); }   // v1.84：新档自带版本
  fs.mkdirSync(worldsDir(), { recursive: true });
  backfillCardIds();   // v1.75：老存档里「扫卡导入」出来的世界没挂卡，启动时补一次
  writeAtomic(worldFile(id), data);   // v1.98 P0-1：原子写（新建/导入世界）
  const meta = loadMeta();
  meta.worlds = meta.worlds || [];
  meta.worlds = meta.worlds.filter(w => w.id !== id);
  meta.worlds.push({
    id, name: name || (data.meta && data.meta.name) || '未名之地', era: (data.meta && data.meta.era) || '',
    saved: new Date().toISOString(),
    cardId: (data.meta && data.meta.cardId) || '',            // v1.49：这一局是从哪张卡开的
    worldT: (data.current && data.current.time) || '', turnN: (data.current && data.current.turnN) || 0
  });
  meta.current = id;
  saveMeta(meta);
  current = data; currentId = id;
  menuMode = false;
  return id;
}
/* v1.98 · P0-1：载入侧改成**能分辨故障**的读取（不存在 / 损坏 / 崩溃残骸可救 → store.loadWorldFile），
   返回 { ok, data } 或 { ok:false, why, msg }；调用方据此对玩家说人话。
   三处迁移回写全部走 writeAtomic —— 它们写的是**玩家正在打开的那一局**，比 persist 更不该坏。 */
function loadWorld(id) {
  const fp = worldFile(id);
  const lr = loadWorldFile(fp);
  if (!lr.ok) { GL('[world] 载入失败(' + lr.why + ')：' + lr.msg); return { ok: false, why: lr.why, msg: lr.msg }; }
  if (lr.recovered) GL('[world] ★ ' + lr.msg);
  try {
    const d = lr.data;
    if (reviveStaleRenders(d)) { try { writeAtomic(fp, d); GL('[img] 收尾了卡住的出图任务'); } catch (e0) { DEG.hit("server.js", e0); } }
    if (d) d.id = makeId; // JSON 序列化会丢函数，加载时补
    try { const n = G.mergeDupPersons(d); if (n > 0) { writeAtomic(fp, d); console.log('[world] 合并重复实体 ' + n + ' 个'); } } catch (e) { console.error('[merge]', e.message); }
    // 画指令打架修复：旧档残留的 AI 画/旧布局缓存一律作废（画=引擎程序大图唯一来源）
    try { if (d && d.current) { delete d.current.sceneArtAI; delete d.current.artCache; } } catch (e) { DEG.hit("server.js", e); }
    // v1.10：旧档补相册——手机工具/手机设备缺 album app → 补上（图库是磁盘持久化的） */
    try {
      for (const t of ((d.meta && d.meta.tools) || [])) {
        if (t && t.id === 'phone' && Array.isArray(t.apps) && t.apps.indexOf('album') < 0) t.apps.push('album');
      }
      if (d.current && d.current.device && Array.isArray(d.current.device.apps) && /手机|phone/.test(String(d.current.device.name || '')) && d.current.device.apps.indexOf('album') < 0) d.current.device.apps.push('album');
    } catch (e) { DEG.hit("server.js", e); }
    // v1.10：旧档九维迁移——老世界把九维文字塞在 profile.appearance.标志物（或 visual.anchor），
    // visual 缺失/无 nine 时解析迁移为九维档案（含分号/①②-⑧/维度名: 三种格式；解析不出则保留原样→生图走场景图降级）
    try {
      for (const id of Object.keys(d.entities || {})) {
        const ent = d.entities[id];
        if (!ent || ent.type !== 'person') continue;
        const prof = (ent.profile = ent.profile || {});
        const vis = (prof.visual = prof.visual || {});
        if (vis.nine && Object.keys(vis.nine).length >= 2) continue;
        const src = String(vis.anchor || (prof.appearance && prof.appearance.标志物) || '').slice(0, 600);
        const nine = VIS.parseNineDim(src);
        if (nine && Object.keys(nine).length >= 2) {
          vis.nine = nine;
          if (!vis.anchor) vis.anchor = src;
          console.log('[visual] 迁移九维: ' + id + ' → ' + Object.keys(nine).length + ' 维');
        }
        if (!vis.anchor && prof.appearance) vis.anchor = String(prof.appearance.标志物 || '').slice(0, 600);
      }
    } catch (e) { DEG.hit("server.js", e); }
    // v1.30：旧档印象迁移——扫描导入的世界**一条 impression 都没有**，于是 viewName 恒为 null，
    // packetFor 只好把真名喂给 AI（实测：AI 直接叫出玩家还不认识的人的名字）。这里按开场场景补一层：
    // 与玩家同场开局的人视为"见过面/打过交道"（stage 2 = 知道名字），不在场的保持未知。
    try {
      if (d && !d.impressions) d.impressions = {};
      const sid = d && d.current && d.current.sceneId;
      for (const id of Object.keys(d.entities || {})) {
        const ent = d.entities[id];
        if (!ent || ent.type !== 'person' || id === 'player') continue;
        if (d.impressions[id]) continue;
        const here = sid && ent.state && ent.state.location === sid;
        /* v2.06 修 P1-1 E7a：seen 原来是**布尔**（!!here），而读取侧（knowledge.js、lookOf）都按
       "看得见的样子"这个**字符串**用 —— String(true) 会得到「一个true的人」。今天不可达只是因为
       每回合开头 ensureImp 会把它重新播种成字符串；但类型错误不该靠"另一处会覆盖"来兜。 */
    d.impressions[id] = { stage: here ? 2 : 0, seen: here ? String(((ent.profile || {}).appearance || {}).标志物 || '') : '', traits: [], notes: [], bonds: [], nameKnown: here ? (ent.name || id) : null };
      }
      if (Object.keys(d.impressions).length) console.log('[impression] 迁移印象档: ' + Object.keys(d.impressions).length + ' 个');
    } catch (e) { DEG.hit("server.js", e); }
    // v1.7：旧档兼容——工具清单由载体推导（注册表）；v1.9：缺失随身设备→按载体补一个（手机/大哥大/无）
    try { if (d && d.meta && (!Array.isArray(d.meta.tools) || !d.meta.tools.length)) d.meta.tools = PRES.deriveTools(d.meta.carries || {}, d.meta.era || '', d.meta.name || ''); } catch (e) { DEG.hit("server.js", e); }
    try {
      if (d && d.current && !d.current.device) {
        const t = (d.meta && d.meta.tools) || [];
        const d1 = t.find(x => x.id === 'brick'), d2 = t.find(x => x.id === 'phone'), d3 = t.find(x => x.id === 'talisman');
        if (d1) d.current.device = { name: d1.name, icon: d1.icon, apps: d1.apps || ['sms', 'contacts'] };
        else if (d2) d.current.device = { name: d2.name, icon: d2.icon, apps: d2.apps || ['sms', 'contacts'] };
        else if (d3) d.current.device = { name: d3.name, icon: d3.icon, apps: d3.apps || ['sms', 'contacts'] };
      }
    } catch (e) { DEG.hit("server.js", e); }
    /* v1.84：迁移收口 —— 上面 8 段都是"字段缺失就补"的幂等补丁，现在给它们一个**版本边界**：
       旧档（无 meta.schema）补完后盖版本号、记一笔生成清单、并**落盘**（原来补完不落盘，
       下次打开又补一遍，且没人知道这档被迁移过）。 */
    try {
      const fromV = Number((d.meta && d.meta.schema) || 0);
      if (fromV < SCHEMA) {
        d.meta = d.meta || {};
        d.meta.schema = SCHEMA;
        try { require('./src/manifest').record(d, { kind: '迁移', id: 'schema', name: fromV + '→' + SCHEMA, schema: 'migrate.v1', by: 'engine', note: '旧档自动迁移：相册/九维/印象/随身设备/画缓存 补齐' }); } catch (e) { DEG.hit("server.js", e); }
        try { writeAtomic(fp, d); } catch (e) { DEG.hit("server.js", e); }
        GL('[world] 存档迁移 schema ' + fromV + ' → ' + SCHEMA + '（' + id + '）');
      }
    } catch (e) { DEG.hit("server.js", e); }
    /* v1.87：**载入即对账** —— 账本（可重放子集）与内存不一致时，按账本重建（确定性、0 token、留痕）。
       为什么放这儿：这是"实体状态 = 账本重放"这条不变量唯一有机会真正生效的地方。 */
    try {
      const RP = require('./src/replay');
      const c0 = RP.check(d);
      if (c0 && c0.ok === false) {
        const rb = RP.rebuild(d);
        GL('[world] ★ 账本对账不一致 → 已按账本重建 ' + JSON.stringify(rb.applied) + '（重建前：' + JSON.stringify(c0.diff) + '）');
        try { require('./src/manifest').record(d, { kind: '修复', id: 'replay', name: '按账本重建', schema: 'replay.rebuild.v1', by: 'engine', note: '账本与内存不一致：' + String((c0.diff || []).join('；')).slice(0, 80) }); } catch (e) { DEG.hit("server.js", e); }
        try { writeAtomic(fp, d); } catch (e) { DEG.hit("server.js", e); }
      }
    } catch (e) { DEG.hit("server.js", e); }
    return { ok: true, data: d, recovered: !!lr.recovered };
  } catch (e) { DEG.hit("server.js", e); return { ok: false, why: 'corrupt', msg: '载入世界时出错：' + String((e && e.message) || e) }; }
}
function unloadWorld() {
  current = null; currentId = null; menuMode = true;
}
// 按需调取的留痕（v1.55；给外部测试插件读，软件内不做界面）
function traceAppend() {
  try {
    if (!current || !current.trace || !current.trace.length) return;
    const dir = path.join(resBase(), 'data', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'trace.jsonl'), JSON.stringify(current.trace[current.trace.length - 1]) + String.fromCharCode(10));
  } catch (e) { DEG.hit("server.js", e); }
}
// ---------- 快照（v1.48）：AI 回复完之后自动存档；手动 15 位；自动 5 位环形 ----------
const SNAP = require('./src/snapshot');
function autoSnap() {
  try {
    if (!current || !currentId) return null;
    const rr = SNAP.take(current, currentId, 'auto');
    if (!rr || !rr.ok) console.error('[snapshot] ' + ((rr && rr.err) || '失败'));
    return rr;
  } catch (e) { console.error('[snapshot] ' + e.message); return null; }   // **绝不影响这一回合**
}

// 同步"这一局"在注册表里的信息（世界时间/回合/卡来源）——列表页不用逐个读世界文件
function touchMeta(d) {
  try {
    if (!d || !currentId) return;
    const meta = loadMeta();
    const w = (meta.worlds || []).find(x => x.id === currentId);
    if (!w) return;
    w.saved = new Date().toISOString();
    w.worldT = (d.current && d.current.time) || w.worldT || '';
    w.turnN = (d.current && d.current.turnN) || 0;
    if (d.meta && d.meta.cardId) w.cardId = d.meta.cardId;
    if (d.meta && d.meta.name) w.name = w.name || d.meta.name;
    saveMeta(meta);
  } catch (e) { /* 列表信息过期不影响玩 */ }
}
// 老档回填：以前的世界没记 cardId —— 按 meta.importSource 与卡名对一次（对不上就算"无卡局"）
function backfillCardLinks() {
  try {
    const meta = loadMeta();
    const cards = meta.cards || [];
    let n = 0;
    for (const w of (meta.worlds || [])) {
      if (w.cardId) continue;
      let src = '';
      try { const j = JSON.parse(fs.readFileSync(worldFile(w.id), 'utf8')); src = (j.meta && j.meta.importSource) || ''; } catch (e) { continue; }
      if (!src) continue;
      const hit = cards.find(c => (c.name || '') === src) || cards.find(c => (c.name || '') && (c.name.indexOf(src) >= 0 || src.indexOf(c.name) >= 0));
      if (hit) { w.cardId = hit.id; n++; }
    }
    if (n) saveMeta(meta);
    return n;
  } catch (e) { return 0; }
}

function persist() {
  if (!current || !currentId) return;
  /* v1.98 · P0-1：主存档全量写 —— 全项目最该原子的一处（半份 JSON = 丢一局）。
     写失败**不许把这一回合赔进去**：进程不退、内存里的世界照常可玩，但必须留痕（可查）。 */
  try { writeAtomic(worldFile(currentId), current); }
  catch (e) { console.error('[persist]', e.message); DEG.hit('server.js', e); GL('[persist] ★ 写盘失败（这一回合仍在内存里，没落盘）：' + e.message); }
  touchMeta(current);
}

// 玩家自我设定（User 卡）落进世界数据：档案 + 冲突裁决写入世界规则（20.1/20.2）
function applySelfToData(data, us, setup) {
  if (!us || !data || !data.entities || !data.entities.player) return;
  const p = data.entities.player;
  const prof = p.profile || (p.profile = {});
  prof.identity = prof.identity || {}; prof.appearance = prof.appearance || {}; prof.surface = prof.surface || {};
  prof.background = prof.background || {}; prof.desires = prof.desires || {}; prof.secrets = prof.secrets || {};
  const fields = {
    name: (v) => { if (v) p.name = String(v).slice(0, 20); if (String(v)) prof.identity.姓名 = String(v).slice(0, 20); },
    age: (v) => { if (String(v)) prof.identity.年龄 = String(v).slice(0, 10); },
    identity: (v) => { if (String(v)) prof.identity.身份 = String(v).slice(0, 40); },
    role: (v) => { if (String(v)) prof.identity.职业 = String(v).slice(0, 30); },
    appearance: (v) => { if (String(v)) prof.appearance.标志物 = String(v).slice(0, 40); },
    backstory: (v) => { if (String(v)) prof.background.经历 = String(v).slice(0, 300); },
    secret: (v) => { if (String(v)) prof.secrets.包袱 = String(v).slice(0, 120); },
    ability: (v) => { if (String(v)) prof.surface.能力 = String(v).slice(0, 80); },
    attitude: (v) => { if (String(v)) prof.surface.待人 = String(v).slice(0, 30); },
    desire: (v) => { if (String(v)) prof.desires.现在想 = String(v).slice(0, 60); }
  };
  for (const k of Object.keys(fields)) {
    if (us[k] == null) continue;
    const v = String(us[k] || '').trim();
    if (!v || /按设定来|^待定$|待补充/.test(v)) continue; // 占位废话不写
    fields[k](v); // 优先级：UI设定 > 角色卡 > 世界规则补全——你填的你最大
  }
  // 冲突裁决：世界规则新增条目，供主 AI 引用（以世界为准）
  const severities = (setup && setup.issues) || [];
  const conflicted = severities.filter(i => i.verdict === '冲突').map(i => i.point + '：' + i.advice);
  const bridged = severities.filter(i => i.verdict === '需补桥').map(i => i.point + '：' + i.advice);
  const rules = data.meta.rules || (data.meta.rules = []);
  for (const c of conflicted) if (!rules.some(x => x.indexOf(c.slice(0, 20)) >= 0)) rules.push('【玩家设定裁决】' + c);
  for (const b of bridged) if (!rules.some(x => x.indexOf(b.slice(0, 20)) >= 0)) rules.push('【玩家设定桥】' + b);
  data.meta.self = { fields: Object.keys(fields).filter(k => us[k] != null), setup: setup || null };
}

// ---------- 工具 ----------

// ---------- 生图客户端（B 步核心：ComfyUI 通用适配 + 队列 + 图库） ----------
const __imgQ = [];
let __imgBusy = false;
// 画风预设（ZIT 模式前置；anime 模式不自动应用——中文预设对英文模型无效）
const STYLE_PRESETS = {
  '': '',
  '柯达金200胶片质感，暖黄色调，细腻胶片颗粒，复古写实质感': '柯达金200胶片质感，暖黄色调，细腻胶片颗粒，复古写实质感',
  '水墨写意画，宣纸质感，墨色浓淡晕染，大面积留白，东方写意意境': '水墨写意画，宣纸质感，墨色浓淡晕染，大面积留白，东方写意意境',
  '水彩画风格，半透明叠色水痕，水彩纸纹理，自然晕染过渡': '水彩画风格，半透明叠色水痕，水彩纸纹理，自然晕染过渡',
  '日系柔和色调，低对比，胶片颗粒细，空气感通透': '日系柔和色调，低对比，胶片颗粒细，空气感通透',
  '冷调赛博风，霓虹蓝紫，金属反光，颗粒感': '冷调赛博风，霓虹蓝紫，金属反光，颗粒感',
  '深色电影质感，暗部饱满，侧逆光，戏剧性氛围': '深色电影质感，暗部饱满，侧逆光，戏剧性氛围'
};
// anime/anime_tag：清掉中文（英文模型不认）；删空则保留原文（防空提示词）
function cleanAnimePrompt(p) {
  const out = String(p || '').replace(/[\u4e00-\u9fff，。！？；：、（）【】“”‘’·]+/g, '').replace(/\s{2,}/g, ' ').trim();
  return out;
}
// 角色名过滤（最后防线）：LLM 偶发把名字写进提示词 / note 里带名字 → 生图模型瞎画
function stripCharacterNames(prompt, names) {
  let p = String(prompt || '');
  for (const nm of (names || [])) {
    if (!nm || nm.length < 2 || /^[a-z]+\d+$/.test(nm)) continue;
    try { p = p.split(nm).join(''); } catch (e) { DEG.hit("server.js", e); }
  }
  p = p.replace(/[，,]{2,}/g, '，').replace(/[，,]\s*$/g, '').replace(/\s{2,}/g, ' ').trim();
  return p;
}
// 提示词→图缓存（同提示词不再重画：效率 + 一致性；key=sha1(最终提示词)）
function promptCacheDir() { return path.join(resBase(), 'data', 'gallery', (currentId || 'none'), 'cache'); }
function promptCacheGet(h) {
  try { const f = path.join(promptCacheDir(), h + '.json'); if (fs.existsSync(f)) { const j = JSON.parse(fs.readFileSync(f, 'utf8')); if (j && j.id && fs.existsSync(path.join(path.join(resBase(), 'data', 'gallery', (currentId || 'none')), j.id + '.png'))) return j.id; } } catch (e) { DEG.hit("server.js", e); }
  return null;
}
function promptCacheSet(h, id) {
  try { fs.mkdirSync(promptCacheDir(), { recursive: true }); fs.writeFileSync(path.join(promptCacheDir(), h + '.json'), JSON.stringify({ id: id })); } catch (e) { DEG.hit("server.js", e); }
}
function sha1(s) { const c = require('node:crypto').createHash('sha1'); c.update(String(s || '')); return c.digest('hex'); }
function galleryDir() { return path.join(resBase(), 'data', 'gallery', (currentId || 'none')); }
function galleryRoot() { return path.join(resBase(), 'data', 'gallery'); }
/* v1.74 占用盘点与清理（用户：「删除世界的时候问需不需要把那些一起删了」）
   为什么要问：删世界只删世界本体，快照（撤销点）和画面（图）都留着 ——
   留着有留着的道理（快照能救回被删的世界），但**得让玩家知道还剩什么、占多少**。 */
function dirFootprint(dir) {
  let n = 0, bytes = 0;
  const walk = (d) => {
    let names = [];
    try { names = fs.readdirSync(d); } catch (e) { return; }
    for (const f of names) {
      /* v1.98 P0-1：`.tmp` 是原子写的中间态（正常情况下 rename 之后就不该存在），
         **不算占用**：它是"正在写的那一下"，不是玩家存下来的东西。
         玩家看到的体积因此与"删掉能省多少"一致（残留的 .tmp 会在下一次写入时被覆盖）。 */
      if (/\.tmp$/.test(f)) continue;
      const p = path.join(d, f);
      try { const st = fs.statSync(p); if (st.isDirectory()) walk(p); else { n++; bytes += st.size; } } catch (e) { DEG.hit("server.js", e); }
    }
  };
  walk(dir);
  return { n: n, bytes: bytes };
}
function worldFootprint(id) {
  const s = dirFootprint(SNAP.snapDir(id));
  const g = dirFootprint(path.join(galleryRoot(), id));
  return { snapN: s.n, snapBytes: s.bytes, imgN: g.n, imgBytes: g.bytes };
}
function orphanFootprint() {
  const live = new Set((loadMeta().worlds || []).map(w => w.id));
  let worlds = 0, n = 0, bytes = 0;
  const scan = (base) => {
    let names = [];
    try { names = fs.readdirSync(base); } catch (e) { return; }
    for (const id of names) {
      if (id === 'cache' || live.has(id)) continue;
      const p = path.join(base, id);
      try { if (!fs.statSync(p).isDirectory()) continue; } catch (e) { continue; }
      const f = dirFootprint(p); worlds++; n += f.n; bytes += f.bytes;
    }
  };
  scan(SNAP.rootDir());
  scan(galleryRoot());
  return { worlds: worlds, n: n, bytes: bytes };
}
function rmDirIfAny(dir) {
  try { if (!fs.existsSync(dir)) return false; fs.rmSync(dir, { recursive: true, force: true }); return true; } catch (e) { return false; }
}
function cleanOrphans() {
  const live = new Set((loadMeta().worlds || []).map(w => w.id));
  let gone = 0;
  const scan = (base) => {
    let names = [];
    try { names = fs.readdirSync(base); } catch (e) { return; }
    for (const id of names) {
      if (id === 'cache' || live.has(id)) continue;
      const p = path.join(base, id);
      try { if (!fs.statSync(p).isDirectory()) continue; } catch (e) { continue; }
      if (rmDirIfAny(p)) gone++;
    }
  };
  scan(SNAP.rootDir());
  scan(galleryRoot());
  return gone;
}
function galleryRec(id) {
  const f = path.join(galleryDir(), 'gallery.json');
  try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); return (j.list || []).find(x => x.id === id) || null; } catch (e) { return null; }
}
/* v1.65b 把图**盖在**对应的 beat 条目上（出图落库时就定死）。
   为什么：原来只在**查看时**用 data.current._imgBeatSpan 推算，而 span 每回合被覆盖 →
   过了这一回合，历史里的图就全掉了（用户：「聊天里没有」）。盖上去之后图跟着剧情永久留存。 */
function stampImgOnBeat(task) {
  try {
    if (!current || !task) return;
    /* v1.83 修 P1-5：优先用派发时钉死的**绝对下标**。原来只按"出图那一刻的 _imgBeatSpan"推算，
       而 span 每回合都被覆盖 —— 图几分钟后才回来时会被盖到**后面某一回合**的条目上。 */
    const span = current.current && current.current._imgBeatSpan;
    let abs = null;
    if (task.absAt != null) abs = Number(task.absAt);
    else if (span && task.at != null) abs = span.start + Number(task.at);
    if (abs == null) return;
    const l = (current.sceneLog || [])[abs];
    if (!l) return;
    l.imgs = l.imgs || [];
    if (l.imgs.indexOf(task.id) < 0) l.imgs.push(task.id);
    persist();
  } catch (e) { DEG.hit("server.js", e); }
}
function gallerySave(rec) {
  try {
    writeAtomic(path.join(galleryDir(), rec.id + '.png'), rec.buf);   // v1.98 P0-1：半张图比半份 JSON 更常见
    delete rec.buf;
    const f = path.join(galleryDir(), 'gallery.json');
    let j = { list: [] };
    try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { DEG.hit("server.js", e); }
    j.list = (j.list || []).filter(x => x.id !== rec.id);
    j.list.push(rec);
    if (j.list.length > 400) j.list = j.list.slice(-400);
    writeAtomic(f, j);
  } catch (e) { console.error('[gallery]', e.message); }
}
// 工作流归一：ComfyUI UI 格式（{nodes:[...],links:[...]}）→ API 格式（{id:{class_type,inputs}}）
// links 行格式：[link_id, from_node, from_slot, to_node, to_slot, type]——必须解析成 [fromNodeId, fromSlot] 才能连通图链
function wfToApi(wf) {
  if (!wf || !Array.isArray(wf.nodes)) return null;
  const linksMap = {};
  for (const l of (wf.links || [])) { if (Array.isArray(l) && l.length >= 3) linksMap[l[0]] = [String(l[1]), Number(l[2])]; }
  const api = {};
  for (const n of wf.nodes) {
    if (!n || n.id == null) continue;
    const inputs = {};
    const wid = (n.widgets_values || []);
    let wi = 0;
    for (const inp of (n.inputs || [])) {
      if (!inp || !inp.name) continue;
      if (inp.widget && wi < wid.length) { inputs[inp.name] = wid[wi]; wi++; }
      else if (inp.link != null && linksMap[inp.link]) { inputs[inp.name] = linksMap[inp.link]; }
      else if (inp.link != null) { continue; }
    }
    // widget 节点（如 CLIPTextEncode 的 text 在 widgets_values 而非 inputs）
    const isTextNode = /CLIPTextEncode/i.test(String(n.type || '')) && !inputs.text;
    if (isTextNode && wid.length) inputs.text = String(wid[0]);
    api[n.id] = { class_type: String(n.type || ''), inputs };
  }
  return Object.keys(api).length ? api : null;
}
// 通用工作流注入：① %prompt% / %negative_prompt% 占位符 → 字符串替换（保留用户其余写法）
// ② 无占位符 → 自动找正向文本节点覆盖（跳过含 %negative_prompt% 的双 CLIP 负面结构）；兼容 UI/API 两种格式
// ③ 随机 seed：ksampler/seed/noise_seed → Math.random（同提示词每次出图不同）④ 负面提示词 cfg.image.neg
/* v1.63 尺寸注入（设计总稿 §27）：人像 768×768 / 其他 1280×720（可调）。
   规则：凡是**同时**带 width 与 height 数字输入的节点都改（EmptyLatentImage / ImageScale / LatentUpscale…），
   链尾那个说了算；这样"工作流里写死多大"不再是唯一结果。 */
let __lastSizeHit = 0;
let __lastSizeFactor = 1;
function applySize(wf, size) {
  __lastSizeHit = 0; __lastSizeFactor = 1;
  if (!wf || typeof wf !== 'object' || !size || !(size.w > 0) || !(size.h > 0)) return wf;
  /* ① 放大倍数：从 UpscaleModelLoader 的模型名读（"2xNomosUni…" → 2；读不到当 1）。
     为什么要它：工作流里带放大模型时，**最终尺寸 = 潜空间尺寸 × 倍数**（实测你这套：1280×720 → 2560×1440，2×）。
     所以潜空间要按 目标÷倍数 设，放大模型才**真的用上**（640×360 --2x--> 1280×720），而不是先放大再缩回去。 */
  for (const k of Object.keys(wf)) {
    const n0 = wf[k];
    if (!n0 || !n0.inputs || !/UpscaleModelLoader/i.test(String(n0.class_type || ''))) continue;
    const m = /(\d+(?:\.\d+)?)\s*x/i.exec(String(n0.inputs.model_name || ''));
    if (m && Number(m[1]) > 0) { __lastSizeFactor = Number(m[1]); break; }
  }
  const f = __lastSizeFactor > 0 ? __lastSizeFactor : 1;
  const lw = Math.max(64, Math.round(size.w / f / 8) * 8);   // 潜空间尺寸 8 对齐（否则部分模型报错）
  const lh = Math.max(64, Math.round(size.h / f / 8) * 8);
  for (const k of Object.keys(wf)) {
    const n = wf[k];
    if (!n || typeof n !== 'object' || !n.inputs) continue;
    if (typeof n.inputs.width === 'number' && typeof n.inputs.height === 'number') {
      n.inputs.width = lw; n.inputs.height = lh; __lastSizeHit++;
    }
  }
  /* ② 链尾兜底：工作流里只要有**放大节点**（ImageUpscaleWithModel / LatentUpscale / UpscaleModel…），
     出来的图就是"潜空间尺寸 × 放大倍数"——1280×720 会变成 5120×2880 那种。
     所以直接在 SaveImage 前插一个 ImageScale，把**最终尺寸**钉死成用户设的值（无论中间放大多少倍）。 */
  const saveId = Object.keys(wf).find(k => /^SaveImage$/i.test(String((wf[k] || {}).class_type || '')));
  if (saveId && wf[saveId].inputs && Array.isArray(wf[saveId].inputs.images)) {
    const src = wf[saveId].inputs.images;
    const fid = 'fit_final_size';
    if (!wf[fid]) {
      wf[fid] = { class_type: 'ImageScale', inputs: { image: src, upscale_method: 'lanczos', width: Math.round(size.w), height: Math.round(size.h), crop: 'disabled' } };
      wf[saveId].inputs.images = [fid, 0];
      __lastSizeHit++;
    }
  }
  return wf;
}
// 任务尺寸：立绘走人像档，其余走场景档
function sizeFor(task) {
  const ic = (cfg && cfg.image) || {};
  const isP = !!(task && task.kind === 'portrait');
  const d = (isP ? (ic.sizePortrait || {}) : (ic.sizeScene || {})) || {};
  const dw = isP ? 768 : 1280, dh = isP ? 768 : 720;
  const w = Math.max(64, Math.min(4096, Math.round(Number(d.w) || dw)));
  const h = Math.max(64, Math.min(4096, Math.round(Number(d.h) || dh)));
  return { w: w, h: h };
}
function wfInject(wf, prompt, neg, size) {
  if (!wf || typeof wf !== 'object') return null;
  let raw = JSON.stringify(wf);
  if (raw.indexOf('%prompt%') >= 0 || raw.indexOf('%negative_prompt%') >= 0) {
    raw = raw.split('%prompt%').join(String(prompt || '').slice(0, 1500));
    raw = raw.split('%negative_prompt%').join(String(neg || '').slice(0, 500));
    try { const j = JSON.parse(raw); if (j) return applySize(j, size); } catch (e) { DEG.hit("server.js", e); }
  }
  if (Array.isArray(wf.nodes)) wf = wfToApi(wf);
  if (!wf) return null;
  let hit = 0;
  for (const k of Object.keys(wf)) {
    const n = wf[k];
    if (!n || typeof n !== 'object') continue;
    const t = String(n.class_type || '');
    if (t.indexOf('CLIPTextEncode') >= 0 && n.inputs) {
      const cur = String((n.inputs.text || n.inputs.clip_l || n.inputs.t5xxl || '') || '');
      if (cur.indexOf('%negative_prompt%') >= 0) {
        if (neg) { for (const ik of Object.keys(n.inputs)) if (/text|clip_l|t5xxl/i.test(ik)) n.inputs[ik] = String(n.inputs[ik]).split('%negative_prompt%').join(neg).slice(0, 500); }
        continue;
      }
      // 是负面节点（key 带 negative）：无占位时注入 neg
      let isNegKey = false;
      for (const ik of Object.keys(n.inputs)) if (/negative/i.test(ik)) { isNegKey = true; break; }
      if (isNegKey && neg) { n.inputs.text = neg; hit++; continue; }
      n.inputs.text = prompt; hit++;
      continue;
    }
    if (n.inputs && typeof n.inputs.text === 'string' && /prompt|text|clip|encode/i.test(t)) {
      const cur2 = String(n.inputs.text || '');
      if (cur2.indexOf('%negative_prompt%') >= 0) { if (neg) n.inputs.text = cur2.split('%negative_prompt%').join(neg); continue; }
      n.inputs.text = prompt; hit++;
    }
  }
  // 随机 seed（每次出图不同）
  for (const k of Object.keys(wf)) {
    const n = wf[k];
    if (!n || !n.inputs) continue;
    if (/ksampler|sampler/i.test(String(n.class_type || '')) && !/scheduler|schedule|upscale/i.test(String(n.class_type || ''))) {
      for (const ik of Object.keys(n.inputs)) {
        if (/seed|noise_seed/i.test(ik)) n.inputs[ik] = Math.floor(Math.random() * 1000000000000000);
      }
    }
  }
  if (!hit) return null;
  return applySize(wf, size);
}
// 最终提示词组装：包装残留清洗 + 前置(pPrefix) + 画风(zit)/质量前缀+艺术家(anime) + anime 中文清空 + 角色名过滤
function buildFinalPrompt(task, names) {
  const ic = (cfg && cfg.image) || {};
  const mode = String(task.mode || ic.mode || 'zit');
  let p = String(task.prompt || '').trim();
  if (!p) return '';
  p = p.replace(/\[image:[^\]]*\]/g, '').replace(/【提示词[】:：]*/g, '').replace(/【\/提示词】/g, '').replace(/【\s*💬[^\n]*/g, '').replace(/\n\s*【[^】]*】/g, '\n').trim();
  if (ic.pPrefix) p = ic.pPrefix + ', ' + p;
  if (mode === 'zit' || !mode) {
    const st = (ic.style && STYLE_PRESETS[ic.style]) ? STYLE_PRESETS[ic.style] : '';
    if (st) p = st + ' ' + p;
    if (ic.neg) p = p; // 负面词走工作流 %negative_prompt%/negative 节点
  } else {
    if (ic.qPrefix) p = ic.qPrefix + ', ' + p;
    if (ic.artist) p = p + ', ' + ic.artist;
    const cl = cleanAnimePrompt(p);
    if (cl) p = cl;
  }
  p = stripCharacterNames(p, names);
  return String(p).slice(0, 1500);
}
// 队列：满员时排队（前端请求挂起等待，完成后返回）——渲染串行，ComfyUI 不吃并发生图
function queueRender(run) {
  // v1.79 看门狗：万一还是卡住了（比如 fetch 超时没生效），5 分钟后强制解锁队列，不让它永久堵死
  try {
    if (__imgBusy && __imgBusySince && (Date.now() - __imgBusySince > 300000)) {
      GL('[img] ⚠ 出图队列卡了 ' + Math.round((Date.now() - __imgBusySince) / 1000) + ' 秒，强制解锁');
      __imgBusy = false;
      if (current && current.current && current.current.imgTasks) {
        for (const x of current.current.imgTasks) if (x && x.status === 'rendering') { x.status = 'fail'; x.err = '出图卡住（已超时解锁）—— 点 🔁 重试'; }
        try { persist(); } catch (e) { DEG.hit("server.js", e); }
      }
    }
  } catch (e) { DEG.hit("server.js", e); }
  return new Promise((resolve, reject) => {
    const job = async () => {
      __imgBusy = true; __imgBusySince = Date.now();
      try { await run(); } catch (e) { /* run 内部已回 onState */ } finally {
        __imgBusy = false;
        const nx = __imgQ.shift();
        if (nx) nx();
        /* v1.83 修 P0-1：这里原来**从不调用 resolve** —— 返回的 Promise 永不 settle，
           而两个调用点都是 `await queueRender(...)` 之后才写响应 ⇒ /api/comfy/render 与
           /api/comfy/person **永远不回包**；前端 autoRender 的 finally 因此永不执行，
           __rendering 永久为 true，自动出图一次会话后就停摆。 */
        resolve();
      }
    };
    if (__imgBusy) { __imgQ.push(job); return; }
    job();
  });
}
/* v1.79 出图前预检：ComfyUI 没开就**立刻失败**，别让界面挂着「生成中」等两分钟。
   用户实测：「我刚刚忘了开 comfyui，现在估计一直卡请求了（生成中）」。 */
/* v1.79 带超时的 fetch：ComfyUI 半死（连上了但不回）时，原来这三个 fetch 会**永远挂着** →
   __imgBusy 永远是 true → 后面所有出图全排在队列里 → 界面永远「生成中」。 */
async function fetchT(url, opt, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 20000);
  try { return await fetch(url, Object.assign({}, opt || {}, { signal: ctrl.signal })); }
  finally { clearTimeout(t); }
}
async function comfyAlive(base) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3000);
  try { const r = await fetch(base + '/system_stats', { signal: ctrl.signal }); return !!r.ok; }
  catch (e) { return false; }
  finally { clearTimeout(t); }
}
/* v1.79 「出图中」只属于**当前这个进程**。软件一重启/请求一中断，任务就永远停在 rendering ——
   没有任何代码会收尾。载入世界时清一次，标成 fail（可以重试）。 */
function reviveStaleRenders(data) {
  try {
    const t = (data && data.current && data.current.imgTasks) || [];
    let n = 0;
    for (const x of t) if (x && x.status === 'rendering') { x.status = 'fail'; x.err = '上次出图没跑完（软件重启或请求中断）—— 点 🔁 重试'; n++; }
    return n;
  } catch (e) { return 0; }
}
async function comfyRender(task, onState) {
  const im = task || {};
  const base = String((cfg.image && cfg.image.base) || '').replace(/\/$/, '');
  const wfRaw = (cfg.image && cfg.image.workflowJson) || '';
  if (!base) { onState && onState('fail', '未配置 ComfyUI 地址'); return null; }
  if (!(await comfyAlive(base))) { onState && onState('fail', '连不上 ComfyUI（' + base + '）—— 它没开吗？开好再点重试。'); return null; }
  if (!wfRaw) { onState && onState('fail', '未导入工作流（服务器当前 image 配置：enabled=' + (cfg.image && cfg.image.enabled) + ' base=' + (cfg.image && cfg.image.base) + ' workflow=' + (cfg.image && cfg.image.workflow) + ' len=' + String(wfRaw).length + '）——请在设置→生图→导入工作流，导入即生效'); return null; }
  let wf = null;
  try { wf = JSON.parse(wfRaw); } catch (e) { onState && onState('fail', '工作流 JSON 损坏'); return null; }
  const names = (im.who || []).map(id => { try { const e = (current && current.entities && current.entities[id]) || {}; return e.name || id; } catch (e2) { return id; } });
  const prm = buildFinalPrompt(im, names);
  if (!prm) { onState && onState('fail', '无提示词（关闭了AI润色时应由规则装配，检查任务数据）'); return null; }
  // 提示词→图缓存：同提示词直接复用（不重画：效率与一致性）
  const sz = sizeFor(im);                                        // v1.63 §27 尺寸
  const h = sha1(prm + '@' + sz.w + 'x' + sz.h);                 // 尺寸进缓存键（同词不同尺寸不能复用）
  try {
    const cachedId = promptCacheGet(h);
    if (cachedId) {
      const buf = fs.readFileSync(path.join(galleryDir(), cachedId + '.png'));
      onState && onState('done', null, buf, prm);
      return { id: cachedId, buf, cached: true, prompt: prm };
    }
  } catch (e) { DEG.hit("server.js", e); }
  wf = wfInject(wf, prm, (cfg.image && cfg.image.neg) || '', sz);
  if (!wf) { onState && onState('fail', '工作流中未找到文生图文本节点'); return null; }
  GL('[img] 尺寸 ' + sz.w + 'x' + sz.h + '（' + (im.kind === 'portrait' ? '立绘' : '场景') + '）· 放大 ' + __lastSizeFactor + 'x · 宽高节点 ' + __lastSizeHit + ' 个 · 队列 ' + __imgQ.length);
  try {
    const pr = await fetchT(base + '/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: wf }) }, 30000);   // v1.79 超时，别永久挂住队列
    if (!pr.ok) { onState && onState('fail', '提交失败 HTTP ' + pr.status); return null; }
    const pj = await pr.json();
    const pid = pj.prompt_id;
    if (!pid) { onState && onState('fail', '无 prompt_id'); return null; }
    for (let i = 0; i < 60; i++) {
      await new Promise(rs => setTimeout(rs, 2000));
      try {
        const hres = await fetchT(base + '/history/' + pid, null, 10000);
        const hj = await hres.json();
        const entry = hj[pid];
        // ComfyUI 执行错误：直接把服务端报错捞出来（界面红字）
        if (entry && entry.status && entry.status.status_str === 'completed' && (!entry.outputs || !Object.keys(entry.outputs).length)) {
          onState && onState('fail', '工作流空转（执行完成但无图片输出）：导入的工作流可能没连成形或缺少 SaveImage 节点——请用 ComfyUI 的「Save (API Format)」导出后重新导入'); return null;
        }
        if (entry && entry.status && entry.status.status_str === 'error') {
          let msg = '';
          try { const msgs = entry.messages || []; msg = msgs.filter(m => m[0] === 'execution_error').map(m => JSON.stringify(m[1] || {}).slice(0, 500)).join('；'); } catch (e2) { DEG.hit("server.js", e2); }
          onState && onState('fail', 'ComfyUI 执行出错：' + (msg || '（见 ComfyUI 界面红色错误）'));
          return null;
        }
        if (entry && entry.outputs) {
          for (const nid of Object.keys(entry.outputs)) {
            const imgs = (entry.outputs[nid].images) || [];
            if (imgs.length) {
              const img0 = imgs[0];
              const q = 'filename=' + encodeURIComponent(img0.filename) + '&subfolder=' + encodeURIComponent(img0.subfolder || '') + '&type=' + encodeURIComponent(img0.type || 'output');
              const ir = await fetchT(base + '/view?' + q, null, 30000);
              if (ir.ok) {
                const buf = Buffer.from(await ir.arrayBuffer());
                const gid = (im.id || ('g' + Date.now().toString(36)));
                try { promptCacheSet(h, gid); } catch (e) { DEG.hit("server.js", e); }
                onState && onState('done', null, buf, prm);
                return { id: gid, buf, prompt: prm };
              }
            }
          }
          break;
        }
      } catch (e) { DEG.hit("server.js", e); }
    }
    onState && onState('fail', '渲染超时（ComfyUI 未出图）');
    return null;
  } catch (e) { onState && onState('fail', String(e.message || e)); return null; }
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.ico': 'image/x-icon', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
async function body(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', c => { b += c; });
    req.on('end', () => resolve(b));
    req.on('error', reject);
  });
}
function configView() {
  return { baseURL: (cfg.llm && cfg.llm.baseURL) || '', apiKey: (cfg.llm && cfg.llm.apiKey) || '', model: (cfg.llm && cfg.llm.model) || '', port: cfg.port || 3088, maxTokens: (cfg.llm && cfg.llm.maxTokens) || 32768, timeoutMs: (cfg.llm && cfg.llm.timeoutMs) || 900000,   // v1.83 修 P1-7：原来漏了这个键，前端永远显示 90000 并在下次保存时把用户设定冲掉
    playerName: cfg.playerName || '你', msgModel: (cfg.roles && cfg.roles.msg && cfg.roles.msg.model) || '', userSelf: cfg.userSelf || {}, image: cfg.image || { enabled: false, base: '', workflow: '', mode: 'zit' } };
}
function packPreview(pack, mode) {
  const pk = pack || {};
  // 开场池：备选开局在前（最多 4 条），主开场在最后；openings = 池长，openingList = 预览展示（与 packToData 的 greeting 下标一致）
  const pool = ((Array.isArray(pk.alternates) ? pk.alternates : []).slice(0, 4)).map(a => String(a || '').slice(0, 200))
    .concat([String(pk.firstScene || '').slice(0, 400)]);
  return {
    name: (pk.meta && pk.meta.name) || '未名之地',
    era: (pk.meta && pk.meta.era) || '时代未知',
    weather: pk.weather || '',
    firstScene: String(pk.firstScene || '').slice(0, 400),
    npcs: (pk.npcs || []).map(n => (n && n.name) || '？'),
    places: (pk.places || []).map(x => (x && x.name) || '？'),
    openingList: pool,
    openings: pool.length,
    filledN: (Array.isArray(pk.filled) ? pk.filled.length : 0),        // v1.70：卡里没写、AI 补的
    conflictsN: (Array.isArray(pk.conflicts) ? pk.conflicts.length : 0),  // v1.70：卡里自相矛盾、AI 裁的
    filledList: (Array.isArray(pk.filled) ? pk.filled : []).slice(0, 8).map(x => String((x && (x.what || x)) || '').slice(0, 60)),
    mode: mode || (pk.__mode || 'llm')
  };
}

// ---------- HTTP ----------
const server = http.createServer(async (req, res) => {
  /* v1.98：`u` 原来只在 try 里声明，而 catch 里引用 `u.pathname` ⇒ 任何异常都会让 catch 自己再抛一个
     ReferenceError（500 反而没回包、也没留痕，请求挂到超时）。这里用一个块外变量兜住。 */
  let uPath = String(req.url || '');
  let __lockEnt = null;
  try {
    const u = new URL(req.url, 'http://x');
    uPath = u.pathname;
    // ---------- GET API ----------
    if (req.method === 'GET' && u.pathname.startsWith('/api/')) {
      if (u.pathname === '/api/state') {
        /* v1.98 · P0-2：GET 也会写盘（自愈）—— 这是评审里最隐蔽的一条写路径。
           它**不能拒绝**（前端 api() 见到 err 就 throw，界面会断），所以它用 tryHold：
           拿不到锁就**跳过自愈**，只回视图（内存里的 current 本来就是最新的，buildView 不依赖落盘）。 */
        const __hh = WL.tryHold('GET /api/state 自愈');
        try { if (__hh && current && !__imgBusy && reviveStaleRenders(current)) { persist(); GL('[img] 收尾了卡住的出图任务（state 自愈）'); } } catch (e0) { DEG.hit("server.js", e0); } finally { WL.release(__hh); }
        GL('api state (tick=' + new Date().getTime() + ')');
        if (menuMode || !current) return json(res, 200, { noWorld: true, mode: AI.isLive(cfg) ? 'live' : 'demo', config: configView(), currentWorld: (current && current.meta && current.meta.name) || null });
        const view = G.buildView(current);
        view.config = configView();
        /* v1.98 · P0-2：「世界正忙」是**世界的状态**，该由服务端说，不是前端用一个 let busy 猜
           （项目的硬分界：UI 不持有世界真相）。外挂在 view 上而不是 buildView 里 ——
           后者会牵动 ui-shell/ui-loop/contract 一串"视图字段"断言，且它不是世界的持久字段。
           前端已有的 2 秒轮询会自动把它同步到界面（不需要新增轮询）。 */
        view.busy = WL.peek();
        return json(res, 200, view);
      }
      if (u.pathname === '/api/version') return json(res, 200, { build: BUILD, appDir: ASSETS, ok: true });
      /* v1.86：**开发者视图的独立出口**（框架档位与词汇 / 生成清单 / AI 计量 / 来源卡信息 / 降级计数）。
         世界视图 /api/state 默认**不含**这些字段 —— 见 game.js 的 DEV_KEYS 注释与 catworld-ui 越权红线 4。 */
      /* v1.98 · P0-3：归档**可回读**。留存策略把超出上限的老数据追加落盘到
         data/retention/<kind>.jsonl —— 在那之前没有任何入口能把它取回来，"永不删"就只是措辞。
         这是只读诊断入口（GET、不碰世界、不上玩家界面）：?kind=ledger&n=200 */
      if (u.pathname === '/api/retention/read') {
        const kind = String(u.searchParams.get('kind') || 'ledger');
        const n = Number(u.searchParams.get('n') || 0) || 0;
        const r0 = RET.read(kind, { n: n });
        return json(res, 200, { ok: true, kind: r0.kind, n: r0.rows.length, bad: r0.bad, rows: r0.rows.slice(-2000) });
      }
      if (u.pathname === '/api/dev') {
        if (!current) return json(res, 200, { ok: false, err: '未进入世界' });
        return json(res, 200, Object.assign({ ok: true }, G.buildDevView(current)));
      }
      if (u.pathname === '/api/snapshots') {
        // 快照列表（v1.48）：5 个自动位 + 15 个手动位
        const l = currentId ? SNAP.list(currentId) : [];
        const pre = currentId ? SNAP.readPreRestore(currentId) : { ok: false };
        return json(res, 200, { ok: true, auto: SNAP.AUTO_SLOTS, manual: SNAP.MANUAL_SLOTS, list: l, pre: pre.ok ? pre.snap : null, hasPre: !!pre.ok });
      }
      if (u.pathname === '/api/worlds') {
        // v1.49：每局带上它的卡（卡名解析好，界面直接按「卡 → 局」分组）
        const meta = loadMeta();
        const cards = meta.cards || [];
        const nameOfCard = (cid) => { const c = cards.find(x => x.id === cid); return c ? (c.name || '') : ''; };
        const list = (meta.worlds || []).slice().reverse().map(w => Object.assign({}, w, { cardName: nameOfCard(w.cardId) }));
        return json(res, 200, { list: list, current: currentId });
      }
      if (u.pathname === '/api/cards') {
        const meta = loadMeta();
        const ws = meta.worlds || [];
        const list = (meta.cards || []).slice().reverse().map(c => {
          const mine = ws.filter(w => w.cardId === c.id);
          mine.sort((a, b) => String(b.saved || '').localeCompare(String(a.saved || '')));
          return Object.assign({}, c, { worlds: mine.map(w => ({ id: w.id, name: w.name, era: w.era, saved: w.saved, worldT: w.worldT, turnN: w.turnN })) });
        });
        return json(res, 200, { list: list, count: (meta.cards || []).length });
      }
      if (u.pathname === '/api/content/list') return json(res, 200, CONTENT.view(cfg));
      if (u.pathname === '/api/worldinfo/list') {
        const wi = (current && current.worldinfo) || {};
        return json(res, 200, { list: Object.values(wi).map(e => ({ uid: e.uid, keys: e.keys || [], content: (e.content || '').slice(0, 600), enabled: e.enabled !== false })) });
      }
      if (u.pathname === '/api/export/world') {
        if (!current) return json(res, 200, { err: '当前没有世界' });
        return json(res, 200, { ok: true, name: (current.meta && current.meta.name) || currentId, json: JSON.stringify(current) });
      }
      // ---------- 只读查询钩子（给外置测试工具用）----------
      // 三条硬规矩：① 只读（不接受任何写入）② 必须"已进入世界"才可用 ③ 只暴露**当前进入的那个世界**。
      // 外置工具（.dsh/tools/wsq）靠它拿到**内存里的真实状态**；没有它就只能读磁盘文件，而
      // 服务端把 world 缓存在内存里 —— 那样看到的会是旧数据（本项目踩过两次）。
      if (u.pathname === '/api/db') {
        /* v2.06 修 P1-4：最后第二项原来写 'worldInfo'，而世界数据里的键是 **worldinfo**（小写，
           见 /api/worldinfo/save）⇒ /api/db?t=worldInfo 永远查不到世界书（只读诊断钩子静默返 0）。
           顺带把 worldinfo/documents 一起列上，诊断时要看的就是这些。 */
        const TBL = ['meta', 'entities', 'relations', 'memories', 'impressions', 'knowledge', 'ledger', 'sceneLog', 'messages', 'news', 'archives', 'plans', 'claims', 'calendar', 'worldinfo', 'documents', 'current'];
        const cnt = (v) => Array.isArray(v) ? v.length : (v && typeof v === 'object' ? Object.keys(v).length : (v == null ? 0 : 1));
        if (!current) return json(res, 200, { ok: false, inWorld: false, err: '未进入世界（模拟器停在世界列表/主菜单）—— 本钩子只查"当前已进入的世界"' });
        const t = String(u.searchParams.get('t') || '').trim();
        GL('api db?t=' + (t || '(探测)'));
        if (!t) {
          return json(res, 200, {
            ok: true, inWorld: true, readonly: true,
            world: { id: currentId || '', name: (current.meta && current.meta.name) || '', era: (current.meta && current.meta.era) || '' },
            time: (current.current && current.current.time) || '',
            note: '只读 · 只暴露当前已进入的世界',
            tables: TBL.map(k => ({ name: k, count: cnt(current[k]) }))
          });
        }
        if (TBL.indexOf(t) < 0) return json(res, 200, { ok: false, err: '未知的表：' + t + '（可用：' + TBL.join(',') + '）' });
        const lim = Math.max(1, Math.min(500, parseInt(u.searchParams.get('limit'), 10) || 50));
        const v = current[t];
        const total = cnt(v);
        let rows;
        if (Array.isArray(v)) rows = v.slice(-lim);
        else if (v && typeof v === 'object') { rows = {}; for (const k of Object.keys(v).slice(0, lim)) rows[k] = v[k]; }
        else rows = v;
        return json(res, 200, { ok: true, inWorld: true, t: t, total: total, limit: lim, truncated: total > lim, rows: rows });
      }
      if (u.pathname === '/api/visual/lib') {
        // 外貌库（引擎工作台）：谁有九维档案、档案全不全、有没有立绘。
        // 这是"画面引擎"页的数据源 —— 九维档案在此有正当的接触面（在此之前它只是生图管线里的隐形数据）。
        if (!current) return json(res, 200, { err: '没有世界' });
        const NINE = ['脸型与年龄感', '眉眼与瞳孔', '鼻子与嘴唇', '肤色与肤质', '体型身材', '发型与发色', '衣着与配饰', '永久标记'];
        const tasks = (current.current && current.current.imgTasks) || [];
        const list = Object.values(current.entities || {})
          .filter(e => e.type === 'person' && e.id !== 'player')
          .map(e => {
            const v = (e.profile || {}).visual || {};
            const nine = v.nine || {};
            const filled = NINE.filter(k => String(nine[k] || '').trim());
            const hasPortrait = tasks.some(t => (t.who || []).indexOf(e.id) >= 0 && t.status === 'done');
            // 引擎工作台：用真名（这里不是游戏内，知识门控不适用——它是给你调配生图用的台子）
            return { id: e.id, name: e.name || '？', hasPortrait: hasPortrait, anchor: String(v.anchor || ''), nine: nine, filled: filled.length, missing: NINE.filter(k => filled.indexOf(k) < 0) };
          });
        return json(res, 200, { ok: true, dims: NINE, list: list });
      }
      if (u.pathname === '/api/gallery/list') {
        GL('api gallery-list (tick=' + new Date().getTime() + ')');
        const dir = path.join(resBase(), 'data', 'gallery', (currentId || 'none'));
        let list = [];
        try {
          const jf = path.join(dir, 'gallery.json');
          if (fs.existsSync(jf)) { const j = JSON.parse(fs.readFileSync(jf, 'utf8')); list = (j.list || []).map(x => ({ id: x.id, who: x.who || '', scene: x.scene || '', note: x.note || '', state: x.state || '', t: x.t || '', prompt: x.prompt || '' })); }
          if (!list.length && fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter(x => /\.png$/i.test(x))) list.push({ id: f.replace(/\.png$/i, ''), t: fs.statSync(path.join(dir, f)).mtimeMs });
        } catch (e) { DEG.hit("server.js", e); }
        return json(res, 200, { list: list.slice().sort((a, b) => String(b.t).localeCompare(String(a.t))).slice(0, 200) });
      }
      if (u.pathname === '/api/gallery/img') {
        const id = String(u.searchParams.get('id') || '').replace(/[^a-zA-Z0-9_-]/g, '');
        const fp = path.join(path.join(resBase(), 'data', 'gallery', (currentId || 'none')), id + '.png');
        if (!fs.existsSync(fp)) return json(res, 200, { err: '无此图' });
        const buf = fs.readFileSync(fp);
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(buf);
        return;
      }
      if (u.pathname === '/api/diag') {
        return json(res, 200, {
          build: BUILD, live: AI.isLive(cfg), world: (current && current.meta && current.meta.name) || (currentId ? ('已加载 #' + currentId) : '未加载'), menuMode,
          serverLog: tailFile(path.join(os.tmpdir(), 'worldsim.log'), 40),
          uiLog: tailFile(path.join(os.tmpdir(), 'worldsim-ui.log'), 40),
          aiTrace: ((current && current.current && current.current.aiTrace) || []).slice(-20),
          // v1.86：静默降级的统一计数（哪些模块在偷偷吞异常、吞了什么）
          degraded: (function () { try { return DEG.view(); } catch (e) { return null; } })(),
          /* v1.98 · P0-2：世界锁的现状（谁占着、占了多久、被强制释放过几次）。
             0 token 的可观测性：并发问题最难查的就是"当时到底谁在跑"。 */
          lock: { busy: WL.peek(), forced: WL.forcedCount(), routes: WL.REQUIRED.length },
          viewKeys: (function () { try { return G.buildDevView(current || {}); } catch (e) { return null; } })(),
          // v1.86：账本重放对账（可重放子集：sceneId/memories/relations）—— 存档自检
          replay: (function () { try { return require('./src/replay').check(current); } catch (e) { return null; } })(),
          // v1.87：留存策略的落盘情况（哪些历史被裁到了磁盘、各多少）
          retention: (function () { try { return RET.view(current); } catch (e) { return null; } })(),
          // A5：客观事件流（导演台本）从玩家界面撤下来了，但开发/诊断仍然要看得到。
          ledger: ((current && current.ledger) || []).slice(-20).map(l => ({ t: l.t, type: l.type, target: l.target, desc: l.desc })),
          gate: (function () {
            // 门控自检：谁的名字 AI 拿得到、谁拿不到（A1 的验收面）
            if (!current) return null;
            const imp = current.impressions || {};
            return Object.values(current.entities).filter(e => e.type === 'person' && e.id !== 'player').map(e => ({
              id: e.id, name: e.name, stage: (imp[e.id] || {}).stage || 0,
              viewName: G.viewName(current, e.id), aiSees: G.viewName(current, e.id) || '(陌生人指代)'
            }));
          })()
        });
      }
      return json(res, 404, { err: 'not found' });
    }
    // ---------- POST API ----------
    if (req.method === 'POST' && u.pathname.startsWith('/api/')) {
      const raw = await body(req);
      /* v1.98 · P0-2：**世界锁的唯一执行点**。要锁的入口清单在 src/worldlock.js（一处声明）。
         拿不到 = 立刻拒绝（err + busy），不是排队 —— 排队会把"玩家此刻的意图"变成"几步之后才执行的命令"。
         顺序注意：body 已经读完了才可能拒绝（先回包再读 body 会让客户端拿到 ECONNRESET，看不到这句话）。 */
      __lockEnt = WL.enter(u.pathname, req.method, lockTimeoutMs());
      if (__lockEnt.mode === 'reject') {
        GL('[lock] 拒绝 ' + __lockEnt.what + '（' + WL.busyMsg() + '）');
        return json(res, 200, { err: __lockEnt.msg, busy: true, busyWhat: (WL.peek() || {}).what || '' });
      }
      let p = {};
      try { p = JSON.parse(raw || '{}'); } catch (e) { return json(res, 400, { err: 'body not json' }); }

      if (u.pathname === '/api/settings') {
        const next = AI.saveConfig({ baseURL: p.baseURL, apiKey: p.apiKey, model: p.model, playerName: p.playerName, maxTokens: p.maxTokens, timeoutMs: p.timeoutMs, roles: p.roles, port: p.port, image: p.image });
        cfg = AI.loadConfig();
        if (current && p.playerName) { current.entities.player.name = p.playerName; if (current.entities.player) persist(); }
        return json(res, 200, { ok: true, mode: AI.isLive(cfg) ? 'live' : 'demo' });
      }
      if (u.pathname === '/api/settings/test') {
        const t = { baseURL: p.baseURL || cfg.llm.baseURL, apiKey: p.apiKey || cfg.llm.apiKey, model: p.model || cfg.llm.model };
        if (!t.baseURL || !t.apiKey) return json(res, 200, { ok: false, err: '请先填写 baseURL 与 apiKey' });
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        try {
          let url = t.baseURL.trim().replace(/\/$/g, '');
          const r = await fetch(url + '/models', { signal: ctrl.signal, headers: { 'Authorization': 'Bearer ' + t.apiKey } });
          if (!r.ok) return json(res, 200, { ok: false, err: 'HTTP ' + r.status + '：端点或密钥无效' });
          const j = await r.json();
          const models = (j.data || []).map(m => m.id || m.name).slice(0, 8);
          return json(res, 200, { ok: true, models });
        } catch (e) {
          return json(res, 200, { ok: false, err: '连接失败：' + String(e.message || e) + '（检查 Clash 代理/网络）' });
        } finally { clearTimeout(timer); }
      }
      if (u.pathname === '/api/menu') { menuMode = true; return json(res, 200, { ok: true, noWorld: true }); }
      /* v1.87：浏览器侧静默降级的**上报口**。前端 public/*.js 的空 catch 会批量 POST 到这里，
         并进与引擎侧同一份计数（/api/diag.degraded 里以 `web:` 前缀出现）。
         故意**不需要"已进入世界"** —— 页面在进世界之前就可能出错。 */
      if (u.pathname === '/api/deg') {
        const items = Array.isArray(p.items) ? p.items.slice(0, 20) : [];
        for (const it of items) { try { DEG.hit('web:' + String((it && it.where) || '?'), new Error(String((it && it.msg) || ''))); } catch (e) { DEG.hit('server.js', e); } }
        return json(res, 200, { ok: true, n: items.length });
      }
      if (u.pathname === '/api/comfy/render') {
        const id = String(p.id || '');
        /* v1.80 这里原来写的是 `t.id === id && t.ai` —— 但**规则装配**出来的任务 `ai` 是 null
           （aiPrompt 关着时就走规则装配：prompt 有、ai 空）→ 被判成「任务不存在」，点生图永远失败。
           有 ai 或**有 prompt** 都算可渲染。 */
        const task = ((current && current.current && current.current.imgTasks) || []).find(t => t.id === id && (t.ai || t.prompt));
        if (!task) return json(res, 200, { err: '任务不存在或没生成提示词' });
        if (!(cfg.image && cfg.image.enabled)) return json(res, 200, { err: '生图未启用（设置→生图）' });
        if (task.status === 'done') return json(res, 200, { ok: true, status: 'done', cached: true });
        task.status = 'rendering';
        await queueRender(async () => {
          await comfyRender(task, (st, e, buf, prm) => {
            if (st === 'fail') { task.status = 'fail'; task.err = e; }
            if (st === 'done') {
              task.status = 'done';
              const rec = { id: task.id, who: (task.who || []).join(','), scene: typeof task.scene === 'string' ? task.scene : ((task.sceneNow && task.sceneNow.place) || ''), note: task.note || '', state: task.state || '', ai: task.ai, prompt: prm || task.prompt || '', t: task.t || new Date().toISOString(), buf };
              gallerySave(rec);
              stampImgOnBeat(task);      // v1.65b：图盖在这一幕的条目上（过回合也不掉）
            }
          });
        });
        return json(res, 200, { ok: task.status === 'done', err: task.status === 'done' ? null : (task.err || '渲染失败'), status: task.status });
      }
      if (u.pathname === '/api/image/workflow') {
        const name = String(p.name || 'workflow').replace(/[^\w\-一-鿿. ]/g, '').slice(0, 60) || 'workflow.json';
        const txt = String(p.jsonText || '');
        if (!txt || txt.length < 20) return json(res, 200, { err: '工作流内容为空' });
        let wf = null;
        try { wf = JSON.parse(txt); } catch (e) { return json(res, 200, { err: '不是有效 JSON：' + String(e.message || e).slice(0, 80) }); }
        const dir = path.join(resBase(), 'data', 'workflows');
        fs.mkdirSync(dir, { recursive: true });
        writeAtomic(path.join(dir, name), txt);   // v1.98 P0-1
        const nextImg = Object.assign({}, (cfg.image || {}), { workflow: name, workflowJson: txt });
        AI.saveConfig({ image: nextImg });
        cfg = AI.loadConfig();
        return json(res, 200, { ok: true, name, len: txt.length });
      }
      if (u.pathname === '/api/person/look') {
        // 「TA 长什么样」按需生成：印象层没有长相时用副 AI 写一次，之后长期复用（不看不花、写一次不再花）
        const id = String(p.id || '');
        if (!current || !current.entities[id]) return json(res, 200, { err: '没有这个人' });
        try {
          const look = await G.genLook(current, id, cfg);
          /* v1.69：这里原来是 saveWorld(current) —— 那是**新建世界**（每次 makeId(w) 新文件 + 注册表加一条）！
             要的是「保存当前世界」，所以是 persist()。实测事故：前端给每个没长相印象的人调一次这个接口，
             8 个人 → 19 秒里建出 8 个同名世界。 */
          if (look) { try { persist(); } catch (e2) { DEG.hit("server.js", e2); } }
          return json(res, 200, { ok: !!look, look: look || '' });
        } catch (e) { return json(res, 200, { err: String(e.message || e) }); }
      }
      if (u.pathname === '/api/comfy/person') {
        // 档案→人物立绘：为某人即时生成立绘（锚点+状态→exImage→渲染→图库）
        const id = String(p.id || '');
        if (!current || !current.entities[id]) return json(res, 200, { err: '没有这个人' });
        if (!(cfg.image && cfg.image.enabled)) return json(res, 200, { err: '生图未启用（设置→画面引擎）' });
        const e = current.entities[id];
        // 没有九维档案 → 先建档再出图。scheduler 的原则是"无锚点人物绝不写人貌"，
        // 不先建档的话，点了生成也只会画出一张没有人的场景图（运行时冒出来的新人物都缺这个）。
        try {
          if (G.nineFilled(e) < 4 && AI.isLive(cfg)) {
            GL('[img] 无九维档案，先建档：' + id);
            const r = await G.genProfile(current, id, cfg);
            if (r && r.nineBuilt) { e.profile.visual = e.profile.visual || {}; GL('[img] 建档完成：' + G.nineFilled(e) + '/8'); }
            persist();   // v1.69：同上——saveWorld 会新建世界，这里只要保存当前世界
          }
        } catch (e0) { DEG.hit("server.js", e0); }
        const prof = e.profile || {};
        const dyn = Object.values((prof.visual || {}).dynamic || {}).join('；');
        const img = { kind: 'portrait', who: [id], state: String((prof.desires || {}).现在想 || '') + '；此刻：' + ((e.state || {}).mood || '平静') + (dyn ? '；' + dyn.slice(0, 60) : ''), scene: (current.entities[current.current.sceneId] || {}).name || '', note: '' };
        try {
          await SCHED.dispatch(current, cfg, 'image', { img });
          const task = ((current.current.imgTasks || []).slice(-1))[0];
          if (!task || !task.prompt) return json(res, 200, { err: '提示词生成失败（检查模型/锚点配置）' });
          task.status = 'rendering';
          await queueRender(async () => {
            await comfyRender(task, (st, er, buf, prm) => {
              if (st === 'fail') { task.status = 'fail'; task.err = er; }
              if (st === 'done') { task.status = 'done'; gallerySave({ id: task.id, who: id, scene: String(img.scene || ''), note: '', state: String(img.state || ''), ai: task.ai, prompt: prm || task.prompt || '', t: new Date().toISOString(), buf }); }
            });
          });
          return json(res, 200, { ok: task.status === 'done', err: task.status === 'done' ? null : (task.err || '渲染失败'), imgId: task.status === 'done' ? task.id : null });
        } catch (e) { return json(res, 200, { err: String(e.message || e) }); }
      }
      if (u.pathname === '/api/comfy/test') {
        const base = String(p.base || (cfg.image && cfg.image.base) || 'http://127.0.0.1:8188').replace(/\/$/, '');
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 6000);
        try {
          const r = await fetch(base + '/system_stats', { signal: ctl.signal });
          if (!r.ok) return json(res, 200, { ok: false, err: 'HTTP ' + r.status });
          const j = await r.json();
          AI.saveConfig({ image: Object.assign({}, (cfg.image || {}), { base: base }) });
          cfg = AI.loadConfig();
          return json(res, 200, { ok: true, base, comfy: (j.system && j.system.comfyui_version) || '', models: (j.devices || []).map(d => d.type) });
        } catch (e) { return json(res, 200, { ok: false, err: String(e.message || e) }); }
        finally { clearTimeout(timer); }
      }
      if (u.pathname === '/api/wxmark') {
        if (current) { current.current.weatherSeen = true; current.current.weatherVia = 'tool'; persist(); return json(res, 200, { ok: true }); }
        return json(res, 200, { ok: false });
      }
      if (u.pathname === '/api/resume-current') {
        if (!current) return json(res, 200, { noWorld: true });
        menuMode = false;
        return json(res, 200, { ok: true, view: G.buildView(current) });
      }
      if (u.pathname === '/api/self') {
        const keys = ['name', 'age', 'identity', 'role', 'ability', 'appearance', 'backstory', 'attitude', 'secret', 'desire', 'wealth'];
        const userSelf = {};
        const src = (p.fields && typeof p.fields === 'object') ? p.fields : {};
        for (const k of keys) { const v = String(src[k] || '').trim().slice(0, 120); if (v && !/按设定来|^待定$|待补充/.test(v)) userSelf[k] = v; }
        AI.saveConfig({ userSelf });
        cfg = AI.loadConfig();
        GL('设定身份档案 keys=' + Object.keys(userSelf).join(','));
        return json(res, 200, { ok: true, userSelf });
      }
      // ---------- 角色卡盒：扫描过的卡直接开局（每次都是新的一局，不是存档） ----------
      if (u.pathname === '/api/cards/launch') {
        const id = String(p.id || '');
        const fp = cardFile(id);
        if (!fs.existsSync(fp)) return json(res, 200, { err: '卡档不存在（可能被删）' });
        let ck = null;
        try { ck = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) { return json(res, 200, { err: '卡档损坏' }); }
        const pack = ck && ck.pack;
        if (!pack) return json(res, 200, { err: '卡档没有卡内容' });
        const g = Number.isInteger(p.greeting) ? p.greeting : 0;
        GL('卡盒开局 ' + (ck.name || id) + ' greeting=' + g);
        const data = IMP.packToData(pack, { greeting: g });
        data.meta.cardId = id;                     // v1.49：这一局挂到这张卡下面
        try { await OPEN.compile(data, cfg); } catch (e) { DEG.hit('server.js:opening', e); }   // 开局编译（失败不挡进门）
        saveWorld(data, (pack.meta && pack.meta.name) || ck.name || '卡盒世界');
        return json(res, 200, { ok: true, card: ck.name || '', view: G.buildView(data) });
      }
      if (u.pathname === '/api/cards/cache') {
        // v1.72 读角色卡缓存：这张卡当时是怎么被理解的（分析稿 + 补了什么 + 裁了什么）
        const id = String(p.id || '');
        const fp = cardFile(id);
        if (!id || !fs.existsSync(fp)) return json(res, 200, { ok: false, err: '这张卡没有扫描记录' });
        try {
          const c = JSON.parse(fs.readFileSync(fp, 'utf8'));
          const pk = c.pack || {};
          return json(res, 200, {
            ok: true, name: c.name || '', era: c.era || '', mode: c.mode || '', note: c.note || '', scanned: c.scanned || '',
            analysis: String(c.analysis || ''),
            filled: (Array.isArray(pk.filled) ? pk.filled : []).slice(0, 40),
            conflicts: (Array.isArray(pk.conflicts) ? pk.conflicts : []).slice(0, 40),
            npcs: (pk.npcs || []).map(n => n && n.name).filter(Boolean),
            places: (pk.places || []).map(x => x && x.name).filter(Boolean)
          });
        } catch (e) { return json(res, 200, { ok: false, err: '读不了：' + e.message }); }
      }
      if (u.pathname === '/api/cards/del') {
        const id = String(p.id || '');
        const meta = loadMeta();
        meta.cards = (meta.cards || []).filter(c => c.id !== id);
        saveMeta(meta);
        try { fs.unlinkSync(cardFile(id)); } catch (e) { DEG.hit("server.js", e); }
        return json(res, 200, { ok: true });
      }
      if (u.pathname === '/api/player-name') {
        const nm = String(p.name || '').slice(0, 20);
        AI.saveConfig({ playerName: nm });
        cfg = AI.loadConfig();
        if (current && nm && current.entities.player) { current.entities.player.name = nm; persist(); }
        return json(res, 200, { ok: true });
      }
      if (u.pathname === '/api/content/set') {
        const slot = String(p.slot || 'nsfw');
        const id = String(p.id || '');
        const cur = AI.loadConfig();
        const nextC = Object.assign({}, cur.content || {});
        nextC[slot] = id;
        AI.saveConfig({ content: nextC, baseURL: cur.llm.baseURL, apiKey: cur.llm.apiKey, model: cur.llm.model, playerName: cur.playerName, maxTokens: cur.llm.maxTokens, timeoutMs: cur.llm.timeoutMs, roles: cur.roles, port: cur.port, image: cur.image });
        cfg = AI.loadConfig();
        return json(res, 200, { ok: true, view: CONTENT.view(cfg) });
      }
      if (u.pathname === '/api/content/import') {
        const r = CONTENT.importDir(p.from, !!p.force);
        if (!r.ok) return json(res, 200, { ok: false, err: r.err });
        return json(res, 200, { ok: true, added: r.added, skipped: r.skipped, view: CONTENT.view(cfg) });
      }
      if (u.pathname === '/api/quit') {
        json(res, 200, { ok: true });
        setTimeout(() => { try { process.exit(0); } catch (e) { DEG.hit("server.js", e); } }, 120);
        return;
      }
      if (u.pathname === '/api/new') {
        const card = IMP.parseSource(p.src || 'text', p.payload || '');
        /* v1.67：预览一次 + 建世界一次 = 同一张卡原来要被 AI **扫两遍**（两次调用、两次都可能失败）。
           现在第一次扫完把结果缓存下来，建世界时直接复用。
           顺带修掉一个真事故（用户 2026-09-14 实测：「刚刚扫了一张卡，都出来了，怎么消失了？」）：
           第二次扫描若返回 needChoice，界面那条路没处理 → refresh(undefined) → **世界静默不建**。 */
        let scan = null;
        const sid = String(p.scanId || '');
        if (sid && SCAN_CACHE.has(sid)) { scan = SCAN_CACHE.get(sid); SCAN_CACHE.delete(sid); }
        else scan = await IMP.scanCard(card, cfg, !!p.fallback, function (label, pct, chars) {
          if (label) progSet(label, pct);
          if (chars != null) progChars(chars);
        });
        // v1.65 丙方案：AI 扫描失败**不再静默降级**——先把原因交回界面，由用户选"重试 / 用本地猜"
        // ★ 键名不能叫 err：前端 api() 见到 err 就 throw，needChoice 会永远传不到界面（实测踩过）
        if (scan.mode === 'fail') { progClear(); return json(res, 200, { needChoice: true, scanErr: scan.note || 'AI 扫描失败（原因未知）', card: card.name || '未命名' }); }
        if (scan.pack && !(scan.pack.meta)) {   // 兜底（正常走不到）：显式记一笔，不装作没事
          scan.pack = IMP.heuristicPack(card);
          scan.mode = 'heuristic';
          scan.note = (scan.note ? scan.note + '；' : '') + '扫描结果缺 meta，已本地猜';
        }
        if (p.role === 'player') {
          scan.pack.player = scan.pack.player || {};
          scan.pack.player.name = card.name || scan.pack.player.name || '你';
        } else if (!p.noSelf && cfg.userSelf && Object.keys(cfg.userSelf || {}).length) {
          // 优先级：UI设定（我的身份档案）> 角色卡设定 > 世界规则补全。你填的你最大——直接覆盖卡的通用兜底；只有没填的键留给卡
          scan.pack.player = scan.pack.player || {};
          for (const k of Object.keys(cfg.userSelf)) {
            const v = String(cfg.userSelf[k] || '').trim();
            if (!v || /按设定来|^待定$|待补充/.test(v)) continue;
            scan.pack.player[k] = v;
          }
        }
        if (p.era) { scan.pack.meta = scan.pack.meta || {}; scan.pack.meta.era = p.era; }
        progSet('落库 · 写卡档与开场', 94);
        if (p.preview) {
          progClear();
          const sidNew = makeId('scan');
          SCAN_CACHE.set(sidNew, scan);
          if (SCAN_CACHE.size > 6) { const k0 = SCAN_CACHE.keys().next().value; SCAN_CACHE.delete(k0); }
          return json(res, 200, { preview: packPreview(scan.pack, scan.mode), scanId: sidNew });
        }
        GL('导入 ' + (card.name || '未命名') + ' mode=' + scan.mode + (scan.note ? (' note=' + String(scan.note).slice(0, 80)) : '') + ' greeting=' + (Number.isInteger(p.greeting) ? p.greeting : 0));
        // 扫描过的卡建档：下次直接从卡开局（存的是卡，不是存档）
        const meta = loadMeta();
        meta.cards = meta.cards || [];
        const cn = card.name || '未命名';
        const era = (scan.pack.meta && scan.pack.meta.era) || '';
        const pool = ((Array.isArray(scan.pack.alternates) ? scan.pack.alternates : []).slice(0, 4)).map(a => String(a || '').slice(0, 200)).concat([String(scan.pack.firstScene || '').slice(0, 400)]);
        let cardEntry = meta.cards.find(c => c.name === cn && (c.era || '') === era);
        const rec = {
          id: cardEntry ? cardEntry.id : makeId('c'),
          name: cn, era,
          worldName: (scan.pack.meta && scan.pack.meta.name) || cn,
          npcs: (scan.pack.npcs || []).map(n => n && n.name).filter(Boolean).slice(0, 12),
          placeN: (scan.pack.places || []).length,
          openings: pool.length, openingList: pool,
          mode: scan.mode || 'heuristic', note: scan.note || null, scanned: new Date().toISOString(),
          // v1.72 扫描记录（主菜单「🃏 读取角色卡开局」里可查）：
          // 分析稿 + 补全 + 裁决 —— 这份存档是怎么来的，全在这
          filledN: (Array.isArray(scan.pack.filled) ? scan.pack.filled.length : 0),
          conflictsN: (Array.isArray(scan.pack.conflicts) ? scan.pack.conflicts.length : 0),
          analysisLen: String(scan.analysis || '').length
        };
        meta.cards = meta.cards.filter(c => c.id !== rec.id);
        meta.cards.push(rec);
        saveMeta(meta);
        try {
          fs.mkdirSync(cardsDir(), { recursive: true });
          writeAtomic(cardFile(rec.id), { id: rec.id, name: cn, era, mode: rec.mode, note: rec.note || null, scanned: rec.scanned, pack: scan.pack, analysis: scan.analysis || '', analysisAt: rec.scanned });
        } catch (e) { console.error('[cardbox]', e.message); }
        const data = IMP.packToData(scan.pack, { greeting: Number.isInteger(p.greeting) ? p.greeting : 0 });
        data.meta.cardId = rec.id;   // v1.75：这一局挂到这张卡下面（卡盒开局那条路一直有，扫卡导入这条路漏了 → 世界全掉进「没有角色卡的」，卡下永远是 0 个聊天）
        try { await OPEN.compile(data, cfg); } catch (e) { DEG.hit('server.js:opening', e); }
        saveWorld(data, (scan.pack.meta && scan.pack.meta.name) || card.name);
        progClear();
        return json(res, 200, { ok: true, mode: scan.mode, note: scan.note || null, card: card.name, archived: rec.name, view: G.buildView(data) });
      }
      if (u.pathname === '/api/demo') {
        GL('演示世界');
        const data = buildDemoWorld();
        saveWorld(data, data.meta.name);
        return json(res, 200, { ok: true, view: G.buildView(data) });
      }
      if (u.pathname === '/api/world/gen') {
        const userSelf = (p.userSelf && typeof p.userSelf === 'object') ? p.userSelf : null;
        if (p.preview) {
          GL('生成预览（' + (AI.isLive(cfg) ? 'live' : 'demo-random') + '）prompt=' + String(p.prompt || '').slice(0, 40));
          const rp = await WG.genWorldPack(cfg, p.prompt || '', userSelf);
          previewPack = rp.pack; previewMode = rp.mode || 'llm';
          previewSelf = userSelf;
          previewSetup = await WG.checkSetup(rp.pack, userSelf, cfg);
          return json(res, 200, { preview: packPreview(rp.pack, previewMode), setup: previewSetup });
        }
        if (p.apply) {
          if (!previewPack) {
            /* v1.68：previewPack 是**一次性票据**——第一个 apply 用掉就置空。
               原来后面的请求掉进这里会**当场再造一个世界**，前端又没防重复 → 点 N 次 = N 个世界
               （实测：19 秒里建了 8 个同名世界）。现在没有票据就拒绝，除非显式带了 prompt。 */
            if (!String(p.prompt || '').trim()) {
              GL('生成应用被拒（预览已使用/过期）');
              return json(res, 200, { err: '预览已使用或已过期——请重新生成一次再进入（这次没有重复建世界）' });
            }
            GL('生成应用（无预览 + 显式 prompt，直接生成）');
            const rp = await WG.genWorldPack(cfg, p.prompt, userSelf);
            previewPack = rp.pack; previewMode = rp.mode || 'llm';
            previewSelf = userSelf;
            previewSetup = await WG.checkSetup(rp.pack, userSelf, cfg);
          }
          GL('应用世界 ' + ((previewPack.meta && previewPack.meta.name) || '') + ' mode=' + previewMode + ' greeting=' + (Number.isInteger(p.greeting) ? p.greeting : 0));
          const data = IMP.packToData(previewPack, { greeting: Number.isInteger(p.greeting) ? p.greeting : 0 });
          // 玩家自我设定落世界（20.1/20.2）：User 卡进入玩家档案；冲突项按世界裁决
          if (previewSelf && typeof previewSelf === 'object') {
            applySelfToData(data, previewSelf, previewSetup);
          } else {
            applySelfToData(data, previewPack.player || null, previewSetup);
          }
          try { await OPEN.compile(data, cfg); } catch (e) { DEG.hit('server.js:opening', e); }   // 开局编译（在 saveWorld 之前，保证第一帧就是自洽的）
          previewPack = null; previewSelf = null; previewSetup = null;
          saveWorld(data, (data.meta && data.meta.name) || 'AI 生成世界');
          return json(res, 200, { ok: true, view: G.buildView(data) });
        }
        return json(res, 400, { err: '需要 preview 或 apply 参数' });
      }
      if (u.pathname === '/api/world/load') {
        const id = String(p.id || '');
        const lr = loadWorld(id);
        /* v1.98 P0-1：「不存在」与「已损坏」是两种事，给两种话（损坏要报出文件名与备份名） */
        if (!lr.ok) return json(res, 200, { err: lr.msg, why: lr.why });
        current = lr.data; currentId = id; menuMode = false;
        if (lr.recovered) GL('[world] 载入时用了崩溃残骸恢复（' + id + '）');
        return json(res, 200, { ok: true, view: G.buildView(lr.data), recovered: !!lr.recovered });
      }
      if (u.pathname === '/api/progress') return json(res, 200, { ok: true, prog: PROG });
      if (u.pathname === '/api/storage') {
        // v1.75：孤儿数据原来**没有任何入口**（只能靠"删世界时顺手清"）——用户问出来了，给它一个常驻入口
        const meta = loadMeta();
        return json(res, 200, {
          ok: true,
          worlds: dirFootprint(worldsDir()), snaps: dirFootprint(SNAP.rootDir()),
          gal: dirFootprint(galleryRoot()), cards: dirFootprint(cardsDir()),
          nWorlds: (meta.worlds || []).length, nCards: (meta.cards || []).length,
          orphans: orphanFootprint()
        });
      }
      if (u.pathname === '/api/storage/clean') {
        const before = orphanFootprint();
        const gone = cleanOrphans();
        GL('清理孤儿数据 ' + gone + ' 份 · ' + Math.round(before.bytes / 1024) + ' KB');
        return json(res, 200, { ok: true, gone: gone, freed: before.bytes });
      }
      if (u.pathname === '/api/world/footprint') {
        // v1.74 删之前先算账：这个世界的快照/画面各占多少 + 全盘还有多少"没主"的旧数据
        const id = String(p.id || '');
        return json(res, 200, { ok: true, self: worldFootprint(id), orphans: orphanFootprint(), name: ((loadMeta().worlds || []).find(w => w.id === id) || {}).name || '' });
      }
      if (u.pathname === '/api/world/del') {
        /* v1.74 用户：「删除世界的时候问需不需要把那些一起删了」——
           默认**只删世界本体**（跟原来一样）；快照/画面/孤儿都要显式勾选才动。
           不可逆的东西永远不默认帮你选。 */
        const id = String(p.id || '');
        const out = { ok: true, del: {} };
        try { fs.unlinkSync(worldFile(id)); out.del.world = true; } catch (e) { DEG.hit("server.js", e); }
        if (p.withSnap) { const r0 = rmDirIfAny(SNAP.snapDir(id)); out.del.snap = r0; }
        if (p.withGallery) { const r0 = rmDirIfAny(path.join(galleryRoot(), id)); out.del.gallery = r0; }
        const meta = loadMeta();
        meta.worlds = (meta.worlds || []).filter(w => w.id !== id);
        if (meta.current === id) { meta.current = null; unloadWorld(); }
        saveMeta(meta);
        if (p.withOrphans) out.del.orphans = cleanOrphans();
        return json(res, 200, out);
      }
      if (u.pathname === '/api/reset') {
        if (currentId) { try { fs.unlinkSync(worldFile(currentId)); } catch (e) { DEG.hit("server.js", e); } }
        const meta = loadMeta();
        meta.worlds = (meta.worlds || []).filter(w => w.id !== currentId);
        meta.current = null;
        saveMeta(meta);
        unloadWorld();
        return json(res, 200, { noWorld: true });
      }
      /* v1.83 修 P1-2：存档导入三件套**不依赖 current**（自带 p.pack），而它们的入口是主菜单项，
         主菜单恰好就是"没有世界"的那个界面 —— 原来被这条守卫挡住，点「导入存档文件」必定 noWorld。 */
      const NEEDS_WORLD = !(u.pathname === '/api/save/scan' || u.pathname === '/api/save/import' || u.pathname === '/api/save/repair');
      if (NEEDS_WORLD && !current) return json(res, 400, { err: 'noWorld' });
      if (u.pathname === '/api/turn/stream') {
        /* v1.98 · P0-2：原来这里有一对 __turnBusy 检查。它被**世界锁**取代了 ——
           锁现在在分发器里（WL.enter），拿不到就直接返回 err+busy，比这里更早、且覆盖全部入口。
           同一规则留两处实现，早晚会分叉。 */
        // 流式回合：主AI 输出delta 实时转发（打字机），结束时发完整 view
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'Connection': 'keep-alive' });
        try { G.mergeDupPersons(current); } catch (e) { DEG.hit("server.js", e); }
        try {
          const r = await G.runTurn(current, p.text || '', cfg, {
            onDelta: (d) => { try { res.write('data: ' + JSON.stringify({ d: d }) + '\n\n'); } catch (e2) { DEG.hit("server.js", e2); } }
          });
          persist(); autoSnap(); traceAppend();
          try { res.write('data: ' + JSON.stringify({ view: r.view, recalled: r.recalled || [], intent: r.intent, applied: r.applied, fallback: r.fallback || '', errors: r.errors, fresh: r.fresh }) + '\n\n'); } catch (e2) { DEG.hit("server.js", e2); }
        } catch (e2) {
          try { res.write('data: ' + JSON.stringify({ err: String(e2.message || e2) }) + '\n\n'); } catch (e3) { DEG.hit("server.js", e3); }
        }
        try { res.end(); } catch (e2) { DEG.hit("server.js", e2); }
        return;
      }
      if (u.pathname === '/api/turn') {
        let r;
        try { G.mergeDupPersons(current); } catch (e) { DEG.hit("server.js", e); }
        r = await G.runTurn(current, p.text || '', cfg);
        persist(); autoSnap(); traceAppend();   // 锁由分发器持有（v1.98 P0-2）
        return json(res, 200, r);
      }
      if (u.pathname === '/api/skip') {
        let r;
        if (p.type === 'sleep') r = await G.runTurn(current, '睡觉', cfg);
        else r = await G.runTurn(current, '等' + (p.minutes || 10) + '分钟', cfg);
        persist(); autoSnap(); traceAppend();   // v1.98：原来这条漏了 traceAppend（睡觉/等待的调取留痕一直是空的）
        return json(res, 200, r);
      }
      if (u.pathname === '/api/msg/send') {
        const r = await G.sendMessage(current, p.to || 'npc1', p.text || '', cfg);
        persist();
        return json(res, 200, r);
      }
      if (u.pathname === '/api/msg/read') {
        const r = G.readMessage(current, p.id);
        persist();
        return json(res, 200, { view: r });
      }
      if (u.pathname === '/api/save/export') {
        // 自足的存档（**完整包**）：世界 + 框架 + 来源卡 + 自述 + 快照(20格) + 画面
        if (!current || !currentId) return json(res, 400, { err: '还没有世界' });
        const SAVEPACK = require('./src/savepack');
        const SNAP = require('./src/snapshot');
        const cid = (current.meta && current.meta.cardId) || '';
        let card = null;
        try { if (cid && fs.existsSync(cardFile(cid))) card = JSON.parse(fs.readFileSync(cardFile(cid), 'utf8')); } catch (e) { card = null; }
        const opts = { build: BUILD, card: card };
        if (p.full) {
          try { opts.snapshots = SNAP.dumpAll(currentId); } catch (e) { DEG.hit("server.js", e); }
          try {
            const dir = galleryDir();
            let list = [];
            try { const j = JSON.parse(fs.readFileSync(path.join(dir, 'gallery.json'), 'utf8')); list = Array.isArray(j) ? j : (j.list || []); } catch (e) { DEG.hit("server.js", e); }
            const imgs = [];
            for (const rec of list.slice(-60)) {
              try {
                const fp2 = path.join(dir, rec.id + '.png');
                if (fs.existsSync(fp2)) imgs.push({ id: rec.id, name: rec.name || '', mime: 'image/png', b64: fs.readFileSync(fp2).toString('base64'), rec: rec });
              } catch (e) { DEG.hit("server.js", e); }
            }
            opts.images = imgs;
          } catch (e) { DEG.hit("server.js", e); }
        }
        const pk = SAVEPACK.pack(current, opts);
        return json(res, 200, { ok: true, pack: pk, name: pk.__save.name, readme: pk.readme, hasCard: !!card, size: JSON.stringify(pk).length, snapN: (opts.snapshots || []).length, imgN: (opts.images || []).length });
      }
      if (u.pathname === '/api/save/repair') {
        // AI 修复（导入前）：告诉 AI 这是存档 → 判断哪里坏了 → 出补丁 → 引擎校验 → 应用 → **再扫一遍验证**
        const REP = require('./src/repair');
        const MF2 = require('./src/manifest');
        const packIn = p.pack || null;
        let world = packIn ? JSON.parse(JSON.stringify(packIn.world)) : current;
        if (!world) return json(res, 400, { err: '没有可修的东西' });
        const before = REP.verify(world);
        const auto = REP.autoFix(world);
        let said;
        try { said = await REP.aiSuggest(world, cfg, before.report); }
        catch (e) { said = { mode: 'error', findings: [], patch: [], note: String(e.message || e) }; }
        const ap = REP.applyPatch(world, said.patch);
        const after = REP.verify(world);
        if (!packIn) { current = world; persist(); }
        return json(res, 200, {
          ok: true, mode: said.mode, findings: said.findings || [], note: said.note || '',
          auto: auto, applied: ap.applied, rejected: ap.rejected,
          verify: { before: { unknownN: before.unknownN, needsAI: before.needsAI }, after: { unknownN: after.unknownN, needsAI: after.needsAI } },
          pack: packIn ? Object.assign({}, packIn, { world: world, readme: MF2.readmeSkeleton(world) }) : null
        });
      }
      if (u.pathname === '/api/save/scan') {
        // 只看报告，不落地（玩家点「确认导入」之前，先给他看清这份存档带了什么）
        const SAVEPACK = require('./src/savepack');
        const rep = SAVEPACK.scan(p.pack || p);
        return json(res, 200, { ok: rep.ok, report: rep });
      }
      if (u.pathname === '/api/save/import') {
        // 导入 = 扫描 → 引擎自动修（只修结构，不猜内容）→ 不认识的**原样装箱** → 落地
        const SAVEPACK = require('./src/savepack');
        const res1 = SAVEPACK.install(p.pack || p);
        if (!res1.ok) return json(res, 400, { ok: false, report: res1.report });
        const id = saveWorld(res1.world, (res1.world.meta && res1.world.meta.name) || '导入的世界');
        // 包里带了来源卡 → 一并装进卡盒（不然世界书/开场会缺一块）
        let cardOk = false;
        try {
          const c = res1.card;
          if (c && c.id && c.pack) {
            fs.mkdirSync(cardsDir(), { recursive: true });
            writeAtomic(cardFile(c.id), c);   // v1.98 P0-1
            const meta = loadMeta();
            meta.cards = (meta.cards || []).filter(x => x.id !== c.id);
            /* v2.06 修 P1-4：这里原来写 `nowIso ? new Date().toISOString() : ''` —— 而 nowIso
               是这个函数里**根本没有的标识符**（全文件只出现这一次）⇒ 每次都抛 ReferenceError。
               它在 try 里，异常被下一行的 catch 吞成一句 console.error ⇒ 卡档写不进去、cardOk 恒为 false，
               界面上只表现为"导入完整包之后，卡盒里没有这张卡"。 */
            meta.cards.push({ id: c.id, name: c.name || '', era: c.era || '', mode: c.mode || '', note: 'from-save', scanned: new Date().toISOString() });
            saveMeta(meta);
            cardOk = true;
          }
        } catch (e) { DEG.hit('server.js:save/import card', e); console.error('[save/import card]', e.message); }   // v2.06：静默降级要记账（原来只 console，界面上什么都看不到）
        // 完整包：把快照与画面原样落盘
        let snapN = 0, imgN = 0;
        try { const SNAP2 = require('./src/snapshot'); snapN = SNAP2.restoreAll(id, res1.snapshots); } catch (e) { DEG.hit("server.js", e); }
        try {
          if (res1.images && res1.images.length) {
            const dir = path.join(resBase(), 'data', 'gallery', id);
            fs.mkdirSync(dir, { recursive: true });
            const idx = [];
            for (const im of res1.images) {
              try { writeAtomic(path.join(dir, im.id + '.png'), Buffer.from(String(im.b64 || ''), 'base64')); idx.push(im.rec || { id: im.id, name: im.name || '', t: '' }); } catch (e) { DEG.hit("server.js", e); }
            }
            if (idx.length) writeAtomic(path.join(dir, 'gallery.json'), idx);   // v1.98 P0-1
            imgN = idx.length;
          }
        } catch (e) { DEG.hit("server.js", e); }
        return json(res, 200, { ok: true, id: id, made: res1.made, boxed: res1.boxed, card: cardOk, snapN: snapN, imgN: imgN, report: res1.report, view: G.buildView(current) });
      }
      if (u.pathname === '/api/schema/register') {
        // v1.56 插件自报 schema：**认识 ≠ 执行**（引擎认得名字与字段，不跑插件代码）；登记也留痕
        if (!current) return json(res, 400, { err: '还没有世界' });
        const schema = String(p.schema || '').trim().slice(0, 40);
        if (!schema) return json(res, 400, { err: '要一个 schema 名（如 plugin.x.widget.v1）' });
        current.schemas = current.schemas || {};
        current.schemas[schema] = { plugin: String(p.plugin || '').slice(0, 30), hint: String(p.hint || '').slice(0, 80), fields: (Array.isArray(p.fields) ? p.fields : []).slice(0, 20), t: current.current.time };
        try { require('./src/framework').log(current, { what: '+类型声明', name: schema, by: p.plugin ? ('plugin:' + p.plugin) : 'plugin' }); } catch (e) { DEG.hit("server.js", e); }
        try { require('./src/manifest').record(current, { kind: '类型声明', name: schema, schema: schema, by: 'plugin', note: String(p.hint || '') }); } catch (e) { DEG.hit("server.js", e); }
        let unboxed = 0;
        if (Array.isArray(current.unknown)) { const before = current.unknown.length; current.unknown = current.unknown.filter(x => String(x.what || '').indexOf(schema) < 0); unboxed = before - current.unknown.length; }
        persist();
        return json(res, 200, { ok: true, schema: schema, unboxed: unboxed, schemas: Object.keys(current.schemas).length });
      }
      /* v2.08 删：/api/framework/level 整个端点移除。
         它存在的唯一作用是让玩家调"世界能长到哪一层"——用户拍板那不是玩家的设置，
         而是 AI 生成框架的权限，永远最高档、不给玩家看到。
         ⚠️ 删端点必须同步 src/worldlock.js 的写入口覆盖面表，否则 world-lock-check 会红。 */
      if (u.pathname === '/api/snapshot/save') {
        if (!current || !currentId) return json(res, 400, { ok: false, err: '还没有世界' });
        return json(res, 200, SNAP.take(current, currentId, p.kind || 'manual', p.slot));
      }
      if (u.pathname === '/api/snapshot/load') {
        if (!current || !currentId) return json(res, 400, { ok: false, err: '还没有世界' });
        const one = SNAP.read(currentId, p.kind || 'auto', p.slot);
        if (!one.ok) return json(res, 400, one);
        SNAP.takePreRestore(current, currentId);      // 恢复前先留一份"现在"（不占 5/15 配额）
        const d = one.world;
        try { d.id = makeId; } catch (e) { DEG.hit("server.js", e); }
        try { G.mergeDupPersons(d); } catch (e) { DEG.hit("server.js", e); }
        try { if (d.current) { delete d.current.artCache; } } catch (e) { DEG.hit("server.js", e); }
        current = d; menuMode = false;
        persist();
        return json(res, 200, { ok: true, snap: one.snap || {}, view: G.buildView(current) });
      }
      if (u.pathname === '/api/snapshot/del') {
        if (!currentId) return json(res, 400, { ok: false, err: '还没有世界' });
        return json(res, 200, SNAP.remove(currentId, p.kind || 'manual', p.slot));
      }
      if (u.pathname === '/api/snapshot/stepback') {
        if (!current || !currentId) return json(res, 400, { ok: false, err: '还没有世界' });
        const a = SNAP.prevAuto(currentId);
        if (!a) return json(res, 400, { ok: false, err: '还没有「上一个」存档点——至少要走两个回合（每个回合结束都会自动存一份）' });
        const one = SNAP.read(currentId, 'auto', a.slot);
        if (!one.ok) return json(res, 400, one);
        SNAP.takePreRestore(current, currentId);
        const d = one.world;
        try { d.id = makeId; } catch (e) { DEG.hit("server.js", e); }
        try { G.mergeDupPersons(d); } catch (e) { DEG.hit("server.js", e); }
        try { if (d.current) { delete d.current.artCache; } } catch (e) { DEG.hit("server.js", e); }
        current = d; menuMode = false;
        persist();
        return json(res, 200, { ok: true, snap: one.snap || {}, view: G.buildView(current) });
      }
      if (u.pathname === '/api/doc/read') {
        // v1.46：打开一份文书（和"打字说'打开信件'"走同一个对象，只是入口不同）
        const doc = (current.documents || {})[String(p.id || '')];
        if (!doc || !((current.knowledge || {}).knownDocs || []).includes(doc.id)) return json(res, 404, { err: '没有这份文书' });
        current.current.openDoc = { id: doc.id, seq: (current.current.fxSeq || 0) + 1, t: current.current.time };
        const FXX = require('./src/fx');
        const isBook = /册|账本|名录|册子/.test(String(doc.title || '') + String(doc.kind || ''));
        G.startFx(current, FXX.specOf([isBook ? { k: 'turn' } : { k: 'unfold' }], isBook ? '翻页' : '展信', '玩家打开文书'));
        doc.read = true;
        persist();
        return json(res, 200, { ok: true, doc: G.docPublic(doc, current), view: G.buildView(current) });
      }
      if (u.pathname === '/api/msg/readall') {
        const from = String(p.from || '');
        for (const m of current.messages) {
          if (m.to === 'player' && m.from === from && m.status === 'unread') { m.status = 'read'; if (!current.knowledge.readMsgs.includes(m.id)) current.knowledge.readMsgs.push(m.id); }
        }
        persist();
        return json(res, 200, { view: G.buildView(current) });
      }
      if (u.pathname === '/api/claim/save') {
        current.claims = current.claims || [];
        current.claims.push({ id: current.id('clm'), date: String(p.date || '').slice(0, 10), when: String(p.when || '').slice(0, 20), title: String(p.title || '').slice(0, 80) });
        persist();
        return json(res, 200, { ok: true, view: G.buildView(current) });
      }
      if (u.pathname === '/api/worldinfo/save') {
        current.worldinfo = current.worldinfo || {};
        const uid = String(p.uid || ('w' + Date.now().toString(36)));
        current.worldinfo[uid] = { uid, keys: (p.keys || []).map(k => String(k).trim()).filter(Boolean).slice(0, 8), content: String(p.content || '').slice(0, 600), enabled: p.enabled !== false };
        persist();
        return json(res, 200, { ok: true, list: Object.values(current.worldinfo) });
      }
      if (u.pathname === '/api/worldinfo/del') {
        if (current.worldinfo && current.worldinfo[p.uid]) delete current.worldinfo[p.uid];
        persist();
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { err: 'not found' });
    }
    // ---------- 静态文件 ----------
    let file = u.pathname === '/' ? '/index.html' : u.pathname;
    let fp;
    try {
      file = decodeURIComponent(file);
      if (file.indexOf('..') >= 0 || file.indexOf('\\') >= 0) { res.writeHead(403); res.end('forbidden'); return; }
      fp = path.normalize(path.join(PUBLIC, file));
    } catch (e) { res.writeHead(400); res.end('bad request'); return; }
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
      const ext = path.extname(fp).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(fp).pipe(res);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found: ' + file);
  } catch (e) {
    console.error('[server]', e);
    // v1.76：500 也要进 worldsim.log —— 原来只在 stderr，桌面应用里根本看不到
    try { GL('★ 500 ' + req.method + ' ' + uPath + ' → ' + String(e.message || e).slice(0, 140)); } catch (e3) { DEG.hit("server.js", e3); }
    try { json(res, 500, { err: String(e.message || e) }); } catch (e2) { DEG.hit("server.js", e2); }
  } finally {
    /* v1.98 · P0-2：锁必须在 finally 放。任何一条 return、任何一次异常都不许把世界锁死
       （锁的失效模式就是"卡住"；超时是第二道保险，见 worldlock.js）。 */
    WL.exit(__lockEnt);
  }
});

// 端口绑定：探测面与绑定面都必须一致（127.0.0.1 IPv4）；冲突时自动 +1 重试，绝不裸崩
let listenPort = PORT;
let listenTries = 0;
function tryListen() {
  server.listen(listenPort, '127.0.0.1');
}
server.on('error', (e) => {
  if (e && e.code === 'EADDRINUSE' && listenPort - PORT < 20) {
    console.error('[world-sim] 端口 ' + listenPort + ' 被占用，尝试 ' + (listenPort + 1));
    listenPort += 1; listenTries++;
    setTimeout(tryListen, 120);
  } else if (e) {
    console.error('[world-sim] 服务监听失败：' + (e.code || '') + ' ' + (e.message || e));
  }
});
server.on('listening', () => {
  console.log('[world-sim] 服务已启动 http://127.0.0.1:' + listenPort);
  try { const n = backfillCardLinks(); if (n) console.log('[cards] 老局回填卡来源 ' + n + ' 条'); } catch (e) { DEG.hit("server.js", e); }
console.log('[world-sim] 构建 ' + BUILD + ' · 模式: ' + (AI.isLive(cfg) ? '接入模式(' + cfg.llm.model + ')' : '演示模式（未配置模型，请在游戏内 ⚙ 设置）'));
});
tryListen();
// 实际端口以监听为准（供 electron-main 读取）
server.__actualPort = () => listenPort;

module.exports = server;