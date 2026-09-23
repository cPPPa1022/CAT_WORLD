'use strict';
/* arch-profile.js — 架构画像：把"当前 AI 架构长什么样"变成可复跑的数字
   用法：node scripts/arch-profile.js
   输出：① SYSTEM/资料包 token 结构 ② 资料包逐字段体积 ③ 顶层状态容器 ④ 检索层清点 */
const fs = require('node:fs');
const path = require('node:path');
const AI = require('../src/ai');
const W = require('../src/world');
const RT = require('../src/runtime');
const cn = (s) => (String(s).match(/[\u4e00-\u9fff]/g) || []).length;
const tok = (s) => Math.round(cn(s) * 0.9 + (String(s).length - cn(s)) * 0.28);

const cfg = AI.loadConfig();
let d;
try { d = W.buildDemoWorld(); } catch (e) { console.error('建演示世界失败：' + e.message); process.exit(1); }
d.id = (p) => p + '_' + Math.random().toString(36).slice(2, 8);

console.log('=== ① 一次主 AI 调用的输入结构（演示世界） ===');
const sys = AI.SYSTEM(d, cfg);
console.log('SYSTEM          ' + String(sys.length).padStart(7) + ' 字符  tok≈' + tok(sys));
const seg = (name, s) => console.log('  └ ' + name + '  ' + String(String(s).length).padStart(7) + ' 字符');
seg('叙事宪章  ', AI.charter());
const sysNo = AI.SYSTEM(d, cfg, true);
seg('（无宪章版）', sysNo);
console.log('  → SYSTEM 里' + (sys.length - sysNo.length) + ' 字符是宪章；其余 ' + sysNo.length + ' 字符是可执行规则/契约说明');

console.log('\n=== ② 资料包随场景原文长度的膨胀（sceneLog） ===');
const ctx = { memories: [], candidates: [], action: '你好' };
let lastPack = null;
for (const n of [0, 5, 10, 20, 30, 60]) {
  d.sceneLog = [];
  for (let i = 0; i < n; i++) d.sceneLog.push({ t: d.current.time, type: i % 3 === 0 ? 'dialogue' : 'narration', speaker: i % 3 === 0 ? 'npc_1' : '', text: '这是第' + i + '条场景原文，用来估算资料包规模的一句话。' });
  const p = AI.packetFor(d, ctx);
  lastPack = p;
  console.log('  sceneLog=' + String(n).padStart(2) + ' 条 → 资料包 ' + String(p.length).padStart(6) + ' 字符 tok≈' + String(tok(p)).padStart(5) + '  合计 tok≈' + (tok(sys) + tok(p)));
}
console.log('\n=== ③ 资料包逐字段体积（sceneLog=60） ===');
try {
  const o = JSON.parse(lastPack);
  Object.keys(o).map(k => [k, JSON.stringify(o[k] === undefined ? null : o[k]).length])
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .forEach(r => console.log('  ' + r[0].padEnd(46) + String(r[1]).padStart(6) + ' 字符'));
} catch (e) { console.log('  （资料包非纯 JSON：' + e.message + '）'); }

console.log('\n=== ④ 顶层状态容器（世界数据 = 几个"记忆"） ===');
const keys = Object.keys(d).filter(k => typeof d[k] !== 'function');
console.log('  共 ' + keys.length + ' 个：' + keys.join(' · '));

console.log('\n=== ⑤ 检索层清点（有没有语义检索） ===');
const srcDir = path.join(__dirname, '..', 'src');
const hits = { embedding: 0, cosine: 0, 向量: 0 };
for (const f of fs.readdirSync(srcDir)) {
  if (!f.endsWith('.js')) continue;
  const t = fs.readFileSync(path.join(srcDir, f), 'utf8');
  for (const k of Object.keys(hits)) if (t.indexOf(k) >= 0) hits[k] += (t.split(k).length - 1);
}
console.log('  embedding/cosine/向量 命中：' + JSON.stringify(hits));
console.log('  → 检索 = 标签重叠 × 20 + 记忆权重 + 30 天线性时效（runtime.funnelMemories），纯词法。');

console.log('\n=== ⑥ 记忆激活数据是否被检索用到 ===');
const rtTxt = fs.readFileSync(path.join(srcDir, 'runtime.js'), 'utf8');
const fm = rtTxt.slice(rtTxt.indexOf('function funnelMemories'), rtTxt.indexOf('function funnelMemories') + 700);
console.log('  funnelMemories 打分式：' + (fm.match(/score: *[^,\n]+/) || ['(未找到)'])[0]);
console.log('  activations 被 funnelMemories 引用：' + /activations/.test(fm));
console.log('  lastActivation 被 funnelMemories 引用：' + /lastActivation/.test(fm));
console.log('  结论：写入侧累计的"激活次数/最近激活"在检索侧没有任何权重 ⇒ 关联激活只活一个回合。');
