// threads.js — **「悬着的线」的唯一推导点**（v1.93）
// ─────────────────────────────────────────────────────────────
// 为什么要收（审视 §3 / 交接文档 §6.98 已知未做）：
//   同一个「事件开始没有对应的结束」的折叠，原来**写了三份**：
//     · ai.js 的「未了的事」（给主 AI 的资料包）
//     · game.js 的 looseEndsView（给玩家的右栏）
//     · storyteller.js 的 threads（叙事者算张力用）
//   真源相同（都是账本），但代码三份 —— 改一处不会同步另两处，
//   而它们的**差别恰恰是设计的一部分**（谁能看见、看几条、文案给谁），
//   所以差别必须写成参数，不能写成三份拷贝。
//
// 这就是 `gate.nameOf` 立下的规矩（v1.84：一条规则、一处实现、两边都调它），照抄。
'use strict';
const DEG = require('./degraded');

// 每个受众看几条 —— **差别写在表里，不写在三个函数里**
const CAP = { ai: 6, player: 4, count: Infinity };

// 折叠：账本里「事件开始」而没有被「事件结束」关掉的，就是一条悬着的线。
// 返回 { name: 最后一条 ledger 记录 }（保留记录是为了拿 scene/visible，给门控用）
function openMap(data) {
  const opened = {};
  try {
    for (const l of ((data && data.ledger) || [])) {
      if (!l || !l.target) continue;
      if (l.type === '事件开始') opened[l.target] = l;
      else if (l.type === '事件结束') delete opened[l.target];
    }
  } catch (e) { DEG.hit('threads.js', e); }
  return opened;
}

/* 三条线，一个函数。
   audience: 'ai'     → 叙述者视角：不过滤（世界真相它本来就该知道），最多 6 条
             'player' → 玩家认知视图：**过门控**（secret 不给、没去过的地方不给），最多 4 条
             'count'  → 只数个数（叙事者算张力）。**故意不过滤** ——
                        它算的是「这个世界欠着多少事」，不是「玩家知道多少事」。
   返回 [{ id, name, why, t, visible, scene }]（结构化；文案由各出口自己拼） */
function list(data, audience) {
  const cap = (audience && CAP[audience] != null) ? CAP[audience] : CAP.ai;
  const opened = openMap(data);
  const all = Object.keys(opened);
  const out = [];
  for (const k of all) {
    const l = opened[k];
    if (audience === 'player') {
      // 门控：门控的这一条**只在这里**，不再散在出口处
      if (String(l.visible || 'scene') === 'secret') continue;
      const visited = (data.knowledge && data.knowledge.visited) || [];
      if (l.scene && visited.indexOf(l.scene) < 0) continue;
    }
    out.push({ id: l.id || '', name: String(k).slice(0, 40), why: String(l.cause || '').slice(0, 40),
      t: l.t || '', visible: String(l.visible || 'scene'), scene: l.scene || '' });
  }
  return (cap === Infinity) ? out : out.slice(-cap);
}

// 叙事者用：世界的总债（不过滤）
function count(data) { return Object.keys(openMap(data)).length; }

module.exports = { CAP: CAP, openMap: openMap, list: list, count: count };