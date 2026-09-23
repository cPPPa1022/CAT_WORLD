// admit-event-check.js — 引擎自产事件的裁决门（v1.99 · P0-5 第 2 步）
// 病：validateUpdates 只挡 AI 的 Update，而引擎自己往 news/calendar/候选池里塞的东西**从不经过任何门** ——
//     "世界里最大的事"反而是最没人管的那些。于是：烈度可以绕过（引擎写多重要就多重要）、
//     L3+ 可以凭空发生（没有前兆也照样落库）、重大事件可以扎堆。
// 修：唯一裁决函数 GATE.admitEvent —— 归一化+枚举 → 比上限 → L3+ 必须有前兆 → 提议类看节奏门；
//     被拒的**留痕**（计数 + 生成清单），不是静默消失。
'use strict';
const path = require('path'), os = require('os'), fs = require('fs');
const TMP = path.join(os.tmpdir(), 'ws-admit-' + Date.now());
process.env.WORLD_SIM_DATA = TMP; fs.mkdirSync(TMP, { recursive: true });
const ROOT = path.join(__dirname, '..');
process.env.WORLD_SIM_ASSETS = ROOT;
const { buildDemoWorld } = require(ROOT + '/src/world');
const { makeId, ledgerPush } = require(ROOT + '/src/store');
const GATE = require(ROOT + '/src/gate');
const EPOCH = require(ROOT + '/src/epoch');
const RT = require(ROOT + '/src/runtime');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const mk = (meta) => { const d = buildDemoWorld(); if (!d.id) d.id = makeId; d.impressions = {}; Object.assign(d.meta, meta || {}); return d; };
const T = '1996-06-14T20:00:00';

console.log('');
console.log('事件门：上限 / 前兆 / 节奏 / 留痕 / 引擎自产也走同一道');

// ── ① 归一化与枚举 ──
{
  const d = mk();
  ok(GATE.admitEvent(d, { level: 'L1' }, T).ok, 'L1 ≤ 上限 L2 → 放行');
  ok(!GATE.admitEvent(d, { level: 'L3' }, T).ok, 'L3 > 上限 L2 → 拒（且理由说上限）');
  ok(!GATE.admitEvent(d, { level: 'L5' }, T).ok, 'L5（禁止级）→ 拒');
  ok(!GATE.admitEvent(d, { level: 'L9' }, T).ok, 'L9 → 拒');
  const a1 = GATE.admitEvent(mk({ maxSeverity: 'L4' }), { newsSeverity: '高', foreshadowRef: '' }, T);
  ok(!a1.ok && /前兆/.test(a1.why), '★ 只给"严重性=高"（上屏那根轴）→ 按桥换算成 L3 → 没前兆就拒：' + JSON.stringify(a1.why));
  const a1b = GATE.admitEvent(d, { newsSeverity: '高' }, T);
  ok(!a1b.ok, '上限 L2 的世界里，"高"（=L3）也被拦（两轴各自的规则都成立）');
  const a2 = GATE.admitEvent(d, { kind: '事件开始' }, T);
  ok(a2.ok && a2.level === 'L2', '什么都不给 → 按类型缺省（事件类 L2）：' + a2.level);
  ok(GATE.admitEvent(d, { newsSeverity: '低' }, T).newsSeverity === '低', '合法严重性原样返回（上屏用）');
  ok(GATE.admitEvent(mk({ maxSeverity: 'L4' }), { level: 'L4', kind: '事件开始', foreshadowRef: 'x' }, T).ok === false, '上限 L4 时 L4 仍需前兆 —— 先被前兆规则拦住');
}
// ── ② 前兆硬规则：必须"指得到" ──
{
  const d = mk({ maxSeverity: 'L4' });
  ok(!GATE.admitEvent(d, { level: 'L3', foreshadowRef: '根本不存在' }, T).ok, '前兆引用指不到 → 拒');
  ok(!GATE.admitEvent(d, { level: 'L3' }, T).ok, '★ 压根不给前兆 → 拒（凭空发生的重大事件不许落库）');
  d.news.push({ id: 'nw_pre', t: T, title: '有人说镇东的井要出事', summary: '', severity: '低' });
  ok(GATE.admitEvent(d, { level: 'L3', foreshadowRef: 'nw_pre' }, T).ok, '★ 前兆指向一条已存在的新闻 → 放行');
  d.calendar = [{ id: 'evt_1', at: T, title: '井台塌了', done: false }];
  ok(GATE.admitEvent(d, { level: 'L3', foreshadowRef: 'evt_1' }, T).ok, '前兆指向世界日程里的一条 → 放行');
  const d2 = mk({ maxSeverity: 'L4' });
  ledgerPush(d2, { t: T, type: '人事', target: '沈姨', desc: '沈姨『老态』走路慢了' });
  ok(GATE.admitEvent(d2, { level: 'L3', foreshadowRef: '人事:沈姨' }, T).ok, '★ 前兆 = 同一人物更早的一环人事（人物链的常态）');
  ok(!GATE.admitEvent(d2, { level: 'L3', foreshadowRef: '人事:查无此人' }, T).ok, '同一人物没有更早的一环 → 不算前兆');
  ok(GATE.admitEvent(d2, { level: 'L2' }, T).ok, '对照组：L2 不需要前兆');
}
// ── ③ 节奏门：提议类看冷却，已排定的不看 ──
{
  const d = mk({ maxSeverity: 'L4', gateDays: 7 });
  d.news.push({ id: 'pre1', t: T, title: '风声', summary: '', severity: '低' });
  const r1 = GATE.admitEvent(d, { source: 'news', level: 'L3', foreshadowRef: 'pre1', at: '2000-01-01T08:00:00' }, T);
  ok(r1.ok, '第一次重大事件（提议类）→ 放行');
  GATE.noteAdmitted(d, r1, '2000-01-01T08:00:00');
  const r2 = GATE.admitEvent(d, { source: 'news', level: 'L3', foreshadowRef: 'pre1', at: '2000-01-03T08:00:00' }, T);
  ok(!r2.ok && /节奏门/.test(r2.why), '★ 隔 2 天再来一条 L3 → 被节奏门拦住：' + JSON.stringify(r2.why));
  const r3 = GATE.admitEvent(d, { source: 'news', level: 'L3', foreshadowRef: 'pre1', at: '2000-01-09T08:00:00' }, T);
  ok(r3.ok, '过了 7 世界日 → 放行');
  const r4 = GATE.admitEvent(d, { source: 'chain', level: 'L3', foreshadowRef: 'pre1', at: '2000-01-04T08:00:00' }, T);
  ok(r4.ok, '★ 已排定的来源（人物链/年度演算）不看冷却 —— 节奏由世界时间给（再抽签会让该来的不来）');
  const r5 = GATE.admitEvent(d, { source: 'news', level: 'L2', at: '2000-01-04T08:00:00' }, T);
  ok(r5.ok, 'L1/L2 完全不受节奏门影响');
}
// ── ④ 被拒要留痕：计数 + 生成清单，且**不进账本** ──
{
  const d = mk();
  const led0 = d.ledger.length;
  const bad = GATE.admitEvent(d, { source: 'news', level: 'L3' }, T);
  GATE.noteRejected(d, bad, { what: '某条传闻' });
  const g = GATE.gateView(d);
  ok(g.rejected === 1 && g.rejects.length === 1, '★ 拦下来的事件有计数与最近样本：' + JSON.stringify(g.rejects[0].why));
  ok(d.ledger.length === led0, '★ "没发生的事"不进账本（账本是世界里发生过什么）');
  const mf = require(ROOT + '/src/manifest').view(d);
  ok(mf && mf.n >= 1, '生成清单里留了一条（可查是被门拦的）：' + JSON.stringify((mf && mf.counts) || {}));
}
// ── ⑤ 引擎自产也走同一道门（源码级：每条写入路径都得先问过它） ──
{
  const epoch = fs.readFileSync(ROOT + '/src/epoch.js', 'utf8');
  const dir = fs.readFileSync(ROOT + '/src/director.js', 'utf8');
  const game = fs.readFileSync(ROOT + '/src/game.js', 'utf8');
  const rt = fs.readFileSync(ROOT + '/src/runtime.js', 'utf8');
  /* v2.03 · P0-6 收尾：**落库**已经全部收进总线，所以这里查的从"各写入点自己调 admitEvent"
     改成"各写入点通过总线落库"（裁决点唯一在 bus.js 里）。 */
  const busSrc = fs.readFileSync(ROOT + '/src/bus.js', 'utf8');
  const newsCand = (t) => (t.match(/BUS\.commit\(data, \[\{ kind: '(news|candidate)'/g) || []).length;
  ok(newsCand(epoch) >= 4, '人物链 / 年度演算（新闻 + 伏笔 + 候选）都走总线：' + newsCand(epoch) + ' 处');
  ok(newsCand(dir) >= 2, '导演的传闻与城市传闻都走总线：' + newsCand(dir) + ' 处');
  ok(newsCand(game) >= 2, '★ 副 AI-编辑的新闻稿与教程候选都走总线：' + newsCand(game) + ' 处');
  ok(newsCand(rt) >= 2, '两条环境/意外候选也走总线（口径一致）：' + newsCand(rt) + ' 处');
  ok(/GATE\.admitEvent\(/.test(busSrc) && /gate_rejected/.test(busSrc), '★ 裁决点在总线里（bus 调 admitEvent，被拒 → gate_rejected）');
  ok(!/severity: '低' \}\}\);\s*$/.test(epoch), '年度新闻的严重性用门给的值，不是写死的"低"');
  ok(/GATE\.noteRejected\(/.test(busSrc), '★ 被拒的事件由总线统一留痕（计数 + 生成清单，不是静默消失）');
  const noDirect = ['src/epoch.js', 'src/director.js', 'src/game.js', 'src/runtime.js'].filter(f => /data\.news\.push\(|pendingCandidates\.push\(/.test(fs.readFileSync(ROOT + '/' + f, 'utf8')));
  ok(noDirect.length === 0, '★★ 四个写入点里**没有**直接写 news/候选池的（落库只有总线一条路）：' + JSON.stringify(noDirect));
  ok(/gate: \(function \(\) \{ try \{ return require\('\.\/gate'\)\.gateView\(data\)/.test(game), '开发者视图里能看到门的现状（0 token）');
  const ai = fs.readFileSync(ROOT + '/src/subai.js', 'utf8');
  ok(/必须此前有过风声\/前兆/.test(ai), '新闻生成器的提示词写明了"高/灾难必须有前兆"');
}
// ── ⑥ 端到端：人物链的离世（有余地放行 / 上限压死时拒绝且人还活着） ──
{
  const d = mk({ maxSeverity: 'L4' });
  d.knowledge.knownPeople = ['npc_1'];
  const p = d.entities.npc_1;
  p.birthYear = 1996 - 80;
  d.current.time = '1996-06-02T09:00:00';
  const out = EPOCH.pagePersonLifecycle(d, d.current.time);
  ok(p.state.alive === false, '★ 80 岁的人走到了链的尽头（离世落库）');
  const deathNews = (d.news || []).filter(n => /与世长辞|离世/.test(String(n.title)));
  ok(deathNews.length >= 1, '离世的新闻落库了');
  ok(deathNews.every(n => ['低', '中', '高', '灾难'].indexOf(String(n.severity)) >= 0), '★ 落库的严重性一定在合法取值里：' + JSON.stringify(deathNews.map(n => n.severity)));
  const expDay = String(p.birthYear + 76) + '-06-01';   // 链上"离世"那一环发生的年份
  ok((d.current.gate || {}).lastL3Day === expDay, '★ 重大事件落库后记下了"最近一次 L3 是哪天"（' + expDay + '，实测 ' + JSON.stringify((d.current.gate || {}).lastL3Day) + '）');
  const stageLedgers = (d.ledger || []).filter(l => l.type === '人事');
  ok(stageLedgers.length >= 3, '前兆链的每一环都在账本里（老态/体弱/交代）：' + stageLedgers.length + ' 条');

  const d2 = mk({ maxSeverity: 'L1' });
  d2.knowledge.knownPeople = ['npc_1'];
  const p2 = d2.entities.npc_1;
  p2.birthYear = 1996 - 80;
  d2.current.time = '1996-06-02T09:00:00';
  EPOCH.pagePersonLifecycle(d2, d2.current.time);
  ok(p2.state.alive !== false, '★ 世界上限 L1 时，离世被拦下 —— **人还活着**（状态没有半改）');
  ok(GATE.gateView(d2).rejected >= 1, '拦下来有计数：' + GATE.gateView(d2).rejected);
  ok((d2.news || []).filter(n => /与世长辞/.test(String(n.title))).length === 0, '被拦的离世没有新闻（不是"新闻发了但人没死"的中间态）');
}
console.log('');
console.log('==== admit-event-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
