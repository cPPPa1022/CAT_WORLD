// e2e-smoke.js — 端到端冒烟：**建档四步 → 落库 → 开局编译 → 跑一个回合**
//
// 为什么要有它（而不是只看一堆单元断言）：
//   单元断言各自都绿、合起来跑不通，是这个项目反复踩的死法。
//   这一条走的是**真实调用链**（scanCard → packToData → opening.compile → game.runTurn），
//   只用假模型替掉网络 —— **0 token、0 联网**。
//
// 用法：node scripts/e2e-smoke.js（失败非零退出）
'use strict';
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(os.tmpdir(), 'ws-e2e-' + Date.now());
fs.mkdirSync(path.join(TMP, 'data'), { recursive: true });
process.env.WORLD_SIM_DATA = TMP;
process.env.WORLD_SIM_ASSETS = ROOT;

const AI = require('../src/ai');
const IMP = require('../src/import');
const OP = require('../src/opening');
const W = require('../src/world');
const G = require('../src/game');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  OK   ' + m)) : (fail++, console.log('  FAIL ' + m)); };
const calls = [];

/* ── 假模型：流式发 SSE、非流式发 JSON，按 system 分流 ── */
function fake(sys, msgs) {
  const J = (o) => JSON.stringify(o);
  if (/世界分析师/.test(sys)) return '## 零、身份证\n题材：测试 / 日常\n戏：测试冲突\n调性：日常\n不是什么：不是战斗卡\n## 三、关系网\n玩家↔老周：旧识\n';
  if (/开局编译/.test(sys)) return J({ player: { fields: { 身份: '修理工' } }, npcs: [{ id: 'npc1', fields: { 职业: '铺主' } }], world: { fields: { note: '一句话' } } });
  if (/扫描 AI/.test(sys)) {
    return J({
      meta: { name: '测试镇', era: '九十年代 · 小镇', carries: { time: 'brick', news: 'paper', map: 'paper', note: 'letter' } },
      time: '1996-06-14T20:45:00', weather: '晴',
      player: { name: '你', identity: '修理工', origin: '本地人' },
      npcs: [{ id: 'npc1', name: '老周', inScene: true, rel: '旧识', relHow: '住隔壁', bond: '旧识' }],
      places: [{ id: 'p1', name: '街上' }], firstScene: '街上很静。', rules: ['测试规则'],
      filled: [{ what: '老周的职业', why: '卡里没写' }], conflicts: [{ where: '§一 vs §五', took: '§一', why: '更像作者意图' }]
    });
  }
  /* v3.12：世界模板创造 —— 创造者那一次调用（system 里带【世界模板创造者】）返回一个板块。 */
  if (/世界模板创造者/.test(sys)) return J({ panels: [{ shape: { id: 'note', name: '柜台记事本', icon: 'log', list: ['谁', '写了什么'] }, source: { kind: 'view', of: 'knowledge.knownPeople' }, when: '有变化时', why: '铺子里该有个记事本', rows: [['老周', '今天赊了两包烟']] }] });
  /* 主 AI：frame 里顺手说一句「想改框架吗」（0 额外 token） */
  if (/主AI|岗位说明书/.test(sys)) return J({ frame: { tag: '测试·夜·晴', focus: [], suggestions: [], beats: [{ type: 'narration', text: '街上很静。' }], creator: { want: true, why: '铺子里缺一个记事本' } }, updates: [] });
  return '{}';
}

globalThis.fetch = async function (url, init) {
  const body = JSON.parse(init.body || '{}');
  const sys = String(((body.messages || [])[0] || {}).content || '');
  const content = fake(sys, body.messages);
  /* ⚠️ 存**全文**，不许 slice —— system 前面是 687 字宪章（withCharter 前置的），
     截断之后 /世界分析师/ 永远匹配不到。第一版就是这么写错的（实测"跑了 0 次"）。 */
  calls.push({ sys: sys, max: body.max_tokens, stream: !!body.stream });
  if (body.stream) {
    const enc = new TextEncoder();
    const chunk = 'data: ' + JSON.stringify({ choices: [{ delta: { content: content } }] }) + '\n\n'
      + 'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) + '\n\n'
      + 'data: [DONE]\n\n';
    return {
      ok: true, status: 200, text: async () => content,
      json: async () => ({ choices: [{ message: { content: content }, finish_reason: 'stop' }] }),
      body: new ReadableStream({ start(c) { c.enqueue(enc.encode(chunk)); c.close(); } })
    };
  }
  return {
    ok: true, status: 200, text: async () => content,
    json: async () => ({ choices: [{ message: { content: content }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
    body: null
  };
};

const CARD = { name: '端到端测试卡', description: '阿岩在镇上开修理铺，和沈姨是邻居。', personality: '闷葫芦', first_mes: '你推开门。', scenario: '镇上' };
const CFG = { llm: { baseURL: 'http://127.0.0.1:9/v1', apiKey: 'k', model: 'e2e', maxTokens: 393216 }, roles: {}, image: { enabled: false } };

(async function () {
  console.log('');
  console.log('端到端冒烟 · 建档 → 落库 → 开局编译 → 跑一回合（假模型，0 token）');

  /* ① 建档 */
  let scan = null, err1 = '';
  try { scan = await IMP.scanCard(CARD, CFG, false); } catch (e) { err1 = String((e && e.message) || e); }
  ok(!err1, '① 建档跑通（scanCard 没抛）' + (err1 ? '：' + err1 : ''));
  ok(scan && scan.mode === 'llm', '① 走的是 AI 那条路（mode=' + (scan && scan.mode) + '）');
  ok(scan && !!(scan.pack && scan.pack.meta), '① 建出了世界包');
  ok(scan && String(scan.analysis || '').length > 0, '① 分析稿非空（' + String((scan && scan.analysis) || '').length + ' 字）');

  const nAnalyze = calls.filter(c => /世界分析师/.test(c.sys)).length;
  const scanCall = calls.filter(c => /扫描 AI/.test(c.sys));
  ok(nAnalyze === 3, '① 分析**分包**跑了 3 次（实测 ' + nAnalyze + '）');
  ok(scanCall.length >= 1, '① 产出步骤跑了（' + scanCall.length + ' 次）');
  ok(calls.every(c => c.max === 393216), '① 每一次调用的上限都跟着设置走（全部 = 393216）');

  /* ② 落库 */
  let data = null, err2 = '';
  try { data = IMP.packToData(scan.pack); } catch (e) { err2 = String((e && e.message) || e); }
  ok(!err2, '② 落库跑通（packToData 没抛）' + (err2 ? '：' + err2 : ''));
  ok(data && data.meta && Array.isArray(data.meta.tools) && data.meta.tools.length > 0,
    '② 工具清单推出来了：' + JSON.stringify((data && data.meta && data.meta.tools || []).map(t => t.name)));

  /* ③ 开局编译（现在是全有或全无） */
  let open = null, err3 = '';
  try { open = await OP.compile(data, CFG); } catch (e) { err3 = String((e && e.message) || e); }
  ok(!err3, '③ 开局编译跑通' + (err3 ? '：' + err3 : ''));
  ok(open && (open.ok || open.why), '③ 开局编译给了结果（ok=' + (open && open.ok) + ' why=' + JSON.stringify((open && open.why) || null) + '）');
  ok(OP.done(data), '③ 跑完之后 done() 为真（成功才算终局，失败可重跑）');
  /* ★ v3.15：第三步的后半段 —— 建档跑完就「世界建立」（板块 + 首批内容） */
  ok(open && Number(open.panels) >= 1, '③★ 建档第三步顺带把这一局造出来了（板块 ' + (open && open.panels) + ' 个）');
  ok((((data.framework || {}).panels) || []).length >= 1, '③★ 板块进了存档（' + JSON.stringify((((data.framework || {}).panels) || []).map(p => p.shape && p.shape.name)) + '）');
  ok(((((data.framework || {}).panelRows) || {}).note || []).length >= 1, '③★ 板块**带首批内容**（建档时没有下一回合，空壳就是没做）');
  ok((((data.framework || {}).created) || []).length >= 1, '③★ 建档这次记账了（局面信息要告诉 AI 上一次改是什么时候）');

  /* ④ 一个回合 */
  let turn = null, err4 = '';
  try { turn = await G.runTurn(data, '你好', CFG); } catch (e) { err4 = String((e && e.message) || e); }
  ok(!err4, '④ 一个回合跑通（runTurn 没抛）' + (err4 ? '：' + err4 : ''));
  ok(turn && turn.frame, '④ 回合产出了 frame');

  /* ④b ★ v3.12 · 世界模板创造：主 AI 说一句 → 代码批准 → 造出来 → 上屏（一次真调用，假模型 0 token） */
  const pv = ((turn && turn.view) || {}).panels || [];
  ok(pv.length === 1 && pv[0].id === 'note', '④b 板块造出来了并进了视图：' + JSON.stringify(pv.map(x => x.name)));
  ok(pv.length === 1 && pv[0].source === 'view', '④b 内容来源是 view（行从存档字段现取，几个算几个）');
  const props = ((data.framework && data.framework.proposals) || []);
  ok(props.some(x => x.state === '已采纳'), '④b 留痕：已采纳那一笔在');
  const turn2 = await G.runTurn(data, '再看看', CFG);
  ok(!!turn2, '④b 第二回合跑通');
  const props2 = ((data.framework && data.framework.proposals) || []);
  ok(props2.some(x => x.state === '未采纳'), '④b ★ 它再提一次：**代码不拦**（判断权归 AI），重复的那份靠去重丢掉并留痕（' + JSON.stringify((props2.filter(x => x.state === '未采纳')[0] || {}).note || '') + '）');
  ok((((turn2.view || {}).panels) || []).length === 1, '④b 同名去重生效：板块仍然只有一个（不是代码拦的，是重复的被丢掉了）');
  const nCreator = calls.filter(c => /世界模板创造者/.test(c.sys)).length;
  ok(nCreator >= 2, '④b 创造者被调用过（开工那次 + 回合里至少一次）—— 实测 ' + nCreator + ' 次' + (nCreator > 1 ? '：' + JSON.stringify(calls.map((s, i) => i + ':' + String(s).slice(0, 24)).filter(x => /创造/.test(x))) : ''));

  /* ⑤ 全链条不变量 */
  ok(calls.length >= 5, '⑤ 全程共 ' + calls.length + ' 次调用');
  const sysTexts = calls.map(c => c.sys);
  ok(sysTexts.filter(s => /世界分析师/.test(s)).length === 3, '⑤ 三次分析用的是**同一个** system（前缀缓存才吃得到）');

  console.log('');
  console.log('==== e2e-smoke: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error('冒烟自己炸了：' + ((e && e.stack) || e)); process.exitCode = 1; });
