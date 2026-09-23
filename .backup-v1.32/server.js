// server.js — 本地 Web 服务（静态 UI + JSON API）—— v1.6 多世界管理
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { makeStore, makeId, resBase, resAssets, loadMeta, saveMeta, worldsDir, worldFile, cardsDir, cardFile } = require('./src/store');
const { buildDemoWorld } = require('./src/world');
const AI = require('./src/ai');
const G = require('./src/game');
const IMP = require('./src/import');
const WG = require('./src/worldgen');
const PRES = require('./src/presentation');
const SCHED = require('./src/scheduler');
const VIS = require('./src/visual');

const BUILD = 'v1.32';
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
let previewMode = '';
let previewSelf = null;   // 用户自定义的玩家设定（User 设定，20.1）
let previewSetup = null;  // 设定核对结果（20.2 以世界为准）

const GL = (line) => {
  try { fs.appendFileSync(path.join(os.tmpdir(), 'worldsim.log'), new Date().toISOString() + ' [gen] ' + line + '\n'); } catch (e) { }
};
function tailFile(f, n) {
  try {
    const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
    return lines.slice(-(n || 40)).join('\n');
  } catch (e) { return '（无日志或不可读）'; }
}

// ---------- 世界存取（多世界：meta.json 注册表 + worlds/<id>.json） ----------
function saveWorld(data, name) {
  const id = makeId('w');
  fs.mkdirSync(worldsDir(), { recursive: true });
  fs.writeFileSync(worldFile(id), JSON.stringify(data, null, 1));
  const meta = loadMeta();
  meta.worlds = meta.worlds || [];
  meta.worlds = meta.worlds.filter(w => w.id !== id);
  meta.worlds.push({ id, name: name || (data.meta && data.meta.name) || '未名之地', era: (data.meta && data.meta.era) || '', saved: new Date().toISOString() });
  meta.current = id;
  saveMeta(meta);
  current = data; currentId = id;
  menuMode = false;
  return id;
}
function loadWorld(id) {
  const fp = worldFile(id);
  if (!fs.existsSync(fp)) return null;
  try {
    const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (d) d.id = makeId; // JSON 序列化会丢函数，加载时补
    try { const n = G.mergeDupPersons(d); if (n > 0) { fs.writeFileSync(fp, JSON.stringify(d, null, 1)); console.log('[world] 合并重复实体 ' + n + ' 个'); } } catch (e) { console.error('[merge]', e.message); }
    // 画指令打架修复：旧档残留的 AI 画/旧布局缓存一律作废（画=引擎程序大图唯一来源）
    try { if (d && d.current) { delete d.current.sceneArtAI; delete d.current.artCache; } } catch (e) { }
    // v1.10：旧档补相册——手机工具/手机设备缺 album app → 补上（图库是磁盘持久化的） */
    try {
      for (const t of ((d.meta && d.meta.tools) || [])) {
        if (t && t.id === 'phone' && Array.isArray(t.apps) && t.apps.indexOf('album') < 0) t.apps.push('album');
      }
      if (d.current && d.current.device && Array.isArray(d.current.device.apps) && /手机|phone/.test(String(d.current.device.name || '')) && d.current.device.apps.indexOf('album') < 0) d.current.device.apps.push('album');
    } catch (e) { }
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
    } catch (e) { }
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
        d.impressions[id] = { stage: here ? 2 : 0, seen: !!here, traits: [], notes: [], bonds: [], nameKnown: here ? (ent.name || id) : null };
      }
      if (Object.keys(d.impressions).length) console.log('[impression] 迁移印象档: ' + Object.keys(d.impressions).length + ' 个');
    } catch (e) { }
    // v1.7：旧档兼容——工具清单由载体推导（注册表）；v1.9：缺失随身设备→按载体补一个（手机/大哥大/无）
    try { if (d && d.meta && (!Array.isArray(d.meta.tools) || !d.meta.tools.length)) d.meta.tools = PRES.deriveTools(d.meta.carries || {}, d.meta.era || '', d.meta.name || ''); } catch (e) { }
    try {
      if (d && d.current && !d.current.device) {
        const t = (d.meta && d.meta.tools) || [];
        const d1 = t.find(x => x.id === 'brick'), d2 = t.find(x => x.id === 'phone'), d3 = t.find(x => x.id === 'talisman');
        if (d1) d.current.device = { name: d1.name, icon: d1.icon, apps: d1.apps || ['sms', 'contacts'] };
        else if (d2) d.current.device = { name: d2.name, icon: d2.icon, apps: d2.apps || ['sms', 'contacts'] };
        else if (d3) d.current.device = { name: d3.name, icon: d3.icon, apps: d3.apps || ['sms', 'contacts'] };
      }
    } catch (e) { }
    return d;
  } catch (e) { return null; }
}
function unloadWorld() {
  current = null; currentId = null; menuMode = true;
}
function persist() {
  if (!current || !currentId) return;
  try { fs.writeFileSync(worldFile(currentId), JSON.stringify(current, null, 1)); } catch (e) { console.error('[persist]', e.message); }
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
    try { p = p.split(nm).join(''); } catch (e) { }
  }
  p = p.replace(/[，,]{2,}/g, '，').replace(/[，,]\s*$/g, '').replace(/\s{2,}/g, ' ').trim();
  return p;
}
// 提示词→图缓存（同提示词不再重画：效率 + 一致性；key=sha1(最终提示词)）
function promptCacheDir() { return path.join(resBase(), 'data', 'gallery', (currentId || 'none'), 'cache'); }
function promptCacheGet(h) {
  try { const f = path.join(promptCacheDir(), h + '.json'); if (fs.existsSync(f)) { const j = JSON.parse(fs.readFileSync(f, 'utf8')); if (j && j.id && fs.existsSync(path.join(path.join(resBase(), 'data', 'gallery', (currentId || 'none')), j.id + '.png'))) return j.id; } } catch (e) { }
  return null;
}
function promptCacheSet(h, id) {
  try { fs.mkdirSync(promptCacheDir(), { recursive: true }); fs.writeFileSync(path.join(promptCacheDir(), h + '.json'), JSON.stringify({ id: id })); } catch (e) { }
}
function sha1(s) { const c = require('node:crypto').createHash('sha1'); c.update(String(s || '')); return c.digest('hex'); }
function galleryDir() { return path.join(resBase(), 'data', 'gallery', (currentId || 'none')); }
function galleryRec(id) {
  const f = path.join(galleryDir(), 'gallery.json');
  try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); return (j.list || []).find(x => x.id === id) || null; } catch (e) { return null; }
}
function gallerySave(rec) {
  try {
    fs.mkdirSync(galleryDir(), { recursive: true });
    fs.writeFileSync(path.join(galleryDir(), rec.id + '.png'), rec.buf);
    delete rec.buf;
    const f = path.join(galleryDir(), 'gallery.json');
    let j = { list: [] };
    try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { }
    j.list = (j.list || []).filter(x => x.id !== rec.id);
    j.list.push(rec);
    if (j.list.length > 400) j.list = j.list.slice(-400);
    fs.writeFileSync(f, JSON.stringify(j, null, 1), 'utf8');
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
function wfInject(wf, prompt, neg) {
  if (!wf || typeof wf !== 'object') return null;
  let raw = JSON.stringify(wf);
  if (raw.indexOf('%prompt%') >= 0 || raw.indexOf('%negative_prompt%') >= 0) {
    raw = raw.split('%prompt%').join(String(prompt || '').slice(0, 1500));
    raw = raw.split('%negative_prompt%').join(String(neg || '').slice(0, 500));
    try { const j = JSON.parse(raw); return j; } catch (e) { }
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
  return hit ? wf : null;
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
  return new Promise((resolve, reject) => {
    const job = async () => {
      __imgBusy = true;
      try { await run(); } catch (e) { /* run 内部已回 onState */ } finally {
        __imgBusy = false;
        const nx = __imgQ.shift();
        if (nx) nx();
      }
    };
    if (__imgBusy) { __imgQ.push(job); return; }
    job();
  });
}
async function comfyRender(task, onState) {
  const im = task || {};
  const base = String((cfg.image && cfg.image.base) || '').replace(/\/$/, '');
  const wfRaw = (cfg.image && cfg.image.workflowJson) || '';
  if (!base) { onState && onState('fail', '未配置 ComfyUI 地址'); return null; }
  if (!wfRaw) { onState && onState('fail', '未导入工作流（服务器当前 image 配置：enabled=' + (cfg.image && cfg.image.enabled) + ' base=' + (cfg.image && cfg.image.base) + ' workflow=' + (cfg.image && cfg.image.workflow) + ' len=' + String(wfRaw).length + '）——请在设置→生图→导入工作流，导入即生效'); return null; }
  let wf = null;
  try { wf = JSON.parse(wfRaw); } catch (e) { onState && onState('fail', '工作流 JSON 损坏'); return null; }
  const names = (im.who || []).map(id => { try { const e = (current && current.entities && current.entities[id]) || {}; return e.name || id; } catch (e2) { return id; } });
  const prm = buildFinalPrompt(im, names);
  if (!prm) { onState && onState('fail', '无提示词（关闭了AI润色时应由规则装配，检查任务数据）'); return null; }
  // 提示词→图缓存：同提示词直接复用（不重画：效率与一致性）
  const h = sha1(prm);
  try {
    const cachedId = promptCacheGet(h);
    if (cachedId) {
      const buf = fs.readFileSync(path.join(galleryDir(), cachedId + '.png'));
      onState && onState('done', null, buf, prm);
      return { id: cachedId, buf, cached: true, prompt: prm };
    }
  } catch (e) { }
  wf = wfInject(wf, prm, (cfg.image && cfg.image.neg) || '');
  if (!wf) { onState && onState('fail', '工作流中未找到文生图文本节点'); return null; }
  try {
    const pr = await fetch(base + '/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: wf }) });
    if (!pr.ok) { onState && onState('fail', '提交失败 HTTP ' + pr.status); return null; }
    const pj = await pr.json();
    const pid = pj.prompt_id;
    if (!pid) { onState && onState('fail', '无 prompt_id'); return null; }
    for (let i = 0; i < 60; i++) {
      await new Promise(rs => setTimeout(rs, 2000));
      try {
        const hres = await fetch(base + '/history/' + pid);
        const hj = await hres.json();
        const entry = hj[pid];
        // ComfyUI 执行错误：直接把服务端报错捞出来（界面红字）
        if (entry && entry.status && entry.status.status_str === 'completed' && (!entry.outputs || !Object.keys(entry.outputs).length)) {
          onState && onState('fail', '工作流空转（执行完成但无图片输出）：导入的工作流可能没连成形或缺少 SaveImage 节点——请用 ComfyUI 的「Save (API Format)」导出后重新导入'); return null;
        }
        if (entry && entry.status && entry.status.status_str === 'error') {
          let msg = '';
          try { const msgs = entry.messages || []; msg = msgs.filter(m => m[0] === 'execution_error').map(m => JSON.stringify(m[1] || {}).slice(0, 500)).join('；'); } catch (e2) { }
          onState && onState('fail', 'ComfyUI 执行出错：' + (msg || '（见 ComfyUI 界面红色错误）'));
          return null;
        }
        if (entry && entry.outputs) {
          for (const nid of Object.keys(entry.outputs)) {
            const imgs = (entry.outputs[nid].images) || [];
            if (imgs.length) {
              const img0 = imgs[0];
              const q = 'filename=' + encodeURIComponent(img0.filename) + '&subfolder=' + encodeURIComponent(img0.subfolder || '') + '&type=' + encodeURIComponent(img0.type || 'output');
              const ir = await fetch(base + '/view?' + q);
              if (ir.ok) {
                const buf = Buffer.from(await ir.arrayBuffer());
                const gid = (im.id || ('g' + Date.now().toString(36)));
                try { promptCacheSet(h, gid); } catch (e) { }
                onState && onState('done', null, buf, prm);
                return { id: gid, buf, prompt: prm };
              }
            }
          }
          break;
        }
      } catch (e) { }
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
  return { baseURL: (cfg.llm && cfg.llm.baseURL) || '', apiKey: (cfg.llm && cfg.llm.apiKey) || '', model: (cfg.llm && cfg.llm.model) || '', port: cfg.port || 3088, maxTokens: (cfg.llm && cfg.llm.maxTokens) || 32768, playerName: cfg.playerName || '你', msgModel: (cfg.roles && cfg.roles.msg && cfg.roles.msg.model) || '', userSelf: cfg.userSelf || {}, image: cfg.image || { enabled: false, base: '', workflow: '', mode: 'zit' } };
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
    mode: mode || (pk.__mode || 'llm')
  };
}

// ---------- HTTP ----------
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    // ---------- GET API ----------
    if (req.method === 'GET' && u.pathname.startsWith('/api/')) {
      if (u.pathname === '/api/state') {
        GL('api state (tick=' + new Date().getTime() + ')');
        if (menuMode || !current) return json(res, 200, { noWorld: true, mode: AI.isLive(cfg) ? 'live' : 'demo', config: configView(), currentWorld: (current && current.meta && current.meta.name) || null });
        const view = G.buildView(current);
        view.config = configView();
        return json(res, 200, view);
      }
      if (u.pathname === '/api/version') return json(res, 200, { build: BUILD, appDir: ASSETS, ok: true });
      if (u.pathname === '/api/worlds') {
        const meta = loadMeta();
        return json(res, 200, { list: (meta.worlds || []).slice().reverse(), current: currentId });
      }
      if (u.pathname === '/api/cards') {
        const meta = loadMeta();
        return json(res, 200, { list: (meta.cards || []).slice().reverse(), count: (meta.cards || []).length });
      }
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
        const TBL = ['meta', 'entities', 'relations', 'memories', 'impressions', 'knowledge', 'ledger', 'sceneLog', 'messages', 'news', 'archives', 'plans', 'claims', 'calendar', 'worldInfo', 'current'];
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
        } catch (e) { }
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
      let p = {};
      try { p = JSON.parse(raw || '{}'); } catch (e) { return json(res, 400, { err: 'body not json' }); }

      if (u.pathname === '/api/settings') {
        const next = AI.saveConfig({ baseURL: p.baseURL, apiKey: p.apiKey, model: p.model, playerName: p.playerName, maxTokens: p.maxTokens, roles: p.roles, port: p.port, image: p.image });
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
      if (u.pathname === '/api/comfy/render') {
        const id = String(p.id || '');
        const task = ((current && current.current && current.current.imgTasks) || []).find(t => t.id === id && t.ai);
        if (!task) return json(res, 200, { err: '任务不存在或未生成提示词' });
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
        fs.writeFileSync(path.join(dir, name), txt, 'utf8');
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
          if (look) { try { saveWorld(current, (current.meta && current.meta.name) || '未命名世界'); } catch (e2) { } }
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
            saveWorld(current, (current.meta && current.meta.name) || '未命名世界');
          }
        } catch (e0) { }
        const prof = e.profile || {};
        const dyn = Object.values((prof.visual || {}).dynamic || {}).join('；');
        const img = { who: [id], state: String((prof.desires || {}).现在想 || '') + '；此刻：' + ((e.state || {}).mood || '平静') + (dyn ? '；' + dyn.slice(0, 60) : ''), scene: (current.entities[current.current.sceneId] || {}).name || '', note: '' };
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
        saveWorld(data, (pack.meta && pack.meta.name) || ck.name || '卡盒世界');
        return json(res, 200, { ok: true, card: ck.name || '', view: G.buildView(data) });
      }
      if (u.pathname === '/api/cards/del') {
        const id = String(p.id || '');
        const meta = loadMeta();
        meta.cards = (meta.cards || []).filter(c => c.id !== id);
        saveMeta(meta);
        try { fs.unlinkSync(cardFile(id)); } catch (e) { }
        return json(res, 200, { ok: true });
      }
      if (u.pathname === '/api/player-name') {
        const nm = String(p.name || '').slice(0, 20);
        AI.saveConfig({ playerName: nm });
        cfg = AI.loadConfig();
        if (current && nm && current.entities.player) { current.entities.player.name = nm; persist(); }
        return json(res, 200, { ok: true });
      }
      if (u.pathname === '/api/quit') {
        json(res, 200, { ok: true });
        setTimeout(() => { try { process.exit(0); } catch (e) { } }, 120);
        return;
      }
      if (u.pathname === '/api/new') {
        const card = IMP.parseSource(p.src || 'text', p.payload || '');
        const scan = await IMP.scanCard(card, cfg);
        if (scan.pack && !(scan.pack.meta)) scan.pack = IMP.heuristicPack(card);
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
        if (p.preview) {
          return json(res, 200, { preview: packPreview(scan.pack, scan.mode) });
        }
        GL('导入 ' + (card.name || '未命名') + ' mode=' + scan.mode + ' greeting=' + (Number.isInteger(p.greeting) ? p.greeting : 0));
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
          mode: scan.mode || 'heuristic', scanned: new Date().toISOString()
        };
        meta.cards = meta.cards.filter(c => c.id !== rec.id);
        meta.cards.push(rec);
        saveMeta(meta);
        try {
          fs.mkdirSync(cardsDir(), { recursive: true });
          fs.writeFileSync(cardFile(rec.id), JSON.stringify({ id: rec.id, name: cn, era, mode: rec.mode, scanned: rec.scanned, pack: scan.pack }, null, 1));
        } catch (e) { console.error('[cardbox]', e.message); }
        const data = IMP.packToData(scan.pack, { greeting: Number.isInteger(p.greeting) ? p.greeting : 0 });
        saveWorld(data, (scan.pack.meta && scan.pack.meta.name) || card.name);
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
            GL('生成应用（无预览，直接生成）');
            const rp = await WG.genWorldPack(cfg, p.prompt || '', userSelf);
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
          previewPack = null; previewSelf = null; previewSetup = null;
          saveWorld(data, (data.meta && data.meta.name) || 'AI 生成世界');
          return json(res, 200, { ok: true, view: G.buildView(data) });
        }
        return json(res, 400, { err: '需要 preview 或 apply 参数' });
      }
      if (u.pathname === '/api/world/load') {
        const id = String(p.id || '');
        const d = loadWorld(id);
        if (!d) return json(res, 200, { err: '世界不存在或已损坏' });
        current = d; currentId = id; menuMode = false;
        return json(res, 200, { ok: true, view: G.buildView(d) });
      }
      if (u.pathname === '/api/world/del') {
        const id = String(p.id || '');
        try { fs.unlinkSync(worldFile(id)); } catch (e) { }
        const meta = loadMeta();
        meta.worlds = (meta.worlds || []).filter(w => w.id !== id);
        if (meta.current === id) { meta.current = null; unloadWorld(); }
        saveMeta(meta);
        return json(res, 200, { ok: true });
      }
      if (u.pathname === '/api/reset') {
        if (currentId) { try { fs.unlinkSync(worldFile(currentId)); } catch (e) { } }
        const meta = loadMeta();
        meta.worlds = (meta.worlds || []).filter(w => w.id !== currentId);
        meta.current = null;
        saveMeta(meta);
        unloadWorld();
        return json(res, 200, { noWorld: true });
      }
      if (!current) return json(res, 400, { err: 'noWorld' });
      if (u.pathname === '/api/turn/stream') {
        // 流式回合：主AI 输出delta 实时转发（打字机），结束时发完整 view
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'Connection': 'keep-alive' });
        try { G.mergeDupPersons(current); } catch (e) { }
        try {
          const r = await G.runTurn(current, p.text || '', cfg, {
            onDelta: (d) => { try { res.write('data: ' + JSON.stringify({ d: d }) + '\n\n'); } catch (e2) { } }
          });
          persist();
          try { res.write('data: ' + JSON.stringify({ view: r.view, recalled: r.recalled || [], intent: r.intent, applied: r.applied, errors: r.errors, fresh: r.fresh }) + '\n\n'); } catch (e2) { }
        } catch (e2) {
          try { res.write('data: ' + JSON.stringify({ err: String(e2.message || e2) }) + '\n\n'); } catch (e3) { }
        }
        try { res.end(); } catch (e2) { }
        return;
      }
      if (u.pathname === '/api/turn') {
        try { G.mergeDupPersons(current); } catch (e) { }
        const r = await G.runTurn(current, p.text || '', cfg);
        persist();
        return json(res, 200, r);
      }
      if (u.pathname === '/api/skip') {
        let r;
        if (p.type === 'sleep') r = await G.runTurn(current, '睡觉', cfg);
        else r = await G.runTurn(current, '等' + (p.minutes || 10) + '分钟', cfg);
        persist();
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
    try { json(res, 500, { err: String(e.message || e) }); } catch (e2) { }
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
  console.log('[world-sim] 构建 ' + BUILD + ' · 模式: ' + (AI.isLive(cfg) ? '接入模式(' + cfg.llm.model + ')' : '演示模式（未配置模型，请在游戏内 ⚙ 设置）'));
});
tryListen();
// 实际端口以监听为准（供 electron-main 读取）
server.__actualPort = () => listenPort;

module.exports = server;