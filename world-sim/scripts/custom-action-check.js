// custom-action-check.js — 自定义动作的洞 + NPC 位置门（v1.99 · P0-6 第一批）
// 病（评审 P0-6 §3.3）：玩家自定义动作的 8 个效果里有一半**绕过世界规则** ——
//   改钱不落账、加物品不落账、移动零耗时（免费瞬移、地图上不算去过）、造人是 fire-and-forget（当回合看不见）、
//   preconditions 声明了却从来没人读；出错只打印一句"（效果异常）"，半成品状态被文案盖住。
// 另一半（P0-4 的规则内容）：`NPC状态更新{field:'location'}` 谁都能写，而 tickNPCs 下一次按日程把人拽回去。
'use strict';
const path = require('path'), os = require('os'), fs = require('fs');
const TMP = path.join(os.tmpdir(), 'ws-custom-' + Date.now());
process.env.WORLD_SIM_DATA = TMP; fs.mkdirSync(TMP, { recursive: true });
const ROOT = path.join(__dirname, '..');
process.env.WORLD_SIM_ASSETS = ROOT;
const { buildDemoWorld } = require(ROOT + '/src/world');
const { makeId } = require(ROOT + '/src/store');
const DIR = require(ROOT + '/src/director');
const RT = require(ROOT + '/src/runtime');
const G = require(ROOT + '/src/game');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const mk = () => { const d = buildDemoWorld(); if (!d.id) d.id = makeId; d.impressions = {}; return d; };
const T = '1996-06-14T20:45:00';
const act = (pre, effects) => ({ id: 'cx_test', name: '测试动作', trigger_patterns: ['测试'], preconditions: pre || [], effects: effects });
const run = async (d, custom) => DIR.applyCustom(d, custom, { llm: { baseURL: '', apiKey: '', model: '' } }, T);

(async () => {
console.log('');
console.log('自定义动作：前置条件 / 钱物有账 / 移动有代价 / 造人 awaited / 失败结构化');

// ── ① 前置条件真的被执行（原来声明了没人读） ──
{
  const d = mk();
  const led0 = d.ledger.length, cash0 = d.entities.player.money.cash;
  const r = await run(d, act([{ type: 'has_money', min: 9999, msg: '钱不够雇车' }], [{ type: 'deduct_money', amount: 20 }]));
  ok(r.rejected.length === 1 && r.rejected[0].code === 'precondition_failed', '★ 前置条件不满足 → 拒（code=precondition_failed）');
  ok(d.entities.player.money.cash === cash0 && d.ledger.length === led0, '★ 三处状态全不变（钱没动、账本没动）');
  ok(/还不到做这件事的时候|钱不够雇车/.test(r.lines.join('')), '给玩家的话是人话：' + JSON.stringify(r.lines[0]));
  const r2 = await run(d, act([{ type: 'has_phase_of_moon', min: 1 }], [{ type: 'deduct_money', amount: 20 }]));
  ok(r2.rejected[0] && r2.rejected[0].code === 'unknown_precondition', '★ 引擎不认识的类型 → unknown_precondition（白名单外的类型不许悄悄放行）');
  const r3 = await run(d, act([{ type: 'has_money', min: 10 }], [{ type: 'deduct_money', amount: 20 }]));
  ok(r3.rejected.length === 0 && d.entities.player.money.cash === cash0 - 20, '前置条件满足 → 正常执行（钱 −20）');
}
// ── ② 钱的收支都要落账（原来改钱不落账） ──
{
  const d = mk();
  const led0 = d.ledger.length, cash0 = d.entities.player.money.cash, spent0 = d.entities.player.money.spent || 0;
  await run(d, act([], [{ type: 'deduct_money', amount: 20 }]));
  ok(d.ledger.length === led0 + 1 && d.ledger[d.ledger.length - 1].type === '物品消耗', '★ 支出落账（物品消耗）：' + d.ledger[d.ledger.length - 1].desc);
  ok(d.ledger[d.ledger.length - 1].cause === 'cx_test', '账目带 cause = 动作 id（能追溯是谁花的）');
  ok(d.entities.player.money.cash === cash0 - 20 && (d.entities.player.money.spent || 0) === spent0 + 20, '余额恰好 −20、spent 恰好 +20');
  const before = d.ledger.length;
  await run(d, act([], [{ type: 'earn_money', amount: 35 }]));
  ok(d.ledger.length === before + 1 && d.ledger[d.ledger.length - 1].type === '物品获取', '★ 收入也落账（物品获取）');
  ok(d.entities.player.money.cash === cash0 + 15, '进账正确（−20 + 35）');
  // 余额不足：钱与账本都不许动
  const d2 = mk(); d2.entities.player.money.cash = 5; d2.entities.player.money.digital = 0;
  const l2 = d2.ledger.length;
  const r = await run(d2, act([], [{ type: 'deduct_money', amount: 20 }]));
  ok(d2.entities.player.money.cash === 5 && d2.ledger.length === l2, '★ 钱不够 → 一分不动、一条不记');
  ok(/钱不够/.test(r.lines.join('')) && r.rejected.some(x => x.code === 'insufficient_funds'), '★ 而且是被拒（结构化 + 人话）：' + JSON.stringify(r.rejected[0]));
}
// ── ③ 物品与移动 ──
{
  const d = mk();
  const inv0 = d.entities.player.inventory.length, led0 = d.ledger.length;
  await run(d, act([], [{ type: 'add_item', name: '一把旧伞' }]));
  ok(d.entities.player.inventory.length === inv0 + 1 && d.entities.player.inventory[inv0].name === '一把旧伞', '物品进背包');
  ok(d.ledger.length === led0 + 1 && d.ledger[d.ledger.length - 1].type === '物品获取', '★ 加物品也落账（原来不落）');

  const d2 = mk();
  const t0 = d2.current.time, l0 = d2.ledger.length;
  const cost = RT.moveCost(d2, d2.current.sceneId, 'pl_4', t0);
  const r = await run(d2, act([], [{ type: 'move_to', place: '老茶馆' }]));
  ok(d2.current.sceneId === 'pl_4', '移动到目的地');
  const advanced = (new Date(d2.current.time).getTime() - new Date(t0).getTime()) / 60000;
  ok(advanced === cost.minutes, '★★ 而不是零耗时（按 moveCost 花 ' + cost.minutes + ' 分钟，实际 ' + advanced + '，原来免费瞬移）');
  ok((d2.knowledge.visited || []).indexOf('pl_4') >= 0 && (d2.knowledge.knownPlaces || []).indexOf('pl_4') >= 0, '★ 记进"去过的地方 / 知道的地方"（原来地图上不算去过）');
  ok(d2.current.weatherSeen === false || d2.current.weatherSeen === true, '天气感知被刷新（室内=false）');
  ok(d2.ledger.length === l0 + 1 && d2.ledger[d2.ledger.length - 1].type === '地点变化' && d2.ledger[d2.ledger.length - 1].scene === 'pl_4', '★ 落一条可重放的"地点变化"账（d.scene）');
  ok(r.clockDelta === cost.minutes, '返回值带 clockDelta（调用方/断言看得见）：' + r.clockDelta);
  const d3 = mk();
  const r3 = await run(d3, act([], [{ type: 'move_to', place: '不存在的地方' }]));
  ok(r3.rejected.some(x => x.code === 'no_such_place') && d3.current.sceneId === 'pl_1', '目标不存在 → 拒且位置不变');
}
// ── ④ add_entity 必须 await（原来 fire-and-forget，玩家当回合看不到） ──
{
  const d = mk();
  const n0 = Object.keys(d.entities).length;
  const r = await run(d, act([], [{ type: 'add_entity', kind: 'item', name: '一枚旧铜钱' }]));
  ok(Object.keys(d.entities).length > n0 || r.rejected.some(x => x.code === 'create_failed'), '★ 返回时"造的东西"已经有结论（要么已在世界里，要么明确失败）：实体 ' + n0 + ' → ' + Object.keys(d.entities).length);
}
// ── ⑤ 未知效果 / 异常都是结构化拒绝 ──
{
  const d = mk();
  const r = await run(d, act([], [{ type: 'teleport_to_moon' }]));
  ok(r.rejected.some(x => x.code === 'unknown_effect'), '★ 白名单外的效果类型 → unknown_effect（原来静默跳过）');
  ok(r.lines.length === 0 || typeof r.lines[0] === 'string', '人话输出仍是字符串数组（opLog 兼容）');
}
// ── ⑥ NPC 位置门（P0-4 规则内容） ──
{
  const d = mk();
  const npc = d.entities.npc_1;
  const sched = RT.schedulePlace(d, npc, d.current.time);
  const v1 = RT.validateUpdates(d, [{ type: 'NPC状态更新', target: 'npc_1', field: 'location', to: sched }], { beats: [] }, {});
  ok(v1.allowed.length === 1, '★ 等于日程算出的位置 → 放行（他本来就该在那儿）：' + sched);
  const v2 = RT.validateUpdates(d, [{ type: 'NPC状态更新', target: 'npc_1', field: 'location', to: 'pl_4' }], { beats: [] }, {});
  ok(v2.allowed.length === 0 && /因果/.test(v2.errors.join(' ')), '★★ 日程之外、又没有因果 → 拒：' + JSON.stringify(v2.errors[0]));
  const v3 = RT.validateUpdates(d, [{ type: 'NPC状态更新', target: 'npc_1', field: 'location', to: 'pl_999', cause: '想跑' }], { beats: [] }, {});
  ok(v3.allowed.length === 0 && /不存在/.test(v3.errors.join(' ')), '目标地点不存在 → 拒');
  const v4 = RT.validateUpdates(d, [{ type: 'NPC状态更新', target: 'npc_1', field: 'location', to: 'pl_4', cause: '去茶馆躲雨' }], { beats: [] }, {});
  ok(v4.allowed.length === 1 && v4.allowed[0]._npcOverride && v4.allowed[0]._npcOverride.place === 'pl_4', '★ 有因果 + 有通路 → 放行，并标记成 override');
  // 落库：写成 state.override，且下一回合 tick 不把他拽回去
  G.applyUpdates(d, v4.allowed, T);
  ok(npc.state.location === 'pl_4' && npc.state.override && npc.state.override.place === 'pl_4', '★ 落库写成 state.override（有时限）：' + JSON.stringify(npc.state.override));
  const until = npc.state.override.until;
  const mins = (new Date(until).getTime() - new Date(T).getTime()) / 60000;
  ok(mins >= 10 && mins <= 1440, '时限夹在 10–1440 分钟：' + mins);
  RT.tickNPCs(d, RT.addMinutes(T, 5));      // 仍在 override 时限内
  ok(npc.state.location === 'pl_4', '★ 下一回合 tick **不把他拽回日程**（这就是 override 的意义）');
  RT.tickNPCs(d, RT.addMinutes(T, 24 * 60));  // 过了时限
  ok(npc.state.location !== 'pl_4' || !npc.state.override, '★ 过期后回到日程（不是永久覆盖）');
}
console.log('');
console.log('==== custom-action-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
})().catch(e => { console.log('PROBE ERROR ' + String((e && e.message) || e)); process.exit(1); });
