'use strict';
const DEG = require('./degraded');
// director.js — 世界导演：通用"创造请求"管线（AI 岗位 → 调度器 → 生成器 → 校验 → 入库）
// 任何 AI 可输出 requests（≤1条/回合），kind 白名单路由；未配模型=代码池(0 token)；产物统一落库
// customActions：动态动作注册表（不改代码加动作；parseIntent 优先匹配）
const { getEntity, ledgerPush } = require('./store');   // v1.98 P0-3：账本只有这一个写入入口
const AI = require('./ai');
const EPOCH = require('./epoch');
const RT = require('./runtime');
const GATE = require('./gate');   // v1.99 P0-5 第 2 步：引擎自产事件也要过同一道门
const BUS = require('./bus');     // v2.01 P0-6：写入总线（生成器只产出提议，落库归它）
const CONTRACT = require('./contract');   // v2.03：动作效果白名单的唯一真源

/* v1.84：删掉 'depth' —— 它从 v1.5x 起就在白名单和 AI 的工具列表里，但**全项目没有定义**
   （设计总稿搜不到、routeRequests 没有分支、没有任何生成器）→ AI 请求它只会拿到
   "（该 kind 生成器未启用）"。白名单不许包含没有执行器的类型（设计矛盾清单 M4 的同一条原则）。 */
const KINDS = ['event', 'person', 'place', 'item', 'action', 'news', 'city', 'org'];
/* v2.03：效果白名单的唯一真源搬到 contract.js（与 UPDATE_TYPES 同一套规矩，断言会守一致性）。 */
const EFFECTS = CONTRACT.ACTION_EFFECT_NAMES;
const CHAIN_DEPTH = 2; // 接力链深度上限（A→B→C 为止，防雪崩）

// ---------- 护栏（每回合≤1、未决链≤3、频率） ----------
function requestOk(data) {
  const cal = (data.calendar || []).filter(c => (c.summoned || c.requested) && !c.done).length;
  if (cal >= 3) return false;
  const n = (data.current.turnN || 0);
  if ((data.meta.requestBudget || 0) >= Math.max(1, Math.floor((n + 11) / 12))) return false;
  return true;
}

// ---------- 生成器：人物孵化（占位→骨架→入库；玩家见面才知道，不预先进入通知名单） ----------
const NAME_POOL = ['老康', '赵四', '林婶', '阿秀', '城娃', '老周', '二狗', '素云', '锁柱', '春桃'];
async function genPerson(data, cfg, req) {
  const id = data.id('per');
  let fix = { name: '某人', role: '', surface: '', hidden: '', appearance: '', backstory: '' };
  if (AI.isLive(cfg)) {
    try {
      const o = await AI.llmJSONDeep(cfg, [
        { role: 'system', content: '你是【世界模拟器】的人物生成器。根据需求生成一个符合世界时代/基调的人物（只需骨架，不要长篇）。输出 JSON（都是中文，字符≤60）：{"name":"人名","role":"身份/职业","surface":"表面一句","hidden":"隐藏一句","appearance":"外貌一句","backstory":"背景一句"}' },
        { role: 'user', content: JSON.stringify({ 需求: req, 时代: (data.meta && data.meta.eraLabel) || (data.meta && data.meta.era) || '' }) }
      ], () => null, Math.min(1024, AI.cfgMax(cfg)));
      if (o && !o.__fallback && (o.name || o.role)) fix = o;
    } catch (e) { DEG.hit("director.js", e); }
  }
  if (!fix || !fix.name || fix.name === '某人') {
    const nm = NAME_POOL[Math.floor(Math.random() * NAME_POOL.length)];
    fix = { name: nm, role: '有来历的新面孔', surface: '话不多', hidden: '（未可知）', appearance: '（还没看清）', backstory: '（来历）' };
    const tokens = String(req.hint || req.need || '');
    const m = tokens.match(/[\u4e00-\u9fa5]{2,6}/g);
    if (m && m.length) fix.name = m[0].slice(0, 3);
  }
  /* v2.01 · P0-6：**只产出提议**，落库交给总线（原来这里直接写 entities/relations/impressions）。 */
  const pRel = Object.assign({}, data.relations['player'] || {});
  pRel[id] = { tone: '陌生（没见过面）', causes: ['（剧情引出）'] };
  const rel = {}; rel['player'] = pRel; rel[id] = { player: { tone: '陌生（没见过面）', causes: [] } };
  const imp = {}; imp[id] = { stage: 0, seen: '', traits: [], notes: [], bonds: ['还没见过'], nameKnown: null };
  const rec = BUS.commit(data, [{
    kind: 'create', type: 'person',
    entity: {
      id: id, type: 'person', name: String(fix.name).slice(0, 20), avatar: null,
      tags: ['新面孔', '剧情生成'], indexes: { geo: [], org: [], family: [] },
      profile: { identity: { 姓名: fix.name, 身份: String(fix.role || '（来历未知）').slice(0, 40) }, appearance: { 标志物: String(fix.appearance || '（还没看清）').slice(0, 40) }, surface: { 待人: String(fix.surface || '（待相处）').slice(0, 40) }, hidden: { 真实: String(fix.hidden || '（未可知）').slice(0, 60) }, background: { 经历: String(fix.backstory || '').slice(0, 80) }, schedule: {}, desires: { 现在想: '' }, secrets: { 包袱: '（未知）' } },
      locked: { core: '性格内核（剧情生成）' },
      state: { location: (String(req.atScene) === '1' || req.atScene) ? data.current.sceneId : ((data.entities[String(req.atScene)] || {}).id || data.current.sceneId), mood: '平静', fatigue: '中', hunger: '低', sleep: '正常' },
      trait: { lambda: 0.06, memory: '普通' }, spawnedBy: 'request'
    },
    relations: rel, impressions: imp,
    ledger: [{ type: '人物出现', target: fix.name, desc: '新面孔' + fix.name + '出现在镇子里', cause: String(req.hint || '剧情需要').slice(0, 60), scene: data.current.sceneId }]
  }], { t: data.current.time });
  if (!rec.committed.length) return { kind: 'person', id: null, note: '（人物生成被总线拒下：' + String(((rec.rejected[0] || {}).code) || '') + '）' };
  return { kind: 'person', id: id, name: fix.name, known: false };
}

// ---------- 生成器：地点（地图扩展：连边+进门控=听说过即可去） ----------
const PLACE_POOL = ['镇南河滩', '老街后的空院子', '供销社仓库', '村口的打谷场', '西头的砖窑'];
async function genPlace(data, cfg, req) {
  let name = PLACE_POOL[Math.floor(Math.random() * PLACE_POOL.length)];
  let desc = '一个还没去过的地方';
  if (AI.isLive(cfg)) {
    try {
      const o = await AI.llmJSONDeep(cfg, [
        { role: 'system', content: '你是【世界模拟器】的地点生成器。生成一个符合世界基调的新地点（一句话名字+一句描述，中文）。输出 JSON：{"name":"地点名","desc":"一句话描述","tags":["室外|室内|店铺|住宅"]}' },
        { role: 'user', content: JSON.stringify({ 需求: req, 时代: (data.meta && data.meta.eraLabel) || '' }) }
      ], () => null, Math.min(512, AI.cfgMax(cfg)));
      if (o && o.name) { name = String(o.name).slice(0, 20); desc = String(o.desc || '').slice(0, 80); }
    } catch (e) { DEG.hit("director.js", e); }
  }
  /* v2.01 · P0-6：三件事（建实体 / 推反向边 / 记"听说过"）**同一事务** —— 由总线一起落。
     原来这里是"先建实体、再改反向边"，而且 `if (cur) cur.edges = cur.edges || []; cur.edges.push(…)`
     的分号错位让 cur 为空时**下一步直接抛**（半成品实体已经留在世界里了）。 */
  const id = data.id('plc');
  const from = data.current.sceneId;
  const mins = 10 + Math.floor(Math.random() * 10);
  const rec = BUS.commit(data, [{
    kind: 'create', type: 'place',
    entity: { id: id, type: 'place', name: name, geo: ['此处附近'], tags: ['新'], openHours: '全天', edges: [{ to: from, level: '相邻街区', minutes: mins }], features: [], state: {} },
    edgeBack: { from: from, edge: { to: id, level: '相邻街区', minutes: mins } },
    knownPlaces: [id]     // 听说过的灰点；走进才 visited
  }], { t: data.current.time });
  if (!rec.committed.length) return { kind: 'place', id: null, note: '（地点生成被总线拒下：' + String(((rec.rejected[0] || {}).code) || '') + '）' };
  return { kind: 'place', id: id, name: name };
}

// ---------- 生成器：物品 ----------
const ITEM_POOL = ['一包新到的瓜子', '旧木箱', '半袋水泥', '账本', '一条咸鱼'];
async function genItem(data, cfg, req) {
  let name = ITEM_POOL[Math.floor(Math.random() * ITEM_POOL.length)];
  let price = 2;
  if (AI.isLive(cfg)) {
    try {
      const o = await AI.llmJSONDeep(cfg, [
        { role: 'system', content: '你是【世界模拟器】的物品生成器。生成一件符合场景/年代的物品。输出 JSON：{"name":"物品名","price":价格数字,"desc":"一句描述"}' },
        { role: 'user', content: JSON.stringify({ 需求: req }) }
      ], () => null, Math.min(512, AI.cfgMax(cfg)));
      if (o && o.name) { name = String(o.name).slice(0, 20); price = Math.max(0, Number(o.price) || 2); }
    } catch (e) { DEG.hit("director.js", e); }
  }
  const id = data.id('itm');
  /* v2.01 · P0-6：走总线。**物品的落点必须是真实场景** —— 总线会校验（原来写错 at 就悬空了）。 */
  const rec = BUS.commit(data, [{
    kind: 'create', type: 'item',
    entity: { id: id, type: 'item', name: name, tags: ['新'], at: data.current.sceneId, price: price, desc: '（新出现的）' }
  }], { t: data.current.time });
  if (!rec.committed.length) return { kind: 'item', id: null, note: '（物品生成被总线拒下：' + String(((rec.rejected[0] || {}).code) || '') + '）' };
  return { kind: 'item', id: id, name: name };
}

// ---------- 生成器：机构/组织（v1.84 新增） ----------
// 为什么补它：director.js 的白名单与 AI 的工具列表里一直有 kind:'org'，但**没有生成器** →
// "机构"两头都断：framework 里的 org 词不上界面，UI 的「势力/组织」栏读的是 org **实体**、而实体永远建不出来。
// 现在通一头：AI 请求机构 → 落成 org 实体（+ 框架词 + 生成清单留痕）。
const ORG_POOL = ['同乡会', '供销社', '街道办', '搬运队', '联防队'];
async function genOrg(data, cfg, req) {
  let name = ORG_POOL[Math.floor(Math.random() * ORG_POOL.length)];
  let role = '', surface = '', hidden = '';
  if (AI.isLive(cfg)) {
    try {
      const o = await AI.llmJSONDeep(cfg, [
        { role: 'system', content: '你是【世界模拟器】的机构生成器。生成一个符合世界时代/基调的机构或组织（只需骨架）。输出 JSON（中文，每项≤40字）：{"name":"机构名","role":"它是干什么的","surface":"外人看到的样子","hidden":"内里的算计/秘密"}' },
        { role: 'user', content: JSON.stringify({ 需求: req, 时代: (data.meta && data.meta.eraLabel) || (data.meta && data.meta.era) || '' }) }
      ], () => null, Math.min(512, AI.cfgMax(cfg)));
      if (o && o.name) { name = String(o.name).slice(0, 20); role = String(o.role || '').slice(0, 40); surface = String(o.surface || '').slice(0, 40); hidden = String(o.hidden || '').slice(0, 40); }
    } catch (e) { DEG.hit("director.js", e); }
  }
  if (name === ORG_POOL[0] || !name) { const t = String(req.need || req.hint || ''); const m = t.match(/[\u4e00-\u9fa5]{2,6}/g); if (m && m.length) name = m[0].slice(0, 6); }
  const id = data.id('org');
  const atScene = (String(req.atScene) === '1') ? data.current.sceneId : (data.entities[String(req.atScene)] ? String(req.atScene) : '');
  /* v2.01 · P0-6：实体 + 门控 + 两个副作用（框架词 / 生成清单）**一次提交**。
     副作用走总线的白名单（`side`），不是"随手再写一句" —— 它们必须在实体落库之后跑。 */
  const inSight = !!(atScene && atScene === data.current.sceneId);
  const rec = BUS.commit(data, [{
    kind: 'create', type: 'org',
    entity: {
      id: id, type: 'org', name: name,
      tags: ['新出现的'],
      indexes: { geo: [], org: [], family: [] },
      profile: {
        identity: { 名称: name, 性质: role || '（性质未明）' },
        surface: { 外人看: surface || '（还看不出来）' },
        hidden: { 内里: hidden || '（未可知）' },
        background: { 来历: '（这地方的老人说得上几句）' }
      },
      state: { location: atScene || '' },
      spawnedBy: 'request'
    },
    /* 门控：机构默认**玩家没听说过**；只有它当场出现在你眼前才进 knownOrgs
       并留一条"你听到了"的账 —— 否则它只是世界里的一处背景（设计 §261）。 */
    knownOrgs: inSight ? [id] : [],
    ledger: inSight ? [{ type: '信息到达', target: 'player', desc: '你听说了「' + name + '」', cause: '就在眼前' }] : [],
    side: [
      { do: 'learnWord', group: 'orgs', name: name },     // 框架"词"：世界自己长出来的机构名（v2.08 起无档位，永远可记）
      { do: 'manifest', rec: { kind: '组织', id: id, name: name, schema: 'ent.org.v1', by: 'ai', note: String(role || req.need || '').slice(0, 60) } }
    ]
  }], { t: data.current.time });
  if (!rec.committed.length) return { kind: 'org', id: null, note: '（机构生成被总线拒下：' + String(((rec.rejected[0] || {}).code) || '') + '）' };
  return { kind: 'org', id: id, name: name, known: inSight };
}

// ---------- 生成器：动态动作（customActions：不改代码加动作） ----------
const ACTION_POOL = [{
  id: 'hire_cart', trigger_patterns: ['雇一辆车', '叫个车', '雇车'], preconditions: [{ type: 'has_money', min: 20 }],
  effects: [{ type: 'deduct_money', amount: 20 }, { type: 'ledger', desc: '雇了一辆板车去镇上办事' }, { type: 'add_item', name: '租来的马车' }]
}];
async function genAction(data, cfg, req) {
  data.customActions = data.customActions || {};
  // 生成前清理同名
  if (Object.keys(data.customActions).length >= 3) return { kind: 'action', id: null, note: '动作注册表已满（≤3）' };
  let act = ACTION_POOL[0];
  if (AI.isLive(cfg)) {
    try {
      const o = await AI.llmJSONDeep(cfg, [
        { role: 'system', content: '你是【世界模拟器】的规则生成器。根据需求产出一个"玩家可触发的新动作"，动作效果只能使用这些白名单效果类型：' + EFFECTS.join(',') + '（参数：deduct_money{amount} / earn_money{amount} / add_item{name} / add_entity{kind,name,atScene} / move_to{place} / send_msg{to,text} / ledger{desc} / set_flag{key,value}）。输出 JSON：{"trigger_patterns":["玩家话术2-3条"]... 实际上请输出 {"id":"动作id","trigger_patterns":["话术"],"preconditions":[],"effects":[{"type":"deduct_money","amount":20}]}' },
        { role: 'user', content: JSON.stringify({ 需求: req, 时代: (data.meta && data.meta.eraLabel) || '' }) }
      ], () => null, Math.min(1024, AI.cfgMax(cfg)));
      if (o && o.id && Array.isArray(o.effects) && o.effects.length) act = o;
    } catch (e) { DEG.hit("director.js", e); }
  }
  // 校验 effects 白名单
  const bad = (act.effects || []).find(x => EFFECTS.indexOf(x.type) < 0);
  if (bad) return { kind: 'action', id: null, note: '效果白名单外：' + bad.type };
  const aid = String(act.id || 'act_' + Date.now().toString(36)).replace(/[^a-zA-Z0-9_]/g, '');
  const draft = { id: aid, trigger_patterns: (act.trigger_patterns || []).slice(0, 4).map(String), preconditions: (act.preconditions || []).slice(0, 2), effects: (act.effects || []).slice(0, 5) };
  /* v2.01 · P0-6：动作注册表也走总线 —— 上限（≤3）与 id 撞车由总线判，
     不再"生成器自己数一遍、总线再数一遍"。 */
  const ca = {}; ca[aid] = draft;
  const rec = BUS.commit(data, [{ kind: 'create', type: 'action', entity: { id: aid, type: 'action', name: draft.trigger_patterns[0] || aid }, customActions: ca }], { t: data.current.time });
  if (!rec.committed.length) return { kind: 'action', id: null, note: '（动作未注册：' + String(((rec.rejected[0] || {}).code) || '') + '）' };
  return { kind: 'action', id: aid, note: '新动作：' + (draft.trigger_patterns[0] || '') };
}

// ---------- 生成器：消息/传闻（接力链下游：把上游给的料变成镇上谈资） ----------
async function genNews(data, cfg, req) {
  const payload = req.payload || {};
  const src = String(payload.text || req.need || '');
  let title = '镇上的新鲜事', summary = src.slice(0, 80), sev = '低';
  if (AI.isLive(cfg)) {
    try {
      const o = await AI.llmJSONDeep(cfg, [
        { role: 'system', content: '你是【世界模拟器】的新闻/传闻生成器。上游 AI（消息/事件链）把料交给你，你产出一条镇上会传开的新闻条目。输出 JSON：{"title":"标题","summary":"一句话（口语化、可当谈资）","severity":"低|中"}' },
        { role: 'user', content: JSON.stringify({ 素材: src, 来源: payload.from || '', 时间: payload.t || '', 时代: (data.meta && data.meta.eraLabel) || '' }) }
      ], () => null, Math.min(768, AI.cfgMax(cfg)));
      if (o && o.title) { title = String(o.title).slice(0, 60); summary = String(o.summary || '').slice(0, 160); sev = String(o.severity || '低'); }
    } catch (e) { DEG.hit("director.js", e); }
  } else if (/火|着|偷|警|炸|死|救|抓/.test(src)) {
    title = '街坊都在传：' + src.slice(0, 30);
    summary = src.slice(0, 100);
    sev = '中';
  } else {
    title = '有人说了件新鲜事';
    summary = src.slice(0, 100);
  }
  /* v1.99 · P0-5 第 2 步：引擎自产的传闻也要过门。
     原来这里**没有任何校验**——AI 写多"重"就是多重（评审 §3.3 点的 9 条绕过路径之一）。
     现在：严重性按桥换算成 L 级 → 比世界上限 → L3+ 必须有前兆 → 提议类还要看节奏门。 */
  /* v2.03 · P0-6 收尾：传闻的落库也走总线（裁决点唯一，别再各写各的）。 */
  const rec = BUS.commit(data, [{ kind: 'news', source: 'news', newsSeverity: sev, foreshadowRef: payload.foreshadow || '',
    item: { t: payload.t || data.current.time, title: title, summary: summary, tags: ['传闻'], region: '青石镇', impact: { 时长: '短期', 范围: '本地区' } } }], { t: payload.t || data.current.time });
  if (!rec.committed.length) {
    const rj = rec.rejected[0] || {};
    GATE.noteRejected(data, rj.ad || { why: rj.code || '' }, { what: '传闻：' + title, record: false });
    return { kind: 'news', id: '', name: title, rejected: rj.why || rj.code };
  }
  return { kind: 'news', id: String(rec.committed[0].id || ''), name: title };
}

// ---------- 生成器：城市蓝图（旅程任务；车票定名→到达场景+子地点+NPC+传闻；city1_* 前缀实体集） ----------
const CITY_POOL = {
  names: ['临江市', '白鹤城', '南州'],
  places: [
    { id: 'p1', name: '站前街', tags: ['室外', '街'], feats: ['站牌', '路灯', '检票口'] },
    { id: 'p2', name: '街口招待所', tags: ['室内', '住宅'], feats: ['床', '门', '窗'] },
    { id: 'p3', name: '临江小馆', tags: ['室内', '馆'], feats: ['桌', '门', '柜台'] },
    { id: 'p4', name: '街心广场', tags: ['室外', '路口'], feats: ['路灯', '喷泉'] }
  ],
  npcs: [
    { id: 'n1', name: '售票大妈', role: '站前街开小卖部的', surface: '嗓门大，记性极好', hidden: '儿子在外地当兵' },
    { id: 'n2', name: '招揽的伙计', role: '招待所接客的', surface: '嘴甜腿快', hidden: '其实欠了一屁股债' },
    { id: 'n3', name: '修鞋匠', role: '街口摆摊的', surface: '话少手艺稳', hidden: '年轻时在城里当过学徒' }
  ],
  rumors: ['这座城的人说话都比家里快半拍', '站前街的夜宵摊子凌晨两点才收']
};
/* 城市 zone 由**确定性推导**（v2.02 · P0-6）：原来写死 'city1'，
   而 game.js 的 travelTick 也写死 sceneId='city1_p1' —— 第二座城会盖在第一座上
   （评审点名的那对"必须成对改"的硬编码）。现在两边都问这一个函数。 */
function nextCityZone(data) {
  let max = 0;
  for (const id of Object.keys((data && data.entities) || {})) {
    const m = /^city(\d+)_p1$/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return 'city' + (max + 1);
}
async function genCity(data, cfg, req) {
  const zone = nextCityZone(data);
  const plan = req.payload && req.payload.plan;
  // 车票定名：玩家没说名 → 蓝图给名（diegetic）
  const cityName = (req.payload && req.payload.dest && /city|省城|大城市|新城市/.test(String(req.payload.dest)) === false && String(req.payload.dest).length >= 2)
    ? String(req.payload.dest).slice(0, 10)
    : CITY_POOL.names[Math.floor(Math.random() * CITY_POOL.names.length)];
  const places = CITY_POOL.places.map(p => ({ id: zone + '_' + p.id, name: p.name.replace('临江', cityName.slice(0, 2)), tags: p.tags, features: p.feats }));
  const ents = {};
  for (const p of places) ents[p.id] = { id: p.id, type: 'place', name: p.name, geo: [cityName, '市区'], tags: p.tags, openHours: '全天', edges: [], features: p.features, state: {} };
  const link = (a, b, m) => { ents[a].edges.push({ to: b, level: '相邻街区', minutes: m }); ents[b].edges.push({ to: a, level: '相邻街区', minutes: m }); };
  link(zone + '_p1', zone + '_p2', 8); link(zone + '_p1', zone + '_p3', 6); link(zone + '_p1', zone + '_p4', 10);
  // 与主世界车站互连（回程=走回去；跨区边分别写入两边实体）
  const homeStation = Object.values(data.entities).find(p => p.type === 'place' && /车站/.test(String(p.name || '')));
  if (homeStation) {
    ents[zone + '_p1'].edges.push({ to: homeStation.id, level: '相邻街区', minutes: 0 });
  }
  /* v2.02 · P0-6：**一座城 = 一次提交**（4 个地点 + 回程边 + 3 个城市面孔），
     任一条被拒都不落半座城 —— 原来是一串直写，中间出错就是"半座城"。
     城市面孔"见过才认识"：只写 relations/impressions，**不进 knownPeople**。 */
  const props = Object.keys(ents).map(pid => ({ kind: 'create', type: 'place', entity: ents[pid] }));
  if (homeStation) props.push({ kind: 'link', from: homeStation.id, edge: { to: zone + '_p1', level: '相邻街区', minutes: 0 } });
  for (const n of CITY_POOL.npcs) {
    const id = zone + '_' + n.id;
    const rel = {}; rel['player'] = Object.assign({}, data.relations['player'] || {}); rel['player'][id] = { tone: '陌生（没见过面）', causes: [] }; rel[id] = { player: { tone: '陌生（没见过面）', causes: [] } };
    const imp = {}; imp[id] = { stage: 0, seen: '', traits: [], notes: [], bonds: ['还没见过'], nameKnown: null };
    props.push({ kind: 'create', type: 'person', relations: rel, impressions: imp, entity: { id: id, type: 'person', name: n.name, avatar: null, tags: ['城市面孔', cityName], indexes: { geo: [cityName], org: [], family: [] },
      profile: { identity: { 姓名: n.name, 身份: n.role }, appearance: { 标志物: '' }, surface: { 待人: n.surface }, hidden: { 真实: n.hidden }, background: { 经历: '（城市里讨生活的人）' }, schedule: {}, desires: { 现在想: '' }, secrets: { 包袱: '（未知）' } },
      locked: { core: '性格内核（城市面孔）' }, state: { location: zone + '_p1', mood: '平静', fatigue: '中', hunger: '低', sleep: '正常' }, trait: { lambda: 0.06, memory: '普通' }, cityBorn: true } });
  }
  const rec = BUS.commit(data, props, { t: data.current.time });
  const built = rec.committed.filter(x => x.kind === 'create').length >= places.length;
  // 传闻（城市的第一印象=到达语境→ heard）：只有城真的建起来了才有第一印象
  let rumors = 0;
  if (built) for (const r of CITY_POOL.rumors) {
    const rc = BUS.commit(data, [{ kind: 'news', source: 'yearly', newsSeverity: '低', item: { t: data.current.time, title: '初到' + cityName + '：' + r.slice(0, 24), summary: r, tags: ['城市', '传闻'], region: cityName, impact: { 时长: '短期', 范围: '本地' } } }], { t: data.current.time });
    if (rc.committed.length) rumors++;
  }
  /* built 必须反映**真实入库结果**（原来无条件 true）：被拒的城市要能被调用方看出来，
     否则"新城建好了、玩家站在旧城"（travelTick 用的是返回的 zone）。 */
  return { kind: 'city', id: zone, name: cityName, places: places.length, built: built, rumors: rumors, rejected: rec.rejected.slice(0, 2) };
}

// ---------- 调度器 ----------
async function routeRequests(data, cfg, reqs, depth) {
  const out = [];
  const list = Array.isArray(reqs) ? reqs : (reqs ? [reqs] : []);
  for (const req of list.slice(0, 1)) { // 每回合≤1条
    if (!req || !req.kind || KINDS.indexOf(req.kind) < 0) continue;
    if (!requestOk(data)) break;
    data.current = data.current || {};
    data.current.aiTrace = data.current.aiTrace || [];
    data.current.aiTrace.push({ t: data.current.time, call: 'director.request', kind: req.kind, need: String(req.need || '').slice(0, 40) });
    if (data.current.aiTrace.length > 40) data.current.aiTrace.shift();
    data.meta.requestBudget = (data.meta.requestBudget || 0) + 1;
    let r = null;
    try {
      if (req.kind === 'event') r = await EPOCH.summonChain(data, cfg, req);
      else if (req.kind === 'person') r = await genPerson(data, cfg, req);
      else if (req.kind === 'place') r = await genPlace(data, cfg, req);
      else if (req.kind === 'item') r = await genItem(data, cfg, req);
      else if (req.kind === 'org') r = await genOrg(data, cfg, req);   // v1.84：机构（原来没有生成器）
      else if (req.kind === 'action') r = await genAction(data, cfg, req);
      else if (req.kind === 'news') r = await genNews(data, cfg, req);
      else if (req.kind === 'city') r = await genCity(data, cfg, req);
      else r = { kind: req.kind, id: null, note: '（该 kind 生成器未启用：' + req.kind + '）' };
    } catch (e) { r = { kind: req.kind, id: null, note: String(e.message || e).slice(0, 80) }; }
    if (r) out.push(r);
    // 接力链：上游返回 next（带 payload 交代清楚）→ 同一管线继续派下游（同回合、限深）
    const next = r && r.next;
    if (next && Array.isArray(next) && next.length && (depth || 0) < CHAIN_DEPTH) {
      const sub = await routeRequests(data, cfg, next, (depth || 0) + 1);
      for (const s of sub) out.push(s);
    }
    break;
  }
  return out;
}

// ---------- customActions 匹配与执行（parseIntent 优先匹配；effects 白名单执行） ----------
function matchCustom(data, text) {
  const acts = data.customActions || {};
  for (const id of Object.keys(acts)) {
    const a = acts[id];
    const hit = (a.trigger_patterns || []).some(p => p && String(text).indexOf(String(p)) >= 0);
    if (hit) return { kind: 'custom', customId: id, action: a, text: text };
  }
  return null;
}
/* 前置条件的白名单（v1.99 · P0-6 第一批）：只有**声明过执行器**的类型才允许出现在动作里 ——
   与 UPDATE_TYPES 同一条原则（白名单不许含没有执行器的类型）。原来 `preconditions` 声明了却**从没人读**：
   演示动作 hire_cart 写着 `has_money(min:20)`，钱不够照样执行。 */
const PRECONDITIONS = { has_money: '钱够不够' };
function precondOk(data, pre) {
  const t = String((pre && pre.type) || '');
  if (!PRECONDITIONS[t]) return { ok: false, code: 'unknown_precondition', what: t };
  const w = ((data.entities || {}).player || {}).money || {};
  const total = (Number(w.cash) || 0) + (Number(w.digital) || 0);
  if (total < (Number(pre.min) || 0)) return { ok: false, code: 'precondition_failed', what: t, need: Number(pre.min) || 0 };
  return { ok: true };
}
/* 执行一个"玩家自定义动作"（v1.99 · P0-6 第一批：补齐 8 个效果里所有"绕过世界规则"的洞）。
   记着：这仍是**引擎**在改世界，所以钱/物品/移动/账目必须和买卖那条路同构 ——
     钱：走同一套"先电子后现金"的算法，落一条账（原来改钱不落账，重放对不上）
     移动：按 moveCost 花时间 + 记 visited/knownPlaces/weatherSeen（原来**零耗时瞬移**）
     造人：**必须 await**（原来是 fire-and-forget，玩家这一回合看不到人）
   返回值从"字符串数组"改成 { lines, rejected, clockDelta }：opLog 文案一字不变，
   但"被拒"从"打印一句异常"变成结构化记录（调用方可以据此回灌/记账）。 */
async function applyCustom(data, custom, cfg, nowISO) {
  const p = data.entities.player || {};
  const out = [];
  const rejected = [];
  let clockDelta = 0;
  const sceneNow = () => String((data.current && data.current.sceneId) || '');
  // ── 前置条件：任何一条不过 → **整个动作不执行**（三处状态都不变，账本也不动）
  for (const pre of (custom.preconditions || [])) {
    const c = precondOk(data, pre);
    if (!c.ok) {
      rejected.push(c);
      out.push(c.code === 'unknown_precondition' ? ('（这个动作的前置条件引擎不认识：' + c.what + '）') : ('（还不到做这件事的时候——' + (pre.msg || '条件不满足') + '）'));
      return { lines: out, rejected: rejected, clockDelta: 0 };
    }
  }
  for (const fx of (custom.effects || [])) {
    try {
      if (fx.type === 'deduct_money') {
        const w = p.money || (p.money = { cash: 0, digital: 0, spent: 0, earned: 0, currency: '元' });
        const need = Number(fx.amount) || 0;
        if ((w.cash || 0) + (w.digital || 0) < need) {
          rejected.push({ code: 'insufficient_funds', need: need, has: (w.cash || 0) + (w.digital || 0) });
          out.push('钱不够（需' + need + '）');
          continue;
        }
        const fromDig = Math.min(w.digital || 0, need); w.digital -= fromDig; w.cash -= (need - fromDig); w.spent = (w.spent || 0) + need;
        ledgerPush(data, { t: nowISO, type: '物品消耗', target: 'player', desc: '自定义动作支出 ' + need + (w.currency || '元') + '（' + custom.id + '）', cause: custom.id, scene: sceneNow() });
        out.push('花了 ' + need + (w.currency || '元'));
      } else if (fx.type === 'earn_money') {
        const w = p.money || (p.money = { cash: 0, digital: 0, spent: 0, earned: 0, currency: '元' });
        w.cash = (w.cash || 0) + (Number(fx.amount) || 0); w.earned = (w.earned || 0) + (Number(fx.amount) || 0);
        ledgerPush(data, { t: nowISO, type: '物品获取', target: 'player', desc: '自定义动作收入 ' + (Number(fx.amount) || 0) + (w.currency || '元') + '（' + custom.id + '）', cause: custom.id, scene: sceneNow() });
        out.push('得了 ' + (Number(fx.amount) || 0) + (w.currency || '元'));
      } else if (fx.type === 'add_item') {
        p.inventory = p.inventory || [];
        const iid = data.id('item');
        p.inventory.push({ id: iid, name: String(fx.name || '物品').slice(0, 20), can: '', value: 0 });
        ledgerPush(data, { t: nowISO, type: '物品获取', target: 'player', desc: '收下了' + String(fx.name || '物品').slice(0, 20), cause: custom.id, scene: sceneNow(), ref: iid });
        out.push('获得了' + fx.name);
      } else if (fx.type === 'add_entity') {
        /* ★ 原来是 fire-and-forget + 硬编码的空 cfg：世界可能没造出这个人，而玩家这一回合已经过去了。
           现在 await + 用调用方给的真 cfg（在线世界才会真的调模型）。 */
        const r = (fx.kind === 'person')
          ? { kind: 'person', atScene: 1, need: String(fx.name || ''), hint: String(fx.name || '') }
          : { kind: fx.kind || 'item', need: String(fx.name || '') };
        out.push('（add_entity 转交给导演：' + (fx.kind || 'item') + '）');
        try { await routeRequests(data, cfg, r); } catch (e2) { rejected.push({ code: 'create_failed', what: String(fx.kind || 'item'), why: String((e2 && e2.message) || e2).slice(0, 60) }); DEG.hit('director.js', e2); }
      } else if (fx.type === 'move_to') {
        const dest = Object.values(data.entities).find(e => e.type === 'place' && (String(e.name || '').indexOf(String(fx.place || '')) >= 0 || e.id === fx.place));
        if (!dest) { rejected.push({ code: 'no_such_place', what: String(fx.place || '') }); out.push('（没找到' + String(fx.place || '') + '）'); continue; }
        /* 与玩家"去某地"那条路**同构**（game.js 的 地点变化 执行器）：花时间、记去过的地方、刷新天气感知。
           原来这里只有一行"改 sceneId"，等于**免费瞬移**，而且地图上不算去过。 */
        const c = RT.moveCost(data, data.current.sceneId, dest.id, nowISO);
        if (!c.ok) { rejected.push({ code: 'no_route', from: data.current.sceneId, to: dest.id }); out.push('（去不了' + dest.name + '——没有通路）'); continue; }
        if (c.minutes > 0) { data.current.time = RT.addMinutes(data.current.time, c.minutes); clockDelta += c.minutes; }
        data.current.sceneId = dest.id;
        if (p.state) p.state.location = dest.id;
        const k = data.knowledge || (data.knowledge = {});
        if (!Array.isArray(k.visited)) k.visited = [];
        if (!Array.isArray(k.knownPlaces)) k.knownPlaces = [];
        if (k.visited.indexOf(dest.id) < 0) k.visited.push(dest.id);
        if (k.knownPlaces.indexOf(dest.id) < 0) k.knownPlaces.push(dest.id);
        data.current.weatherSeen = !((dest.tags || []).indexOf('室内') >= 0);
        data.current.ambientDone = false;
        ledgerPush(data, { t: nowISO, type: '地点变化', target: 'player', desc: '到了' + (dest.name || ''), cause: custom.id, scene: dest.id, d: { scene: dest.id, place: dest.name || '' } });
        out.push('去了' + dest.name);
      } else if (fx.type === 'ledger') {
        ledgerPush(data, { t: nowISO, type: '自定义动作', target: 'player', desc: String(fx.desc || '').slice(0, 80), cause: custom.id }); out.push(fx.desc);
      } else if (fx.type === 'set_flag') {
        data.current.flags = data.current.flags || {}; data.current.flags[String(fx.key || 'f')] = fx.value; out.push('记了一笔：' + fx.key);
      } else if (fx.type === 'send_msg') {
        const to = Object.values(data.entities).find(e => e.type === 'person' && e.id !== 'player' && String(e.name).indexOf(String(fx.to || '')) >= 0);
        out.push('（消息发出——转导演）');
        if (to) {
          /* v1.99：玩家自己发出的那条消息以前**没有落进 messages** —— 只有一条"待回复"，
             于是对话记录里凭空出现一个回复，玩家说过什么查不到。现在两边都写。 */
          data.messages = data.messages || [];
          data.messages.push({ id: data.id('msg'), from: 'player', to: to.id, body: String(fx.text || '').slice(0, 200), t: nowISO, status: 'sent', via: 'phone' });
          data.current.pendingReplies = data.current.pendingReplies || [];
          data.current.pendingReplies.push({ id: data.id('rep'), from: to.id, to: 'player', due: RT.addMinutes(nowISO, 15), plan: 'reply' });
        } else rejected.push({ code: 'no_such_person', what: String(fx.to || '') });
      } else {
        rejected.push({ code: 'unknown_effect', what: String(fx.type || '') });
      }
    } catch (e) {
      /* v1.99：原来是"把异常打印成一句人话"—— 半成品的世界状态被文案盖住了。
         现在：人话照旧（玩家看得懂），但结构化 rejected 也要留。 */
      rejected.push({ code: 'effect_error', what: String(fx.type || ''), why: String((e && e.message) || e).slice(0, 60) });
      out.push('（效果异常）' + String(e.message || e).slice(0, 40));
    }
  }
  return { lines: out, rejected: rejected, clockDelta: clockDelta };
}

module.exports = { routeRequests, matchCustom, applyCustom, KINDS, EFFECTS };
