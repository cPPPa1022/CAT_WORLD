// news-impact-check.js — 新闻"影响"字段的消费者（v1.97 · X8）
// 设计总稿 §174 要求每条新闻带 {时长, 严重性, 范围}，而代码里 impact 写 6 处、读 0 处。
// 处置：时长 → 新闻的保质期（近况的消费者）；范围 → 门控输入；严重性 → 砍掉（烈度轴已经有主）。
// 这个脚本把"真用起来了"钉死：归一化 / 门控 / 近况 / 外发字段。
'use strict';
const path = require('path'), os = require('os'), fs = require('fs');
const TMP = path.join(os.tmpdir(), 'ws-newsimpact-' + Date.now());
process.env.WORLD_SIM_DATA = TMP; fs.mkdirSync(TMP, { recursive: true });
const ROOT = path.join(__dirname, '..');
process.env.WORLD_SIM_ASSETS = ROOT;
const { buildDemoWorld } = require(ROOT + '/src/world');
const { makeId } = require(ROOT + '/src/store');
const K = require(ROOT + '/src/knowledge');
const G = require(ROOT + '/src/game');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const mk = () => { const d = buildDemoWorld(); if (!d.id) d.id = makeId; d.impressions = {}; return d; };
const row = (id, impact, t, region) => ({ id: id, t: t, title: '标题' + id, summary: '摘要', region: region || '青石镇', severity: '低', tags: [], impact: impact });
const T0 = '1996-06-14T20:00:00';

console.log('');
console.log('新闻影响：时长 → 保质期 / 范围 → 门控 / 严重性 → 砍掉');

// ── ① 归一化（老数据与乱数据都得走进同一条规则） ──
{
  const r = row('a', { 时长: '短期', 范围: '本地' });
  ok(K.newsScope(r) === '本地区', '旧值"本地"归一成"本地区"（老存档不用改）');
  ok(K.newsScope(row('b', undefined)) === '本地区', '没有 impact 的旧新闻 → 默认"本地区"（＝旧行为）');
  ok(K.newsScope(row('c', { 范围: '个人圈' })) === '个人圈' && K.newsScope(row('d', { 范围: '全国' })) === '全国' && K.newsScope(row('e', { 范围: '世界' })) === '世界', '三个规范值原样通过');
  ok(K.newsScope(row('f', { 范围: '随便写的' })) === '本地区', '认不出来的范围 → 退回默认（不炸，也不误放行）');
  ok(K.newsLifeMin(row('g', { 时长: '瞬间' })) === 1440 && K.newsLifeMin(row('h', { 时长: '长期' })) === 129600 && K.newsLifeMin(row('i', { 时长: '乱写的' })) === 10080, '保质期：瞬间 1 天 / 长期 90 天 / 认不出来的按短期 7 天');
}
// ── ② 范围进的是门控（这是"真用"而不是"存着"） ──
{
  const gate = (r) => { const d = mk(); d.news = [r]; d.knowledge.heardNews = []; return K.newsItem(d, r.id); };
  ok(gate(row('n1', { 范围: '个人圈' })).tier === 'secret', '范围=个人圈：没落到你耳朵里就是 secret（别人的私事）');
  ok(gate(row('n2', { 范围: '全国' }, T0, '北京')).tier === 'inferable', '范围=全国：不在你这一带也能听说 → inferable');
  ok(gate(row('n3', { 范围: '世界' }, T0, '国外')).tier === 'inferable', '范围=世界：同上');
  ok(gate(row('n4', { 范围: '本地区' })).tier === 'inferable', '范围=本地区且就在你这一带 → inferable（旧行为不变）');
  ok(gate(row('n5', { 范围: '本地区' }, T0, '省城')).tier === 'secret', '范围=本地区但在别处 → secret');
  const d = mk(); const r6 = row('n6', { 范围: '个人圈' }); d.news = [r6]; d.knowledge.heardNews = ['n6'];
  ok(K.newsItem(d, 'n6').tier === 'known', '听说了就是 known（与范围无关）');
  const demo = mk();
  const t1 = K.newsItem(demo, 'n_1').tier;
  ok(t1 !== 'secret', '演示世界的老新闻不会因为新规则变成 secret（n_1 → ' + t1 + '）');
}
// ── ③ 时长进的是"近况"（第二个消费者） ──
{
  const d = mk();
  d.current.time = T0;
  d.news = [
    row('n_old', { 时长: '瞬间', 范围: '本地区' }, '1996-06-01T08:00:00'),
    row('n_new', { 时长: '瞬间', 范围: '本地区' }, '1996-06-14T12:00:00'),
    row('n_long', { 时长: '长期', 范围: '全国' }, '1996-05-20T08:00:00'),
    row('n_unheard', { 时长: '短期', 范围: '本地区' }, '1996-06-14T18:00:00'),
    row('n_bad', { 时长: '短期', 范围: '本地区' }, '这不是时间')
  ];
  d.knowledge.heardNews = ['n_old', 'n_new', 'n_long', 'n_bad'];
  const cur = K.newsCurrent(d, d.current.time, 5).map(x => x.id);
  ok(cur.indexOf('n_old') < 0, '过了保质期的（瞬间=1 天）不进"近况"');
  ok(cur.indexOf('n_new') >= 0, '没过保质期的照常进"近况"');
  ok(cur.indexOf('n_long') >= 0, '长期新闻 90 天内仍算近况（旧，但还没过去）');
  ok(cur.indexOf('n_unheard') < 0, '没听闻过的不进"近况"');
  ok(cur.indexOf('n_bad') >= 0, '时间坏掉的倾向**显示**（躲起来比多显示更糟）—— 它算出 NaN，不判过期');
  ok(cur[0] === 'n_new', '"近况"是最新优先（原来 slice(0,5) 给的是最早的 5 条）');
  const v = G.buildView(d);
  const items = (v.overview || {})['近况'] || [];
  const keys = Object.keys(items[0] || {}).sort().join(',');
  ok(items.length === 3, '视图的"近况"取到的条数＝过门的条数（3）');
  ok(keys === 'id,t,title', '只外发 UI 要用的三个字段（id/title/t），不再整条新闻外发（X11）：' + keys);
}
// ── ④ 接线：三个字段各自的消费者都在代码里 ──
{
  const gm = fs.readFileSync(ROOT + '/src/game.js', 'utf8');
  const am = fs.readFileSync(ROOT + '/src/ai.js', 'utf8');
  const km = fs.readFileSync(ROOT + '/src/knowledge.js', 'utf8');
  ok(/近况: K\.newsCurrent\(/.test(gm), '世界概况的"近况"走 newsCurrent');
  ok(!/近况: news\.slice/.test(gm), '旧的 近况: news.slice(0,5) 已经不在了');
  ok(/K\.newsCurrent\(data/.test(am), '主 AI 资料包的"世界近况"也走 newsCurrent');
  ok(/RT\.candidatesLive\(data\)\.length/.test(am), '顺带：thinkBudget 的候选计数走 candidatesLive');
  ok(/const scope = newsScope\(n\)/.test(km), '门控真的读了"范围"');
  ok(/严重性 → \*\*砍掉\*\*/.test(km), '第三轴（严重性）在代码里被显式交代：砍掉，不留第二个真相源');
}
console.log('');
console.log('==== news-impact-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
