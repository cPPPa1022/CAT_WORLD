// money-account-check.js — v3.20「钱与账」：钱有写出路、账有家、状态简介看得见（离线断言）
//
// 为什么有它（用户实测 OOC，2026-09-27「都市神壕之我爱装逼」第 3 回合）：
//   玩家说「给房东先把欠的房租和这个月的房租转过去」，AI 演了一整段转账，被一个凭空冒出来的
//   「房东王师傅」敲门打断；存档里 money.spent 还是 0。用户三问：难道不是按照开场继续的剧情吗 /
//   转钱不够明显吗 2020年没有微信吗 / 王师傅是谁 房东不是姓傅吗。
//   四条根因（这次全在引擎这侧）：钱没有 AI 的写入路径、资料包里没有钱包、欠账只活在散文里、
//   提示词里没有"具体动作必须给结果 / 不许拿新造的人打断"。
// 这个脚本把这四件事**钉成可跑的断言** —— 以后谁把它们改回去，这里就红。
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
process.env.WORLD_SIM_DATA = process.env.WORLD_SIM_DATA || path.join(ROOT, '..', '.tmp-smoke', 'data-ma');
process.env.WORLD_SIM_ASSETS = process.env.WORLD_SIM_ASSETS || ROOT;
const { buildDemoWorld } = require(ROOT + '/src/world');
const RT = require(ROOT + '/src/runtime');
const G = require(ROOT + '/src/game');
const AI = require(ROOT + '/src/ai');
const C = require(ROOT + '/src/contract');
const ACC = require(ROOT + '/src/accounts');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const mk = () => buildDemoWorld();
const V = (d, u) => RT.validateUpdates(d, [u], { beats: [] }, {});

// ── 1. 契约与提示词（改回去就红）──
console.log('== 契约 ==');
ok(C.UPDATE_TYPE_NAMES.indexOf('钱款变动') >= 0, '白名单有「钱款变动」');
ok(C.UPDATE_TYPE_NAMES.indexOf('账目') >= 0, '白名单有「账目」');
const block = C.promptUpdatesBlock();
ok(block.indexOf('钱款变动') >= 0 && block.indexOf('账目') >= 0, '提示词块自动覆盖这两种类型（不再手抄）');
const sys = String(AI.SYSTEM(mk(), {}));
ok(/只有一套账/.test(sys) && /钱款变动/.test(sys), 'SYSTEM 写了【钱 · 只有一套账】');
ok(/说了就要有结果/.test(sys) && /打断/.test(sys), 'SYSTEM 写了【说了就要有结果 · 不许拿新造的人打断】');
ok(/门外的人/.test(sys), 'SYSTEM 写了【门外的人是谁，以资料包为准】');
ok(/私事不外传/.test(sys), 'SYSTEM 写了【私事不外传】（知情范围）');

// ── 2. 资料包：AI 真的看得见钱包 ──
console.log('');
console.log('== 资料包「你的钱」==');
{
  const d = mk();
  d.entities.player.money = { currency: '人民币（元）', sym: '¥', cash: 15000, digital: 12000, spent: 0, earned: 0 };
  const p = JSON.parse(AI.packetFor(d, {}));   // packetFor 返回的是渲染好的 JSON 串
  ok(p['你的钱'] && p['你的钱'].现金 === 15000 && p['你的钱'].电子 === 12000, '钱包（现金/电子）原样进资料包：' + JSON.stringify(p['你的钱'] && { c: p['你的钱'].现金, e: p['你的钱'].电子 }));
  ok(/银行|邮局|汇款/.test(String(p['你的钱'].付款方式)), 'brick 时代 → 付款方式是银行/邮局汇款（不是手机支付）');
  d.meta.carries.time = 'phone';
  const p2 = JSON.parse(AI.packetFor(d, {}));
  ok(/手机/.test(String(p2['你的钱'].付款方式)) && /转账/.test(String(p2['你的钱'].付款方式)), '2020 手机时代 → 资料包明说"手机能转账"，并让 AI 自己按语境选（微信/支付宝）');
  ok(C.assertContextOrder(Object.keys(p2)).ok, '新字段登记进了分层（键序断言）');
}

// ── 3. 校验器：够不够 / 有没有这条账 ──
console.log('');
console.log('== 校验器 ==');
{
  const d = mk();
  d.entities.player.money = { currency: '元', cash: 52, digital: 30, spent: 0, earned: 0 };
  ok(V(d, { type: '钱款变动', dir: '付', amount: 20, to: 'npc_1', what: '房租', cause: '该交的' }).allowed.length === 1, '钱够 + 带因果 → 放行');
  ok(V(d, { type: '钱款变动', dir: '付', amount: 20, to: 'npc_1' }).errors.some(e => /cause/.test(e)), '不带 cause → 拒');
  const poor = V(d, { type: '钱款变动', dir: '付', amount: 9999, to: 'npc_1', what: '买车', cause: '想买' });
  ok(poor.errors.some(e => /差/.test(e)) && poor.errors.some(e => /没办成|写成/.test(e)), '钱不够 → 拒**并告诉它差多少、要写成没办成**：' + String(poor.errors[0] || '').slice(0, 60));
  ok(V(d, { type: '钱款变动', dir: '收', amount: 9999, from: 'npc_1', what: '遗产', cause: '他给的' }).allowed.length === 1, '收钱不看余额（方向反了就是合法的）');
  ok(V(d, { type: '钱款变动', dir: '付', amount: '2400元', to: 'npc_1', what: '房租', cause: '该交的' }).errors.some(e => /差/.test(e)), '"2400元" 这种写法金额认得出来（归一后照样判）');
}
{
  const d = mk();
  ok(V(d, { type: '账目', who: '不存在的人', amount: 100, what: '借的', cause: 'x' }).errors.some(e => /认识的人/.test(e)), '账目记在名单外的人身上 → 拒');
  ok(V(d, { type: '账目', who: 'npc_1', amount: 0, what: '借的', cause: 'x' }).errors.some(e => /amount/.test(e)), '账目没有金额 → 拒（不许编数字）');
  const good = V(d, { type: '账目', op: '记', dir: '欠', who: 'npc_1', amount: 2400, what: '两个月房租', due: '2020-10-10', cause: '开场就欠着' });
  ok(good.allowed.length === 1, '记一笔账 → 放行');
  G.applyUpdates(d, good.allowed, d.current.time);
  ok(d.accounts.length === 1 && d.accounts[0].amount === 2400 && d.accounts[0].status === 'open', '账落库了（' + (d.accounts[0] && d.accounts[0].what) + '）');
  ok((d.ledger || []).some(l => l.type === '账目'), '记一笔账要留痕（账本）');
  ok(V(d, { type: '账目', op: '清', who: 'npc_2', cause: 'x' }).errors.some(e => /没有这一条/.test(e)), '结清一笔不存在的账 → 拒（不许凭空销账）');
  d.entities.player.money.cash = 5000;   // 钱够，才测得到"不够清"这一条
  const part = V(d, { type: '钱款变动', dir: '付', amount: 100, account: d.accounts[0].id, cause: '先还一点' });
  ok(part.errors.some(e => /不算清/.test(e)), '只付一小部分还想当还清 → 拒');
  ok(!!ACC.find(d, { who: 'npc_1' }), '账目能被找回来（ACC.find：校验器与执行器共用同一份判据）');
}

// ── 4. 执行器：钱真的动了（用户说的"转钱"）──
console.log('');
console.log('== 走一遍"给房东转房租" ==');
{
  const d = mk();
  d.entities.player.money = { currency: '元', cash: 15000, digital: 12000, spent: 0, earned: 0 };
  G.applyUpdates(d, [{ type: '账目', op: '记', dir: '欠', who: 'npc_1', amount: 2400, what: '两个月房租', cause: '开场就欠着' }], d.current.time);
  const acc = d.accounts[0];
  const v = V(d, { type: '钱款变动', dir: '付', account: acc.id, what: '欠的房租和这个月的房租', channel: '手机银行', cause: '把欠的房租结清' });
  ok(v.allowed.length === 1, '转这一笔 → 放行（金额按账目算，AI 不用自己报数）');
  G.applyUpdates(d, v.allowed, d.current.time);
  const w = d.entities.player.money;
  ok(w.digital === 12000 - 2400 && w.cash === 15000, '钱真的动了，且**先扣电子**（电子 12000→' + w.digital + '，现金 ' + w.cash + '）');
  ok(w.spent === 2400, '花掉的记上了（spent=' + w.spent + '）');
  ok(d.accounts[0].status === 'settled', '这一笔账自动结清（欠租 → 已结清）');
  ok((d.ledger || []).some(l => l.type === '钱款变动' && /2400/.test(l.desc || '')), '账本有一条钱款变动：' + ((d.ledger || []).filter(l => l.type === '钱款变动')[0] || {}).desc);
  ok((d.ledger || []).some(l => l.type === '账目结清'), '账本有一条账目结清（有头有尾）');
  const vb = G.buildView(d);
  ok(Array.isArray(vb.accounts) && vb.accounts[0] && vb.accounts[0].status === 'settled', '玩家视图带着账目（状态简介要用）');
  ok(vb.accounts[0].name === '沈姨', '账目上的名字走同一把门控尺子（已知 → 沈姨）');
}
{
  // 钱不够：执行器兜底也要留痕（同回合多笔）
  const d = mk();
  d.entities.player.money = { currency: '元', cash: 10, digital: 0, spent: 0, earned: 0 };
  G.applyUpdates(d, [{ type: '钱款变动', dir: '付', amount: 100, to: 'npc_1', what: '饭钱', cause: '吃饭' }], d.current.time);
  ok(d.entities.player.money.cash === 10, '钱不够时执行器不会把余额写负');
  ok((d.ledger || []).some(l => l.type === '交易拒绝'), '钱不够时**留痕**（交易拒绝），不静默');
}

// ── 4.5 钱的来源：卡里写明就照抄；对不上时走 钱款变动 对齐（不是直接改余额）──
console.log('');
console.log('== 钱的来源（卡说的 vs 存档的）==');
{
  const imp = fs.readFileSync(ROOT + '/src/import.js', 'utf8');
  ok(/"money": \{ "currency"/.test(imp), '扫描提示词的 player 里有 money 字段（原来根本没有 → 钱只能靠"身份关键词→财富档"猜）');
  ok(/照抄，不许推测/.test(imp) && /没有写明金额/.test(imp), '扫描提示词立了规矩：卡里写明金额就照抄、没写就不给（不许推测）');
  ok(/神豪|神壕/.test(imp), '兜底关键词认得"这个世界说你有钱"（神豪/亿万/返利…），不再一律掉到 3 个月生活费档');
}
{
  const d = mk();
  d.entities.player.money = { currency: '元', cash: 15000, digital: 12000, spent: 0, earned: 0 };
  const O = require(ROOT + '/src/opening');
  const us = O.toUpdates({ moneyFix: { cash: 1001234, digital: 0, what: '神豪系统新人奖励', why: '开场白写着【当前余额：1,001,234.00元】' } }, d);
  const mu = us.filter(u => u.type === '钱款变动')[0];
  ok(!!mu && mu.dir === '收' && mu.amount === 1001234 - 27000, '开场编译把"卡说的余额"与存档的差额记成一笔 钱款变动（' + (mu ? mu.amount : '无') + '）');
  ok(!!mu && mu.cause && mu.what, '这一笔带 what 与 cause（账本上看得懂"这钱哪来的"，replay 也对得上）');
  const v = V(d, mu);
  ok(v.allowed.length === 1, '这笔对齐能被校验器放行');
  G.applyUpdates(d, v.allowed, d.current.time);
  ok(d.entities.player.money.cash + d.entities.player.money.digital === 1001234, '对齐之后钱包 = 世界声明里的数（1001234）');
  const O2 = require(ROOT + '/src/opening');
  ok(O2.toUpdates({ moneyFix: { cash: d.entities.player.money.cash, digital: d.entities.player.money.digital, why: 'x' } }, d).filter(u => u.type === '钱款变动').length === 0, '本来就对得上 → 一条都不发（不空转）');
}

// ── 5. 界面那一侧：状态简介（源码级断言 + 数据面）──
console.log('');
console.log('== 当前状态简介 ==');
{
  const bj = fs.readFileSync(ROOT + '/public/board.js', 'utf8');
  ok(/function brief\b/.test(bj), 'board.js 有 brief（状态简介）');
  ok(/欠着|欠账/.test(bj), '简介里有「欠着」（账目上桌）');
  ok(/微信|电子/.test(bj), '简介里电子钱包单独一行（不是只写现金）');
  ok(/getElementById\('brief'\)/.test(bj), '简介渲染到 #brief（**滚动区之外**，不用翻到最上面）');
  const ix = fs.readFileSync(ROOT + '/public/index.html', 'utf8');
  ok(/id="brief"/.test(ix), 'index.html 有 #brief 容器');
  const css = fs.readFileSync(ROOT + '/public/board.css', 'utf8');
  ok(/#brief/.test(css), 'board.css 管了 #brief 的版面');
}

console.log('');
console.log('PASS=' + pass + ' FAIL=' + fail);
process.exitCode = fail ? 1 : 0;