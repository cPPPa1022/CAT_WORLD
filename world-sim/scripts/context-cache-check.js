'use strict';
// context-cache-check.js - S1 前缀缓存断言
//
// 为什么要有它：DeepSeek 是**服务端前缀缓存**，命中价约 0.007/M、未命中约 0.22/M（差 ~31x）。
// 「不变的东西放前面」是唯一法则（catworld-harness 4.5）。端上实测基线：改造前缓存率只有 29%。
// 而这条性质**没有任何东西在守着** —— 谁把 moduleFor 挪回 system 末尾、
// 谁把「当前时间」挪回资料包第一位，钱就悄悄涨回去，而且不会有任何报错。
// 所以：把它变成断言。用法：node scripts/context-cache-check.js   失败非零退出
const AI = require('../src/ai');
const W = require('../src/world');
const G = require('../src/game');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  OK  ' + m)) : (fail++, console.log('  FAIL ' + m)); };

// ---- 桩：拦下所有 LLM 调用，只看它收到的 messages ----
const calls = [];
const realIsLive = AI.isLive, realLlmJSON = AI.llmJSON, realLlmText = AI.llmText;
AI.isLive = () => true;
AI.llmJSON = async function (cfg, messages) { calls.push(messages.map(m => ({ role: m.role, content: String(m.content) }))); return { frame: { tag: 't', beats: [] }, updates: [] }; };
AI.llmText = async function () { return ''; };

const newWorld = () => { const d = W.buildDemoWorld(); d.id = (p) => p + '_' + Math.random().toString(36).slice(2, 8); return d; };

(async () => {
  const cfg = { llm: { baseURL: 'http://x', apiKey: 'k', model: 'm' }, roles: {} };

  // 两回合，**故意用不同的 intent.kind**（这是原来破坏缓存的那一刀）
  const d1 = newWorld();
  await G.runTurn(d1, '你好', cfg);            // kind=act
  const d2 = newWorld();
  await G.runTurn(d2, '睡觉', cfg);            // kind=sleep

  // 主 AI 的那次调用 = 第一次且 system 里带 jobCard 的
  const mainCalls = calls.filter(cs => cs.length && cs[0].role === 'system' && cs[0].content.indexOf('主AI') >= 0);
  ok(mainCalls.length >= 2, '抓到两回合的主 AI 调用（实得 ' + mainCalls.length + ' 次带主AI岗位卡的调用）');
  if (mainCalls.length < 2) { console.log(''); console.log('pass=' + pass + ' fail=' + fail); process.exitCode = 1; return; }

  const s1 = mainCalls[0][0].content, s2 = mainCalls[1][0].content;
  ok(s1 === s2, '★ system 在两个不同 intent 之间**逐字节相同**（前缀可整块缓存）');
  if (s1 !== s2) {
    let i = 0; while (i < Math.min(s1.length, s2.length) && s1[i] === s2[i]) i++;
    console.log('       首处不同在第 ' + i + ' 字符：');
    console.log('        A: ' + JSON.stringify(s1.slice(Math.max(0, i - 40), i + 40)));
    console.log('        B: ' + JSON.stringify(s2.slice(Math.max(0, i - 40), i + 40)));
  }

  // moduleFor 必须**不在** system 里（原来拼在末尾）
  ok(s1.indexOf('【睡眠模块】') < 0 && s1.indexOf('【移动模块】') < 0, '模块说明不在 system 里（不再从 system 末尾切前缀）');

  // 它必须出现在 user 消息里，而且是 list[str] 的最后一条
  const u1 = mainCalls[0].filter(m => m.role === 'user');
  const u2 = mainCalls[1].filter(m => m.role === 'user');
  ok(u1.length >= 1 && u2.length >= 1, 'user 消息存在');
  ok(u2[u2.length - 1].content.indexOf('【睡眠模块】') >= 0, '★ 睡眠模块说明在资料包里（intent=sleep 那回合）');

  // 资料包前缀：两回合的**稳定段**必须逐字节相同
  const p1 = u1[0].content, p2 = u2[0].content;
  let same = 0; while (same < Math.min(p1.length, p2.length) && p1[same] === p2[same]) same++;
  const stableLen = AI.packetStableLen ? AI.packetStableLen() : 0;
  ok(same > 200, '★ 两回合资料包共享前缀 ' + same + ' 字符（稳定段，吃缓存）');
  if (same <= 200) {
    console.log('       首处不同在第 ' + same + ' 字符：');
    console.log('        ' + JSON.stringify(p1.slice(Math.max(0, same - 60), same + 60)));
    console.log('        ' + JSON.stringify(p2.slice(Math.max(0, same - 60), same + 60)));
  }
  // 稳定性来自「稳定字段在前」——第一个不同的位置必须已经越过整个 stable 段
  ok(same >= stableLen && stableLen > 0, '共享前缀 >= 稳定段长度（' + same + ' >= ' + stableLen + '）');

  // 缓存计量口径：tokIn 不含 cached（否则成本估算高估 ~30x）
  AI.statMarkCallStart();
  AI.statMarkCallDone(1, { prompt_tokens: 1000, prompt_tokens_details: { cached_tokens: 700 }, completion_tokens: 50 }, 'stop');
  const v = AI.statsView();
  ok(v.tokIn === 300, 'tokIn 只记**未命中**（1000-700=300，实得 ' + v.tokIn + '）');
  ok(v.cached === 700, 'cached 单独记（实得 ' + v.cached + '）');
  ok(v.cachePct === 70, 'cachePct 的分母 = 未命中+命中（实得 ' + v.cachePct + '%）');

  AI.isLive = realIsLive; AI.llmJSON = realLlmJSON; AI.llmText = realLlmText;
  console.log('');
  console.log('pass=' + pass + ' fail=' + fail);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });