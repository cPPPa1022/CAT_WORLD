// reality-check.js — 「这些功能到底有没有被真的用过」的尺子（v2.09）
// 用法：
//   node scripts/reality-check.js                 看报告（扫用户存档 %APPDATA%/world-sim）
//   node scripts/reality-check.js <数据根>         指定数据根
//   node scripts/reality-check.js --assert        断言模式：任何一项"从未产出"即非零退出
//
// 为什么有这份脚本（写给三个月后的自己）：
//   这个项目有 195 条断言，全是**代码不变量**（白名单/门控/契约/落盘……）。
//   没有一条回答过最容易失真的那个问题：**这些功能，在我真实玩的存档里，到底产出过东西吗？**
//   实测代价：481 个世界里 archives=0、visited>1 出现 0 次、messages=0 ——
//   也就是说"剧本存档/移动/消息"这些机制**从未在真实游玩里跑过一次**，
//   而全部断言都是绿的。**绿灯只证明代码自洽，不证明功能被用过。**
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const arg = process.argv.slice(2).filter(x => x !== '--assert');
const ASSERT = process.argv.includes('--assert');
const root = arg[0] || path.join(process.env.APPDATA || '', 'world-sim', 'data');
/* 两种布局都认：用户根 <root>/worlds，开发根 <root>/data/worlds（WORLD_SIM_DATA 指到外层时） */
const wdir = fs.existsSync(path.join(root, 'worlds')) ? path.join(root, 'worlds') : path.join(root, 'data', 'worlds');

if (!fs.existsSync(wdir)) {
  console.log('找不到世界目录：' + wdir);
  console.log('（用 node scripts/reality-check.js <数据根> 指定，例如 .tmp-verify/data）');
  process.exit(2);
}

/* 每一项 = 一个「玩家能感知的功能」，判据是**产物里有痕迹**（不是代码里有没有实现） */
const FEATURES = [
  ['移动（去过第二个地方）', w => ((w.knowledge || {}).visited || []).length > 1],
  ['消息（收或发过）',      w => (w.messages || []).length > 0],
  ['新闻（世界有过新闻）',   w => (w.news || []).length > 0],
  ['听说过新闻（门控出口）', w => ((w.knowledge || {}).heardNews || []).length > 0],
  ['文书（生成过文档）',     w => Object.keys(w.documents || {}).length > 0],
  ['剧本存档（一场戏落了盘）', w => Object.keys(w.archives || {}).length > 0],
  ['跨天（过了至少一天）',   w => Object.keys(w.dayDigest || {}).length > 0],
  ['承诺（答应过谁）',      w => (w.claims || []).length > 0],
  ['世界会长（框架长了词/型/律）', w => { const f = w.framework || {}; return ((f.vocab && (f.vocab.docKinds || []).length) || 0) + Object.keys((f.vocab && f.vocab.fxNames) || {}).length + (f.types || []).length + (f.rules || []).length > 0; }],
  ['记忆（有人记住了事）',   w => Object.keys(w.memories || {}).length > 0],
  ['印象（你认识了人）',     w => Object.keys(w.impressions || {}).length > 0],
  ['关系变化（有因果的）',   w => ((w.ledger || []).filter(l => l.type === '关系变化')).length > 0],
  ['玩家动作被记下',        w => (w.experience || []).length > 0],
  ['开局编译真的落了库',     w => w.meta && w.meta.openingHow === 'ai']
];

const files = fs.readdirSync(wdir).filter(f => f.endsWith('.json'));
if (!files.length) { console.log('世界目录是空的：' + wdir); process.exit(2); }
const worlds = [];
for (const f of files) {
  try { worlds.push({ f: f, w: JSON.parse(fs.readFileSync(path.join(wdir, f), 'utf8')) }); } catch (e) {}
}

console.log('');
console.log('reality-check · 数据根 ' + root);
console.log('世界数 ' + worlds.length + '（' + files.length + ' 个文件）');
const turns = worlds.map(x => ((x.w.experience || []).length));
const deepest = Math.max.apply(null, turns.concat([0]));
console.log('最深的一局：' + deepest + ' 个回合');
console.log('');
console.log('功能                                产出过的世界数 / 总数     判定');
console.log('─'.repeat(78));
let never = [];
for (const [name, test] of FEATURES) {
  let hit = 0;
  for (const x of worlds) { try { if (test(x.w)) hit++; } catch (e) {} }
  const mark = hit === 0 ? '✗ 从未产出' : (hit < worlds.length ? '◐ 部分' : '✓');
  if (hit === 0) never.push(name);
  console.log(name.padEnd(34) + String(hit).padStart(6) + ' / ' + String(worlds.length).padEnd(10) + mark);
}
console.log('─'.repeat(78));
if (never.length) {
  console.log('');
  console.log('★ 从未在真实游玩里产出过产物的功能（' + never.length + ' 项）：');
  for (const n of never) console.log('   · ' + n);
  console.log('');
  console.log('  这些不是 bug —— 是**没被验证过的机制**。它们的断言全绿，只说明"代码自洽"。');
}
if (ASSERT && never.length) { console.log(''); console.log('reality-check: ' + never.length + ' 项从未产出 → 红灯'); process.exit(1); }
console.log('');
console.log('reality-check: ' + (never.length ? never.length + ' 项从未产出' : '全部功能都产出过产物') + '（' + (ASSERT ? '断言模式' : '观察模式') + '）');
process.exit(0);
