// mem-recall.js — 记忆检索质量离线量表（v0.1）
// 目的：把"AI 想不起来"这件事变成可测的数字。纯离线、零依赖、可重复。
// 用法：node scripts/mem-recall.js
'use strict';
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
const W = require(path.join(ROOT, 'src', 'world'));
const RT = require(path.join(ROOT, 'src', 'runtime'));

// ---------- 1) 造一个世界：演示世界的 4 条种子记忆 + 8 条"跑了十来个回合"之后应有的记忆 ----------
function build() {
  const data = W.buildDemoWorld();
  const extra = [
    ['mem_a', 'npc_1', '他上周五说的那句话，你到现在还堵在心里；今天他进门，你没抬眼', ['杂货铺', '冲突'], 65, '1996-06-12T20:00:00'],
    ['mem_b', 'player', '你把沈姨店门口那盏灯修好了，她说改天请你吃饭', ['杂货铺', '手艺', '人情'], 40, '1996-06-13T19:30:00'],
    ['mem_c', 'npc_1', '他修好了门口的灯，手很稳，像干过这行的', ['手艺', '人情'], 35, '1996-06-13T19:40:00'],
    ['mem_d', 'player', '你答应阿岩明天去他修车铺帮忙递工具', ['约定', '修车铺'], 45, '1996-06-14T18:00:00'],
    ['mem_e', 'player', '镇上广播说后半夜转中雨，你把晾在外面的东西收了', ['天气', '生活'], 25, '1996-06-14T19:00:00'],
    ['mem_f', 'npc_1', '儿子上次打电话说工地上忙，这个月又不回来了', ['儿子', '家事'], 55, '1996-06-10T21:00:00'],
    ['mem_g', 'player', '你欠刘师傅五块钱工具钱，说好月底还', ['欠账', '工具'], 40, '1996-06-11T12:00:00'],
    ['mem_h', 'npc_1', '赊账那半个月，她其实也没催过一次', ['情分', '帮忙'], 50, '1996-06-05T10:00:00'],
  ];
  for (const [id, owner, content, tags, impact, t] of extra) {
    data.memories[id] = { id, owner, content, tags, impact, weight: impact, t, lastActivation: t, activations: 1, repeat: false };
  }
  return data;
}

// ---------- 2) 标注集：说这句话的时候，"应该想起来的"是哪几条 ----------
// 全部是玩家/ NPC 真会说的口语。第 2 列是 owner。
const CASES = [
  { q: '我买盒牛奶',                 owner: 'player', want: [] },                                  // 反例：不该翻出旧账
  { q: '上次那件事，我一直过意不去',   owner: 'player', want: ['m_2'] },                            // 指代模糊
  { q: '我欠你的钱，年底一定还',       owner: 'player', want: ['m_4', 'mem_h'] },                    // tags 只有 1 个/0 个重叠
  { q: '这灯修好了，顺手的事',         owner: 'player', want: ['mem_b'] },
  { q: '你儿子最近有消息吗',           owner: 'player', want: ['mem_f'] },
  { q: '明天我去阿岩那儿搭把手',       owner: 'player', want: ['mem_d'] },
  { q: '刘师傅那五块钱我还记着',       owner: 'player', want: ['mem_g'] },
  { q: '外面雨大了，你带伞了吗',       owner: 'player', want: ['mem_e'] },
  { q: '那半个月的账，我心里有数',     owner: 'npc_1',  want: ['m_3', 'mem_h'] },
  { q: '他上次说的话我忘不了',         owner: 'npc_1',  want: ['mem_a', 'm_1'] },
  { q: '他修东西是真有一手',           owner: 'npc_1',  want: ['mem_c'] },
  { q: '今天不早了，我给你煮碗面',     owner: 'npc_1',  want: [] },
];

// 场景标签：玩家站在杂货铺里（game.js:385 真实构造方式，含那个硬编码的"便利店"）
const SCENE_TAGS = ['室内', '店铺', '小雨', '便利店'];

// ---------- 3) 三种打分 ----------
function bigrams(s) {
  const t = String(s || '').replace(/[\s，。、？！：；"'\(\)（）]/g, '');
  const g = [];
  for (let i = 0; i < t.length - 1; i++) g.push(t.slice(i, i + 2));
  return g;
}
function jaccard(a, b) {
  const A = new Set(bigrams(a)), B = new Set(bigrams(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
function overlap(tagsA, tagsB) { return (tagsA || []).filter(t => (tagsB || []).indexOf(t) >= 0).length; }
function recencyOf(data, m) { return Math.max(0, 30 - (new Date(data.current.time) - new Date(m.t)) / 86400000); }

/* v1.95：**量表不再自己抄一份打分**。
   原来这里的 scoreNow 注释写着「runtime.js:279 funnelMemories 的打分（原样抄）」——
   而抄的那份**永远不会跟着实现变**，偏偏这个文件的职责就是「量实现」。
   量表和实现分叉 = 尺子失效（本会话第三次遇到同一类毛病）。
   现在直接引用真实现；旧公式与纯词面留作对照行。 */
const scoreNow = (data, m, sceneTags, q) => RT.memScore(data, m, sceneTags, q);   // ← 真实现
// 对照①：v1.95 之前的公式（标签×20 + 权重 + 时效，**查询完全不参与打分**）
function scoreOld(data, m, sceneTags, q) {
  return overlap(m.tags, sceneTags) * 20 + m.weight + recencyOf(data, m);
}
// 对照②：只用词面相似度（看看 relevance 单独扛能到哪）
function scoreLex(data, m, sceneTags, q) {
  return jaccard(q, m.content) * 100 + m.weight * 0.3 + recencyOf(data, m);
}

function run(data, scorer, n) {
  const rows = [];
  for (const c of CASES) {
    const pool = Object.values(data.memories).filter(m => m.owner === c.owner);
    const ranked = pool.map(m => ({ id: m.id, s: scorer(data, m, SCENE_TAGS, c.q) }))
      .sort((a, b) => b.s - a.s).slice(0, n).map(x => x.id);
    const hit = c.want.filter(w => ranked.indexOf(w) >= 0).length;
    rows.push({ q: c.q, want: c.want, got: ranked, recall: c.want.length ? hit / c.want.length : 1 });
  }
  const scored = rows.filter(r => r.want.length);
  const recall = scored.reduce((s, r) => s + r.recall, 0) / scored.length;
  return { rows, recall, scoredN: scored.length };
}

// ---------- 4) 跑 ----------
const data = build();
const out = [];
out.push('记忆条数: ' + Object.keys(data.memories).length + '  场景标签: ' + JSON.stringify(SCENE_TAGS));
out.push('标注查询: ' + CASES.length + ' 条（其中 ' + CASES.filter(c => c.want.length).length + ' 条有标准答案）');
out.push('');
const table = [];
for (const [name, fn] of [['现状(runtime.memScore 三因子)', scoreNow], ['对照:旧版(标签×20+权重+时效)', scoreOld], ['对照:只用词面2-gram', scoreLex]]) {
  const r4 = run(data, fn, 4);
  const r8 = run(data, fn, 8);
  table.push({ 方案: name, 'recall@4': (r4.recall * 100).toFixed(1) + '%', 'recall@8': (r8.recall * 100).toFixed(1) + '%' });
  if (name.indexOf('现状') === 0) {
    out.push('—— 现状逐条（Top4）——');
    for (const row of r4.rows) out.push('  ' + (row.recall === 1 ? '✔' : '✘') + ' 「' + row.q + '」 应得: [' + row.want.join(' ') + ']  实得: [' + row.got.join(' ') + ']');
    out.push('');
  }
}
out.push('—— 汇总 ——');
for (const t of table) out.push('  ' + t.方案.padEnd(30) + ' recall@4=' + t['recall@4'] + '   recall@8=' + t['recall@8']);
try { fs.writeFileSync(path.join(ROOT, '..', '.tmp-audit', 'mem-recall.json'), JSON.stringify({ table, detail: run(data, scoreNow, 4).rows }, null, 1)); } catch (e) { /* 目录不在就算了，别让量表因为落盘失败而红 */ }

// ---------- 5) 断言（2026-09-14 增）：这是"记忆检索"的第一道回归门 ----------
// 实测基线：现状 55%，把时效项乘 0（模拟改坏）会掉到 50% → 底线定 54%，能抓住这类回归。
// 目标线 75% 是"打分引入查询语句"之后应该到的位置；没到不失败，只提醒。
const base = run(data, scoreNow, 4).recall;
const oldRecall = run(data, scoreOld, 4).recall;
// v1.95：底线从 54% 抬到 70% —— 三因子落地后实测 80%，留 10 个点的抖动余量。
// 旧公式（查询不参与打分）的基线是 55%：这条底线现在能同时抓住「relevance 被摘掉」和「时效项被改坏」。
const FLOOR = 0.70, GOAL = 0.75;
const checks = [
  ['记忆检索 recall@4 ≥ ' + (FLOOR * 100).toFixed(0) + '%（旧公式基线 ' + (oldRecall * 100).toFixed(1) + '%）', base >= FLOOR],
  ['记忆检索 recall@8 ≥ 80%', run(data, scoreNow, 8).recall >= 0.80],
  ['标注集规模 ≥ 10 条', CASES.filter(c => c.want.length).length >= 10],
  ['★ 三因子 > 旧公式（改进必须是真的）', base > oldRecall],
];
let bad = 0;
out.push('');
out.push('—— 断言 ——');
for (const [m, ok] of checks) { out.push('  ' + (ok ? '✅' : '❌ FAIL') + ' ' + m); if (!ok) bad++; }
if (base < GOAL) out.push('  ℹ recall@4 = ' + (base * 100).toFixed(1) + '%，低于目标线 ' + (GOAL * 100).toFixed(0) + '%');
out.push('  ℹ 旧公式（查询不参与打分）recall@4 = ' + (oldRecall * 100).toFixed(1) + '% → 三因子 ' + (base * 100).toFixed(1) + '%');
console.log(out.join('\n'));
process.exitCode = bad ? 1 : 0;
