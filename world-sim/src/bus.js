// bus.js — 世界写入总线（v2.01 · P0-6 第二批）
'use strict';
/* 为什么要有它（评审回执 P0-6，两位评审都点了名的那一条）：
   会改世界的路径散在好几处，各写各的 —— 主 AI 的 Update 走校验器，而引擎自己的 7 个生成器
   （人物/地点/物品/机构/动作/新闻/城市）**直接**写 data.entities / relations / impressions，
   自定义动作的 8 个效果又是一套。三套写入方式 = 三套规则 = 谁都可以在没人看着的地方改世界。
   总线要的是**一条通路**：提议 → 归一化 → 校验 → 执行 → 落账，任一段不过就**不写世界**。
   边界（刻意划清的）：
     · 总线只管"一次提交里的这些补丁"，**不持有跨回合状态**（纯函数式：离线断言脚本直接调 runTurn 时也成立）
     · `applyUpdates` 的内部**一字不动**（`updatetypes-check` 靠源码锚点守它）——update 类提议原样交给它
     · 不新增账目 type：能复用的都复用（replay.js 只认三类 + 勘误，新 type 会让对账报未知）
   补丁的形状（唯一一种，声明式）：
     { kind:'create', type, entity, relations?, impressions?, edgeBack?, knownPlaces?, knownOrgs?,
       customActions?, ledger?[], side?[] }
     { kind:'update', updates[], frame? }
   `side` 是**白名单副作用**（learnWord / manifest），它们在实体落库之后才跑 ——
   不是"想干什么干什么"的回调，这正是原来 7 个生成器各自为政的地方。 */
const DEG = require('./degraded');
const { getEntity, ledgerPush } = require('./store');
const CONTRACT = require('./contract');
const GATE = require('./gate');   // v2.03：admitEvent 的**唯一调用点**就在本文件

// 总线允许创建的实体类型（与 contract.CREATE_TYPES 同源）
function createTypes() { return (CONTRACT.CREATE_TYPES || ['person', 'place', 'item', 'org']); }
const SIDE_EFFECTS = ['learnWord', 'manifest'];

let __seq = 0;
function nextCommitId() { __seq++; return 'cm' + Date.now().toString(36) + '_' + __seq; }

/* ── ① 归一化：把提议变成"确定的补丁"，缺字段在这里就被挡下（不许默默补个默认值往下走） ── */
function normalize(data, p) {
  const prop = p || {};
  if (prop.kind === 'update') {
    if (!Array.isArray(prop.updates) || !prop.updates.length) return { ok: false, code: 'empty_updates' };
    return { ok: true, patch: { kind: 'update', updates: prop.updates, frame: prop.frame || null } };
  }
  if (prop.kind === 'create') {
    const e = prop.entity || {};
    if (!e.id) return { ok: false, code: 'no_id', what: prop.type };
    if (!e.name) return { ok: false, code: 'no_name', what: prop.type };
    // 类型可以写在提议上（prop.type），但**实体自己必须带上它** —— 否则落库的是个没有 type 的怪东西
    if (!e.type && prop.type) e.type = String(prop.type);
    if (createTypes().indexOf(String(e.type || '')) < 0) return { ok: false, code: 'bad_type', what: String(e.type || prop.type || '') };
    const sides = [];
    for (const s of (prop.side || [])) {
      const doWhat = String((s && s.do) || '');
      if (SIDE_EFFECTS.indexOf(doWhat) < 0) return { ok: false, code: 'side_not_allowed', what: doWhat };
      sides.push(s);
    }
    return { ok: true, patch: {
      kind: 'create', ent: e, relations: prop.relations || null, impressions: prop.impressions || null,
      edgeBack: prop.edgeBack || null, knownPlaces: prop.knownPlaces || [], knownOrgs: prop.knownOrgs || [],
      customActions: prop.customActions || null, ledger: prop.ledger || [], side: sides,
      /* action = 动作注册表条目：它**不是实体**（不该进 data.entities），
         撞车检查也换成"注册表里有没有这个 id"。 */
      registryOnly: String(e.type || '') === 'action'
    } };
  }
  if (prop.kind === 'news' || prop.kind === 'candidate') {
    /* v2.03：新闻与候选也走总线 —— 于是 **GATE.admitEvent 全项目只有这一个调用点**
       （原来散在 6 个写入点：epoch 三处、director 一处、game 一处、runtime 两处）。
       两道门比一道门差：口径迟早分叉。 */
    const item = prop.item || {};
    if (!item.title && !item.text) return { ok: false, code: 'no_title' };
    /* ★ 提议上的 severity 与 item 里的都要收 —— 实测踩过：只收 item 的话，
       调用方写在提议上的"灾难"会被丢掉，于是这条新闻被按缺省 L1 放行（门形同虚设）。 */
    return { ok: true, patch: { kind: prop.kind, item: item, src: prop.source || 'news', level: prop.level || '', sev: prop.newsSeverity || '', foreshadowRef: prop.foreshadowRef || '', heard: prop.heard !== false } };
  }
  if (prop.kind === 'link') {
    /* v2.02：给**已存在**的实体加一条边（城市与主世界车站互连要用）。
       为什么要单独一种：它不创建实体，但仍然是对世界的写入 —— 也该过同一道门。 */
    if (!prop.from) return { ok: false, code: 'no_from' };
    if (!prop.edge || !prop.edge.to) return { ok: false, code: 'no_edge' };
    return { ok: true, patch: { kind: 'link', from: String(prop.from), edge: prop.edge } };
  }
  return { ok: false, code: 'unknown_proposal', what: String(prop.kind || '') };
}

/* ── ② 校验：一次提交里的每个补丁都要过（引用存在 / id 不撞车 / 动作注册表上限） ── */
function validate(data, patch, batch) {
  if (patch.kind === 'update') return { ok: true };
  if (patch.kind === 'news' || patch.kind === 'candidate') {
    /* **唯一裁决点**（v2.03）：烈度上限 / L3+ 前兆 / 提议类节奏门，全在 admitEvent 里 */
    const ad = GATE.admitEvent(data, {
      source: patch.src, level: patch.level, newsSeverity: (patch.sev || patch.item.severity),
      kind: patch.kind === 'news' ? '新闻' : '候选',
      at: patch.item.t || (data.current && data.current.time),
      foreshadowRef: patch.foreshadowRef
    });
    if (!ad.ok) { GATE.noteRejected(data, ad, { what: String(patch.item.title || patch.item.text || '').slice(0, 40) }); return { ok: false, code: 'gate_rejected', why: ad.why, ad: ad }; }
    patch.ad = ad;
    return { ok: true };
  }
  if (patch.kind === 'link') {
    if (!getEntity(data, patch.from)) return { ok: false, code: 'bad_link_from', what: patch.from };
    if (!getEntity(data, patch.edge.to) && !(batch.ids && batch.ids[patch.edge.to])) return { ok: false, code: 'bad_link_to', what: String(patch.edge.to) };
    return { ok: true };
  }
  const e = patch.ent;
  if (!patch.registryOnly && (getEntity(data, e.id) || (batch.ids && batch.ids[e.id]))) return { ok: false, code: 'id_taken', what: e.id };
  if (patch.kind === 'create' && !patch.registryOnly && e.type === 'place' && patch.edgeBack) {
    /* 反向边必须指向一个**真实存在的**地方 —— 原来 genPlace 是"先建实体、再改反向边"，
       中间任何一步出问题都会留下半成品（评审点名的那个洞）。 */
    if (!getEntity(data, patch.edgeBack.from)) return { ok: false, code: 'bad_edge_from', what: String(patch.edgeBack.from) };
  }
  if (!patch.registryOnly && e.type === 'person' && e.state && e.state.location && !getEntity(data, e.state.location)) {
    /* 人的落点必须是真实地点：落点错了，present() 永远不认他（"该在场的人被判成不在场"） */
    return { ok: false, code: 'bad_location', what: String(e.state.location) };
  }
  if (patch.customActions) {
    const ids = Object.keys(patch.customActions);
    const have = Object.keys(data.customActions || {});
    if (have.length + ids.length > 3) return { ok: false, code: 'registry_full', what: ids.join(',') };
    for (const i of ids) if (have.indexOf(i) >= 0) return { ok: false, code: 'action_id_taken', what: i };
  }
  return { ok: true };
}

/* ── ③ 执行：先记现场（回滚用），再落地；这一步抛错就把这个补丁整个撤掉 ── */
function snapshot(data, patch) {
  const keys = ['entities', 'relations', 'impressions', 'customActions', 'current', 'news'];
  const snap = {};
  for (const k of keys) snap[k] = data[k] ? JSON.parse(JSON.stringify(data[k])) : data[k];
  snap.__knowledge = data.knowledge ? { knownPlaces: (data.knowledge.knownPlaces || []).slice(), knownOrgs: (data.knowledge.knownOrgs || []).slice(), heardNews: (data.knowledge.heardNews || []).slice() } : null;
  snap.__ledgerLen = (data.ledger || []).length;
  return snap;
}
function restore(data, snap) {
  for (const k of ['entities', 'relations', 'impressions', 'customActions', 'current', 'news']) if (snap[k] !== undefined) data[k] = snap[k];
  if (snap.__knowledge && data.knowledge) {
    data.knowledge.knownPlaces = snap.__knowledge.knownPlaces;
    data.knowledge.knownOrgs = snap.__knowledge.knownOrgs;
    data.knowledge.heardNews = snap.__knowledge.heardNews;
  }
  if (Array.isArray(data.ledger) && snap.__ledgerLen != null) data.ledger = data.ledger.slice(0, snap.__ledgerLen);
}
function execute(data, patch, out, ctx) {
  const e = patch.ent;
  if (!patch.registryOnly) data.entities[e.id] = e;   // 动作注册表条目不是实体
  if (patch.relations && typeof patch.relations === 'object') {
    data.relations = data.relations || {};
    for (const k of Object.keys(patch.relations)) data.relations[k] = patch.relations[k];
  }
  if (patch.impressions) { data.impressions = data.impressions || {}; Object.assign(data.impressions, patch.impressions); }
  if (patch.edgeBack) {
    const from = getEntity(data, patch.edgeBack.from);
    if (from) { from.edges = from.edges || []; from.edges.push(patch.edgeBack.edge); }
  }
  if (patch.knownPlaces.length || patch.knownOrgs.length) {
    data.knowledge = data.knowledge || {};
    if (patch.knownPlaces.length) { data.knowledge.knownPlaces = data.knowledge.knownPlaces || []; for (const p of patch.knownPlaces) if (data.knowledge.knownPlaces.indexOf(p) < 0) data.knowledge.knownPlaces.push(p); }
    if (patch.knownOrgs.length) { data.knowledge.knownOrgs = data.knowledge.knownOrgs || []; for (const o of patch.knownOrgs) if (data.knowledge.knownOrgs.indexOf(o) < 0) data.knowledge.knownOrgs.push(o); }
  }
  if (patch.customActions) { data.customActions = data.customActions || {}; Object.assign(data.customActions, patch.customActions); }
  for (const lg of (patch.ledger || [])) {
    const before = (data.ledger || []).length;
    ledgerPush(data, Object.assign({}, lg, { t: lg.t || (ctx && ctx.t) || (data.current && data.current.time) || '' }));
    if ((data.ledger || []).length > before) out.ledgerIds.push(data.ledger[data.ledger.length - 1].id);
  }
  for (const s of (patch.side || [])) {
    try {
      if (s.do === 'learnWord') require('./framework').learnWord(data, s.group, s.name);
      else if (s.do === 'manifest') require('./manifest').record(data, s.rec || {});
    } catch (e2) { DEG.hit('bus.js', e2); }
  }
}
/* ── 对外唯一入口 ──
   commit(data, proposals, ctx) → { id, committed[], rejected[], clockDelta, ledgerIds[] }
   · 每个补丁独立判、独立执行：一个坏不连累别人（但**它自己一个字段都不许落地**）
   · update 类走 applyUpdates（懒加载，避免 require 环） */
function commit(data, proposals, ctx) {
  const out = { id: nextCommitId(), committed: [], rejected: [], clockDelta: 0, ledgerIds: [] };
  const batch = { ids: {} };
  for (const p of (proposals || [])) {
    const n = normalize(data, p);
    if (!n.ok) { out.rejected.push(Object.assign({ stage: 'normalize' }, n)); continue; }
    const patch = n.patch;
    const v = validate(data, patch, batch);
    if (!v.ok) { out.rejected.push(Object.assign({ stage: 'validate' }, v)); continue; }
    const snap = patch.kind === 'update' ? null : snapshot(data, patch);
    try {
      if (patch.kind === 'news' || patch.kind === 'candidate') {
        const it = patch.item;
        const at = it.t || (data.current && data.current.time) || '';
        if (patch.kind === 'news') {
          data.news = data.news || [];
          const nid = it.id || (data.id ? data.id('nw') : ('nw_' + Date.now().toString(36)));
          data.news.push({ id: nid, t: at, title: String(it.title).slice(0, 60), summary: String(it.summary || '').slice(0, 200), tags: it.tags || [], region: it.region || '', severity: patch.ad.newsSeverity, impact: it.impact || { 时长: '短期', 范围: '本地' } });
          if (patch.heard) { data.knowledge = data.knowledge || {}; data.knowledge.heardNews = data.knowledge.heardNews || []; if (data.knowledge.heardNews.indexOf(nid) < 0) data.knowledge.heardNews.push(nid); }
          GATE.noteAdmitted(data, patch.ad, at);
          out.committed.push({ kind: 'news', id: nid, title: String(it.title).slice(0, 30) });
        } else {
          data.current.pendingCandidates = data.current.pendingCandidates || [];
          data.current.pendingCandidates.push({ id: (data.id ? data.id('cand') : ('cand_' + Date.now().toString(36))), text: String(it.text || it.title).slice(0, 120), type: it.type || '事件', expireAt: it.expireAt || require('./runtime').addMinutes(at, Number(it.expireM) || 90), sev: patch.ad.newsSeverity });
          GATE.noteAdmitted(data, patch.ad, at);
          out.committed.push({ kind: 'candidate', id: '', title: String(it.text || it.title).slice(0, 30) });
        }
        continue;
      }
      if (patch.kind === 'link') {
        const from = getEntity(data, patch.from);
        from.edges = from.edges || [];
        if (!from.edges.some(x => x && x.to === patch.edge.to)) from.edges.push(patch.edge);
        out.committed.push({ kind: 'link', id: patch.from, to: String(patch.edge.to) });
        continue;
      }
      if (patch.kind === 'update') {
        const G = require('./game');
        const vu = require('./runtime').validateUpdates(data, patch.updates, patch.frame || {}, ctx || {});
        if (vu.errors.length && !vu.allowed.length) { out.rejected.push({ stage: 'validate', code: 'updates_all_rejected', errors: vu.errors.slice(0, 3) }); continue; }
        const applied = G.applyUpdates(data, vu.allowed, (ctx && ctx.t) || data.current.time);
        out.committed.push({ kind: 'update', id: '', applied: applied, errors: vu.errors, rejected: vu.rejected });
        continue;
      }
      execute(data, patch, out, ctx);
      batch.ids[patch.ent.id] = true;
      out.committed.push({ kind: 'create', type: patch.ent.type, id: patch.ent.id, name: patch.ent.name });
    } catch (e) {
      if (snap) restore(data, snap);
      out.rejected.push({ stage: 'execute', code: 'commit_failed', what: String((patch.ent && patch.ent.id) || ''), why: String((e && e.message) || e).slice(0, 80) });
      DEG.hit('bus.js', e);
    }
  }
  return out;
}
module.exports = { commit, SIDE_EFFECTS, createTypes };
