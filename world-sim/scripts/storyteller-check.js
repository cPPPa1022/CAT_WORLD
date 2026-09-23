'use strict';
// storyteller-check.js — v1.91 **叙事者（油门）**断言
//
// 为什么要它：叙事者的每一条性质都是「不做也不会报错」的那种 ——
// 门槛写反了（过得好反而更平静）、冷却失效、空闲项没接、补偿分支永远不触发，
// 全都能静默跑很久。而它一旦坏了，症状是**玩家觉得世界很闷**，没人能定位到这一层。
// 用法：node scripts/storyteller-check.js   失败非零退出
const NL2 = String.fromCharCode(10);
const ST = require('../src/storyteller');
const AI = require('../src/ai');
const W = require('../src/world');
const G = require('../src/game');
const RT = require('../src/runtime');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  OK  ' + m)) : (fail++, console.log('  FAIL ' + m)); };
const newWorld = () => { const d = W.buildDemoWorld(); d.id = (p) => p + '_' + Math.random().toString(36).slice(2, 8); return d; };
const hours = (d, h) => { d.current.time = RT.addMinutes(d.current.time, h * 60); return d.current.time; };

(async () => {
  // ---------- 1 · 预设由世界包推导（框架认参数不认假设） ----------
  {
    const a = newWorld(); a.meta.maxSeverity = 'L2';
    const b = newWorld(); b.meta.maxSeverity = 'L3';
    const c = newWorld(); c.meta.maxSeverity = 'L4';
    const e = newWorld(); e.meta.maxSeverity = 'L4'; e.meta.storyteller = 'gentle';
    ok(ST.presetOf(a).key === 'gentle', 'L2 日常卡 → gentle（温和：间隔长）');
    ok(ST.presetOf(b).key === 'classic', 'L3 地区卡 → classic');
    ok(ST.presetOf(c).key === 'wild', 'L4 末世卡 → wild（无常：不管形状）');
    ok(ST.presetOf(e).key === 'gentle', '世界包显式声明时覆盖推导');
  }

  // ---------- 2 · 张力随积累上升 ----------
  {
    const d = newWorld();
    const t0 = ST.evalOnce(d, d.current.time).tension;
    d.entities.player.money.cash = 5000;
    const t1 = ST.evalOnce(d, d.current.time).tension;
    d.impressions = d.impressions || {};
    for (let i = 0; i < 6; i++) d.impressions['x' + i] = { stage: 3 };
    const t2 = ST.evalOnce(d, d.current.time).tension;
    d.ledger.push({ id: 'e1', t: d.current.time, type: '事件开始', target: '欠的账', scene: d.current.sceneId, visible: 'scene' });
    const t3 = ST.evalOnce(d, d.current.time).tension;
    ok(t1 > t0, '家底厚 → 张力升（' + t0.toFixed(1) + ' → ' + t1.toFixed(1) + '）');
    ok(t2 > t1, '熟人变多 → 张力升（' + t1.toFixed(1) + ' → ' + t2.toFixed(1) + '）');
    ok(t3 > t2, '悬着的事多一条 → 张力升（' + t2.toFixed(1) + ' → ' + t3.toFixed(1) + '）');
  }

  // ---------- 3 · 空闲项：没有它，平静的世界永远不会起事 ----------
  {
    const d = newWorld();
    const t0 = ST.evalOnce(d, d.current.time).tension;
    hours(d, 40);
    const t1 = ST.evalOnce(d, d.current.time).tension;
    hours(d, 400);
    const t2 = ST.evalOnce(d, d.current.time).tension;
    ok(t1 > t0, '★ 什么都没发生，40 世界小时后张力自己涨（' + t0.toFixed(1) + ' → ' + t1.toFixed(1) + '）');
    ok(t2 - t1 <= ST.PARAMS.IDLE_MAX + 0.01, '★ 空闲有封顶（不会憋出一个大的）：' + t2.toFixed(1));
  }

  // ---------- 4 · 门槛 / 冷却 / 适应度方向 ----------
  {
    const d = newWorld();
    d.entities.player.money.cash = 3000;
    const e1 = ST.evalOnce(d, d.current.time);
    ok(e1.fire, '积累够了 → 放行（张力 ' + e1.tension.toFixed(1) + ' ≥ 门槛 ' + e1.gate.toFixed(1) + '）');
    ST.mark(d, 'fire', d.current.time);
    const e2 = ST.evalOnce(d, d.current.time);
    ok(!e2.fire, '★ 刚放行 → 冷却中，不会再放（防刷屏）');
    ok(e2.gate < e1.gate, '★ 适应度方向正确：过得好 → 门槛**下降**（' + e1.gate.toFixed(1) + ' → ' + e2.gate.toFixed(1) + '），不是更平静');
    hours(d, e2.cooldownH + 1);   // 用**这个预设生效的**冷却，不是全局基准（gentle 是 12×1.7=20.4h）
    const e3 = ST.evalOnce(d, d.current.time);
    ok(e3.fire, '冷却过后又能放行（预设 ' + e2.preset + ' 的间隔 = ' + e2.cooldownH.toFixed(1) + ' 世界小时）');
  }

  // ---------- 5 · 受挫补偿（Phoebe 那一套） ----------
  {
    const d = newWorld();
    ST.evalOnce(d, d.current.time);
    d.ledger.push({ id: 'r1', t: d.current.time, type: '交易拒绝', target: 'player', desc: 'x' });
    d.ledger.push({ id: 'r2', t: d.current.time, type: '交易拒绝', target: 'player', desc: 'y' });
    const e = ST.evalOnce(d, d.current.time);
    ok(e.setback >= 2, '受挫被数到（setback=' + e.setback + '）');
    ok(e.compensate, '★ 受挫够 → 允许一条补偿性节拍');
    const comp = ST.promptBlock(Object.assign({}, e, { fire: false, compensate: true }));
    ok(comp.indexOf('补偿') >= 0 && comp.indexOf('不要告诉玩家') >= 0, '补偿指令要求「不要告诉玩家这是补偿」（diegetic）');
    const wild = newWorld(); wild.meta.storyteller = 'wild';
    wild.ledger.push({ id: 'r3', t: wild.current.time, type: '交易拒绝', target: 'player', desc: 'x' });
    wild.ledger.push({ id: 'r4', t: wild.current.time, type: '交易拒绝', target: 'player', desc: 'y' });
    ok(!ST.evalOnce(wild, wild.current.time).compensate, 'wild（无常）不做补偿 —— 三个叙事者是真的三条曲线');
  }

  // ---------- 6 · 零 token：平静时零字节 ----------
  {
    const quiet = ST.promptBlock({ fire: false, compensate: false });
    ok(quiet === '', '★ 平静时指令是**空字符串**（提示词里零字节）');
    const loud = ST.promptBlock({ fire: true, compensate: false, why: '测试' });
    ok(loud.indexOf('烈度') >= 0 && loud.indexOf('由你决定') >= 0, '放行时指令写明：烈度受上限约束、内容由 AI 决定');
  }

  // ---------- 7 · 叙事者不可见：绝不上玩家界面（RimWorld 的 unseeable God） ----------
  {
    const d = newWorld();
    ST.evalOnce(d, d.current.time);
    const v = G.buildView(d);
    const s = JSON.stringify(v);
    ok(s.indexOf('storyteller') < 0 && s.indexOf('适应度') < 0 && s.indexOf('张力') < 0,
      '★ buildView 里没有任何叙事者痕迹（它没有游戏内的显形）');
  }

  // ---------- 8 · 端到端：节拍到点时真的进了资料包 ----------
  {
    const calls = [];
    const realIsLive = AI.isLive, realLlmJSON = AI.llmJSON;
    AI.isLive = () => true;
    AI.llmJSON = async function (cfg, messages) {
      const pack = messages.filter(m => m.role === 'user').map(m => String(m.content)).join(NL2);
      // 只有**主 AI** 的 user 消息才是资料包（副 AI 走的是各自的小 JSON）—— 用资料包独有的键认出来
      let obj = null;
      try { obj = JSON.parse(pack); } catch (e) { obj = null; }
      const isPacket = !!(obj && ('你的身世(你本人完全清楚的)' in obj));
      calls.push({ isPacket: isPacket, pace: isPacket ? obj['世界节拍'] : undefined, all: messages.map(m => String(m.content)).join(NL2) });
      return { frame: { tag: 't', beats: [] }, updates: [] };
    };
    const d = newWorld();
    d.entities.player.money.cash = 5000;
    await G.runTurn(d, '你好', { llm: { baseURL: 'http://x', apiKey: 'k', model: 'm' }, roles: {} });
    ok(calls.some(c => c.isPacket && c.pace && String(c.pace).indexOf('该有点事了') >= 0), '★ 节拍到点时，指令真的进了主 AI 的资料包字段「世界节拍」');
    ok((d.current.storyteller || {}).fired >= 1, '放行已记账（fired=' + ((d.current.storyteller || {}).fired || 0) + '）');
    // 平静的世界不该出现这一栏
    calls.length = 0;
    const d2 = newWorld();
    await G.runTurn(d2, '你好', { llm: { baseURL: 'http://x', apiKey: 'k', model: 'm' }, roles: {} });
    // 注意：不能查裸字符串 —— SYSTEM 里本来就印着「【世界节拍 · 只在它出现时生效】」这句说明。
    // 要查的是**资料包字段**：平静时它必须是 null（AI 手里什么都没有）。
    const packs = calls.filter(c => c.isPacket);
    ok(packs.length > 0 && packs.every(c => c.pace === null), '★ 世界平静时资料包里的「世界节拍」是 null（AI 看不到任何东西，实得 ' + packs.length + ' 个资料包）');
    AI.isLive = realIsLive; AI.llmJSON = realLlmJSON;
  }

  console.log('');
  console.log('pass=' + pass + ' fail=' + fail);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });