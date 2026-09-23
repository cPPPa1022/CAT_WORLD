'use strict';
/* name-gate-check.js —— v2.06：名字门控的"机制化"第一批（P1-1 E1/E2/E5/E6/E7b）
 *
 * 这一批修的东西有一个共同点：**玩家不该知道的名字，从结构上就该到不了他眼前**，
 * 而不是"每个新调用点记得写一行 viewName()"。任务书 P1-1 把这叫"把约定变成机制"。
 *
 * 本脚本只测**出口**（黑盒）：拿一个"玩家没见过、但就站在你面前、关系还有点僵"的人，
 * 然后检查送到玩家手里的东西（affordances / people / sceneLog / reaction）里有没有他的真名。
 *
 * 用法：node scripts/name-gate-check.js
 */
const path = require('path'), os = require('os'), fs = require('fs');
const TMP = path.join(os.tmpdir(), 'ws-namegate-' + Date.now());
process.env.WORLD_SIM_DATA = TMP; fs.mkdirSync(TMP, { recursive: true });
const ROOT = path.join(__dirname, '..');
process.env.WORLD_SIM_ASSETS = ROOT;
const W = require(ROOT + '/src/world');
const G = require(ROOT + '/src/game');
const GATE = require(ROOT + '/src/gate');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };

const newWorld = () => { const d = W.buildDemoWorld(); d.id = (p) => p + '_' + Math.random().toString(36).slice(2, 8); return d; };
const npcsOf = (d) => Object.values(d.entities).filter(e => e.type === 'person' && e.id !== 'player');
/* 把名字从**玩家自己的认知**里挖掉（经历 / owner=player 的记忆）。
   ★ v3.3：名字的知识面多了一条 —— gate.nameOf 现在会把"玩家的经历/记忆里出现过这个名字"
   当成已知的证据（见 gate.js · adoptSelfNames）。演示世界的玩家经历里就写着
   「当着阿岩的面说沈姨"这店再这样撑不了几年"」，所以**只删印象档已经造不出
   "玩家从没见过的人"了** —— 下面每一条断言的"不认识的人"都会当场变成"认识的人"。
   （这不是把测试改绿：makeUnknown 的注释本来就写着"变成玩家从没见过"，原先只是少做了一半。） */
const stripSelfName = (d, npc) => {
  const cut = (s) => String(s == null ? '' : s).split(npc.name).join('某个人');
  const walk = (o, dep) => {
    if (o == null || dep > 3 || typeof o !== 'object') return;
    for (const k of Object.keys(o)) { if (typeof o[k] === 'string') o[k] = cut(o[k]); else walk(o[k], dep + 1); }
  };
  walk((d.entities.player || {}).profile, 0);
  for (const m of Object.values(d.memories || {})) if (m && m.owner === 'player' && m.content) m.content = cut(m.content);
  d._selfNameSig = null;   // 让 nameOf 的幂等戳失效，下一次调用会重新对齐
};
const makeUnknown = (d, npc) => {
  delete d.impressions[npc.id];
  d.knowledge = d.knowledge || {};
  d.knowledge.knownPeople = (d.knowledge.knownPeople || []).filter(id => id !== npc.id);
  stripSelfName(d, npc);
};
const makeKnown = (d, npc, stage) => {
  d.impressions = d.impressions || {};
  d.impressions[npc.id] = { stage: stage || 2, seen: '黑色挎包', traits: ['话少'], notes: [], bonds: [], nameKnown: npc.name };
  d.knowledge.knownPeople = (d.knowledge.knownPeople || []).concat([npc.id]);
};

console.log('');
console.log('[A] E1 · 「道个歉」这条可点按钮里不许带真名');
{
  const d = newWorld();
  const npc = npcsOf(d)[0];
  makeUnknown(d, npc);
  npc.state.location = d.current.sceneId;                        // 就在你面前
  d.relations.player = d.relations.player || {};
  d.relations.player[npc.id] = { tone: '有点僵', causes: ['上周说重了话'] };
  const v = G.buildView(d);
  const ap = (v.affordances || []).find(a => a.label && a.label.indexOf('道个歉') >= 0);
  ok(!!ap, '紧张关系的同场 NPC 会产生「道个歉」这条 affordance');
  ok(ap && ap.action.indexOf(npc.name) < 0, '★ action 里没有真名（修之前是「我要给' + npc.name + '道歉」——点一下等于替玩家把名字打出去）');
  ok(ap && /门口那个人/.test(ap.action), '改用看得见的称呼：' + (ap ? ap.action : ''));
  const ab = (v.affordances || []).find(a => a.label && a.label.indexOf('搭话') >= 0);
  ok(ab && ab.action.indexOf(npc.name) < 0, '同一段的"搭话"也没有真名（对照物，本来是好的）');
}

console.log('');
console.log('[B] E5 · resolveSpeaker：不知道的名字不许回落成真名');
{
  const d = newWorld();
  const npc = npcsOf(d)[0];
  makeUnknown(d, npc);
  const got = G.resolveSpeaker(d, npc.id);
  ok(got.indexOf(npc.name) < 0, '★ 不认识的同场人 → 不给真名（实测："' + got + '"）');
  ok(!!got && got !== npc.id, '也不是 id 形态的称呼');
  makeKnown(d, npc, 3);
  const got2 = G.resolveSpeaker(d, npc.id);
  ok(got2 === npc.name, '打过交道的人 → 正常给名字（"' + got2 + '"）');
  ok(G.resolveSpeaker(d, 'player') === ((d.entities.player || {}).name || '你'), '玩家自己照旧');
}

console.log('');
console.log('[C] E2 · reaction：取"在场的人"、且过门控');
{
  const d = newWorld();
  const list = npcsOf(d);
  const away = list[0], here = list[1] || list[0];
  makeUnknown(d, away);
  away.state.location = 'p_elsewhere_never';        // 离镇三天的那种
  here.state.location = d.current.sceneId;
  const r = G.buildReaction(d, [{ type: '关系变化', target: away.id }]);
  ok(r.indexOf(away.name) < 0, '★ reaction 里没有那个人的真名');
  ok(/那个人|对方|心里记下/.test(r), '照常说得出话：' + JSON.stringify(r));
}

console.log('');
console.log('[D] E6 · 判据只有一把尺子（gate.nameOf）');
{
  const d = newWorld();
  const npc = npcsOf(d)[0];
  delete d.impressions[npc.id];
  stripSelfName(d, npc);                                                       // v3.3：认知那一面也要挖掉
  d.knowledge.knownPeople = (d.knowledge.knownPeople || []).concat([npc.id]);   // 在 knownPeople 里，但没有印象档
  const nm = GATE.nameOf(d, npc.id);
  ok(nm === null, 'nameOf：没有印象档就判"不该知道"（即使他在 knownPeople 里）');
  const scrubbed = GATE.scrubText(d, '今天' + npc.name + '来过。');
  ok(scrubbed.indexOf(npc.name) < 0, '★ scrubText 跟着同一把尺子把它洗掉：' + scrubbed);
}

console.log('');
console.log('[E] E7b · 「人物」面板不许列出"全世界"');
{
  const d = newWorld();
  const list = npcsOf(d);
  const away = list[0], here = list[1] || list[0];
  makeUnknown(d, away);
  makeUnknown(d, here);
  away.state.location = 'p_elsewhere_never';
  here.state.location = d.current.sceneId;
  const v1 = G.buildView(d);
  const ids1 = (v1.people || []).map(p => p.id);
  ok(ids1.indexOf(here.id) >= 0, '在场的人必须在（v1.86 那个修复不能被这次收窄弄丢）');
  ok(ids1.indexOf(away.id) < 0, '★ 没见过、也不在场的人**不在**人物面板里（修之前全世界 NPC 都在，显示为"你还不认识…"）');
  makeKnown(d, away, 2);
  const v2 = G.buildView(d);
  ok((v2.people || []).map(p => p.id).indexOf(away.id) >= 0, '一旦真的打过交道（有印象档），他就进来了');
}

console.log('');
console.log('==== name-gate-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
