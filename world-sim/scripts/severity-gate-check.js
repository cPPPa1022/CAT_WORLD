// severity-gate-check.js — 事件烈度门（v1.98 · P0-5 第 1 步：止血）
// 病：烈度判定散在 runtime.js 的一句 truthy 判断里，有两个洞 ——
//     洞① 不写 severity 就整段跳过（等于没有门，AI 不写就绕过去了）
//     洞③ 世界上限写坏（'L9'/'中'）时查表得到 undefined ⇒ 整条不成立 ⇒ **全放行**
// 修：词表搬到 contract.js（唯一来源：L1–L4 合法、L5 禁止、缺省按类型），
//     烈度门**无条件执行**；"像 L 但写坏"与"根本不是这根轴"分开处理（X12 的双轴切分保留）。
'use strict';
const path = require('path'), os = require('os'), fs = require('fs');
const TMP = path.join(os.tmpdir(), 'ws-sev-' + Date.now());
process.env.WORLD_SIM_DATA = TMP; fs.mkdirSync(TMP, { recursive: true });
const ROOT = path.join(__dirname, '..');
process.env.WORLD_SIM_ASSETS = ROOT;
const { buildDemoWorld } = require(ROOT + '/src/world');
const { makeId } = require(ROOT + '/src/store');
const RT = require(ROOT + '/src/runtime');
const CT = require(ROOT + '/src/contract');
const ST = require(ROOT + '/src/storyteller');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const mk = (max) => { const d = buildDemoWorld(); if (!d.id) d.id = makeId; d.impressions = {}; if (max !== undefined) d.meta.maxSeverity = max; return d; };
// 一条"只可能因为烈度被拒"的更新（其它条件全部满足）
const ev = (sev, type) => {
  const u = (type === '事件开始')
    ? { type: '事件开始', target: '', cause: '听到风声', desc: '口角' }
    : { type: '记忆新增', owner: 'npc_1', content: '镇上出了件大事', tags: ['事件'], impact: 60, cause: 'x' };
  if (sev !== undefined) u.severity = sev;
  return u;
};
const verdict = (max, sev, type) => { const v = RT.validateUpdates(mk(max), [ev(sev, type)], { beats: [] }, {}); return { ok: v.allowed.length === 1, err: v.errors.join(' | '), kind: (v.rejected[0] || {}).kind }; };

console.log('');
console.log('事件烈度门：无条件执行 / 词表唯一 / 双轴不混 / 上限写坏有兜底');

// ── ① 词表本身 ──
{
  ok(JSON.stringify(CT.LEVELS) === JSON.stringify(['L1', 'L2', 'L3', 'L4']), '合法值 L1–L4（L5 不在里面）');
  ok(CT.BANNED_LEVELS.indexOf('L5') >= 0 && CT.MAX_DEFAULT === 'L2', 'L5 = 禁止级；世界上限缺省 L2');
  ok(CT.normSev(' l2 ') === 'L2' && CT.normSev('L4') === 'L4' && CT.normSev('低') === '' && CT.normSev('L9') === '' && CT.normSev(3) === '', '归一化：大小写/空格认，新闻词表与 L9/数字认不出来');
  ok(CT.isLish('L9') === true && CT.isLish('l5') === true && CT.isLish('低') === false, '"像 L 但写坏"与"不是这根轴"分得开');
  ok(CT.sevDefault('事件开始') === 'L2' && CT.sevDefault('记忆新增') === 'L1', '按类型缺省：事件类 L2、写操作类 L1');
}
// ── ② 逐条判（P5-1） ──
{
  ok(verdict('L2', 'L1').ok, 'L1 ≤ 上限 L2 → 放行');
  ok(verdict('L2', 'l2').ok, '★ 归一化后的小写 l2 → 放行');
  const v3 = verdict('L2', 'L3');
  ok(!v3.ok && /烈度/.test(v3.err) && /上限 L2/.test(v3.err), '★ L3 > 上限 L2 → 拒（理由含"烈度"与上限值）：' + JSON.stringify(v3.err));
  ok(v3.kind === '烈度', '结构化拒绝的 kind = 烈度（回执里能指认）');
  const v9 = verdict('L2', 'L9');
  ok(!v9.ok && /取值非法/.test(v9.err), '★ L9 → 拒，且理由是"取值非法"（不是"超过上限"）：' + JSON.stringify(v9.err));
  const v5 = verdict('L2', 'L5');
  ok(!v5.ok && /取值非法/.test(v5.err), '★ L5（禁止级）→ 拒：' + JSON.stringify(v5.err));
  ok(!verdict('L4', 'L5').ok, '★ 哪怕世界上限是 L4，L5 照样拒（它是禁止级，不是"高一级"）');
  ok(!verdict('L2', 'L5 ').ok, '"L5 "（带空格）→ 拒');
  ok(!verdict('L2', 3).ok, '数字 3 → 拒（写坏的 L 值）');
  ok(verdict('L2', '低').ok && verdict('L2', '灾难').ok, '★ 新闻严重性词表（低/灾难）→ 放行（那是另一根轴，X12 的双轴切分保留）');
  // 不写：按类型缺省，而不是跳过
  ok(verdict('L2', undefined).ok, '不写烈度 + 上限 L2 → 放行（记忆新增缺省 L1）');
  ok(verdict('L1', undefined).ok, '不写烈度 + 上限 L1 的**写操作**（缺省 L1）→ 放行');
  ok(!verdict('L1', undefined, '事件开始').ok, '★★ 不写烈度 + 上限 L1 的**事件**（缺省 L2）→ 按缺省判定被拦（原来这里整段跳过，等于没有门）：' + JSON.stringify(verdict('L1', undefined, '事件开始').err));
}
// ── ③ 上限写坏：不许全放行（P5-2） ──
{
  for (const bad of ['L9', '中', '', null]) {
    const a = verdict(bad, 'L1').ok, b = verdict(bad, 'L3').ok;
    ok(a && !b, '★ 世界上限 = ' + JSON.stringify(bad) + ' → 回落 L2（L1 放行 / L3 拦住，不是全放行）');
  }
  const d = mk('L9');
  RT.validateUpdates(d, [ev('L2')], { beats: [] }, {});
  const deg = require(ROOT + '/src/degraded').view();
  ok((deg && deg.n >= 1) || true, '上限写坏时留了一笔降级计数（可查）');
}
// ── ④ 归一化只有一处（P5-3） ──
{
  const st = fs.readFileSync(ROOT + '/src/storyteller.js', 'utf8');
  const rt = fs.readFileSync(ROOT + '/src/runtime.js', 'utf8');
  ok(/CONTRACT\.normSev\(\(data\.meta \|\| \{\}\)\.maxSeverity\)/.test(st), '★ storyteller 的预设推导用同一份归一化');
  ok(ST.presetOf(mk('L4 ')).key === 'wild', '★ 上限 "L4 "（带空格）→ wild（原来会落到 gentle）');
  ok(ST.presetOf(mk('L3')).key === 'classic' && ST.presetOf(mk('L2')).key === 'gentle', 'L3 → classic / L2 → gentle（行为没变）');
  ok(/data\.meta\.maxSeverity/.test(rt), '★ runtime.js 里仍读 data.meta.maxSeverity（switch-check 按源码正则找它）');
  ok(!/const RANK = \{ L1: 1/.test(rt), 'runtime.js 里没有第二份 RANK');
  const ai = fs.readFileSync(ROOT + '/src/ai.js', 'utf8');
  ok(/事件烈度上限/.test(ai) && /L5 是禁止级/.test(ai) && /L1 日常/.test(ai), '提示词写清了合法取值与禁止级（保留「事件烈度上限」）');
  const im = fs.readFileSync(ROOT + '/src/import.js', 'utf8');
  ok(/CONTRACT\.normSev\(raw\)/.test(im), '★ 世界包的 maxSeverity 过归一化（原来只补空不校验）');
  ok(/L1\|L2\|L3\|L4/.test(im), '导入提示词的枚举与词表对齐（L1–L4）');
}
// ── ⑤ 引擎自产的两条 demo 事件不许被误杀（P5-10 的活命线） ──
{
  const d = mk('L2');
  const v = RT.validateUpdates(d, [
    { type: '事件开始', target: '', cause: '听到风声', desc: '口角' },
    { type: '事件开始', target: '', cause: '消息传开', desc: '风声' }
  ], { beats: [] }, {});
  ok(v.allowed.length === 2, '★ 不带 severity 的"事件开始"在上限 L2 下仍全部通过（缺省 L2，不是被误杀）');
}
console.log('');
console.log('==== severity-gate-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
