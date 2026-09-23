// worldbook-check.js — 世界书分拣与归档的离线断言（v2.07）
// 验的是「AI 只判断、代码搬运」这条分工：去向表 → 书架条目 → 世界数据。
// 不联网：扫描那一步（AI）留着实跑，这里验它前后的机械部分。
'use strict';
const fs = require('fs'); const path = require('path'); const os = require('os');
const TMP = path.join(os.tmpdir(), 'ws-wb-' + Date.now());
process.env.WORLD_SIM_DATA = TMP; fs.mkdirSync(TMP, { recursive: true });
const IMP = require('../src/import');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };

const card = { name: '测试卡', character_book: { entries: [
  { keys: ['人物', '温若兰'], comment: '主角', content: '温若兰，三十出头，左手一颗痣。' },
  { keys: ['地点'], comment: '住处', content: '临江小区 3 号楼，六层，阳台朝南。' },
  { keys: ['状态栏'], comment: '机制', content: '每回合输出：好感度/体力/时间' },
  { keys: ['变量初始化'], comment: '', content: 'initvar 好感度=0' },
  { keys: [], comment: '空条目', content: '   ' }
] } };
console.log('');
console.log('世界书分拣：去向表 → 书架（AI 判断 / 代码搬运）');

/* ① 去向表：归档 / 翻译 / 丢弃 */
const routed = IMP.routeCharacterBook(card, [
  { no: 1, route: '翻译', why: '人物定义，要进 npcs 同时留原文' },
  { no: 3, route: '丢弃', why: '状态栏是跑卡机制，不是世界设定' },
  { no: 4, route: '丢弃', why: '变量初始化，同上' }
]);
ok(!!routed, '有世界书的卡 → 产出 character_book');
ok(routed.entries.length === 2, '留下 2 条（条目1 翻译 + 条目2 没给去向→默认归档），实得 ' + routed.entries.length);
ok(routed.dropped.length === 2, '丢弃 2 条并记下理由，实得 ' + routed.dropped.length);
ok(routed.entries[0].content === '温若兰，三十出头，左手一颗痣。', '**原文一字不改**（代码照抄，不经过 AI 的手）');
ok(routed.entries[0].route === '翻译' && routed.entries[0].why.length > 0, '翻译条目带上了去向与理由');
ok(routed.entries[1].route === '归档', '★ 没有去向的条目 → **默认归档**（判断不了就留着）');

/* ② 非法去向 → 也按归档（不按丢弃） */
const r2 = IMP.routeCharacterBook(card, [{ no: 2, route: '随便写的', why: '' }]);
ok(r2.entries.some(e => e.content.indexOf('临江小区') >= 0), '非法 route 的条目 → 默认归档（不会因为一个坏值就丢掉内容）');

/* ③ 空 content / 没有世界书 */
ok(!routed.entries.some(e => !String(e.content).trim()), '空条目不会被收进书架');
ok(IMP.routeCharacterBook({ name: 'x' }, []) === null, '没有世界书的卡 → 返回 null（不造假书架）');

/* ④ 落进世界数据：worldinfo + 丢弃留痕 */
const pack = { meta: { name: 'X', era: '现代都市' }, time: '2026-05-21T20:45:00', weather: '晴',
  player: { name: '你' }, npcs: [{ id: 'npc1', name: '温若兰', inScene: true }], places: [{ id: 'p1', name: '屋' }],
  firstScene: '门开着。', character_book: routed };
const d = IMP.packToData(pack, { greeting: 0 });
const ks = Object.keys(d.worldinfo || {});
ok(ks.length === 2, '书架里 2 条，实得 ' + ks.length);
ok(String((d.worldinfo[ks[0]] || {}).content || '') === '温若兰，三十出头，左手一颗痣。', '书架里的正文还是原文');
ok(Array.isArray((d.worldinfo[ks[0]] || {}).keys) && d.worldinfo[ks[0]].keys.length === 2, '关键词（keys）保留 —— 门控靠它');
ok((d.meta.worldbookDropped || []).length === 2, '丢弃的 2 条记在 meta.worldbookDropped 里（观察用，不静默）');
ok(!ks.some(k => String(d.worldinfo[k].content).indexOf('好感度') >= 0), '机制类条目没有混进书架');

console.log('');
console.log('==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
