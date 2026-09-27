'use strict';
/* turn-stamp-check.js — 「所有产出都要能回答：这是哪一轮、因为什么」（v3.9）
 *
 * 用户原话（2026-09-27）：
 *   「以后**所有产出的数据都要打上标记** 这是哪一轮-什么事件（例如人物对某的印象）」
 *
 * 为什么要有这条断言：这个项目的死法里有整整一类叫「事后查不出来」——
 *   印象档只有结论（stage/seen），没有任何"它是什么时候、因为什么变成这样"的痕迹；
 *   账本只有世界时间，同一个世界日里发生的事分不清先后；sceneLog 连轮次都没有。
 *   这些字段一旦不写，事后补不回来（界面会重画、会过滤、会搬迁）。
 *
 * 三条纪律（本脚本量的就是它）：
 *   ① 账本 / 记忆 / 场景日志 / 印象档，每条产出都带 turn；
 *   ② 「什么事件」由 type / tags / what+why 说清楚；
 *   ③ 这些标记**不上玩家的屏幕**（越权红线 4：回合数只在 ?dev 显示）。
 *
 * 用法：node scripts/turn-stamp-check.js（失败非零退出）。纯离线 + 假模型，0 token。
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-stamp-'));
process.env.WORLD_SIM_DATA = TMP;
process.env.WORLD_SIM_ASSETS = ROOT;

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  OK   ' + m)) : (fail++, console.log('  FAIL ' + m)); };

const W = require('../src/world');
const G = require('../src/game');
const RT = require('../src/runtime');
const STORE = require('../src/store');
const IMP = require('../src/import');

/* 假模型：主 AI 的 frame/updates（0 token） */
globalThis.fetch = async function (url, init) {
  const body = JSON.parse((init && init.body) || '{}');
  const sys = String(((body.messages || [])[0] || {}).content || '');
  const content = /主AI|岗位说明书/.test(sys)
    ? JSON.stringify({ frame: { tag: '测试·夜·晴', focus: [], suggestions: [], beats: [{ type: 'narration', text: '街上很静。' }, { type: 'dialogue', speaker: 'npc_1', text: '嗯。' }] }, updates: [] })
    : '{}';
  if (body.stream) {
    const enc = new TextEncoder();
    const chunk = 'data: ' + JSON.stringify({ choices: [{ delta: { content: content } }] }) + '\n\n'
      + 'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) + '\n\n' + 'data: [DONE]\n\n';
    return { ok: true, status: 200, text: async () => content, json: async () => ({ choices: [{ message: { content: content } }] }), body: new ReadableStream({ start(c) { c.enqueue(enc.encode(chunk)); c.close(); } }) };
  }
  return { ok: true, status: 200, text: async () => content, json: async () => ({ choices: [{ message: { content: content } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), body: null };
};

(async () => {
console.log('');
console.log('产出标记 · ① 账本（唯一写入口盖章）');
{
  ok(typeof STORE.stampTurn === 'function', 'store.stampTurn 存在并导出');
  const d = W.buildDemoWorld(); d.id = (p) => p + '_' + Math.random().toString(36).slice(2, 7);
  d.current.turnN = 7;
  const rec = { t: d.current.time, type: '测试', desc: 'x' };
  STORE.ledgerPush(d, rec);
  ok(rec.turn === 7, '★ 账本条目自动带上轮次（第 7 轮）—— 实测 ' + rec.turn);
  const rec2 = { t: d.current.time, type: '测试', desc: 'y' };
  STORE.ledgerPush(d, rec2);
  ok(rec2.turn === 7 && rec2.id && rec2.id !== rec.id, '盖章不破坏原有的 id 生成');
  ok(/const ledgerPush = \(data, rec\) => \{\s*stampTurn\(data, rec\);/.test(read('src/store.js')), '盖章就在 ledgerPush 里（唯一入口，别处不用管）');
}

console.log('');
console.log('产出标记 · ② 记忆');
{
  const d = W.buildDemoWorld(); d.id = (p) => p + '_' + Math.random().toString(36).slice(2, 7);
  d.current.turnN = 4;
  const r = RT.writeMemory(d, { owner: 'npc_1', content: '她记住了这句话', tags: ['对话', '印象'], impact: 55, t: d.current.time });
  const m = d.memories[r.id];
  ok(!!m, '记忆写进去了');
  ok(m && m.turn === 4, '★ 记忆带轮次（第 4 轮）—— 实测 ' + (m && m.turn));
  ok(m && Array.isArray(m.tags) && m.tags.length >= 2, '「什么事件」由 tags 说清楚（' + JSON.stringify((m || {}).tags) + '）');
}

console.log('');
console.log('产出标记 · ③ 一轮跑完：这一轮产出的每一条场景日志都带轮次');
{
  const d = W.buildDemoWorld(); d.id = (p) => p + '_' + Math.random().toString(36).slice(2, 7);
  const before = (d.sceneLog || []).length;
  d.current.turnN = 2;
  const turn = await G.runTurn(d, '你好', { llm: { baseURL: 'http://127.0.0.1:9/v1', apiKey: 'k', model: 'fake', maxTokens: 4096 }, roles: {}, image: { enabled: false } });
  ok(!!turn && !!turn.frame, '一回合跑通（假模型）');
  const added = (d.sceneLog || []).slice(before);
  ok(added.length >= 3, '这一轮产出了 ' + added.length + ' 条场景日志');
  const noTurn = added.filter(x => x && x.turn == null);
  ok(noTurn.length === 0, '★ 每一条都有 turn' + (noTurn.length ? '（缺 ' + noTurn.length + ' 条：' + JSON.stringify(noTurn.slice(0, 3).map(x => x.type)) + '）' : ''));
  const tset = [...new Set(added.map(x => x.turn))];
  ok(tset.length === 1 && tset[0] === 3, '这一轮是第 3 轮（turnN 2 → 回合 +1）—— 实测 ' + JSON.stringify(tset));
  ok(added.some(x => x.type === 'user-action') && added.some(x => x.type === 'stage-tag'), '玩家输入与地点标签都在（"什么事件"看 type）');
}

console.log('');
console.log('产出标记 · ④ 印象档的出处（用户举的例子就是它）');
{
  const d = IMP.packToData({
    meta: { name: 'T', era: '九十年代' }, time: '1996-06-14T20:45:00', weather: '晴',
    player: { name: '你' },
    npcs: [{ id: 'npc1', name: '陈思思', bond: '旧识', rel: '玩伴兼军师', knows: '认得', atStart: 'p1' }],
    places: [{ id: 'p1', name: '屋里' }], firstScene: '门开了。', rules: []
  });
  const imp = (d.impressions || {}).npc1 || {};
  ok(Array.isArray(imp.log) && imp.log.length >= 1, '★ 印象档带 log（出处）');
  ok(imp.log && imp.log[0].turn === 0, '建档那条是第 0 轮（开场）—— 实测 ' + (imp.log && imp.log[0] && imp.log[0].turn));
  ok(imp.log && /关系基调/.test(String(imp.log[0].why || '')), '为什么：' + String(imp.log && imp.log[0] && imp.log[0].why));
  ok((d.sceneLog || []).filter(x => x.turn == null).length === 0, '★ 开场的场景日志也带轮次（0）');
  const runtimeLog = read('src/game.js');
  ok((runtimeLog.match(/imp\.log = imp\.log \|\| \[\]/g) || []).length >= 1 && /初次建档/.test(runtimeLog), '运行时出现的印象也记出处（ensureImp / 人物出现）');
}

console.log('');
console.log('产出标记 · ⑤ 关系定义：bond（底色）+ knows（玩家的认知起点）');
{
  const sys = IMP.scanSystem();
  ok(/"knows"/.test(sys), '★ schema 里有 knows 一栏');
  ok(/认得出|认得|叫得出名字/.test(sys), 'knows 的取值说清楚了（认得 / 只打过照面 / 从没见过）');
  const d = IMP.packToData({
    meta: { name: 'T', era: '九十年代' }, time: '1996-06-14T20:45:00', weather: '晴', player: { name: '你' },
    npcs: [{ id: 'npc1', name: 'A', bond: '初识', rel: '', knows: '认得', atStart: 'p2' },
           { id: 'npc2', name: 'B', bond: '旧识', rel: '发小', knows: '从没见过', atStart: 'p2' }],
    places: [{ id: 'p1', name: '屋' }, { id: 'p2', name: '街' }], firstScene: '门开了。', rules: []
  });
  ok(d.impressions.npc1.stage === 3, '★ knows=认得 ⇒ 一开局就知道名字（哪怕 bond 写的是"初识"）—— 实测 ' + d.impressions.npc1.stage);
  ok(d.impressions.npc2.stage === 1, '★ knows=从没见过 ⇒ 只见过（哪怕 bond 写的是"旧识"）—— 实测 ' + d.impressions.npc2.stage);
}

console.log('');
console.log('产出标记 · ⑥ 这些标记不上玩家的屏幕');
{
  const AJ = read('public/app.js');
  const VIEW = read('src/game.js');
  /* 回合数只能出现在 ?dev 的视图里（DEV_KEYS 之外不许有 turnN） */
  const devKeys = (VIEW.match(/const DEV_KEYS = \[([^\]]*)\]/) || ['', ''])[1];
  ok(devKeys.indexOf('turnN') < 0, 'turnN 不在 buildView 的常规字段里（只在 buildDevView）');
  ok(!/第 ?\d+ ?轮|第 ?\d+ ?回合/.test(AJ.replace(/\/\*[\s\S]*?\*\//g, ' ')), '界面上没有「第 N 轮」这种开发信息（越权红线 4）');
}

console.log('');
console.log('');
console.log('产出标记 · ⑦ 标记的**用途**：按轮次调回场景原文（含遗忘与失真）');
{
  const Q = require('../src/query');
  const d = W.buildDemoWorld(); d.id = (p) => p + '_' + Math.random().toString(36).slice(2, 7);
  d.sceneLog = d.sceneLog || [];
  for (let t = 1; t <= 5; t++) {
    d.sceneLog.push({ t: d.current.time, turn: t, type: 'stage-tag', text: '[屋 · 第' + t + '轮]' });
    d.sceneLog.push({ t: d.current.time, turn: t, type: 'dialogue', speaker: 'npc_1', text: '第' + t + '轮说的话：今天下雨。' });
  }
  const r = Q.resolve(d, { what: 'scene', turn: 3 });
  const rows = (r.items || []).filter(x => /第 3 轮/.test(String(x.title || '')));
  ok(rows.length >= 2, '★ what:scene + turn:3 → 只回第 3 轮那几条（实测 ' + rows.length + ' 条）');
  const r2 = Q.resolve(d, { what: 'scene', q: '下雨' });
  ok((r2.items || []).length >= 5, '★ 关键词检索：q=下雨 → 命中全部 5 轮的原话（实测 ' + (r2.items || []).length + '）');
  const r3 = Q.resolve(d, { what: 'scene', turn: 99 });
  ok((r3.misses || []).length >= 1 && (r3.items || []).length === 0, '★ 查不到就老实说没有（不许编）：' + String((r3.misses[0] || {}).why || '').slice(0, 40));
  ok(/第 0~\d+ 轮都能取回/.test(Q.renderCatalog(d)), '目录里告诉 AI「场景原文按轮次可查」');
  const AI2 = read('src/ai.js');
  ok(/【提起过去的事：先查，再让 TA 说】/.test(AI2), 'system 里有「先查再说」这条');
  ok(/查得到 ≠ TA 还记得/.test(AI2) && /记得住程度/.test(AI2), '★ 遗忘机制写进去了（记得住程度低就该记不清）');
  ok(/角色的转述允许失真，引擎给你的原文不许失真/.test(AI2), '★ 失真边界写进去了（转述可失真、世界事实不许失真）');
  ok(/查得到 ≠ 玩家知道/.test(AI2), '门控照旧（查得到不等于玩家知道）');
}

console.log('==== turn-stamp-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error('脚本自己炸了：' + ((e && e.stack) || e)); process.exitCode = 2; });
