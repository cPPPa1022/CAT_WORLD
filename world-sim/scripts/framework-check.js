// framework-check.js — v1.51 红线：**框架住在存档里** + 生成清单
// 用法: node scripts/framework-check.js
// 为什么有这份断言：用户定的原则是「框架无论怎么调整都只是在存档内部」（世界会自己长），
// 而"会自己长"最容易失控的两个点：① 长到不该长的层（律乱写公式）② 长了不记账（谁也读不懂）。
'use strict';
const FW = require('../src/framework');
const MF = require('../src/manifest');
const RT = require('../src/runtime');
const FX = require('../src/fx');
const AI = require('../src/ai');
const W = require('../src/world');

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (x ? '  << ' + x : '')); } };
const mk = () => { const d = JSON.parse(JSON.stringify(W.buildDemoWorld())); d.id = (p) => p + '__f' + Math.random().toString(36).slice(2, 7); d.current.turnN = 1; return d; };

// ---------- [1] 世界会长：词 / 型 / 律（v2.08 起没有档位，能力永远全开） ----------
console.log('\n[1] 世界会长 —— 词/型/律 都永远可长');
(function () {
  const d = mk(); FW.ensure(d);
  ok(FW.learnDocKind(d, '玉牒') && FW.vocabView(d).docKinds.indexOf('玉牒') >= 0, '词会长（文书类型）');
  ok(FW.checkProposal(d, { slot: 'org', name: '巡夜司' }).ok === true, '机构可以长');
  ok(FW.checkProposal(d, { slot: 'type', name: '门派', fields: ['山门', '掌门', '戒律'] }).ok === true, '型可以长（门派有栏位）');
  ok(FW.checkProposal(d, { slot: 'rule', name: '灵根', form: 'enum', items: ['金', '木', '水'] }).ok === true, '律可以长');
  /* ★ 老存档里可能还留着 framework.level —— 读到时必须**忽略**：不报错、也不因此关掉能力。
     这条是"删档位不许删出兼容事故"的守门人。 */
  const old = mk();
  old.framework = { v: 1, level: 0, vocab: { docKinds: [], fxNames: {}, orgs: [], roles: [] }, types: [], rules: [], log: [] };
  ok(FW.checkProposal(old, { slot: 'rule', name: '灵根', form: 'enum', items: ['金'] }).ok === true, '★ 老档里的 level:0 被忽略，能力照常全开');
  ok(FW.ensure(mk()).level === undefined && !('setLevel' in FW), '★ 框架里不再有 level / setLevel（权限日志不会再被签上 by:player）');
})();

// ---------- [2] 律：只有事实，没有算盘 ----------
console.log('\n[2] 律的三条硬约束');
(function () {
  const d = mk(); FW.ensure(d, 3);
  const r1 = FW.learnRule(d, { name: '速度', form: 'x3' });
  ok(!r1.ok && /enum \/ bool \/ range/.test(r1.err), '★ 不许公式/算术（"×3" 被拒）', r1.err);
  ok(!FW.learnRule(d, { name: '灵根', form: 'enum', items: [] }).ok, 'enum 必须给枚举项');
  ok(!FW.learnRule(d, { name: '等级', form: 'range', min: 9, max: 1 }).ok, 'range 必须 min < max');
  ok(FW.learnRule(d, { name: '印信', form: 'bool', scope: '边镇' }).ok, 'bool 律可以（有/无某种制度）');
  const n0 = FW.vocabView(d).rules.length;
  FW.freeze(d, true);
  const vv = FW.vocabView(d);
  ok(vv.rules.length === n0 && vv.rules.every(x => x.frozen), '★ 冻结是"不生效"，不是"删掉"（降档/冻结不毁世界）', JSON.stringify(vv.rules.map(x => x.frozen)));
})();

// ---------- [3] 演出名：世界记住了自己的画法 ----------
console.log('\n[3] 演出名 → 只写名字就行');
(function () {
  const d = mk(); FW.ensure(d, 1);
  const a1 = RT.validateUpdates(d, [{ type: '演出', fx: '剑光出鞘', atoms: [{ k: 'flash', v: 0.4 }, { k: 'push', v: 0.2 }] }], {}, {});
  ok(a1.allowed.length === 1, '第一次：名字 + 原语组合');
  const doc = require('../src/game');
  doc.applyUpdates(d, a1.allowed, d.current.time);           // 落库（会记进框架）
  d.current.time = RT.addMinutes(d.current.time, FX.COOLDOWN_MIN + 1);   // 绕过冷却（冷却本身在 [6] 那套断言里守着）
  const a2 = RT.validateUpdates(d, [{ type: '演出', fx: '剑光出鞘' }], {}, {});
  ok(a2.allowed.length === 1 && a2.allowed[0].atoms && a2.allowed[0].atoms.length === 2, '★ 第二次：**只写名字**也放行（引擎记得怎么画）', JSON.stringify(a2.allowed[0] && a2.allowed[0].atoms) + ' | ' + a2.errors.join('|'));
  const a3 = RT.validateUpdates(d, [{ type: '演出', fx: '这名字没记过', }], {}, {});
  ok(a3.allowed.length === 0, '没记过的名字、又不给原语 → 照旧被拦', a3.errors.join('|'));
})();

// ---------- [4] 提案闸门 ----------
console.log('\n[4] AI 只能提议，引擎提交');
(function () {
  const d = mk(); FW.ensure(d);
  const before = JSON.stringify(FW.vocabView(d));
  FW.canPropose(d, { slot: 'type', name: '门派', fields: ['山门'] });
  ok(JSON.stringify(FW.vocabView(d)) === before, '★ canPropose 是**纯校验**（校验器不该有副作用）');
  ok(!FW.canPropose(d, { slot: 'city', name: 'x' }).ok, 'slot 白名单外的提案被拒');
  const r = FW.applyProposal(d, { slot: 'type', name: '门派', fields: ['山门', '掌门'] });
  ok(r.ok && FW.vocabView(d).types.some(t => t.name === '门派'), 'applyProposal 提交后才真的落库');
  /* v2.08：档位没了，这条改成守**真正还在的边界** —— 律的形式。
     （原来它守的是"档 2 不许长律"，那道门已经不存在了。） */
  ok(RT.validateUpdates(d, [{ type: '框架', slot: 'rule', name: '灵根', form: 'enum', items: ['金'] }], {}, {}).allowed.length === 1,
    '律提案（合法形式）能过校验器 —— 无档位，永远允许');
  ok(!RT.validateUpdates(d, [{ type: '框架', slot: 'rule', name: '速度', form: 'x3' }], {}, {}).allowed.length,
    '★ 但"算盘"照样被校验器拦（律只允许 enum/bool/range）');
})();

// ---------- [5] 生成清单 ----------
console.log('\n[5] 生成清单（截至这份存档为止，新生成过什么）');
(function () {
  const d = mk(); MF.ensure(d); FW.ensure(d, 1);
  MF.record(d, { kind: '文档', id: 'doc1', name: '一封帖子', schema: 'fw.doc.v1', by: 'ai', note: '锦儿送来的邀帖' });
  MF.record(d, { kind: '演出', id: 'unfold', name: '展信', schema: 'fw.fx.v1', by: 'ai' });
  const v = MF.view(d);
  ok(v.n === 2 && v.counts['文档@ai'] === 1, '记账：条数与来源都对');
  ok(MF.pending(d).n === 1, '欠账：没写 note 的那条被点名', JSON.stringify(MF.pending(d).list));
  MF.record(d, { kind: '文档', id: 'doc2', name: '第二封', schema: 'fw.doc.v1', by: 'ai', note: '有说明' });
  ok(MF.pending(d).n === 1, '补了说明的不算欠账');
  const before = MF.view(d).n;
  MF.record(d, { kind: '人物', id: 'npc9', name: '某人', schema: 'ent.person.v1', by: 'ai', note: 'x' });
  ok(MF.view(d).n === before + 1, '只追加（不覆盖历史）');
  const rd = MF.readmeSkeleton(d);
  ok(/世界自己长出来的/.test(rd) && /生成清单/.test(rd) && /一封帖子/.test(rd) === false, '自述骨架含事实（长出了什么/清单统计），不含逐条清单', rd.slice(0, 40));
})();

// ---------- [6] 提示词与资料包 ----------
console.log('\n[6] AI 侧能看到什么');
(function () {
  const d = mk(); FW.ensure(d, 3); MF.ensure(d);
  FW.learnFxName(d, '展信', [{ k: 'unfold' }]);
  FW.learnDocKind(d, '帖子');
  FW.learnRule(d, { name: '灵根', form: 'enum', items: ['金', '木'] });
  MF.record(d, { kind: '演出', name: '展信', schema: 'fw.fx.v1', by: 'ai' });
  const pack = JSON.parse(AI.packetFor(d, { action: 'x', memories: [], candidates: [] }));
  const fwTxt = pack['这个世界的框架(它自己长出来的词·直接用，别再重新发明)'];
  ok(/展信/.test(fwTxt) && /帖子/.test(fwTxt) && /灵根/.test(fwTxt), '资料包带上这个世界的词/型/律', String(fwTxt).slice(0, 80));
  ok(/有 1 条/.test(pack['创造欠账(上回合有生成没写说明)']), '★ 欠账用**事实**提醒（不打断叙事）', pack['创造欠账(上回合有生成没写说明)']);
  const sys = AI.SYSTEM(d, { llm: {} }, false);
  ok(/框架 · 世界会自己长/.test(sys) && /创造必须自述/.test(sys), '提示词含框架契约 + 自述要求');
  ok(/不许公式、不许算术/.test(sys), '提示词写明律的硬约束');
})();

// ---------- [7] 框架住在存档里（往返） ----------
console.log('\n[7] 跟存档一起走');
(function () {
  const d = mk(); FW.ensure(d); MF.ensure(d);
  FW.learnDocKind(d, '玉牒'); FW.learnFxName(d, '剑光', [{ k: 'flash' }]); FW.learnType(d, '门派', ['山门']);
  MF.record(d, { kind: '文档', name: 'x', schema: 'fw.doc.v1', by: 'ai', note: 'y' });
  const round = JSON.parse(JSON.stringify(d));            // 存档 = JSON 往返
  ok(round.framework && round.framework.types.length === 1 && round.framework.vocab.docKinds.indexOf('玉牒') >= 0, '★ 往返后**世界长出来的东西还在**（跟着存档走）');
  ok(FW.resolveFx(round, '剑光') !== null, '往返后演出名还解得出来');
  ok(MF.view(round).n === 1, '往返后生成清单还在');
  ok(round.framework.log.length >= 3 && round.framework.log.every(x => x.what && x.t !== undefined), '演化日志（世界什么时候长出了什么）留痕');
})();

console.log('\n==== framework-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
