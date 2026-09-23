// gate-channels-check.js — 输出侧门控的**通道覆盖**（v1.97 · X4/X5/X9/X10）
// 病（评审回执_v1.96）：门控只在 game.js 对 frame.beats 跑一次 ——
//   文书正文/落款、消息正文、列表摘要、按需调取的人物档案**全都是裸的**。
// 原则：玩家会读到的文本通道，都在它进视图的那一处过同一把尺子。
'use strict';
const path = require('path'), os = require('os'), fs = require('fs');
const TMP = path.join(os.tmpdir(), 'ws-channels-' + Date.now());
process.env.WORLD_SIM_DATA = TMP; fs.mkdirSync(TMP, { recursive: true });
const ROOT = path.join(__dirname, '..');
process.env.WORLD_SIM_ASSETS = ROOT;
const { buildDemoWorld } = require(ROOT + '/src/world');
const { makeId } = require(ROOT + '/src/store');
const G = require(ROOT + '/src/game');
const AI = require(ROOT + '/src/ai');
const QUERY = require(ROOT + '/src/query');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const FAKE = '独门秘境子';   // 全世界唯一的假名，避免撞上别处出现的字

// 造一个"玩家没见过"的人（空档 = secret），加上他写的文书与发来的消息
function scene() {
  const d = buildDemoWorld(); if (!d.id) d.id = makeId;
  d.impressions = {}; d.knowledge.knownPeople = [];
  d.entities.npc_zz = { id: 'npc_zz', type: 'person', name: FAKE, tags: [], indexes: { geo: [], org: [], family: [] },
    profile: { identity: { 身份: '隔壁那人' }, appearance: { 标志物: '腕上一道旧疤' }, surface: { 待人: '寡言' }, hidden: { 真实: '有旧账' }, desires: { 现在想: '试探你' }, schedule: {} },
    locked: { core: '性格内核：寡言' }, state: { location: 'pl_4', mood: '警惕' } };
  d.impressions.npc_zz = { stage: 0, seen: '', traits: [], notes: [], bonds: [], nameKnown: FAKE };   // ★ 空档但仍然填了名字
  d.relations.player = d.relations.player || {};
  d.relations.player.npc_zz = { tone: '素不相识', causes: [] };
  const doc = G.createDoc(d, { title: '一张字条', body: '这事只有' + FAKE + '知道，别外传。', from: FAKE, to: '你', kind: '字条' });
  d.messages.push({ id: d.id('msg'), from: 'npc_zz', to: 'player', body: FAKE + '：晚上别开灯。', t: d.current.time, status: 'unread' });
  return { d, doc };
}

console.log('');
console.log('输出侧门控必须覆盖所有玩家可见文本通道');

// ① 文书（正文 / 落款）—— X4 + X5
{
  const { d, doc } = scene();
  const pub = G.docPublic(doc, d);
  ok(pub.body.indexOf(FAKE) < 0, '① 文书**正文**里的真名被打码（' + pub.body.slice(0, 24) + '…）');
  ok(pub.from.indexOf(FAKE) < 0, '① ★ 文书**落款**不再印真名（from=' + JSON.stringify(pub.from) + '）—— 这就是 X5');
  const v = G.buildView(d);
  const row = (v.docs || [])[0] || {};
  ok(String(row.from || '').indexOf(FAKE) < 0, '① 文书**列表行**的 from 也打码');
  ok(String(row.title || '').indexOf(FAKE) < 0 && String(row.brief || '').indexOf(FAKE) < 0, '① 列表标题/摘要也打码');
}
// ② 消息正文 —— X4
{
  const { d } = scene();
  const v = G.buildView(d);
  const m = (v.msgs || [])[0] || {};
  ok(String(m.body || '').indexOf(FAKE) < 0, '② ★ 消息正文里的真名被打码（' + String(m.body || '').slice(0, 24) + '）');
}
// ③ 按需调取 —— X10
{
  const { d } = scene();
  const r = JSON.stringify(QUERY.resolve(d, { items: [{ what: 'person', id: 'npc_zz' }] }));
  ok(r.indexOf(FAKE) < 0, '③ ★ 查询人物：不给真名');
  ok(r.indexOf('腕上一道旧疤') < 0, '③ ★ 查询人物：不给客观外貌（' + (r.indexOf('外貌') >= 0 ? '仍出现"外貌"字样' : '整段档案已收回') + '）');
  ok(r.indexOf('寡言') < 0 || r.indexOf('没有任何可用的档案') >= 0, '③ 查不出表面性格/情绪/关系');
  const rm = JSON.stringify(QUERY.resolve(d, { items: [{ what: 'memory', owner: 'npc_zz' }] }));
  ok(rm.indexOf(FAKE) < 0, '③ ★ 查询记忆：标题不再是真名');
}
// ④ 资料包"最近场景原文" —— X9
{
  const { d } = scene();
  d.sceneLog.push({ t: d.current.time, type: 'dialogue', speaker: 'npc_zz', text: '别开灯。' });
  const pk = String(AI.packetFor(d, { action: '（看着字条）' }));
  const seg = pk.slice(pk.indexOf('最近场景原文'), pk.indexOf('最近场景原文') + 400);
  ok(seg.indexOf('npc_zz：「') < 0, '④ ★ 最近场景原文里不再出现裸 id 的说话者（' + seg.replace(/\s+/g, ' ').slice(0, 70) + '…）');
  ok(seg.indexOf(FAKE) < 0, '④ ★ 也不吐真名 —— 用的是"看得见的样子"');
}
// ⑤ 不误伤：认识的人（stage 2 + 知道名字）照旧放行
{
  const d = buildDemoWorld(); if (!d.id) d.id = makeId;
  d.impressions = { npc_1: { stage: 2, seen: '腰间别着钥匙', traits: [], notes: [], bonds: [], nameKnown: '沈姨' } };
  d.knowledge.knownPeople = ['npc_1'];
  const doc = G.createDoc(d, { title: '一封信', body: '沈姨说灶上温着汤。', from: '沈姨', to: '你' });
  const pub = G.docPublic(doc, d);
  ok(pub.from === '沈姨' && pub.body.indexOf('沈姨') >= 0, '⑤ ★ 认识的人照旧放行（from=' + JSON.stringify(pub.from) + '）—— 门控不误伤');
  const r = JSON.stringify(QUERY.resolve(d, { items: [{ what: 'person', id: 'npc_1' }] }));
  ok(r.indexOf('外貌') >= 0 || r.indexOf('腰间别着钥匙') >= 0, '⑤ 查询认识的人：档案照常给');
}
// ⑥ 动作 beat 的**归属人**：同一把尺子（id → 称呼）也要覆盖 actor
//    病根同 ④：actor 存的也是 id，但视图只解析 speaker ——
//    于是前端 spSafe('npc_1') 认出是 id，屏幕上印一个"？"（"阿岩朝这边看了一眼"变成"？ （阿岩朝这边看了一眼）"）。
{
  // (a) 认识的人：要出**名字**，不许出 id、不许出"？"
  const d = buildDemoWorld(); if (!d.id) d.id = makeId;
  d.impressions = { npc_1: { stage: 2, seen: '腰间别着钥匙', traits: [], notes: [], bonds: [], nameKnown: '沈姨' } };
  d.knowledge.knownPeople = ['npc_1'];
  d.sceneLog.push({ t: d.current.time, type: 'action', actor: 'npc_1', text: '（在柜台上磕了磕算盘。）' });
  const v = G.buildView(d);
  const beat = (v.sceneLog || []).filter(l => l.type === 'action').slice(-1)[0] || {};
  ok(beat.actorName === '沈姨', '⑥ ★ 动作 beat 的 actor 解析成称呼（actorName=' + JSON.stringify(beat.actorName) + '）');
  ok(beat.actor !== 'npc_1', '⑥ 视图里不再裸传 actor 的 id');
  // (b) 没见过的人：给的是"看得见的样子"或"？"，**不给真名**（门控不因为这次改动破掉）
  const { d: d2 } = scene();
  d2.sceneLog.push({ t: d2.current.time, type: 'action', actor: 'npc_zz', text: '（把字条压在杯子底下。）' });
  const v2 = G.buildView(d2);
  const b2 = (v2.sceneLog || []).filter(l => l.type === 'action').slice(-1)[0] || {};
  ok(String(b2.actorName || '').indexOf(FAKE) < 0, '⑥ ★ 没见过的人：动作 beat 里也不吐真名（actorName=' + JSON.stringify(b2.actorName) + '）');
  ok(!!b2.actorName, '⑥ 兜底有值（不是 undefined —— 前端才有东西可显示）');
  // (c) 玩家自己的动作
  d2.sceneLog.push({ t: d2.current.time, type: 'action', actor: 'player', text: '（把杯子推回去。）' });
  const v3 = G.buildView(d2);
  const b3 = (v3.sceneLog || []).filter(l => l.type === 'action').slice(-1)[0] || {};
  ok(b3.actorName === '你', '⑥ 玩家自己的动作显示"你"（actorName=' + JSON.stringify(b3.actorName) + '）');
}
console.log('');
console.log('==== gate-channels-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
