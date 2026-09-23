// replay.js — 账本重放（v1.86）
// ─────────────────────────────────────────────────────────────
// 设计总稿 §3 原写"实体的当前状态 = 最近记录重放"，但**全项目从未实现**（grep `replay|重放|rebuild` = 0 命中），
// 状态一直是就地改写的 —— 于是那条不变量是**空的**（见《设计矛盾清单.md》M1）。
// v1.86 把它兑现成**一个明确划界的子集**，而不是继续喊口号：
//
//   【可重放】账本 = 真源
//     · current.sceneId          ← 类型"地点变化"（载荷 d.scene）
//     · memories                 ← 类型"记忆新增"（载荷 d.memId/owner/content/tags/impact）
//     · relations[].tone         ← 类型"关系变化"（载荷 d.npc/change）
//
//   【不可重放】它们**才是真源**，账本只是它们的影子（重放不出来，也不该假装能）
//     · impressions（玩家对人物的主观认知：stage/traits/notes/looks）
//     · knowledge.nameKnown / knownPeople / heardNews / readMsgs / knownDocs
//     · documents 的正文、worldinfo、framework、manifest
//     · player.inventory（物品由 tryPay/tryEarn 确定性改；账本里只有人话 desc）
//
//   【勘误事件】v1.98：类型"实体合并"**不重放**，只做 id 重定向 ——
//     它记录的是"世界发现自己认错了人"（两个人被并成一个）。账本里指向旧 id 的记录**不再被改写**
//     （那是历史），改由读侧把旧 id 解释成当前 id。见下面的 buildRedirect。
//
// 用途：① 常驻断言"重放 == 内存"（scripts/replay-check.js）② /api/diag 的存档自检
'use strict';
const DEG = require('./degraded');

/* 勘误表：旧 id → 当前 id。
   · 必须**两趟**扫（勘误一定排在它解释的那条记录之后，一趟顺序扫会错过）
   · 链条要回溯（C→B→A），并防环
   · 终点必须真的存在（指向一个已经被删掉的 id 等于没修）
   · 没有勘误时返回恒等映射 ⇒ 行为与 v1.97 逐字节一致（replay-check/rebuild-check 靠这条保持绿） */
function buildRedirect(ledger, data) {
  const map = new Map();
  for (const l of (ledger || [])) {
    if (!l || l.type !== '实体合并' || !l.d) continue;
    if (l.d.merged && l.d.kept) map.set(String(l.d.merged), String(l.d.kept));
  }
  if (!map.size) return (x) => x;
  const ents = (data && data.entities) || {};
  const resolve = (id) => {
    let cur = String(id);
    const seen = new Set();
    while (map.has(cur) && !seen.has(cur)) { seen.add(cur); cur = map.get(cur); }
    return ents[cur] ? cur : String(id);   // 终点不存在（或成环）→ 不动它：宁可保留旧 id，也不要指向虚空
  };
  return resolve;
}

function replay(data) {
  const out = { sceneId: '', memories: {}, relations: {}, steps: 0 };
  try {
    const led = data.ledger || [];
    const red = buildRedirect(led, data);
    for (const l of led) {
      if (!l) continue;
      out.steps++;
      const d = l.d || null;
      if (l.type === '地点变化' && d && d.scene) out.sceneId = d.scene;
      else if (l.type === '记忆新增' && d && d.owner) {
        out.memories[d.memId || l.ref || ('m' + out.steps)] = { owner: red(d.owner), content: d.content, tags: d.tags || [], impact: d.impact, t: l.t || '' };
      } else if (l.type === '关系变化' && d && d.npc) {
        out.relations[red(d.npc)] = d.change;
      }
    }
  } catch (e) { DEG.hit('replay.js', e); }
  return out;
}

// 与内存状态对账（只对"可重放子集"）
function check(data) {
  const r = replay(data);
  const diff = [];
  try {
    const liveScene = (data.current && data.current.sceneId) || '';
    if (r.sceneId && r.sceneId !== liveScene) diff.push('sceneId: 重放 ' + r.sceneId + ' ≠ 内存 ' + liveScene);
    // 记忆：账本里出现过的每一条，内存里都得还在（内容一致）
    for (const id of Object.keys(r.memories)) {
      const m = (data.memories || {})[id];
      if (!m) { diff.push('记忆丢失: ' + id); continue; }
      if (String(m.content || '') !== String(r.memories[id].content || '')) diff.push('记忆内容不一致: ' + id);
      if (String(m.owner || '') !== String(r.memories[id].owner || '')) diff.push('记忆归属不一致: ' + id);
    }
    // 关系：账本里最后一次改成的定性，内存里应一致
    for (const npc of Object.keys(r.relations)) {
      const live = (((data.relations || {}).player || {})[npc] || {}).tone;
      if (live !== r.relations[npc]) diff.push('关系不一致: ' + npc + '（重放 ' + r.relations[npc] + ' ≠ 内存 ' + live + '）');
    }
  } catch (e) { DEG.hit('replay.js', e); }
  return { ok: diff.length === 0, steps: r.steps, count: { memories: Object.keys(r.memories).length, relations: Object.keys(r.relations).length }, diff: diff.slice(0, 6) };
}
/* 重建：把"账本才有权威"的三样**按账本写回去**（对账失败时用）。
   边界（重要）：只动这三样；账本里没有的条目一律**不动** —— 因为账本自己会被留存策略裁剪，
   裁剪区间里的老记忆/老关系不该被"重建"抹掉。 */
function rebuild(data) {
  const r = replay(data);
  const applied = { sceneId: 0, memories: 0, relations: 0 };
  try {
    data.current = data.current || {};
    if (r.sceneId && data.current.sceneId !== r.sceneId) { data.current.sceneId = r.sceneId; applied.sceneId = 1; }
    data.memories = data.memories || {};
    for (const id of Object.keys(r.memories)) {
      const want = r.memories[id];
      const cur = data.memories[id];
      if (!cur) {
        /* v2.04 P1-2：**不写 weight** —— 原来这里把 weight 重置成 impact（未衰减值），
           等于"回档 = 所有记忆集体变深"。深度由 RT.memDepth 按 (impact, t, activations, λ) 现算，
           所以重建出来的记忆不带 weight 也是对的（读取侧本来就以 memDepth 为准）。
           时间用账本那一刻（原来写 t:'' → 算不出时间，衰减会得到 NaN）。 */
        data.memories[id] = { id: id, owner: want.owner, content: want.content, tags: want.tags || [], impact: want.impact == null ? 50 : want.impact, t: want.t || '', lastActivation: want.t || '', activations: 1, repeat: false };
        applied.memories++;
      } else if (String(cur.content || '') !== String(want.content || '') || String(cur.owner || '') !== String(want.owner || '')) {
        cur.content = want.content; cur.owner = want.owner; applied.memories++;
      }
    }
    data.relations = data.relations || {};
    data.relations.player = data.relations.player || {};
    for (const npc of Object.keys(r.relations)) {
      const rel = data.relations.player[npc];
      if (rel && rel.tone !== r.relations[npc]) { rel.tone = r.relations[npc]; applied.relations++; }
    }
  } catch (e) { DEG.hit('replay.js', e); }
  return { ok: true, applied: applied, check: check(data) };
}
module.exports = { replay, check, rebuild, buildRedirect };
