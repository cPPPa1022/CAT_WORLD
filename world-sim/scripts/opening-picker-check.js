'use strict';
/* opening-picker-check.js — 开场选择：「读完再选」+「多少条都放得下」的红线（v3.6 / v3.7）
 *
 * 为什么要有它（用户 2026-09-27 报案与追问）：
 *   「这个开场（第二步走完）选择我不满意 看不完剧情我怎么选」
 *   「第一步第二步都走完了 为什么没存？我点击返回/重新扫描 直接没了？」
 *   「兼容多少个开局？如果有 20 个开局呢？是动态适配的你知道吧」
 *   三个问题各对应一个**没有任何东西会响**的洞：
 *     ① 三层截断叠在一起：服务端 200/400 → 界面 90；而进世界后演进 sceneLog 的是 1200。
 *     ② 预览从不落盘（内存票据），而"返回"连界面那一份也丢了 ⇒ 只能重扫。
 *     ③ **开场条数被四处各写一份 slice(0,4)** —— 20 条备选开局的卡，玩家永远只看到 5 条。
 *
 * 这份脚本量三件事（缺一个都有盲区）：
 *   A. **静态**：截断不许回来 / 三处共用一份实现 / 窗口能滚 / 条数不再被砍 / 按条数换形状。
 *   B. **行为**：真起服务 + 假模型（0 token、0 联网），拿**20 条备选开局**走完整条链：
 *      预览 → 缓存存活 → 建世界 → 卡盒全文 → 从卡开局选中第 20 条 / 主开场 → 落库的 meta.greetings。
 *
 * 用法：node scripts/opening-picker-check.js（失败非零退出）
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  OK   ' + m)) : (fail++, console.log('  FAIL ' + m)); };

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
/* 只看活代码：注释里保留"原来长这样"是好事，不该被误伤（与 ui-shell-check 同一手法） */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');
const AJ = strip(read('public/app.js'));
const SRV = read('server.js');
const CSS = read('public/style.css');

console.log('');
console.log('开场选择 · 一、静态：截断不许回来，条数不许被砍，三处共用一份实现');

/* [1] 界面里不许再有"每条只显示 90 字" */
{
  const hits = (AJ.match(/\.slice\(\s*0\s*,\s*90\s*\)/g) || []);
  ok(hits.length === 0, 'app.js 里没有 slice(0,90) —— 开场不再是 90 字摘要（实测 ' + hits.length + ' 处）');
  ok(!/\.pick-row/.test(AJ), '旧的 .pick-row 列表已从 app.js 清干净（它在 style.css 里的样式可以留着）');
}
/* [2] 服务端：开场池不许截断 */
{
  const pool = (SRV.match(/function openingPoolOf\(pk\)[\s\S]*?\n\}/) || [''])[0];
  ok(pool.length > 0, 'openingPoolOf() 存在（服务端侧的入口）');
  ok(pool.length > 0 && !/\.slice\(\s*0\s*,\s*(200|400|4)\s*\)/.test(pool), '开场池不再截断（原 200/400 与 slice(0,4)）');
  ok(/const pool = openingPoolOf\(pk\);/.test(SRV), 'packPreview 用的是这份池（不是自己再拼一遍）');
}
/* [3] 三处入口共用同一份窗口实现（原来是被复制了三份的 90 字列表） */
{
  const n = (AJ.match(/openingPanes\(/g) || []).length;
  ok(n >= 3, '三处入口都走 openingPanes（扫描预览 / 卡盒 / AI 生成世界）—— 实测调用点 ' + n + ' 处');
  ok(/function openingPanes\(host, list\)/.test(AJ) && /function openingName\(i, n\)/.test(AJ), '窗口实现与命名（备选开局 N / 主开场）都在');
}
/* [4] 窗口必须能滚（滚轮读全文），且是大界面 */
{
  const body = (CSS.match(/\.op-body\s*\{[^}]*\}/) || [''])[0];
  ok(/overflow-y\s*:\s*auto/.test(body), '.op-body 自己滚（overflow-y:auto）—— 滚轮读全文靠它');
  ok(/flex\s*:\s*1 1 auto/.test(body) && /min-height\s*:\s*0/.test(body), '.op-body flex + min-height:0（不然子元素撑破父容器，滚不出来）');
  const box = (CSS.match(/#modal \.box\.opbox\s*\{[^}]*\}/) || [''])[0];
  ok(/width\s*:\s*min\(\s*15\d\dpx/.test(box) || /width\s*:\s*min\(15/.test(box), '大界面：.opbox 宽度 ≥1400px 级别（现状 ' + ((box.match(/width:[^;]+/) || ['(未设)'])[0]) + '）');
  ok(/height\s*:\s*92vh/.test(box), '.opbox 用满高度（92vh）—— 窗口才有地方读');
}
/* [5] 两个只读端点在（全文 + 缓存存活），且都是 GET（不碰世界、不需要世界锁） */
{
  ok(/u\.pathname === '\/api\/cards\/openings'/.test(SRV), 'GET /api/cards/openings 在（卡档里的开场全文）');
  ok(/u\.pathname === '\/api\/scan\/alive'/.test(SRV), 'GET /api/scan/alive 在（上次扫描的结果还在不在）');
  const gl = SRV.indexOf("'/api/cards/openings'");
  const inGet = SRV.lastIndexOf("req.method === 'GET'", gl) > SRV.lastIndexOf('// ---------- POST', gl);
  ok(gl > 0 && inGet, '/api/cards/openings 挂在 GET 分支里（只读，不写盘）');
}
/* [5.5] ★ v3.7：**开场条数不再被砍**（用户问「如果有 20 个开局呢？是动态适配的你知道吧」）。
   改前有四处各写一份 slice(0,4)：分析素材 / 启发式 / 落库归一化 / 服务端预览池
   —— 一张 20 条备选开局的卡，到玩家眼前永远只有 5 条，而且没有任何东西会说少给了。 */
{
  const IMP = read('src/import.js');
  const poolFn = (IMP.match(/function openingPool\(pack\)[\s\S]*?\n\}/) || [''])[0];
  ok(poolFn.length > 0, 'import.js 有开场池的唯一推导点 openingPool(pack)');
  ok(poolFn.length > 0 && !/\.slice\(\s*0\s*,\s*4\s*\)/.test(poolFn), '开场池不再 slice(0,4)（20 条就是 20 条）');
  ok(/module\.exports = \{ openingPool,/.test(IMP), 'openingPool 导出了（服务端要调同一份）');
  ok(/return IMP\.openingPool\(pk \|\| \{\}\);/.test(SRV), '服务端的池委托给 import 的那一份（不再自己写第二份账）');
  const norm = (IMP.match(/pack\.alternates = Array\.isArray\(pack\.alternates\)[^\n]*/) || [''])[0];
  ok(norm.length > 0 && !/\.slice\(/.test(norm), '落库归一化不再截断备选（原 slice(0,4) + slice(0,400)）');
  ok(/meta\.greetings = pool;/.test(IMP), 'meta.greetings 存**全部**开场（原来 slice(0,5)）');
  ok(/filter\(a => !isJunkOpening\(a\)\)\.map\(a => String\(a\)\)/.test(IMP), '启发式兜底也给全（保留垃圾开局过滤）');
}
/* [5.6] ★ v3.7：界面按条数换形状（≤4 并排 / >4 左列小窗 + 右栏大窗） */
{
  ok(/function openingLead\(/.test(AJ) && (AJ.match(/openingLead\(/g) || []).length >= 4, '提示语由 openingLead 统一给（三处入口不各写一份）');
  ok(/\.opgrid\.many/.test(CSS) && /\.op-rail/.test(CSS) && /\.op-read/.test(CSS), 'CSS 有 .opgrid.many / .op-rail / .op-read');
  ok(/host\.classList\.toggle\('many', MANY\)/.test(AJ), '条数 >4 时 JS 打上 .many（动态适配）');
  ok(/\.op-card\.mini \.op-body\s*\{\s*display\s*:\s*none/.test(CSS), '小窗里不铺正文（正文只在右栏那一个窗口里）');
}
/* [6] §7.6：返回不再丢扫描；而且"回去"之前先问一句服务端它还在不在 */
{
  ok(/let LAST_SCAN = null;/.test(AJ), 'LAST_SCAN 存在（上一次扫描的预览不再随弹窗消失）');
  ok(/\/api\/scan\/alive\?id=/.test(AJ), '导入框里"回到刚才那次扫描"先查存活（不在就说实话，不假装能回去）');
  ok(/m\.appendChild\(LAST_SCAN\.box\)/.test(AJ), '回去时把整块预览挂回去（连滚动位置一起）');
  ok(/LAST_SCAN = null;/.test(AJ), '进了世界就清掉它（不再需要这条退路）');
  ok(!/back2\.onclick = \(\) => \{ m\.classList\.add\('hidden'\); openImport\(\); \};/.test(AJ), '旧的那行"直接开导入框"已经不在（那行把这次扫描扔了）');
}

/* ───────────────────────── 二、行为（真服务 + 假模型） ───────────────────────── */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-open-'));
process.env.WORLD_SIM_DATA = TMP;
process.env.WORLD_SIM_ASSETS = ROOT;
process.env.PORT = '3977';
const PORT = 3977;
if (path.resolve(process.env.WORLD_SIM_DATA) === path.resolve(ROOT)) throw new Error('拒绝运行：数据目录指向仓库（会写坏真实存档）');
fs.writeFileSync(path.join(TMP, 'config.json'), JSON.stringify({
  llm: { baseURL: 'http://127.0.0.1:9/v1', apiKey: 'k', model: 'fake', maxTokens: 393216, timeoutMs: 20000 },
  roles: {}, image: { enabled: false }, port: PORT
}), 'utf8');

/* ★ 20 条备选开局（每条都超过旧的 400 字截断线）：这样"少给"和"截断"两种病都躲不过 */
const NALT = 20;
const ALTS = [];
for (let i = 1; i <= NALT; i++) ALTS.push('【备选' + i + '】' + ('第' + i + '条开场的正文。她把伞收起来靠在门边，鞋跟在地垫上蹭了两下。'.repeat(14)));
const FS = '【主开场】你推开那扇门。' + '屋里比外面暗，桌上摊着一份没写完的稿子，墨迹还没干。'.repeat(20);

const REAL = globalThis.fetch;
const calls = [];
globalThis.fetch = async function (url, init) {
  const u = String(url || '');
  if (u.indexOf('/chat/completions') < 0) return REAL(url, init);     // 自己的 HTTP 调用照走真网络
  const body = JSON.parse((init && init.body) || '{}');
  const sys = String(((body.messages || [])[0] || {}).content || '');
  calls.push(sys);
  const J = (o) => JSON.stringify(o);
  let content = '{}';
  if (/世界分析师/.test(sys)) content = '## 零、身份证\n题材：测试 / 日常\n戏：测试\n调性：日常\n不是什么：不是战斗卡\n## 一、世界\n小镇\n';
  else if (/扫描 AI/.test(sys)) content = J({
    meta: { name: '开场测试镇', era: '九十年代 · 小镇', carries: { time: 'brick', news: 'paper', map: 'paper', note: 'letter' } },
    time: '1996-06-14T20:45:00', weather: '雨',
    player: { name: '你', identity: '修理工', origin: '本地人' },
    npcs: [{ id: 'npc1', name: '老周', inScene: true, rel: '旧识', relHow: '住隔壁', bond: '旧识' }],
    places: [{ id: 'p1', name: '街上' }],
    firstScene: FS, alternates: ALTS,
    rules: ['测试规则'], filled: [{ what: '老周的职业', why: '卡里没写' }], conflicts: []
  });
  else if (/开局编译/.test(sys)) content = J({ player: { fields: { 身份: '修理工' } }, npcs: [{ id: 'npc1', fields: { 职业: '铺主' } }], world: { fields: {} } });
  else if (/主AI|岗位说明书/.test(sys)) content = J({ frame: { tag: '测试·夜·雨', focus: [], suggestions: [], beats: [{ type: 'narration', text: '街上很静。' }] }, updates: [] });
  if (body.stream) {
    const enc = new TextEncoder();
    const chunk = 'data: ' + JSON.stringify({ choices: [{ delta: { content: content } }] }) + '\n\n'
      + 'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) + '\n\n'
      + 'data: [DONE]\n\n';
    return { ok: true, status: 200, text: async () => content, json: async () => ({ choices: [{ message: { content: content }, finish_reason: 'stop' }] }), body: new ReadableStream({ start(c) { c.enqueue(enc.encode(chunk)); c.close(); } }) };
  }
  return { ok: true, status: 200, text: async () => content, json: async () => ({ choices: [{ message: { content: content }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), body: null };
};

const server = require('../server');
const B = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const post = async (p, b) => (await (await REAL('http://127.0.0.1:' + PORT + p, B(b))).json());
const get = async (p) => (await (await REAL('http://127.0.0.1:' + PORT + p)).json());

const CARD = {
  name: '开场测试卡', description: '阿岩在镇上开修理铺。', personality: '闷葫芦',
  first_mes: '你推开门。', scenario: '镇上', alternate_greetings: ALTS
};

(async () => {
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  console.log('');
  console.log('开场选择 · 二、行为：' + NALT + ' 条备选开局走完预览 → 建世界 → 卡盒 → 从卡开局');

  /* ① 预览：21 条（20 备选 + 主开场）都要在，而且逐字全文 */
  const pv = await post('/api/new', { src: 'json', payload: JSON.stringify(CARD), role: 'npc', preview: true });
  const po = (pv.preview && pv.preview.openingList) || [];
  ok(po.length === NALT + 1, '★ 预览给出 ' + (NALT + 1) + ' 条（' + NALT + ' 备选 + 主开场）—— 实测 ' + po.length + '（旧的 slice(0,4) 会在这里红成 5）');
  ok(po[0] === ALTS[0] && po[5] === ALTS[5] && po[19] === ALTS[19], '★ 第 1 / 第 6 / 第 20 条都逐字对上（顺序也不能乱）');
  ok(po[NALT] === FS, '主开场永远在最后一条（下标空间与落库一致）');
  ok(String((po[0] || '')).length === ALTS[0].length && ALTS[0].length > 400, '★ 单条长度 ' + (po[0] || '').length + ' 字（旧的 400 字截断会在这里红）');
  ok(!!pv.scanId, '预览给了 scanId（建世界复用它，不重扫）');
  /* ★ v3.18（用户 2026-09-27）：「存到模拟器的卡盒里面啊 这就是差第三步而已」——
     第一+二步走完（预览）就该落卡盒，不再等「进入世界」。 */
  const cbox = await get('/api/cards');
  const c0 = (cbox.list || [])[0] || {};
  ok((cbox.list || []).length === 1 && c0.entered === false, '★ 预览完就进了卡盒（entered=false，实测 ' + JSON.stringify((cbox.list || []).length) + ' 张 / entered=' + c0.entered + '）');
  ok(c0.openings === NALT + 1, '卡盒里开场条数也对（' + c0.openings + '）');

  /* ② 缓存存活端点（§7.6 的"回去之前先问一句"） */
  const aliveYes = await get('/api/scan/alive?id=' + encodeURIComponent(pv.scanId));
  const aliveNo = await get('/api/scan/alive?id=scan_不存在');
  ok(aliveYes.alive === true, '/api/scan/alive：这次扫描**还在**（可以回到预览，不必重扫）');
  ok(aliveNo.alive === false, '/api/scan/alive：不存在的 id 说 false（不假装能回去）');

  /* ③ 建世界（复用 scanId，选第 20 条）→ 卡档落盘 */
  const nw = await post('/api/new', { src: 'json', payload: JSON.stringify(CARD), role: 'npc', greeting: NALT - 1, scanId: pv.scanId });
  ok(!!nw.view && !!nw.archived, '建世界跑通并建档（archived=' + nw.archived + '）');
  const cbox2 = await get('/api/cards');
  ok(((cbox2.list || [])[0] || {}).entered === true, '★ 进世界之后 marked entered=true（第三步入档）');
  const first = ((nw.view || {}).sceneLog || []).find((x) => x.type === 'narration') || {};
  ok(String(first.text || '').indexOf('【备选20】') === 0, '选第 20 条（greeting=19）⇒ 第一帧就是它（实测开头：' + String(first.text || '').slice(0, 12) + '）');
  ok(String(first.text || '').length <= 1200, '进 sceneLog 的正文仍然按 1200 字封顶（这条没被动过）');

  /* ④ 卡盒：列表仍旧轻（摘要），但**条数是真的**；全文走新端点 */
  const cl = await get('/api/cards');
  const card = (cl.list || []).find((c) => c.id) || {};
  ok(cl.count === 1 && card.openings === NALT + 1, '卡盒那行说"开场 ' + card.openings + ' 条"（摘要短，数字不能撒谎）');
  const full = await get('/api/cards/openings?id=' + encodeURIComponent(card.id));
  ok(full.ok === true && (full.list || []).length === NALT + 1, 'GET /api/cards/openings 给出 ' + (NALT + 1) + ' 条');
  ok(full.list[0] === ALTS[0] && full.list[19] === ALTS[19] && full.list[NALT] === FS, '★ 卡盒这条路上也是 21 条逐字全文（不再吃建档时的摘要/截断）');
  const bad = await get('/api/cards/openings?id=c_不存在');
  ok(bad.ok === false && !!bad.err, '卡不存在时说清楚（不静默给空列表）');

  /* ⑤ 从卡盒开局：选哪条就是哪条（下标必须与全文列表一致） */
  const l1 = await post('/api/cards/launch', { id: card.id, greeting: NALT - 1 });
  const f1 = ((l1.view || {}).sceneLog || []).find((x) => x.type === 'narration') || {};
  ok(String(f1.text || '').indexOf('【备选20】') === 0, '卡盒选第 20 条 ⇒ 第一帧是备选20（下标对齐）');
  const l2 = await post('/api/cards/launch', { id: card.id, greeting: NALT });
  const f2 = ((l2.view || {}).sceneLog || []).find((x) => x.type === 'narration') || {};
  ok(String(f2.text || '').indexOf('【主开场】') === 0, '卡盒选主开场（最后一条）⇒ 第一帧是主开场');
  const l3 = await post('/api/cards/launch', { id: card.id, greeting: 3 });
  const f3 = ((l3.view || {}).sceneLog || []).find((x) => x.type === 'narration') || {};
  ok(String(f3.text || '').indexOf('【备选4】') === 0, '卡盒选第 4 条 ⇒ 第一帧是备选4（第 5 条之后确实可达了）');

  /* ⑥ 落库那一步：meta.greetings 必须存全部（那是"换个开场重开一局"的料） */
  try {
    const wdir = path.join(TMP, 'data', 'worlds');
    const files = fs.readdirSync(wdir).map(n => ({ n: n, t: fs.statSync(path.join(wdir, n)).mtimeMs })).sort((a, b) => b.t - a.t);
    const world = JSON.parse(fs.readFileSync(path.join(wdir, files[0].n), 'utf8'));
    const gs = (world.meta || {}).greetings || [];
    ok(gs.length === NALT + 1, '★ 世界文件里 meta.greetings 存了 ' + gs.length + ' 条（原来 slice(0,5) 会红成 5）');
    ok(gs[19] === ALTS[19] && gs[0] === ALTS[0], '存的是逐字全文（第 1 与第 20 条都对得上）');
  } catch (e) { ok(false, '读世界文件失败：' + String((e && e.message) || e)); }

  /* ⑦ 假模型自证：这次真走了 AI 那条路（不然上面测的是启发式） */
  ok(calls.filter((s) => /世界分析师/.test(s)).length === 3, '分析分包跑了 3 次（假模型，0 token）');

  console.log('');
  console.log('==== opening-picker-check: ' + pass + ' passed, ' + fail + ' failed ====');
  try { server.close(); } catch (e) { }
  setTimeout(() => process.exit(fail ? 1 : 0), 120);
})().catch((e) => {
  console.error('脚本自己炸了：' + ((e && e.stack) || e));
  try { server.close(); } catch (e2) { }
  setTimeout(() => process.exit(2), 120);
});
