// validator-loop-check.js — 校验器闭环：被拒的条目回合内能回灌（v1.98 · P0-4）
// 病：Update 被拒之后"丢了就丢了" —— AI 不知道哪条被拒、为什么，下一回合照样再犯；
//     玩家看到的是"我说了那句话，世界没反应"。
// 修：① validator 产出**结构化拒绝**（index/kind/reason/target），errors 形状一字不变
//     ② 回合内把回执追加进同一次对话，只让 AI 重出被拒项，拿回来**全量重验**（一轮为止）
//     ③ 校验没过 = "上回合没处理好"，点亮 _hardLast（下一回合多给思考预算）
'use strict';
const path = require('path'), os = require('os'), fs = require('fs');
const TMP = path.join(os.tmpdir(), 'ws-vloop-' + Date.now());
process.env.WORLD_SIM_DATA = TMP; fs.mkdirSync(TMP, { recursive: true });
const ROOT = path.join(__dirname, '..');
process.env.WORLD_SIM_ASSETS = ROOT;
const { buildDemoWorld } = require(ROOT + '/src/world');
const { makeId } = require(ROOT + '/src/store');
const RT = require(ROOT + '/src/runtime');
const G = require(ROOT + '/src/game');
const AI = require(ROOT + '/src/ai');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const mk = () => { const d = buildDemoWorld(); if (!d.id) d.id = makeId; d.impressions = {}; return d; };
const gm = fs.readFileSync(ROOT + '/src/game.js', 'utf8');

console.log('');
console.log('校验器闭环：结构化拒绝 / 一轮修正 / 全量重验 / 死钩子点亮');

// ── ① 结构化拒绝：形状、索引、原因、目标 ──
{
  const d = mk();
  const ups = [
    { type: '记忆新增', owner: 'npc_1', content: '好好的一件事', tags: ['见面'], impact: 40 },      // 过
    { type: '记忆新增', owner: 'npc_1', content: '冲击力写飞了', tags: ['见面'], impact: 150 },     // 拒：冲击力
    { type: '关系变化', target: 'npc_1', change: '熟了些' },                                        // 拒：缺因果
    { type: '不存在的东西', target: 'npc_1' },                                                       // 拒：白名单
    { type: '地点变化', target: 'player', to: 'pl_999', cause: '想跑' }                              // 拒：地址
  ];
  const v = RT.validateUpdates(d, ups, { beats: [] }, {});
  ok(Array.isArray(v.errors) && v.errors.every(x => typeof x === 'string'), 'errors 仍是 string[]（人话，形状没变）');
  ok(Array.isArray(v.rejected) && v.rejected.length === 4, '★ 新增 rejected：4 条被拒（过的那条不在里面）');
  ok(v.allowed.length === 1, '放行的只有那一条合法记忆');
  const idx = v.rejected.map(r => r.index).join(',');
  ok(idx === '1,2,3,4', '★ 每条都带**原始下标**（AI 才知道该改哪一条）：' + idx);
  ok(v.rejected.every(r => r.kind && r.reason && r.kind !== '其它' && r.kind !== '') , '每条都有可读的 kind：' + JSON.stringify(v.rejected.map(r => r.kind)));
  ok(v.rejected[0].kind === '冲击力' && v.rejected[1].kind === '因果' && v.rejected[2].kind === '类型', 'kind 与原因对得上（冲击力 / 因果 / 类型）');
  ok(v.rejected.every(r => typeof r.target === 'string'), '每条都带 target（回执里能指认对象）');
  ok(v.rejected.every(r => v.errors.indexOf(r.reason) >= 0), '★ 结构化拒绝与人话 errors 是同一批（不重不漏）');
  ok(RT.kindOf('事件烈度 L4 超过世界上限 L2') === '烈度' && RT.kindOf('啪') === '其它', 'kindOf 是唯一口径（导出了）');
}
// ── ② 人话文案不许改（二十多处断言正则匹配着） ──
{
  const d = mk();
  const v = RT.validateUpdates(d, [
    { type: '记忆新增', owner: 'npc_1', content: 'x', tags: ['a'], impact: 40, severity: 'L5' },
    { type: '地点变化', target: 'player', to: 'pl_1', cause: 'x' },
    { type: '关系变化', target: 'npc_1', change: '3', cause: 'x' }
  ], { beats: [] }, {});
  const all = v.errors.join(' | ');
  ok(/烈度/.test(all) && /上限/.test(all), '烈度那条仍含"烈度"与上限值：' + JSON.stringify(v.errors[0]));
  ok(/当前所在/.test(all), '"目标就是当前所在"文案没变');
  ok(/定性/.test(all) && !/数字/.test(all), '"必须定性"文案没变');
}
// ── ③ 修正轮：接了线、只做一轮、全量重验、离线不触发 ──
{
  ok(/v\.rejected\.length && v\.rejected\.length < \(out\.updates \|\| \[\]\)\.length/.test(gm), '★ 触发条件：有被拒、且不是全军覆没');
  ok(/!out\.__fallback && messages && !__fixedRound/.test(gm), '★ 离线不浪费调用 + 只做一轮');
  ok(/【校验回执】/.test(gm), '回执进的是**同一次对话**（messages.push，不是新开一轮）');
  ok(/只重新输出这几条/.test(gm), '回执写明"只重出被拒的"（不是让它重写整个回合）');
  ok(/改写不了不就?要输出|改写不了就别输出|干脆不要输出/.test(gm), '回执允许 AI 放弃某条（改不出来就别硬写）');
  ok(/RT\.validateUpdates\(data, out\.updates, out\.frame \|\| \{\}, ctx\)/.test(gm), '★★ 拿回来是**全量重验**（只验修正项会让 fxSeen 失效 → 一回合两条演出）');
  ok((gm.match(/__fixedRound = true/g) || []).length === 1, '只做一轮（标志只置一次）');
  ok(/data\.current\.lastValidate = \{ rejected: v\.rejected\.length, fixed: !!__fixedRound/.test(gm), '本回合被拒几条 / 有没有走修正轮 → 落进 current（/api/dev 可查，0 token）');
  ok(/validator: \(data && data\.current && data\.current\.lastValidate\) \|\| null/.test(fs.readFileSync(ROOT + '/src/game.js', 'utf8')), '开发者视图里能看到 validator 现状');
  ok(!/console\.log\(.*rejected/.test(gm) && !/view\.[a-zA-Z]*rejected/.test(gm), '玩家视图里没有校验器的痕迹（越权红线）');
}
// ── ④ 死钩子：校验拒绝也点亮 _hardLast（原来只有冲突循环会点） ──
{
  const idx = gm.indexOf('__fixedRound = true;');
  const seg = gm.slice(idx, idx + 400);
  ok(/_hardLast = true/.test(seg), '★ 校验拒绝点亮 _hardLast（thinkBudget 下一回合多给预算）');
  ok(/let __fixedRound = false;/.test(gm), '__fixedRound 只声明一次');
  ok(/AI\.thinkBudget\(data, intent, ctx, __hardLast\)/.test(gm), 'thinkBudget 仍吃着这个钩子（game.js 的调用点）');
}
// ── ⑤ 端到端：桩 AI 第一次给被拒的更新，第二次给合规的 → 修正轮真的把世界改对了 ──
(async () => {
  const realIsLive = AI.isLive, realLlm = AI.llmJSON;
  let calls = 0, sawReceipt = false;
  AI.isLive = () => true;
  AI.llmJSON = async function (cfg, messages) {
    const sys = String(((messages || [])[0] || {}).content || '');
    if (sys.indexOf('角色模拟器') >= 0) return { line: '嗯。', action: '抬了下眼', inner: '…' };
    const joined = (messages || []).map(m => String(m.content || '')).join(' ');
    /* 只数**主 AI** 的调用：资料包里必然有「最近场景原文」（副 AI/角色模拟器没有）。
       不这么分，"两次"会被副 AI 的几次调用冲掉。 */
    const isMain = joined.indexOf('最近场景原文') >= 0;
    if (joined.indexOf('【校验回执】') >= 0) {
      sawReceipt = true; if (isMain) calls++;
      return { frame: null, updates: [{ type: '关系变化', target: 'npc_1', change: '熟络了些', cause: '刚才那两句话' }] };
    }
    if (isMain) calls++;
    return { frame: { tag: '夜 · 店里', beats: [] }, updates: [
      { type: '关系变化', target: 'npc_1', change: '熟络了些' },                     // 缺因果 → 被拒
      { type: '记忆新增', owner: 'npc_2', content: '他记得你刚才笑了一下', tags: ['见面'], impact: 45 }
    ] };
  };
  const d = mk(); d.meta.actorBudget = 0;
  const r = await G.runTurn(d, '你好', { llm: { baseURL: 'http://x', apiKey: 'k', model: 'm' }, roles: {} }).then(x => x, e => ({ __err: String(e && e.message || e) }));
  AI.isLive = realIsLive; AI.llmJSON = realLlm;
  ok(!r.__err, '回合跑完没抛（' + JSON.stringify(r.__err || 'ok') + '）');
  ok(sawReceipt, '★ AI 真的收到了【校验回执】（被拒条目回灌了）');
  ok(calls === 2, '★ 恰好两次调用（首轮 + 修正轮，没有无限重试）：' + calls);
  ok(String(((d.relations || {}).player || {}).npc_1 && ((d.relations.player || {}).npc_1 || {}).tone || '').indexOf('熟络') >= 0, '★★ 修正轮真的把世界改对了（关系从"缺因果被拒"变成落库）：' + JSON.stringify((((d.relations || {}).player || {}).npc_1 || {}).tone));
  ok(d.current.lastValidate && d.current.lastValidate.fixed === true, '本回合被记为"走过修正轮"：' + JSON.stringify(d.current.lastValidate));
  ok(d.current._hardLast === true, '★ 校验拒绝把 _hardLast 留给了**下一个回合**（下一回合 thinkBudget 才会多给预算）');
  // 全绿回合：不该多一轮
  let calls2 = 0;
  AI.isLive = () => true;
  AI.llmJSON = async function (cfg, messages) {
    const sys = String(((messages || [])[0] || {}).content || '');
    if (sys.indexOf('角色模拟器') >= 0) return { line: '嗯。', action: '抬了下眼', inner: '…' };
    const joined = (messages || []).map(m => String(m.content || '')).join(' ');
    if (joined.indexOf('最近场景原文') >= 0) calls2++;
    return { frame: { tag: '夜 · 店里', beats: [] }, updates: [{ type: '记忆新增', owner: 'npc_1', content: '他记得你刚才点了下头', tags: ['见面'], impact: 45 }] };
  };
  const d2 = mk(); d2.meta.actorBudget = 0;
  await G.runTurn(d2, '你好', { llm: { baseURL: 'http://x', apiKey: 'k', model: 'm' }, roles: {} }).catch(() => null);
  AI.isLive = realIsLive; AI.llmJSON = realLlm;
  ok(calls2 === 1, '★ 全绿回合不触发修正轮（调用次数与改前一致）：' + calls2);
  ok(d2.current.lastValidate && d2.current.lastValidate.rejected === 0, '全绿回合被拒条数 = 0');
  console.log('');
  console.log('==== validator-loop-check: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('PROBE ERROR ' + String(e && e.message || e)); process.exit(1); });
