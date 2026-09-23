// bus-check.js — 世界写入总线（v2.01 · P0-6 第二批）
// 病：会改世界的路径有三套规则 —— 主 AI 的 Update 走校验器，引擎的 7 个生成器**直接**写
//     entities/relations/impressions，自定义动作又是另一套。谁都可以在没人看着的地方改世界。
// 修：一条通路 —— 提议 → 归一化 → 校验 → 执行 → 落账；任一段不过就**不写世界**。
'use strict';
const path = require('path'), os = require('os'), fs = require('fs');
const TMP = path.join(os.tmpdir(), 'ws-bus-' + Date.now());
process.env.WORLD_SIM_DATA = TMP; fs.mkdirSync(TMP, { recursive: true });
const ROOT = path.join(__dirname, '..');
process.env.WORLD_SIM_ASSETS = ROOT;
const { buildDemoWorld } = require(ROOT + '/src/world');
const { makeId } = require(ROOT + '/src/store');
const BUS = require(ROOT + '/src/bus');
const CT = require(ROOT + '/src/contract');
const RT = require(ROOT + '/src/runtime');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const mk = () => { const d = buildDemoWorld(); if (!d.id) d.id = makeId; d.impressions = {}; return d; };
const T = '1996-06-14T20:45:00';

console.log('');
console.log('写入总线：归一化 / 校验 / 执行 / 落账 / 回滚');

// ── ① 归一化：缺字段在门口就被挡下 ──
{
  const d = mk();
  const r = BUS.commit(d, [{ kind: 'create', type: 'item', entity: { type: 'item' } }], { t: T });
  ok(r.rejected.length === 1 && r.rejected[0].code === 'no_id' && r.rejected[0].stage === 'normalize', '缺 id → normalize 阶段拒（no_id）');
  const r2 = BUS.commit(d, [{ kind: 'create', type: 'moon', entity: { id: 'x1', name: '东西' } }], { t: T });
  ok(r2.rejected[0] && r2.rejected[0].code === 'bad_type', '实体类型不在白名单 → bad_type（白名单：' + CT.CREATE_TYPES.join('/') + '）');
  const r2b = BUS.commit(d, [{ kind: 'create', type: 'item', entity: { id: 'x1b', name: '东西' } }], { t: T });
  ok(r2b.committed.length === 1 && d.entities.x1b.type === 'item', '只写提议上的 type 也能落库，而且实体带上 type（不是个没类型的怪东西）');
  const r3 = BUS.commit(d, [{ kind: 'nonsense' }], { t: T });
  ok(r3.rejected[0].code === 'unknown_proposal', '不认识的提议类型 → unknown_proposal');
  const r4 = BUS.commit(d, [{ kind: 'create', type: 'item', entity: { id: 'x2', name: '东西', type: 'item' }, side: [{ do: 'run_arbitrary_code' }] }], { t: T });
  ok(r4.rejected[0].code === 'side_not_allowed', '★ 副作用的**白名单**：不许随手加一个"想干什么干什么"的回调');
  ok(!d.entities.x1 && !d.entities.x2, '被拒的提议**一个字段都没落地**');
}
// ── ② 校验：id 撞车 / 引用不存在 / 动作注册表上限 ──
{
  const d = mk();
  const dup = BUS.commit(d, [{ kind: 'create', type: 'item', entity: { id: 'it_milk', name: '冒牌牛奶', type: 'item' } }], { t: T });
  ok(dup.rejected[0].code === 'id_taken', '★ id 撞车 → 拒（不会静默覆盖已有实体）');
  ok(d.entities.it_milk.name === '牛奶', '已有实体毫发无损：' + d.entities.it_milk.name);
  const badEdge = BUS.commit(d, [{ kind: 'create', type: 'place', entity: { id: 'plc_1', name: '河滩', type: 'place' }, edgeBack: { from: '不存在的地方', edge: { to: 'plc_1' } } }], { t: T });
  ok(badEdge.rejected[0].code === 'bad_edge_from', '★ 反向边指向不存在的地方 → 拒（原来会留下半成品实体）');
  ok(!d.entities.plc_1, '半成品没有留下');
  const badLoc = BUS.commit(d, [{ kind: 'create', type: 'person', entity: { id: 'per_x', name: '某人', type: 'person', state: { location: 'pl_999' } } }], { t: T });
  ok(badLoc.rejected[0].code === 'bad_location', '★ 人的落点必须是真实地点（否则 present() 永远不认他）');
  // 一次提交里两个补丁撞同一个 id
  const two = BUS.commit(d, [
    { kind: 'create', type: 'item', entity: { id: 'it_new', name: '甲', type: 'item', at: 'pl_1' } },
    { kind: 'create', type: 'item', entity: { id: 'it_new', name: '乙', type: 'item', at: 'pl_1' } }
  ], { t: T });
  ok(two.committed.length === 1 && two.rejected.some(x => x.code === 'id_taken'), '★ 同一批里撞 id：只落一个，另一个被拒');
  const ca = {}; ca.a1 = { id: 'a1' }; ca.a2 = { id: 'a2' }; ca.a3 = { id: 'a3' }; ca.a4 = { id: 'a4' };
  const full = BUS.commit(d, [{ kind: 'create', type: 'action', entity: { id: 'a1', name: '动作甲', type: 'action' }, customActions: ca }], { t: T });
  ok(full.rejected[0].code === 'registry_full', '★ 动作注册表上限（≤3）由总线判（原来生成器自己数一遍）');
  ok(!d.customActions || !d.customActions.a1, '超限时一个都没注册');
}
// ── ③ 执行：一次提交该落的都落，账走唯一入口 ──
{
  const d = mk();
  const led0 = d.ledger.length;
  const rel = {}; rel.zz = { player: { tone: '陌生', causes: [] } };
  const imp = {}; imp.zz = { stage: 0, seen: '', traits: [], notes: [], bonds: ['还没见过'], nameKnown: null };
  const r = BUS.commit(d, [{
    kind: 'create', type: 'person',
    entity: { id: 'zz', type: 'person', name: '周师傅', state: { location: 'pl_1' } },
    relations: rel, impressions: imp,
    ledger: [{ type: '人物出现', target: '周师傅', desc: '新面孔出现在镇子里' }]
  }], { t: T });
  ok(r.committed.length === 1 && d.entities.zz, '实体落库');
  ok(d.relations.zz && d.impressions.zz, '关系与印象一起落库（同一个事务）');
  ok(d.ledger.length === led0 + 1 && d.ledger[d.ledger.length - 1].type === '人物出现', '★ 账走唯一入口 ledgerPush（带 id）');
  ok(r.ledgerIds.length === 1 && r.ledgerIds[0] === d.ledger[d.ledger.length - 1].id, '回执里带 ledgerIds（调用方不用自己再找）');
  ok(!!r.id && /^cm/.test(r.id), '每次提交有自己的 id（可追溯）：' + r.id);
  const r2 = BUS.commit(d, [{ kind: 'create', type: 'place', entity: { id: 'plc_2', name: '河滩', type: 'place', edges: [{ to: 'pl_1', level: '相邻街区', minutes: 12 }] }, edgeBack: { from: 'pl_1', edge: { to: 'plc_2', level: '相邻街区', minutes: 12 } }, knownPlaces: ['plc_2'] }], { t: T });
  ok(d.entities.plc_2 && (d.entities.pl_1.edges || []).some(e => e.to === 'plc_2'), '★ 地点 + 反向边一起落（原来分两步、中间可能留半成品）');
  ok((d.knowledge.knownPlaces || []).indexOf('plc_2') >= 0, '记进"听说过的地方"');
}
// ── ④ 回滚：执行段抛错 → 这个补丁整个撤掉（不许留半个） ──
{
  const d = mk();
  const before = JSON.stringify({ n: Object.keys(d.entities).length, led: d.ledger.length });
  // 让 ledgerPush 抛一次：data.id 换成非函数（ledgerPush 依赖它）
  const rawId = d.id;
  const r = BUS.commit(d, [{ kind: 'create', type: 'item', entity: { id: 'it_boom', name: '会炸的东西', type: 'item', at: 'pl_1' }, ledger: [{ type: '物品获取', target: 'player', desc: 'x' }] }], { t: T });
  d.id = function () { throw new Error('模拟：落账这一步炸了'); };
  const ledBefore = d.ledger.length;
  const r2 = BUS.commit(d, [{ kind: 'create', type: 'item', entity: { id: 'it_boom2', name: '会炸的东西2', type: 'item', at: 'pl_1' }, ledger: [{ type: '物品获取', target: 'player', desc: '会炸的那条账' }] }], { t: T });
  d.id = rawId;
  ok(r.committed.length === 1, '对照组：正常提交成功');
  ok(r2.rejected.length === 1 && r2.rejected[0].stage === 'execute', '★ 执行段抛错 → 记成 execute 阶段的拒绝：' + JSON.stringify(r2.rejected[0].code));
  ok(!d.entities.it_boom2, '★ 而且**这个补丁整个被撤掉**（实体没留下 —— 不留半个）');
  ok(d.ledger.length === ledBefore, '★ 它写进去的账也一起撤了（账本长度回到提交前：' + ledBefore + '）');
  ok(!d.ledger.some(l => l.desc === '会炸的那条账'), '★ 账本里没有那条残账');
  ok(JSON.stringify({ n: Object.keys(d.entities).length, led: d.ledger.length }) !== before, '（对照：正常那条确实落地了）');
}
// ── ⑤ 接线：五个生成器只产出提议，落库全归总线 ──
{
  const dir = fs.readFileSync(ROOT + '/src/director.js', 'utf8');
  const n = (dir.match(/BUS\.commit\(/g) || []).length;
  ok(n >= 5, '★ 人物/地点/物品/机构/动作 五个生成器都走总线：' + n + ' 处');
  const code = dir.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
  /* 直写是**棘轮**：只许减不许增。现在还剩 genCity（城市生成器是复合的，留给 P0-6 第二批的下半段）——
     把它写清楚，下一个人一眼知道"这几个数是待办，不是漏网"。 */
  const nEnt = (code.match(/data\.entities\[[^\]]+\]\s*=/g) || []).length;
  const nImp = (code.match(/data\.impressions\[[^\]]+\]\s*=/g) || []).length;
  const nRel = (code.match(/data\.relations\[[^\]]+\]\s*=/g) || []).length;
  /* v2.02：棘轮收到 **0** —— 七个生成器（含城市）全部只产出提议。 */
  ok(nEnt === 0 && nImp === 0 && nRel === 0, '★★ 生成器里**再也没有**直写：entities ' + nEnt + ' / impressions ' + nImp + ' / relations ' + nRel);
  ok(/nextCityZone/.test(dir) && /zone = nextCityZone\(data\)/.test(dir), '城市的 zone 由确定性推导（不是写死 city1）');
  const gm = fs.readFileSync(ROOT + '/src/game.js', 'utf8');
  ok(!/'city1_p1'/.test(gm.replace(/\/\*[\s\S]*?\*\//g, '')), '★ 与它成对的 game.js 硬编码也消掉了（只改一边＝"新城建好了玩家站在旧城"）');
  ok(/r\[0\]\.built !== false/.test(gm), '★ 城没建起来就不许假装到了（原来无条件写死到 city1_p1）');
  const nCommit = (dir.match(/BUS\.commit\(/g) || []).length;
  ok(nCommit >= 6, '七个生成器里的六处提交点（城市一次提交里含 4 地点 + 3 面孔 + 回程边）：' + nCommit + ' 处');
  ok(/type: 'action', entity: \{ id: aid/.test(dir) && /registryOnly/.test(fs.readFileSync(ROOT + '/src/bus.js', 'utf8')), '动作注册表条目**不是实体**（不进 data.entities）');
  const bus = fs.readFileSync(ROOT + '/src/bus.js', 'utf8');
  ok(/ledgerPush\(data/.test(bus), '总线落账用的是唯一入口（store.ledgerPush）');
  ok(!/function writeAtomic|writeFileSync/.test(bus), '总线自己不碰磁盘（写盘是 server 层的事）');
  ok(/SIDE_EFFECTS = \['learnWord', 'manifest'\]/.test(bus), '副作用是白名单（两个），不是任意回调');
  ok(/require\('\.\/game'\)/.test(bus), 'update 类提议交给 applyUpdates（它的内部一字不动）');
  /* 实测踩过：复制粘贴 ctx 时把 genPlace 的局部变量 `desc` 带进了 genItem ——
     ReferenceError 被 routeRequests 的 catch 吞成一条 note，**生成器整个不工作**却看不出来。
     这里钉死"总线 ctx 里出现的键必须是它真的认识的"（现在是 t / by / scene）。 */
  const ctxKeys = new Set();
  for (const m of dir.matchAll(/BUS\.commit\(data, \[\{?[\s\S]{0,900}?\}\]?, \{([^}]*)\}/g)) for (const kv of m[1].split(',')) { const k = kv.split(':')[0].trim(); if (k) ctxKeys.add(k); }
  const allowed = ['t', 'by', 'scene'];
  const bad = Array.from(ctxKeys).filter(k => allowed.indexOf(k) < 0);
  ok(bad.length === 0, '★ 总线 ctx 只用它认识的键（实测踩过：粘贴时带进未定义变量 → 生成器整个不工作）：' + JSON.stringify(bad));
  const idx = dir.indexOf('function genItem');
  const seg = dir.slice(idx, idx + 2200);
  ok(!/\bdesc\b/.test(seg.split('const rec = BUS.commit')[1].slice(0, 120)), 'genItem 的 ctx 里没有不属于它的变量');
}
// ── ⑥ 新闻与候选：落库走总线，admitEvent 只有一个裁决点 ──
{
  const d = mk();
  const r = BUS.commit(d, [{ kind: 'news', source: 'yearly', newsSeverity: '低', item: { title: '镇上多了个修车摊', summary: '有人在街口支了摊子', tags: ['本地'] } }], { t: T });
  ok(r.committed.length === 1 && r.committed[0].id, '★ 新闻落库走总线，回执带 id');
  ok((d.news || []).some(n => n.title === '镇上多了个修车摊'), '新闻进了 data.news');
  ok((d.knowledge.heardNews || []).indexOf(r.committed[0].id) >= 0, 'heard 默认开（"镇上都在传"）');
  const d2 = mk();
  const n0 = (d2.news || []).length;
  const bad = BUS.commit(d2, [{ kind: 'news', source: 'news', newsSeverity: '灾难', item: { title: '凭空的大事' } }], { t: T });
  ok(bad.rejected.length === 1 && bad.rejected[0].code === 'gate_rejected', '★ 高烈度新闻走**同一道门**（总线里调 admitEvent）：' + JSON.stringify(String(bad.rejected[0].why).slice(0, 40)));
  ok(d2.news.length === n0, '被门拦下的新闻一条都不落库');
  ok(require(ROOT + '/src/gate').gateView(d2).rejected >= 1, '拦下来有留痕（门的计数）');
  const d3 = mk();
  const rc = BUS.commit(d3, [{ kind: 'candidate', source: 'candidate', level: 'L1', item: { text: '巷口有人在吵架', type: '环境', expireM: 40 } }], { t: T });
  ok(rc.committed.length === 1 && (d3.current.pendingCandidates || []).length === 1, '★ 候选也走总线');
  ok(!!(d3.current.pendingCandidates[0] || {}).expireAt, '候选带 expireAt：' + JSON.stringify(d3.current.pendingCandidates[0].expireAt));
  const files = ['src/epoch.js', 'src/director.js', 'src/game.js', 'src/runtime.js', 'src/subai.js', 'src/scheduler.js'];
  const offenders = [];
  for (const f of files) {
    const t = fs.readFileSync(ROOT + '/' + f, 'utf8');
    if (/data\.news\.push\(/.test(t) || /pendingCandidates\.push\(/.test(t)) offenders.push(f);
  }
  ok(offenders.length === 0, '★★ 除总线与开局种子（world.js）外，**没有人在直接写 news / 候选池**：' + JSON.stringify(offenders));
  ok(/GATE\.admitEvent/.test(fs.readFileSync(ROOT + '/src/bus.js', 'utf8')), '裁决点在总线里');
  ok(/const EFFECTS = CONTRACT\.ACTION_EFFECT_NAMES/.test(fs.readFileSync(ROOT + '/src/director.js', 'utf8')), '动作效果白名单取自 contract（唯一真源）');
}
console.log('');
console.log('==== bus-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
