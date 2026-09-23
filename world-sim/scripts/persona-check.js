// persona-check.js — v1.53 红线：**人设忠实**（语域 / 精神状态 / 不磨平角色）
// 用户 2026-09-14：「要还原人设。像日常，我爆粗口是很正常的。还有些有精神病的，例如抑郁症/躁郁症（双向）等等」
// 这份断言钉三件事：① 提示词契约在；② 资料包把"当前相位"给了 AI 而**没给玩家**；③ 说教检测不再把角色磨平。
'use strict';
const AI = require('../src/ai');
const W = require('../src/world');

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (x ? '  << ' + x : '')); } };
const mk = () => { const d = JSON.parse(JSON.stringify(W.buildDemoWorld())); d.id = (p) => p + '__p' + Math.random().toString(36).slice(2, 7); return d; };
const SYS = AI.SYSTEM(mk(), { llm: {} }, false);

// ---------- [1] 提示词契约 ----------
console.log('\n[1] 提示词契约（人设忠实）');
(function () {
  ok(/人设忠实 · 语域/.test(SYS), '有「语域」条：玩家的说话方式属于他的设定');
  ok(/严禁对玩家的用词做道德评价/.test(SYS), '★ 明写：不得因玩家爆粗口而说教/温柔提醒');
  ok(/人设忠实 · 精神状态/.test(SYS), '有「精神状态」条');
  ok(/不许贴标签/.test(SYS) && /不许拿病当剧情工具/.test(SYS), '★ 不许贴标签、不许拿病当剧情工具');
  ok(/不许擅自治愈或恶化/.test(SYS), '★ 状态变化必须走 Update 且带因果（不许自行治愈/恶化）');
  ok(/健康化/.test(SYS), '不许"健康化"粉饰');
  ok(/躁期|郁期/.test(SYS), '给了相位的具体演法（不是抽象口号）');
})();

// ---------- [2] 资料包给 AI 相位；玩家侧看不到（诊断不上桌） ----------
console.log('\n[2] 相位：AI 看得到，玩家看不到');
(function () {
  const d = mk();
  const sid = d.current.sceneId;
  d.entities.npc_sick = {
    id: 'npc_sick', type: 'person', name: '周砚',
    profile: { appearance: { 标志物: '眼下发青' }, surface: { 待人: '话少' }, condition: { 名: '双相', 相位: ['平稳', '躁期', '郁期'], 触发: ['被提起亡妻'] } },
    state: { location: sid, mood: '低落', phase: '郁期' }
  };
  d.impressions = d.impressions || {};
  d.impressions.npc_sick = { stage: 4, seen: '眼下发青', nameKnown: '周砚', traits: [], notes: [], bonds: [] };
  d.knowledge.knownPeople = (d.knowledge.knownPeople || []).concat(['npc_sick']);
  const pack = JSON.parse(AI.packetFor(d, { action: '我看着他', memories: [], candidates: [] }));
  const row = (pack['在场人物(全部)'] || []).find(x => x.id === 'npc_sick');
  ok(!!row && /双相/.test(row['当前相位'] || ''), '★ 资料包把「双相 · 当前 郁期」给 AI（它才知道怎么演）', JSON.stringify(row && row['当前相位']));
  const G = require('../src/game');
  const v = G.buildView(d);
  const me = (v.people || []).find(x => x.id === 'npc_sick') || {};
  const dump = JSON.stringify(me);
  ok(dump.indexOf('双相') < 0 && dump.indexOf('郁期') < 0, '★ **玩家侧看不到诊断**（人物面板是"你对TA的印象"，不是病历）', dump.slice(0, 120));
})();

// ---------- [3] 说教检测：不磨平角色 ----------
console.log('\n[3] 说教检测：旁白管住，角色不磨平');
(function () {
  const mkOut = (type, text, speaker) => ({ frame: { beats: [{ type: type, text: text, speaker: speaker || undefined }] } });
  const preachy = '我理解你的感受但我们都应该冷静下来。';   // 恰好命中两条弱模式（共情式说教 + 说教收尾）
  const outN = { frame: { beats: [{ type: 'narration', text: preachy }] } };
  const outD = { frame: { beats: [{ type: 'dialogue', text: preachy, speaker: 'npc_1' }] } };
  ok(AI.guardCheck(outN) !== null, '弱模式：**旁白**里出现说教腔 → 照样拦（模型的嗓子不许说教）');
  ok(AI.guardCheck(outD) === null, '★ 弱模式：**角色台词**里同样的话 → **不拦**（那是人设，不把角色磨平）');
  ok(AI.guardCheck(mkOut('dialogue', '以现实社会的角度来说，这不该发生。', 'npc_1')) !== null, '强模式：角色台词里跳出世界（现实视角）→ **仍然拦**');
  ok(AI.guardCheck(mkOut('dialogue', '抱歉，我无法继续描述这个场景。', 'npc_1')) !== null, '强模式：拒答式中止 → 仍然拦');
  const d = mk();
  ok(AI.guardCheck(mkOut('dialogue', '要死咯，你这孩子怎么说话呢！', 'npc_1')) === null, '正常台词（含口癖）不受影响');
})();

console.log('\n==== persona-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
