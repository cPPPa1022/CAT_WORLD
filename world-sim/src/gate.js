// gate.js — 输出侧门控 + 冲突检查（v1.56）
// ─────────────────────────────────────────────────────────────
// 设计见《设计总稿.md》§28.11（A 类）与 §28.8（创造循环）。两件事：
//   ① **输出侧门控**：AI 写出来的画面里出现了"玩家还不该知道的名字" → **换成看得见的称呼**（打码）
//      为什么要有这一层：门控原来只在**输入侧**（给 AI 的资料包已过滤），但 AI 会**推断**、会**幻觉**出名字。
//   ② **冲突检查**：调取 → 输出 → **查是否与现有数据冲突** = 一次创造循环；冲突事实回执给 AI 修订；
//      ≤2 轮仍不收敛 → 交给修复模式（repair）。
// 全部确定性、0 token。
'use strict';
const DEG = require('./degraded');
const K = require('./knowledge');

// ---------- 输出侧门控：把不该出现的名字换成"看得见的称呼" ----------
function scrubText(data, s, hits) {
  let out = String(s == null ? '' : s);
  if (!out) return out;
  for (const id of Object.keys(data.entities || {})) {
    const e = data.entities[id];
    if (!e || e.type !== 'person' || id === 'player' || !e.name) continue;
    /* v2.06 修 P1-1 E6：判据从 K.person 换成 **GATE.nameOf** ——
       在此之前，"该不该洗"这件事有两套尺子（gate.js 自己的注释还写着"一条规则、一处实现"，
       但 scrubText 这一支从来没过 nameOf）：nameOf 拦 id 形态名、且要求有印象档；
       K.person 没有 id 形态判据，在 knownPeople 里但没印象档时还会判成"可推断"。
       两者今天恰好一致，靠的是"载入期给每个人播了印象档"（见 E7），也就是靠巧合。
       现在：**判定走 nameOf（唯一真源）**，K.person 只负责提供替换文案（怎么称呼/为什么）。 */
    if (nameOf(data, id)) continue;                   // 该知道的，正常写（本文件内的唯一判据）
    if (out.indexOf(e.name) < 0) continue;            // 没提到，不用管
    const g = K.person(data, id);
    const as = g.as || '一个看不清面孔的人';
    out = out.split(e.name).join(as);
    if (hits && !hits.some(h => h.id === id)) hits.push({ id: id, name: e.name, as: as, why: g.why, tier: g.tier });
  }
  return out;
}
// 打码一整个 frame（beats 的所有文本字段 + tag）
function scrubFrame(data, frame) {
  const hits = [];
  if (!frame) return { frame: frame, hits: hits };
  const f = JSON.parse(JSON.stringify(frame));
  f.tag = scrubText(data, f.tag, hits);
  for (const b of (f.beats || [])) {
    b.text = scrubText(data, b.text, hits);
    b.action = scrubText(data, b.action, hits);
    b.expression = scrubText(data, b.expression, hits);
    b.voice = scrubText(data, b.voice, hits);
  }
  return { frame: f, hits: hits };
}

// ---------- 冲突检查（创造循环的第③步） ----------
// 返回 [{kind, why, ref, fix}]。**只报事实，不改数据**（改由 AI 修订或修复模式做）
function conflicts(data, updates, frame, ctx) {
  const out = [];
  const sid = data.current && data.current.sceneId;
  const beats = (frame && frame.beats) || [];
  const now = String((data.current && data.current.time) || '');
  const presentIds = {};
  for (const id of Object.keys(data.entities || {})) {
    const e = data.entities[id];
    if (e && e.type === 'person' && (e.state || {}).location === sid) presentIds[id] = true;
  }
  // ① 生死：已故者开口/行动
  for (const b of beats) {
    const who = b.speaker || b.actor;
    if (!who) continue;
    const e = data.entities[who];
    if (e && e.type === 'person' && (e.state || {}).alive === false) out.push({ kind: '生死', why: '已故的人（' + (e.name || who) + '）在本回合开口/行动了', ref: who, fix: '改成"有人提起 TA"或"回忆"' });
  }
  // ② 位置：不在场的人做在场的事
  for (const b of beats) {
    const who = b.speaker || b.actor;
    if (!who || presentIds[who]) continue;
    const e = data.entities[who];
    if (e && e.type === 'person' && (e.state || {}).location && (e.state || {}).location !== sid) out.push({ kind: '位置', why: (e.name || who) + ' 此刻不在这个场景（' + (e.state || {}).location + '），却在画面里动了', ref: who, fix: '先让它到场（移动/消息），或改成"听说"' });
  }
  // ③ 门控：画面里出现了玩家不该知道的名字
  for (const b of beats) {
    const leak = K.leaks(data, (b.text || '') + (b.action || ''));
    for (const nm of leak) out.push({ kind: '门控', why: '画面里出现了玩家还不该知道的名字「' + nm + '」', ref: nm, fix: '用看得见的称呼指代（引擎已自动打码，但请下次直接这么写）' });
  }
  // ④ 时间：Update 自带的时间早于当前
  for (const u of (updates || [])) {
    if (u && u.t && now && String(u.t) < now) out.push({ kind: '时间', why: 'Update 的时间(' + u.t + ')早于当前世界时间(' + now + ')', ref: u.type || '', fix: '去掉 t 字段（默认用当前时间）' });
  }
  // ⑤ 撞车：同一份文书短期重复登记（同一标题生成两次）
  try {
    const items = (data.manifest && data.manifest.items) || [];
    const recent = items.filter(x => (x.turn || 0) >= ((data.current && data.current.turnN) || 0) - 3);
    for (const u of (updates || [])) {
      if (u && u.type === '文档出现' && u.title) {
        const dup = recent.find(x => x.kind === '文档' && x.name === u.title);
        if (dup) out.push({ kind: '撞车', why: '「' + u.title + '」这份文书最近已经生成过一次（第 ' + (dup.turn || 0) + ' 回合）', ref: u.title, fix: '引用已有那份（它的 id 在 what:docs 里），不要重复创建' });
      }
    }
  } catch (e) { DEG.hit("gate.js", e); }
  // ⑥ 引用 unknown 箱里的东西
  for (const u of (updates || [])) {
    const t = String((u && u.target) || '');
    if (t && (data.unknown || []).some(x => x.what === t)) out.push({ kind: '引用', why: '引用了一个在 unknown 箱里的东西（' + t + '）——它本机不认识', ref: t, fix: '换成本机认识的对象，或先让它出箱' });
  }
  return out;
}
// 给 AI 的冲突回执
function render(cs) {
  if (!cs || !cs.length) return '';
  const L = ['【冲突回执】这一回合的提议与现有数据对不上（' + cs.length + ' 处）：'];
  for (const c of cs) L.push('· [' + c.kind + '] ' + c.why + (c.fix ? ('　→ ' + c.fix) : ''));
  L.push('请**只改这几处**，其余保持不动，重新输出一次 frame/updates。');
  return L.join(String.fromCharCode(10));
}
// ---------- v1.58 导演笔记门控：生图的提示词/画面笔记不许出现在正文里 ----------
// 用户实测：「我明明没开生图模块，却还是有对应的提示词以（）形式出现。」
// 根因：开关只拦了「登记 img 任务」和「前端画图位」，**没拦 AI 把导演笔记写进 beats 正文**；
//       而 sceneLog 会回喂给 AI（最近 24 条）→ 一旦漏进正文就自我强化。
// 判据：括号（中英文）里出现只可能属于导演的词 → 整段括号删掉（不是打码，是删：它本就不该给玩家看）。
const DIRECTOR_HINT = /画面笔记|画面要素|生图|配图|提示词|画师|镜头|机位|景深|构图|打光|光影|特写|近景|中景|远景|运镜|prompt|negative|nsfw|close.?up|shallow/i;
function scrubNotes(s, hits) {
  let out = String(s == null ? "" : s);
  if (!out) return out;
  const re = /[（(]([^（()）]{1,120})[)）]/g;
  out = out.replace(re, function (whole, inner) {
    if (DIRECTOR_HINT.test(inner)) { if (hits) hits.push(String(inner).slice(0, 40)); return ""; }
    return whole;
  });
  return out.replace(/[ \t]{2,}/g, " ").trim();
}
function scrubAll(data, frame) {
  const r = scrubFrame(data, frame);
  const nh = [];
  const f = r.frame;
  if (f) {
    f.tag = scrubNotes(f.tag, nh);
    for (const b of (f.beats || [])) { b.text = scrubNotes(b.text, nh); b.action = scrubNotes(b.action, nh); b.expression = scrubNotes(b.expression, nh); b.voice = scrubNotes(b.voice, nh); }
  }
  for (const n of nh) r.hits.push({ id: "", name: "导演笔记", as: "（已删）", why: "正文里出现了导演笔记/生图提示词：" + n, tier: "note" });
  return r;
}
/* ---------- 名字门控的**唯一执行点**（v1.84） ----------
   为什么要有它：同一件事原来有 7 份实现（game.js viewName / personView / buildAffordances、
   ai.js viewName / mockMain 内联、knowledge.js person、gate.js scrubText），条件各不相同，
   已经分叉出两个方向的漏：
     · nameKnown===false 时：玩家侧放行真名（因为只顾 user.name），AI 侧当作陌生人；
     · 名字恰是 id 形态时：玩家侧干净，**AI 侧照收** —— 而 AI 写出来的字才是玩家读到的那段。
   现在：一条规则、一处实现、两边都调它。
   规则：① 印象 stage>=2 才算"知道名字" ② nameKnown===false = 明确不知道
        ③ id 形态永不作为称呼 ④ 取 nameKnown 优先，其次实体真名。 */
const ID_SHAPE = /^[a-z]+[_-]?\d+$/i;
function nameOf(data, id) {
  if (!id) return null;
  if (id === 'player') return ((data.entities || {}).player || {}).name || '你';
  const e = (data.entities || {})[id];
  if (!e || e.type !== 'person') return null;
  const imp = (data.impressions || {})[id] || null;
  if (!imp) return null;
  if ((imp.stage || 0) < 2) return null;
  if (imp.nameKnown === false) return null;
  const nm = String(imp.nameKnown || e.name || '').trim();
  if (!nm || ID_SHAPE.test(nm)) return null;
  return nm;
}
/* ══════════════════════════════════════════════════════════════════════════
   事件裁决（v1.99 · P0-5 第 2 步）：**引擎自产的事件也得过同一道门**
   ──────────────────────────────────────────────────────────────────────────
   病（评审回执 P0-5 §3.3）：`validateUpdates` 只挡 AI 的 Update，而引擎自己往 news/calendar/
   候选池里塞的东西**从不经过任何门** —— 于是"世界里最大的事"反而是最没人管的那些。
   现在唯一裁决函数就是下面这个 admitEvent，四处规则依次执行：
     ① 归一化 + 枚举成员（`contract.normSev`：L1–L4 合法、L5 禁止、写坏的拒）
     ② 与世界上限 `meta.maxSeverity` 比大小（归一化失败回落 L2 并记账）
     ③ **L3+ 必须有前兆**（指得到一条已存在的伏笔：新闻 id / 世界日程条目 / 未闭合的事件开始 /
        同一人物的更早一环人事）。凭空发生的重大事件**拒绝并记账**，不是静默降级。
     ④ **L3+ 冷却**：提议类来源（`news`/`candidate`）每 `meta.gateDays`（缺省 7）世界日只放行一次；
        而**已排定**的来源（`chain` 人物链 / `yearly` 年度演算）不看冷却 ——
        它们的节奏由世界时间与前兆链本身给（前兆链就是它们的节奏），再抽签会让"该来的不来"。
        这一条是刻意的：门是防止"重大事件扎堆冒出来"，不是让排好的剧情卡死。
   两个轴仍然是两根（X12 的双轴切分）：`level` 是引擎的那根，`newsSeverity` 是上屏的那根；
   桥上只有一处（`contract.levelFromNews`）。 */
const CT = require('./contract');
const ROLLED_SOURCES = ['news', 'candidate'];          // 提议类：要看冷却
function dayStamp(iso) { return String(iso || '').slice(0, 10); }
function daysApart(a, b) {
  const x = new Date(String(a).slice(0, 10) + 'T00:00:00').getTime();
  const y = new Date(String(b).slice(0, 10) + 'T00:00:00').getTime();
  if (!isFinite(x) || !isFinite(y)) return 0;
  return Math.abs(x - y) / 86400000;
}
function gateState(data) {
  const c = (data && data.current) || (data.current = {});
  if (!c.gate || typeof c.gate !== 'object') c.gate = { lastL3Day: '', lastL3At: '', rejected: 0, lastReject: null };
  const g = c.gate;
  if (!Array.isArray(g.rejects)) g.rejects = [];
  if (!g.rejected) g.rejected = 0;
  return g;
}
function worldMax(data) { return CT.normSev((data.meta || {}).maxSeverity) || CT.MAX_DEFAULT; }
// 前兆：指得到一条**已经存在**的伏笔/前情。ref 可以是 id，也可以是下面两种前缀约定。
function foreshadowExists(data, ref) {
  const r = String(ref == null ? '' : ref).trim();
  if (!r) return false;
  try {
    if (/^人事:(.+)$/.test(r)) {                       // 同一人物的更早一环（人物链的前兆就是上一环）
      const who = r.replace(/^人事:/, '');
      return (data.ledger || []).some(l => l && l.type === '人事' && String(l.target || '').indexOf(who) >= 0
        && String(l.desc || '').indexOf('离世') < 0);
    }
    if ((data.news || []).some(n => n && n.id === r)) return true;
    if ((data.calendar || []).some(c => c && (c.id === r || String(c.title || '') === r))) return true;
    if ((data.ledger || []).some(l => l && l.id === r && l.type !== '实体合并')) return true;
    // 名字形式的伏笔（世界书/线索池）：账本或新闻标题里出现过
    if (r.length >= 2 && ((data.ledger || []).some(l => l && String(l.desc || '').indexOf(r) >= 0)
      || (data.news || []).some(n => n && (String(n.title || '').indexOf(r) >= 0 || String(n.summary || '').indexOf(r) >= 0)))) return true;
  } catch (e) { DEG.hit('gate.js', e); }
  return false;
}
/* 裁决一次事件。opts:
     source        'chain' | 'yearly' | 'news' | 'candidate' | 'engine'（决定要不要看冷却）
     level         L 级（不给就用 kind 的缺省）
     newsSeverity  上屏那根轴（低/中/高/灾难）；给了它而没给 level 时按桥换算
     kind          Update/事件类型（算缺省烈度用）
     at            事件发生的世界时间（算冷却用）
     foreshadowRef 前兆引用（L3+ 必须给，且必须指得到）
   返回 { ok, level, newsSeverity, why } */
function admitEvent(data, opts, now) {
  const o = opts || {};
  const at = String(o.at || now || (data.current && data.current.time) || '');
  const max = worldMax(data);
  const maxRaw = String((data.meta || {}).maxSeverity || '');
  if (maxRaw && !CT.normSev(maxRaw)) DEG.hit('gate.js', new Error('世界包的 maxSeverity 非法：' + maxRaw + ' → 回落 ' + max));
  const rawLevel = (o.level === undefined || o.level === null) ? '' : String(o.level).trim();
  let lv = CT.normSev(rawLevel);
  const ns = K.newsSeverity(o.newsSeverity);
  if (!lv && ns) lv = CT.levelFromNews(ns);
  /* 显式给了值、但认不出来 —— 分两种（与 validateUpdates 的烈度门同一套判据）：
     "像 L 但写坏"（L9/l5/3）→ 拒（这是**给错了**）；
     别的词表的词（低/中/高/灾难，已经由上面的桥接走）→ 不属于这根轴，不该在这里报错。 */
  if (!lv && rawLevel && (CT.isLish(rawLevel) || /^\d+$/.test(rawLevel))) {
    return { ok: false, level: '', newsSeverity: ns, why: '事件烈度取值非法：' + rawLevel + '（合法取值 L1–L4）' };
  }
  if (!lv) lv = CT.sevDefault(o.kind);
  if (!CT.RANK[lv]) return { ok: false, level: '', newsSeverity: ns, why: '烈度取值非法：' + JSON.stringify(o.level) };
  if (CT.RANK[lv] > CT.RANK[max]) return { ok: false, level: lv, newsSeverity: ns, why: '事件烈度 ' + lv + ' 超过世界上限 ' + max };
  const heavy = CT.RANK[lv] >= 3;
  if (heavy && !foreshadowExists(data, o.foreshadowRef)) {
    return { ok: false, level: lv, newsSeverity: ns, why: 'L3+ 事件必须有前兆（凭空发生的重大事件不许落库）：' + lv + ' / ' + String(o.kind || o.source || '') };
  }
  if (heavy && ROLLED_SOURCES.indexOf(String(o.source || '')) >= 0) {
    const g = gateState(data);
    const days = Number((data.meta || {}).gateDays);
    const N = (isFinite(days) && days > 0) ? Math.floor(days) : 7;
    if (g.lastL3Day && daysApart(g.lastL3Day, at) < N) {
      return { ok: false, level: lv, newsSeverity: ns, why: '距上次重大事件不满 ' + N + ' 世界日（' + g.lastL3Day + '）—— 节奏门' };
    }
  }
  return { ok: true, level: lv, newsSeverity: ns || (CT.RANK[lv] >= 3 ? '高' : '低'), why: '' };
}
// 放行之后记一笔（冷却的状态住在这里 —— 只有真落了库的事件才算"最近一次重大事件"）
function noteAdmitted(data, ad, at) {
  if (!ad || !ad.ok) return;
  try {
    const g = gateState(data);
    if (CT.RANK[ad.level] >= 3) { g.lastL3Day = dayStamp(at); g.lastL3At = String(at || ''); }
    g.last = { at: String(at || ''), level: ad.level, newsSeverity: ad.newsSeverity };
  } catch (e) { DEG.hit('gate.js', e); }
}
/* 被拒的事件**留痕**（不是静默消失）：计数 + 最近几条 + 生成清单一条。
   为什么用 manifest 而不是 ledger：ledger 是"世界里发生过什么"，一条"没发生的事"不属于它。 */
function noteRejected(data, ad, info) {
  try {
    const g = gateState(data);
    g.rejected = (g.rejected || 0) + 1;
    g.rejects = (g.rejects || []).concat([{ t: String((data.current || {}).time || ''), what: String((info && info.what) || '').slice(0, 60), why: String((ad && ad.why) || '') }]).slice(-8);
    if (info && info.record !== false) {
      try {
        require('./manifest').record(data, { kind: '拦截', id: 'gate', name: String((info && info.what) || '事件').slice(0, 40), schema: 'gate.event.v1', by: 'engine', note: String((ad && ad.why) || '') });
      } catch (e) { DEG.hit('gate.js', e); }
    }
  } catch (e) { DEG.hit('gate.js', e); }
}
// 给开发者视图看的现状（0 token；玩家侧看不到"门"这件事）
function gateView(data) { const g = gateState(data); return { lastL3Day: g.lastL3Day || '', rejected: g.rejected || 0, last: g.last || null, rejects: (g.rejects || []).slice(-4) }; }

module.exports = { DIRECTOR_HINT, scrubNotes, scrubAll, scrubText, scrubFrame, conflicts, render, nameOf,
  admitEvent, noteAdmitted, noteRejected, foreshadowExists, gateView, gateState, worldMax };
