// bond-stage-check.js — 「进世界后点人物全都不认识」的回归（v1.77）+ 进度频道
'use strict';
const fs = require('fs'); const path = require('path'); const os = require('os');
const TMP = path.join(os.tmpdir(), 'ws-bond-' + Date.now());
process.env.WORLD_SIM_DATA = TMP; fs.mkdirSync(TMP, { recursive: true });
const IMP = require('../src/import');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
console.log('');
console.log('关系基调 → 认知档位（stage）：1=只见过 2=知道名字 3=熟人');

const mk = (npcs) => IMP.packToData({
  meta: { name: 'X', era: '现代' }, time: '2026-05-21T20:45:00', weather: '晴',
  player: { name: '你', identity: '到访者' }, npcs: npcs,
  places: [{ id: 'p1', name: '屋', tags: ['室内'], edges: [] }], firstScene: '门开了。'
}, { greeting: 0 });
const stageOf = (d, id) => ((d.impressions || {})[id] || {}).stage;

// ① 真 bug 现场：AI 写「邻居」——原来不认识这词 → 全落 stage 1
const d1 = mk([{ id: 'npc1', name: '阿岩', role: '修理工', surface: '闷', bond: '邻居', rel: '住对门', inScene: true }]);
ok(stageOf(d1, 'npc1') === 2, '★★ bond=邻居 → stage 2（原来落 1 =「你还不认识」，用户实测就是它）');

// ② 六词表照常
ok(stageOf(mk([{ id: 'npc1', name: 'A', bond: '恋人', inScene: true }]), 'npc1') === 3, 'bond=恋人 → 3');
ok(stageOf(mk([{ id: 'npc1', name: 'A', bond: '旧识', inScene: true }]), 'npc1') === 3, 'bond=旧识 → 3');
ok(stageOf(mk([{ id: 'npc1', name: 'A', bond: '认识', inScene: true }]), 'npc1') === 2, 'bond=认识 → 2');
ok(stageOf(mk([{ id: 'npc1', name: 'A', bond: '初识', inScene: true }]), 'npc1') === 1, 'bond=初识 → 1（真的只见过一面）');

// ③ 兜底：词不认识但**AI 说了有关系** → 至少算认识（宁松不严）
ok(stageOf(mk([{ id: 'npc1', name: 'A', bond: '养母', inScene: true }]), 'npc1') === 3, 'bond=养母 → 3（同族词兜底）');
ok(stageOf(mk([{ id: 'npc1', name: 'A', bond: '合伙人', inScene: true }]), 'npc1') === 2, 'bond=合伙人 → 2（给了词但不认识 → 至少认识）');
ok(stageOf(mk([{ id: 'npc1', name: 'A', rel: '住对门三年的邻居', inScene: true }]), 'npc1') === 2, '★ 只有 rel、没有 bond → 2（AI 说了有这层关系，不该是陌生人）');
ok(stageOf(mk([{ id: 'npc1', name: 'A', rel: '未定（待补全）', inScene: true }]), 'npc1') === 1, 'rel=未定 → 仍然是 1（不瞎认）');
ok(stageOf(mk([{ id: 'npc1', name: 'A', inScene: true }]), 'npc1') === 1, '什么都没给 → 1');

// ④ schema 有没有把六个词写死（这次的根因就是没写）
const sys = IMP.scanSystem();
const an = IMP.analyzeSystem();
ok(/只能从这六个里选一个/.test(sys), '★★ schema 里写死了六个词（根因：原来只写「<关系基调词>」，AI 随便写）');
ok(/恋人\|亲人\|旧识\|认识\|敌对\|初识/.test(sys), '★ 六个词列全了');
ok(/基调词/.test(an), '★ 分析师那一步也要给基调词');

// ⑤ 进度频道
const sv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
ok(/u\.pathname === '\/api\/progress'/.test(sv), '★ 有 /api/progress');
ok(/function progSet/.test(sv) && /function progChars/.test(sv), '★ 服务端记阶段 + 已收字数');
ok(/第 1\/2 步 · 通读全卡做分析/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'import.js'), 'utf8')), '★ 扫描报出「第 1/2 步」');
ok(/function progStart/.test(ui) && /progStart\('⏳ 正在扫描角色卡/.test(ui), '★ 界面：扫描时弹进度');
ok(/约 ' \+ pr\.pct \+ '%/.test(ui), '★ 显示百分比（标注是"约"，按阶段估的）');
ok(/已写 ' \+ \(pr\.chars \|\| 0\) \+ ' 字/.test(ui), '★ 显示已写字数');
ok(/progStart\('⏳ 正在载入/.test(ui), '★ 载入世界也有进度');
const ai = fs.readFileSync(path.join(__dirname, '..', 'src', 'ai.js'), 'utf8');
ok(/async function llmText\(cfg, messages, mt, onDelta\)/.test(ai), '★ llmText 接了 onDelta（不然拿不到字数）');

console.log('');
console.log('==== bond-stage-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
