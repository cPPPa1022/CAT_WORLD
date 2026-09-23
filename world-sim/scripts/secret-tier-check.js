// secret-tier-check.js — 知识门控的"秘密"这一档必须可达（v1.97 · X2/X3）
// 病（评审回执_v1.96 的 X2/X3，两份外部评审都没发现）：
//   `knowledge.person()` 原来只看"**有没有印象档这一行**"，而 v1.30 的载入迁移给**每个 person** 都建了行
//   ⇒ secret 档永远不可达 ⇒ 输出侧门控对人物永远不启用"不许出现"那一支；
//   人物面板也会列出世上每一个 NPC（"没有的不显示"失效）。
'use strict';
const path = require('path'), os = require('os'), fs = require('fs');
const TMP = path.join(os.tmpdir(), 'ws-secret-' + Date.now());
process.env.WORLD_SIM_DATA = TMP; fs.mkdirSync(TMP, { recursive: true });
const ROOT = path.join(__dirname, '..');
process.env.WORLD_SIM_ASSETS = ROOT;
const { buildDemoWorld } = require(ROOT + '/src/world');
const { makeId } = require(ROOT + '/src/store');
const K = require(ROOT + '/src/knowledge');
const GATE = require(ROOT + '/src/gate');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
console.log('');
console.log('知识门控：秘密档必须可达（X2/X3）');

/* v3.3：mk() 的语义是"印象表一张白纸的玩家"，那么**玩家自己的认知也得是白的** ——
   nameOf 现在会拿"经历/记忆里出现过这个名字"当已知证据（gate.js · adoptSelfNames），
   而演示世界的玩家经历里点着阿岩和沈姨的名字。不挖掉的话，
   下面"没有任何档 → secret"这类断言测的就不是印象表，而是玩家经历里写了谁。 */
const stripAllSelfNames = (d) => {
  const cut = (s, names) => { for (const n of names) s = s.split(n).join('某个人'); return s; };
  const names = Object.values(d.entities).filter(e => e.type === 'person' && e.id !== 'player' && e.name).map(e => e.name);
  const walk = (o, dep) => {
    if (o == null || dep > 3 || typeof o !== 'object') return;
    for (const k of Object.keys(o)) { if (typeof o[k] === 'string') o[k] = cut(o[k], names); else walk(o[k], dep + 1); }
  };
  walk((d.entities.player || {}).profile, 0);
  for (const m of Object.values(d.memories || {})) if (m && m.owner === 'player' && m.content) m.content = cut(m.content, names);
  d._selfNameSig = null;
};
const mk = () => { const d = buildDemoWorld(); if (!d.id) d.id = makeId; d.impressions = {}; d.knowledge.knownPeople = []; stripAllSelfNames(d); return d; };

// 1) 完全没有印象档 → secret
{
  const d = mk();
  ok(K.person(d, 'npc_2').tier === 'secret', '没有任何档 → secret（' + K.person(d, 'npc_2').tier + '）');
}
// 2) ★ 核心：只有一行"空档"（载入迁移的产物）也必须仍是 secret
{
  const d = mk();
  d.impressions.npc_2 = { stage: 0, seen: false, traits: [], notes: [], bonds: [], nameKnown: '阿岩' };
  ok(K.person(d, 'npc_2').tier === 'secret', '★ 只有空档（stage 0 / seen 空 / 只是数据字段填了名字）→ 仍是 secret（' + K.person(d, 'npc_2').tier + '）');
  ok(GATE.nameOf(d, 'npc_2') === null, '★ gate.nameOf 同步收紧 → null');
}
// 3) 真的见过 → inferable；知道名字 → known
{
  const d = mk();
  d.impressions.npc_2 = { stage: 1, seen: '你注意到：背着帆布工具袋', traits: [], notes: [], bonds: [] };
  ok(K.person(d, 'npc_2').tier === 'inferable', '见过面（stage 1）→ inferable');
  d.impressions.npc_2.stage = 2; d.impressions.npc_2.nameKnown = '阿岩';
  ok(K.person(d, 'npc_2').tier === 'known', 'stage 2 + 知道名字 → known');
}
// 4) 播种只碰"在场 / 画面里 / 已认识"的人
{
  const d = mk();
  d.entities.npc_far = { id: 'npc_far', type: 'person', name: '阿岩', tags: [], indexes: {}, profile: {}, locked: { core: 'x' }, state: { location: 'pl_5', mood: '平静' } };
  d.relations.player.npc_far = { tone: '未曾谋面', causes: [] };
  d.impressions.npc_far = { stage: 0, seen: '', traits: [], notes: [], bonds: [] };
  ok(K.person(d, 'npc_far').tier === 'secret', '不在场 + 空档 → secret（' + K.person(d, 'npc_far').tier + '）');
  // 前端"人物面板"取数规则：knownPeople ∪ 在场 ∪ impressions(stage>=1)
  const inPanel = Object.keys(d.impressions).filter(id => id !== 'player' && (d.impressions[id].stage || 0) >= 1);
  ok(inPanel.indexOf('npc_far') < 0, '★ 空档的人不会被人物面板列出来（当前会列出的：' + JSON.stringify(inPanel) + '）');
}
// 5) 源码层断言：不得把"有行"当成"见过"
{
  const src = fs.readFileSync(path.join(ROOT, 'src', 'knowledge.js'), 'utf8');
  ok(!/if \(!imp && !known\) return \{ tier: 'secret'/.test(src), '★ 旧判据（!imp && !known）已不存在');
  ok(/const saw = /.test(src), '★ 新判据 saw 在位（按 stage/seen 判）');
  const gm = fs.readFileSync(path.join(ROOT, 'src', 'game.js'), 'utf8');
  ok(/_here\[p\.id\]/.test(gm) && /_spoke\[p\.id\]/.test(gm), '★ 播种已收窄到"在场 / 画面里 / 已认识"（_here/_spoke）');
}
console.log('');
console.log('==== secret-tier-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
