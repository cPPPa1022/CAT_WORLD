'use strict';
// player-contract-check.js — v1.89 **玩家侧契约**断言
//
// 为什么要有它（审视 §3 的核心结论）：
//   本项目对「AI 不许做什么」有一套完备的执法机构（校验器/白名单/门控/断言），
//   对「玩家必须得到什么」**没有任何契约、检查或断言** —— 那一层不存在。
//   于是三条信息在管线里静默蒸发，而且不会报错：
//     · ctx.opLog（玩家自己动作的确定性结果）从不进 buildView
//     · beat 的 action/expression/voice 在落库那一刻被拍平
//     · 「未了的事」只推导给 AI，玩家侧一个字都没有
//   这份脚本把这三条变成红灯。用法：node scripts/player-contract-check.js
const AI = require('../src/ai');
const W = require('../src/world');
const G = require('../src/game');
const GATE = require('../src/gate');   // v3.3：名字门控的断言要用"那把唯一的尺子"

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  OK  ' + m)) : (fail++, console.log('  FAIL ' + m)); };
const NL2 = String.fromCharCode(10);

const newWorld = () => { const d = W.buildDemoWorld(); d.id = (p) => p + '_' + Math.random().toString(36).slice(2, 8); return d; };

// 桩：让 runTurn 走 live 分支，但 LLM 返回我们指定的 frame
let FAKE_FRAME = null;
const realIsLive = AI.isLive, realLlmJSON = AI.llmJSON;
AI.isLive = () => true;
AI.llmJSON = async function (cfg, messages) {
  /* v1.94 起，引擎会**先问过在场的人**（SCHED.dispatch actor → exActor → AI.llmJSON）。
     如果这个桩对所有调用都返回同一个 FAKE_FRAME，actor 会拿不到 line → 回退 mockActor，
     然后引擎的兜底交付会给那个人**补一条 beat** —— 于是「最后一条 dialogue」就不再是主 AI 那条了。
     所以这里必须按 system 分辨：角色模拟器走角色形状，其余走 FAKE_FRAME。 */
  const sys = String(((messages || [])[0] || {}).content || '');
  if (sys.indexOf('角色模拟器') >= 0) return { line: '角色自己的原话', action: '抬了下眼', inner: '心里在盘算' };
  return FAKE_FRAME || { frame: { tag: 't', beats: [] }, updates: [] };
};

(async () => {
  const cfg = { llm: { baseURL: 'http://x', apiKey: 'k', model: 'm' }, roles: {} };
  const sceneId = (d) => d.current.sceneId;

  // ---------- 1 · 结果行：引擎算出来的结论必须到玩家手里 ----------
  {
    const d = newWorld();
    // peek 走的是**纯代码**分支，会写 ctx.opLog，且**不落 ledger** —— 正是坑 4 最典型的那一种
    const r = await G.runTurn(d, '我看看窗外', cfg);
    const out = (d.sceneLog || []).filter(l => l.type === 'outcome');
    ok(out.length === 1, '确定性结果落成 outcome beat（实得 ' + out.length + ' 条）');
    const inView = (r.view.sceneLog || []).filter(l => l.type === 'outcome');
    ok(inView.length === 1, '★ 结果行进了 buildView（玩家看得见）');
    ok(!!(inView[0] && inView[0].text), '结果行有正文：' + JSON.stringify(String((inView[0] || {}).text || '').slice(0, 40)));
  }

  // ---------- 2 · beat 槽位：落库不许拍平 ----------
  {
    const d = newWorld();
    d.meta.actorBudget = 0;   // 这一段只测「槽位有没有落库」，与角色分工（v1.94）隔离
    FAKE_FRAME = { frame: { tag: '夜 · 店里', beats: [
      { type: 'dialogue', speaker: 'npc_1', action: '用抹布擦了擦柜台，不抬头', expression: '眉心拧了一下，视线没有抬起来', voice: '尾音没抬起来，最后两个字很轻', text: '问我？我还能说啥。' },
    ] }, updates: [] };
    const r = await G.runTurn(d, '你好', cfg);
    // 按 speaker 找主 AI 那条（不是「最后一条」—— 引擎可能给自己开口的人补过 beat）
    const b = (d.sceneLog || []).filter(l => l.type === 'dialogue' && l.speaker === 'npc_1').slice(-1)[0] || {};
    ok(b.action === '用抹布擦了擦柜台，不抬头', '落库保留 action');
    ok(!!b.expression && b.expression.indexOf('眉心') >= 0, '★ 落库保留 expression：' + JSON.stringify(String(b.expression || '').slice(0, 30)));
    ok(!!b.voice && b.voice.indexOf('尾音') >= 0, '★ 落库保留 voice：' + JSON.stringify(String(b.voice || '').slice(0, 30)));
    /* 视图里 speaker 已被 buildView 换成**玩家看得见的称呼**（不再是 npc_1），所以按台词内容找。
       （这一段把 actorBudget 设成 0，所以台词没有被角色自己的原话替换掉。） */
    const vb = (r.view.sceneLog || []).filter(l => l.type === 'dialogue' && String(l.text || '').indexOf('我还能说啥') >= 0).slice(-1)[0] || {};
    ok(!!vb.expression && !!vb.voice, '★ 三个槽位都到了玩家视图（渲染层才拍平）');
    // 限长必须跟契约对齐（提示词给 20 字、sweepThink 切 12 字 = 静默砍一半）
    ok(String(b.expression).length <= 40 && String(b.voice).length <= 32, 'sweepThink 的限长 >= 契约值（没有提前砍掉）');
  }

  // ---------- 3 · 还悬着的事：同一个推导，第二次投影 ----------
  {
    const d = newWorld();
    const here = sceneId(d);
    d.knowledge.visited = d.knowledge.visited || [];
    if (d.knowledge.visited.indexOf(here) < 0) d.knowledge.visited.push(here);
    d.ledger = d.ledger || [];
    d.ledger.push({ id: 'l1', t: d.current.time, type: '事件开始', target: '阿岩欠的那笔钱', cause: '他开口借的', scene: here, visible: 'scene' });
    d.ledger.push({ id: 'l2', t: d.current.time, type: '事件开始', target: '你不该知道的秘密', cause: 'x', scene: here, visible: 'secret' });
    d.ledger.push({ id: 'l3', t: d.current.time, type: '事件开始', target: '别处发生的事', cause: 'y', scene: 'pl_99', visible: 'scene' });
    let v = G.buildView(d);
    const names = (v.loose || []).map(x => x.name);
    ok(names.indexOf('阿岩欠的那笔钱') >= 0, '★ 你看得见的事 → 上桌');
    ok(names.indexOf('你不该知道的秘密') < 0, '★ secret 事件被门控拦住');
    ok(names.indexOf('别处发生的事') < 0, '★ 没去过的地方的事被门控拦住');
    // 了结了就该消失
    d.ledger.push({ id: 'l4', t: d.current.time, type: '事件结束', target: '阿岩欠的那笔钱', scene: here, visible: 'scene' });
    v = G.buildView(d);
    ok((v.loose || []).map(x => x.name).indexOf('阿岩欠的那笔钱') < 0, '★ 了结之后从桌上消失（不判定成败，只陈述）');
    // 文案里不许出现引擎词汇
    const bad = (v.loose || []).filter(x => /事件|任务|状态|系统|未了/.test(String(x.name) + String(x.why)));
    ok(bad.length === 0, '文案里没有引擎词汇（无「事件/任务/状态」）');
  }

  // ---------- 4 · 结果行不许带系统术语上桌 ----------
  {
    const d = newWorld();
    const r = await G.runTurn(d, '我看看窗外', cfg);
    const txt = (r.view.sceneLog || []).filter(l => l.type === 'outcome').map(l => String(l.text || '')).join(' ');
    ok(txt.indexOf('『') < 0, '结果行里没有『』这类系统记号');
    ok(txt.indexOf('事件:') < 0, '结果行里没有「事件:」这类字段名');
  }

  // ---------- 5 · 「世界会回应你」与「引导」：两档分开，且引导不进剧情原文（v1.97 X6/X8） ----------
  {
    const d = newWorld();
    d.meta.actorBudget = 0;   // 与角色分工隔离：这一节只看两档 beat
    FAKE_FRAME = { frame: { tag: '夜 · 店里', beats: [] }, updates: [{ type: '关系变化', target: 'npc_1', change: '熟络了些', cause: '聊了两句' }] };
    const r = await G.runTurn(d, '你好', cfg);
    const logs = (d.sceneLog || []);
    const re = logs.filter(l => l.type === 'reaction');
    ok(re.length >= 1, '世界给你的反应落成 reaction 一档（实得 ' + re.length + ' 条）');
    ok(/心里记下了什么/.test(String((re[0] || {}).text || '')), 'reaction 的内容就是世界那一句：' + JSON.stringify(String((re[0] || {}).text || '')));
    ok(!logs.some(l => l.type === 'outcome' && /心里记下了什么/.test(String(l.text || ''))), 'reaction 没有混进 outcome（玩家做的 vs 世界回的，两档）');
    const tv = r.view.tutor;
    ok(!tv || !logs.some(l => String(l.text || '').indexOf(tv) >= 0), '教程提示不进剧情原文 —— 它是引导，不是世界内容（' + JSON.stringify(tv) + '）');
    const inView = (r.view.sceneLog || []).filter(l => l.type === 'reaction');
    ok(inView.length >= 1, '★ reaction 进了 buildView（玩家看得见）');
  }

  /* ── v3.3 名字门控：两个洞都是**实测**出来的，不是推演 ──────────────────────── */
  console.log('');
  console.log('[7] 玩家自己的认知 vs 印象档');
  {
    /* ① 实测（真实存档 w__muem2yglfdtge，4 回合）：玩家经历第一句是
       「你生在最有钱的赵家，是**赵德柱**唯一的儿子」，而印象档说他"不知道名字"——
       玩家连自己父亲的名字都不知道。同屏后果：「我」面板写着赵德柱，
       同一回合叙事把他打成「一个看不清面孔的人」，AI 资料包里他还是陌生人。 */
    const d = newWorld();
    const pid = Object.keys(d.entities).find(k => d.entities[k].type === 'person' && k !== 'player');
    const pname = d.entities[pid].name;
    d.entities.player.profile = d.entities.player.profile || {};
    d.entities.player.profile.background = { 经历: '你是' + pname + '唯一的儿子，从小在镇上长大。' };
    delete (d.impressions || {})[pid];
    ok(GATE.nameOf(d, pid) === pname, '★ 经历里点名的人 -> 门控认（"不知道自己父亲叫什么"这种漏）');

    /* ② 采纳绝不能变成"一修就全放开"：认知里没提到的人，一律还是不知道 */
    const nm2 = (d2x) => String(((d2x.entities.player.profile || {}).background || {}).经历 || '')
      + Object.values(d2x.memories || {}).filter(m => m.owner === 'player').map(m => m.content || '').join(' ');
    const d2 = newWorld();
    const stranger = Object.keys(d2.entities).find(k => d2.entities[k].type === 'person' && k !== 'player'
      && String(d2.entities[k].name || '').length > 1 && nm2(d2).indexOf(d2.entities[k].name) < 0);
    ok(!stranger || GATE.nameOf(d2, stranger) === null,
      '★ 认知里没提到的人' + (stranger ? '「' + d2.entities[stranger].name + '」' : '') + '仍然不知道（不许顺手全放开）');

    /* ③ 印象档里显式写"明确不知道"（nameKnown===false）是**档案作者的判断**，采纳不许覆盖它
       —— 门控规则②（gate.js:145）得留一个说了算的出口。 */
    const d3 = newWorld();
    d3.entities.player.profile = d3.entities.player.profile || {};
    d3.entities.player.profile.background = { 经历: '你和' + pname + '一起长大。' };
    d3.impressions = d3.impressions || {};
    d3.impressions[pid] = { stage: 2, nameKnown: false, traits: [], notes: [], bonds: [], seen: '' };
    ok(GATE.nameOf(d3, pid) === null, '★ 显式"明确不知道"的人不被采纳覆盖（规则②优先）');

    /* ④ 玩家给某人起的叫法（nameKnown 存的是称呼，不是实体真名）不许被采纳改掉
       —— 门控规则④"取 nameKnown 优先，其次实体真名"。 */
    const d4 = newWorld();
    d4.entities.player.profile = d4.entities.player.profile || {};
    d4.entities.player.profile.background = { 经历: '大家都管' + pname + '叫别的。' };
    d4.impressions = d4.impressions || {};
    d4.impressions[pid] = { stage: 3, nameKnown: '沈大姐', traits: [], notes: [], bonds: [], seen: '' };
    ok(GATE.nameOf(d4, pid) === '沈大姐', '★ 玩家心里的叫法（"沈大姐"）不被实体真名覆盖');
  }

  console.log('');
  console.log('[8] speaker / actor 不得成为绕过名字门控的通道');
  {
    /* 实测：speaker:'张三丰'（世界里根本没有这个人）原来一路裸奔进玩家视图 ——
       因为 resolveSpeaker 的最后一行是 return String(sid)，而 whoName 只拦 id 形态。
       后果：AI 想在屏幕上印谁的名字，塞进 speaker 就行，**不需要任何 Update、不需要锚、
       不需要走人物出现**，知识门控和「有主」被一个字段一起绕过去。 */
    const d = newWorld();
    d.sceneLog = [
      { t: d.current.time, type: 'dialogue', speaker: '张三丰', text: '无中生有的一句话' },
      { t: d.current.time, type: 'action', actor: '李四光', text: '无中生有的一个动作' }
    ];
    const s = JSON.stringify(G.buildView(d));
    ok(s.indexOf('张三丰') < 0, '★ 世界里查不到的人名塞进 speaker -> 不上屏');
    ok(s.indexOf('李四光') < 0, '★ actor 同罪（v1.97 只修了"id 形态显示成 ？"，没堵住"编个名字"）');
  }

  AI.isLive = realIsLive; AI.llmJSON = realLlmJSON;
  console.log('');
  console.log('pass=' + pass + ' fail=' + fail);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });