'use strict';
// llm-trace-check.js — AI 流量台（llmtrace.js）的红线
//
// 为什么要有它：流量台是**包在全项目唯一网络出口外面的那一层**（`llmOnce`）。
// 副作用包在最热的那条路上，最大的风险不是"记不到"，而是**"记日志把真实请求改了"** ——
// 那种错不会有任何东西响，只会让模型的回答莫名其妙地变差。
// 所以这里量三件事：① 记到了请求与响应 ② **请求一个字节没变** ③ 出错/上限/标签都对。
//
// 用法：node scripts/llm-trace-check.js（失败非零退出）
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(os.tmpdir(), 'ws-llmtrace-' + Date.now());
fs.mkdirSync(path.join(TMP, 'data'), { recursive: true });
process.env.WORLD_SIM_DATA = TMP;
process.env.WORLD_SIM_ASSETS = ROOT;

const AI = require('../src/ai');
const TRACE = require('../src/llmtrace');
const W = require('../src/world');
const G = require('../src/game');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  OK   ' + m)) : (fail++, console.log('  FAIL ' + m)); };

console.log('');
console.log('AI 流量台 · 内存环形缓冲（外置工具 .dsh/tools/llm/ 的「门」）');

/* 桩：拦下网络，**并把收到的请求体原样留下来** —— 这是"改没改请求"的唯一证据 */
const seen = [];
const realFetch = globalThis.fetch;
/* contentFor 可以是字符串，也可以是 (body) => string。
   为什么需要函数形态：建档那几步得**按 system 分流**（分析要纯文本、建世界要 JSON），
   一个固定字符串喂不动整条流程 —— 流程走不下去，后面的请求就抓不全，
   于是断言会在"没抓到"的情况下**照样绿**（只会报喜的探针，这个坑踩过）。 */
function stubFn(contentFor, status) {
  globalThis.fetch = async function (url, init) {
    const body = JSON.parse(init.body);
    seen.push({ url: String(url), body: body });
    if (status && status !== 200) return { ok: false, status: status, text: async () => 'boom', json: async () => ({}) };
    const content = typeof contentFor === 'function' ? String(contentFor(body)) : contentFor;
    return {
      ok: true, status: 200,
      text: async () => content,
      json: async () => ({ choices: [{ message: { content: content }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 40 } } }),
      body: null
    };
  };
}
const stub = (content, status) => stubFn(content, status);

const cfg = { llm: { baseURL: 'http://127.0.0.1:9/v1', apiKey: 'k', model: 'test-model', maxTokens: 8192 }, roles: {}, image: { enabled: false } };

(async () => {
  /* ── ① 记到了吗 ───────────────────────────────────────────── */
  ok(TRACE.CAP > 0 && TRACE.view().n === 0, '初始是空的（cap=' + TRACE.CAP + '）');

  stub(JSON.stringify({ frame: { tag: 't', beats: [] }, updates: [] }));
  await G.runTurn(W.buildDemoWorld(), '你好', cfg);
  const v1 = TRACE.view(60);
  ok(v1.n > 0, '跑一个真回合之后记到了 ' + v1.n + ' 条');
  ok(v1.n === v1.seq, '序号连续（seq=' + v1.seq + '）');

  /* ── ② ★ 请求一个字节没变（这条最重要）───────────────────── */
  /* ⚠️ 断言要打在**主 AI 那一次**上，不是"第一次"：一个回合里先跑的是副调用
     （副AI-计算/角色自己开口/编辑…），它们的 system 只有几百字 —— 
     我第一版把 seen[0] 当主 AI，于是两条 FAIL 全打在"副调用本来就是这样"上。 */
  const main = seen.filter(x => String(x.body.messages[0].content).indexOf('岗位说明书 · 主AI') >= 0)[0];
  ok(!!main, '桩收到了请求（共 ' + seen.length + ' 次，其中主 AI ' + seen.filter(x => String(x.body.messages[0].content).indexOf('岗位说明书 · 主AI') >= 0).length + ' 次）');
  ok(main && main.body.model === 'test-model', '请求体照旧发出（model 原值）');
  ok(main && String(main.body.messages[0].content).length > 8000,
    'messages 原样透传（主 AI 的 system ' + (main ? String(main.body.messages[0].content).length : 0) + ' 字）');
  ok(main && main.body.temperature === 0.8 && main.body.top_p === 0.95,
    '采样参数没被改（temperature=0.8 / top_p=0.95）');
  ok(main && main.body.response_format && main.body.response_format.type === 'json_object',
    'JSON 模式照旧带上（response_format 没被吞）');
  ok(main && main.body.max_tokens === 8192, 'max_tokens 原样（主 AI ' + (main && main.body.max_tokens) + '）');
  ok(main && String(main.url).indexOf('/chat/completions') > 0, 'URL 照旧（' + (main && main.url) + '）');
  /* 副调用也照旧发得出去，而且**上限不再被硬帽子压小**。
     2026-09-26：2048 的硬帽子已全部拆掉（用户：「全部调用都走设置那个」）。
     这一条现在守的是新规矩：**每一次请求的 max_tokens 都等于 cfgMax**（桩里设的是 8192）。 */
  const sub = seen.filter(x => String(x.body.messages[0].content).indexOf('副 AI-计算') >= 0)[0];
  ok(!!sub && sub.body.max_tokens === 8192, '副调用的 max_tokens 走 cfgMax（实测 ' + (sub && sub.body.max_tokens) + '，旧版是硬帽子 2048）');
  const off = seen.filter(x => x.body.max_tokens !== 8192);
  ok(off.length === 0, '每一次请求的上限都等于 cfgMax，没有漏网的硬帽子（异常 ' + off.length + ' 次）');

  /* ── ③ 响应正文拿到了（用户要的就是这个）────────────────── */
  const detail = TRACE.one(v1.rows[0].no);
  ok(!!detail, '按 id 取到那一条（no=' + v1.rows[0].no + '）');
  ok(detail && detail.res && detail.res.content.indexOf('frame') >= 0,
    '★ 响应正文拿到了：' + JSON.stringify(String(detail && detail.res && detail.res.content).slice(0, 44)));
  ok(detail && detail.res && detail.res.chars > 0, '响应字数记了（' + (detail && detail.res && detail.res.chars) + '）');
  ok(detail && detail.res && detail.res.finish === 'stop', 'finish_reason 记了（' + (detail && detail.res && detail.res.finish) + '）');
  ok(detail && detail.res.usage && detail.res.usage.cached_tokens === 40, 'usage 记了（cached=' + (detail && detail.res.usage && detail.res.usage.cached_tokens) + '）');
  ok(detail && detail.ms >= 0, '耗时记了（' + (detail && detail.ms) + ' ms）');

  /* ── ④ 认得出"这是哪一步、谁在问" ─────────────────────────── */
  ok(detail && /^[\w.]+:\d+$/.test(detail.site) && detail.site.indexOf('llmtrace') < 0,
    '调用点认出来了：' + (detail && detail.site) + '（不许是本文件自己）');
  ok(detail && detail.label && detail.label.indexOf('未知') < 0, '角色标签：' + (detail && detail.label));
  const labels = Array.from(new Set(TRACE.view(60).rows.map(r => r.label)));
  ok(labels.length >= 2, '一个回合里认出多个角色：' + labels.join(' / '));

  ok(TRACE.labelOf('你是【世界模拟器】的**世界分析师**。') === '建档 · 1 分析', 'labelOf 认得出「建档 1 分析」');
  ok(TRACE.labelOf('你是【世界模拟器】的扫描 AI。') === '建档 · 2 建世界', 'labelOf 认得出「建档 2 建世界」');
  ok(TRACE.labelOf('你是【世界模拟器】的开局编译。') === '建档 · 3 开局编译', 'labelOf 认得出「建档 3 开局编译」');
  ok(TRACE.labelOf('你是【世界模拟器】的人物生成器。') === '生成器 · 人物', 'labelOf 认得出「人物生成器」');
  ok(TRACE.labelOf('天书') === '（未知角色）', '★ 认不出就说「未知」，不猜');

  /* ── ⑤ 环形上限（一局几百次调用，不许无限长）───────────── */
  const before = TRACE.view(200).n;
  for (let i = 0; i < TRACE.CAP + 30; i++) TRACE.begin({ system: 'x', messages: [] });
  const v2 = TRACE.view(200);
  ok(v2.n === TRACE.CAP, '灌 ' + (before + TRACE.CAP + 30) + ' 条之后只剩 ' + v2.n + '（= cap ' + TRACE.CAP + '）');
  ok(v2.rows[0].no === v2.seq, '最新那条在最前（no=' + v2.rows[0].no + ' = seq）');
  ok(v2.rows[v2.rows.length - 1].no === v2.seq - TRACE.CAP + 1, '最老那条正好是 seq-cap+1');

  /* ── ⑥ 出错：留一条 + 异常照旧抛 ────────────────────────── */
  stub('{}', 500);
  let threw = false;
  try { await AI.llmJSON(cfg, [{ role: 'system', content: '岗位说明书 · 主AI' }, { role: 'user', content: 'x' }], undefined, 100); }
  catch (e) { threw = true; }
  const v3 = TRACE.view(3).rows[0];
  ok(threw, '★ 出错时异常照旧抛出（没被流量台吞掉）');
  ok(v3 && v3.err && v3.err.indexOf('500') >= 0, '出错也留了一条：' + JSON.stringify(String(v3 && v3.err).slice(0, 50)));
  ok(v3 && v3.flags.indexOf('★出错') >= 0, '标了「★出错」');

  /* ── ⑦ 记日志失败不许改变行为（截断保护）────────────────── */
  const big = 'x'.repeat(500000);
  const rec = TRACE.begin({ system: big, messages: [{ role: 'user', content: big }] });
  ok(rec.req.system.length < big.length, '超大 system 被截断（记 ' + rec.req.system.length + ' < ' + big.length + '）');
  ok(rec.req.systemChars === big.length, '但**原长**记下来了（' + rec.req.systemChars + '）—— 截断不许骗人');

  /* ── ⑧ 只读：模块没有任何写世界的入口 ───────────────────── */
  const api = Object.keys(TRACE).filter(k => typeof TRACE[k] === 'function');
  ok(api.indexOf('clear') >= 0, '对外只有 begin/end/fail/list/one/view/clear（实得 ' + api.join('/') + '）');
  ok(api.every(k => /^(begin|end|fail|list|one|view|clear|labelOf|siteOf|bumpRefused)$/.test(k)),
    '没有多余的导出（不偷偷写盘、不碰世界）');

  /* ── ⑨ ★ 输出上限只能来自设置（2026-09-26 · 交接文档 §6.124）───────
     用户原话：「扫描的时候为什么要设置限制？最大输出token数全部设置为不设限制。」
              「384K不行？**全部调用都走设置那个**」

     为什么必须是**行为**断言、不能只靠静态扫：静态只能证明"src/ 里没有 Math.min 硬帽子"，
     证明不了"真正发出去的就是设置里那个值"。而这条打过一次真事故：
       设置里填 384K，建档第 1 步被 `Math.min(8192, cfgMax)` **静默**压成 8192 ——
       而 8192 正好是**非思考模式**的官方默认值（思考模式默认 64K），
       于是 8192 token 全被思考吃光、正文 0 字、finish_reason=length。
     所以这里**真的跑一遍建档**，再逐条读请求体里的 max_tokens。 */
  const IMP = require('../src/import');
  const CARD = { name: '上限测试卡', description: '阿岩在镇上开修理铺，和沈姨是邻居。', personality: '闷葫芦', first_mes: '你推开门。' };
  stubFn((body) => {
    const sys = String(((body.messages || [])[0] || {}).content || '');
    if (sys.indexOf('世界分析师') >= 0) return '## 零、身份证\n题材：测试\n戏：测试\n调性：测试\n不是什么：测试\n';
    if (sys.indexOf('开局编译') >= 0) return JSON.stringify({ player: { fields: {} }, npcs: [], world: { fields: {} } });
    return JSON.stringify({ meta: { name: '测试镇' }, npcs: [], places: [], firstScene: '街上很静。', rules: [] });
  });
  /* ★ 用一个**和默认值不同的**数来断言，这条才有力气：
     填 8192 的话，即使代码把 8192 写死也照样绿（就是原来那个 bug 的形态）。
     393216 = 官方允许的最大值，也正是玩家设置里填的那个。 */
  const cfgBig = { llm: { baseURL: 'http://127.0.0.1:9/v1', apiKey: 'k', model: 'test-model', maxTokens: 393216 }, roles: {}, image: { enabled: false } };
  seen.length = 0;
  try { await IMP.scanCard(CARD, cfgBig, false); } catch (e) { }
  ok(seen.length >= 2, '建档真的跑了（记到 ' + seen.length + ' 次请求）—— 抓不到请求时这条会红，而不是静默通过');
  const scanCaps = [...new Set(seen.map(x => x.body.max_tokens))];
  ok(scanCaps.length === 1 && scanCaps[0] === 393216,
    '★ 建档 1 分析 / 2 建世界 的上限**跟着设置走**（设 393216 → 实发 ' + JSON.stringify(scanCaps) + '；旧版是分析 8192 的硬帽子）');

  /* ★ 建档第 3 步「开局编译」**必须单独跑一次** —— 它不在 scanCard 里，走的是另一条路
     （opening.compile）。只测 scanCard 的话，这一步就是"改了但没验"。
     用户 2026-09-26 专门追问过它：「还有那个开局编译也是」。 */
  const OP = require('../src/opening');
  seen.length = 0;
  try { await OP.compile(W.buildDemoWorld(), cfgBig); } catch (e) { }
  ok(seen.length >= 1, '开局编译真的跑了（记到 ' + seen.length + ' 次请求）');
  const openCaps = [...new Set(seen.map(x => x.body.max_tokens))];
  ok(openCaps.length === 1 && openCaps[0] === 393216,
    '★ 开局编译的上限也**跟着设置走**（设 393216 → 实发 ' + JSON.stringify(openCaps) + '；旧版是硬帽子 4096）');

  globalThis.fetch = realFetch;
  console.log('');
  console.log('==== llm-trace-check: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
