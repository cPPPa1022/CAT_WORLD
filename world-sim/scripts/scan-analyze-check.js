// scan-analyze-check.js — 扫描两步制断言（v1.70）
// 用户：「我要的是，ai 把这卡读一遍然后做分析产出成我们需要的内容」「不能靠正则去猜」
'use strict';
const path = require('path'); const os = require('os'); const fs = require('fs');
const TMP = path.join(os.tmpdir(), 'ws-scanan-' + Date.now());
process.env.WORLD_SIM_DATA = TMP; fs.mkdirSync(TMP, { recursive: true });
const AI = require('../src/ai');
const IMP = require('../src/import');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
console.log('');
console.log('扫描两步制 —— 先分析、再产出；不许正则猜；缺的补、矛盾的裁');

// ---------- 一、提示词：拆开「不许审查」和「不许改写」 ----------
const sys = IMP.scanSystem();
ok(!/你是转换器/.test(sys), '★ 不再自称「转换器，不是审阅者」');
ok(!/禁止省略、改写/.test(sys), '★ 不再出现「禁止省略、改写」（那句把补全也禁掉了）');
ok(/禁止净化/.test(sys), '★ 「不许审查/净化」这条边界**保留**（防模型因敏感擅自删改）');
ok(/补全授权/.test(sys) && /你来补/.test(sys), '★ 新增「补全授权：卡里没写的你来补」');
ok(/你来裁/.test(sys), '★ 新增「卡里自相矛盾的你来裁」');
ok(/filled/.test(sys) && /conflicts/.test(sys), '★ 补的/裁的都要记账（filled / conflicts 字段）');
ok(/建成.*世界包 JSON/.test(sys) && !/把它翻译成/.test(sys), '★ 任务定义从「翻译」改成「建成一个能自行运转的世界」');
ok(/唯一的硬约束：产出必须世界自洽/.test(sys), '★ 唯一硬约束 = 世界自洽（用户原话）');

// ---------- 二、分析提示词：产物是判断不是字段 ----------
const an = IMP.analyzeSystem();
ok(/世界分析师/.test(an), '有「世界分析师」这一步');
ok(/不要输出 JSON/.test(an) && !/必须输出 JSON|输出 JSON 格式/.test(an), '★ 分析这步**不输出 JSON**（逼它推理，别为满足 schema 跳步骤）');
for (const k of ['关系网', '矛盾清单', '空白', '什么最重要', '开场那一刻']) ok(an.indexOf(k) >= 0, '★ 分析稿必须回答：' + k);
ok(/卡未写/.test(an) && /矛盾/.test(an), '★ 关系网要求标出【卡未写】与【矛盾】');

// ---------- 三、真的调两次，且第二次吃到分析稿 ----------
const CARD = { name: '测试卡', description: '阿岩在镇上开修理铺，和沈姨是邻居。', personality: '闷葫芦', first_mes: '你推开门。', scenario: '镇上' };
const LIVE = { llm: { baseURL: 'https://x/v1', apiKey: 'k', model: 'm' }, sample: {} };
const calls = [];
AI.llmText = async (cfg, msgs) => { calls.push({ kind: 'analyze', sys: msgs[0].content.slice(0, 40), user: msgs[1].content.length }); return '【分析稿】## 三、关系网\n玩家↔阿岩：【卡未写】……'; };
AI.llmJSONDeep = async (cfg, msgs) => { calls.push({ kind: 'produce', userHasAnalysis: msgs[1].content.indexOf('先一步的分析稿') >= 0, userHasCard: msgs[1].content.indexOf('阿岩在镇上开修理铺') >= 0 }); return null; };

(async function () {
  await IMP.scanCard(CARD, LIVE, true).catch(() => null);
  ok(calls.length === 2, '★ 一次扫描 = 两次调用（实际 ' + calls.length + ' 次）');
  ok(calls[0] && calls[0].kind === 'analyze', '第一次是「分析」');
  ok(calls[1] && calls[1].kind === 'produce', '第二次是「产出」');
  ok(calls[1] && calls[1].userHasAnalysis === true, '★★ 第二次**吃到了分析稿**（不是各干各的）');
  ok(calls[1] && calls[1].userHasCard === true, '★★ 第二次**重读了卡**（C 方案：缓存未命中也要读）');

  // ---------- 四、不许正则猜关系 ----------
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'import.js'), 'utf8');
  ok(!/\|\| '起初素不相识'/.test(src), '★ 全文件不再默认「起初素不相识」（那是在**编造事实**）');
  ok(/未定（待补全）/.test(src), '★ 改成「未定（待补全）」');
  ok(/（本地猜）/.test(src), '★ 本地猜那条路自报家门（猜的标成猜的）');

  // ---------- 五、分析失败不许连累产出 ----------
  calls.length = 0;
  AI.llmText = async () => { throw new Error('分析炸了'); };
  AI.llmJSONDeep = async (cfg, msgs) => { calls.push({ produce: true, hasAn: msgs[1].content.indexOf('先一步的分析稿') >= 0 }); return { meta: { name: 'X' }, npcs: [], places: [] }; };
  const r = await IMP.scanCard(CARD, LIVE, false);
  ok(calls.length === 1 && calls[0].produce === true, '★ 分析失败 → 仍会去产出（降级，不是整条挂掉）');
  ok(r.mode === 'llm' && r.analysis === '', '分析空着但世界照常建出来');

  // ---------- 六、关系网真的落库了吗（原来 NPC↔NPC 开局完全没有） ----------
  ok(/\"ties\"/.test(sys), '★ schema 里有 ties（NPC↔NPC 关系网）');
  ok(/relHow/.test(sys), '★ 每个 NPC 还要写「与玩家的关系怎么来的」');
  const PACK = {
    meta: { name: '测试世界', era: '现代' }, time: '2026-05-21T20:45:00', weather: '晴',
    player: { name: '你', identity: '到访者' },
    npcs: [
      { id: 'npc1', name: '阿岩', role: '修理工', surface: '闷', hidden: '欠债', rel: '邻居', relHow: '住对门三年，借过工具', inScene: true },
      { id: 'npc2', name: '沈姨', role: '小卖部老板', surface: '热心', hidden: '护短', rel: '熟人', relHow: '从小看着她长大' }
    ],
    places: [{ id: 'p1', name: '修理铺', tags: ['室内'], edges: [] }],
    firstScene: '你推开门。',
    ties: [{ a: 'npc1', b: 'npc2', rel: '母子', how: '阿岩是她收养的', since: '二十年' }]
  };
  const d = IMP.packToData(PACK, { greeting: 0 });
  ok(d.relations['player'] && d.relations['player']['npc1'] && d.relations['player']['npc1'].tone === '邻居', '玩家↔NPC 的 tone 落库');
  ok(d.relations['player']['npc1'].how === '住对门三年，借过工具', '★★ 玩家↔NPC 还落了「怎么来的」（原来只有标签，causes 是空的）');
  ok(d.relations['npc1'] && d.relations['npc1']['npc2'] && d.relations['npc1']['npc2'].tone === '母子', '★★ NPC↔NPC 关系落库（原来开局**完全没有**）');
  ok(d.relations['npc2'] && d.relations['npc2']['npc1'] && d.relations['npc2']['npc1'].tone === '母子', '★ 反向也写了（双向）');
  ok(d.relations['npc1']['npc2'].how === '阿岩是她收养的', '★ 关系带「怎么来的」：' + d.relations['npc1']['npc2'].how);
  const d2 = IMP.packToData(Object.assign({}, PACK, { ties: [{ a: 'npc1', b: '不存在的人', rel: 'x' }] }), { greeting: 0 });
  ok(!d2.relations['npc1'] || !d2.relations['npc1']['不存在的人'], '★ 指向不存在的人 → 跳过（不炸、不写脏数据）');

  // ---------- 七、玩家身世：卡开局也要一开始就给全（用户：「我是谁？我来自哪里？」） ----------
  ok(/\"backstory\"/.test(sys) && /必须完整具体/.test(sys), '★ player schema 要求「这一生」完整具体（原来只有「来历一句话」）');
  ok(/\"origin\": \"<我来自哪里/.test(sys), '★ 「我来自哪里」写清楚（2~3 句，不再是一句话）');
  ok(/\"shadows\"/.test(sys), '★ 玩家也要给 shadows（隐约记得·未想起）');
  ok(/玩家（卡的主角）也要列/.test(an), '★ 分析师要把玩家也列进"已知 vs 空白"');
  const LONG = '一九九八年生在北边一个小城，父亲跑长途货运，常年不在家，母亲在纺织厂三班倒。'
    + '十六岁那年家里出事，你揣着两百块钱南下，在工地扛过水泥、在夜市摆过摊、在修车铺当过学徒，'
    + '后来跟一个老师傅学了一手修机器的活，能听声音判断哪儿坏了。'
    + '二十二岁那年你攒下第一笔钱，盘了个小门面，干了两年被人骗了合同，赔得精光。'
    + '二十五岁你替人顶了一桩事，在看守所待了八个月，出来后断了跟家里的联系。'
    + '你现在身上只剩一个旧工具包、一部摔裂了屏的手机，和一张回不去的火车票。';
  const d3 = IMP.packToData(Object.assign({}, PACK, {
    player: { name: '你', identity: '南下讨生活的修理工', age: '28', origin: '北边小城人，十六岁南下', backstory: LONG, desire: '先把活接上，站稳脚' }
  }), { greeting: 0 });
  const jn = d3.journal || { known: [] };
  const kOrigin = (jn.known || []).filter(x => x.k === '来历');
  const kLife = (jn.known || []).filter(x => x.k === '这一生');
  ok(kOrigin.length === 1, '★ 身世日志里「来历」单列一条');
  ok(kLife.length === 1, '★ 身世日志里「这一生」单列一条（卡开局原来根本没有这条）');
  ok(kLife[0] && kLife[0].v.length > 160, '★★ 长身世没被截成 160 字（实际 ' + (kLife[0] ? kLife[0].v.length : 0) + ' 字）');
  ok(kLife[0] && kLife[0].v.indexOf('修机器') >= 0, '★ 关键经历保住了：' + (kLife[0] ? kLife[0].v.slice(0, 24) : '') + '…');

  // ---------- 八、扫描记录存得住、主菜单查得到（用户：「存着咯，放在开始游戏那栏 读取角色卡缓存」） ----------
  const svr2 = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const ui3 = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  ok(/analysis: scan\.analysis \|\| ''/.test(svr2), '★ 分析稿**存进卡档**（不再用完就丢）');
  ok(/filledN: \(Array\.isArray\(scan\.pack\.filled\)/.test(svr2), '★ 卡盒记录带上「补了 N 处 / 裁了 M 处」');
  ok(/u\.pathname === '\/api\/cards\/cache'/.test(svr2), '★ 有读取接口 /api/cards/cache');
  ok(/function openCardCache/.test(ui3), '★ 主菜单卡盒里有查看器 openCardCache');
  /* v1.88：这条断言从 v1.82 起就过时了 —— 那一版把图标从 emoji 换成了线性图标（iconSVG），
   按钮文字只剩「扫描记录」。断言改成查"按钮存在 + 被挂到行上"这个事实本身。 */
ok(/扫描记录/.test(ui3) && /row\.appendChild\(cacheB\)/.test(ui3), '★ 每张卡上都有「扫描记录」按钮（图标已换成线性图标）');
  ok(/补全（卡里没写的）/.test(ui3) && /裁决（卡里自相矛盾的）/.test(ui3), '★ 查看器分「补全 / 裁决 / 分析稿」三块');

  console.log('');
  console.log('==== scan-analyze-check: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exitCode = fail ? 1 : 0;
})();
