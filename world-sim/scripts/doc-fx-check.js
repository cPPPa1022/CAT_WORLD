// doc-fx-check.js — v1.47 红线：可读文本=文档对象 + 演出=引擎原语（离线，不需起服务）
// 用法: node scripts/doc-fx-check.js
// 这一版的重点是**第 N 个测试**（设计总稿 §23）：
//   塞进一个**引擎代码里从没出现过**的东西（架空世界的玉牒/飞剑传书、世界自造的效果名），
//   **不改代码**它就该能工作。做不到 = 只做了"例"，没做"类"。
'use strict';
const G = require('../src/game');
const RT = require('../src/runtime');
const FX = require('../src/fx');
const AI = require('../src/ai');
const W = require('../src/world');
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  << ' + extra : '')); }
};
// 生产环境里 data.id 由 store 挂上（store.js makeStore）；离线断言自己挂一个同形函数
const mk = () => { const d = JSON.parse(JSON.stringify(W.buildDemoWorld())); d.id = (p) => p + '__t' + Math.random().toString(36).slice(2, 8); return d; };
const noAI = { llm: { baseURL: '', apiKey: '', model: '' } };   // 演示模式：不联网
const LETTER = '帖子里没有寻常请安的套话，只一页素笺：「三月初五申时，西市·醉仙楼后巷，有旧物相还。凭此笺为信，勿令人人知。」落款只摁了一枚半模糊的小印。';
const SRC = path.join(__dirname, '..', 'src');
const readSrc = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

// ---------- [1] 意图：认得出靠**对象自己**（不是引擎的名词表） ----------
console.log('\n[1] 意图解析：对象自己说自己叫什么');
(function () {
  const d = mk();
  const letter = G.createDoc(d, { title: '一封家信', kind: '信', aliases: ['信', '家书'], body: LETTER });
  // 演示世界自带一张未读纸条 —— 断言里先标记已读，保证「只有一件未读」这条成立
  Object.values(d.documents || {}).forEach(x => { if (x.id !== letter.id) x.read = true; });
  const i1 = G.parseIntent(d, '打开信件');
  ok(i1.kind === 'read' && i1.docId === letter.id, '「打开信件」→ read（靠 aliases 里的"信"）', JSON.stringify(i1));
  const i2 = G.parseIntent(d, '打开看看');
  ok(i2.kind === 'read' && i2.docId === letter.id, '「打开看看」→ 只有一件未读，直接开', JSON.stringify(i2));
  const i3 = G.parseIntent(d, '我打开门看看');
  ok(i3.kind !== 'read', '「我打开门看看」不被劫持', JSON.stringify(i3));
  const dMulti = mk();
  G.createDoc(dMulti, { title: '甲文书', aliases: ['甲'], body: '第一份正文内容足够长足够长。' });
  G.createDoc(dMulti, { title: '乙文书', aliases: ['乙'], body: '第二份正文内容足够长足够长。' });
  const i4 = G.parseIntent(dMulti, '打开看看');
  ok(i4.kind === 'read' && !i4.docId && i4.ask, '有好几件又没说哪件 → **反问他**，不猜', JSON.stringify(i4));
  const i6 = G.parseIntent(dMulti, '打开没有的东西');
  ok(i6.kind === 'read' && !i6.docId && i6.ask, '说不清是哪一件 → 问他，而不是随便开一份（不许拿别的文书糊弄）', JSON.stringify(i6));
  const d1 = mk();
  Object.values(d1.documents || {}).forEach(x => { x.read = true; });
  const i7 = G.parseIntent(d1, '打开看看');
  ok(i7.kind === 'read' && i7.docId, '手上只有一件 → 就是它（再问「哪一件」是废话）', JSON.stringify(i7));
  const d0 = mk(); d0.documents = {}; d0.knowledge.knownDocs = [];
  const i5 = G.parseIntent(d0, '打开信件查看内容');
  ok(i5.kind === 'read' && !i5.docId, '手上一份文书都没有时也认作 read（交给补录/明说没有）', JSON.stringify(i5));
})();

// ---------- [2] 校验器：文档契约 ----------
console.log('\n[2] 校验器：文档契约');
(function () {
  const d = mk();
  /* v2.12「有主」：文书也是"带进玩家世界的新东西"，必须挂在已有的因上 ——
     未署名可以（"抄表人（未署名）"是好味道），但"谁把它搁在这儿的"必须有主。 */
  d.ledger = d.ledger || [];
  d.ledger.push({ id: 'led_doc', t: (d.current || {}).time || '', type: '镜头外事件', target: '镇子', desc: '有人从门缝里塞进来一张帖子' });
  const A = { cause: '有人从门缝里塞进来一张帖子', causeRef: { kind: 'ledger', id: 'led_doc' } };
  const bad = RT.validateUpdates(d, [Object.assign({ type: '文档出现', title: '一封信' }, A)], {}, {});
  ok(bad.allowed.length === 0 && /body/.test(bad.errors.join('')), '只有 title 没有 body → 拦下（内容只写旁白=打不开）');
  const good = RT.validateUpdates(d, [Object.assign({ type: '文档出现', title: '一封帖子', body: LETTER, kind: '帖子', aliases: ['帖子', '邀帖', '那封信'] }, A)], {}, {});
  ok(good.allowed.length === 1, 'title + body 齐 + 有主 → 放行');
  ok(good.allowed[0].aliases.length === 3, 'kind / aliases 一起落库（AI 说它是什么，引擎只限长度）');
  const huge = RT.validateUpdates(d, [Object.assign({ type: '文档出现', title: '长信', body: '字'.repeat(4001) }, A)], {}, {});
  ok(huge.allowed.length === 0, '正文超上限（>4000 字）→ 拦下');
  const longAlias = RT.validateUpdates(d, [Object.assign({ type: '文档出现', title: 'X', body: LETTER, aliases: ['这个别名长得离谱应该被截断掉', 'ok'] }, A)], {}, {});
  ok(longAlias.allowed[0].aliases[0].length <= 12, '过长的别名被截断（不是拒绝）');
  const noAnchor = RT.validateUpdates(d, [{ type: '文档出现', title: '天外飞帖', body: LETTER }], {}, {});
  ok(noAnchor.allowed.length === 0 && /挂在已有的因上/.test(noAnchor.errors.join('')),
    '★ v2.12：文书没有主 → 拦下（未署名可以，"凭空出现"不行）');
})();

// ---------- [3] 落库与门控 ----------
console.log('\n[3] 落库与门控');
(function () {
  const d = mk();
  d.ledger = d.ledger || [];
  d.ledger.push({ id: 'led_doc2', t: (d.current || {}).time || '', type: '镜头外事件', target: '镇子', desc: '有人从门缝里塞进来一张帖子' });
  const a = RT.validateUpdates(d, [{ type: '文档出现', title: '一封帖子', body: LETTER, kind: '帖子', aliases: ['帖子'],
    cause: '有人从门缝里塞进来一张帖子', causeRef: { kind: 'ledger', id: 'led_doc2' } }], {}, {}).allowed;
  G.applyUpdates(d, a, d.current.time);
  const doc = Object.values(d.documents || {}).find(x => x.title === '一封帖子');
  ok(!!doc && doc.kind === '帖子' && doc.aliases[0] === '帖子', '文书落进 data.documents（带 AI 声明的 kind/aliases）');
  const v1 = G.buildView(d);
  ok(v1.docs.some(x => x.title === '一封帖子'), '玩家视图里出现这份文书');
  ok(d.ledger.some(l => l.type === '文档出现' && l.ref === doc.id), '账本留痕');
  const hidden = G.createDoc(d, { title: '密函', body: '这封密函玩家还没有见过，一个字都不该出现在界面上。' });
  d.knowledge.knownDocs = d.knowledge.knownDocs.filter(x => x !== hidden.id);
  ok(G.buildView(d).docs.every(x => x.title !== '密函'), '没见过的文书不进玩家 UI（同一把门控尺子）');
})();

// ---------- [4] 补录（老存档） ----------
console.log('\n[4] 补录（老存档可用性）');
(function () {
  const d = mk();
  d.sceneLog.push({ t: d.current.time, type: 'narration', text: LETTER });
  const doc = G.backfillDoc(d, '信');
  ok(!!doc && doc.body.indexOf('三月初五') >= 0, '散文里的信能被补录成对象（按需，不全量扫描）');
  const d2 = mk();
  d2.sceneLog.push({ t: d2.current.time, type: 'narration', text: '他在柜台后面打了个哈欠，什么也没说。' });
  ok(!G.backfillDoc(d2, '信'), '普通旁白不会被误补成文书');
  const d3 = mk();
  d3.sceneLog.push({ t: d3.current.time, type: 'narration', text: LETTER });
  const b1 = G.backfillDoc(d3, '帖子'), b2 = G.backfillDoc(d3, '信');
  ok(b1 && b2 && b1.id === b2.id, '同一条散文不会被补录成两份', (b1 && b1.id) + ' / ' + (b2 && b2.id));
})();

// ---------- [5] 演出：引擎原语 + 参数（边界，不是菜单） ----------
console.log('\n[5] 演出 = 引擎原语 + 参数');
(function () {
  const d = mk();
  const r1 = RT.validateUpdates(d, [{ type: '演出', atoms: [{ k: '剑光' }] }], {}, {});
  ok(r1.allowed.length === 0 && /原语/.test(r1.errors.join('')), '原语不在能力清单里 → 拦下', r1.errors.join('|'));
  const r2 = RT.validateUpdates(d, [{ type: '演出', atoms: [{ k: 'flash' }, { k: 'push' }, { k: 'dim' }, { k: 'ripple' }] }], {}, {});
  ok(r2.allowed.length === 0 && /最多/.test(r2.errors.join('')), '一回合原语数超预算（' + FX.BUDGET + '）→ 拦下', r2.errors.join('|'));
  const r3 = RT.validateUpdates(d, [{ type: '演出', atoms: [{ k: 'flash' }] }, { type: '演出', atoms: [{ k: 'seal' }] }], {}, {});
  ok(r3.allowed.length === 1, '一回合最多 1 条演出');
  const r4 = RT.validateUpdates(d, [{ type: '演出', fx: '剑光出鞘', atoms: [{ k: 'flash', v: 9 }, { k: 'push', dur: 99 }] }], {}, {});
  ok(r4.allowed.length === 1, '★ AI 用**世界里的话**起名（"剑光出鞘"）→ 放行（引擎代码里没有这个词）', r4.errors.join('|'));
  const atoms4 = r4.allowed[0].atoms;
  ok(atoms4[0].v <= FX.ATOMS.flash.params.v[1] && atoms4[1].dur <= FX.ATOMS.push.params.dur[1], '参数超范围被**夹取**（不报错，保证画得出来）', JSON.stringify(atoms4));
  const d5 = mk();
  const first = RT.validateUpdates(d5, [{ type: '演出', atoms: [{ k: 'seal' }] }], {}, {}).allowed;
  G.applyUpdates(d5, first, d5.current.time);
  const again = RT.validateUpdates(d5, [{ type: '演出', fx: '换个名字同组合', atoms: [{ k: 'seal' }] }], {}, {});
  ok(again.allowed.length === 0 && /冷却/.test(again.errors.join('')), '同**组合**冷却（换个名字也照样冷却）', again.errors.join('|'));
  d5.current.time = RT.addMinutes(d5.current.time, FX.COOLDOWN_MIN + 1);
  ok(RT.validateUpdates(d5, [{ type: '演出', atoms: [{ k: 'seal' }] }], {}, {}).allowed.length === 1, '冷却过后可以再演');
  const legacy = RT.validateUpdates(mk(), [{ type: '演出', fx: 'letterOpen' }], {}, {});
  ok(legacy.allowed.length === 1 && legacy.allowed[0].atoms[0].k === 'unfold', '旧词表名兼容（letterOpen → 原语 unfold），老存档不炸');
})();

// ---------- [6] 演出 → 视图 ----------
console.log('\n[6] 演出 → 视图');
(function () {
  const d = mk();
  const a = RT.validateUpdates(d, [{ type: '演出', fx: '印信浮现', atoms: [{ k: 'seal', v: 0.8 }] }], {}, {}).allowed;
  G.applyUpdates(d, a, d.current.time);
  const v = G.buildView(d);
  ok(v.fx && Array.isArray(v.fx.atoms) && v.fx.atoms[0].k === 'seal', 'view.fx 带出**原语数组**（前端按原语画）', JSON.stringify(v.fx));
  ok(v.fx && v.fx.fxName === '印信浮现', '带出世界内的名字（给玩家看的是它，不是原语 key）');
  const d2 = mk(); d2.current.fx = null;
  ok(!G.buildView(d2).fx, '没有演出时 view.fx 为空（不会一直闪）');
})();

// ---------- [7] 提示词：给的是边界 ----------
console.log('\n[7] 提示词契约');
(function () {
  const sys = AI.SYSTEM(mk(), noAI, false);
  const miss = FX.ATOM_KEYS.filter(k => sys.indexOf(k) < 0);
  ok(miss.length === 0, '每个引擎原语都写进提示词（缺：' + JSON.stringify(miss) + '）');
  ok(/自己决定|随你/.test(sys), '提示词说清了：**表现由 AI 决定**（不是从菜单里挑）');
  ok(/权限边界/.test(sys), '提示词写明这是**权限边界**');
  ok(/只能演这个世界里存在的东西/.test(sys), '提示词含载体门控（没有手机就别演屏幕亮起）');
  ok(/文档出现/.test(sys) && /aliases/.test(sys), '文档契约含 kind/aliases（对象自己说自己叫什么）');
  ok(/重复询问/.test(sys), '含「重复询问 ≠ 重新演绎」护栏');
  const pack = AI.packetFor(mk(), { action: '打开信件', memories: [], candidates: [] });
  ok(pack.indexOf('演出可用的引擎原语') >= 0, '资料包给出原语清单');
})();

// ---------- [8] 前端接得住 ----------
console.log('\n[8] 前端分派');
(function () {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  ok(/function playFx\(/.test(app) && /function renderAtom\(/.test(app), 'app.js 有 playFx + renderAtom');
  const miss = FX.ATOM_KEYS.filter(k => app.indexOf("'" + k + "'") < 0);
  ok(miss.length === 0, '每个原语前端都有渲染分支（缺：' + JSON.stringify(miss) + '）');
  ok(/atom-unknown/.test(app), '★ 未知原语有**通用兜底**（世界自造的东西不会静默失败）');
  ok(/function showDoc\(/.test(app), 'app.js 有文书查看器 showDoc');
  ok(/panelKind === 'docs'/.test(app), '顶栏/更多面板里有「文书」入口');
  ok(/api\/doc\/read/.test(app), '文书列表点击有后端入口 /api/doc/read');
  const pres = fs.readFileSync(path.join(SRC, 'presentation.js'), 'utf8');
  ok(/c\.note === 'letter'/.test(pres), 'carries.note=letter 的世界会拿到纸本文书匣');
})();

// ---------- [9] 打开 = 正文到手 ----------
console.log('\n[9] 打开 = 正文到手（不是"再演一个动作"）');
(async function () {
  const d = mk();
  G.createDoc(d, { title: '一封家信', aliases: ['信'], body: LETTER, from: '锦儿' });
  const t0 = d.current.time;
  const r = await G.runTurn(d, '打开信件查看内容', noAI);
  ok(d.current.time === t0, '查看不消耗世界时间（否则玩家不敢问、不敢翻）');
  ok(r.view && r.view.openDoc && r.view.openDoc.doc && r.view.openDoc.doc.body === LETTER, '**正文到手**（病根：玩家要内容，系统给了一个"退后半步"的动作）');
  ok(!r.frame, '不生成新回合（省 token，也不再有"退半步"）');
  ok(r.view.fx && r.view.fx.atoms && r.view.fx.atoms[0].k === 'unfold', '**接线：展开与原语一起到**', JSON.stringify(r.view.fx && r.view.fx.atoms));
})();

// ---------- [10] ★ 第 N 个测试：不改一行代码 ----------
console.log('\n[10] ★ 第 N 个（不改代码，塞进引擎没听说过的东西）');
(function () {
  const d = mk();
  // 一个**架空世界**：这些词在引擎源码里一个都不存在
  const yudie = G.createDoc(d, { title: '玉牒', kind: '玉牒', aliases: ['玉牒', '名册', '皇族谱'], body: '玉牒上第三行刻着你的名字，笔画比别处新，像是后来补上去的。' });
  const feijian = G.createDoc(d, { title: '飞剑传书', kind: '传书', aliases: ['传书', '剑书', '那道剑光'], body: '剑身上缠着一缕灵光，展开是一行字：三日后，落霞谷，勿带旁人。' });
  const fuzhao = G.createDoc(d, { title: '符诏', kind: '符诏', aliases: ['符诏', '诏令'], body: '朱砂画就的符诏贴上门楣，墨迹未干，压着一枚小小的法印。' });
  const srcGame = readSrc('game.js');
  ok(srcGame.indexOf('玉牒') < 0 && srcGame.indexOf('飞剑传书') < 0 && srcGame.indexOf('符诏') < 0, '前提：这些词在引擎源码里**确实不存在**（不是靠我加的名词表）');
  const cases = [['打开玉牒', yudie], ['看看那道剑光', feijian], ['我要看符诏', fuzhao]];
  let hits = 0; const detail = [];
  for (const [say, doc] of cases) {
    const it = G.parseIntent(d, say);
    if (it.kind === 'read' && it.docId === doc.id) hits++; else detail.push(say + '→' + JSON.stringify(it));
  }
  ok(hits === 3, '★ 三种**引擎没听说过**的文书，各自用自己的称呼都能打开（' + hits + '/3，不改代码）', detail.join(' ; '));
  // 引擎自造的效果名
  const r = RT.validateUpdates(mk(), [{ type: '演出', fx: '符箓燃起', atoms: [{ k: 'tint', hue: 20 }, { k: 'ripple', v: 0.8 }] }], {}, {});
  ok(r.allowed.length === 1, '★ 世界自造的效果名（"符箓燃起"）+ 合法原语组合 → 放行（名字归 AI，画法归引擎）', r.errors.join('|'));
  // 匹配路径确实与名词表解耦
  const fn = (srcGame.match(/function matchReadIntent\(data, t\) \{[\s\S]*?\n\}/) || [''])[0];
  ok(fn.length > 200 && fn.indexOf('LEGACY_NOUN_HINT') < 0 && fn.indexOf('DOC_NOUN_RE') < 0, '★ matchReadIntent 里**没有任何名词表**（新内容不靠我枚举）');
  const fxSrc = readSrc('fx.js');
  ok(fxSrc.indexOf('信') < 0 || fxSrc.indexOf('信件') < 0, 'fx 的能力清单里不含世界内容（只有原语：' + FX.ATOM_KEYS.join('/') + '）');
})();

setTimeout(() => {
  console.log('\n==== doc-fx-check: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exitCode = fail ? 1 : 0;
}, 120);
