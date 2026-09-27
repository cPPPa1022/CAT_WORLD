// query.js — 按需调取（v1.55）：引擎给**目录 + 引导**，AI 自己去取
// ─────────────────────────────────────────────────────────────
// 用户 2026-09-14 拍板：
//   · **读不设限制**（次数不限、条目不限）——「不要 OOC，还原为主」；限制读 = 逼 AI 猜，猜出来的才是 OOC
//     改用三个软办法：目录带尺寸 / 按需分页 / 软压力（查太多次就在回执里点名）
//   · **写才设限制**（创造循环 + 冲突检查 + 修复模式，见 §28.8）
// 四条硬规矩：① 只读 ② 门控（走 knowledge.js 那把尺子）③ 带出处 ④ **可失败**（查不到就说"没有"，不许编）
'use strict';
const DEG = require('./degraded');
const K = require('./knowledge');
const REC = require('./records');
const RT = require('./runtime');   // v2.04 P1-2：记忆深度（weight）的唯一计算点 —— 按需调取也按它排序

const WHATS = ['catalog', 'doc', 'docs', 'person', 'people', 'place', 'places', 'memory', 'ledger', 'scene', 'archive', 'news', 'framework', 'unknown', 'records', 'fx'];
const WHAT_DOC = {
  doc: '一份文书的正文（给 id 或 q 关键词）',
  docs: '你手上的文书清单',
  person: '一个人（给 id 或 q 名字；**玩家还没认识的，只会给你"看得见的样子"**）',
  people: '你认识/见过的人清单',
  place: '一个地点',
  places: '你知道的地点清单',
  memory: '某人记得什么（给 owner:id，AI 演 TA 要用）',
  ledger: '客观事件流（世界真相层；**只给 AI，绝不上玩家界面**）',
  scene: '最近的散文原文（给 n 条数）',
  news: '新闻/传闻（受 heardNews 门控）',
  framework: '这个世界的框架：词/型/律 + 演化日志',
  unknown: '存档里"引擎不认识、原样留着"的东西（unknown 箱）',
  records: '你亲历过的原文（认知轨；按天或关键词取回）',
  fx: '可用的演出原语 + 这个世界用过的演出名'
};
function nowIso() { return new Date().toISOString(); }
function cut(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) : s; }

// ---------- 目录：告诉 AI「这里有什么」+「这个世界**不会**有什么」 ----------
function catalog(data) {
  const k = data.knowledge || {};
  const c = (data.meta && data.meta.carries) || {};
  const rows = [
    ['文书', ((data.documents && k.knownDocs) || []).length + ' 份可读'],
    ['人物', ((k.knownPeople || []).length) + ' 个认识的，' + Object.keys(data.impressions || {}).length + ' 个见过的'],
    ['地点', (k.knownPlaces || []).length + ' 个'],
    ['记忆', Object.keys(data.memories || {}).length + ' 条'],
    ['事件流', (data.ledger || []).length + ' 条（客观层）'],
    ['你亲历', (data.experience || []).length + ' 条原文 + ' + Object.keys(data.dayDigest || {}).length + ' 天摘要'],
    /* v3.10：场景原文**按轮次可查**（打标记就是为了这一步：引用某件事时去调它）。 */
    ['场景原文', '第 0~' + ((data.current && data.current.turnN) || 0) + ' 轮都能取回（what:scene + turn:N 取那一轮；+ q:关键词 搜原话）'],
    ['消息', (data.messages || []).length + ' 条'],
    ['新闻', (data.news || []).length + ' 条'],
    ['框架', (data.framework ? ((data.framework.vocab && (data.framework.vocab.docKinds || []).length) || 0) + ' 个词 · ' + ((data.framework.types || []).length) + ' 个型 · ' + ((data.framework.rules || []).length) + ' 条律' : '未建立')],
    ['不认识的东西', (data.unknown || []).length + ' 块']
  ];
  // 负面清单：这个世界**不会有什么**（B2：1900 不会有智能手机）
  const no = [];
  const era = String((data.meta && data.meta.era) || '');
  if (c.time === 'none' || c.time === 'watch') no.push('没有手机（即时通讯不存在：只能当面说、托人带话、写信）');
  if (c.time === 'watch') no.push('没有手机/网络');
  if (c.news === 'oral') no.push('没有报纸/广播（消息靠口耳相传）');
  if (c.news === 'paper') no.push('没有网络新闻');
  if (/古|朝代|王朝|旧时|民国|不知年月/.test(era)) no.push('没有电、没有现代器械（电灯/电话/汽车都不存在）');
  if (c.map === 'paper' || c.map === 'compass') no.push('没有电子地图');
  if ((data.meta && data.meta.techItems || []).length) no.push('已知可用器物：' + data.meta.techItems.join('、'));
  return { rows: rows, negatives: no };
}
function renderCatalog(data) {
  const c = catalog(data);
  const L = ['【目录 · 这里有什么】'];
  for (const r of c.rows) L.push('- ' + r[0] + '：' + r[1]);
  L.push('【这个世界**不会**有什么】（不许凭空造出来）');
  L.push(c.negatives.length ? c.negatives.map(x => '- ' + x).join(String.fromCharCode(10)) : '- （没有特别限制）');
  L.push('【怎么问】query 里写 what（' + WHATS.join('/') + '），可带 id / q / owner / n / offset / limit；');
  L.push('一次可以带多条 items（**不设条数上限**）。查不到就老实说没有——**不许编**。');
  return L.join(String.fromCharCode(10));
}

// ---------- 取数据（全部只读） ----------
function one(data, q) {
  const w = String((q && q.what) || '').trim();
  const items = []; const notes = []; const misses = [];
  const push = (o) => items.push(Object.assign({ what: w }, o));
  const text = (s, max) => { const t = String(s == null ? '' : s); return { text: cut(t, max || 4000), len: t.length, more: Math.max(0, t.length - (max || 4000)) }; };
  if (w === 'catalog') { return { items: [{ what: 'catalog', title: '目录', text: renderCatalog(data) }], notes: notes, misses: misses }; }
  if (w === 'docs') {
    const ids = (data.knowledge || {}).knownDocs || [];
    for (const id of ids) { const d = (data.documents || {})[id]; if (d) push({ ref: id, title: d.title || '', t: d.t || '', by: 'world', brief: cut(String(d.body || '').replace(/\s+/g, ' '), 60) }); }
    return { items: items, notes: notes, misses: misses };
  }
  if (w === 'doc') {
    let d = q.id ? (data.documents || {})[q.id] : null;
    if (!d && q.q) d = Object.values(data.documents || {}).find(x => (x.title || '').indexOf(String(q.q)) >= 0 || (x.aliases || []).join('').indexOf(String(q.q)) >= 0);
    if (!d) { misses.push({ what: w, kind: 'badref', why: '没有这份文书（你给的 ' + (q.id || q.q || '?') + '）', suggest: '试试 what:docs 看你手上有什么' }); return { items: items, notes: notes, misses: misses }; }
    const g = K.doc(data, d.id);
    if (g.tier === 'secret') { misses.push({ what: w, kind: 'gated', why: g.why, suggest: '这份文书还没到你手上——不要引用它' }); return { items: items, notes: notes, misses: misses }; }
    push(Object.assign({ ref: d.id, title: d.title || '', t: d.t || '', by: d.source === 'backfill' ? 'engine(补录)' : 'ai' }, text(d.body, Number(q.limit) || 4000)));
    return { items: items, notes: notes, misses: misses };
  }
  if (w === 'person' || w === 'people') {
    let ids = [];
    if (w === 'people') ids = Object.keys(data.entities).filter(id => { const e = data.entities[id]; return e && e.type === 'person' && id !== 'player' && K.person(data, id).tier !== 'secret'; });
    else {
      let id = q.id;
      if (!id && q.q) { const nm = String(q.q); const hit = Object.values(data.entities).find(e => e.type === 'person' && e.name && e.name.indexOf(nm) >= 0); id = hit && hit.id; }
      if (!id || !data.entities[id]) {
        const cands = Object.keys(data.entities).filter(i => { const e = data.entities[i]; return e && e.type === 'person' && i !== 'player' && K.person(data, i).tier !== 'secret'; }).map(i => K.person(data, i).as + '(' + i + ')');
        misses.push({ what: w, kind: 'badref', why: '没有这个 id/名字：' + (q.id || q.q || '?'), suggest: cands.length ? ('你可能想找：' + cands.slice(0, 6).join('、')) : '你现在还不认识任何人' });
        return { items: items, notes: notes, misses: misses };
      }
      ids = [id];
    }
    for (const id of ids) {
      const e = data.entities[id]; const g = K.person(data, id);
      const p = e.profile || {};
      const body = [
        '称呼（你只能用这个）：' + (g.as || '（看不清）'),
        g.tier === 'known' ? '' : '★ 你还不知道 TA 的名字——**不许写出真名**',
        /* v1.97 ★ 修 X10：tier=secret 的人不该把客观档案交出去（外貌/性格/情绪/关系都是"谁都还不知道"的）。
           原来只挡住了"称呼"，档案照发。 */
        g.tier === 'secret' ? '（你还没见过 TA —— 这里没有任何可用的档案）' : ('外貌：' + (((p.appearance || {}).标志物) || '（未记）')),
        g.tier === 'secret' ? '' : ('表面：' + (((p.surface || {}).待人) || '（未记）')),
        g.tier === 'secret' ? '' : ('情绪：' + ((e.state || {}).mood || '') + (p.condition ? ('　心理：' + (typeof p.condition === 'string' ? p.condition : (p.condition.名 || '')) + ((e.state || {}).phase ? (' · ' + (e.state || {}).phase) : '')) : '')),
        g.tier === 'secret' ? '' : ('与你的关系：' + ((((data.relations || {}).player || {})[id] || {}).tone || '素不相识')),
        '门控：' + g.why
      ].filter(Boolean).join(String.fromCharCode(10));
      push({ ref: id, title: g.as || id, t: '', by: 'world', ...text(body, 2000) });
      if (g.tier !== 'known') notes.push('人物 ' + id + '：只能用「' + g.as + '」指代，**不许叫出真名**');
    }
    return { items: items, notes: notes, misses: misses };
  }
  if (w === 'place' || w === 'places') {
    const ids = (w === 'places') ? Object.keys(data.knowledge && data.knowledge.knownPlaces || {}) : [];
    const list = (w === 'places') ? ((data.knowledge || {}).knownPlaces || []) : [q.id];
    if (w === 'place' && (!q.id || !data.entities[q.id])) { misses.push({ what: w, kind: 'badref', why: '没有这个地点：' + (q.id || '?'), suggest: '用 what:places 看你走过的地方' }); return { items: items, notes: notes, misses: misses }; }
    for (const id of list) { const e = data.entities[id]; if (!e) continue; const g = K.place(data, id); if (g.tier === 'secret') { misses.push({ what: w, kind: 'gated', why: g.why, suggest: '没去过也没听说过的地方，不要提' }); continue; } push({ ref: id, title: e.name || '', t: '', by: 'world' }); }
    return { items: items, notes: notes, misses: misses };
  }
  if (w === 'memory') {
    const owner = String(q.owner || q.id || '');
    const ms = Object.values(data.memories || {}).filter(m => !owner || m.owner === owner).sort((a, b) => RT.memDepth(data, b) - RT.memDepth(data, a)).slice(0, Number(q.n) || 12);
    for (const m of ms) push({ ref: m.id, /* v1.97 ★ 修 X10：记忆条目标题原来是真名（绕过门控）→ 换同一把尺子的称呼 */
      title: (function () { try { return require('./knowledge').person(data, m.owner).as || m.owner; } catch (e) { return m.owner; } })(), t: m.t || '', by: 'world', ...text(m.content, 400) });
    if (!ms.length) misses.push({ what: w, kind: 'absent', why: '（这个人还没有任何记忆条目）', suggest: '可以让它在这个回合留下一条（记忆新增 Update）' });
    return { items: items, notes: notes, misses: misses };
  }
  if (w === 'ledger') {
    const rows = (data.ledger || []).slice(-(Number(q.n) || 20));
    for (const l of rows) push({ ref: l.id, title: l.type || '', t: l.t || '', by: 'world', ...text((l.desc || '') + (l.target ? (' @' + l.target) : ''), 300) });
    notes.push('这是**客观层**（可能含你没在场的事）——只许用来对齐世界事实，**不许直接写进玩家画面**');
    return { items: items, notes: notes, misses: misses };
  }
  /* ★ v3.10 · 按**轮次**取回那一轮的场景原文（用户 2026-09-27 说清了打标记的用途：
     「如果需要引用某件事情的时候（别忘了遗忘机制哈）可以直接去调取工具去看对应的场景原文
      （会有信息失真 当然这个是 ai 去判断的了）然后人物不就可以说对应的话了吗」）。
     · turn:N → 只要第 N 轮；from/to → 区间；q → 在原文里搜关键词；都不给 → 退回「最近 n 条」
     · 每条带 turn / 说话者 / 世界时间
     · 回执末尾附上**那一轮落下的记忆**（谁记得、现在多深、想起过几次）—— 遗忘机制就在这一栏：
       **查得到原文 ≠ 角色还记得**；能不能说出口，看 TA 的记忆深度。 */
  if (w === 'scene') {
    const log = data.sceneLog || [];
    const wantTurn = (q.turn != null && isFinite(Number(q.turn))) ? Number(q.turn) : null;
    const from = (q.from != null && isFinite(Number(q.from))) ? Number(q.from) : null;
    const to = (q.to != null && isFinite(Number(q.to))) ? Number(q.to) : null;
    const kw = String(q.q || '').trim();
    let rows = log;
    let how = '最近 ' + (Number(q.n) || 20) + ' 条';
    if (wantTurn != null) { rows = log.filter(l => Number(l.turn) === wantTurn); how = '第 ' + wantTurn + ' 轮'; }
    else if (from != null || to != null) { rows = log.filter(l => Number(l.turn) >= (from == null ? -Infinity : from) && Number(l.turn) <= (to == null ? Infinity : to)); how = '第 ' + (from == null ? '?' : from) + '~' + (to == null ? '?' : to) + ' 轮'; }
    else if (kw) { rows = log.filter(l => String(l.text || '').indexOf(kw) >= 0); how = '含「' + cut(kw, 20) + '」的原文'; }
    else rows = log.slice(-(Number(q.n) || 20));
    rows = rows.slice(0, 400);
    const nth = (l) => (l.turn != null && isFinite(Number(l.turn))) ? ('第 ' + Number(l.turn) + ' 轮 · ') : '';
    for (const l of rows) {
      const nm = l.speakerName || (l.speaker ? (function () { try { return require('./knowledge').person(data, l.speaker).as; } catch (e) { return l.speaker; } })() : '');
      push({ ref: '', title: nth(l) + (nm || l.type || ''), t: l.t || '', turn: l.turn, by: 'world', ...text(l.text, 400) });
    }
    if (!rows.length) misses.push({ what: w, kind: 'absent', why: '没有找到对应的场景原文（' + how + '）', suggest: '换 turn / 换关键词；或先看目录里的「你亲历」有多少条' });
    /* 那一轮落下的记忆：谁记得、多深 —— 遗忘机制的接口 */
    try {
      const turns = [];
      for (const l of rows) { const n = Number(l.turn); if (isFinite(n) && turns.indexOf(n) < 0) turns.push(n); }
      const mems = Object.values(data.memories || {}).filter(m => turns.indexOf(Number(m.turn)) >= 0);
      if (mems.length) {
        const byOwner = {};
        for (const m of mems) { const d = Math.round(RT.memDepth(data, m)); (byOwner[m.owner] = byOwner[m.owner] || []).push('（记得住程度 ' + d + '，想起过 ' + (m.activations || 1) + ' 次）' + cut(m.content, 70)); }
        for (const owner of Object.keys(byOwner)) {
          const as = (function () { try { return K.person(data, owner).as || owner; } catch (e) { return owner; } })();
          push({ ref: owner, title: nth({ turn: turns[0] }) + as + ' 记得的', by: 'world', ...text(byOwner[owner].join(String.fromCharCode(10)), 1200) });
        }
        notes.push('★ 上面是**当时的原话**（客观记录）。**查得到 ≠ 谁还记得**：每条记忆后面的「记得住程度」就是遗忘机制给 TA 的现状 —— 低就该记不清，高才记得住细节。');
      } else {
        notes.push('★ 上面是**当时的原话**（客观记录）。但这一轮**没有任何人留下记忆** —— 谁提起来都只能算道听途说，允许说不准。');
      }
    } catch (eM) { DEG.hit('query.js:sceneMem', eM); }
    return { items: items, notes: notes, misses: misses };
  }
  /* ★ v3.17 · 沉寂库（归档层）：**平时看不到，查得到**。归档 = 从眼前的可见降级成可调取；
     检索口径：关键词 / 涉及的人 / 轮次区间 / 条数。**照样过门控**。 */
  if (w === 'archive') {
    const rows = require('./creator').archiveView(data, q);
    for (const x of rows) {
      const rowTxt = Array.isArray(x.row) ? x.row.join('　') : String(x.row || '');
      let okRow = true;
      try { const GATE = require('./gate'); if (GATE && typeof GATE.scrubText === 'function') okRow = !!GATE.scrubText(data, rowTxt); } catch (e) { okRow = true; }
      if (!okRow) continue;
      push({ ref: x.panel || '', title: '第' + (x.turn == null ? '?' : x.turn) + '轮 · ' + (x.panel || '') + '（归档）', t: x.at || '', turn: x.turn, by: 'world', ...text(rowTxt, 200) });
    }
    if (!rows.length) misses.push({ what: w, kind: 'absent', why: '沉寂库里没有匹配的东西', suggest: '换关键词 / 时间或轮次；归档是「降级不是删」' });
    notes.push('这是**归档层**：它们已经从眼前的模块里退下来了（寿命到了或被判过时），原文仍在，查得到。');
    return { items: items, notes: notes, misses: misses };
  }
  if (w === 'news') {
    for (const n of (data.news || [])) { const g = K.newsItem(data, n.id); if (g.tier === 'secret') continue; push({ ref: n.id, title: n.title || '', t: n.t || '', by: 'world', ...text(n.summary || '', 300) }); }
    return { items: items, notes: notes, misses: misses };
  }
  if (w === 'framework') {
    const f = data.framework || {};
    const v = f.vocab || {};
    const body = ['可读文本类型：' + ((v.docKinds || []).join('、') || '（无）'),
      '演出名：' + (Object.keys(v.fxNames || {}).map(k => k + '(' + v.fxNames[k].sig + ')').join('、') || '（无）'),
      '型：' + ((f.types || []).map(t => t.name + '(' + (t.fields || []).join('/') + ')').join('；') || '（无）'),
      '律：' + ((f.rules || []).map(r => r.name + '=' + (r.items || []).join('|') + (r.frozen ? '(已冻结)' : '')).join('；') || '（无）'),
      '演化日志（最近）：' + ((f.log || []).slice(-8).map(x => x.what + ':' + (x.name || '')).join('、') || '（无）')].join(String.fromCharCode(10));
    push({ ref: 'framework', title: '世界的框架', by: 'engine', ...text(body, 2000) });
    return { items: items, notes: notes, misses: misses };
  }
  if (w === 'unknown') {
    for (const u of (data.unknown || []).slice(0, Number(q.n) || 20)) push({ ref: '', title: u.what || '', t: u.t || '', by: 'import', ...text((u.why || '') + (u.blob ? ('｜原始：' + JSON.stringify(u.blob).slice(0, 200)) : ''), 300) });
    if (!(data.unknown || []).length) misses.push({ what: w, kind: 'absent', why: '（unknown 箱是空的——没有引擎不认识的东西）', suggest: '' });
    return { items: items, notes: notes, misses: misses };
  }
  if (w === 'records') {
    if (q.day || q.text || q.person) {
      const rows = REC.rawText(data, { day: q.day, text: q.text, n: Number(q.n) || 20 });
      for (const l of rows) push({ ref: '', title: l.speaker || l.type || '', t: l.t || '', by: 'you', ...text(l.text, 300) });
      if (!rows.length) misses.push({ what: w, kind: 'archived', why: '这一段的原文不在最近记录里', suggest: '试试别的关键词，或 what:scene 看最近原文' });
    } else {
      const ex = REC.search(data, { text: q.q, person: q.person, n: Number(q.n) || 20 });
      for (const x of ex) push({ ref: x.id, title: x.day, t: x.t || '', by: 'you', ...text(x.action + (x.opLog ? ('｜' + x.opLog) : ''), 300) });
    }
    notes.push('这是**你亲历的**（认知轨）——天生不剧透');
    return { items: items, notes: notes, misses: misses };
  }
  if (w === 'fx') {
    const FX = require('./fx');
    const f = data.framework || {};
    push({ ref: 'fx', title: '可用的原语', by: 'engine', ...text(FX.ATOM_KEYS.join('、') + String.fromCharCode(10) + '这个世界用过的演出名：' + (Object.keys(((f.vocab || {}).fxNames) || {}).join('、') || '（无）'), 1200) });
    return { items: items, notes: notes, misses: misses };
  }
  misses.push({ what: w || '?', kind: 'badref', why: '不认识这个 what', suggest: '可用：' + WHATS.join('/') });
  return { items: items, notes: notes, misses: misses };
}

// ---------- 一次查询（可带多条 items；**不设条数上限**） ----------
function resolve(data, q) {
  const list = Array.isArray(q && q.items) ? q.items : [q || {}];
  const out = { items: [], notes: [], misses: [], bytes: 0 };
  for (const one1 of list) {
    const r = one(data, one1);
    out.items = out.items.concat(r.items);
    out.notes = out.notes.concat(r.notes);
    out.misses = out.misses.concat(r.misses);
  }
  for (const it of out.items) out.bytes += String(it.text || '').length;
  return out;
}
// ---------- 回执（给 AI 的） ----------
function render(res) {
  const L = [];
  if (res.items.length) {
    L.push('查到 ' + res.items.length + ' 条：');
    for (const it of res.items) {
      const head = '· [' + it.what + '] ' + (it.title || '') + (it.ref ? (' #' + it.ref) : '') + (it.t ? (' @' + String(it.t).slice(5, 16).replace('T', ' ')) : '') + (it.by ? (' （来自 ' + it.by + '）') : '');
      L.push(head);
      if (it.text) L.push(it.text);
      else if (it.brief) L.push(it.brief);
      if (it.more) L.push('（这条还有 ' + it.more + ' 字没给完——要就再查一次，带 offset:' + (it.text ? it.text.length : 0) + '）');
    }
  } else L.push('（没有查到东西）');
  for (const n of res.notes) L.push('⚠ ' + n);
  for (const m of res.misses) L.push('✘ 查不到（' + m.kind + '）：' + (m.what || '') + ' —— ' + m.why + (m.suggest ? ('　→ ' + m.suggest) : ''));
  L.push('（共 ' + res.bytes + ' 字。**查不到的就不要编**：要么按现有事实写，要么用 requests 去创造它。）');
  return L.join(String.fromCharCode(10));
}
// 留痕（给外部测试插件读；软件内不做界面）
function trace(data, q, res) {
  try {
    data.trace = data.trace || [];
    data.trace.push({ t: (data.current && data.current.time) || nowIso(), turn: (data.current && data.current.turnN) || 0, asked: q, items: res.items.length, misses: res.misses.length, bytes: res.bytes });
    if (data.trace.length > 100) data.trace.splice(0, data.trace.length - 100);
  } catch (e) { DEG.hit("query.js", e); }
}
module.exports = { WHATS, WHAT_DOC, catalog, renderCatalog, resolve, render, trace };
