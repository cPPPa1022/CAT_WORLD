// truncate-check.js — 截断续写（v1.78，用户：「能不能做成 dsh 这样？」）
'use strict';
const path = require('path'); const os = require('os'); const fs = require('fs');
const TMP = path.join(os.tmpdir(), 'ws-trunc-' + Date.now());
process.env.WORLD_SIM_DATA = TMP; fs.mkdirSync(TMP, { recursive: true });
const AI = require('../src/ai');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
console.log('');
console.log('撞到长度上限 ≠ 失败：自动续写接上，重复就停');

const CFG = { llm: { baseURL: 'https://x/v1', apiKey: 'k', model: 'm', timeoutMs: 5000 }, sample: {} };
function stubFetch(seq) {
  let n = 0;
  global.fetch = async () => {
    const s = seq[Math.min(n, seq.length - 1)]; n++;
    return { ok: true, json: async () => ({ choices: [{ message: { content: s.text }, finish_reason: s.finish }], usage: {} }) };
  };
  return () => n;
}

(async function () {
  const A = '甲'.repeat(50), B = '乙'.repeat(50);
  let count = stubFetch([{ text: A, finish: 'length' }, { text: B, finish: 'stop' }]);
  const out = await AI.llmOnceFull(CFG, [{ role: 'user', content: 'x' }], 100);
  ok(count() === 2, '★ 截断后**真的又调了一次**（不是放弃）');
  ok(out === A + B, '★★ 两段拼起来了（' + out.length + ' 字）');
  ok(out.indexOf('甲') === 0 && out.indexOf('乙') > 0, '★ 顺序对：先原来的，后续写的');

  count = stubFetch([{ text: A, finish: 'stop' }]);
  const out2 = await AI.llmOnceFull(CFG, [{ role: 'user', content: 'x' }], 100);
  ok(count() === 1 && out2 === A, '★ 正常结束 → 只调一次（不浪费）');

  count = stubFetch([{ text: A, finish: 'length' }, { text: A, finish: 'length' }, { text: A, finish: 'length' }]);
  const out3 = await AI.llmOnceFull(CFG, [{ role: 'user', content: 'x' }], 100);
  ok(count() === 2, '★★ 续写内容与已写重复 → 立刻停（只调了 ' + count() + ' 次，没烧到上限）');
  ok(out3 === A, '★ 不把重复的那段也拼进去');

  ok(AI.looksDegenerate('短') === false, '短文本不判退化');
  ok(AI.looksDegenerate('这是一段会反复出现的话。'.repeat(60)) === true, '★★ 同一段反复出现 → 判为退化（384K 撞天花板几乎都长这样）');

  const ai = fs.readFileSync(path.join(__dirname, '..', 'src', 'ai.js'), 'utf8');
  ok(/raw = await llmOnceFull\(cfg, messages, curr, onDelta, reason\)/.test(ai), '★ llmJSON 走续写版');
  /* v3.4：这条断言原来要求调用后面**紧跟右括号** —— 而 llmText 现在多传了两个参数
   （maxCont 位置留 undefined、noJson=true，见 §6.118c：JSON 模式必须由调用方显式关掉）。
   断言要守的是"走的是续写版这条路"，不是"参数个数恰好五个"，所以模式放宽到不看结尾。 */
ok(/llmOnceFull\(cfg, messages, mt, onDelta, 'high'/.test(ai), '★ llmText（扫描分析那一步）走续写版');
  ok(/LAST_FINISH = finish \|\| ''/.test(ai) && /LAST_FINISH = fr \|\| ''/.test(ai), '★ 流式和非流式都记 finish_reason');
  ok(/从断掉的地方接着写/.test(ai), '★ 续写指令明说「不要重复、不要重开头」');
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  ok(/已经自动续写接上了/.test(ui), '★ 设置里那句警告改成说明「已自动续写」（原来只会说「把它调大即可」）');

  console.log('');
  console.log('==== truncate-check: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exitCode = fail ? 1 : 0;
})();
