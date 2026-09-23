// opening-check.js — 开局编译的离线断言（v3.1）
// 不联网：只验「翻译层 + 校验 + 落账」这几段，提示词与真模型留给实跑。
// 用法：node scripts/opening-check.js
'use strict';
const fs = require('fs'); const path = require('path'); const os = require('os');
const TMP = path.join(os.tmpdir(), 'ws-opening-' + Date.now());
process.env.WORLD_SIM_DATA = TMP; fs.mkdirSync(TMP, { recursive: true });
const IMP = require('../src/import');
const OPEN = require('../src/opening');
const FW = require('../src/framework');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };

function mk() {
  return IMP.packToData({
    meta: { name: '青石镇', era: '九十年代 · 小镇', carries: { time: 'brick', news: 'paper', map: 'paper', note: 'letter' } },
    time: '1996-06-14T20:45:00', weather: '小雨',
    player: { name: '小游', identity: '', age: '27', origin: '镇上的租客' },
    npcs: [
      { id: 'npc1', name: '沈姨', role: '杂货铺老板娘', bond: '邻居', rel: '房东兼邻居', inScene: true },
      { id: 'npc2', name: '阿岩', role: '修理工', bond: '认识', inScene: true }
    ],
    places: [{ id: 'p1', name: '转角杂货铺', tags: ['室内'], edges: [] }],
    firstScene: '雨还在下。'
  }, { greeting: 0 });
}

console.log('');
console.log('开局编译：翻译层 / 校验 / 落账');

/* ① 合法输出 → 设定补全（含关系） */
const d1 = mk();
const u1 = OPEN.toUpdates({
  player: { fields: { 身份: '靠修收音机糊口的镇上租客' }, relations: [{ with: 'npc1', tone: '房东兼邻居', how: '住了两年' }] },
  npcs: [{ id: 'npc1', fields: { 职业: '杂货铺老板娘' }, relations: [{ with: 'npc2', tone: '老邻居' }] }]
}, d1);
ok(u1.length === 2, '合法输出 → 2 条 Update（玩家 1 + NPC 1），实得 ' + u1.length);
ok(u1[0].type === '设定补全' && u1[0].target === 'player', '玩家的那一条 target=player');
ok(Array.isArray(u1[0].relations) && u1[0].relations.length === 1 && u1[0].relations[0].with === 'npc1', '玩家周边关系带上了 npc1');

/* ② 名单外的人 → 丢 */
const u2 = OPEN.toUpdates({ npcs: [{ id: 'npc9', fields: { 职业: '不存在的人' } }], player: { relations: [{ with: 'npc8', tone: '朋友' }] } }, mk());
ok(u2.every(x => (x.relations || []).every(r => r.with !== 'npc8')), '关系指向不存在的人 → 丢');
ok(u2.every(x => x.target !== 'npc9'), 'NPC 名单外的人 → 丢');

/* ③ 只补空字段：已有的一字不改 */
const d3 = mk();
const before = JSON.stringify(d3.entities.player.profile);
OPEN.compile && null;
const G = require('../src/game');
const applied = G.applyUpdates(d3, [{ type: '设定补全', target: 'player', fields: { 身份: '新身份', 性格: '闷，但心细' }, why: '开局编译' }], d3.current.time);
ok(applied >= 1, '设定补全执行器能落库（applied=' + applied + '）');
const p3 = d3.entities.player.profile || {};
ok(String((p3.surface || {}).待人 || '') === '闷，但心细', '空槽位被补上（性格→待人）');
ok(String((p3.identity || {}).身份 || '') === '新身份', '**占位废话被覆盖**（原来的"一位来到此处落脚的旅客…"）');
ok((d3.ledger || []).some(l => l.type === '设定补全'), '设定补全落账（可追溯）');

/* ④ 占位串与未知槽位 → 拒 */
const d4 = mk();
const r4 = G.applyUpdates(d4, [{ type: '设定补全', target: 'player', fields: { 身份: '待发现', 职业: '未知', 乱写的键: '值' }, why: '开局编译' }], d4.current.time);
const p4 = d4.entities.player.profile || {};
ok(String((p4.identity || {}).身份 || '') === '', '占位串「待发现」被拒（槽位仍是空的）');
ok(JSON.stringify(p4).indexOf('乱写的键') < 0, '白名单外的槽位被拒');

/* ⑤ 兜底：关系存在 → 你认识这个人（人物面板不该再说"还没记住脸"） */
const d5 = mk();
const fb = OPEN.fallback(d5);
ok(fb.length >= 1, '兜底能从已有关系推出"认识谁"（' + fb.length + ' 条）');
G.applyUpdates(d5, fb, d5.current.time);
const imp = (d5.impressions || {}).npc1 || {};
ok((imp.stage || 0) >= 2, '兜底后 npc1 的印象档 >= 2（知道名字），实得 ' + (imp.stage || 0));

/* ⑥ 通信条件（v3.2）：座机进通讯录 / none 不进 / 非法 kind 被拒 / 名单外的人不造 */
const d7 = mk();
G.applyUpdates(d7, [{ type: '设定补全', target: 'player', contacts: [
  { id: 'npc1', kind: 'landline', label: '铺子柜台那台' },
  { id: 'npc2', kind: 'none' },
  { id: 'npc1', kind: 'telegram' },
  { id: 'npc9', kind: 'mobile' }
] }], d7.current.time);
ok(String(((d7.entities.npc1 || {}).contact || {}).kind || '') === 'landline', '座机写进了实体（世界事实）');
ok((d7.knowledge.phoneContacts || []).indexOf('npc1') >= 0, '座机进了通讯录（玩家认知）');
ok((d7.knowledge.phoneContacts || []).indexOf('npc2') < 0, 'none（联系不上）不进通讯录');
ok(String(((d7.entities.npc2 || {}).contact || {}).kind || '') === 'none', 'none 是合法值，能被写下来');
ok(String(((d7.entities.npc1 || {}).contact || {}).label || '') === '铺子柜台那台', '标签保留（铺子柜台那台）');
ok(!d7.entities.npc9, '名单外的人没有被凭空造出来');

/* ⑦ 开局编译的框架提案（v2.08：没有档位了，能力永远全开）
   守两件事：① 开局编译能长东西；② **引擎不再偷改权限**（原来它会 setLevel 两次，还记 by:'player'）。 */
const d6 = mk();
const low = FW.applyProposal(d6, { slot: 'rule', name: '灵力五等', form: 'enum', items: ['一', '二'], why: '开局编译' });
ok(low && low.ok === true, '开局编译可以长律（无档位，永远允许）');
const bogus = FW.applyProposal(d6, { slot: 'rule', name: '速度', form: 'x3', why: '开局编译' });
ok(bogus && bogus.ok === false, '★ 但"算盘"照样被拒（律只允许 enum/bool/range）');
ok(!('setLevel' in FW) && !('level' in FW), '★ 框架不再导出 setLevel/level —— 权限日志不会再出现假的 by:player');

/* ⑧ ★ compile() 自己的成败判定（v2.08 新增）
   这条断言本该早就有。原 bug：`applied` 读的是 BUS.commit 返回里**不存在**的顶层字段，
   于是恒为 0，**每一次开局编译都被记成 fallback**，而功能其实是好的（存档里 framework.log
   有 by:'ai' 的律，同一份存档却写 openingHow=fallback）—— 一个假的失败信号。
   为什么以前没抓到：这份脚本验的全是"翻译层 / 校验 / 落账"这些**机械部分**，
   **从没验过 compile() 自己的成败判定**；而 compile 要调 AI，于是被留给了"实跑"。
   解法：给 AI.llmJSON 打桩 —— 不联网、0 token，也能把这条链验完。 */
(async () => {
  const AI = require('../src/ai');
  const realJSON = AI.llmJSON;
  const cfg = { llm: { baseURL: 'http://stub', apiKey: 'k', model: 'm', maxTokens: 4096 } };  // isLive 要求三者非空

  // ① AI 正常返回 + 槽位是空的 → 必须记 'ai'
  const dA = mk();
  dA.entities.player.profile.identity = {};
  AI.llmJSON = async () => ({ player: { fields: { 身份: '供销社会计' } } });
  const rA = await OPEN.compile(dA, cfg);
  ok(dA.meta.openingHow === 'ai', '★ AI 落了库 → openingHow 必须是 "ai"，不许是 "fallback"（实得 ' + dA.meta.openingHow + '）');
  ok(rA.applied >= 1, 'compile 报告的 applied ≥ 1（实得 ' + rA.applied + '）');

  // ② AI 提案全部命中"已有内容" → 记 'noop'（无事可做），不是失败
  const dB = mk();
  dB.entities.player.profile.identity = { 身份: '镇上的会计' };
  AI.llmJSON = async () => ({ player: { fields: { 身份: '另一种写法' } } });
  await OPEN.compile(dB, cfg);
  ok(dB.meta.openingHow === 'noop', '★ 无事可做 → "noop"，不是 "fallback"（实得 ' + dB.meta.openingHow + '）');

  // ③ AI 形状认不出（toUpdates 产空）→ 才是真失败，且要说清原因
  const dC = mk();
  AI.llmJSON = async () => ({ 完全不是那个形状: 1 });
  await OPEN.compile(dC, cfg);
  ok(dC.meta.openingHow === 'fallback' && /形状认不出/.test(String(dC.meta.openingNote || '')),
    '★ 形状认不出 → "fallback" 且写明原因（实得 ' + dC.meta.openingHow + ' / ' + String(dC.meta.openingNote || '').slice(0, 24) + '）');

  AI.llmJSON = realJSON;
  console.log('');
  console.log('==== ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})();
