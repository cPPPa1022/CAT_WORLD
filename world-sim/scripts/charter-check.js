'use strict';
// charter-check.js — 「宪章覆盖面」断言（2026-09-26 用户定的硬规矩）
//
// 用户原话：「只要是调用到 ai 的 不论是什么 都需要带上完整版 687 字。」
//
// 为什么需要一条断言来守它：
//   这条规矩原来**存在过**（宪章本来就写着"每类调用都带"），但它分了两档 ——
//   完整版只给主 AI 与存档修复员，其余全用 74 字的「精简版」，还有 17 个调用点一个字都没带
//   （分析 / 建世界 / 开局编译 / 世界生成 / 设定核对 / 6 个生成器 / 时代演算 / 长相档案 / 旧副 AI 三件套）。
//   而**漏了不会有任何东西响** —— 这正是要修的病。实测后果：同一张卡，带「不许审查」的第 2 步建世界成功，
//   什么都没带的第 1 步分析被拒答（analysis 长度 0），玩家那份存档就是这么残的。
//
// 两种查法一起用（缺一个都有盲区）：
//   ① 静态：每个 `role:'system'` 要么自己过了 withCharter，要么它调的那个构造器里过了。
//      —— 能抓住"新写的调用点"，但抓不住"运行时会不会真的走它"。
//   ② 行为：桩掉网络，驱动一圈**真实流程**，断言每条**真的发出去**的 system 都含完整宪章。
//      —— 抓得住真实行为，但抓不住"今天没被任何流程跑到的新分支"。
//   两个一起，才是真的"漏了就响"。用法：node scripts/charter-check.js（失败非零退出）
const fs = require('node:fs');
const path = require('node:path');
/* V8 默认只留 10 帧，而这里要顺着 fetch → llmOnce → llmJSON → 业务函数往回找调用点，
   深一点的流程（runTurn → dispatch → executor）会直接掉出窗口 —— 报告里就成了一片"(未知)"。 */
Error.stackTraceLimit = 60;

// ── 数据目录隔离：绝不碰用户存档（与其它断言脚本同一口径）──────────────────
const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(require('node:os').tmpdir(), 'ws-charter-' + Date.now());
fs.mkdirSync(path.join(TMP, 'data', 'presets', 'content'), { recursive: true });
process.env.WORLD_SIM_DATA = TMP;
process.env.WORLD_SIM_ASSETS = ROOT;

const AI = require('../src/ai');
const W = require('../src/world');
const G = require('../src/game');
const OPEN = require('../src/opening');
const WG = require('../src/worldgen');
const IMP = require('../src/import');
const REP = require('../src/repair');
const EP = require('../src/epoch');
const SUB = require('../src/subai');
const DIR = require('../src/director');
const SCHED = require('../src/scheduler');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  OK   ' + m)) : (fail++, console.log('  FAIL ' + m)); };

/* 去掉块注释。为什么必须去：解释性注释里会**引用**这些名字
   —— 比如 ai.js 里"`charterShort()` 于 2026-09-26 删除"那段说明，
   不去掉就会被当成"还在引用"，于是断言在自己造的红灯上打转。 */
function stripBlockComments(s) { return String(s).replace(/\/\*[\s\S]*?\*\//g, ''); }

/* 静态：每个 role:'system' 都要摸得到宪章 ═══════════════════════════
   判定链：这一行自己过了 withCharter / charter()
        → 或者它是 `content: NAME(`，而同一个文件里 `function NAME` 的**函数体**里摸得到宪章
        → 或者它是 `AI.SYSTEM(`（那一个内部 push 了 charter()）

   ⚠️ 找函数体**不能数花括号**：这些构造器的提示词里全是 JSON 模板（{...}），
   数括号会当场数错。这个代码库的风格是顶层函数以**行首的 `}`** 结束，按那个切最稳。 */
function staticScan() {
  const dir = path.join(ROOT, 'src');
  const bare = [], resolved = [];
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.js'))) {
    const raw = fs.readFileSync(path.join(dir, f), 'utf8');
    const src = stripBlockComments(raw);
    const lines = src.split('\n');
    lines.forEach((ln, i) => {
      if (!/role:\s*'system'/.test(ln)) return;
      const at = f + ':' + (i + 1);
      if (/withCharter|charter\(\)/.test(ln)) { resolved.push({ at, how: '本行直接过 withCharter' }); return; }
      const m = /content:\s*([A-Za-z_$][\w$.]*)\s*\(/.exec(ln);
      const name = m ? String(m[1]).split('.').pop() : '';
      if (name === 'SYSTEM') { resolved.push({ at, how: 'AI.SYSTEM() 内部 push(charter())' }); return; }
      if (name) {
        const head = lines.findIndex((l, j) => j <= i && new RegExp('^function\\s+' + name + '\\s*\\(').test(l));
        if (head >= 0) {
          let end = lines.length;
          for (let j = head + 1; j < lines.length; j++) { if (/^\}/.test(lines[j])) { end = j; break; } }
          const body = lines.slice(head, end).join('\n');
          if (/withCharter\(|charter\(\)/.test(body)) { resolved.push({ at, how: '构造器 ' + name + '() 里过 withCharter' }); return; }
        }
      }
      bare.push({ at, line: ln.trim().slice(0, 90) });
    });
  }
  return { bare, resolved };
}

/* ══ ② 行为：桩掉网络，驱动真实流程，看**真的发出去**的 system ══════════ */
const calls = [];           // { site, system }
const realFetch = globalThis.fetch;
function installStub() {
  globalThis.fetch = async function (url, init) {
    const u = String(url || '');
    if (!/\/chat\/completions\/?$/.test(u) || !init || init.method !== 'POST') return realFetch.apply(this, arguments);
    let body = {};
    try { body = JSON.parse(init.body || '{}'); } catch (e) { }
    const msgs = body.messages || [];
    const sys = String(((msgs[0] || {}).content) || '');
    // 调用点：栈里第一个既不是传输层、也不是**本脚本自己**的帧
    /* ⚠️ 判"是不是传输层"要**按函数名精确比**，不能用 `Object\.\w+` 这种粗正则 ——
       第一版就是这么写的，结果把 `Object.exCalc`、`Object.runTurn`、`Object.routeRequests`
       这些**真正的业务调用者**全跳过了（它们都是 `Object.xxx [as fn]` 形态），
       报告里于是出现 18 条"(未知)"，而断言照样全绿 —— 一个只会报喜的探针。 */
    const st = String(new Error().stack || '').split('\n').slice(1).map(s => s.replace(/^\s*at\s+/, ''));
    const TRANSPORT = new Set(['llmOnce', 'llmOnceFull', 'llmJSON', 'llmJSONDeep', 'llmText']);
    const fnName = (frame) => { const m = /^([^\s(]+)/.exec(frame); return m ? m[1].split('.').pop() : ''; };
    const srcDir = path.join(ROOT, 'src') + path.sep;
    const f0 = st.find(x => !TRANSPORT.has(fnName(x))
      && x.indexOf(__filename) < 0
      && x.indexOf('charter-check') < 0
      && x.indexOf(srcDir) >= 0) || '';
    const mm = /\(?([^()]+):(\d+):\d+\)?$/.exec(f0);
    calls.push({ site: mm ? path.basename(mm[1]) + ':' + mm[2] : '(未知)', system: sys, role: String(((msgs[0] || {}).role) || '') });
    const content = stubFor(sys);
    return {
      ok: true, status: 200,
      text: async () => content,
      json: async () => ({ choices: [{ message: { content: content }, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0 } }),
      body: null
    };
  };
}
/* 桩响应：内容不重要，**重要的是让流程往下走**（走不下去，后面的调用点就抓不到） */
function stubFor(sys) {
  const J = (o) => JSON.stringify(o);
  if (sys.indexOf('主AI') >= 0) return J({ frame: { tag: '测试·白天·晴', focus: [], suggestions: [], beats: [] }, updates: [] });
  if (sys.indexOf('开局编译') >= 0) return J({ player: { fields: {} }, npcs: [], world: { fields: {} } });
  if (sys.indexOf('世界分析师') >= 0) return '## 零、身份证\n题材：测试\n戏：测试\n调性：测试\n不是什么：测试\n';
  if (sys.indexOf('扫描 AI') >= 0) return J({ meta: { name: '测试镇', era: '九十年代 · 小镇' }, time: '1996-06-14T20:45:00', weather: '晴', player: { name: '你' }, npcs: [{ id: 'npc1', name: '老周', inScene: true }], places: [{ id: 'p1', name: '街上' }], firstScene: '街上很静。', rules: ['测试规则'] });
  if (sys.indexOf('世界生成器') >= 0) return J({ meta: { name: '测试镇', era: '九十年代' }, time: '1996-06-14T20:45:00', weather: '晴', player: { name: '你' }, npcs: [{ name: '老周', inScene: true }], places: [{ name: '街上' }], firstScene: '街上很静。', rules: [] });
  if (sys.indexOf('设定核对员') >= 0) return J({ status: 'pass', issues: [] });
  if (sys.indexOf('副 AI-计算') >= 0) return J({ candidates: [] });
  if (sys.indexOf('副 AI-编辑') >= 0) return J({ news: [] });
  if (sys.indexOf('副 AI-摘要') >= 0) return J({ digest: '' });
  if (sys.indexOf('副 AI-消息') >= 0) return J({ body: null });
  if (sys.indexOf('人物生成器') >= 0) return J({ name: '陈小满', role: '学徒', surface: '话少', hidden: '欠着钱', appearance: '短寸头', backstory: '本地人' });
  if (sys.indexOf('地点生成器') >= 0) return J({ name: '河堤', desc: '一段土堤', tags: ['室外'] });
  if (sys.indexOf('物品生成器') >= 0) return J({ name: '搪瓷缸子', price: 3, desc: '掉了块瓷' });
  if (sys.indexOf('机构生成器') >= 0) return J({ name: '运输队', role: '管拉货', surface: '几个司机凑的', hidden: '有两本账' });
  if (sys.indexOf('规则生成器') >= 0) return J({ id: 'act_test', trigger_patterns: ['测试'], preconditions: [], effects: [] });
  if (sys.indexOf('新闻/传闻生成器') >= 0) return J({ title: '镇上要修路了', summary: '听说下月动工', severity: '低' });
  if (sys.indexOf('世界演算 AI') >= 0) return J({ year: 2001, eraLabel: '二〇〇一年', tech: [], events: [] });
  if (sys.indexOf('事件链生成器') >= 0) return J({ pre: { at: '1996-06-01T08:00:00', title: '预兆', summary: '一句话' }, main: { at: '1996-06-20T08:00:00', title: '主事件', summary: '一句话' } });
  if (sys.indexOf('角色模拟器') >= 0) return J({ line: '嗯。', action: '点头', inner: '看看' });
  if (sys.indexOf('SillyImage Lab') >= 0) return J({ sceneTitle: '测试', prompt: '测试' });
  if (sys.indexOf('档案') >= 0 || sys.indexOf('九维') >= 0) return J({ nine: {} });
  return '{}';
}

(async () => {
  const cfg = { llm: { baseURL: 'http://127.0.0.1:9/v1', apiKey: 'sk-charter-stub', model: 'stub', maxTokens: 8192 }, roles: {}, image: { enabled: true, mode: 'zit' } };
  const demo = W.buildDemoWorld();

  console.log('');
  console.log('宪章覆盖面 —— 每一个送进模型的 system 都必须带完整版 687 字');
  console.log('');

  /* ---- ① 静态 ---- */
  console.log('① 静态：每个 role:system 都摸得到宪章');
  const { bare, resolved } = staticScan();
  ok(resolved.length > 0, '静态扫到 ' + resolved.length + ' 个调用点都接上了宪章');
  ok(bare.length === 0, '没有一个 role:system 是裸的' + (bare.length ? '（实得 ' + bare.length + ' 个）：\n' + bare.map(b => '         ★ ' + b.at + '  ' + b.line).join('\n') : ''));
  ok(resolved.some(r => /withCharter/.test(r.how)), '至少有一处是显式过 withCharter 的（不是靠巧合）');

  /* ---- ② 行为 ---- */
  console.log('');
  console.log('② 行为：桩掉网络，跑一圈真实流程');
  installStub();
  const scenes = [];
  const run = async (name, fn) => {
    const n0 = calls.length;
    try { await fn(); } catch (e) { scenes.push(name + '（失败：' + String((e && e.message) || e).slice(0, 60) + '）'); return; }
    scenes.push(name + '（+ ' + (calls.length - n0) + ' 次调用）');
  };

  await run('跑真回合 act/sleep/shop', async () => {
    await G.runTurn(W.buildDemoWorld(), '你好', cfg);
    await G.runTurn(W.buildDemoWorld(), '睡觉', cfg);
    await G.runTurn(W.buildDemoWorld(), '买牛奶', cfg);
  });
  await run('发消息', async () => { const d = W.buildDemoWorld(); await G.sendMessage(d, '在吗', 'npc_1', cfg); });
  await run('开局编译', async () => { await OPEN.compile(W.buildDemoWorld(), cfg); });
  await run('世界生成 + 设定核对', async () => { await WG.genWorldPack(cfg, '九十年代末的中国小镇', {}); await WG.checkSetup(WG.randomPack(''), {}, cfg); });
  await run('角色卡：分析 + 建世界', async () => { await IMP.scanCard({ name: '测试卡', description: '一张测试卡。', first_mes: '你好。' }, cfg, false); });
  await run('副 AI 三件套', async () => {
    const d = W.buildDemoWorld(); d.current.turnN = 5;
    await SUB.subCalc(d, cfg, {}); await SUB.subEdit(d, cfg, d.current.time); await SUB.subDigest(d, cfg, d.current.time);
  });
  await run('调度器各座位', async () => {
    const d = W.buildDemoWorld();
    await SCHED.exCalc(d, cfg, {}); await SCHED.exDigest(d, cfg, {});
    await SCHED.exReply(d, cfg, { npc: 'npc_1' });
    await SCHED.executors.actor.fn(d, cfg, { npcId: 'npc_1', context: '面对眼前的人，你的反应？' });
    await SCHED.executors.image.fn(d, cfg, { img: { who: ['npc_1'], state: '擦柜台', kind: 'scene', at: 0 } });
    await SCHED.exNews(d, cfg, { payload: { from: 'npc_1', t: d.current.time } });
  });
  await run('生成器 6 个', async () => {
    for (const k of ['person', 'place', 'item', 'org', 'action', 'news']) {
      try { await DIR.routeRequests(W.buildDemoWorld(), cfg, [{ kind: k, need: '测试', hint: '随便' }]); } catch (e) { }
    }
  });
  await run('时代演算 + 人物召唤', async () => {
    const d = W.buildDemoWorld(); await EP.catchup(d, cfg, '1997-07-01T08:00:00');
    try { await EP.summonChain(W.buildDemoWorld(), cfg, { kind: 'person', need: '测试' }); } catch (e) { }
  });
  await run('存档修复', async () => { try { await REP.aiSuggest(W.buildDemoWorld(), cfg, { findings: [{ what: '测试', why: '测试' }] }); } catch (e) { } });
  await run('长相档案', async () => { try { await G.genProfile(W.buildDemoWorld(), 'npc_1', cfg); } catch (e) { } });
  globalThis.fetch = realFetch;

  console.log('  流程覆盖：' + scenes.join(' · '));
  const sysCalls = calls.filter(c => c.role === 'system');
  ok(sysCalls.length >= 15, '抓到 ' + sysCalls.length + ' 条真实的 system 消息（够不够广：≥15）');

  const CHARTER_MARKS = ['【叙事主权 · 虚构授权环境】', '【认知隔离 · 不许用元知识】', '（预录）收到：我忠实演绎本世界的运行逻辑'];
  const missing = [];
  for (const c of sysCalls) {
    const miss = CHARTER_MARKS.filter(m => c.system.indexOf(m) < 0);
    if (miss.length) missing.push({ site: c.site, miss: miss.join('/'), head: c.system.slice(0, 50) });
  }
  ok(missing.length === 0, '★ 每一条发出去的 system 都含完整宪章' + (missing.length ? '（' + missing.length + ' 条缺）：\n' + missing.map(m => '         ★ ' + m.site + '  缺 ' + m.miss + '  ← ' + m.head).join('\n') : ''));

  // 完整版 = 687 字那一份：抽查一条，确认不是被换了别的东西
  const full = AI.charter();
  ok(full.length === 687, 'AI.charter() 是完整版（687 字，实得 ' + full.length + '）');
  const one = sysCalls.find(c => c.system.indexOf(full.slice(0, 40)) >= 0);
  ok(!!one, '至少有一条 system 把完整宪章**整段**放进去了（不是只抄了半句）');

  // withCharter 是唯一入口：不该再有手写的 `charter() + ` 拼接
  /* ⚠️ 判据要看**剥掉注释后的代码**，而且要把 `withCharter` 自己的函数体排除掉 ——
     它的实现就是 `return charter() + '\n' + text`，那正是**被允许的唯一一处**。
     第一版没排除它，于是断言咬着自己的尾巴报红灯。 */
  const srcFiles = fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.js'));
  const codeOf = {};
  for (const f of srcFiles) codeOf[f] = stripBlockComments(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'));
  const handWritten = [];
  const shortLeft = [];
  for (const f of srcFiles) {
    const lines = codeOf[f].split('\n');
    const wc = lines.findIndex(l => /^function\s+withCharter\s*\(/.test(l));
    let wcEnd = -1;
    if (wc >= 0) { for (let j = wc + 1; j < lines.length; j++) { if (/^\}/.test(lines[j])) { wcEnd = j; break; } } }
    lines.forEach((ln, i) => {
      if (wc >= 0 && i >= wc && i < wcEnd) return;                     // withCharter 自己的实现，放行
      if (/charter\(\)\s*\+/.test(ln)) handWritten.push(f + ':' + (i + 1));
      if (/charterShort/.test(ln)) shortLeft.push(f + ':' + (i + 1));
    });
  }
  ok(handWritten.length === 0, '没有手写的 `charter() + ` 拼接（一律走 withCharter，实得 ' + handWritten.length + ' 处' + (handWritten.length ? '：' + handWritten.join(',') : '') + '）');
  ok(shortLeft.length === 0, 'charterShort 已彻底删除，无残留引用（实得 ' + shortLeft.length + ' 处' + (shortLeft.length ? '：' + shortLeft.join(',') : '') + '）');

  // 附：每个调用点覆盖到了吗（报告用，不判失败 —— 有些分支本来就要特殊条件才走到）
  const sites = {};
  for (const c of sysCalls) sites[c.site] = (sites[c.site] || 0) + 1;
  console.log('');
  console.log('  ── 这轮跑到的调用点（' + Object.keys(sites).length + ' 个）──');
  for (const k of Object.keys(sites).sort()) console.log('     ' + k.padEnd(24) + '×' + sites[k]);

  console.log('');
  console.log('==== charter-check: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
