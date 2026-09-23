// ledger-immutable-check.js — 账本不可改写 + 勘误事件（v1.98 · P0-3）
// 病：mergeDupPersons 里有一段"回头把已落账的 ledger 逐条改写"的代码，而账本的宪法是
// **只追加、永不修改**。更糟的是它只改外壳（target/owner/ref），不碰 d 载荷 ——
// 而 replay.js 读的正是 d.owner / d.npc ⇒ 每次打开存档都判"账本≠内存"，
// 然后按账本把记忆判回一个**已经被删掉的 id**。
// 现在：历史不改，只追加一条"实体合并"勘误；谁需要"旧 id 现在是谁"，读勘误。
'use strict';
const path = require('path'), os = require('os'), fs = require('fs');
const TMP = path.join(os.tmpdir(), 'ws-ledger-' + Date.now());
process.env.WORLD_SIM_DATA = TMP; fs.mkdirSync(TMP, { recursive: true });
const ROOT = path.join(__dirname, '..');
process.env.WORLD_SIM_ASSETS = ROOT;
const { buildDemoWorld } = require(ROOT + '/src/world');
const { makeId } = require(ROOT + '/src/store');
const G = require(ROOT + '/src/game');
const RP = require(ROOT + '/src/replay');
const TH = require(ROOT + '/src/threads');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const mk = () => { const d = buildDemoWorld(); if (!d.id) d.id = makeId; d.impressions = {}; return d; };
/* 只留代码：注释里提到旧写法/旧占位串是**应该的**（那是在记录这个 bug），不该被判违规 */
const stripComments = (t) => String(t).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
const twin = (d, id, name, app) => {
  d.entities[id] = { id: id, type: 'person', name: name, tags: [], indexes: { geo: ['青石镇'], org: [], family: [] },
    profile: { identity: { 姓名: name }, appearance: { 标志物: app }, surface: { 待人: '闷' }, hidden: { 真实: '有旧账' }, desires: { 现在想: '试探你' }, schedule: {} },
    locked: { core: '性格内核：闷' }, state: { location: 'pl_4', mood: '平静' } };
  d.impressions[id] = { stage: 2, seen: app, traits: [], notes: [], bonds: [], nameKnown: name };
  return d.entities[id];
};

console.log('');
console.log('账本：只追加 / 勘误可读 / 悬空 id 不再产生');

// ── ① 真合并一次：老账目逐字节不变，多出来的是一条勘误 ──
{
  const d = mk();
  twin(d, 'npc_a', '周师傅', '左手小指少半截，腰间挂一串钥匙');
  twin(d, 'npc_b', '老周', '左手小指少半截，腰间挂一串钥匙');   // 同一个人：标志物完全相同
  d.memories['mem_a'] = { id: 'mem_a', owner: 'npc_b', content: '你在巷口见过他一次', tags: ['见面'], impact: 50, weight: 50, t: d.current.time, lastActivation: d.current.time, activations: 1, repeat: false };
  d.relations.player.npc_b = { tone: '点头之交', causes: [] };
  // 造一条"提到这个人"的历史账（合并前就落账的）
  const before = JSON.parse(JSON.stringify(d.ledger));
  const n = G.mergeDupPersons(d);
  ok(n === 1, '合并发生了（n=' + n + '）');
  const after = d.ledger.slice(0, before.length);
  ok(JSON.stringify(after) === JSON.stringify(before), '★★ 合并前的账目**逐字节未变**（原来这里会被逐条改写 target/owner/ref）');
  ok(d.ledger.length === before.length + 1, '只多了一条（追加，不是替换）');
  const err = d.ledger[d.ledger.length - 1];
  ok(err.type === '实体合并', '多出来的是勘误：type=' + JSON.stringify(err.type));
  ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(err.t || '')), '勘误带合法世界时间（不是空串坏账）：' + JSON.stringify(err.t));
  ok(err.target === 'npc_a' && d.entities.npc_a, '勘误指向"当前解释"（合并后留下的那个人）');
  ok(err.d && err.d.kept === 'npc_a' && err.d.merged === 'npc_b', 'd.kept / d.merged 齐备（重定向表的数据来源）');
  ok(!d.entities.npc_b, '被合并的那位已经不在了');
  ok(!!err.id && /^ledg/.test(String(err.id)), '勘误带 id（走的是唯一写入入口，不是自己造的）');
  ok(!err.ref, '勘误不占用 ref（doc-fx-check 断言 ref 只指向文书）');
  ok(/标志物|姓名/.test(String(err.cause || '')), '勘误写明依据：' + JSON.stringify(err.cause));
}
// ── ② 对账链：勘误让 replay 认得出旧 id（这是"不改写"的另一半，缺了就每开一次档报一次警） ──
{
  const d = mk();
  twin(d, 'npc_a', '周师傅', '标志物甲');
  twin(d, 'npc_b', '老周', '标志物甲');
  d.memories['mem_a'] = { id: 'mem_a', owner: 'npc_b', content: '巷口见过一次', tags: ['见面'], impact: 50, weight: 50, t: d.current.time, lastActivation: d.current.time, activations: 1, repeat: false };
  G.mergeDupPersons(d);
  ok(d.memories.mem_a.owner === 'npc_a', '内存里的记忆归属被并到留下的人身上');
  const c = RP.check(d);
  ok(c.ok === true, '★★ 对账通过（replay 认得勘误 → 不会每次打开存档都判不一致）：' + JSON.stringify(c.diff));
  const ghosts = Object.keys(d.memories).filter(k => !d.entities[d.memories[k].owner]);
  ok(ghosts.length === 0, '★ 记忆归属没有指向不存在的实体（幽灵 id）：' + JSON.stringify(ghosts));
  const rb = RP.rebuild(d);
  const ghosts2 = Object.keys(d.memories).filter(k => !d.entities[d.memories[k].owner]);
  ok(rb.check.ok === true && ghosts2.length === 0, '★ 按账本重建之后依然没有幽灵 id（rebuild 用的是解析后的 owner）');
  // 重定向本身
  const red = RP.buildRedirect(d.ledger, d);
  ok(red('npc_b') === 'npc_a', 'buildRedirect：旧 id → 当前 id');
  ok(red('npc_a') === 'npc_a' && red('不存在的') === '不存在的', '没被合并的 id 原样返回（恒等）');
  const noErr = mk();
  ok(RP.buildRedirect(noErr.ledger, noErr)('npc_1') === 'npc_1', '★ 没有勘误时是恒等映射（行为与 v1.97 逐字节一致）');
}
// ── ③ 链条与终点：C→B→A 要回溯；终点不存在时宁可不动 ──
{
  const d = mk();
  d.ledger.push({ id: 'l1', t: d.current.time, type: '实体合并', target: 'A', d: { kept: 'A', merged: 'B' } });
  d.ledger.push({ id: 'l2', t: d.current.time, type: '实体合并', target: 'A', d: { kept: 'A', merged: 'C' } });
  d.ledger.push({ id: 'l3', t: d.current.time, type: '实体合并', target: 'B', d: { kept: 'B', merged: 'D' } });
  d.ledger.push({ id: 'l4', t: d.current.time, type: '实体合并', target: 'Z', d: { kept: 'Z', merged: 'E' } });   // Z 不存在
  d.entities.A = { id: 'A', type: 'person', name: '甲' };
  d.entities.B = { id: 'B', type: 'person', name: '乙' };
  const red = RP.buildRedirect(d.ledger, d);
  ok(red('C') === 'A', '链式：C → B → A 一路回溯到还活着的人');
  ok(red('D') === 'A', '★ 链式一路回溯：D → B → A（B 后来也被并进 A 了）');
  ok(red('E') === 'E', '★ 终点指向一个不存在的 id → 不动它（宁可保留旧 id，也不许把记忆判给虚空）');
}
// ── ④ 幂等：同一份存档反复载入不会越并越多 ──
{
  const d = mk();
  twin(d, 'npc_a', '周师傅', '标志物乙');
  twin(d, 'npc_b', '老周', '标志物乙');
  G.mergeDupPersons(d);
  const n1 = d.ledger.filter(l => l.type === '实体合并').length;
  G.mergeDupPersons(d); G.mergeDupPersons(d);
  const n2 = d.ledger.filter(l => l.type === '实体合并').length;
  ok(n1 === 1 && n2 === 1, '★ 再合并两次不会多出勘误（幂等）：' + n1 + ' → ' + n2);
}
// ── ⑤ 占位串：不能当"同一个人"的依据（否则卡导入世界会把一镇子的人并成一个） ──
{
  const d = mk();
  twin(d, 'npc_a', '甲', '待发现');       // import.js 的导入默认
  twin(d, 'npc_b', '乙', '待发现');
  twin(d, 'npc_c', '丙', '（还没看清）');   // director.js 写的（少一个"你"字）
  const n = G.mergeDupPersons(d);
  ok(n === 0, '★★ 占位串不作为身份依据（合并数 = ' + n + '，原来会把三个并成一个）');
  ok(!!d.entities.npc_a && !!d.entities.npc_b && !!d.entities.npc_c, '三个人都还在');
  ok(G.personKey({ name: '甲', profile: { appearance: { 标志物: '待发现' } } }) === 'name:甲', 'personKey：占位串 → 退回按名字');
  ok(G.personKey({ name: '甲', profile: { appearance: { 标志物: '左手有疤' } } }) === 'app:左手有疤', 'personKey：真标志物优先');
  ok(G.looksLikeSamePerson({ name: '甲' }, { name: '甲' }) === true, '同名 → 可能是同一个人（正面情形没被收紧掉）');
  ok(G.looksLikeSamePerson({ name: '甲', profile: { appearance: { 标志物: '待发现' } } }, { name: '乙', profile: { appearance: { 标志物: '待发现' } } }) === false, '★ 两个占位串不算同一人');
  const gm = fs.readFileSync(ROOT + '/src/game.js', 'utf8');
  ok(/isPlaceholder/.test(gm), '三处判据都走 visual.isPlaceholder（清单只有一处）');
  // 只在**代码行**里找硬编码（注释里提到这个 bug 是应该的，不算违规）
  const hardcoded = stripComments(gm).split('\n').filter(l => l.indexOf('（你还没看清）') >= 0);
  ok(hardcoded.length === 0, '★ 占位串不再被硬编码在 game.js 的代码里：' + JSON.stringify(hardcoded.map(x => x.trim().slice(0, 40))));
}
// ── ⑥ 不上玩家屏幕 / 不制造假线索 ──
{
  const d = mk();
  twin(d, 'npc_a', '周师傅', '标志物丙');
  twin(d, 'npc_b', '老周', '标志物丙');
  const th0 = TH.list(d, 'count').length;
  G.mergeDupPersons(d);
  const v = JSON.stringify(G.buildView(d));
  ok(v.indexOf('实体合并') < 0 && v.indexOf('勘误') < 0, '★ 勘误不上玩家屏幕（buildView 里查不到）');
  ok(TH.list(d, 'count').length === th0, '★ 不制造假线索（悬着的线条数不变：' + th0 + ' → ' + TH.list(d, 'count').length + '）');
  ok(d.ledger.some(l => l.type === '实体合并') && !d.ledger.some(l => l.type === '事件开始' && l.cause === '实体合并'), '勘误没有被写成"事件开始"（那会变成永不闭合的悬线）');
}
// ── ⑦ 静态：全仓再也没有"改写已落账条目"的代码；写入只有一个入口 ──
{
  const files = ['server.js'].concat(fs.readdirSync(ROOT + '/src').filter(f => /\.js$/.test(f)).map(f => 'src/' + f));
  const hits = [];
  for (const f of files) {
    const t = stripComments(fs.readFileSync(ROOT + '/' + f, 'utf8'));
    if (/lg\.(target|owner|ref)\s*=/.test(t) || /ledger\[[^\]]+\]\.\w+\s*=/.test(t) || /data\.ledger\.forEach/.test(t)) hits.push(f);
  }
  ok(hits.length === 0, '★★ 生产代码里没有任何"原地改写账本"的写法：' + JSON.stringify(hits));
  const pushes = [];
  for (const f of files) {
    const t = fs.readFileSync(ROOT + '/' + f, 'utf8');
    if (/data\.ledger\.push\(/.test(t)) pushes.push(f);
  }
  ok(pushes.length === 1 && pushes[0] === 'src/store.js', '★ 直接 push 账本的地方只剩 store.js 的 ledgerPush（唯一入口）：' + JSON.stringify(pushes));
  ok(/勘误/.test(fs.readFileSync(ROOT + '/src/replay.js', 'utf8')) && /buildRedirect/.test(fs.readFileSync(ROOT + '/src/replay.js', 'utf8')), 'replay.js 认识勘误（两趟 + 重定向）');
  ok(!/全项目没有任何重放实现/.test(fs.readFileSync(ROOT + '/src/store.js', 'utf8')), 'store.js 里那句过时注释已改（v1.86 起就有 replay.js 了）');
}

// ── ⑧ 归档，不是删除：超上限的老账目要能**读回来**（否则"永不删"只是措辞） ──
{
  const RET = require(ROOT + '/src/retention');
  const ST = require(ROOT + '/src/store');
  const d = mk();
  const keep = RET.CAPS.ledger;
  const before0 = d.ledger.length;           // demo 自带笔数（阈值只有一处，所以压 CAPS 立刻生效）
  RET.CAPS.ledger = 10;                     // 临时把上限压到 10，造一次真实溢出
  try {
    for (let i = 0; i < 25; i++) ST.ledgerPush(d, { t: d.current.time, type: '探针', target: 'player', desc: '第 ' + i + ' 笔' });
    const base = before0;                              // demo 世界自带两笔
    const total = base + 25;
    ok(d.ledger.length === 10, '超上限后存档里只留 10 笔（存档不会无限膨胀）：' + d.ledger.length);
    ok(d.ledgerDropped === total - 10, '被归档的笔数有计数（ledgerDropped=' + (total - 10) + '，名字是历史遗留，语义是"归档"）');
    ok((d.spilled || {}).ledger === total - 10, '落盘计数落在 data.spilled.ledger = ' + (total - 10));
    const back = RET.read('ledger', { n: 0 });
    ok(back.rows.length === total - 10 && back.bad === 0, '★ 归档**能读回来**（read(\'ledger\') 拿到 ' + back.rows.length + ' 笔，坏行 0）');
    const mine = back.rows.filter(r => r.type === '探针');
    // 保留的是**最新 10 笔** ⇒ 归档的是 2 笔 demo 老账 + 前 15 笔探针；后 10 笔探针还在存档里
    ok(mine.length === 15, '被归档的探针笔数正确（' + mine.length + ' / 应归档 15 = 25 − 存档保留的 10）');
    ok(mine[0].desc === '第 0 笔' && mine[14].desc === '第 14 笔', '顺序原样保留（第 0 笔 → 第 14 笔）');
    ok(d.ledger.length + d.ledgerDropped === total, '账目总数守恒：留在存档的 ' + d.ledger.length + ' + 归档的 ' + d.ledgerDropped + ' = ' + total + '（一笔都没丢）');
    ok(back.rows.every(r => r && r.id), '读回来的每一笔都带 id（逐字段可用，不是只剩人话）');
  } finally { RET.CAPS.ledger = keep; }
  const view = RET.view(d);
  ok(Array.isArray(view.files) && view.files.some(f => f.kind === 'ledger'), '留存视图里能看到归档文件（/api/diag 那一路）');
  // 阈值只有一处：生产代码里不许再出现写死的窗口数字
  const srcs = ['src/store.js', 'src/records.js', 'src/game.js'].map(f => ({ f: f, t: stripComments(fs.readFileSync(ROOT + '/' + f, 'utf8')) }));
  const hard = [];
  for (const s of srcs) {
    if (/LEDGER_MAX\s*=\s*\d/.test(s.t)) hard.push(s.f + ':LEDGER_MAX');
    if (/EXP_MAX\s*=\s*\d/.test(s.t)) hard.push(s.f + ':EXP_MAX');
    if (/DAY_MAX\s*=\s*\d/.test(s.t)) hard.push(s.f + ':DAY_MAX');
  }
  ok(hard.length === 0, '★ 窗口数字不再写死在各模块里（一律读 RET.CAPS）：' + JSON.stringify(hard));
  ok(/RET\.CAPS\.ledger/.test(fs.readFileSync(ROOT + '/src/store.js', 'utf8')) && /RET\.CAPS\.experience/.test(fs.readFileSync(ROOT + '/src/records.js', 'utf8')), '账本与认知轨的上限都来自策略表');
}
console.log('');
console.log('==== ledger-immutable-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
