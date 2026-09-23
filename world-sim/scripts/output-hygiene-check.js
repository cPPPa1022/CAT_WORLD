// output-hygiene-check.js — 输出卫生（v1.97 · X6/X7/X11/X12）
// 四条共同点：文档/设计写着有的东西，在代码里要么**没人读**（死字段/死钩子）、
// 要么**发多了**（不该到浏览器的数据）、要么**两个轴同名**（同一个键两种词表）。
// 它们都不会报错 —— 只能靠断言守。
'use strict';
const path = require('path'), os = require('os'), fs = require('fs');
const TMP = path.join(os.tmpdir(), 'ws-hygiene-' + Date.now());
process.env.WORLD_SIM_DATA = TMP; fs.mkdirSync(TMP, { recursive: true });
const ROOT = path.join(__dirname, '..');
process.env.WORLD_SIM_ASSETS = ROOT;
const { buildDemoWorld } = require(ROOT + '/src/world');
const { makeId } = require(ROOT + '/src/store');
const G = require(ROOT + '/src/game');
const AI = require(ROOT + '/src/ai');
const RT = require(ROOT + '/src/runtime');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const mk = () => { const d = buildDemoWorld(); if (!d.id) d.id = makeId; d.impressions = {}; return d; };
const gm = fs.readFileSync(ROOT + '/src/game.js', 'utf8');

console.log('');
console.log('输出卫生：不过度外发 / 不留死物 / 双轴不混');

// ── X11 不过度外发 ──
{
  const d = mk();
  d.impressions.npc_1 = { stage: 2, seen: '腰间别着钥匙', traits: [], notes: [], bonds: [], nameKnown: '沈姨' };
  const v = G.buildView(d);
  const c0 = (v.cast || [])[0] || {};
  const keys = Object.keys(c0).sort().join(',');
  ok(keys.split(',').every(k => ['id', 'name', 'mood', 'dead'].indexOf(k) >= 0), 'X11 cast 只外发白名单（实际：' + keys + '）');
  ok(!('state' in c0) && !('location' in c0), 'X11 cast 不再带 state / location');
  const p0 = (v.people || []).find(x => x.id !== 'player') || {};
  ok(!('location' in p0), 'X11 人物面板不再外发每个 NPC 的客观位置');
  ok(!!p0.name, 'X11 白名单没伤到正常字段（name 还在：' + JSON.stringify(p0.name) + '）');
}
// ── X7 死钩子：既要接线，也要**真的改变行为** ──
{
  const d = mk();
  ok(/_hardLast = true/.test(gm), 'X7 _hardLast 有写入点（原来全仓 0）');
  ok(/const __hardLast = !!data\.current\._hardLast/.test(gm), 'X7 回合开头取出并清空');
  ok(/AI\.thinkBudget\(data, intent, ctx, __hardLast\)/.test(gm), 'X7 thinkBudget 用的是取出的值');
  const intent = { kind: 'act' };
  const ctx = { memories: [], candidates: [], think: null };
  let a = null, b = null;
  try { a = AI.thinkBudget(d, intent, ctx, false); b = AI.thinkBudget(d, intent, ctx, true); } catch (e) { }
  ok(a != null && b != null && String(a) !== String(b), 'X7 ★ 钩子真的改变行为（hardLast=false → ' + JSON.stringify(a) + '，true → ' + JSON.stringify(b) + '）');
}
// ── X6 死字段：不再发没人渲染的东西，且搭上了玩家真会读的通道 ──
{
  const d = mk();
  const v = G.buildView(d);
  ok(!('reaction' in v), 'X6 视图里不再有没人渲染的 reaction 字段');
  ok(!/view2\.reaction/.test(gm), 'X6 game.js 里已无 view2.reaction 赋值');
  const am = fs.readFileSync(ROOT + '/public/app.js', 'utf8');
  const cs = fs.readFileSync(ROOT + '/public/style.css', 'utf8');
  ok(/type: 'reaction'/.test(gm) && /__react/.test(gm), 'X6 ★ reaction 有了生产端（落成 reaction beat）');
  ok(/L\.type === 'reaction'/.test(am), 'X6 ★ 前端有 reaction 的渲染分支（不然又是死字段）');
  ok(/\.beat\.reaction/.test(cs), 'X6 ★ reaction 那一档有样式（不是裸文本）');
  ok(!/type: 'outcome', text: String\(\(__react/.test(gm), 'X6 reaction 不再混进 outcome（玩家做的 vs 世界回的，两档分开）');
  // 教程提示：它是引导，不是世界内容 —— 不许进剧情原文（会喂给主 AI、会进剧本存档）
  ok(/data\.current\.tutorHint/.test(gm), 'X6 教程提示有落地处（v1.96 之前它随 view.reaction 一起没人渲染）');
  ok(!/type: 'reaction', text: String\(__react\) \+ \(tutorHint/.test(gm), 'X6 教程提示没有混进世界反应那一行');
  const v2 = G.buildView(mk());
  ok('tutor' in v2, 'X6 视图带 tutor 一档（前端有对应渲染）');
  ok(/V\.tutor/.test(am) && /\.beat\.tutor/.test(cs), 'X6 tutor 有渲染分支与样式');
}
// ── X12 双轴同名：严重性词汇不许被当成烈度 ──
{
  const d = mk();
  const frame = { beats: [{ type: 'dialogue', speaker: 'npc_1', text: 'x' }] };
  const v1 = RT.validateUpdates(d, [{ type: '记忆新增', owner: 'npc_1', content: 'x', tags: ['冲突'], impact: 40, severity: '低' }], frame, {});
  ok(v1.allowed.length === 1, 'X12 ★ severity="低"（新闻严重性词汇）不当作烈度 → 放行');
  const v2 = RT.validateUpdates(d, [{ type: '记忆新增', owner: 'npc_1', content: 'x', tags: ['冲突'], impact: 40, severity: 'L5' }], frame, {});
  ok(v2.errors.some(e => /烈度/.test(e)), 'X12 ★ severity="L5" 超过世界上限 L2 → 仍然拦住（不误放）');
  /* v1.98 P0-5：烈度词表从 runtime.js 搬到了 contract.js（唯一来源）—— 检查点跟着实现走，
     同时确认 runtime.js 仍然是**用**它的那一方（而不是又抄了一份词表）。 */
  const rt = fs.readFileSync(ROOT + '/src/runtime.js', 'utf8');
  const ct = fs.readFileSync(ROOT + '/src/contract.js', 'utf8');
  ok(/LEVELS = \['L1', 'L2', 'L3', 'L4'\]/.test(ct) && /BANNED_LEVELS = \['L5'\]/.test(ct), 'X12 词表只有一处（contract.js：L1–L4 合法 + L5 禁止）');
  ok(/CONTRACT\.normSev\(raw\)/.test(rt) && !/const RANK = \{ L1: 1/.test(rt), 'X12 校验器用的是那份词表，没有第二份 RANK');
  ok(/CONTRACT\.RANK\[got\] > CONTRACT\.RANK\[max\]/.test(rt), 'X12 仍然按上限比大小（不是 truthy 查表放行）');
}
console.log('');
console.log('==== output-hygiene-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
