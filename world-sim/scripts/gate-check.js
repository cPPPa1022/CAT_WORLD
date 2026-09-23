// gate-check.js — 知识门控回归（A1/A2/A3/A5 + C1/C3 + B1）
// 用法: node scripts/gate-check.js
// 断言的是"AI 资料包与玩家视图里，有没有出现玩家还不该知道的东西"。
'use strict';
const AI = require('../src/ai');
const G = require('../src/game');
const W = require('../src/world');

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  << ' + extra : '')); }
};
// buildDemoWorld 复用同一份原型（改动会串到下一条断言）——每次深拷一份，保证断言之间互不污染
const mk = () => JSON.parse(JSON.stringify(W.buildDemoWorld()));
// 资料包里的值是"数组或字符串"两种形态——统一压成 JSON 文本再断言，
// 别用 String(x)：String([{...}]) 会走 join('，') 把对象变成 "[object Object]"（本脚本踩过一次）。
const json = (x) => JSON.stringify(x);

// ---------- A1：在场人物不许把真名喂给 AI ----------
console.log('\n[A1] 在场人物走 viewName 门控');
(function () {
  const d = mk();
  const sid = d.current.sceneId;
  // 造一个"玩家还没认识"的同场 NPC（印象 stage 0）
  d.entities.npc_stranger = {
    id: 'npc_stranger', type: 'person', name: '周师傅',
    profile: { appearance: { 标志物: '背着帆布工具袋' }, surface: { 待人: '寡言' } },
    state: { location: sid, mood: '平静' }
  };
  d.impressions = d.impressions || {};
  d.impressions.npc_stranger = { stage: 0, seen: false, traits: [], notes: [], bonds: [], nameKnown: null };
  const pack = AI.packetFor(d, { action: '我打量一下店里的人', memories: [], candidates: [] });
  const j = JSON.parse(pack);
  const row = (j['在场人物(全部)'] || []).find(x => x.id === 'npc_stranger');
  ok(!!row, '陌生人出现在在场人物里');
  ok(row && row.name.indexOf('周师傅') < 0, '资料包不含陌生人真名「周师傅」', row && row.name);
  ok(row && /背包|工具袋|陌生人/.test(row.name), '资料包给的是可见特征指代', row && row.name);
})();

// ---------- A2：世界书两层门控 ----------
console.log('\n[A2] 世界书命中分「已知/未解锁」');
(function () {
  const d = mk();
  // 用"只按 uid 命中"的构造，避免撞上 NPC 真名（真名命中是正常解锁路径，会让这条断言失真）
  d.worldinfo = { t1: { uid: 't1', keys: ['闸北码头'], content: '闸北码头的货仓里堆着一批来历不明的布。', enabled: true } };
  const key = '闸北码头';
  const secret = '来历不明的布';
  d.knowledge.heardNews = [];
  const pack1 = JSON.parse(AI.packetFor(d, { action: key, memories: [], candidates: [] }));
  ok(json(pack1['世界书命中']).indexOf(secret) < 0, '未听说过 → 秘密内容不进 AI 资料包', json(pack1['世界书命中']).slice(0, 80));
  const whText = JSON.stringify(pack1['命中但未解锁(玩家不知道·禁止写进画面)'] || []);
  ok(whText.indexOf(secret) < 0, '未解锁条目只给 uid/keys，正文一个字都不给 AI', whText.slice(0, 120));
  ok(/t1/.test(whText), '未解锁条目被点名（让 AI 知道"有但不能说"）', whText.slice(0, 120));
  // 已 heard：解锁（两种"听说过"的表达都认：条目 uid，或关键词）
  for (const heard of [['t1'], [key]]) {
    d.knowledge.heardNews = heard;
    const pack2 = JSON.parse(AI.packetFor(d, { action: key, memories: [], candidates: [] }));
    ok(json(pack2['世界书命中']).indexOf(secret) >= 0, 'heardNews=' + JSON.stringify(heard) + ' → 内容正常进资料包',
      json(pack2['世界书命中']).slice(0, 80));
  }
  // public 档：街上都知道的事，不需要听说过
  d.worldinfo.t1.tier = 'public';
  d.knowledge.heardNews = [];
  const pack3 = JSON.parse(AI.packetFor(d, { action: key, memories: [], candidates: [] }));
  ok(json(pack3['世界书命中']).indexOf(secret) >= 0, 'tier=public → 无需听说过也进资料包', json(pack3['世界书命中']).slice(0, 80));
})();

// ---------- A3：时间/天气走感知 ----------
console.log('\n[A3] 时间/天气走玩家感知');
(function () {
  const d = mk();
  const j = JSON.parse(AI.packetFor(d, { action: '看看现在几点', memories: [], candidates: [] }));
  const iso = d.current.time;
  const hasTool = ((d.meta && d.meta.tools) || []).some(t => t.id === 'phone' || t.id === 'brick');
  if (hasTool) {
    ok(/\d{2}:\d{2}/.test(String(j['当前时间'])), '有计时设备 → 允许精确时刻', String(j['当前时间']));
  } else {
    ok(!/\d{2}:\d{2}/.test(String(j['当前时间'])), '无计时设备 → 资料包不含精确时刻', String(j['当前时间']));
  }
  ok(j['感知提示'], '资料包带"只许用感知粒度"的约束');
  ok(String(j['当前时间']) !== ISO_ALIKE(iso) || hasTool, '与裸 ISO 不同（已过感知层）');
  function ISO_ALIKE(s) { return s; }
})();

// ---------- A5：玩家视图不含客观账本 / 字段名 ----------
console.log('\n[A5] 客观账本不进玩家视图');
(function () {
  const d = mk();
  const v = G.buildView(d);
  ok(v.lastLedger === undefined, 'view 不再有 lastLedger（客观事件流）');
  ok(Array.isArray(v.myLog), 'view 有 myLog（你记得的）');
  const raw = JSON.stringify(v.myLog || []);
  ok(!/记忆新增|关系变化|事件开始|信息到达|物品获取/.test(raw), 'myLog 不含 ledger.type 字段名', raw.slice(0, 120));
  // 造一条"玩家不在场的事" → 必须不出现在 myLog
  d.ledger.push({ id: 'l1', t: d.current.time, type: '镜头外事件', target: 'npc_1', desc: '沈姨的儿子在城里出了事' });
  const v2 = G.buildView(d);
  ok(JSON.stringify(v2.myLog || []).indexOf('出了事') < 0, '玩家不在场的事不进 myLog');
})();

// ---------- C1：重复键 ----------
console.log('\n[C1] packet 无重复键');
(function () {
  const d = mk();
  const pack = AI.packetFor(d, { action: '你好', memories: [], candidates: [] });
  const hits = (pack.match(/"离线简报"/g) || []).length;
  ok(hits <= 1, '「离线简报」只出现一次', '出现 ' + hits + ' 次');
})();

// ---------- B1：窗口 ≥ 一回合产量 ----------
console.log('\n[B1] 场景原文窗口');
(function () {
  const d = mk();
  for (let i = 0; i < 24; i++) d.sceneLog.push({ t: d.current.time, type: 'narration', text: '第' + i + '条' });
  const j = JSON.parse(AI.packetFor(d, { action: 'x', memories: [], candidates: [] }));
  ok((j['最近场景原文'] || []).length >= 24, '窗口 ≥24 条（旧版 8 条装不下自己一回合的产出）', String((j['最近场景原文'] || []).length));
})();

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
