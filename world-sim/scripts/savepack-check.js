// savepack-check.js — v1.51 红线：**自足的存档**（导出/导入/扫描/unknown 箱）
// 用法: node scripts/savepack-check.js
// 用户定的标准：「存档是独立的，**直接导入就可使用**」「导入也要扫一遍，
// **就算出现了插件（原生不是引擎生出来的）不认识也可能导入**」
'use strict';
const SP = require('../src/savepack');
const FW = require('../src/framework');
const MF = require('../src/manifest');
const W = require('../src/world');

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (x ? '  << ' + x : '')); } };
const mk = () => { const d = JSON.parse(JSON.stringify(W.buildDemoWorld())); d.id = (p) => p + '__s' + Math.random().toString(36).slice(2, 7); d.current.turnN = 7; return d; };
const dirty = () => {   // 一个"有插件产物、有未来原语、有陌生律"的存档（模拟别处导来的）
  const d = mk();
  FW.ensure(d, 3); MF.ensure(d);
  FW.learnDocKind(d, '玉牒');
  FW.learnFxName(d, '剑光出鞘', [{ k: 'flash' }, { k: '未来原语' }]);
  FW.learnRule(d, { name: '灵根', form: 'enum', items: ['金', '木'] });
  d.framework.rules.push({ name: '血脉', form: 'formula', items: ['x3'], frozen: false });   // 陌生形式（手工塞，模拟插件写的）
  MF.record(d, { kind: '文档', name: '一封帖子', schema: 'fw.doc.v1', by: 'ai', note: '邀帖' });
  MF.record(d, { kind: '怪东西', name: '某插件产物', schema: 'plugin.widget.v9', by: 'plugin' });
  return d;
};

// ---------- [1] 包结构 ----------
console.log('\n[1] 导出包：自带一切');
(function () {
  const p = SP.pack(mk(), { build: 'v1.51', card: { id: 'c1', name: '某卡', pack: { meta: { name: 'X' } } } });
  ok(!!p.__save && p.__save.v === SP.PACK_V, '有 __save 头（版本/来源可查）');
  ok(!!p.world && !!p.world.entities, '有 world（世界数据）');
  ok(!!p.card, '来源卡跟着走（不带的话导入后卡盒里没有这张卡 → 卡里的世界书/开场就断了）');
  ok(typeof p.readme === 'string' && /存档自述/.test(p.readme), '带一份**自述**（引擎拼的事实骨架）');
  ok(p.__save.manifestN !== undefined && p.__save.frameworkLevel === undefined, '清单条数写进包头；★ v2.08 起包头不再有档位（删干净了）');
})();

// ---------- [2] 干净包：直接可用 ----------
console.log('\n[2] 干净包：扫得干净、导得进去');
(function () {
  const p = SP.pack(mk(), { build: 'v1.51' });
  const r = SP.scan(p);
  ok(r.ok && r.errors.length === 0, '扫描通过');
  ok(r.counts.unknown === 0, '没有不认识的东西');
  const ins = SP.install(p);
  ok(ins.ok && ins.world && ins.world.entities && ins.world.current, '装在包里 → 拿到一个能跑的完整世界');
  ok(!!ins.world.manifest && !!ins.world.framework, '导入后清单/框架都在（哪怕原包没有，引擎也会补结构）');
  ok(!!ins.world.imported && !!ins.world.imported.at, '留痕：这份世界是从存档文件导进来的');
})();

// ---------- [3] 脏包：不认识的"也可能导入" ----------
console.log('\n[3] 插件/未来版本生成的东西：不许丢、不许炸、不许猜着改');
(function () {
  const p = SP.pack(dirty(), { build: 'v1.51' });
  const r = SP.scan(p);
  ok(r.ok, '★ 有插件产物也**照常能导入**（不是"拒绝导入"）');
  ok(r.unknown.some(u => /plugin\.widget\.v9/.test(u.why)), '插件 schema 被点名（不认识的原因写清楚了）', JSON.stringify(r.unknown.map(u => u.why)));
  ok(r.unknown.some(u => /未来原语/.test(u.why)), '未来原语被点名');
  ok(r.unknown.some(u => /血脉/.test(u.what)), '陌生形式的律被点名');
  ok(r.needsAI.length >= 2 && r.needsAI.some(s => /未来原语/.test(s)), '给出"建议让 AI 看一眼"的清单（**只是建议，不自动改**）');
  const ins = SP.install(p);
  ok(ins.ok && ins.boxed >= 3, '★ 不认识的**原样装箱**（unknown 箱 ' + ins.boxed + ' 条）');
  const boxed = ins.world.unknown.find(x => x.blob);
  ok(!!boxed && boxed.blob.schema === 'plugin.widget.v9', '那条插件产物的**原始记录一字不改**地留在箱子里（round-trip 安全）');
  ok(ins.world.framework.vocab.fxNames['剑光出鞘'].atoms.length === 2, '不认识的**没有连带删掉**认识的部分（剑光出鞘还在）');
  ok(ins.world.framework.rules.some(x => x.name === '灵根'), '认识的律留着；陌生的那条也没被删');
})();

// ---------- [4] 版本与坏包 ----------
console.log('\n[4] 版本与坏包');
(function () {
  const p = SP.pack(mk(), {});
  p.__save.v = SP.PACK_V + 3;
  const r = SP.scan(p);
  ok(r.ok && r.newer, '★ 来自更新版本的存档：**能导入**，但明确告诉玩家"新东西本机不认识"', JSON.stringify({ ok: r.ok, newer: r.newer }));
  ok(SP.scan({ nope: 1 }).ok === false, '不是存档文件 → 拒绝并说明');
  ok(SP.scan({ __save: {}, world: { current: {} } }).ok === false, '世界数据不完整 → 拒绝并说明（缺 entities）');
  /* v2.08：档位越界那条自动修没了（档位本身没了）。改守真正的兼容风险：
     老档里带着 level:9 也必须能干净导入 —— 不许报错、不许被当成"不认识的东西"装箱。 */
  const p2 = SP.pack(mk(), {});
  p2.world.framework.level = 9;
  const r2 = SP.scan(p2);
  ok(r2.ok && !(r2.unknown || []).some(x => /档位/.test(String(x.what || ''))), '★ 老档带 framework.level:9 也能通过扫描（被忽略，不进 unknown 箱）');
  ok(SP.install(p2).ok, '★ 老档带 level 照样能装进来');
})();

// ---------- [5] 老档 / 手工包 ----------
console.log('\n[5] 老档与手工包');
(function () {
  const d = mk(); delete d.manifest; delete d.framework;
  const p = SP.pack(d, {});
  const r = SP.scan(p);
  ok(r.ok, '老档（没清单没框架）也能导入');
  ok(r.notes.some(s => /没有生成清单/.test(s)), '告诉玩家"这份存档没有生成清单"');
  const p2 = SP.pack(mk(), {});
  delete p2.card;
  p2.__save.hasCard = false;
  const r2 = SP.scan(p2);
  ok(r2.notes.some(s => /没带来源角色卡/.test(s)), '没带卡时明确提示（不静默）');
})();

// ---------- [6] 导入不许污染原包 + 再导出仍是同一份 ----------
console.log('\n[6] 深拷与往返');
(function () {
  const src = dirty();
  const p = SP.pack(src, {});
  const before = JSON.stringify(p);
  const ins = SP.install(p);
  ok(JSON.stringify(p) === before, '★ 导入**不改原包**（深拷；失败/重试都不会污染）');
  ok(ins.world !== p.world, '装出来的世界是独立对象');
  const p2 = SP.pack(ins.world, {});                     // 再导出一次
  const r2 = SP.scan(p2);
  ok(r2.ok && p2.world.unknown && p2.world.unknown.length >= 3, '★ 再导出时 unknown 箱**原样带回去**（不在本机被洗掉）');
  ok(!!p2.world.imported, '导入痕迹也留在包里（下一个收到它的人能看到"这份存档被导过一趟"）');
})();

// ---------- [7] 自述够不够 AI 用 ----------
console.log('\n[7] 自述（SAVE.md）');
(function () {
  const p = SP.pack(dirty(), {});
  const rd = p.readme;
  ok(/世界自己长出来的：/.test(rd), '写着世界长出了什么');
  ok(/生成清单：共 2 条/.test(rd), '写着清单条数');
  ok(/剑光出鞘/.test(rd) && /灵根/.test(rd), '写着这个世界长出来的词/律');
  ok(/插件/.test(rd) === false, '逐条清单不进自述（自述是给人看的摘要，详细在 manifest 里）', rd.slice(0, 60));
})();

// ---------- [8] 完整包（用户：「存档就是完整包」） ----------
console.log('\n[8] 完整包：快照 + 画面一起走');
(function () {
  const snaps = [{ kind: 'auto', slot: 1, __snap: { t: 'T1' }, world: mk() }, { kind: 'manual', slot: 3, __snap: { t: 'T2' }, world: mk() }];
  const images = [{ id: 'img1', name: '第一帧', mime: 'image/png', b64: 'aGVsbG8=', rec: { id: 'img1', name: '第一帧', t: 'T' } }];
  const p = SP.pack(mk(), { snapshots: snaps, images: images });
  ok(p.__save.hasSnapshots && p.__save.snapN === 2, '包头写明带了 2 格存档');
  ok(p.__save.hasImages && p.__save.imgN === 1, '包头写明带了 1 张画面');
  ok(Array.isArray(p.snapshots) && p.snapshots[0].world.entities, '快照里是完整世界（不是摘要）');
  ok(Array.isArray(p.images) && p.images[0].b64 === 'aGVsbG8=', '画面以 base64 原样带上（零依赖、单文件）');
  const ins = SP.install(p);
  ok(ins.snapshots.length === 2 && ins.images.length === 1, '★ 导入时把快照与画面**原样交回**（由调用方落盘）');
  const rd = SP.scan(p);
  ok(rd.ok, '完整包照样能扫（扫描只看结构性损坏，不管带了多少东西）');
})();

console.log('\n==== savepack-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
