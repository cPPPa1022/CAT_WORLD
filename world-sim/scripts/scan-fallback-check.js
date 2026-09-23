// scan-fallback-check.js — 扫描失败分流断言（v1.65 丙方案）
// 用户：「为什么会出现扫描角色没有调用 ai 的情况？」→ 三条路里原来有两条**完全静默**。
'use strict';
const path = require('path'); const os = require('os'); const fs = require('fs');
const TMP = path.join(os.tmpdir(), 'ws-scanfb-' + Date.now());
process.env.WORLD_SIM_DATA = TMP; fs.mkdirSync(TMP, { recursive: true });
const AI = require('../src/ai');
const IMP = require('../src/import');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
console.log('');
console.log('扫描失败分流 —— AI 挂了不再"装作没事"，要么带原因降级、要么把选择权交回用户');

const CARD = { name: '测试卡', description: '一个叫阿岩的年轻人，住在镇上。', personality: '闷葫芦', first_mes: '你推开门。', scenario: '杂货铺' };
const LIVE = { llm: { baseURL: 'https://x/v1', apiKey: 'k', model: 'm' }, sample: {} };

(async function () {
  // ① 没配模型 → 本地整理，但**带原因**（原来 note 是空的）
  const r1 = await IMP.scanCard(CARD, { llm: {} }, false);
  ok(r1.mode === 'heuristic' && !!r1.note, '★ 没配模型 → 本地整理 + 写明原因（' + r1.note + '）');

  // ② AI 回来了但没有 meta → 不许静默！mode=fail + 原因
  AI.llmJSONDeep = async () => ({ npcs: [], places: [] });
  const r2 = await IMP.scanCard(CARD, LIVE, false);
  ok(r2.mode === 'fail' && r2.pack === null, '★ AI 回了但缺 meta → mode=fail（不再悄悄换成本地猜）');
  ok(/meta/.test(String(r2.note)), '★ 原因说清楚了：' + String(r2.note).slice(0, 40));

  // ③ 同一个失败，用户点了「用本地猜」→ 才降级，且带原因
  const r3 = await IMP.scanCard(CARD, LIVE, true);
  ok(r3.mode === 'heuristic' && r3.pack && !!r3.note, '★ allowFallback=true（用户点了用本地猜）→ 才降级，并带原因');
  ok(!!(r3.pack.meta), '降级出来的包仍然是可用世界包');

  // ④ AI 抛错（网络/400/解析失败）→ mode=fail + 原始错误
  AI.llmJSONDeep = async () => { throw new Error('HTTP 400 model not exist'); };
  const r4 = await IMP.scanCard(CARD, LIVE, false);
  ok(r4.mode === 'fail' && String(r4.note).indexOf('400') >= 0, '★ AI 抛错 → mode=fail，原因原样带回（' + String(r4.note).slice(0, 30) + '）');
  const r5 = await IMP.scanCard(CARD, LIVE, true);
  ok(r5.mode === 'heuristic' && String(r5.note).indexOf('400') >= 0, '★ 抛错 + 用户选本地猜 → 降级仍带原因');

  // ⑤ AI 正常 → 还是走 AI（别把正常路也改了）
  AI.llmJSONDeep = async () => ({ meta: { name: '测试世界', era: '现代' }, npcs: [{ id: 'npc1', name: '阿岩' }], places: [], rules: [] });
  const r6 = await IMP.scanCard(CARD, LIVE, false);
  ok(r6.mode === 'llm' && r6.pack.meta.name === '测试世界', '★ AI 正常返回 → mode=llm（正常路没被动）');

  // ⑥ 源码核对：静默替换不许再出现
  const sv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  ok(/needChoice: true/.test(sv), '★ 服务端把失败交回界面（needChoice）');
  ok(/needChoice: true, scanErr:/.test(sv), '★★ key 不许叫 err —— 前端 api() 见到 err 就 throw，needChoice 会永远传不到界面');
  ok(!/needChoice: true, err:/.test(sv), '★★ 没有残留的 needChoice+err 组合');
  ok(/IMP\.scanCard\(card, cfg, !!p\.fallback,/.test(sv), '★ 只有显式 fallback 请求才降级（v1.77 起后面还挂了进度回调）');
  ok(/note=.*scan\.note/.test(sv), '★ 日志带上 note（原来只记 mode，出事后查不到原因）');
  const up = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  ok(/function askScanChoice/.test(up), '★ 界面有"重试 / 用本地猜 / 取消"三选一');
  ok(/while \(pv && pv\.needChoice\)/.test(up), '★ 预览阶段就问（不是等你点了"进入世界"才失败）');
  ok(/fallback: useFallback/.test(up), '★ 二次调用（真正建世界）也带上选择，不会又问一遍');


// ⑤ v1.68 防重复提交（源码核对）
const svr = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
ok(/预览已使用或已过期/.test(svr), '★ apply 没有预览票据时**拒绝**，不再偷偷再造一个世界');
ok(/if \(!String\(p\.prompt \|\| ''\)\.trim\(\)\)/.test(svr), '★ 只有显式带 prompt 才允许"无预览直建"');
const ui2 = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
ok(/let entering = false;/.test(ui2) && /if \(entering\) return;/.test(ui2), '★ 生成世界的「进入」按钮有防连点锁');
ok(/let going2 = false;/.test(ui2), '★ 卡开局的「进入」按钮也有锁');
const svrCode = svr.replace(/\/\*[\s\S]*?\*\//g, '').split(String.fromCharCode(10)).map(l => l.replace(/\/\/.*$/, '')).join(String.fromCharCode(10));   // 剥掉注释再查（注释里会提到这个模式）
ok(!/saveWorld\(current/.test(svrCode), '★★ 代码里没有 saveWorld(current) 误用 —— 它每次都 makeId 新建一个世界（实测 8 个人建出 8 个世界）');
ok(/if \(look\) \{ try \{ persist\(\); \}/.test(svr), '★ 「TA 长什么样」改成 persist()（保存当前世界，不新建）');

  console.log('');
  console.log('==== scan-fallback-check: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exitCode = fail ? 1 : 0;
})();
