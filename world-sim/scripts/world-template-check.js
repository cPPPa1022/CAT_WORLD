// world-template-check.js — 世界模板创造 · 验收标准（**先写断言，功能后做**）
//
// 用法：node scripts/world-template-check.js
//
// ⚠️ 这个脚本**现在应当是红的**。它不是"坏了的测试"，是**施工图纸**：
//    每一条 = 一条已经和用户谈定的规矩；做完对应的一层，红就变绿一条。
//    ⇒ **红是证据**：证明这条断言真的在测东西，而不是永远为真的空话。
//      （这个项目踩过三次"只会报喜的探针"，见 交接文档 §6.124 d）
//
// ★ 它**不进 run-all.js** —— 全套断言必须保持"功能齐了才绿"，
//   而这个是"还没做的事的清单"。做完之后，把绿掉的那几条**搬进对应的正式断言**再去掉这里。
//
// ★ 成本：纯本地代码，**网络全程不碰、0 token**。它只在开发时手动跑，玩家永远遇不到。
//
// ── 这次谈定的事（2026-09-26），逐条对应下面的分组 ──────────────────
//   A · 0.5 壳 + 白名单 API：AI 在**已有的壳**上做增量，写入**只能走 Update**
//   B · 板块声明必填三项：长什么样 / **内容从哪来** / 什么时候更新
//   C · 留痕：提议不论批准与否都留痕；没批准的到此为止
//   D · 门控不可绕：板块内容也要过名字/知识门控
//   E · 隔离与恢复：语法预检 → 三级恢复（重试 / 修复 / 默认布局）
//   F · 确定性：骰子必须可重放
//   G · 唯一真相源 + 提示词不许一职两写
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(os.tmpdir(), 'ws-template-' + Date.now());
fs.mkdirSync(path.join(TMP, 'data'), { recursive: true });
process.env.WORLD_SIM_DATA = TMP;
process.env.WORLD_SIM_ASSETS = ROOT;

const FW = require('../src/framework');
const PRES = require('../src/presentation');
const CONTRACT = require('../src/contract');
const OP = require('../src/opening');
const W = require('../src/world');

let pass = 0, fail = 0, blocked = 0;
const ok = (c, m) => { c ? (pass++, console.log('  OK   ' + m)) : (fail++, console.log('  FAIL ' + m)); };
/* BLOCK = **刻意留红**：这条做不了不是因为我没做，是它卡在另一件大改上。
   分开计数是为了诚实 —— 不然"还剩 N 条红"会把这两种混在一起，
   而混在一起之后就没法判断"是不是真的做完了"。 */
const BLOCK = (c, m) => { c ? (pass++, console.log('  OK   ' + m)) : (blocked++, console.log('  BLOCK ' + m)); };
const group = (t) => { console.log(''); console.log('── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); };

/* 读源码（去掉注释 —— 注释里描述旧代码的句子会被当成旧代码，这个坑踩过，见 §6.124 e） */
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
const srcOf = (f) => stripComments(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'));

console.log('');
console.log('世界模板创造 · 验收标准（**现在是红的 = 还没做**）');

/* ══════════════════════════════════════════════════════════════════
   A · 0.5 壳 + 白名单 API
   用户原话：「A 是创造 从 0.5 到 1…什么是 0.5？就是基础中的基础，
             不值得 ai 重复去写的内容，例如聊天框，例如执行按钮」
   ══════════════════════════════════════════════════════════════════ */
group('A · 0.5 壳 + 白名单 API');
{
  const OP = srcOf('opening.js');
  ok(/【事实层 · 不许编】/.test(OP) && /留空是合法的，编造不是/.test(OP),
    '★ 第三步把规矩拆成两层：事实层不许编（留空合法）');
  ok(/【创造层 · 禁止留空】/.test(OP) && /合理编一个/.test(OP),
    '★ 创造层禁止留空（判断不了就合理编一个，并说清依据）—— 用户 2026-09-27 点名要的');
}

ok(PRES.SHELL && typeof PRES.SHELL === 'object',
  '引擎导出「0.5 壳」清单（AI 不用重复写的基础：叙事流/输入执行/面板壳/状态条…）');
ok(PRES.SHELL && Array.isArray(PRES.SHELL.parts) && PRES.SHELL.parts.length >= 5,
  '壳清单列得出具体有哪几样（实测 ' + ((PRES.SHELL && PRES.SHELL.parts) || []).length + ' 样）');
/* ★ v3.11（用户 2026-09-27）：「0.5 说的还是太死 限制它的发挥。**只保留基础游玩的核心，其余的全部放开**」。
   两栏分开：core = 没有它就不能玩（红线）／open = 已搭好但你可以重做。 */
ok(Array.isArray(PRES.SHELL.core) && PRES.SHELL.core.length >= 3 && PRES.SHELL.core.length <= 5,
  '★ 0.5 的核心只剩最少的几样（实测 ' + ((PRES.SHELL.core || []).length) + ' 样：' + ((PRES.SHELL.core || []).map(x => x.name).join('/')) + '）');
ok(PRES.SHELL.core.some(x => x.id === 'gate'), '门控层在核心栏里（唯一不许绕的东西）');
ok(Array.isArray(PRES.SHELL.open) && PRES.SHELL.open.length >= 3,
  '★ 其余列进放开栏（可改/可换/可当素材，实测 ' + ((PRES.SHELL.open || []).length) + ' 样）');
ok(PRES.SHELL.parts.length === PRES.SHELL.core.length + PRES.SHELL.open.length, 'parts = core + open（旧读法照旧可用）');

ok(FW.CREATOR_API && typeof FW.CREATOR_API === 'object',
  '引擎导出「创造者 API」（AI 写代码时唯一能用的那组）');
{
  const api = FW.CREATOR_API || {};
  ok(api.read && Object.keys(api.read).length >= 3,
    '读得到：读存档 / 读投影 / 读门控（实测 ' + Object.keys(api.read || {}).length + ' 个）');
  ok(api.draw && Object.keys(api.draw).length >= 3,
    '画得出：加页签 / 加按钮 / 显示 / 用原语（实测 ' + Object.keys(api.draw || {}).length + ' 个）');
  /* ★ 最要紧的一条：写入只有一条路 —— 用户 Q3 原话「写入是代码负责的」 */
  const wr = Object.keys(api.write || {});
  ok(wr.length === 1 && /update/i.test(wr[0] || ''),
    '★ 写入**只有发 Update 一条路**（实测 ' + JSON.stringify(wr) + '）—— 19 种 Update 的校验/门控/记账才能全部继续生效');
}
{
  /* 代码层：AI 的代码不许直接摸存档对象。查的是"有没有这个防护"，不是"有没有这句话"。 */
  const fws = srcOf('framework.js');
  ok(/directWrite|forbidDirect|不许直接改|直接改字段/.test(fws),
    '关卡在代码里（禁止 AI 的代码直接改存档字段，只能发 Update）');
}

/* ══════════════════════════════════════════════════════════════════
   B · 板块声明必填三项
   用户问「朋友圈如何生成？」→ 谈定的答案：**内容来源必须声明**
   「造板块容易，让板块活着难。不会更新的板块 = 又一个摆设。」
   ══════════════════════════════════════════════════════════════════ */
group('B · 板块声明 · 内容来源是必填项');

const SOURCES = ['view', 'inline', 'event', 'turn', 'onDemand'];
ok(JSON.stringify((FW.CONTENT_SOURCES || []).slice().sort()) === JSON.stringify(SOURCES.slice().sort()),
  '内容来源恰好五类：(a)已有数据视图 (b)主AI顺手 (c)事件驱动复用 (d)回合驱动 (e)按需一次性（实测 ' + JSON.stringify(FW.CONTENT_SOURCES || null) + '）');
ok(Array.isArray(FW.PANEL_REQUIRED) && ['shape', 'source', 'when'].every(k => FW.PANEL_REQUIRED.indexOf(k) >= 0),
  '板块声明必填三项：长什么样 / 内容从哪来 / 什么时候更新（实测 ' + JSON.stringify(FW.PANEL_REQUIRED || null) + '）');

if (typeof FW.checkPanel === 'function') {
  ok(!FW.checkPanel({ shape: {}, when: 'turn' }).ok, '★ 缺「内容从哪来」的板块**不许建**（建出来就是死板块）');
  ok(FW.checkPanel({ shape: {}, source: { kind: 'turn' }, when: '回合' }).ok, '(d) 回合驱动 → 放行（不需要频率：时间是玩家推进的）');
  ok(FW.checkPanel({ shape: {}, source: { kind: 'periodic' }, when: '天' }).ok, '(d) 旧档 periodic 仍被接受（别名 → turn）');
  ok(FW.checkPanel({ shape: {}, source: { kind: 'view', of: 'contacts' }, when: 'turn' }).ok,
    '(a) 已有数据的视图 → 放行（0 token）');
  ok(FW.checkPanel({ shape: {}, source: { kind: 'onDemand', trigger: '事件发生' }, when: 'event' }).ok,
    '(e) 按需一次性 → 放行（只在有事时花一次）');
} else {
  ok(false, '★ 缺「内容从哪来」的板块不许建 —— 校验器 `FW.checkPanel` 还没做');
  ok(FW.checkPanel({ shape: { id: 'x', name: 'X' }, source: { kind: 'periodic' }, when: '回合' }).ok === true, '(d) 旧档的 periodic 仍被接受（别名 turn）');
  ok(false, '(a) 已有数据的视图 → 放行 —— 校验器还没做');
  ok(false, '(e) 按需一次性 → 放行 —— 校验器还没做');
}

/* ══════════════════════════════════════════════════════════════════
   C · 留痕
   用户原话：「不管是加了或者未加 都需要留痕」「没加的不管（到此为止）」
   ⚠️ 这一组刻意**测行为**，不测"源码里有没有这个词" ——
      读注释的断言是假的绿（这个项目踩过三次「只会报喜的探针」）。
   ══════════════════════════════════════════════════════════════════ */
group('C · 留痕 · 提议不论批准与否都记');

{
  const d = W.buildDemoWorld();
  ok(typeof FW.logProposal === 'function' && typeof FW.proposalView === 'function',
    '有「框架提议」留痕的入口（logProposal / proposalView）');
  FW.logProposal(d, { what: '加朋友圈', why: '卡是 2026 年', scope: '局', state: '已采纳' });
  FW.logProposal(d, { what: '加灵视', why: '修仙世界才有', scope: '局', state: '未采纳' });
  const v = FW.proposalView(d) || {};
  ok(v.kept === 1 && v.dropped === 1,
    '★ 采纳和未采纳**都留痕**（实测 已采纳=' + v.kept + ' 未采纳=' + v.dropped + '）—— 只记已发生的就看不出它想过什么');
  const tail = (v.tail || [])[0] || {};
  ok(!!tail.why, '留痕带 why（为什么想加）：' + JSON.stringify(tail.why || ''));
  ok(!/retryProposal|resubmit|重新提交/.test(srcOf('framework.js')),
    '未采纳的**不自动重试**（不然就是重复烧 token）');
}

/* ══════════════════════════════════════════════════════════════════
   D · 门控不可绕
   谈定的：「排版自由了，门控不能松」—— 朋友圈 / 通讯录是天然泄漏口
   ══════════════════════════════════════════════════════════════════ */
group('D · 门控不可绕（这次最大的一颗雷）');

{
  const api = FW.CREATOR_API || {};
  const readKeys = Object.keys(api.read || {});
  ok(readKeys.indexOf('gateView') >= 0,
    '★ 读接口里有**门控版**（AI 读到的是"玩家该看到的"，不是存档原样）—— 实测 ' + JSON.stringify(readKeys));
  ok(!readKeys.some(k => /^rawEntities$|^entities$|^allPeople$/.test(k)),
    '★ 读接口里**没有**「绕过门控直接拿 entities」（那等于开一个后门）');
  ok(typeof FW.gateView === 'function' && typeof FW.panelGate === 'function',
    '门控读 / 板块门控是**真函数**（不是注释里的一句话）');
}
{
  const d = W.buildDemoWorld();
  const who = Object.keys((d && d.entities) || {}).filter(id => (d.entities[id] || {}).type === 'person')[0];
  const gv = FW.gateView(d, who);
  ok(gv && typeof gv.name === 'string' && gv.name.length > 0,
    '门控读**能返回名字**（但那是门控放行后的名字）：' + JSON.stringify(gv && gv.name));
  ok(FW.gateView(d, 'npc_根本不存在') === null, '门控读对不存在的人返回 null（不编）');
  /* 板块门控：单个条目炸了不许连累整块 */
  const filtered = FW.panelGate(d, [1, 2, 3], (x) => { if (x === 2) throw new Error('这条不过门控'); return x; });
  ok(JSON.stringify(filtered) === JSON.stringify([1, 3]),
    '★ 板块门控逐条过滤：**过不了的丢掉，不连累整块**（实测 ' + JSON.stringify(filtered) + '）');
}

/* ══════════════════════════════════════════════════════════════════
   E · 隔离与恢复
   用户原话：「代码写多了一个破折号和引号之类的」
             +「报错了不能静默，原因是什么」
             +「重试 / 修复 / 默认布局开始」
             +「为什么报错是代码层级的，不耗 token」
   ══════════════════════════════════════════════════════════════════ */
group('E · 隔离与恢复 · 三件必做');

{
  ok(typeof FW.syntaxCheck === 'function', '★ 有**写入前语法预检**（syntaxCheck）');
  ok(FW.syntaxCheck('const a = 1; return a;').ok === true, '正常代码放行');
  ok(FW.syntaxCheck('const a = "1;').ok === false,
    '★ 挡住「多了一个引号」—— **语法错进不了存档**，且 0 token');
  ok(FW.syntaxCheck('').ok === false, '空代码不放行');
}
{
  const d = W.buildDemoWorld();
  ok(typeof OP.reset === 'function', '★ 有「重跑第三步」的入口（reset）');

  OP.mark(d, 'fallback', '形状认不出');
  ok(OP.done(d) === false,
    '★ **失败（fallback）不算做完** —— 还可以重跑（原来无条件写 openingAt ⇒ 一次超时就把门永久锁死）');
  /* ⚠️ 这条必须在 reset() **之前**查 —— reset 会把 openingNote 一起清掉。
     第一版就写反了，自己撞出来的。（顺序错了的断言 = 假红） */
  ok(!!String(d.meta.openingNote || '').length,
    '报错写明**原因**（代码层级、0 token）：' + JSON.stringify(String(d.meta.openingNote || '').slice(0, 30)));
  OP.mark(d, 'fallback', '又失败');
  ok(OP.done(d) === true,
    '但重试有上限（试满 ' + OP.OPENING_MAX_TRIES + ' 次就不再自动重跑，免得每次进世界都重烧一次）');
  ok(OP.reset(d) === true && OP.done(d) === false, '★ `reset()` 清掉终局标记 ⇒ 可以重新弄');

  const d2 = W.buildDemoWorld();
  OP.mark(d2, 'ai');
  ok(OP.done(d2) === true, '成功（ai）→ 终局，不重复跑');
  const d3 = W.buildDemoWorld();
  OP.mark(d3, 'off');
  ok(OP.done(d3) === true, '玩家关掉了（off）→ 也是终局，不许每次进来都问一遍');
}

/* ══════════════════════════════════════════════════════════════════
   F · 确定性
   用户原话：「不认识 刚认识没多久 那掷骰子呗 这种都是概率问题（视好感咯）」
   ══════════════════════════════════════════════════════════════════ */
group('F · 骰子必须可重放');

{
  const d = W.buildDemoWorld();
  ok(typeof FW.seededRoll === 'function', '★ 有确定性骰子（seededRoll）');
  const a = FW.seededRoll(d, '同事-加微信', 0.5);
  const b = FW.seededRoll(d, '同事-加微信', 0.5);
  ok(a === b, '★ 同一个存档 + 同一件事 ⇒ **永远同一个结果**（可重放，实测 ' + a + '）');
  ok(FW.seededRoll(d, 'x', 0) === false && FW.seededRoll(d, 'x', 1) === true,
    '概率 0 必不中、概率 1 必中');
  /* ⚠️ 第一版这里写的是 `ok(same >= 0, …)` —— **恒真，假绿**。
     自己撞出来了（实测"同号 40/40"却照样通过）。现在改成**真的会红**的判据：
     换一个世界名 ⇒ 种子该变 ⇒ 骰子结果该变。 */
  const d2 = W.buildDemoWorld();
  d2.meta.name = '另一个名字的世界';
  d2.framework = null;                       // 逼它按新名字重算种子
  let diff = 0;
  for (let i = 0; i < 40; i++) if (FW.seededRoll(d2, 'k' + i, 0.5) !== FW.seededRoll(d, 'k' + i, 0.5)) diff++;
  ok(diff > 0,
    '换个世界 ⇒ 骰子结果跟着变（实测 40 次里差 ' + diff + ' 次）—— 证明种子真的在起作用，不是个常数');
  ok(!/Math\.random\(\)/.test(srcOf('framework.js')), '框架里没有裸 `Math.random()`（那会破坏可重放）');
}

/* ══════════════════════════════════════════════════════════════════
   G · 唯一真相源 + 提示词不许一职两写
   这次血的教训：`Math.min` 静默压掉 `cfgMax`；`deriveTools` 有两个调用点
   ══════════════════════════════════════════════════════════════════ */
group('G · 一个真相源 · 一个职责一处写');

{
  const imps = srcOf('import.js');
  const direct = (imps.match(/PRES\.deriveTools\(/g) || []).length;
  ok(direct === 0,
    '★ 不再直接调 `deriveTools`（实测 ' + direct + ' 处）—— 一律走**唯一入口** `PRES.toolsFor`');
  ok((imps.match(/PRES\.toolsFor\(/g) || []).length >= 1, '用的是唯一入口 `PRES.toolsFor`');
  /* 落库那一步必须**复用建档算好的那份**，不许重算 —— 重算就是第二个真相源 */
  ok(/pack\.meta\.tools/.test(imps) && /: PRES\.toolsFor\(data\.meta\)/.test(imps),
    '★ 建档算过就用那份，只有没算过的包（启发式/旧包）才现算');
}
{
  /* ⚠️ 这条原来**数的是正则出现次数** —— 而【补全授权】那**一段**里同时有「你来补」和「必须补」，
     于是它一直在报"写了两处"（**假红**，我自己写出来的）。
     用户的意图是「同一职责不许写在**两条不同的提示词**里」——
     因为 AI 每次调用只看得到自己那条 system，两条各说一次它不会发现冲突，只会各补一遍。
     ⇒ 改成：**数有几条提示词在说这件事**。 */
  const IMP2 = require('../src/import');
  const sources = {
    '第一步·分析': IMP2.analyzeSystem(),
    '第二步·补全建世界': IMP2.scanSystem(),
    '第三步·开局编译': OP.systemPrompt()
  };
  const holders = Object.keys(sources).filter(k => /你来补|必须补|你来裁/.test(sources[k]));
  ok(holders.length <= 1,
    '★ 「补全」这个职责只写在**一条**提示词里（实得 ' + holders.length + ' 条：' + (holders.join(' / ') || '无') + '）');
}

/* ══════════════════════════════════════════════════════════════════
   H · 修复认得新东西 + 提示词给了词汇表和案例
   用户原话：「修复ai看一眼如果出现问题了随时回滚或者修复」
             +「我们是做一个指导 一个案例 告诉它这么做，并且告诉它模拟器支持啥」
   ══════════════════════════════════════════════════════════════════ */
group('H · 修复认得模板 · 提示词给了词汇表和案例');

{
  const RP = require('../src/repair');
  ok(typeof RP.autoFix === 'function', 'repair 有机械可修那一步（autoFix）');
  const d = W.buildDemoWorld();
  FW.ensure(d);
  d.framework.panels = [
    { shape: { name: '朋友圈' }, source: { kind: 'inline' }, when: '回合' },
    { shape: { name: '死板块' }, when: '回合' },
    { shape: { name: '每天刷' }, source: { kind: 'periodic' }, when: '天' }
  ];
  const r = RP.autoFix(d);
  ok(d.framework.panels.length === 2,
    '★ 说不清「内容从哪来」的板块被丢掉（实测剩 ' + d.framework.panels.length + ' 个）');
  ok(d.framework.panels.length >= 1, '旧档 periodic 板块照旧留着（不再补频率：回合驱动）');
  ok((r.fixed || []).some(x => /板块/.test(String(x))),
    '修复动作记进了 fixed：' + JSON.stringify(String((r.fixed || []).filter(x => /板块/.test(String(x)))[0] || '')));
  ok((r.left || []).some(x => /死板块/.test(String(x))), '丢掉的板块也说明了原因（不静默）');
}
{
  ok(typeof FW.creatorPromptBlock === 'function', '有给「创造框架」那一步的提示词块（creatorPromptBlock）');
  const d = W.buildDemoWorld();
  const pb = FW.creatorPromptBlock(d);
  ok(/0\.5 · 只有这四样/.test(pb), '★ 0.5 只列「没有它就不能玩」的那几样');
  ok(/其余全部放开/.test(pb), '★ 其余全部放开（可改/可换/可当素材）');
  ok(/全归你/.test(pb), '★ 明写「这一局长什么样全归你」（别再交一份跟默认差不多的东西）');
  ok(/判断不了就编/.test(pb) && /禁止留空/.test(pb), '★ 创造层：判断不了就合理编一个，禁止留空');
  ok(/编事实.*是错的/.test(pb) && /编世界.*是你的本职/.test(pb), '★ 两层的分工写清了（编事实错／编世界是本职）');
  ok(/发 Update/.test(pb), '① 告诉它**写入只有发 Update 一条**');
  ok(/unfold/.test(pb), '① 告诉它**演出原语**（你给名字，引擎给画法）');
  ok(/onDemand/.test(pb), '② 告诉它**板块声明怎么填**（内容来源五类）');
  ok(/朋友圈/.test(pb), '③ **给了一个案例**（用户点名要的"一个案例"）—— 案例里有朋友圈');
  ok(/门控不可绕/.test(pb), '③ 案例里同时写了边界：门控不可绕');
  ok(pb.length > 300 && pb.length < 6000, '提示词块长度合理（实测 ' + pb.length + ' 字）');
}

/* ══════════════════════════════════════════════════════════════════
   I · 事务性：全有或全无
   用户原话：「写完一个部分就需要看一遍写的对不对…最后全部写完之后再检查一遍
             **没问题就应用**」
   ══════════════════════════════════════════════════════════════════ */
group('I · 事务性 · 没问题就应用（权限大的前提）');

{
  const BUS = require('../src/bus');
  const mk = () => W.buildDemoWorld();
  const firstNpc = (d) => Object.keys(d.entities).filter(i => d.entities[i].type === 'person' && i !== 'player')[0];

  /* ① 一处不过 ⇒ 整批不写 */
  {
    const d = mk();
    const npc = firstNpc(d);
    const before = JSON.stringify(d.entities[npc].profile || {});
    const r = BUS.commit(d, [{
      kind: 'update', updates: [
        { type: '设定补全', target: npc, fields: { 身份: '这一条本来是合法的' }, why: 't' },
        { type: '设定补全', target: 'npc_不存在的人', fields: { 身份: 'x' }, why: 't' }
      ]
    }], { t: d.current.time, allOrNone: true });
    ok(r.rolledBack === true, '★ 一处不过 ⇒ **整批回滚**（实测 rolledBack=' + r.rolledBack + '）');
    ok(JSON.stringify(d.entities[npc].profile || {}) === before,
      '★ **存档真的没被改** —— 合法的那条也没落库（这才是"全有或全无"）');
    ok(r.committed.length === 0, 'committed 一并清空（不然调用方会以为落库了）');
    ok(!!String(r.rolledBackWhy || '').length,
      '回滚原因写清楚了（代码层级、0 token）：' + JSON.stringify(String(r.rolledBackWhy || '').slice(0, 40)));
  }
  /* ② 全过 ⇒ 照常落库 */
  {
    const d = mk();
    const npc = firstNpc(d);
    const r = BUS.commit(d, [{ kind: 'update', updates: [{ type: '设定补全', target: npc, fields: { 身份: '正常补全' }, why: 't' }] }],
      { t: d.current.time, allOrNone: true });
    ok(!r.rolledBack && r.committed.reduce((s, c) => s + (c.applied || 0), 0) === 1, '全过 ⇒ 照常落库');
  }
  /* ③ 不传 allOrNone ⇒ 部分生效照旧（主 AI 每回合靠这个，**不许动**） */
  {
    const d = mk();
    const npc = firstNpc(d);
    const r = BUS.commit(d, [{
      kind: 'update', updates: [
        { type: '设定补全', target: npc, fields: { 身份: '合法的' }, why: 't' },
        { type: '设定补全', target: 'npc_不存在的人', fields: { 身份: 'x' }, why: 't' }
      ]
    }], { t: d.current.time });
    ok(!r.rolledBack && r.committed.reduce((s, c) => s + (c.applied || 0), 0) === 1,
      '★ 不传 allOrNone ⇒ **部分生效照旧**（主 AI 的"一条坏不连累整回合"是刻意的降级，不许被这次改动误伤）');
  }
  ok(/allOrNone/.test(srcOf('opening.js')), '第三步（开局编译）走的是全有或全无');
  ok(!/return \{ ok: false, why: 'all_or_none_rejected'/.test(srcOf('opening.js')),
    '★ 回滚时**不许提前 return** —— 那样会跳过 fallback(data)，玩家卡在门口（第一版就这么写错了）');
}

/* ══════════════════════════════════════════════════════════════════
   J · 提示词不许自相矛盾（用户 2026-09-26 指出的真冲突）
   用户原话：「【扫描忠实 · 不许审查】…像这个可以改个意思啊 按照原文语义
             本质上是要求模型按照原意去写这个没问题 和上面我感觉有冲突的
             可能是被模型纠错了的部分可能与这里有歧义？」
   ══════════════════════════════════════════════════════════════════ */
group('J · 提示词不许自相矛盾（静默打架比写错更坏）');

{
  const IMP = require('../src/import');
  const scan = IMP.scanSystem();
  ok(/因为内容敏感/.test(scan),
    '★ 【不许审查】带**限定词**「因为内容敏感」—— 不带限定词它就是"一律不许改"，与【补全授权】直接打架');
  ok(/不禁止.*补全|不禁止.*裁决/.test(scan),
    '★ 明写「这条不禁止补全与裁决」—— 让模型知道两段的分工，而不是自己猜');
  ok(/动机/.test(scan) && /世界自洽/.test(scan),
    '★ 把判据落成一句话：**看动机**（为"更安全"而改＝禁，为"世界自洽"而改＝办）');
  ok(!/——禁止净化、删改、柔和化/.test(scan),
    '旧的那种无限定词的写法**不许回来**（实测：它是静默打架的源头）');

  const an = IMP.analyzeSystem();
  ok(/矛盾清单/.test(an) && /对不上号/.test(an),
    '第一步要求**提出**矛盾点，并给出动手的判据（"这里和那里真的对不上号"）');
  ok(/纠错要少|不要见一个改一个/.test(an),
    '★ 「纠错**要少**」（用户原话：「纠错大概是很少的」）—— 不是见一个改一个');
  ok(/原文：|与 §/.test(an),
    '★ 纠错必须**括号留痕**（原文是什么 / 与哪里矛盾）—— 改了不留痕 = 把 AI 的判断伪装成作者的原意');
  ok(/不许不留痕地改/.test(an), '明写"不许不留痕地改"（这是这个项目最忌讳的一类错：把编的当事实）');
}

/* v3.17：G 组（创造链）已挪走 —— 那套断言编码的是「代码批准」的旧设计。
   现在的覆盖在 scripts/frame-lifecycle-check.js（模块的一生 23 条）与 e2e-smoke（端到端 27 条）。 */

console.log('==== world-template-check: ' + pass + ' passed, ' + fail + ' failed'
  + (blocked ? (', ' + blocked + ' blocked') : '') + ' ====');
if (fail || blocked) {
  console.log('');
  if (fail) console.log('（FAIL = 该做还没做；做完一层少一条。）');
  if (blocked) console.log('（BLOCK = **刻意留红**：卡在另一件大改上，不是漏做。）');
  console.log('  提醒：**不要**把它加进 run-all.js —— 它是施工图纸，不是验收闸门。');
}
process.exitCode = fail ? 1 : 0;
