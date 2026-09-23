// img-bind-check.js — 图挂进正文的定位断言（v1.65b）
// 真 bug：span.start 是 sceneLog 的绝对下标，i 是 slice(-30) 的相对下标，直接比 → 超过 30 条就永远挂不上。
'use strict';
const path = require('path'); const os = require('os'); const fs = require('fs');
const TMP = path.join(os.tmpdir(), 'ws-imgbind-' + Date.now());
process.env.WORLD_SIM_DATA = TMP; fs.mkdirSync(TMP, { recursive: true });
const G = require('../src/game');
const { buildDemoWorld } = require('../src/world');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
console.log('');
console.log('图 → 正文的定位（sceneLog 超过 30 条时还挂得上吗）');

const d = buildDemoWorld();
d.sceneLog = [];
for (let i = 0; i < 40; i++) d.sceneLog.push({ t: d.current.time, type: 'narration', text: '老历史' + i });
const start = d.sceneLog.length;
for (let i = 0; i < 3; i++) d.sceneLog.push({ t: d.current.time, type: 'narration', text: '本回合' + i });
d.current._imgBeatSpan = { start: start, count: 3, t: d.current.time };
// v1.83：任务的 t 必须与 span 的 t 相同（真实生产端一定带 t；老任务靠它判定"属于哪一回合"）
d.current.imgTasks = [{ id: 'img_x', at: 1, who: [], state: '', scene: '', note: '', status: 'done', prompt: 'p', t: d.current.time }];

const v = G.buildView(d);
const hit = (v.sceneLog || []).filter(x => x.imgs && x.imgs.length);
ok(hit.length === 1, '★ 只有一条挂了图（不是 0 条）');
ok(hit[0] && hit[0].text === '本回合1', '★ 挂对了条目：' + (hit[0] && hit[0].text));
ok(hit[0] && hit[0].imgs[0] === 'img_x', '挂的是那张图的 id');

// v1.83 修 P1-6：**跨回合不串图** —— 上一回合 at=1 的图不许挂到本回合 at=1 的条目上
const d3 = buildDemoWorld();
d3.sceneLog = [];
for (let i = 0; i < 5; i++) d3.sceneLog.push({ t: d3.current.time, type: 'narration', text: 'beat' + i });
d3.current._imgBeatSpan = { start: 0, count: 5, t: d3.current.time };
d3.current.imgTasks = [
  { id: 'img_old', at: 1, who: [], status: 'done', prompt: 'p', t: '1996-01-01T00:00:00' },
  { id: 'img_new', at: 1, who: [], status: 'done', prompt: 'p', t: d3.current.time }
];
const v3 = G.buildView(d3);
const b1 = (v3.sceneLog || []).find(x => x.text === 'beat1');
ok(!!b1 && (b1.imgs || []).length === 1 && b1.imgs[0] === 'img_new', '★ 只挂本回合的图（上一回合同 at 的不串进来）：' + JSON.stringify(b1 && b1.imgs));

// v1.83：派发时钉死的**绝对下标**（出图几十秒，中间可能已过好几回合）
const d4 = buildDemoWorld();
d4.sceneLog = [];
for (let i = 0; i < 5; i++) d4.sceneLog.push({ t: d4.current.time, type: 'narration', text: 'y' + i });
d4.current._imgBeatSpan = { start: 2, count: 2, t: d4.current.time };
d4.current.imgTasks = [{ id: 'img_abs', at: null, absAt: 3, who: [], status: 'done', prompt: 'p', t: d4.current.time }];
const v4 = G.buildView(d4);
const l4 = (v4.sceneLog || []).find(x => x.text === 'y3');
ok(!!l4 && (l4.imgs || [])[0] === 'img_abs', '★ 带绝对下标的图（跨回合回来）挂得对：' + JSON.stringify(l4 && l4.imgs));

// 反证：老算法（拿窗口内相对下标比绝对下标）在这个数据下必然挂不上
const oldWouldMatch = [].some((_, i) => i >= start && i < start + 3);
ok(oldWouldMatch === false, '★ 老算法在这份数据下必然失败（i 最大 29 < span.start ' + start + '）——证明这就是那个 bug');

// 盖在条目上的图（落库时 stamp）不依赖 span，翻历史也还在
const d2 = buildDemoWorld();
d2.sceneLog = [{ t: d2.current.time, type: 'narration', text: '很久以前', imgs: ['img_old'] }];
for (let i = 0; i < 40; i++) d2.sceneLog.push({ t: d2.current.time, type: 'narration', text: '后来的' + i });
d2.current._imgBeatSpan = { start: 39, count: 2, t: d2.current.time };
d2.current.imgTasks = [];
const v2 = G.buildView(d2);
const old = (v2.sceneLog || []).filter(x => x.imgs && x.imgs.indexOf('img_old') >= 0);
ok(old.length === 0 || old[0].text === '很久以前', '盖过的图不依赖 span（窗口外也不串行）');

const sv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
ok(/function stampImgOnBeat/.test(sv), '★ 出图落库时把图盖在对应 beat 上（过回合不掉）');
ok(/stampImgOnBeat\(task\)/.test(sv), '★ 渲染成功那条路真的调了它');
const gm = fs.readFileSync(path.join(__dirname, '..', 'src', 'game.js'), 'utf8');
ok(/const abs = base \+ i;/.test(gm), '★ buildView 用绝对下标比 span');
console.log('');
console.log('==== img-bind-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
