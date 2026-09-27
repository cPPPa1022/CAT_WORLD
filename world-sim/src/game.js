// game.js — 回合管线：意图解析 → 推进 → 主AI → 校验 → 提交 → 投影
'use strict';
const DEG = require('./degraded');
const { getEntity, persons, present, ledgerPush } = require('./store');
const ST = require('./storyteller');   // v1.91 叙事者（油门）：算张力与节拍，不算内容
const TH = require('./threads');        // v1.93 悬着的线：唯一推导点（带 audience 参数）
const RT = require('./runtime');
const AI = require('./ai');
const PRES = require('./presentation');
const SUB = require('./subai');
const EPOCH = require('./epoch');
const DIR = require('./director');
const SCHED = require('./scheduler');
const FX = require('./fx');
const FW = require('./framework');   // 世界的框架（住在存档里）
const MF = require('./manifest');    // 生成清单（这份存档到目前新生成过什么）
const REC = require('./records');     // v1.54 记录层：原文全存 / 按世界日摘要 / 人·地·事索引
const QUERY = require('./query');     // v1.55 按需调取（AI 自己查）
const GATE = require('./gate');
const RET = require('./retention');   // v1.87 统一留存策略（窗口大小一处定义）       // v1.56 输出侧门控 + 冲突检查
const PHASE = require('./phase');     // v1.56 相位的确定性推进
const BUS = require('./bus');         // v2.03 P0-6 收尾：新闻/候选的落库走总线（裁决点唯一）
const ACC = require('./accounts');    // v3.20 钱与账：金额归一 + 找账（与校验器同一套判据）
const K = require('./knowledge');     // v1.97 X8：新闻影响（时长/范围）的唯一解释点
const VIS = require('./visual');
/* v3.3：游戏循环**原来一次都没引用过契约**（SUGGEST_LEN/SUGGEST_MAX 这两个上限长在 contract.js 里）。
   门控和视图出口都要用它 —— 上限只有一个真源，不在这里写第二遍 24/6。 */
const CONTRACT = require('./contract');      // v1.98 P0-3：占位串判据（"待发现"算不算标志物）的唯一来源

/* v1.84：**删掉写死的地名表**（原来是演示世界的 PLACE_ALIAS：杂货铺→pl_1、家→pl_3…）。
   用户的规矩是"引擎只列能力、不列内容"（设计共识 §280），而这表既是世界内容，又会对导入世界误伤
   （不同世界里的"老街口"根本不是同一个地方）。现在统一走"按名字在现场找"的通用规则 —— 见 parseIntent。 */
// ---------- 旅程计划（计划→买票→上车；城市蓝图=异步任务，到站才物化；可被"封路"中断） ----------

function parseIntent(data, text) {
  const t = (text || '').trim();
  // 动态动作注册表优先（玩家/世界配置的动作先于内置规则）
  const cus = DIR.matchCustom(data, t);
  if (cus) return cus;
  const mSleepTo = t.match(/睡到(\d+)点/);
  if (mSleepTo) return { kind: 'sleep', wakeHour: parseInt(mSleepTo[1], 10) };
  if (/睡觉|去睡|睡了|休息|晚安/.test(t)) return { kind: 'sleep' };
  const mWait = t.match(/等(\d+)分钟?/);
  if (mWait) return { kind: 'skip', minutes: parseInt(mWait[1], 10) };
  const mHour = t.match(/等([0-9两二三四五]+)\s*(?:个?小时|钟头|时辰|上午|下午)/);
  if (mHour) {
    const CN = { 两: 2, 二: 2, 三: 3, 四: 4, 五: 5 };
    const hh = CN[mHour[1]] || parseInt(mHour[1], 10);
    return { kind: 'skip', minutes: Math.min(1440, (hh || 1) * 60) };
  }
  const mGo = t.match(/^(?:去|到|前往|返回|回)([^，。！？、\s]{1,8})$/);
  if (mGo) {
    const want = mGo[1].trim();
    // 「回家」这类没有专名的说法：按**标签/名字**找"住的地方"，而不是写死一个 id
    if (/^(家|住处|屋里|房间|回去)$/.test(want)) {
      const score = (e) => ((e.tags || []).indexOf('住宅') >= 0 ? 2 : 0) + ((e.name || '').indexOf('住') >= 0 ? 2 : 0) + ((e.name || '').indexOf('家') >= 0 ? 1 : 0);
      const home = Object.values(data.entities)
        .filter(e => e.type === 'place' && e.id !== data.current.sceneId && score(e) > 0)
        .sort((a, b) => score(b) - score(a))[0];
      if (home) return { kind: 'move', destId: home.id, destName: home.name };
    }
    const place = Object.values(data.entities).find(e => e.type === 'place' && e.id !== data.current.sceneId && e.name && (e.name.indexOf(want) >= 0 || want.indexOf(e.name) >= 0));
    if (place) return { kind: 'move', destId: place.id, destName: place.name };
  }
  const mG = t.match(/^(?:去|前往|到|回)([^，。！？、\s]+)$/);
  if (mG) {
    const name = mG[1].trim();
    const place = Object.values(data.entities).find(e => e.type === 'place' && e.name.indexOf(name) >= 0 && e.id !== data.current.sceneId);
    if (place) return { kind: 'move', destId: place.id, destName: place.name };
  }
  if (/买车票|买张票|买票/.test(t)) return { kind: 'travelTicket' };
  if (/(?:出发|上路|动身|上车|走人)\b|我出发|这(?:就|次?)走/.test(t)) return { kind: 'travelGo' };
  if ((/回(?:青石镇|镇上|老家|家)/.test(t)) && String(data.current.sceneId).indexOf('city1_') === 0) return { kind: 'move', destId: 'pl_6', destName: '镇汽车站' };
  /* ★ v2.14 修（用户实测，原话「位置是澄江公寓-一楼便利店，买包烟都不行？」）——
     他在便利店里打「去买包烟」，引擎回的是「你的计划：坐班车去**买包烟**——先到镇汽车站买票」。
     两个错：
       ① 「买」的判断排在「去」的 travelPlan **后面**（87 行 vs 71 行）—— 顺序反了；
       ② `mBuy` 用 **^ 锚定开头**，于是「去买包烟」这种最自然的说法整个漏掉，
          一路掉到 mDest 里被当成**目的地**（dest 是"买包烟"三个字）。
     修法：**先看有没有明确的动作意图**（买/卖/拿/来），再谈"去哪里"——
     并且允许自然前缀（我/想/要/去/帮我/给我/顺便）。
     原则：**"去"只是修饰，"买"才是动作。别让修饰词把动作吃掉。** */
  const mBuy0 = t.match(/^(?:我)?(?:想|要|打算|去|帮我|给我|顺便|再|先)?(?:买|来|要|拿)(?:一?|瓶|包|把|盒|袋|个|份|条|支)?(.+)$/);
  /* 「要」既可以是"索要"（要一包烟）也可以是助动词（我要看那份东西）——
     所以后面接感知/读写类动词时，这条不成立（否则「我要看X」会被当成"要X"）。
     实测于 doc-fx-check：三种引擎没听说过的文书，各自用自称都能打开。
     ⚠️ 注意：那条断言会检查"这些文书名**确实不在引擎源码里**"——所以这里**不能举真名**，
        连注释里都不行（我第一版把真名写进注释，当场把那条断言弄红了）。 */
  if (mBuy0 && !/^(?:看|读|开|翻|查|听|问|说|想|瞅|瞧)/.test(mBuy0[1].trim())) {
    const nm0 = mBuy0[1].trim();
    const it0 = Object.values(data.entities).find(e => e.type === 'item' && (e.at === data.current.sceneId) && (e.name.indexOf(nm0) >= 0 || nm0.indexOf(e.name) >= 0));
    if (it0) return { kind: 'buy', itemId: it0.id };
    const legacy0 = { 牛奶: 'it_milk', 水: 'it_milk', 烟: 'it_smoke', 香烟: 'it_smoke', 红塔山: 'it_smoke', 雨披: 'it_scarf', 伞: 'it_umbrella' }[nm0];
    if (legacy0) return { kind: 'buy', itemId: legacy0 };
    /* 东西不在手边（店里没这件货）：**仍然算"买"**，让 AI 去演"店里没有"或"你买到了"，
       而不是掉进 travelPlan 说"你的计划是坐班车去买XX"。 */
    if (nm0.length <= 6) return { kind: 'buy', itemId: '', want: nm0 };
  }
  const mTravel = t.match(/去(省城|临江|外地|大城市|新城市|城里)/);
  const mDest = t.match(/^(?:我要|我想|打算)?去([^，。！？、\s]{2,6}市?)$/);
  const farDest = (mTravel && mTravel[1]) || (mDest ? mDest[1] : null);
  if (farDest) {
    const known = Object.values(data.entities).some(e => e.type === 'place' && (e.name.indexOf(farDest) >= 0 || e.geo.join('').indexOf(farDest) >= 0));
    if (!known) return { kind: 'travelPlan', dest: farDest };
  }
  if (/发(?:个)?(?:消息|微信|短信|信息)|打电话|电话给|回复(?:他|她)/.test(t)) return { kind: 'msg' };
  const mY = t.match(/(?:跳过|过|等到?|到)(\d{4})年/);
  if (mY) return { kind: 'era', year: parseInt(mY[1], 10) };
  const mD = t.match(/等(\d+)天/);
  if (mD) return { kind: 'skip', minutes: Math.min(43200, parseInt(mD[1], 10) * 1440) };
  if (/看(?:看|一|一下)?(?:窗外|外面|外头|天气|雨)|拉开窗帘|开窗/.test(t)) return { kind: 'peek' };
  if (/听(?:段|一会儿|一会|会儿|一点|点|下)?(?:收音机|广播|新闻)|打开电视|看(?:电视|电视新闻)/.test(t)) return { kind: 'radio' };
  // v1.46「打开/读/查看」——可读文本是一等公民（此前落到兜底 act，AI 只能再编一段动作来填空）
  const rd = matchReadIntent(data, t);
  if (rd) return rd;
  const mSell = t.match(/^(?:卖|出|退)(?:掉|了)?(.+)$/);
  if (mSell) {
    const nm = mSell[1].trim();
    const p = data.entities.player || {};
    const item = (p.inventory || []).find(x => (x.name || '').indexOf(nm) >= 0 || nm.indexOf(x.name || '') >= 0);
    if (item) return { kind: 'sell', itemId: item.id, itemName: item.name };
  }
  if (/道歉|对不起|抱歉|赔罪/.test(t)) return { kind: 'say', apology: true };
  if (/我(?:说|问|告诉)|在吗|早上好|晚上好|谢谢|你好/.test(t)) return { kind: 'say' };
  if (/\?|？|吗|呢|哪|谁|什么|为什么|怎么/.test(t)) return { kind: 'question' };
  return { kind: 'act' };
}

// ---------- 可读文本（v1.46）：文档对象 ----------
// 病根（2026-09-14 用户实测）：信/帖子/告示**只活在散文里** —— 玩家说「打开信件查看内容」，
// 系统没有"可读对象"可展示，parseIntent 也没有这一支 → 落到兜底 act，AI 只能再编一个动作
// （实测："又退半步…目光落在自己鞋尖"）来填空。玩家要的是内容，拿到的是一个动作。
// 修法：可读文本 = 一等公民 data.documents[id]。
//   · AI 用 {type:文档出现, title, body} 落**正文**（旁白只写感官）
//   · 玩家"打开/读/查看" → 直接展示对象，**不再生成新回合**（也不再有"退半步"）
// 门控：只有 data.knowledge.knownDocs 里的文书进玩家 UI（与知识门控同一把尺子）。
// v1.47「例子 → 类」：**认得出一份文书，靠它自己**（title / kind / aliases，全由 AI 声明），
// 不靠引擎里的名词表——因为"世界有什么纸、什么信"是 AI 的事（架空世界更是如此，软件无从枚举）。
// 下面这张表**只用于补录老存档**（散文里捞旧信），不参与新内容的识别。
// 动词是**引擎的交互原语**（引擎只懂「打开/看/读」这类动作，不懂世界里有什么纸）；
// 注意：进入本函数只代表「这可能是个读取动作」，**能不能对上号由对象自己决定**（见下）。
const DOC_VERB_RE = /(打开|拆开|展开|翻开|翻看|读一?读|念一?念|看|查看|查阅|翻阅|取出|抽出)/;
const LEGACY_NOUN_HINT = /(信|帖子|笺|札|函|榜文|告示|通缉|契书|药方|账本|名录|名册|文书|纸条|字条|条子|柬)/;
const QUOTED_RE = /[「『“"]([^」』”"]{12,})[」』”"]/;
const DOC_TITLE_RULES = [[/纸条|字条|条子/, '一张纸条'], [/帖子|帖/, '一封帖子'], [/笺/, '一页素笺'], [/榜|告示|通缉/, '一张告示'], [/契/, '一份契书'], [/药方/, '一张药方'], [/账本|名录|名册/, '一本册子'], [/信|札|函/, '一封信']];

function knownDocs(data) {
  const all = data.documents || {};
  const ids = (data.knowledge && data.knowledge.knownDocs) || [];
  return ids.map(id => all[id]).filter(Boolean);
}
/* v1.97：给"玩家会读到的文本"过门控的唯一小工具（同一把尺子；已知的名字照旧放行）。
   为什么需要它：输出侧门控原来只扫 frame.beats 一条通道 —— 文书正文/落款、消息正文、列表摘要
   全是裸的（评审回执 X4/X5）。以后新增"玩家可见文本"，调它。 */
function scrubForPlayer(data, s) {
  try { return GATE.scrubText(data, String(s == null ? '' : s)); } catch (e) { DEG.hit('game.js', e); return s; }
}
function docPublic(d, data) {
  // ★ 修 X4/X5：文书是玩家真会读到的通道（标题/正文/落款/收件人）—— 在这里过同一把尺子
  return { id: d.id, title: scrubForPlayer(data, d.title || '（无题）'), body: scrubForPlayer(data, d.body || ''), from: scrubForPlayer(data, d.from || ''), to: scrubForPlayer(data, d.to || ''), t: d.t || '', tags: d.tags || [], kind: d.kind || 'doc', aliases: d.aliases || [], at: d.at || '', itemId: d.itemId || '', read: !!d.read, source: d.source || 'ai' };
}
/* v2.06 修 P1-4：knowledge 的七个数组此前都是**裸读**（如 data.knowledge.knownPeople.includes(...)）——
   老存档 / 手工拼的包 / 从完整包导入的世界，少任何一个键都会在**写路径**上抛错，
   表现为"点了某句话没反应 / 某条消息读了没记住"。
   现在一处兜底：要碰知识就先调它。 */
const KNOW_FIELDS = ['visited', 'knownPlaces', 'knownPeople', 'knownOrgs', 'phoneContacts', 'readMsgs', 'heardNews', 'knownDocs'];
function ensureKnowledge(data) {
  const k = (data.knowledge = data.knowledge || {});
  for (const f of KNOW_FIELDS) { if (!Array.isArray(k[f])) k[f] = []; }
  return k;
}
function createDoc(data, spec) {
  ensureKnowledge(data);
  data.documents = data.documents || {};
  data.knowledge = data.knowledge || {};
  data.knowledge.knownDocs = data.knowledge.knownDocs || [];
  const id = data.id('doc');
  const doc = {
    id: id,
    title: String(spec.title || '（无题）').slice(0, 60),
    body: String(spec.body || '').slice(0, 4000),
    from: String(spec.from || '').slice(0, 30),
    to: String(spec.to || '').slice(0, 30),
    at: spec.at || (data.current && data.current.sceneId) || '',
    t: spec.t || (data.current && data.current.time) || '',
    tags: (spec.tags || []).slice(0, 6),
    kind: String(spec.kind || '').slice(0, 16),          // 世界管它叫什么（AI 的话，不是引擎的话）
    aliases: (spec.aliases || []).map(x => String(x).slice(0, 12)).slice(0, 6),  // 玩家可能怎么称呼它
    itemId: spec.itemId || '',                            // 可读性可以挂在物件上（背包里的信/路引）
    read: !!spec.read,
    source: spec.source || 'ai'
  };
  data.documents[id] = doc;
  if (!data.knowledge.knownDocs.includes(id)) data.knowledge.knownDocs.push(id);
  return doc;
}
// 意图：玩家想"打开"什么？（返回 null = 不是读文书，交给原管线）
// v1.47：**判断依据全部来自对象自己**（题名 / kind / aliases / tags，都是 AI 声明的），
// 引擎不再拿名词表去猜"世界里有什么纸"——架空世界自造的类型因此自动可用（见 doc-fx-check [10]）。
function matchReadIntent(data, t) {
  if (!t || !DOC_VERB_RE.test(t)) return null;
  const docs = knownDocs(data);
  const names = (d) => [d.title, d.kind].concat(d.aliases || []).concat(d.tags || []).filter(Boolean).map(String);
  // 1) 整名命中
  for (const d of docs) if (d.title && t.indexOf(d.title) >= 0) return { kind: 'read', docId: d.id };
  // 2) 对象自己声明的称呼命中（取最长片段：2~4 字）
  let best = null, bestLen = 0;
  for (const d of docs) {
    for (const nm of names(d)) {
      const core = nm.replace(/^(一|那|这|两|三|几)?(封|张|份|本|页|卷|道|枚|纸)?/, '');
      // 整名命中（含**单字**称呼，如 AI 声明的 aliases:['信']）——比片段更可信
      if (core && t.indexOf(core) >= 0) { if (core.length > bestLen) { best = d; bestLen = core.length; } continue; }
      for (let n = Math.min(4, core.length); n >= 2; n--) {
        for (let i = 0; i + n <= core.length; i++) {
          if (t.indexOf(core.slice(i, i + n)) >= 0 && n > bestLen) { best = d; bestLen = n; }
        }
      }
    }
  }
  if (best && bestLen >= 1) return { kind: 'read', docId: best.id };
  // 3) 感知类（看窗外/开电视/开门）不归这一支 —— 放在对象匹配**之后**：
  //    世界里真有一份"门上的字条"时，以对象为准
  if (/窗外|外面|外头|天气|电视|收音机|广播|地图|门|窗/.test(t)) return null;
  // 4) 开放式兜底：短的读取命令（"打开看看"/"读一下"/"打开信件"）
  //    只有一件未读 → 直接开；有多件 → **反问他哪一件**（不猜、不拿别的文书糊弄）
  //    必须有**命令式开头**，否则"我看他一眼"这类会被误吞
  if (t.length <= 14 && /^(?:我)?(?:要|想|来|给我)?(?:把|拿|取)?(?:那|这)?(?:一)?(?:打开|拆开|翻开|展开|翻看|查看|看看|看一下|读|念|取出|抽出)/.test(t)) {
    // 手上只有一件 → 就是它（再问「哪一件」是废话）；有多件而他没说清 → 反问他；一件都没有 → 去散文里补录
    const unread = docs.filter(d => !d.read);
    if (unread.length === 1) return { kind: 'read', docId: unread[0].id };
    if (docs.length === 1) return { kind: 'read', docId: docs[0].id };
    if (docs.length > 1) return { kind: 'read', docId: null, ask: true };
    return { kind: 'read', docId: null };
  }
  return null;
}
function docTitleFrom(text) {
  for (const [re, title] of DOC_TITLE_RULES) if (re.test(text)) return title;
  return '一份文书';
}
// 补录：老存档里"信"只写在散文里（sceneLog），按需从散文里把文书捞出来（0 token）
// 只在玩家主动要打开、而对象不存在时触发 —— 不做全量扫描，避免把散文都变成文书。
function backfillDoc(data, want) {
  const log = (data.sceneLog || []).slice(-60);
  const wantRe = want ? new RegExp(String(want).replace(/[.*+?^\${}()|[\]\\]/g, '\\$&')) : null;
  for (let i = log.length - 1; i >= 0; i--) {
    const l = log[i] || {};
    const txt = String(l.text || '');
    if (txt.length < 20) continue;
    if (!LEGACY_NOUN_HINT.test(txt) || !QUOTED_RE.test(txt)) continue;   // 只给老存档补录用
    if (wantRe && !wantRe.test(txt)) continue;
    // 去重：同一条散文不能被补录成两份文书（实测：先说"看看帖子"、再说"打开信件"，
    // 两次都扫到同一行 → 信匣里出现两份一模一样的"一封帖子"）
    const dup = Object.values(data.documents || {}).find(d => d.body === txt);
    if (dup) return dup;
    const speaker = l.speakerName || l.speaker || '';
    return createDoc(data, {
      title: docTitleFrom(txt), body: txt, from: (/^[a-zA-Z]+_?\d+$/.test(String(speaker)) ? '' : speaker),
      t: l.t || data.current.time, tags: [want || '文书'], kind: 'doc', source: 'backfill', at: data.current.sceneId
    });
  }
  return null;
}
// 演出登记（AI 与代码共用同一本：冷却按**原语组合**算，换个名字也照样冷却）
function startFx(data, spec) {
  if (!spec || !spec.atoms || !spec.atoms.length) return null;
  data.current.fxSeq = (data.current.fxSeq || 0) + 1;
  data.current.fxAt = data.current.fxAt || {};
  data.current.fxAt[spec.key] = data.current.time;
  data.current.fx = { atoms: spec.atoms, key: spec.key, name: spec.name || '', why: spec.why || '', seq: data.current.fxSeq, t: data.current.time };
  return data.current.fx;
}
// 打开文书 = 【展信动画 + 正文一起到】（只做动画=演了个动作；只做对象=像查数据库）
// 查看**不消耗世界时间**（否则玩家不敢问、不敢翻）；不生成新回合（省 token，且不再"退半步"）
function openDocTurn(data, doc, text) {
  const now = data.current.time;
  doc.read = true;
  data.documents[doc.id] = doc;
  data.current.fxSeq = (data.current.fxSeq || 0) + 1;
  data.current.openDoc = { id: doc.id, seq: data.current.fxSeq, t: now };
  // 演出用**原语**表达：册页类=翻页，其余=展开（同一条边界，只是组合不同）
  const isBook = /册|账本|名录|册子/.test(String(doc.title || '') + String(doc.kind || ''));
  startFx(data, FX.specOf([isBook ? { k: 'turn' } : { k: 'unfold' }], isBook ? '翻页' : '展信', '玩家打开文书'));
  data.sceneLog = data.sceneLog || [];
  data.sceneLog.push({ t: now, turn: data.current.turnN || 0, type: 'action', text: '你打开了「' + String(doc.title || '').slice(0, 30) + '」' });
  // v1.87：场景日志的窗口大小来自**统一策略表**（原来三处各写死 200）
  try { REC.archiveSpill(data, RET.CAPS.sceneLog); } catch (e) { DEG.hit("game.js", e); if (data.sceneLog.length > RET.CAPS.sceneLog) data.sceneLog = data.sceneLog.slice(-RET.CAPS.sceneLog); }
  ledgerPush(data, { t: now, type: '文档阅读', target: 'player', desc: String(doc.title || '').slice(0, 40), ref: doc.id });
  try { REC.recordTurn(data, { t: now, turn: data.current.turnN, sceneId: data.current.sceneId, kind: 'read', action: text, opLog: '你打开了「' + String(doc.title || '') + '」', people: present(data, data.current.sceneId).filter(p => p.id !== 'player').map(p => p.id), places: [data.current.sceneId], docs: [doc.id] }); } catch (e) { DEG.hit("game.js", e); }
  const view = buildView(data);
  view.reaction = '你打开了「' + String(doc.title || '').slice(0, 30) + '」——内容就在展信笺上。';
  return { intent: { kind: 'read', docId: doc.id, from: 'player' }, frame: null, errors: [], applied: 1, fresh: { kind: 'read' }, recalled: [], view: view };
}
// 手上没有这样的文书：**明确说没有**，而不是让 AI 再演一段来填空（那正是"讲了半天没给内容"的病根）
function noDocTurn(data, text, want, ask) {
  const now = data.current.time;
  const view = buildView(data);
  if (ask) {
    // 好几件可读的，玩家又没说哪一件 → **问他**（不猜、不拿别的文书糊弄）
    const titles = knownDocs(data).slice(-4).map(d => '《' + d.title + '》' + (d.read ? '' : '（未读）')).join('、');
    view.reaction = '（你手上可读的有：' + titles + '——要打开哪一份？）';
    return { intent: { kind: 'read', docId: null, ask: true }, frame: null, errors: [], applied: 0, fresh: { kind: 'read' }, recalled: [], view: view };
  }
  const w = want ? ('「' + want + '」') : '这样的文书';
  view.reaction = '（你翻了翻，手上没有' + w + '——世界给过你的文书都会收进「信匣」，那里可以翻。）';
  try { REC.recordTurn(data, { t: now, turn: data.current.turnN, sceneId: data.current.sceneId, kind: 'read', action: text, opLog: '你找了找，没有可打开的' + (want || '文书'), places: [data.current.sceneId] }); } catch (e) { DEG.hit("game.js", e); }
  data.sceneLog = data.sceneLog || [];
  data.sceneLog.push({ t: now, turn: data.current.turnN || 0, type: 'action', text: '你找了一遍，没有可打开的' + (want || '文书') });
  // v1.87：场景日志的窗口大小来自**统一策略表**（原来三处各写死 200）
  try { REC.archiveSpill(data, RET.CAPS.sceneLog); } catch (e) { DEG.hit("game.js", e); if (data.sceneLog.length > RET.CAPS.sceneLog) data.sceneLog = data.sceneLog.slice(-RET.CAPS.sceneLog); }
  return { intent: { kind: 'read', docId: null, want: want || '' }, frame: null, errors: [], applied: 0, fresh: { kind: 'read' }, recalled: [], view: view };
}

// ---------- 货币（确定性；无赊账） ----------
function playerWallet(data) {
  const p = data.entities.player;
  if (!p) return null;
  if (!p.money) p.money = { cash: 20, digital: 0, spent: 0, earned: 0, currency: '元' };
  return p.money;
}
function tryPay(data, price, what) {
  const w = playerWallet(data);
  if (!w) return { ok: false, shortfall: price };
  const total = (w.cash || 0) + (w.digital || 0);
  if (total < price) return { ok: false, shortfall: price - total };
  // 先电子后现金
  let need = price;
  const fromDig = Math.min(w.digital || 0, need); w.digital -= fromDig; need -= fromDig;
  w.cash -= need;
  return { ok: true };
}
function tryEarn(data, price, what) {
  const w = playerWallet(data);
  if (!w) return { value: price };
  w.cash += price; w.earned += price;
  return { value: price };
}

/* ---------- ★ v3.20 钱与账：AI 只提议，这里真的改世界 ----------
   为什么非要有这一段（用户实测）：「我说的是给房东先把欠的房租和这个月的房租转过去 转钱 不够明显吗？
   2020年没有微信吗？不能转钱吗？」—— 那一局 AI **没有任何办法**把钱转出去：
   UPDATE_TYPES 里没有钱的类型，applyUpdates 里也没有钱的分支，而资料包里连钱包都没有。
   于是它只能演一个"没转成"的转账：打开 App、输金额、拇指悬在「确认」上，然后被敲门打断。
   这里补的就是那条路：**AI 提议（方向/金额/给谁/为什么）→ 引擎按"先电子后现金"扣 →
   账本留痕 → 结清对应的账**。余额永远只有一处算（tryPay/tryEarn），AI 侧只读。 */
function accNameOf(data, id) {
  const e = getEntity(data, id);
  if (e && e.name) return String(e.name);
  return id ? String(id) : '';
}
function settleAccount(data, acc, nowIso, cause) {
  if (!acc || acc.status === 'settled') return false;
  acc.status = 'settled';
  acc.settledAt = nowIso;
  acc.settledTurn = (data.current && data.current.turnN) || 0;
  ledgerPush(data, { t: nowIso, type: '账目结清', target: acc.who, desc: '结清：' + (acc.name || acc.who) + ' 的 ' + (acc.amount || 0) + (acc.currency || '元') + '（' + (acc.what || '') + '）',
    cause: cause || null, scene: data.current.sceneId, d: { acc: acc.id, amount: acc.amount, what: acc.what } });
  return true;
}
// 记一笔账（欠别人 / 别人欠你）。数字由这一次记下，之后只引用。
function applyAccount(data, u, nowIso) {
  const list = ACC.ensure(data);
  const op = String((u && u.op) || '记').trim();
  if (/清|销|还清|结/.test(op)) {
    const acc = ACC.find(data, u);
    if (!acc) {
      ledgerPush(data, { t: nowIso, type: '账目拒绝', target: String((u && (u.who || u.target)) || 'player'), desc: '想结清一笔账，但账上没有这一条', cause: (u && u.cause) || null, scene: data.current.sceneId });
      return false;
    }
    return settleAccount(data, acc, nowIso, u && u.cause);
  }
  const who = String((u && (u.who || u.target)) || '').trim();
  const amount = ACC.amountOf(u && u.amount);
  if (!who || !(amount > 0)) return false;            // 校验器已经拦过，这里是兜底
  const dir = /被/.test(String((u && u.dir) || '')) ? 'owed' : 'owe';
  const acc = {
    id: data.id('acc'), dir: dir, who: who, name: accNameOf(data, who),
    amount: amount, currency: (playerWallet(data) || {}).currency || '元',
    what: String((u && u.what) || '一笔账').slice(0, 30),
    due: String((u && u.due) || '').slice(0, 10),
    since: String((u && (u.since || u.t)) || nowIso).slice(0, 10),
    status: 'open', t: nowIso, turn: (data.current && data.current.turnN) || 0,
    cause: String((u && u.cause) || '').slice(0, 80)
  };
  list.push(acc);
  if (list.length > 40) list.splice(0, list.length - 40);   // 刹车：账目不是流水账，只留最近的
  ledgerPush(data, { t: nowIso, type: '账目', target: who,
    desc: (dir === 'owe' ? '记下欠 ' : '记下被欠 ') + (acc.name || who) + ' ' + amount + acc.currency + '（' + acc.what + '）',
    cause: (u && u.cause) || null, scene: data.current.sceneId, d: { acc: acc.id, dir: dir, amount: amount, what: acc.what, due: acc.due } });
  return true;
}
// 一笔钱进出。方向 / 金额 / 给谁 / 为什么 —— 其余（够不够、先扣哪个、记什么账）全是确定性侧。
function applyMoney(data, u, nowIso) {
  const p = data.entities.player;
  const w = playerWallet(data);
  if (!p || !w) return false;
  const dirIn = /收|进/.test(String((u && u.dir) || ''));
  const acc = ACC.find(data, u);
  let amount = ACC.amountOf(u && u.amount);
  if (!(amount > 0) && acc) amount = Number(acc.amount) || 0;   // 带账目又没写金额 → 按账目算
  if (!(amount > 0)) return false;
  const what = String((u && u.what) || (acc && acc.what) || '一笔钱').slice(0, 30);
  const ch = String((u && u.channel) || '').slice(0, 12);
  const other = String((u && (dirIn ? (u.from || u.to) : (u.to || u.from))) || (acc && acc.who) || '').trim();
  const oName = other ? accNameOf(data, other) : '';
  const money = w.currency || '元';
  if (dirIn) {
    tryEarn(data, amount, what);
    ledgerPush(data, { t: nowIso, type: '钱款变动', target: 'player',
      desc: '收了 ' + amount + money + '（' + what + '）' + (oName ? '——来自 ' + oName : '') + (ch ? '·' + ch : ''),
      cause: (u && u.cause) || null, scene: data.current.sceneId, d: { dir: 'in', amount: amount, who: other, what: what, channel: ch } });
    return true;
  }
  const r = tryPay(data, amount, what);
  if (!r.ok) {
    /* 校验器按"提议那一刻的余额"判过，这里是**同回合多笔**的兜底（第二笔可能就不够了）。
       不够也必须留痕 + 让叙事有据可依 —— 静默失败正是这一局 OOC 的原始形态。 */
    ledgerPush(data, { t: nowIso, type: '交易拒绝', target: 'player', desc: '想付 ' + amount + money + '（' + what + '），钱不够，差 ' + (r.shortfall || 0), cause: '余额不足', scene: data.current.sceneId });
    return false;
  }
  w.spent = (Number(w.spent) || 0) + amount;
  ledgerPush(data, { t: nowIso, type: '钱款变动', target: 'player',
    desc: '付出 ' + amount + money + '（' + what + '）' + (oName ? '——给 ' + oName : '') + (ch ? '·' + ch : ''),
    cause: (u && u.cause) || null, scene: data.current.sceneId, d: { dir: 'out', amount: amount, who: other, what: what, channel: ch } });
  if (acc && amount >= (Number(acc.amount) || 0)) settleAccount(data, acc, nowIso, u && u.cause);
  return true;
}

function resolveWakeTime(nowIso, wakeHour) {
  const d = new Date(nowIso);
  const h = wakeHour != null ? wakeHour : (6 + Math.floor(Math.random() * 3));
  const m = Math.floor(Math.random() * 60);
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= new Date(nowIso).getTime()) d.setDate(d.getDate() + 1);
  return RT.fmtISO(d);
}

function firstNpcId(data) {
  const e = Object.values(data.entities).find(x => x.type === 'person' && x.id !== 'player');
  return e ? e.id : 'npc1';
}

// speaker/actor 解析容错：AI 可能写 npc1 / npc_1 / 名字 → 一律解析成玩家可见的名字
/* v2.06 修 P1-1 E5：这个函数原来把"真名"当成了"玩家可见的名字"（见原注释），
   三条分支全部**直读 entity.name**、不过名字门控。它的两个下游都是真的会漏：
     · game.js 的 ctx.opLog（进资料包 → AI 会照着叫）
     · buildViewRaw 场景流的兜底分支（直接进玩家视图）
   现在统一走同一把尺子：知道的给名字，不知道的给"看得见的样子"（gate 的 as 文案），
   id 形态**永不作为称呼**回落。 */
function resolveSpeaker(data, sid) {
  if (!sid) return '';
  if (sid === 'player') return (data.entities.player || {}).name || '你';
  const say = (ent) => {
    if (!ent || ent.type !== 'person') return '';
    const nm = GATE.nameOf(data, ent.id);
    if (nm) return nm;
    return GATE.scrubText(data, String(ent.name || '')) || '那个人';
  };
  const e = getEntity(data, sid);
  if (e && e.name) { const s = say(e); if (s) return s; }
  const m = String(sid).match(/(\d+)$/);
  if (m) {
    const byNum = Object.values(data.entities).find(x => x.type === 'person' && x.id.replace(/\D/g, '') === m[1]);
    const s = say(byNum); if (s) return s;
  }
  const byName = Object.values(data.entities).find(x => x.type === 'person' && x.name === String(sid));
  const s2 = say(byName); if (s2) return s2;
  /* ★ v3.13：AI 写的 speaker 形态比契约多。实测（用户那局「靠山屯·1994」）它写的是 `npc_xiuxiu`
     —— 而实体 id 是 `xiuxiu`（AI 自己起的有意义 id）。原来只认「末尾数字」和「整名相等」，
     于是那一句台词归属不出来，屏幕上就没有说话人。多给两条宽容的匹配（都对不上才原样返回）。 */
  const raw = String(sid);
  const bare = raw.replace(/^npc[_\-]?/i, '');
  const byBare = Object.values(data.entities).find(x => x.type === 'person' && String(x.id) === bare);
  const s3 = say(byBare); if (s3) return s3;
  const byPart = Object.values(data.entities).find(x => {
    if (!x || x.type !== 'person') return false;
    const nm = String(x.name || '');
    if (nm.length < 2) return false;
    return raw.indexOf(nm) >= 0 || nm.indexOf(raw) >= 0;
  });
  const s4 = say(byPart); if (s4) return s4;
  return raw;
}

function offlineEvents(data, wakeIso) {
  const ev = [];
  const npcId = firstNpcId(data);
  const phone = (data.meta.carries || {}).time === 'phone';
  if (phone && new Date(wakeIso).getHours() >= 6) {
    ev.push({ from: npcId, to: 'player', body: '醒了没？昨晚雨下得大，店里没事。今晚还来不来？', t: RT.addMinutes(wakeIso, -28), status: 'unread', via: 'phone', offline: true });
  }
  return ev;
}

/* ══ 设定补全（v3.1 · 开局编译）══════════════════════════════════════════════
   把"世界的声明"落成"这个人的字段"。边界**写死在代码里**，不靠提示词自觉：

     · 只写**空**槽位（已有值一字不改）—— 补全是补全，不是覆盖
     · 只写**白名单槽位**（不许塞引擎不认识的键；认不得的字段一律丢弃并记账）
     · **拒占位串**（待发现/未知/待接触/未定/待补全）—— "空没写导致 OOC" 的来源就是它们
     · 只认**已存在的实体**（要造人走"人物出现"）
     · 每条都落账（可追溯、可冻结、可降档）
   载荷：
     { type:'设定补全', target:<实体 id | 'player' | 'world'>, fields:{槽位:值},
       relations:[{ with:<id>, tone, how }], why:'谁在什么时候定的' }
   ══════════════════════════════════════════════════════════════════════════ */
const FILL_SLOTS = {
  person: ['身份', '职业', '来历', '样貌', '性格', '里子', '本领', '现在想', '经历'],
  world: ['era', 'currency', 'artStyle', 'note']
};
const FILL_PLACEHOLDER = /（来自卡的原设）|（你还没看清）|待发现|（未知）|未知|待接触|（待接触）|待补全|未定|暂无|没有|无$/;
const CONTACT_KINDS = ['mobile', 'landline', 'pager', 'letter', 'none'];   // 通信条件（v3.2）
function fillClean(v) {
  /* 判据只有一把：cleanV（本文件下方那个「占位废话清洗」，v1.70 就在用）。
     实测踩到：packToData 会给玩家预填一整套模板话（"一位来到此处落脚的旅客，对这里还不熟"、
     "刚开始在这里生活"、"（随着剧情展开）"）—— 于是"只补空槽位"的规则全部跳过，
     开局编译一条都落不下来。占位串把格子占住了，真补全反而进不来。
     规矩改成：**空 → 写；占位废话 → 覆盖；真内容（用户设定/卡/世界包给的）→ 一字不改。** */
  const s = cleanV(String(v == null ? '' : v));
  if (!s) return '';
  if (FILL_PLACEHOLDER.test(s)) return '';   // 与 visual.js 的占位串判据同源（那一条是项目里唯一的那把尺子）
  return s.slice(0, 120);
}
function applySettingFill(data, u, nowIso) {
  const target = String((u && u.target) || '').trim();
  const fields = (u && u.fields) || {};
  const why = String((u && u.why) || '').slice(0, 60);
  let wrote = 0;
  const rejected = [];
  if (target === 'world') {
    data.meta = data.meta || {};
    for (const k of Object.keys(fields)) {
      if (FILL_SLOTS.world.indexOf(k) < 0) { rejected.push(k); continue; }
      const v = fillClean(fields[k]);
      if (!v) continue;
      if (cleanV(String(data.meta[k] == null ? '' : data.meta[k]))) continue;   // 有真内容：一字不改
      data.meta[k] = v; wrote++;
    }
  } else {
    const id = (target === 'player' || target === 'me') ? 'player' : target;
    const e = getEntity(data, id);
    if (!e) return { applied: 0, rejected: ['no_entity:' + target] };
    e.profile = e.profile || {};
    for (const k of Object.keys(fields)) {
      if (FILL_SLOTS.person.indexOf(k) < 0) { rejected.push(k); continue; }
      const v = fillClean(fields[k]);
      if (!v) continue;
      const slot = (k === '身份' || k === '职业') ? (e.profile.identity = e.profile.identity || {})
        : (k === '样貌') ? (e.profile.appearance = e.profile.appearance || {})
        : (k === '性格') ? (e.profile.surface = e.profile.surface || {})
        : (k === '里子') ? (e.profile.hidden = e.profile.hidden || {})
        : (k === '现在想') ? (e.profile.desires = e.profile.desires || {})
        : (e.profile.background = e.profile.background || {});
      const key2 = (k === '样貌') ? '标志物' : (k === '性格') ? '待人' : (k === '里子') ? '真实' : (k === '现在想') ? '现在想' : (k === '经历' || k === '来历') ? '经历' : k;
      if (cleanV(String(slot[key2] == null ? '' : slot[key2]))) continue;   // 有真内容：一字不改
      slot[key2] = v; wrote++;
    }
    /* 通信条件（v3.2）：这个人**怎么联系得上**——是世界事实，不是玩家的想象。
       为什么必须有它：引擎里原来只有 phoneContacts（= 能发消息的人），**没有"有没有电话"这个状态**，
       于是"通讯录"变成了"被塞进去的人"，看起来就是"人人都有大哥大"。
       kind：mobile 手机 / landline 座机 / pager 传呼 / letter 只有口信与信 / none 联系不上。
       none 是**合法且必要**的——允许"联系不上"存在，才谈得上时代与身份自洽。 */
    for (const c of (Array.isArray(u.contacts) ? u.contacts : [])) {
      const cid = String((c && c.id) || '').trim();
      const kind = String((c && c.kind) || '').trim().toLowerCase();
      const ent = getEntity(data, cid);
      if (!cid || !ent) { rejected.push('contact_no_entity:' + cid); continue; }
      if (CONTACT_KINDS.indexOf(kind) < 0) { rejected.push('contact_kind:' + kind); continue; }
      ent.contact = { kind: kind, label: String((c && c.label) || '').slice(0, 40) };
      wrote++;
      data.knowledge = data.knowledge || {};
      data.knowledge.phoneContacts = data.knowledge.phoneContacts || [];
      const at = data.knowledge.phoneContacts.indexOf(cid);
      if (kind === 'none') { if (at >= 0) { data.knowledge.phoneContacts.splice(at, 1); wrote++; } }
      else if (c && c.known !== false && at < 0) { data.knowledge.phoneContacts.push(cid); wrote++; }
    }
    /* 周边关系（轻度）：给**已存在的两个人**之间加一条边（玩家↔某人 / 某人↔某人）。
       只写定性 tone + how，不写数字（关系数值化是红线）。 */
    for (const r of (Array.isArray(u.relations) ? u.relations : [])) {
      const withId = String((r && r.with) || '').trim();
      const tone = String((r && r.tone) || '').trim().slice(0, 40);
      if (!withId || !tone) { rejected.push('relation:' + withId); continue; }
      if (!getEntity(data, withId)) { rejected.push('rel_no_entity:' + withId); continue; }
      data.relations = data.relations || {};
      data.relations[id] = data.relations[id] || {};
      if (data.relations[id][withId] && cleanV(data.relations[id][withId].tone)) { rejected.push('rel_exists:' + withId); continue; }
      data.relations[id][withId] = { tone: tone, how: String((r.how || '')).slice(0, 60), causes: why ? [why] : [] };
      wrote++;
    }
  }
  if (wrote) ledgerPush(data, { t: nowIso, type: '设定补全', target: target, desc: why || '开局编译', cause: why || null, d: { target: target, wrote: wrote, rejected: rejected.slice(0, 8) } });
  return { applied: wrote, rejected: rejected };
}
/* ---------- 世界上游（v2.11 ·「有主」的最上游） ----------
   玩家多半永远够不到的一层：远处的战事、上游的大水、别处的行情。
   它存在的意义**不是演给玩家看**，而是给「有主」提供最上游的锚 ——
   新人物/新文档/新物品挂到它上面时，**玩家只看到下游，世界知道因果**。
   cap：这条上游最多兑现几次。没有上限的话，一个「北方战事」能造出无限个逃兵，
   那比"空降一个"还假。 */
function applyBeyond(data, u, nowIso) {
  data.beyond = data.beyond || [];
  const what = String((u && u.what) || '').trim().slice(0, 80);
  if (!what) return { applied: 0, rejected: ['empty_what'] };
  const vis = String(u.visible || 'secret') === 'public' ? 'public' : 'secret';
  const cap = Math.max(1, Math.min(5, Number(u.cap) || 2));
  let b = String(u.id || '').trim() ? data.beyond.find(x => x && String(x.id) === String(u.id).trim()) : null;
  if (b) { b.what = what; b.visible = vis; if (Array.isArray(u.yields)) b.yields = u.yields.slice(0, 8); }
  else {
    b = { id: String(u.id || '').trim() || (typeof data.id === 'function' ? data.id('by') : ('by_' + Date.now().toString(36))),
      what: what, yields: (Array.isArray(u.yields) ? u.yields : []).slice(0, 8),
      visible: vis, spawned: 0, cap: cap, t: nowIso };
    data.beyond.push(b);
    if (data.beyond.length > 12) data.beyond.shift();   // 上限：远方大事不该越积越多
  }
  ledgerPush(data, { t: nowIso, type: '世界上游', target: b.id, desc: b.what, cause: null, d: { beyondId: b.id, visible: b.visible } });
  try { MF.record(data, { kind: '世界上游', id: b.id, name: b.what, schema: 'fw.beyond.v1', by: 'ai', note: String(u.why || u.cause || '').slice(0, 60) }); } catch (e) { DEG.hit('game.js', e); }
  return { applied: 1, rejected: [] };
}
function applyUpdates(data, updates, nowIso) {
  ensureKnowledge(data);
  let applied = 0;
  for (const u of (updates || [])) {
    try {
      if (u.type === '记忆新增') {
        // v1.56：高冲击的记忆 → 推动相关人物的相位（世界自己在推人，不是抽签）
        if (u.impact >= 60 && u.owner) { try { PHASE.kick(data, u.owner, '高冲击记忆：' + String(u.content || '').slice(0, 30)); } catch (e0) { DEG.hit("game.js", e0); } }
        const r = RT.writeMemory(data, { owner: u.owner, content: u.content, tags: u.tags, impact: u.impact, t: u.t || nowIso });
        // v1.86：带结构化载荷 —— 账本要能"重放"出记忆（原来只有一句 desc，推不回去）
        ledgerPush(data, { t: nowIso, type: '记忆新增', target: u.owner, desc: u.content, ref: r.id, d: { memId: r.id, owner: u.owner, content: u.content, tags: u.tags || [], impact: u.impact } });
        applied++;
      } else if (u.type === '记忆激活') {
        /* v1.83：原来取的是"该归属者的第一条记忆"——AI 想激活哪条被完全忽略。
           现在按 ref(记忆 id) → content 片段 → 权重最高 依次匹配。 */
        const mine = Object.values(data.memories).filter(x => x.owner === u.target);
        const byId = (u.ref && data.memories[u.ref]) ? data.memories[u.ref] : null;
        const key = String(u.content || '').trim().slice(0, 8);
        const m = byId || (key ? mine.find(x => String(x.content || '').indexOf(key) >= 0) : null)
          || mine.slice().sort((a, b) => RT.memDepth(data, b, nowIso) - RT.memDepth(data, a, nowIso))[0];
        /* v2.04 P1-2：**不再手改 weight** —— 深度由 RT.memDepth 一处算（读 activations）。
           这里只推进"被想起过"这件事本身（activations / lastActivation）。 */
        if (m) { m.lastActivation = nowIso; m.activations = (m.activations || 1) + 1; applied++; }
      } else if (u.type === '关系变化') {
        const npcId = u.target || 'npc_1';
        if (data.relations.player && data.relations.player[npcId]) { data.relations.player[npcId].tone = u.change; applied++; }
        if (data.relations[npcId] && data.relations[npcId].player) { data.relations[npcId].player.tone = u.change; applied++; }
        ledgerPush(data, { t: nowIso, type: '关系变化', target: npcId, desc: u.change, cause: u.cause || null, d: { npc: npcId, change: u.change } });   // v1.86：可重放
      } else if (u.type === '情绪变化' || u.type === 'NPC状态更新') {
        const e = getEntity(data, u.target);
        if (e) {
          if (u.to) e.state.mood = u.to;
          if (u.field && u.to !== undefined) e.state[u.field] = u.to;
          /* v1.99 · P0-4：日程之外的"挪人"要靠 override 才站得住 —— 否则下一次 tickNPCs
             就按日程把人拽回去（世界出现"人在别处又突然回来"的抖动）。有时限，过期自动回日程。
             `override` 的消费方早就有了（runtime.schedulePlace 第一段），这里只是终于有人写它。 */
          if (u._npcOverride && e.state) {
            const mins = Math.max(10, Math.min(1440, Number(u._npcOverride.minutes) || 60));
            e.state.override = { reason: String(u.cause || '').slice(0, 60), place: u._npcOverride.place, until: RT.addMinutes(nowIso, mins) };
          }
          applied++;
        }
      } else if (u.type === '人物出现' && u.spawn && u.spawn.name) {
        const sp = u.spawn;
        /* 查重：可能是"重复出现"的已知人物（同名 / 同**真**外貌标志）→ 补全已有实体，不新建。
           v1.98 · P0-3：判据收敛到 looksLikeSamePerson（原来这一行自己写了两遍，
           而且把 '待发现' 之类的占位串当成真标志物 → 卡导入世界里新出现的人全被并进第一个）。 */
        const spWant = { name: String(sp.name || '').slice(0, 30), profile: { appearance: { 标志物: sp.appearance || '' } } };
        const dup = Object.values(data.entities).find(e => e.type === 'person' && e.id !== 'player' && looksLikeSamePerson(spWant, e));
        if (dup) {
          // 同一人：更新已知信息，保留原 id（玩家已认识 TA）
          const prof = dup.profile || (dup.profile = {});
          prof.identity = prof.identity || {}; prof.appearance = prof.appearance || {}; prof.surface = prof.surface || {}; prof.hidden = prof.hidden || {}; prof.background = prof.background || {}; prof.secrets = prof.secrets || {};
          if (sp.name && !prof.identity.姓名) prof.identity.姓名 = String(sp.name).slice(0, 30);
          if (sp.role && !prof.identity.身份) prof.identity.身份 = sp.role;
          if (sp.appearance && !prof.appearance.标志物) prof.appearance.标志物 = String(sp.appearance).slice(0, 40);
          if (sp.surface && !prof.surface.待人) prof.surface.待人 = sp.surface;
          if (sp.hidden && !prof.hidden.真实) prof.hidden.真实 = sp.hidden;
          if (sp.backstory && !prof.background.经历) prof.background.经历 = sp.backstory;
          const imp = ensureImp(data, dup.id);
          if (imp.nameKnown && sp.name && imp.nameKnown !== sp.name && imp.stage < 3) imp.stage = 3;
          try { const L1 = (imp.log = imp.log || []); L1.push({ turn: data.current.turnN || 0, what: '又见到了 TA', why: String(u.cause || '（没说原因）').slice(0, 60) }); if (L1.length > 20) L1.shift(); } catch (eL2) { DEG.hit('game.js:impLog2', eL2); }
          ledgerPush(data, { t: nowIso, type: '人物出现', target: dup.name, desc: ('又见到了 ' + (dup.name || sp.name) + (u.cause ? '——' + u.cause : '')), cause: u.cause || null });
          applied++;
        } else {
        const npcId = data.id('npc');
        data.entities[npcId] = { id: npcId, type: 'person', name: String(sp.name).slice(0, 30), avatar: null, tags: [sp.name, '新面孔'], indexes: { geo: [], org: [], family: [] },
          profile: { identity: { 姓名: sp.name, 身份: sp.role || '（来历未知）' }, appearance: { 标志物: sp.appearance || '' }, surface: { 待人: sp.surface || '（待相处）' }, hidden: { 真实: sp.hidden || '（未知）' }, background: { 经历: sp.backstory || '' }, schedule: {}, desires: { 现在想: sp.desire || '' }, secrets: { 包袱: '（未知）' } },
          locked: { core: '性格内核（运行时生成）' }, state: { location: data.current.sceneId, mood: '平静', fatigue: '中', hunger: '低', sleep: '正常' }, trait: { lambda: 0.06, memory: '普通' } };
        data.relations['player'] = data.relations['player'] || {};
        data.relations['player'][npcId] = { tone: u.relation || '初识', causes: [u.cause || '（新人物出现）'] };
        data.relations[npcId] = { player: { tone: u.relation || '初识', causes: [u.cause || ''] } };
        if (u.relationToKnown) { const k = Object.values(data.entities).find(e => e.type === 'person' && e.id !== 'player' && e.name === u.relationToKnown); if (k) { data.relations[npcId][k.id] = { tone: '（你发现的关系）', causes: [] }; data.relations[k.id] = data.relations[k.id] || {}; data.relations[k.id][npcId] = { tone: '（TA 之间似乎认识）', causes: [] }; } }
        if (!data.knowledge.knownPeople.includes(npcId)) { data.knowledge.knownPeople.push(npcId); }
        ensureImp(data, npcId);
        data.impressions[npcId].stage = 1; data.impressions[npcId].seen = sp.appearance || '一个陌生面孔'; data.impressions[npcId].nameKnown = sp.name;
        /* v3.9：这条印象的出处 —— 哪一轮、因为什么（人物出现）。 */
        try { const L0 = (data.impressions[npcId].log = data.impressions[npcId].log || []); L0.push({ turn: data.current.turnN || 0, what: 'TA 出现在你面前', why: String(u.cause || '（没说原因）').slice(0, 60) }); if (L0.length > 20) L0.shift(); } catch (eL) { DEG.hit('game.js:impLog', eL); }
        ledgerPush(data, { t: nowIso, type: '人物出现', target: sp.name, desc: (sp.name + ' 出现' + (u.cause ? '——' + u.cause : '')), cause: u.cause || null,
          d: { anchor: (u._anchor && u._anchor.kind) || '', anchorId: (u._anchor && u._anchor.id) || '' } });
        /* v2.11：这条人物是从哪条上游兑现出来的 —— 记账，并给那条上游计数（cap 靠它） */
        if (u._anchor && u._anchor.kind === 'beyond') {
          const bz = (data.beyond || []).find(x => x && String(x.id) === u._anchor.id);
          if (bz) bz.spawned = (Number(bz.spawned) || 0) + 1;
        }
        try { MF.record(data, { kind: '人物', id: npcId, name: sp.name, schema: 'ent.person.v1', by: 'ai', note: (sp.surface || u.cause || '') }); } catch (e) { DEG.hit("game.js", e); }
        applied++;
        }
      } else if (u.type === '世界上游') {
        const rb = applyBeyond(data, u, nowIso);
        if (rb && rb.applied) applied++;
      } else if (u.type === '设定补全') {
        const r = applySettingFill(data, u, nowIso);
        if (r && r.applied) applied++;
      } else if (u.type === '印象更新') {
        const imp = ensureImp(data, u.target);
        const npc = getEntity(data, u.target) || {};
        if (u.note) {
          const note = String(u.note).slice(0, 60);
          // 去重：同内容或高度相似不重复追加；限长：notes 最多 6 / traits 最多 6（旧的先丢）
          if (!imp.notes.some(n => n === note || (note.length > 6 && n.indexOf(note.slice(0, 6)) >= 0) || (n.length > 6 && note.indexOf(n.slice(0, 6)) >= 0))) {
            imp.notes.push(note); if (imp.notes.length > 6) imp.notes.shift();
            const tr = String(u.note).slice(0, 30);
            if (!imp.traits.some(t => t === tr || (tr.length > 6 && t.indexOf(tr.slice(0, 6)) >= 0))) { imp.traits.push(tr); if (imp.traits.length > 6) imp.traits.shift(); }
          }
        }
        imp.nameKnown = npc.name || imp.nameKnown;
        if (imp.stage < 3) imp.stage = 3;
        applied++;
      } else if (u.type === '事件开始' || u.type === '事件结束') {
        /* v1.89：补 scene + visible —— 这两样是**玩家侧第二投影的前提**。
           原来这条只写 {t,type,target,desc,cause}，没有任何「谁看得见」的信息，
           于是「未了的事」只能给 AI（客观层），玩家侧无从推导（审视 §8.1）。
           visible 由 AI 声明、校验器已验（scene/public/pc-only/secret）；
           scene = 事件发生那一刻玩家在哪 —— AI 的 updates 都发生在玩家的场景里，所以它就是「你亲眼看见」。 */
        ledgerPush(data, { t: nowIso, type: u.type, target: u.target, desc: '事件: ' + u.target, cause: u.cause || null,
          scene: data.current.sceneId, visible: String(u.visible || 'scene') });
        applied++;
      } else if (u.type === '物品获取') {
        const p = data.entities.player;
        if (p) { p.inventory.push({ id: data.id('item'), name: u.item || '物品' }); applied++; }
      } else if (u.type === '人物离开') {
        /* v1.84 新实现（原来白名单里有、运行时什么都不做）。
           走**日程覆盖** state.override 而不是直接写 location —— 否则下一次 tickNPCs 会按日程把人拽回来，
           "离开"当场失效（schedulePlace 会读 override 直到 until）。 */
        const pe = getEntity(data, u.target);
        if (pe && pe.type === 'person') {
          const home = (pe.indexes && pe.indexes.home) || '';
          let to = String(u.to || home || '').trim();
          if (!to || !data.entities[to]) {
            const street = Object.values(data.entities).find(e => e.type === 'place' && (e.tags || []).indexOf('室外') >= 0);
            to = street ? street.id : '';
          }
          if (to && data.entities[to]) {
            pe.state.override = { place: to, until: RT.addMinutes(nowIso, Math.max(10, Math.min(1440, Number(u.minutes) || 180))) };
            pe.state.location = to;
            ledgerPush(data, { t: nowIso, type: '人物离开', target: pe.name || pe.id, desc: (pe.name || '') + '离开了' + (u.cause ? '——' + u.cause : ''), cause: u.cause || null, scene: data.current.sceneId });
            applied++;
          }
        }
      } else if (u.type === '物品消耗') {
        // v1.84 新实现：AI 只提议"用掉了什么"，实际扣减由引擎做（物品由 tryPay/确定性侧改）
        const p2 = data.entities.player;
        const nm2 = String(u.item || '').trim();
        if (p2 && Array.isArray(p2.inventory) && nm2) {
          const ix2 = p2.inventory.findIndex(x => (x.name || '').indexOf(nm2) >= 0 || nm2.indexOf(x.name || '') >= 0);
          if (ix2 >= 0) {
            const it2 = p2.inventory.splice(ix2, 1)[0];
            ledgerPush(data, { t: nowIso, type: '物品消耗', target: 'player', desc: '用掉了 ' + (it2.name || nm2), cause: u.cause || '日常', scene: data.current.sceneId });
            applied++;
          } else {
            ledgerPush(data, { t: nowIso, type: '交易拒绝', target: 'player', desc: '想用掉' + nm2 + '，身上没有', cause: '物品不在', scene: data.current.sceneId });
          }
        }
      } else if (u.type === '物品转移') {
        // v1.84 新实现：一件东西换手（只处理涉及玩家的一侧，另一端交给叙事）
        const p3 = data.entities.player;
        const nm3 = String(u.item || '').trim();
        const whom = String(u.to || '').trim();
        if (p3 && Array.isArray(p3.inventory) && nm3) {
          /* 方向判定：不能拿 from 的默认值去猜 —— "收下"（只给 to:'player'）会被默认 from:'player' 吞掉。
             规则：显式 from:'player' → 交出；否则 to:'player' → 收下；其余（有 to 无 from）→ 交出。 */
          const from3 = String(u.from || '').trim();
          const to3 = String(u.to || '').trim();
          const outbound = (from3 === 'player') || (!from3 && to3 !== 'player');
          const inbound = !outbound && to3 === 'player';
          if (outbound) {
            const ix3 = p3.inventory.findIndex(x => (x.name || '').indexOf(nm3) >= 0 || nm3.indexOf(x.name || '') >= 0);
            if (ix3 >= 0) {
              const it3 = p3.inventory.splice(ix3, 1)[0];
              const who = (getEntity(data, whom) || {}).name || '';
              ledgerPush(data, { t: nowIso, type: '物品转移', target: 'player', desc: '把' + (it3.name || nm3) + '给了' + who, cause: u.cause || '', scene: data.current.sceneId });
              applied++;
            }
          } else if (inbound) {
            p3.inventory.push({ id: data.id('item'), name: nm3, can: '', value: 0 });
            ledgerPush(data, { t: nowIso, type: '物品获取', target: 'player', desc: '收下了' + nm3, cause: u.cause || '转交', scene: data.current.sceneId });
            applied++;
          }
        }
      } else if (u.type === '钱款变动') {
        /* ★ v3.20：AI 提议一笔钱进出，引擎真的动余额（方向/金额/给谁/为什么 由它说，其余确定性侧） */
        if (applyMoney(data, u, nowIso)) applied++;
      } else if (u.type === '账目') {
        /* ★ v3.20：记一笔账 / 结清一笔账。数字由"记"的那一次定下，之后只引用不改口 */
        if (applyAccount(data, u, nowIso)) applied++;
      } else if (u.type === '地点变化') {
        /* v1.84：AI 让玩家移动，也要走**和玩家自己走**同一套确定性规则 ——
           原来只有"目标 id 存在就改 sceneId"，不耗时间、不记去过的地方、不刷新天气感知（免费瞬移）。 */
        if (u.to && data.entities[u.to]) {
          const dest = data.entities[u.to];
          const p4 = data.entities.player;
          const mins = Number(u._moveMinutes) || 0;
          if (mins > 0) data.current.time = RT.addMinutes(data.current.time, mins);
          data.current.sceneId = u.to;
          if (p4) p4.state.location = u.to;
          const k = data.knowledge || (data.knowledge = {});
          if (!Array.isArray(k.visited)) k.visited = [];
          if (!Array.isArray(k.knownPlaces)) k.knownPlaces = [];
          if (k.visited.indexOf(u.to) < 0) k.visited.push(u.to);
          if (k.knownPlaces.indexOf(u.to) < 0) k.knownPlaces.push(u.to);
          data.current.weatherSeen = !((dest.tags || []).indexOf('室内') >= 0);
          data.current.ambientDone = false;
          ledgerPush(data, { t: nowIso, type: '地点变化', target: 'player', desc: '到了' + (dest.name || ''), cause: u.cause || '', scene: u.to, d: { scene: u.to, place: dest.name || '' } });   // v1.86：可重放
          applied++;
        }
      } else if (u.type === '文档出现') {
        // 可读文本落成对象（正文在 body 里），旁白只写感官
        const doc = createDoc(data, { title: u.title, body: u.body, from: u.from, to: u.to, tags: u.tags, kind: u.kind, aliases: u.aliases, itemId: u.itemId, t: u.t || nowIso, at: u.at });
        ledgerPush(data, { t: nowIso, type: '文档出现', target: 'player', desc: doc.title, ref: doc.id });
        // v1.51：世界长出一个"文书类型" + 记进生成清单（note = 这是干嘛的）
        try { FW.learnDocKind(data, u.kind); } catch (e) { DEG.hit("game.js", e); }
        try { MF.record(data, { kind: '文档', id: doc.id, name: doc.title, schema: 'fw.doc.v1', by: 'ai', note: u.note || '' }); } catch (e) { DEG.hit("game.js", e); }
        applied++;
      } else if (u.type === '演出') {
        // AI 点的是**原语组合**，名字是它用世界里的话起的：只登记（怎么画由引擎决定）
        startFx(data, { atoms: u.atoms, key: u.fxKey, name: u.fx, why: u.why || '' });
        // v1.51：把「名字 → 原语组合」记进框架 —— 以后世界只需要写名字
        try { FW.learnFxName(data, u.fx, u.atoms); } catch (e) { DEG.hit("game.js", e); }
        try { MF.record(data, { kind: '演出', id: u.fxKey, name: u.fx, schema: 'fw.fx.v1', by: 'ai', note: u.note || '' }); } catch (e) { DEG.hit("game.js", e); }
        applied++;
      } else if (u.type === '框架') {
        // AI 提议给世界长词/型/律 → 引擎按 mod 边界校验后提交（ESAA；v2.08 起无档位）
        const c = FW.applyProposal(data, u);
        if (c && c.ok) {
          try { MF.record(data, { kind: '框架', id: c.slot, name: c.name, schema: 'fw.' + c.slot + '.v1', by: 'ai', note: u.note || u.why || '' }); } catch (e) { DEG.hit("game.js", e); }
          applied++;
        }
      }
    } catch (e) { DEG.hit('game.js:applyUpdates', e); console.error('[apply]', e.message); }   // v2.06：applyUpdates 里任何失败都要进静默降级账（原来只 console）
  }
  return applied;
}

// 存量清洗：把历史场景日志里 id 形态的 speaker 一次性重写成真名（幂等）
// 组装：角色回执 → 替换/插入该角色 beat（首轮必写=兜底；空回=保留原稿，零缺口）
function mergeActorInto(frame, d) {
  try {
    if (!frame || !Array.isArray(frame.beats)) return frame;
    const who = d.who, line = String(d.line || ''), action = String(d.action || '');
    const idx = frame.beats.findIndex(b => b && b.speaker === who);
    if (idx >= 0) {
      if (line) frame.beats[idx].text = line;
      /* v1.94：动作写进**槽位**，不再塞进 text 的（）里。
         v1.89 起 action/expression/voice 是一等槽位、渲染层按主次分层；
         塞进 text 会被 beatLine 再拆一次（多一次往返，且丢掉「这句是引擎补的」这个事实）。 */
      if (action && frame.beats[idx].type === 'dialogue' && !frame.beats[idx].action) frame.beats[idx].action = action;
    } else if (line) {
      const nb = { type: 'dialogue', speaker: who, tone: '', text: line };
      if (action) nb.action = action;
      frame.beats.push(nb);
    }
    return frame;
  } catch (e) { return frame; }
}

// v1.59 开关穿透 L5：**存量清洗** —— 旧档正文里已经写进去的导演笔记/生图提示词，
// 在回喂给 AI（最近 24 条原文）之前删掉，否则 AI 会照着旧样本一直学（自我强化）。
function scrubLegacyNotes(data) {
  try {
    if (!data.current || data.current.notesScrubbed) return 0;
    let n = 0;
    const fix = (l) => { if (l && l.text) { const t2 = GATE.scrubNotes(l.text); if (t2 !== l.text) { l.text = t2; n++; } } };
    for (const l of (data.sceneLog || [])) fix(l);
    for (const k of Object.keys(data.archives || {})) for (const l of (data.archives[k] || [])) fix(l);
    data.current.notesScrubbed = true;
    if (n) console.log('[gate] 存量清洗：删掉 ' + n + ' 处导演笔记');
    return n;
  } catch (e) { return 0; }
}
function scrubSceneLog(data) {
  try { scrubLegacyNotes(data); } catch (e) { DEG.hit("game.js", e); }
  const idRE = /^[a-z]+_?\d+$/;
  for (const l of (data.sceneLog || [])) {
    if (!l) continue;
    if (l.speaker && idRE.test(String(l.speaker))) {
      const r = resolveSpeaker(data, l.speaker);
      l.speaker = idRE.test(String(r)) ? '？' : r;
    }
    if (l.speakerName && idRE.test(String(l.speakerName))) l.speakerName = l.speaker;
  }
}

async function runTurn(data, text, cfg, opts) {
  ensureKnowledge(data);   // v2.06：本函数会写「去过的地方」
  /* v1.84：① 停用 scrubSceneLog —— 它把 sceneLog 里 id 形态的 speaker 改写成真名（与"引用只用 ID"相反）；
     ② 回合开头统一播种印象档 —— 玩家视图与 AI 资料包必须是**同一份印象**，否则两侧门控会各说各话。 */
  try {
    /* v1.97 ★ 修 X2/X3 的另一半：**只给"真的在你眼前、或刚出现在画面里、或已经认识"的人播种**。
       原来给**所有** person 播种 ⇒ 每个人都有一行 stage≥1 的档 ⇒ ① secret 档不可达
       ② 人物面板把世界上每一个 NPC 都列出来（"没有的不显示"这条门控失效）。
       收窄后仍达成原目的（玩家视图与 AI 资料包看的还是同一份印象 —— AI 只会问到场的人与画面里的人）。 */
    const _here = {};
    for (const e0 of Object.values(data.entities || {})) {
      if (e0 && e0.type === 'person' && e0.state && e0.state.location === data.current.sceneId) _here[e0.id] = 1;
    }
    const _spoke = {};
    for (const l0 of (data.sceneLog || []).slice(-24)) { const s0 = String((l0 && l0.speaker) || ''); if (s0) _spoke[s0] = 1; }
    const _known = (data.knowledge && data.knowledge.knownPeople) || [];
    for (const p of Object.values(data.entities || {})) {
      if (!p || p.type !== 'person') continue;
      if (p.id !== 'player' && !_here[p.id] && !_spoke[p.id] && _known.indexOf(p.id) < 0) continue;
      const imp = ensureImp(data, p.id);
      /* v1.87：印象档 stage>=2 就**同步进 knownPeople**。
         实测症状：导入世界只有 impressions 没有 knownPeople ⇒ 资料包目录说"0 个认识的"、
         要闻人物为空、关系基准自相矛盾（而印象档里全是 stage 4 的熟人）。 */
      if (imp && (imp.stage || 0) >= 2) {
        const k = (data.knowledge = data.knowledge || {}).knownPeople = (data.knowledge.knownPeople || []);
        if (k.indexOf(p.id) < 0) k.push(p.id);
      }
    }
  } catch (e0) { DEG.hit("game.js", e0); }
  // 演出与展开是"**本回合的**"：新回合先把上一回合的清掉。
  // 不清的话，之后每个 /api/state 都还挂着上一次的 letterOpen —— 刷新页面会莫名其妙重播一遍。
  data.current.fx = null;
  /* v1.97 ★ 修 X7：_hardLast（"上回合校验被打回"）此前**全仓 0 个写入点** ——
     thinkBudget 与 storyteller 都在读它，等于一个设计好的机制从未接线。
     现在：本回合开头取出上回合的值并清空（供 thinkBudget 用），冲突循环里再置位。 */
  const __hardLast = !!data.current._hardLast;
  data.current._hardLast = false;
  data.current.openDoc = null;
  const intent = parseIntent(data, text);
  // v1.46：打开/读文书 = **展示对象**（不推进回合、不消耗世界时间、不再"退半步"）
  if (intent.kind === 'read') {
    const rd = intent.docId ? ((data.documents || {})[intent.docId] || null) : null;
    if (rd) return openDocTurn(data, rd, text);
    if (intent.ask) return noDocTurn(data, text, intent.want, true);   // 有好几件又没说清 → 先问他
    const bf = backfillDoc(data, intent.want);     // 老存档：信只写在散文里 → 按需补录
    if (bf) return openDocTurn(data, bf, text);
    return noDocTurn(data, text, intent.want, intent.ask);
  }
  const before = data.current.time;
  let newTime = before;
  const via = PRES.mainVia(data);
  const ctx = { intent, action: text, moduleFor: AI.moduleFor(intent.kind) };   // S1：模块说明随资料包走（原来拼在 system 末尾，一变就废掉整块前缀）
  /* v1.91：**叙事者**（油门）—— 每回合算一次，纯算术 0 token。
     它决定「什么时候该有点事 / 是加码还是给点甜头」，**不决定「发生什么」**（那是 AI 的事，见设计总稿 §12）。
     只有真的把指令交给 AI 才记账（否则演示模式会白烧掉节拍预算）。 */
  try {
    ctx.paceEval = ST.evalOnce(data, newTime);
    if (AI.isLive(cfg) && (ctx.paceEval.fire || ctx.paceEval.compensate)) {
      ctx.pace = ST.promptBlock(ctx.paceEval);
      ST.mark(data, ctx.paceEval.compensate ? 'compensate' : 'fire', newTime);
    }
  } catch (e0) { DEG.hit('game.js', e0); }
  let offline = [];

  if (intent.kind === 'sleep') {
    newTime = resolveWakeTime(before, intent.wakeHour);
    offline = offlineEvents(data, newTime);
    for (const ev of offline) data.messages.push(Object.assign({ id: data.id('msg') }, ev));
  } else if (intent.kind === 'skip') {
    newTime = RT.addMinutes(before, Math.max(1, Math.min(1440, intent.minutes || 10)));
  } else if (intent.kind === 'move') {
    const c = RT.moveCost(data, data.current.sceneId, intent.destId, before);
    if (c.ok) {
      ctx.move = c;
      newTime = RT.addMinutes(before, c.minutes);
      data.current.sceneId = intent.destId;
      data.current.ambientDone = false;
      data.entities.player.state.location = intent.destId;
      if (!data.knowledge.visited.includes(intent.destId)) data.knowledge.visited.push(intent.destId);
      const dest = getEntity(data, intent.destId);
      if (dest && !data.knowledge.knownPlaces.includes(intent.destId)) data.knowledge.knownPlaces.push(intent.destId);
      // 感知插件：进屋=没看外面；室外=天然知道
      data.current.weatherSeen = !(dest && (dest.tags || []).includes('室内')) ? true : false;
    } else {
      newTime = RT.addMinutes(before, 2);
      ctx.move = { ok: false, err: c.err };
    }
  } else if (intent.kind === 'travelPlan' || intent.kind === 'travelTicket' || intent.kind === 'travelGo') {
    // 旅程管线：计划卡（零生成）→ 车票（票价校验=30）→ 上车（异步任务入队，到站才物化）
    data.plans = data.plans || [];
    const cur = data.plans.filter(p => p.status === 'planned' || p.status === 'aboard').slice(-1)[0];
    newTime = RT.addMinutes(before, 2);
    if (intent.kind === 'travelPlan') {
      const dest = String(intent.dest || '远方');
      data.plans.push({ id: data.id('trv'), dest: dest, purpose: '', mode: '班车', status: 'planned', ticket: false, createdAt: before });
      ctx.opLog = '（你的计划：坐班车去' + dest + '——先到镇汽车站买票）';
    } else if (intent.kind === 'travelTicket') {
      if (!cur || cur.status !== 'planned') ctx.opLog = '（你还没有明确的出行计划——想说"去XX"才行）';
      else if (data.current.sceneId !== 'pl_6') ctx.opLog = '（买票要去镇汽车站——老街口过去几分钟）';
      else {
        const ok = tryPay(data, 30, '车票');
        if (ok.ok) { cur.ticket = true; cur.departsAt = RT.addMinutes(before, 10); ctx.opLog = '（你买好了去' + cur.dest + '的车票——30块，10分钟后发车）'; }
        else ctx.opLog = '（你摸遍口袋，差' + (ok.shortfall || 0) + '块——票钱30）';
      }
    } else {
      if (!cur || cur.status !== 'planned' || !cur.ticket) ctx.opLog = '（还没有票——先去镇汽车站买票；或者你根本没计划，想说"去XX"）';
      else {
        cur.status = 'aboard'; cur.boardingAt = before;
        data.current.pendingBuilds = data.current.pendingBuilds || [];
        data.current.pendingBuilds.push({ id: data.id('bld'), planId: cur.id, dest: cur.dest, due: RT.addMinutes(before, 8 * 60), built: false, created: before });
        data.current.sceneId = 'pl_6'; data.entities.player.state.location = 'pl_6';
        ctx.opLog = '（你登上了开往' + cur.dest + '的班车——灰扑扑的车厢，窗外的田野。大约8小时后到）';
        newTime = RT.addMinutes(before, 5);
      }
    }
  } else if (intent.kind === 'era') {
    // 时代跳跃：直接到 X 年 1 月 1 日；回不去的年份只当过了一小时
    const ny = Math.max(1997, intent.year || 2026);
    const curY = parseInt(before.slice(0, 4), 10);
    newTime = ny > curY ? (String(ny) + '-01-01T08:00:00') : RT.addMinutes(before, 60);
  } else if (intent.kind === 'peek' || intent.kind === 'radio') {
    // 感知插件（确定性）：看窗外→weatherSeen；听新闻→heardNews。玩家"知道什么"由代码管
    newTime = RT.addMinutes(before, 2);
    if (intent.kind === 'peek') {
      if (PRES.canSeeWeather(data)) { data.current.weatherSeen = true; ctx.opLog = '你走过去看了看外面——' + (data.current.weather || '晴'); }
      else ctx.opLog = '你找了一圈，屋里没有窗户，只听到雨点打在别处的声响';
    } else if (PRES.canRadio(data)) {
      const fresh = data.news.filter(n => !(data.knowledge.heardNews || []).includes(n.id));
      if (fresh.length) { data.knowledge.heardNews = data.knowledge.heardNews || []; data.knowledge.heardNews.push(fresh[0].id); ctx.opLog = '你听了一会儿——「' + fresh[0].title + '」'; }
      else ctx.opLog = '你听了一会儿，都是听过的旧消息';
    } else {
      ctx.opLog = '你找了找，屋里没有收音机';
    }
  } else {
    newTime = RT.addMinutes(before, (/msg|buy/.test(intent.kind)) ? 3 : 2);
  }
  // 副 AI-摘要：睡眠跳跃时生成"不在场简报"（接入模式走 LLM；演示用离线消息文案）
  if (intent.kind === 'sleep') ctx.digestText = await SUB.subDigest(data, cfg, before);
  data.current.time = newTime;
  RT.tickNPCs(data, newTime);
  try { PHASE.norm(data); } catch (e0) { DEG.hit("game.js", e0); }   // v1.56 人设忠实：相位随世界时间推进（0 token）
  RT.decayMemories(data, newTime);
  data.current.turnN = (data.current.turnN || 0) + 1;
  try { AI.statMarkCallStart(); } catch (e) { DEG.hit("game.js", e); }
  // ---------- 动态调度：due 任务并发（演算/镜头外/候选 走调度器；消息/旅程/新闻仍按各自回调并行） ----------
  const schedRun = await SCHED.schedulerRun(data, cfg, newTime, { sleeping: intent.kind === 'sleep' });
  const schedCalc = (schedRun[2] || {}).detail || {};
  data.current.pendingCandidates = data.current.pendingCandidates || [];
  /* v2.03 · P0-6 收尾：副 AI-计算给的候选也走总线（裁决点唯一；去重仍在外面，
     因为"池子里已经有同一条"是**池子的事**，不是门的事）。 */
  for (const c of ((schedCalc.candidates) || [])) {
    if (!c || !c.text || data.current.pendingCandidates.some(x => x.text === c.text)) continue;
    BUS.commit(data, [{ kind: 'candidate', source: 'candidate', level: 'L1', item: { text: c.text, type: c.type || '事件', t: newTime, expireM: c.expireM || 60 } }], { t: newTime });
  }
  const epochOut = (schedRun[0] || {}).detail ? (schedRun[0].detail.settled || []) : [];
  const offstageOut = (schedRun[1] || {}).conclusion ? [schedRun[1].conclusion] : [];
  const [delivered, editOut, travelOut] = await Promise.all([
    deliverPendingReplies(data, cfg, newTime),
    SUB.subEdit(data, cfg, newTime),
    travelTick(data, cfg, newTime)
  ]);
  if (travelOut && travelOut.length) ctx.opLog = (ctx.opLog ? ctx.opLog + '；' : '') + travelOut.join('；');
  if (delivered.length) {
    ctx.opLog = (ctx.opLog ? ctx.opLog + '；' : '') + delivered.map(d => (d.body ? ('收到' + resolveSpeaker(data, d.from) + '的回复：' + d.body) : (resolveSpeaker(data, d.from) + '看了消息，没有回'))).join('；');
  }
  if (epochOut && epochOut.length) {
    // v1.89：原来这里拼的是『世界变化』——那是**系统术语**，会被结果行原样印到玩家屏幕上（越权红线 1）。
    // 世界会变，但玩家看到的应该是「发生了什么」，不是「一个叫世界变化的东西生效了」。
    ctx.opLog = (ctx.opLog ? ctx.opLog + '；' : '') + epochOut.slice(0, 3).join('；');
  }
  // 接力链示例：消息AI 完成 → 热词判定 → 派给 news 生成器（payload 交代消息全文/双方/时间）
  const HOT = /火|着|偷|警|炸|死|救|抓|事发|出事|完蛋/;
  const hotMsg = delivered.find(d => (d.msgs || []).join('').match(HOT) || (d.body && HOT.test(d.body)));
  if (hotMsg) {
    try {
      const routed = await DIR.routeRequests(data, cfg, [{ kind: 'news', need: '把这件事变成镇上的谈资', hint: '市井传闻', payload: { text: (hotMsg.msgs || []).join('；') || hotMsg.body || '', from: hotMsg.from, t: hotMsg.t } }]);
      for (const rr of routed) if (rr && rr.name) ctx.opLog = (ctx.opLog ? ctx.opLog + '；' : '') + '（街坊都在传：' + rr.name + '）';
    } catch (e5) { DEG.hit("game.js", e5); }
  }
  if (offstageOut && offstageOut.length) {
    ctx.offstage = offstageOut;
    ctx.opLog = (ctx.opLog ? ctx.opLog + '；' : '') + '（你不在场时：' + offstageOut.join('；') + '）';
  }
  if (editOut && editOut.length) {
    /* v1.99 · P0-5 第 2 步：副 AI-编辑产出的新闻也要过门 ——
       原来这里只有一个 `n.severity || '低'` 兜底（连合法取值都不查），
       于是"稿子写得越狠，世界里的事就越大"，没人拦。现在按桥换算 L 级 → 比上限 → L3+ 要看前兆与节奏门。 */
    /* v2.03 · P0-6 收尾：编辑稿的落库也走总线（裁决点唯一）。 */
    for (const n of editOut) {
      if (!n || !n.title || data.news.some(x => x.title === n.title)) continue;
      BUS.commit(data, [{ kind: 'news', source: 'news', newsSeverity: n.severity, foreshadowRef: n.foreshadow || n.refNews || '',
        item: Object.assign({ t: newTime, tags: n.tags || [], region: n.region || '', impact: n.impact || { 时长: '短期', 范围: '本地' } }, n) }], { t: newTime });
    }
  }

  // ---------- 副 AI-计算：并发解耦——不挡主 AI（本回合用已有候选；新候选回合末产出，下回合生效） ----------
  const candidates = RT.genCandidates(data);
  const scene = getEntity(data, data.current.sceneId) || {};
  // v1.83 修缺口清单 C2：这里原本硬编码 '便利店'（早期"便利店雨夜"版本残留），
  // 会把一个 2026 内容词注入**每个世界**的记忆漏斗标签。场景自身 tags + 天气足够了。
  const sceneTags = (scene.tags || []).concat([data.current.weather]);
  /* v1.95：**查询语句必须参与打分**（三因子里的 relevance）。
     原来这里只传了场景标签 —— 于是「玩家刚说的那句话」对检索结果毫无影响：
     实测 recall@4 = 55%（量表 scripts/mem-recall.js 早写着「低于目标线 75%」）。
     现在把「玩家这一下 + 最近 4 条原文」当查询传进去（同一份东西本来就要进资料包，0 额外成本）。 */
  const memQuery = String(text || '') + ' ' + (data.sceneLog || []).slice(-4).map(l => String(l.text || '')).join(' ');
  ctx.memories = RT.funnelMemories(data, 'player', sceneTags, 4, memQuery).concat(RT.funnelMemories(data, firstNpcId(data), sceneTags, 4, memQuery));
  ctx.candidates = candidates;
  ctx.offlineMsgs = offline;
  ctx.destId = intent.destId;
  ctx.destName = intent.destName;
  ctx.msgReply = null;
  ctx.itemId = intent.itemId;
  if (intent.kind === 'msg') {
    ctx.msgReply = AI.mockReply(data, text, firstNpcId(data));
    data.messages.push({ id: data.id('msg'), from: 'player', to: 'npc_1', body: text, t: before, status: 'sent', via });
    data.messages.push({ id: data.id('msg'), from: 'npc_1', to: 'player', body: ctx.msgReply && ctx.msgReply.body ? ctx.msgReply.body : null, t: RT.addMinutes(before, 3), status: ctx.msgReply && ctx.msgReply.body ? 'replied' : 'read', via });
  }
  // ---------- 动态动作（customActions：确定性 effects 执行） ----------
  if (intent.kind === 'custom' && intent.action) {
    /* v1.99 · P0-6 第一批：applyCustom 现在是 async（add_entity 必须 await 才能让玩家当回合看见）
       而且返回 { lines, rejected, clockDelta }：opLog 文案一字不变，被拒从"一句异常"变成结构化记录。 */
    const fxs = await DIR.applyCustom(data, intent.action, cfg, newTime);
    ctx.custom = { id: intent.customId, effects: fxs.lines, rejected: fxs.rejected, clockDelta: fxs.clockDelta };
    ctx.opLog = (ctx.opLog ? ctx.opLog + '；' : '') + '（' + fxs.lines.join('；') + '）';
  }
  // ---------- 交易（确定性；账本 + 余额；世界不赊账） ----------
  /* ★ v2.14：说了"买XX"但**店里没有那件货** —— 也必须给结果行。
     否则玩家提了这件事，屏幕上什么都不发生 = "我买到了吗？不知道"。
     这一支不走交易系统（没价、没货），只把"你要买什么"明确交出去，但**结果行必须有**。 */
  if (intent.kind === 'buy' && !intent.itemId && intent.want) {
    ctx.opLog = (ctx.opLog ? ctx.opLog + '；' : '') + '（你要买「' + intent.want + '」——先看这儿有没有）';
  } else if (intent.kind === 'buy' && intent.itemId) {
    const it = getEntity(data, intent.itemId);
    const price = it ? (it.price || 0) : 0;
    const afford = tryPay(data, price, it ? it.name : '东西');
    ctx.trade = { ok: afford.ok, price, item: it ? it.name : '东西', shortfall: afford.shortfall, err: afford.err };
    if (afford.ok) {
      // 物品进包（item 实体在场时移除/标记购买）
      if (it) it.bought = (it.bought || 0) + 1;
      const p = data.entities.player;
      if (p && price > 0) p.inventory.push({ id: data.id('item'), name: it.name, can: '', value: it.price || 0 });
      else if (p && !price) p.inventory.push({ id: data.id('item'), name: it.name, can: '', value: 0 });
      // 换机：买的设备（swapDevice）→ 玩家随身设备更新（工具 app 随型号走）
      if (it && it.swapDevice && p) {
        data.current.device = Object.assign({}, it.swapDevice);
        const oldDev = p.inventory.find(x => /大哥大|诺基亚|手机/.test(x.name || '') && x.id !== it.id && !x.swapped);
        if (oldDev) { oldDev.swapped = true; oldDev.name = '旧' + oldDev.name; }
        ctx.opLog = (ctx.opLog ? ctx.opLog + '；' : '') + '你换上了一部' + it.name;
      }
      ledgerPush(data, { t: newTime, type: '物品获取', target: 'player', desc: '买入 ' + it.name + '（' + price + '）', cause: '交易', scene: data.current.sceneId });
      if (it && it.price && data.entities.player && data.entities.player.money) data.entities.player.money.spent += price;
    } else {
      ledgerPush(data, { t: newTime, type: '交易拒绝', target: 'player', desc: '余额不足购买 ' + (it ? it.name : '物品'), cause: '余额不足', scene: data.current.sceneId });
    }
    ctx.tradeDone = true;
  } else if (intent.kind === 'sell' && intent.itemId) {
    const p = data.entities.player;
    const ix = (p && p.inventory || []).findIndex(x => x.id === intent.itemId);
    if (ix >= 0) {
      const item = p.inventory[ix];
      const price = item.value != null ? item.value : (item.price || 2);
      const got = tryEarn(data, price, item.name);
      p.inventory.splice(ix, 1);
      ctx.trade = { ok: true, price: got.value, item: item.name };
      ledgerPush(data, { t: newTime, type: '物品消耗', target: 'player', desc: '卖出 ' + item.name + '（' + got.value + '）', cause: '交易', scene: data.current.sceneId });
    } else {
      ctx.trade = { ok: false, item: intent.itemName || '东西', err: '没带在身上' };
      ledgerPush(data, { t: newTime, type: '交易拒绝', target: 'player', desc: '卖出失败（没带在身上）', cause: '物品不在', scene: data.current.sceneId });
    }
  }

  /* v1.94：**角色分工 —— 引擎先问过在场的人**（打破单体代理的关键一刀）。
     为什么要动：arXiv:2502.19519 的受试者内对照显示，把 GM 变 agentic 之后
     连贯/沉浸/好奇/掌控都显著改善，**人物魅力 p=0.295 完全没动** ——
     人物层不是靠「更好的 GM」解决的，是靠**让角色自己开口**。
     做法：并行问（不串行叠加等待）→ 限量（meta.actorBudget，默认 2）→
     原话进资料包的「他们自己开口了」→ 主 AI 用原话写场景 → 引擎再兜一次保证它落到画面里。
     纯代码决定「问谁」（0 token）；被问的人自己决定「说什么」。 */
  ctx.selfVoice = [];
  if (AI.isLive(cfg)) {
    try {
      const bud = Number((data.meta || {}).actorBudget != null ? (data.meta || {}).actorBudget : 2);
      const sp = AI.spotlight(data, bud);
      if (sp.length) {
        const lead = (data.sceneLog || []).slice(-2).map(l => String(l.text || '')).join('。');
        const line = '刚才：' + lead + '｜玩家这一下：' + String(text || '').slice(0, 60);
        const rs = await Promise.all(sp.map(x => SCHED.dispatch(data, cfg, 'actor', { npcId: x.who, context: line }).catch(() => null)));
        for (const rr of rs) if (rr && rr.detail && rr.detail.line) ctx.selfVoice.push(rr.detail);
      }
    } catch (e0) { DEG.hit('game.js', e0); }
  }

  /* v1.89：**结果行** —— 玩家自己动作的确定性结果，必须有玩家可见的通道。
     实测病根（审视 §3.4 坑 4）：ctx.opLog 在 game.js 里有 15 处赋值，全是引擎算出来的结论
     （「你买好了去临江的车票——30块」「你摸遍口袋，差 12 块」），但它只流向 ① AI 资料包 ② records，
     **buildView 里一处都没有**（第 1100 行之后 opLog 命中 = 0）——
     玩家买票成没成功，只有 AI 恰好复述一遍他才知道。而这条连 ledger 都没写。
     现在：落成一条 outcome beat（进存档、进下一回合的「最近场景原文」），渲染时单独一档样式。 */
  if (ctx.opLog) {
    try {
      const lastLine = data.sceneLog[data.sceneLog.length - 1];
      if (!(lastLine && lastLine.type === 'outcome' && lastLine.text === ctx.opLog)) {
        data.sceneLog.push({ t: data.current.time, turn: data.current.turnN || 0, type: 'outcome', text: String(ctx.opLog).slice(0, 300) });
      }
    } catch (e) { DEG.hit('game.js', e); }
  }
  let out;
  /* v1.84：**二轮整合预算**。一回合最坏会串行 5~6 次主 AI 调用（重写/查询/工具回执/冲突修订），
     而每次都把完整资料包原样重发 ⇒ 输入 token 随轮数膨胀，且设计文档里从没定过上限。
     现在给一个可配置的预算（默认 3 次二轮），超了就不再做整合轮，直接按现有产出保守发布。 */
  let __aiExtra = 0;
  const __aiBudget = Math.max(0, Number((data.meta && data.meta.turnExtraBudget) != null ? data.meta.turnExtraBudget : 3));
  /* v1.97 ★ 修 X1（评审回执_v1.96 挖出、两份外部评审都没发现）：
     原来这里是 `const messages = [` —— **声明在 if (AI.isLive) 块内**，而"冲突回灌"（GATE.conflicts
     → 把冲突事实回执给 AI 让它改）在**块外**第 1002 行用它 ⇒ **只要有冲突就抛 ReferenceError**，
     被 `catch (e8)` 吞掉 ⇒ ① 冲突永不回灌给 AI ② 也不走"≤2 轮不收敛 → autoFix + 保守发布 + 记账"
     ③ 两件事都静默发生。**于是整个"创造循环第③步"从未执行过一次，而它正是两份评审的 #1 议题
     （"校验器是单向闸口、拒绝意见不回灌 AI"）在代码里的同一条。**
     修法：提到函数作用域；演示模式（无 messages）时由下游守卫直接走保守发布。 */
  let messages = null;
  let __fixedRound = false;   // v1.98 P0-4：本回合只做**一轮**修正（见下面校验后的修正轮）
  if (AI.isLive(cfg)) {
    messages = [
      /* S1：moduleFor 原来拼在 system 末尾 —— intent.kind 一变，system 整块前缀就失效（缓存全废）。
         它属于「本轮变动」，移到资料包末尾（contract 的 volatile 段最后一位）。
         好处：system 变成**逐字节稳定**的前缀，整块可长期命中。 */
      { role: 'system', content: AI.SYSTEM(data, cfg) },
      { role: 'user', content: AI.packetFor(data, ctx) }
    ];
    // 动态思考档位：0 token 打分（多方在场/极端冲突/关系张力/离线积压/上回合打回）
    const think = AI.thinkBudget(data, intent, ctx, __hardLast);   // v1.97 X7：用回合开头取出的"上回合打回"
    if (ctx) ctx.think = think;
    /* v2.09：主叙事这一路如果落兜底，**玩家必须能知道**（原来完全静默）。
       var（不是 let）：它在函数作用域里，要带到下面的 return 去。 */
    var __fellBack = false;
    out = await AI.llmJSON(cfg, messages, function () { __fellBack = true; return AI.mockMain(data, ctx); }, AI.cfgMax(cfg), (opts && opts.onDelta) || undefined, think);
    if (out && out.__fallback) { __fellBack = true; out = out.value; }
    // ---- 叙事主权闭环：现实化/说教检测命中 → 带重写要求重试一次（仅一次，不循环） ----
    const guardHit = (out && !out.__fallback) ? AI.guardCheck(out) : null;
    if (guardHit && __aiExtra < __aiBudget) { __aiExtra++;
      try {
        console.log('[guard] 命中 ' + guardHit.join('/') + ' → 重写一轮');
        messages.push({ role: 'user', content: '【重写要求】上一版出现「' + guardHit.join('、') + '」——以现实视角介入或说教式处理，违反叙事主权（虚构内容按世界规则演进，不作现实道德裁决，不解释、不道歉）。请完全以本世界观重写，只输出最终 JSON。' });
        const outR = await AI.llmJSON(cfg, messages, () => null, AI.cfgMax(cfg), (opts && opts.onDelta) || undefined, (think === 'none' ? 'medium' : 'high'));
        if (outR && !outR.__fallback && outR.frame) out = outR;
      } catch (e) { DEG.hit("game.js", e); }
    }
    // ---- 按需调取（v1.55）：AI 说"我要查什么" → 引擎只读/门控/带出处地给 → 二轮整合 ----
    // 读**不设条数上限**（用户拍板：还原优先）；查不到就老实说没有，不许编。
    if (out && out.query && !out.__fallback && __aiExtra < __aiBudget) { __aiExtra++;
      try {
        const qres = QUERY.resolve(data, out.query);
        QUERY.trace(data, out.query, qres);
        messages.push({ role: 'user', content: '【查询回执】' + String.fromCharCode(10) + QUERY.render(qres) + String.fromCharCode(10) + '请据此一次性输出最终 frame/updates（不要再调用工具）。' });
        const outQ = await AI.llmJSON(cfg, messages, () => null, AI.cfgMax(cfg), undefined, 'medium');
        if (outQ && !outQ.__fallback && outQ.frame) out = outQ;
      } catch (e6) { DEG.hit("game.js", e6); }
    }
    // ---- requests（世界导演）：罕见 → 回执 → 二轮整合（保留） ----
    const reqs = (out && out.requests && out.requests.length) ? out.requests : (out && out.summon ? [out.summon] : null);
    if (reqs && __aiExtra < __aiBudget) { __aiExtra++;
      try {
        const routed = await DIR.routeRequests(data, cfg, reqs);
        if (routed && routed.length && routed.some(r => r.name || r.id)) {
          const recap = routed.map(r => (r.name || r.note || r.kind)).filter(Boolean).slice(0, 4).join('；');
          messages.push({ role: 'user', content: '【工具回执】' + recap + '（已入库，可用名字引用）。请利用它们一次性输出最终 frame/updates（不要再调用工具）。' });
          const out2 = await AI.llmJSON(cfg, messages, () => null, AI.cfgMax(cfg), undefined, 'medium');
          if (out2 && !out2.__fallback && out2.frame) out = out2;
        }
      } catch (e5) { DEG.hit("game.js", e5); }
    }
    // ---- 生图导演笔记（A 步：登记任务；B 步 server 接 ComfyUI 出图）----
    // 开关必须在**登记端**也拦一次：只在 server 端拦的话，主 AI 仍会输出 img、任务仍会登记、
    // 前端仍会画出一堆"永远填不满的图位"（用户实测：关了生图还是有 img 块）。
    if (cfg.image && cfg.image.enabled) {
      const policy = cfg.image.policy || 'always';               // v1.62 配图偏好：always / encourage / key
      let imgNotes = (out && Array.isArray(out.img)) ? out.img : [];
      try {
        const beatCount = ((out.frame && out.frame.beats) || []).length;
        const picks = [];
        for (let ii = 0; ii < Math.min(2, imgNotes.length); ii++) {
          const im = imgNotes[ii] || {};
          const whoArr = Array.isArray(im.who) ? im.who : (im.who ? [im.who] : []);
          const okWho = whoArr.filter(id => (data.knowledge.knownPeople || []).includes(id)); // 名字门控：见过的才画
          if (!okWho.length && whoArr.length) continue; // 全是没见过的 → 跳过
          const at = (im.at != null && Number(im.at) >= 0 && Number(im.at) < beatCount) ? Number(im.at) : null; // at 必须指到本回合 beat，否则不进叙事流
          picks.push(Object.assign({}, im, { who: okWho, at: at }));
        }
        /* v1.62 配图偏好 always：AI 这一回合没写画面笔记（或被名字门控全滤掉）时，**引擎自己补一条**。
       用户原话：「当开启生图功能按照原有插件设计（需至少生成 1 张）」「我都开了生图模块了，为什么没有！」。
       0 token：挑谁、挑哪个时刻都是确定性的，不额外调模型。 */
        if (!picks.length && policy === 'always') {
          try { picks.push(autoImgNote(data, out)); } catch (e3) { DEG.hit("game.js", e3); }
        }
    // 剧情里新冒出来的人没有九维档案，而 scheduler 的原则是"无锚点人物绝不写人貌"——
        // 不先补档，这一张图只会画成没有人的空场景。补档只发生在**每个人第一次被画**时，之后 0 成本。
        // 多人并行补，避免串行叠加等待。
        const need = [...new Set(picks.flatMap(x => x.who || []))]
          .filter(id => { const e = data.entities[id]; return e && e.type === 'person' && nineFilled(e) < 4; });
        if (need.length && AI.isLive(cfg)) {
          try { await Promise.all(need.map(id => genProfile(data, id, cfg).catch(() => null))); } catch (e2) { DEG.hit("game.js", e2); }
        }
        // 记下**拍摄时的场景 id**：舞台选图要按它匹配，否则离开这个场景后还会一直挂着这张图
        for (const pk of picks) await SCHED.dispatch(data, cfg, 'image', { img: Object.assign({}, pk, { sceneId: data.current.sceneId }) });
      } catch (e) { DEG.hit("game.js", e); }
    }
    // ---- delegate（角色委派·极稀缺）：主AI首轮(流式)完成后 → 并行 actor（3-6s）→ 组装替换/插入；无二轮 ----
    // 容错：actor 空回 → 保留主AI首轮已写的该角色台词（兜底成片，零缺口）
    if (out && out.delegate && out.delegate.who) {
      try {
        const act = await SCHED.dispatch(data, cfg, 'actor', { npcId: out.delegate.who, context: (data.sceneLog || []).slice(-2).map(l => String(l.text || '')).join('。') });
        if (act && act.detail && (act.detail.line || act.detail.action)) {
          out.frame = mergeActorInto(out.frame, act.detail);
        }
      } catch (e6) { DEG.hit("game.js", e6); }
    }
    /* v1.94：他们自己的话**必须落到画面里**。
       主 AI 若已原样用过（这是我们要求的），就不动它 —— 不做无谓的覆盖；
       没用过（漏了、改了、或压根没写这个人的 beat）才由引擎补进去。
       这是「保证交付」而不是「强制替换」：模型照做时零干预，不照做时也不会丢。 */
    if (ctx.selfVoice && ctx.selfVoice.length) {
      for (const v of ctx.selfVoice) {
        try {
          const used = ((out.frame && out.frame.beats) || []).some(b => b && b.speaker === v.who && String(b.text || '').indexOf(String(v.line || '').slice(0, 8)) >= 0);
          if (!used) out.frame = mergeActorInto(out.frame, v);
        } catch (e8) { DEG.hit('game.js', e8); }
      }
    }
  } else {
    out = AI.mockMain(data, ctx);
  }
  if (!out || !out.frame) out = AI.mockMain(data, ctx);

  // v1.56 输出侧门控：AI 写出来的画面里混进了"玩家还不该知道的名字" → **换成看得见的称呼**
  try {
    const sc = GATE.scrubAll(data, out.frame);   // v1.58：打码 + 删导演笔记
    if (sc.hits.length) {
      out.frame = sc.frame;
      MF.record(data, { kind: '门控', name: sc.hits.map(h => h.name).join('/'), schema: 'gate.scrub.v1', by: 'engine', note: '画面里出现了玩家不该知道的名字，已自动换成可见称呼' });
    }
  } catch (e9) { DEG.hit("game.js", e9); }
  // v1.56 冲突检查（创造循环第③步）：与现有数据对不上 → 回执给 AI 改；≤2 轮仍不收敛 → 记账后**保守发布**
  try {
    let rounds = 0;
    for (;;) {
      const cs = GATE.conflicts(data, out.updates || [], out.frame || {}, ctx);
      if (!cs.length) break;
      /* v1.97 ★ 修 X7：**校验被打回**就是 _hardLast 的天然产出点（下回合给主 AI 更多思考预算） */
      data.current._hardLast = true;
      // v1.97：`!messages`（演示模式没有对话数组）也必须走保守发布，而不是在下面 push 时抛错
      if (rounds >= 2 || __aiExtra >= __aiBudget || !messages) {
        // ★ v1.57 升级到**修复模式**（用户 §28.8）：循环内解决不了 →
        //   ① 引擎机械能修的修掉（0 token）② **丢弃引发冲突的提议**（保守发布）③ 记账
        try {
          const REP = require('./repair');
          const au = REP.autoFix(data);
          if (au.fixed.length) MF.record(data, { kind: '修复', name: au.fixed.join('/').slice(0, 60), schema: 'repair.auto.v1', by: 'engine', note: '回合内冲突不收敛，引擎自动修' });
        } catch (e0) { DEG.hit("game.js", e0); }
        const badRefs = {};
        for (const c of cs) if (c.ref) badRefs[c.ref] = true;
        const kept = (out.updates || []).filter(u => !(u && (badRefs[u.target] || badRefs[u.title] || badRefs[u.owner])));
        const dropped = (out.updates || []).length - kept.length;
        if (dropped > 0) out.updates = kept;
        MF.record(data, { kind: '冲突未解', name: cs.map(c => c.kind).join('/'), schema: 'gate.conflict.v1', by: 'engine', note: cs[0].why + (dropped ? ('；已丢弃 ' + dropped + ' 条冲突提议（保守发布）') : '') });
        break;
      }
      rounds++;
      messages.push({ role: 'user', content: GATE.render(cs) });
      const out3 = await AI.llmJSON(cfg, messages, () => null, AI.cfgMax(cfg), undefined, 'medium');
      if (out3 && !out3.__fallback && out3.frame) out = out3; else break;
    }
  } catch (e8) {
    /* v1.98 · P0-4：这条 catch 曾经把**一切**吞进计数 —— 包括 ReferenceError（X1 就是这样藏了一个版本的）。
       真出了这类错误要能在日志里看见一行，否则"引擎静默没做某事"永远查不出来。 */
    if (e8 instanceof ReferenceError || e8 instanceof TypeError) console.error('[turn] ' + String((e8 && e8.message) || e8));
    DEG.hit("game.js", e8);
  }
  let v = RT.validateUpdates(data, out.updates || [], out.frame || {}, ctx);
  let allowedU = v.allowed;
  /* ── ★ v1.98 · P0-4：**回合内修正轮** ─────────────────────────────────────
     病：Update 被校验器拒掉之后是"丢了就丢了" —— AI 不知道哪条被拒、为什么，
     下一回合照样可能再犯同一件事；玩家看到的是"我说了那句话，世界没反应"。
     修：把结构化拒绝（哪一条、什么原因、人话）在**同一次对话里**追加给 AI，
     只要求它重出被拒的那几条；拿回来的结果**全量重过一遍**同一道校验器。
     为什么必须全量重验：runtime 的 fxSeen 是 per-call 的局部量（本回合演出数 ≤1），
     只验修正项会让一回合过两条演出。
     为什么只做一轮：这是"兜底"，不是"跟 AI 谈判"；再来一轮就是回合内无限烧 token。
     为什么离线不触发：out.__fallback = 演示模式没有真的 AI，回灌给谁看？ */
  if (v.rejected.length && v.rejected.length < (out.updates || []).length && !out.__fallback && messages && !__fixedRound) {
    __fixedRound = true;
    data.current._hardLast = true;   // 校验没过 = "上回合没处理好"，下一回合多给一点思考预算
    try {
      messages.push({ role: 'user', content: '【校验回执】这一回合的 Updates 里有 ' + v.rejected.length + ' 条不符合引擎规则，已丢弃：' + JSON.stringify(v.rejected)
        + '。请**只重新输出这几条**（用 {"updates":[...]} 的格式，按同样的顺序）；不要重写 frame、不要重复已经通过的条目。'
        + '如果某一条无法在不违反规则的前提下改写，就干脆不要输出它。' });
      const out4 = await AI.llmJSON(cfg, messages, () => null, AI.cfgMax(cfg), undefined, 'medium');
      if (out4 && !out4.__fallback && Array.isArray(out4.updates)) {
        const rej = v.rejected.slice().sort((x, y) => x.index - y.index);
        const repl = out4.updates.slice(0, rej.length);
        const merged = [];
        let ri = 0;
        for (let k = 0; k < (out.updates || []).length; k++) {
          const isRej = rej.some(x => x.index === k);
          if (!isRej) { merged.push(out.updates[k]); continue; }
          const nw = repl[ri++];
          if (nw) merged.push(nw);       // 改写成功的留下；没给对应的 = AI 放弃了这条
        }
        out.updates = merged;
        const v2 = RT.validateUpdates(data, out.updates, out.frame || {}, ctx);   // ★ 全量重验（fxSeen 才对）
        v = v2; allowedU = v2.allowed;
      }
    } catch (e9) { DEG.hit("game.js", e9); }
  }
  /* 可观测（0 token，只进开发者视图）：本回合被拒几条、有没有走修正轮 */
  try { data.current.lastValidate = { rejected: v.rejected.length, fixed: !!__fixedRound, t: newTime }; } catch (e0) { DEG.hit("game.js", e0); }
  if (ctx.tradeDone && ctx.trade) {
    /* v1.98 P0-4：这一段必须在**修正轮之后**跑 —— AI 补回来的条目可能是重复的交易提议。 */
    // 交易已由运行时写库存与账本：AI 再输出同一物品获取/消耗 → 过滤防重复
    allowedU = allowedU.filter(u => !((u.type === '物品获取' || u.type === '物品消耗') && u.item && u.item === ctx.trade.item));
    if (intent.kind === 'sell') allowedU = allowedU.filter(u => !(u.type === '物品消耗' && u.target === 'player' && !u.item));
  }
  // ── 动态维度 → 刚性锚点的**沉淀** ──
  // 某个 dynamic 维度连续 N 轮指向同一结果，说明它已不是"临时状态"而是**永久特征**
  // （**剪了头发** ≠ **今天头发湿了**）。沉淀后写进 nine（锚点），并从 dynamic 摘掉。
  // 跟"注记晋升为实体"是同一个模式。
  // 注意：只有 发型/衣着/配饰 参与沉淀；**表情/状态本质上就是临时的，永远不该进锚点**。
  try { sedimentDynamic(data, newTime); } catch (e0) { DEG.hit("game.js", e0); }
  // 动态视觉追踪：视觉变化（衣/发/妆/饰/体态状态句）→ 对应人物 profile.visual.dynamic（生图用实时状态；维度字典）
  try {
    for (const u of (allowedU || [])) {
      if (!u || !u.target || u.target === 'player') continue;
      const c = String(u.content || '');
      if (c && /衣|裙|鞋|袜|发|妆|帽|伞|领|链|手饰|外套|袍|裤|丝|露|湿|汗|泪|绷带|伤口/.test(c)) {
        const ent = data.entities[u.target];
        const vis = ((ent || {}).profile || {}).visual;
        if (!vis) continue;
        if (!vis.dynamic) vis.dynamic = {};
        const dyn = vis.dynamic;
        // 维度归类：发型/衣着/配饰/状态（旧{时间:句}快照迁移为"状态"）
        if (!Array.isArray(dyn._hist)) dyn._hist = [];
        const dim = /发|刘海|马尾|髻|辫|发色|发型/.test(c) ? '发型' : (/衣|裙|罩|衫|袍|裤|袜|鞋|靴|帽|袖|领|链|手饰|围巾/.test(c) ? '衣着' : (/妆|饰|伞|包/.test(c) ? '配饰' : '状态'));
        if (dyn[dim] && dyn[dim] !== c) dyn._hist.push(dim + (dyn[dim] || '').slice(0, 12));
        dyn[dim] = c.slice(0, 60);
        // 稳定性计数：值变了就重新从 1 开始（连续 N 轮不变才会沉淀进锚点）
        vis.dynaStable = vis.dynaStable || {};
        { const st = vis.dynaStable[dim]; if (!st || st.v !== dyn[dim]) vis.dynaStable[dim] = { v: dyn[dim], n: 1 }; }
        dyn._hist = dyn._hist.slice(-10);
        if (Object.keys(dyn).length > 14) { for (const k of Object.keys(dyn)) if (k !== '_hist' && k !== dim && typeof dyn[k] === 'string' && /^\d{1,2}:\d{2}$/.test(k)) delete dyn[k]; }
      }
    }
  } catch (e) { DEG.hit("game.js", e); }
  // 世界导演：任何岗位 AI 的"创造请求"（主AI requests/summon 兼容；≤1条/回合，按 kind 路由生成器）
  const reqs = (out.requests && out.requests.length ? out.requests : null) || (out.summon ? [out.summon] : null);
  if (reqs) {
    try {
      const routed = await DIR.routeRequests(data, cfg, reqs);
      for (const rr of routed) if (rr && rr.name) ctx.opLog = (ctx.opLog ? ctx.opLog + '；' : '') + '（新出现：' + rr.name + '）';
    } catch (e4) { DEG.hit("game.js", e4); }
  }
  const applied = applyUpdates(data, allowedU, newTime);

  // ---------- 场景画：唯一来源=引擎程序大图（画内交互/布局缓存）；AI 不再提供画（防指令打架） ----------
  if (data.current.sceneArtAI) delete data.current.sceneArtAI; // 残留旧 AI 画一次性清除

  // 场景日志（限长 30）
  // v1.84：时间戳取 data.current.time（applyUpdates 里"AI 让玩家移动"会推进时间）
  /* v3.9：场景日志每条都带**轮次**（用户：「以后所有产出的数据都要打上标记 这是哪一轮-什么事件」）——
     一条 sceneLog 不带轮次，事后就分不清「这句台词是第几轮说的」，回读窗口与复盘都只能靠时间戳猜。 */
  const line = function (type, text2, speaker, tone) { return { t: data.current.time, turn: data.current.turnN || 0, type, speaker, tone, text: text2 }; };
  data.sceneLog = data.sceneLog || [];
  const spanStart = data.sceneLog.length;
  data.sceneLog.push(line('user-action', '你: ' + text));
  /* ★ v2.13 **状态块必须由状态生成，不许由叙事生成。**
     原来这一行直接把 out.frame.tag（**AI 自己写的一行字**）印成场次标签。
     实测后果：AI 写「赵家小洋楼·院门口」，而 current.sceneId 还是 p1（二楼游戏室）——
     屏幕上写着"院门口"，玩家就以为自己出去了；**状态一步没动，而他无从知道**。
     现在标签由引擎拼：地点名从 sceneId 查、时段/天气从 current 取 —— 它永远和状态一致，
     所以"你没出去"这件事**当场看得见**。
     AI 的 tag 不采纳；但它若明显在演另一个地方（= 想移动却没报地点变化），记一笔。 */
  const placeNow = (data.entities && data.current.sceneId && data.entities[data.current.sceneId]) || null;
  const placeName = (placeNow && placeNow.name) || '';
  if (placeName) {
    const tagNow = '[' + placeName + ' · ' + RT.dayPart(data.current.time) + ' · ' + String(data.current.weather || '').slice(0, 24) + ']';
    const last = data.sceneLog[data.sceneLog.length - 1];
    if (!(last && last.type === 'stage-tag' && last.text === tagNow)) data.sceneLog.push(line('stage-tag', tagNow));
    if (out.frame.tag && String(out.frame.tag).indexOf(placeName) < 0 && String(out.frame.tag).replace(/[\[\]·\s]/g, '').length > 3) {
      try { DEG.hit('game.js:tag', new Error('AI 的场次标签与状态不符：tag="' + String(out.frame.tag).slice(0, 40) + '" 而你在「' + placeName + '」—— 它多半在演"已经移动"却没报地点变化')); } catch (e) {}
    }
  } else if (out.frame.tag) {
    data.sceneLog.push(line('stage-tag', out.frame.tag));   // 没有地点实体（老档/demo）：退回 AI 的 tag
  }
  const hasTag = data.sceneLog.length > spanStart + 1 && data.sceneLog[spanStart + 1] && data.sceneLog[spanStart + 1].type === 'stage-tag';
  const beatsStart = spanStart + 1 + (hasTag ? 1 : 0);
  for (const b of (out.frame.beats || [])) {
    /* v1.84：存 **id**，不存名字。原来存的是 resolveSpeaker() 的结果 = 人物**真名**，而这一串会
       原样进 AI 的资料包（packetFor「最近场景原文」）⇒ 玩家还不认识的人的真名被喂给 AI，
       而 SYSTEM 又要求 AI 照资料包的称呼写台词 —— 门控在最后一个出口漏掉（缺口清单 A4 的真正危害）。
       渲染时由 buildView 把 id 解析成玩家该看到的称呼（老档里的名字型 speaker 照旧兜底可用）。 */
    const sid2 = b.speaker ? String(b.speaker) : '';
    /* v1.89：**四个槽位全部落库**。原来只存 {t,type,speaker,tone,text} ——
       AI 按契约辛苦分开写的 action / expression / voice 在落库那一刻被丢掉，下一回合又以平文本回灌；
       同时 app.js 的 beatLine 只把 expression 当 CSS 属性用。结果：
       「动作和台词分开写才有主次两层」只在**当回合**生效，第二天就没了（审视 §8.3 的五环泄漏）。
       用 undefined 而不是空串：老档里没有这些字段的 beat 形状不变。 */
    data.sceneLog.push({
      t: data.current.time, turn: data.current.turnN || 0, type: b.type, speaker: sid2, tone: b.tone, text: b.text,
      action: b.action || undefined, expression: b.expression || undefined,
      voice: b.voice || undefined, actor: b.actor || undefined
    });
  }
  /* ★ v3.3 · 念头（suggestions）：**玩家的内在声音**。门控在 gateSuggestions() 里，
     抽成具名函数是为了能离线断言（原来写成内联 IIFE，测试够不着它）。 */
  data.current.suggestions = gateSuggestions(data, (out.frame && out.frame.suggestions) || out.suggestions || []);   // 顶层写法也收（模板放 frame 里，但模型偶尔会平铺）
  /* v3.0 · 镜头（focus）：**主次由 AI 定，不由代码的公式定**（用户 2026-09-19）。
     AI 可以给一个、给几个（几个人都重要是正常的）、也可以一个都不给（独处 / 环境在推动）。
     这里只做**合法性**：id 必须真实存在、且本回合真的出场过；不合法的丢掉。
     丢掉之后**不补默认值** —— 用公式替 AI 选一个主角，等于把叙事判断从 AI 手里抢回来。 */
  data.current.focus = (function () {
    const raw = (out.frame && out.frame.focus) || [];
    const arr = Array.isArray(raw) ? raw : [raw];
    const appeared = {};
    for (const b of (out.frame && out.frame.beats) || []) {
      if (!b) continue;
      if (b.speaker) appeared[String(b.speaker)] = 1;
      if (b.actor) appeared[String(b.actor)] = 1;
    }
    appeared.player = 1;                       // 玩家这回合做了事（user-action）
    const outIds = [];
    for (const x of arr) {
      const id = String(x == null ? '' : x).trim();
      if (!id || outIds.indexOf(id) >= 0) continue;
      if (!data.entities[id]) continue;                              // 世界里没这个人/地方
      if (!appeared[id] && id !== data.current.sceneId) continue;    // 本回合没出场
      outIds.push(id);
      /* v2.07：**不再限 3 个**。"几个人算主角"是叙事判断，该由 AI 定（几个人都重要是正常的）；
         界面（board.js）按 N 个排版。代码只保证 id 合法、不重复。 */
    }
    return outIds;
  })();
  // 生图定位：本回合 beats 在 sceneLog 中的 span（img 任务的 at 对应其中序号；buildView 依此挂图）
  const beatsLen = (out.frame.beats || []).length;
  if (beatsLen > 0) data.current._imgBeatSpan = { start: beatsStart, count: beatsLen, t: newTime };
  else delete data.current._imgBeatSpan;
  /* v1.83 修 P1-5/P1-6：把"这张图属于哪一幕"**钉死在任务上**（绝对下标）。
     _imgBeatSpan 每回合被覆盖，而出图要 30~120 秒 —— 中间玩家可能已经走了好几个回合。 */
  if (beatsLen > 0) {
    try {
      for (const t of (data.current.imgTasks || [])) {
        if (t && t.at != null && t.absAt == null && Number(t.turn) === Number(data.current.turnN)) t.absAt = beatsStart + Number(t.at);
      }
    } catch (e0) { DEG.hit("game.js", e0); }
  }
  // v1.87：场景日志的窗口大小来自**统一策略表**（原来三处各写死 200）
  try { REC.archiveSpill(data, RET.CAPS.sceneLog); } catch (e) { DEG.hit("game.js", e); if (data.sceneLog.length > RET.CAPS.sceneLog) data.sceneLog = data.sceneLog.slice(-RET.CAPS.sceneLog); }

  let view2;
  const fresh = { kind: intent.kind, destName: intent.destName, offline: offline.length };
  /* v2.06 删（P1-4）：这里原来把 frame.options 归一化后写进 `data.current.lastOptions` ——
     全项目**没有任何地方读它**（视图 v1.84 起就不下发 options，解析代码只作旧档容错）。
     一个每回合都写、永远没人读的状态字段，就是"无效转发"里最便宜的一种：删掉。 */
  try { updateImpressions(data, out.frame, v.allowed); } catch (e) { DEG.hit("game.js", e); }
  // 身世回想：剧情/对话命中「隐约记得」→ 想起 + 写入记忆/日志
  const recalled = recallCheck(data, [text, '你']
    .concat((out.frame && out.frame.beats || []).map(b => b.text || ''))
    .concat((data.sceneLog || []).slice(-3).map(l => (l.text || '') + ' ' + ((l.speakerName) || (l.speaker) || ''))),
    present(data, data.current.sceneId).filter(p => p.id !== 'player').map(p => p.id));
  // v1.54 认知轨：把这一回合记进「你经历过」（原文全存由 REC.archiveSpill 负责，不再 200 条丢老的）
  try {
    REC.recordTurn(data, {
      t: newTime, turn: data.current.turnN, sceneId: data.current.sceneId,
      kind: intent.kind, action: text, opLog: ctx.opLog || '',
      people: present(data, data.current.sceneId).filter(p => p.id !== 'player').map(p => p.id),
      places: [data.current.sceneId]
    });
  } catch (e) { DEG.hit("game.js", e); }
  const tutorHint = advanceTutorial(data);
  /* ── 以下三行都必须在 buildView **之前**落地 ────────────────────────────────
     视图是"本回合的产出清单"。先取视图、再补两行，玩家这一回合就看不到它们：
       · reaction 会落在**下一个** stage-tag 之前 ⇒ 被折进"上一幕"，要看还得点开折叠；
       · tutor 要等下一次刷新才出现（而那时回合号已经变了，它又失效了）—— 等于白算。
     实测：先 buildView 的写法下，r.view.sceneLog 里一条 reaction 都没有。 */
  /* v1.97 ★ 修 X6：view.reaction 此前**没有任何渲染器**（前端 0 引用），是"算了没人看"的死数据；
     而它写的正是玩家该看见的"世界对你的反应"。
     它落成 **reaction 一档**（style.css 里 .beat.reaction 的样式一直都在，只是从来没有生产端），
     与 outcome 分开：**玩家做的 → outcome；世界回的 → reaction**。 */
  const __react = buildReaction(data, v.allowed);
  if (__react) {
    const __last2 = data.sceneLog[data.sceneLog.length - 1];
    if (!(__last2 && __last2.type === 'reaction' && __last2.text === __react)) data.sceneLog.push({ t: data.current.time, turn: data.current.turnN || 0, type: 'reaction', text: String(__react).slice(0, 300) });
  }
  /* v1.97：教程提示**不是世界内容**，它是引导 —— 所以它不进 sceneLog。
     sceneLog 是剧情原文：它会进剧本存档，也会作为「最近场景原文」喂给下一回合的主 AI，
     一条"回她？"混进去，等于让 AI 以为世界里有人这么说过。它走视图里的单独一档（见 buildView 的 tutor）。 */
  if (tutorHint) data.current.tutorHint = { text: String(tutorHint).slice(0, 160), turn: data.current.turnN || 0 };
  /* ★ v3.12 · 世界模板创造（用户 2026-09-27「动」）：**AI 负责想，代码负责批准**。
     · 想：主 AI 每回合顺手在 frame.creator 里说一句（{want, why}）—— **0 额外 token**（本来就要输出 frame）；
     · 批准：冷却 6 回合 + 每世界日 2 次 + 跨年（时代节点）免冷却 —— 纯算术，见 creator.shouldCreate；
     · 造：一次 llmJSONDeep（给它资料 + creatorPromptBlock），产出的板块过 checkPanel 校验后落进存档；
     · 留痕：采纳与未采纳都记进 framework.proposals；任何异常**不许连累回合**。
     位置在这一回合的最后（数据都落定了），所以新板块这一回合就能上屏。 */
  try {
    /* ★ v3.17 · 善后与有头有尾（0 token，每回合都跑）：
       enforceKeep = 按每格自己的寿命把超出的行**归档**（降级不是删）+ 折叠成一句留在眼前那一轨；
       retireByCode = 纯代码那条淘汰规则（声明 who:'code' 且超过寿命没更新 → 退休 + 进档案 + 等一句世界内交代）。 */
    try { CREATE.enforceKeep(data); } catch (eK) { DEG.hit('game.js:keep', eK); }
    try { CREATE.retireByCode(data); } catch (eR) { DEG.hit('game.js:retire', eR); }
    /* inline 类板块的行：主 AI 顺手产的（0 额外调用）—— 先落行，再谈造不造新的。 */
    try {
      const __pd = (out.frame && out.frame.panelData) || out.panelData || null;
      if (Array.isArray(__pd)) for (const it of __pd) { if (it && it.id && Array.isArray(it.rows)) CREATE.addRows(data, String(it.id), it.rows); }
    } catch (eR) { DEG.hit('game.js:panelRows', eR); }
    const __hint = (out.frame && out.frame.creator) || out.creator || null;
    if (__hint && __hint.want) {
      const __cr = await CREATE.maybeCreate(data, cfg, __hint);
      if (__cr && __cr.ok) ctx.opLog = (ctx.opLog ? ctx.opLog + '；' : '') + '（世界长出了新东西：' + (__cr.kept || []).map(k => (k.shape && k.shape.name) || '').filter(Boolean).join('、') + '）';
    }
  } catch (eC) { DEG.hit('game.js:creator', eC); }
  view2 = buildView(data);
  return { intent, frame: out.frame, errors: v.errors, applied, fresh, recalled: recalled || [], view: view2,
    /* v2.09：这一段是不是兜底生成的 —— 界面照实说，不再让玩家（和作者）自己猜。 */
    fallback: __fellBack ? '这一段是兜底生成的（模型没回应，引擎用确定性规则顶上了）' : '' };
}

// ---------- 消息异步回复（§9：物理运行时算"何时回"，消息 AI 判"回不回/回什么"，到期才生成） ----------
async function sendMessage(data, toId, text, cfg) {
  ensureKnowledge(data);
  const target = getEntity(data, toId);
  if (target && target.state && target.state.alive === false) return { reply: null, status: 'dead', view: buildView(data) };
  const now = data.current.time;
  const via = PRES.mainVia(data);
  data.knowledge = data.knowledge || {}; data.knowledge.phoneContacts = data.knowledge.phoneContacts || [];
  if (!data.knowledge.phoneContacts.includes(toId)) data.knowledge.phoneContacts.push(toId); // 主动发消息=存了号码
  data.messages.push({ id: data.id('msg'), from: 'player', to: toId, body: text, t: now, status: 'sent', via });
  // 回复计划：何时能看到/回（忙/夜里/连发→更晚），由插件确定性推导
  data.current.pendingReplies = data.current.pendingReplies || [];
  const myPend = data.current.pendingReplies.filter(p => p.from === toId).length + 1;
  const plan = RT.replyPlan(data, toId, now, myPend);
  data.current.pendingReplies.push({ id: data.id('rep'), from: toId, to: 'player', due: plan.due, plan: 'reply' });
  data.current.time = RT.addMinutes(now, 2);
  RT.tickNPCs(data, data.current.time);
  const v = buildView(data);
  v.msgReplyAt = plan.due.slice(5, 16).replace('T', ' ');
  return { reply: null, status: 'sent', view: v };
}

// 到期投递：世界时间到达计划时刻 → 生成回复（live=消息 AI；demo=mock）+ 写消息/状态
// 旅程 tick：班车途中（中断概率+到站物化）——世界时间驱动，异步无感
async function travelTick(data, cfg, nowISO) {
  const out = [];
  const plans = data.plans || [];
  const builds = (data.current.pendingBuilds = data.current.pendingBuilds || []);
  for (const pb of builds.slice()) {
    const plan = plans.find(p => p.id === pb.planId);
    if (!plan || plan.status !== 'aboard') { builds.splice(builds.indexOf(pb), 1); continue; }
    // 中断（事出有因：雨灾封路，概率小且在发车1小时后才可能发生）
    if (!pb.blocked && new Date(nowISO).getTime() > new Date(RT.addMinutes(pb.created || nowISO, 60)).getTime() && Math.random() < 0.06) {
      pb.blocked = true; plan.status = 'blocked'; plan.blockReason = '前方雨势过大，列车在半路停了，广播让大家等待';
      data.current.sceneId = 'pl_6'; data.entities.player.state.location = 'pl_6';
      data.sceneLog.push({ t: nowISO, type: 'narration', text: '列车在荒站停了两小时。广播通了：前方雨势过大，道路封闭，班车折返。' });
      out.push('你的班车被雨截住了——折返回了镇汽车站（改天再走）；');
      builds.splice(builds.indexOf(pb), 1);
      continue;
    }
    if (new Date(nowISO).getTime() >= new Date(pb.due).getTime() && !pb.built) {
      // 到站：物化城市蓝图（第一次到才生成；失败回退代码池）
      pb.built = true;
      /* v2.02 · P0-6：这一对硬编码（这里的 'city1_p1' 与 genCity 的 zone='city1'）必须成对改 ——
         只改一边就是"新城建好了、玩家站在旧城"。现在 zone 由 genCity 确定性推导并**在回执里带回来**，
         这里只认回执；**城没建起来就不许假装到了**（原来无论成败都写死到 city1_p1）。 */
      let cityName = '临江市', zone = '';
      try {
        const r = await DIR.routeRequests(data, cfg, [{ kind: 'city', need: '把' + pb.dest + '从计划变成一座城', hint: '旅途终点', payload: { dest: pb.dest, plan: plan } }], 2);
        if (r && r.length && r[0].name) cityName = String(r[0].name);
        if (r && r.length && r[0].id && r[0].built !== false) zone = String(r[0].id);
      } catch (e) { DEG.hit("game.js", e); }
      plan.status = 'done'; plan.arrivedAt = nowISO;
      const startPlace = (zone && data.entities[zone + '_p1']) ? (zone + '_p1') : '';
      if (startPlace) {
        data.current.sceneId = startPlace; data.entities.player.state.location = startPlace;
        const kp = data.knowledge.knownPlaces || (data.knowledge.knownPlaces = []);
        if (kp.indexOf(startPlace) < 0) kp.push(startPlace);
        data.sceneLog.push({ t: nowISO, type: 'stage-tag', text: '[站前街 · 到站]' });
        data.sceneLog.push({ t: nowISO, type: 'narration', text: '列车到站了。' + cityName + '的空气比家里潮，站前街挤着卖早点、拉客的、问路的——你踏上了这座城。' });
        out.push('列车到站：' + cityName + '（站前街）——子地点/NPC 已就绪：' + Object.keys(data.entities).filter(k => k.indexOf(zone + '_') === 0).length + ' 个单位');
      } else {
        const st = Object.values(data.entities).find(p => p.type === 'place' && /车站/.test(String(p.name || '')));
        if (st) { data.current.sceneId = st.id; data.entities.player.state.location = st.id; }
        data.sceneLog.push({ t: nowISO, type: 'narration', text: '列车到站了，站前街却还是一片空白——这一趟没能落到实地。' });
        out.push('列车到站了，但' + cityName + '没能建起来（引擎拒了这次生成）——你还站在' + ((st && st.name) || '原地'));
      }
      builds.splice(builds.indexOf(pb), 1);
    }
  }
  return out;
}

// 到期投递：多条到期=多个独立需求 → 并发请求（同一 API 下多请求并行，按 NPC 拆）
async function deliverPendingReplies(data, cfg, nowISO) {
  // 已故之人的消息不再回复；到期任务 → 调度器的 reply 能力（动态调度入口）
  const deadIds = Object.values(data.entities).filter(x => x.type === 'person' && x.state && x.state.alive === false).map(x => x.id);
  data.current.pendingReplies = (data.current.pendingReplies || []).filter(p => deadIds.indexOf(p.from) < 0);
  const due = RT.dueReplies(data, nowISO);
  if (!due.length) return [];
  const out = [];
  for (const p of due) {
    const sentMsgs = (data.messages || []).filter(m => m.from === 'player' && m.to === p.from && m.status === 'sent').slice(-5);
    const r = await SCHED.dispatch(data, cfg, 'reply', { npcId: p.from, msgs: sentMsgs, due: p.due });
    if (r && r.detail) out.push(Object.assign({ from: p.from, msgs: sentMsgs.map(m => m.body) }, r.detail));
  }
  return out;
}

function readMessage(data, id) {
  ensureKnowledge(data);
  const m = data.messages.find(x => x.id === id);
  if (m) { m.status = 'read'; if (!data.knowledge.readMsgs.includes(id)) data.knowledge.readMsgs.push(id); }
  return buildView(data);
}

function readNews(data, id) {
  ensureKnowledge(data);
  if (!data.knowledge.heardNews.includes(id)) data.knowledge.heardNews.push(id);
  return buildView(data);
}

function ensureImp(data, id) {
  data.impressions = data.impressions || {};
  if (!data.impressions[id]) {
    const rel = ((data.relations || {}).player || {})[id] || {};
    const tone = rel.tone || '';
    const npc = getEntity(data, id) || {};
    /* v1.88：**反向提权**。实测：关系写着「邻居的丈夫，**几乎没见过面**」，而这里只看见"邻居"二字
       ⇒ 直接判 stage=4（连名字都算知道）⇒ 玩家"认识"一个从没见过的人、资料包里他也在场。
       现在：先看有没有"没见过面"这类明确否定，有就压到 1。 */
    const NEG = /没见过面|素不相识|不认识|未曾谋面|一面之缘|初次见面|陌生/;
    const warm = NEG.test(tone) ? 1 : (/熟|房东|邻居|老友|旧识|多年|一家|亲人|恋人|兄弟|姐妹/.test(tone) ? 4 : (/点头|常客|见过|邻居家/.test(tone) ? 2 : 1));
    data.impressions[id] = {
      stage: warm,
      seen: ((npc.profile || {}).appearance || {}).标志物 || '',
      traits: warm >= 3 ? ['（老街坊的熟面孔）'] : [],
      notes: [],
      bonds: tone ? [tone] : ['初识'],
      nameKnown: npc.name,
      /* v3.9：印象的**出处** —— 这条印象是哪一轮、因为什么来的（用户举例：人物对某的印象）。
         原来印象档只有结论（stage/seen/bonds），没有任何「它是什么时候、因为什么变成这样」的痕迹。 */
      log: [{ turn: (data.current && data.current.turnN) || 0, what: '初次建档', why: '关系基调：' + (tone || '（未写）') }]
    };
  }
  /* v1.84：**归一化**已存在的印象档。原来只在"没有"时建，半截档（手写 / 导入 / 外部插件写的
     {stage, nameKnown} 而没有 traits/notes/bonds）会让 buildView 的 personView 直接崩
     （实测：imp.traits.slice 报 TypeError）。宁可补齐，也不要因为一份不完整的档把界面打崩。 */
  const imp = data.impressions[id];
  if (!Array.isArray(imp.traits)) imp.traits = [];
  if (!Array.isArray(imp.notes)) imp.notes = [];
  if (!Array.isArray(imp.bonds)) imp.bonds = [];
  if (imp.stage == null) imp.stage = 1;
  if (typeof imp.seen !== 'string') imp.seen = '';
  return imp;
}
// 玩家视角的名字：只有印象达"知道名字(>=2)"才显示；否则返回 null
function viewName(data, id) {
  if (id === 'player') return (data.entities.player || {}).name || '你';
  // v1.84：**尺子只有一把**（gate.nameOf）。这里只多做一件事：惰性播种印象档（老档/演示世界没有印象）。
  try { ensureImp(data, id); } catch (e) { DEG.hit("game.js", e); }
  return GATE.nameOf(data, id);
}
/* ★ v3.3 · 念头门控：**玩家的内在声音，原料必须是玩家自己知道的**。
   这是「不给建议，给观察」（设计纲领 §3 越权红线 3）在新功能上的唯一执行点 ——
   用户要的"外置大脑"能成立，靠的就是它只用玩家**已有的认知**当原料。
   逐条判、**逐条丢**（坏的那条丢，不整批丢），丢掉之后**不补**：
   拿公式替玩家想，等于把"念头"变回"任务列表"。
   判据全在确定性侧、全是查表（0 token、可离线断言）：
     · 提到玩家还不认识的人的真名 → 丢（名字的尺子只有一把：viewName → gate.nameOf）
     · 提到玩家没去过/不知道的地点名 → 丢
     · 超过 SUGGEST_LEN 字 → 丢（念头是短的；长句子是旁白）
     · 重复 → 丢；最多 SUGGEST_MAX 条
   代码在这里**只做取舍，不生成念头**（AI 自由度三档：叙事侧给原料，确定性侧只裁决）。 */
function gateSuggestions(data, raw) {
  const arr = Array.isArray(raw) ? raw : [raw];
  const K = data.knowledge || {};
  const knownPlace = {};
  for (const pid of (K.knownPlaces || []).concat(K.visited || [])) {
    const e = (data.entities || {})[pid];
    if (e && e.name) knownPlace[String(e.name)] = 1;
  }
  const kept = [];
  for (const x of arr) {
    const s = String(x == null ? '' : x).trim().replace(/\s+/g, ' ');
    if (!s || s.length > CONTRACT.SUGGEST_LEN) continue;
    if (kept.indexOf(s) >= 0) continue;
    let leak = false;
    for (const e of Object.values(data.entities || {})) {
      if (!e || !e.name || s.indexOf(String(e.name)) < 0) continue;
      if (e.type === 'person') { if (e.id !== 'player' && !viewName(data, e.id)) { leak = true; break; } }
      else if (e.type === 'place') { if (!knownPlace[String(e.name)]) { leak = true; break; } }
    }
    if (leak) continue;
    kept.push(s);
    if (kept.length >= CONTRACT.SUGGEST_MAX) break;
  }
  return kept;
}
function updateImpressions(data, frame, updates) {
  const us = updates || [];
  for (const u of us) {
    if (u.type === '印象更新' && u.target) {
      const imp = ensureImp(data, u.target);
      const ego = getEntity(data, u.target) || {};
      if (u.note) {
        const note = String(u.note).slice(0, 60);
        if (!imp.notes.some(n => n === note || (note.length > 6 && n.indexOf(note.slice(0, 6)) >= 0) || (n.length > 6 && note.indexOf(n.slice(0, 6)) >= 0))) {
          imp.notes.push(note); if (imp.notes.length > 6) imp.notes.shift();
          const tr = String(u.note).slice(0, 30);
          if (!imp.traits.some(t => t === tr || (tr.length > 6 && t.indexOf(tr.slice(0, 6)) >= 0))) { imp.traits.push(tr); if (imp.traits.length > 6) imp.traits.shift(); }
        }
      }
      if (imp.stage < 3) imp.stage = 3;
      if (ego.name && !imp.nameKnown) { imp.nameKnown = ego.name; imp.stage = Math.max(imp.stage, 2); }
    }
  }
  const presentIds = present(data, data.current.sceneId).filter(p => p.id !== 'player').map(p => p.id);
  for (const id of presentIds) {
    const imp = ensureImp(data, id);
    const beats = (frame && frame.beats) || [];
    const interacted = beats.some(b => b.speaker === id || b.actor === id);
    const npc = getEntity(data, id) || {};
    if (imp.stage < 2 && (interacted || (data.sceneLog || []).slice(-8).some(l => (l.speaker === npc.name || l.speaker === id)))) {
      imp.stage = 2; imp.nameKnown = npc.name || imp.nameKnown;
      if (!imp.seen) imp.seen = ((npc.profile || {}).appearance || {}).标志物 || '（只记得 TA 出现在眼前）';
    }
    if (imp.stage >= 2 && !imp.nameKnown) imp.nameKnown = npc.name;
    if (imp.stage >= 3 && !imp.seen) imp.seen = ((npc.profile || {}).appearance || {}).标志物 || '';
  }
}
// 工具视图：玩家随身的通信用具（device，买新机即换代）+ 世界环境工具（舆图/收音机…）
function buildViewTools(data) {
  const dev = data.current && data.current.device;
  const base = (data.meta && data.meta.tools) || [];
  const out = [];
  if (dev) out.push({ id: 'device', name: dev.name || '手机', icon: dev.icon || '📱', apps: (dev.apps || ['sms', 'contacts']) });
  for (const t of base) {
    if (t.id === 'phone' || t.id === 'brick' || t.id === 'letter' || t.id === 'talisman') { if (!dev) out.push({ id: t.id, name: t.name, icon: t.icon, apps: t.apps || [] }); continue; }
    out.push({ id: t.id, name: t.name, icon: t.icon, apps: t.apps || [] });
  }
  return out;
}
function buildViewRaw(data) {
  // 场景画（v1.31）：**底版**存在 place.art（随存档持久化，长期骨架），这里只做「底版 + 本回合叠加」。
  // 指纹一致 → 复用上一回合渲染好的成品（省掉逐格重绘）；指纹变了（人动了/货架变了/格局改了/天气时段变了）→ 重渲染。
  const artFn = (id) => viewName(data, id);
  const fp = PRES.layoutFingerprint(data, artFn);
  const sceneKey = data.current.sceneId;
  let sm = (data.current.artCache || {})[sceneKey];
  if (!sm || sm.fp !== fp || !sm.art) {
    sm = PRES.sceneModel(data, artFn);
    sm.fp = fp;
    data.current.artCache = data.current.artCache || {};
    data.current.artCache[sceneKey] = sm;
  }
  const scene = getEntity(data, data.current.sceneId) || { name: '某处', tags: [] };
    /* v1.97 ★ 修 X11：原来把整份 p.state（含 fatigue/hunger/sleep）发给浏览器 —— 前端只读 id/name/mood，
       多发的都是"数据到了不该到的地方"。现在只外发白名单。 */
    const cast = present(data, data.current.sceneId).map(p => ({ id: p.id, name: (p.id === 'player' ? (p.name || '你') : (viewName(data, p.id) || '？')), mood: (p.state || {}).mood || '', dead: (p.state || {}).alive === false }));
  const unread = data.messages.filter(m => m.to === 'player' && m.status === 'unread');
  // ★ 修 X4：消息正文是玩家真会读到的通道 —— 过同一把尺子
  const msgs = data.messages.filter(m => m.to === 'player' || m.from === 'player').slice(-40).reverse()
    .map(m => Object.assign({}, m, { body: scrubForPlayer(data, m.body || '') }));
  const known = data.knowledge;
  const mapNodes = known.knownPlaces.map(id => getEntity(data, id)).filter(Boolean).map(p => ({ id: p.id, name: p.name, geo: p.geo, edges: (p.edges || []).map(e => ({ to: e.to, level: e.level, minutes: e.minutes })), visited: known.visited.includes(p.id), open: p.openHours }));
  // 人物面板 = **"你见过的人"的并集**。原来只列 knownPeople，于是"场上站着 4 个人、面板里只有 1 个"
  // —— 在场的人当然见过，却没进那个名单。stage 门控仍由 personView 负责（没名字的显示为"你还不认识"）。
  /* v2.06 修 P1-1 E7b（**集合级**漏口，任务书称它为"主漏口"）：
     第三项原来直接取 impressions 的全部键 —— 而载入期（server.js 的旧档印象迁移）与每回合开头
     （runTurn 里对每个 person ensureImp）都会为**世界里的每一个人**建一条档。于是这一项
     == 全世界 NPC：玩家从没见过、也没听说过的人，全都会出现在「人物」面板里（显示为"你还不认识…"）。
     这不是某个名字的字符串泄漏，而是"人群集合"级的越权 —— 文本层门控根本管不到。
     现在只收**确实带玩家认知的**那些档：见过（stage≥1）、有印象/笔记/称呼/名字。 */
  const knownImps = Object.keys(data.impressions || {}).filter(id => {
    const im = data.impressions[id] || {};
    return (im.stage || 0) >= 1 || (im.traits || []).length || (im.notes || []).length || !!im.seen || !!im.nameKnown;
  });
  const seenIds = new Set([].concat(
    known.knownPeople || [],
    present(data, data.current.sceneId).map(x => x.id),
    knownImps
  ));
  const people = [...seenIds]
    .filter(id => id && id !== 'player' && getEntity(data, id))
    .map(id => personView(data, getEntity(data, id)))
    .sort((a, b) => (b.stage || 0) - (a.stage || 0));
  const storeItems = Object.values(data.entities).filter(e => e.type === 'item' && e.at === data.current.sceneId && !e.bought).map(e => ({ id: e.id, name: e.name, price: e.price || 0, desc: e.desc, sold: e.bought || 0, stock: e.stock != null ? e.stock : (e.bought ? Math.max(0, e.stock0 - e.bought) : null) }));
  const wallet = data.entities.player.money || { currency: '元', cash: 20, digital: 0, spent: 0, earned: 0 };
  /* v2.06 修 P1-4：原来这里挂着一个 `|| true` 的过滤器 —— 恒为真，等于没过滤，
     而读代码的人会以为"手机/表/钱包/行囊不入随身"。行为与注释不符比二者之一更糟：
     直接删掉过滤器（行为一字不变），要过滤就写真的要过滤的条件。 */
  const inv = (data.entities.player.inventory || []).map(x => ({ id: x.id, name: x.name, value: (x.value != null ? x.value : (x.price || null)) }));
  const news = data.news.filter(n => known.heardNews.includes(n.id)).map(n => ({ id: n.id, title: n.title, summary: n.summary, t: n.t, severity: n.severity }));
  /* v2.05：原来这里还算一份 relation{tone,npcMood} 外发给前端 —— 但 public/ 里
     V.relation 出现 0 次（前端读的是 me.bonds 与 cast[].mood，同一件事的两个来源）。
     没人读的外发字段就是"无效转发"：每回合多序列化一份、还可能悄悄过期。整段删掉。 */
  const scenePlace = getEntity(data, data.current.sceneId) || {};
  const geoChain = (scenePlace.geo || []).slice(-2).join(' · ');
  const region = geoChain || ((data.entities[data.current.sceneId] || {}).name || '此地');
  /* v1.84：势力/组织改成"**你听说过的**"（设计总稿 §261），不再是全量枚举。
     两条来源：① 明确进过 knowledge.knownOrgs 的（当场出现在你眼前的机构）
              ② 你已经认识的人所属的（indexes.org）—— 你认识沈姨，自然知道她那家铺子。
     其余 org 实体只是世界背景，不上桌。 */
  const orgs = (function () {
    const out = [];
    const push = (s) => { const v = String(s || '').trim(); if (v && out.indexOf(v) < 0) out.push(v); };
    for (const oid of (data.knowledge.knownOrgs || [])) { const e = data.entities[oid]; push(e ? e.name : oid); }
    for (const pid of (data.knowledge.knownPeople || [])) {
      const pe = data.entities[pid]; if (!pe) continue;
      if (((data.impressions || {})[pid] || {}).stage >= 2) for (const w of ((pe.indexes || {}).org || [])) push(w);
    }
    for (const e of Object.values(data.entities)) if (e && e.type === 'org' && (e.state || {}).location === data.current.sceneId) push(e.name);
    return out.slice(0, 8);
  })();
  const month = parseInt((data.current.time || '').slice(5, 7), 10) || 5;
  const season = month >= 3 && month <= 5 ? '春末夏初' : (month >= 6 && month <= 8 ? '盛夏' : (month >= 9 && month <= 11 ? '深秋' : '寒冬'));
  const overview = {
    era: data.meta.era || '现代',
    /* v1.97 X8："近况"取的是**没过多长时间就该过去**的新闻（时长字段的消费者）。
       原来这里是 news.slice(0, 5) —— 在追加序的数组上那是**最早**的五条，躺着的是开局的旧闻。
       只外发 UI 要用的三个字段（X11：不过度外发）。 */
    近况: K.newsCurrent(data, data.current.time, 5).map(n => ({ id: n.id, title: n.title, t: n.t })),
    地区: region,
    势力组织: orgs.length ? orgs : [(data.meta.name || '青石镇'), (scenePlace.name || '')],
    要闻人物: known.knownPeople.map(id => viewName(data, id)).filter(Boolean),
    时令: month + '月 · ' + season,
    你的身份: (data.entities.player.profile || {}).identity || {}
  };
  const cfgNow = AI.loadConfig();
  /* v2.05：V.carries（载体）同 relation —— 前端 0 次引用。载体的作用在**服务端**：
     deriveTools(data.meta.carries) 已经把它翻译成 V.tools（前端只认 tools）。不再外发。 */
  const claims = (data.claims || []).map(c => ({ title: c.title || '', when: c.when || '', date: c.date || '' }));
  const temp = (data.current.weather || '').indexOf('雨') >= 0 ? 22 : 27;
  const weatherInfo = { now: data.current.weather || '晴', temp: temp + '°C', trend: [ { t: '今晚', d: data.current.weather || '晴' }, { t: '明天', d: '多云转阴' }, { t: '后天', d: '晴' } ] };
  /* v3.2：通讯录带**联系方式**（kind/label）—— 原来只有 {id,name,mood}，界面上看不出
     "这是手机还是铺子柜台那台电话"，也看不出"这人根本联系不上"。 */
  const contacts = (known.phoneContacts || []).map(id => { const e = getEntity(data, id) || {}; const nm = viewName(data, id) || '陌生号码'; const dead = (e.state || {}).alive === false; const ct = e.contact || null; return { id: e.id, name: dead ? (nm + '（已故）') : nm, mood: dead ? '故人' : ((e.state || {}).mood || ''), kind: ct ? ct.kind : '', label: ct ? ct.label : '' }; });
  return {
    mode: AI.isLive(cfgNow) ? 'live' : 'demo',
    apiModel: (cfgNow.llm && cfgNow.llm.model) || '',
    tools: buildViewTools(data),
    sceneArt: sm.art || null,
    interacts: PRES.sceneModel(data, artFn).interacts,
    artMarks: sm.marks,
    log: journalView(data),
    // v1.89：**还悬着的事** —— 「未了的事」的玩家侧投影（走门控；见 looseEndsView 注释）
    loose: looseEndsView(data),
    plans: (data.plans || []).slice(-5).map(p => ({ dest: p.dest, status: p.status, ticket: !!p.ticket, mode: p.mode || '', reason: p.blockReason || '' })),
    stats: AI.statsView(),
    turnN: data.current.turnN || 1,
    delegates: ((data.current && data.current.delegateStreak) || []).length,
    // v1.83 修 P0-2：sceneId 必须下发 —— 前端 latestSceneImage() 靠它匹配当前场景，缺了它舞台永远是 ASCII 画
    imgTasks: ((data.current && data.current.imgTasks) || []).slice(-8).map(t => ({ id: t.id, who: t.who || [], state: t.state || '', note: t.note || '', status: t.status || 'queued', err: t.err || '', title: (t.ai && t.ai.sceneTitle) || '', at: (t.at != null ? t.at : null), sceneId: t.sceneId || '', turn: (t.turn != null ? t.turn : null), noFace: t.noFace || [], style: t.style || '', mode: t.mode || '', t: t.t || '', auto: !!t.auto, kind: t.kind || '' })),
    /* v1.84：**不再下发 options**。它每回合要求 AI 产出 3~6 条"下一步行动"，
       而前端 `public/*.js` 里 "options" 出现 **0 次**（从来没人渲染）——白烧 token；
       更要紧的是它跟 §14「无任务系统」与 UI 红线「不给建议，给观察」直接冲突。
       解析代码保留（旧档/容错），但不再进视图。
       v2.05：连 `options: null` 这个占位键也删了 —— 0 个读者 + 一个已退役的字段，
       正是 ui-content-check 那张"外发字段必须有落点"的表要拦的东西。 */
    /* v1.97：教程提示（引导，不是世界内容）。只显示**它产生的那个回合** ——
       下一个回合它自动让位（不 nag 玩家），刷新页面也不会丢（它存在存档里）。
       之所以要单独一档：v1.96 之前它随 view.reaction 一起被算出来、又随它一起没人渲染，
       于是"教程"这件事只有消息和候选真的到了玩家眼前，提示一句都没到。 */
    tutor: (((data.current.tutorHint || {}).turn === (data.current.turnN || 0)) ? String((data.current.tutorHint || {}).text || '') : null),
    playerName: (cfgNow.playerName || (data.entities.player || {}).name || '你'),
    me: selfView(data),
    affordances: buildAffordances(data),
    phoneInfo: { contacts: contacts, clock: data.current.time.slice(0, 16).replace('T', ' '), claims, weatherInfo },
    /* v2.05：原来这里外发 meta{era,maxSeverity,importSource} —— 前端 0 次引用，
       而且 maxSeverity/importSource 是**引擎字段**（开发者信息不该搭玩家视图的车）。
       玩家要知道的时代在 V.overview.era 里；引擎/开发者要看的上限与来源在 ?dev 的 devMeta 里。 */
    time: RT.perceiveTime(data, data.current.time),
    weather: RT.perceiveWeather(data, data.current.time),
    weatherFx: (function () {
      const wx = RT.perceiveWeather(data, data.current.time);
      return wx.seen ? PRES.weatherFx(data.current.weather || '晴', false) : null;
    })(),
    weatherCue: (function () {
      const wx = RT.perceiveWeather(data, data.current.time);
      return (wx.heard && !wx.seen && wx.cue) ? wx.cue : null;
    })(),
    place: { id: scene.id, name: scene.name, tags: scene.tags, features: scene.features },
    cast, unread: unread.length,
    /* ★ v3.12 · 这一局「长什么样」：AI 造的板块（含已逐条门控的行）。
       空数组 = 还没有板块（不是错误）—— 界面就不显示入口。 */
    panels: (function () { try { return CREATE.panelView(data); } catch (e) { DEG.hit('game.js:panels', e); return []; } })(),
    /* v3.0：镜头（AI 定主次）。空数组 = 这一刻没有主次，界面不许自己挑一个。 */
    focus: ((data.current && data.current.focus) || []).slice(0, 3),
    /* v3.3：玩家的念头（已经逐条门控过 —— 见 runTurn 里 data.current.suggestions 那一段） */
    suggestions: ((data.current && data.current.suggestions) || []).slice(0, CONTRACT.SUGGEST_MAX),
    msgs, map: mapNodes, people, shop: storeItems, inventory: inv, news, overview,
    money: { currency: wallet.currency || '元', cash: wallet.cash || 0, digital: wallet.digital || 0, spent: wallet.spent || 0, earned: wallet.earned || 0 },
    /* ★ v3.20：账目（欠着谁 / 谁欠你）。名字走**同一把门控尺子**（viewName）——
       账目本身是"你知道的事"，不该门控；但"对方叫什么"仍然只有认识了才知道。 */
    accounts: (function () {
      try {
        return ACC.view(data).map(a => {
          /* 与 resolveSpeaker 同一把尺子：知道了给名字，不知道的给"看得见的样子" */
          const nm = a.who ? (GATE.nameOf(data, a.who) || (a.name ? (GATE.scrubText(data, a.name) || '') : '')) : (a.name || '');
          return { id: a.id, dir: a.dir, who: a.who, name: nm, amount: a.amount, currency: a.currency, what: a.what, due: a.due, status: a.status };
        });
      } catch (e) { DEG.hit('game.js:accounts', e); return []; }
    })(),
    sceneLog: (function () {
      // 生图定位：本回合 beats（_imgBeatSpan）里的条目，at 对应序号 → 挂 imgs（图卡随叙事流显示）
      const span = data.current && data.current._imgBeatSpan;
      const imgByAt = {};
      for (const t of ((data.current && data.current.imgTasks) || [])) {
        /* v1.83 修 P1-6：原来只按 t.at 归组、**不看属于哪一回合**，于是上一回合 at=1 的图
           会挂到本回合 at=1 的条目上（实测：一条 beat 同时挂上 img_old + img_new）。
           现在优先用派发时钉死的绝对下标 absAt；老任务（无 absAt）只认"时间戳与本回合 span 相同"的那些。 */
        let a2 = null;
        if (t.absAt != null) a2 = Number(t.absAt);
        else if (t.at != null && span && t.t && span.t && String(t.t) === String(span.t)) a2 = span.start + Number(t.at);
        if (a2 == null) continue;
        (imgByAt[a2] = imgByAt[a2] || []).push(t.id);
      }
      const outArr = [];
      const all = data.sceneLog || [];
      const base = Math.max(0, all.length - 30);   // v1.65b：窗口的**绝对**起点
      const src = all.slice(base);
      for (let i = 0; i < src.length; i++) {
        const l = src[i];
        /* v1.65b 修一个真 bug：span.start 是 sceneLog 的**绝对**下标，而 i 是 slice(-30) 之后的**相对**下标——
           原来直接拿 i 去比 span.start，sceneLog 一超过 30 条（实测 82 条）就永远不成立 → 图一张都挂不上正文。
           现在换成绝对下标；另外优先用**落库时盖在条目上的 imgs**（l.imgs），这样过了几回合图也不会掉。 */
        const abs = base + i;
        const imgs = (span && abs >= span.start && abs < span.start + span.count) ? (imgByAt[abs] || null) : (l.imgs || null);
        /* v1.97：**谁做的**（actor）和**谁说的**（speaker）是同一件事的两种写法，
           两者存货里存的都是 id —— 那就都用同一把尺子解析成称呼。
           原来只解析 speaker：actor 一路裸着到前端，前端 spSafe('npc_2') 认出它是 id ⇒ 印一个"？"——
           于是"阿岩朝这边看了一眼"在屏幕上变成"？ （阿岩朝这边看了一眼）"。
           实测于 v1.97 的 GUI 验收（demo 第一回合，actor=npc_2）。 */
        const whoName = (v) => {
          if (!v) return null;
          const ent = getEntity(data, v) || Object.values(data.entities).find(x => x.type === 'person' && x.name === v);
          if (ent && ent.type === 'person') return ent.id === 'player' ? '你' : (viewName(data, ent.id) || '？');
          /* ★ v3.3：查不到**人**的时候，原来这里走 resolveSpeaker 的兜底 —— 而它最后一行
             就是 `return String(sid)`，原样放行。后果实测（.probe-leak.js）：
             speaker:'张三丰'（世界里根本没有这个人）一路裸奔进玩家视图。
             **一个字段就能把知识门控和「有主」一起绕过去** —— AI 想在屏幕上印谁的名字，
             塞进 speaker 就行，不需要任何 Update、不需要锚、不需要人物出现。
             现在只有两种出口：世界里的**人** -> 过名字门（viewName）；
             世界里的**非人物实体**（组织/店铺）-> 照旧显示它的名字；
             其余（世界里查不到的字符串）-> '？'（保留"有人在说话"，不保留那个名字）。
             真实存档统计（4 个世界 / 31 条 speaker+actor）：100% 都能解析成人物实体，
             所以这条收紧不改动任何现有存档的显示。 */
          const other = getEntity(data, v) || Object.values(data.entities).find(x => x && x.name === v);
          if (other) return String(other.name || '');
          /* ★ v3.5 修（用户实测截图：**每一块她的台词头顶都挂着一个 `?`**）。
             原来这里返回 '？'，本意是"保留有人在说话、不保留那个名字"。
             但屏幕上一个孤零零的 `?` 读起来不是"名字被门控了"，而是"**这里坏了**"。
             而且这条注释赖以成立的假设已经破了：它写着"真实存档统计 100% 都能解析成人物实体"，
             而实测的一局里 8 条 speaker 有 6 条解析不了（AI 写了 `npc_sasha` /
             `一个陌生人（你叫不出名字）`——后者是它**把资料包里的显示名当 id 抄回来了**）。
             所以：解析不到就返回空串，让渲染端**干脆不画那一行**（正文还在，"有人在说话"没丢）。
             根因在别处（见 playFrame 里存 speaker 那一段），这里只管别把问号印到玩家脸上。 */
          return '';
        };
        let item = l;
        const sp = l.speaker, ac = l.actor;
        if (sp || ac) {
          item = Object.assign({}, l);
          if (sp) { const nm = whoName(sp); item.speaker = nm; item.speakerName = nm; }
          if (ac) { const an = whoName(ac); item.actor = an; item.actorName = an; }
        }
        if (imgs) item = Object.assign({}, item, { imgs: imgs });
        outArr.push(item);
      }
      return outArr;
    })(),
    archives: data.archives || {},
    // v1.51：这个世界自己长出来的东西（设置面板/诊断用；**不上玩家主界面**）
    framework: (function () { try { return FW.vocabView(data); } catch (e) { return null; } })(),
    manifest: (function () { try { const v = MF.view(data); return v ? { n: v.n, counts: v.counts, pending: v.pending } : null; } catch (e) { return null; } })(),
    // v1.46 文书（门控：只给玩家见过的）。brief 用于列表；正文在 openDoc / /api/doc/read 里给
    // ★ 修 X4：列表摘要也是玩家会读到的文本 —— 过同一把尺子
    docs: knownDocs(data).slice(-30).reverse().map(d => ({ id: d.id, title: scrubForPlayer(data, d.title), from: scrubForPlayer(data, d.from || ''), t: d.t || '', read: !!d.read, kind: d.kind || 'doc', brief: scrubForPlayer(data, String(d.body || '').replace(/\s+/g, ' ').slice(0, 60)) })),
    openDoc: (function () {
      const o = data.current && data.current.openDoc;
      const d = o && (data.documents || {})[o.id];
      return d ? { doc: docPublic(d, data), seq: o.seq || 0 } : null;
    })(),
    // 本回合的演出（AI 点名或代码点名）：前端按 seq 只播一次，重绘/刷新不重播
    fx: (function () {
      // v1.47：给前端的不是"效果名"，而是**原语 + 参数** —— 前端按原语画，世界内的名字只用来提示
      const q = data.current && data.current.fx;
      if (!q || !q.atoms || !q.atoms.length) return null;
      return { atoms: q.atoms, fxKey: q.key || '', fxName: q.name || '', why: q.why || '', seq: q.seq || 0, turn: data.current.turnN || 1 };
    })(),
    // A5：这里原来是 lastLedger（客观事件流）——那是导演台本，含玩家不在场的事，且 type 是数据库字段名。
    // 玩家界面只呈现"玩家认知视图"；客观账本改由 /api/diag 供诊断用（AI 侧 subai 仍读 data.ledger，不受影响）。
    myLog: myLogView(data),
    // v1.54 认知轨：**只含玩家亲历**（原文 + 按世界日摘要 + 索引），天生不剧透
    experience: (function () { try { return REC.view(data, { days: 7 }); } catch (e) { return null; } })()
  };
}
// 「你记得的」：只含玩家亲历的事（ledger.target === 'player'），且把人话写出来——不出现 ledger.type 字段名。
const MYLOG_VERB = {
  '物品获取': '你拿到了', '物品消耗': '你用掉了', '物品转移': '你经手了',
  '文档出现': '你收到了', '文档阅读': '',
  '地点变化': '你到了', '事件开始': '你经历了', '事件结束': '这件事结束了',
  '信息到达': '你收到了', '交易拒绝': '这笔没谈成', '关系变化': '', '记忆新增': ''
};
/* ── v1.86：视图分两路（"默认隐藏"而不是"默认暴露"）────────────────────────────
   病：buildView 一份 JSON 同时服务世界呈现 / 设置面板 / 诊断 —— 任何新增字段**默认就对前端可见**，
       门控只能靠"新增前记得问一句"这条纪律（A5「世界账本」剧透就是这么漏出去的，当时的修法只是挪走 ledger）。
   治：世界视图只放世界/感知/认知/行动要用的东西；**开发者字段（框架/生成清单/AI 计量/来源卡）走 /api/dev**。
   catworld-ui 越权红线 4：「开发者信息不上桌，只在 ?dev 时显示」。 */
/* v3.12：世界模板创造（板块）—— 它只在 buildView 与 runTurn 两处被用到。 */
const CREATE = require('./creator');

const DEV_KEYS = ['framework', 'manifest', 'stats', 'devMeta'];
function buildView(data) {
  const v = buildViewRaw(data);
  for (const k of DEV_KEYS) { try { delete v[k]; } catch (e) { DEG.hit('game.js', e); } }
  return v;
}
function buildDevView(data) {
  const v = {};
  try { v.framework = FW.vocabView(data); } catch (e) { DEG.hit('game.js', e); v.framework = null; }
  try { v.manifest = MF.view(data); } catch (e) { DEG.hit('game.js', e); v.manifest = null; }
  try { v.stats = AI.statsView(); } catch (e) { DEG.hit('game.js', e); v.stats = null; }
  try {
    v.devMeta = {
      importSource: (data.meta && data.meta.importSource) || null,
      schema: (data.meta && data.meta.schema) || 0,
      rules: ((data.meta && data.meta.rules) || []).slice(0, 3),
      worldinfoN: Object.keys(data.worldinfo || {}).length,
      /* v2.07 · **观察值，不是配额**：书架多少条、多少字、丢了几条、为什么丢。
         用户定的原则：不设硬限制，让 AI 判断；把量摆出来给人看就够了。 */
      worldbook: (function () {
        const wi = data.worldinfo || {};
        const ks = Object.keys(wi);
        let chars = 0, translated = 0;
        for (const k of ks) { chars += String((wi[k] || {}).content || '').length; if (String((wi[k] || {}).route) === '翻译') translated++; }
        const dr = (data.meta && Array.isArray(data.meta.worldbookDropped)) ? data.meta.worldbookDropped : [];
        return { kept: ks.length, chars: chars, translated: translated, dropped: dr.length, why: dr.slice(0, 6) };
      })(),
      /* 开局编译这一趟做了什么（怎么走的、补了几条、AI 自己怎么说） */
      opening: {
        at: (data.meta && data.meta.openingAt) || null,
        how: (data.meta && data.meta.openingHow) || null,
        note: (data.meta && data.meta.openingNote) || null,
        selfcheck: (data.current && data.current.openingSelfcheck) || null
      },
      // 静默降级的计数（引擎侧）：哪些模块在偷偷吞异常
      degraded: (function () { try { return require('./degraded').view(); } catch (e) { return null; } })(),
      /* v1.98 · P0-4：校验器闭环的现状（本回合被拒几条、有没有走修正轮）。
         0 token、只在开发者视图里 —— 玩家侧看不到"校验"这件事（越权红线）。 */
      validator: (data && data.current && data.current.lastValidate) || null,
      // v1.99 P0-5 第 2 步：事件门的现状（上一次 L3+ 是哪天、拦掉了多少条、最近拦了什么）
      gate: (function () { try { return require('./gate').gateView(data); } catch (e) { return null; } })(),
      retention: (function () { try { return require('./retention').view(data); } catch (e) { return null; } })()
    };
  } catch (e) { DEG.hit('game.js', e); v.devMeta = null; }
  return v;
}
/* v1.89：**还悬着的事** —— 「未了的事」的**玩家侧投影**（审视 §8.1 的核心）。
   AI 的资料包早就有「未了的事」（从账本确定性推导：事件开始没有对应的结束 = 一条悬着的线；v1.93 起推导收进 threads.js），
   而玩家侧**一个字都没有** —— 于是 AI 每回合在接着写一件悬着的事，玩家站在一间已经收拾干净的房间里找事做。
   这不是门控写错了（账本直接喂玩家就是剧透），是那个推导**只做了一次投影**。
   现在做第二次，走同一把尺子：
     · secret 事件不给（你不知道）；
     · 只给玩家去过的地方（knowledge.visited）发生的事；
     · 文案用事件自己的名字与因果，**不出现任何引擎词汇**（无「事件」「任务」「状态」）。
   注意：这不是任务系统 —— 它不判定成功/失败，只陈述「有这么件没了结的事」。 */
/* v1.93：折叠与门控都搬进了 threads.js（唯一推导点）—— 这里只剩「玩家这个受众」这一个参数。
   原来折叠逻辑在三处各写一遍（ai.js 的未了的事 / 这里的 looseEndsView / storyteller.js 的 threads），
   改一处不会同步另两处；而它们的差别（谁能看见、看几条）本来就该是参数，不是三份拷贝。 */
function looseEndsView(data) {
  try { return TH.list(data, 'player'); } catch (e) { DEG.hit('game.js', e); return []; }
}

function myLogView(data) {
  const out = [];
  for (const l of (data.ledger || [])) {
    if (!l || l.target !== 'player') continue;
    const v = MYLOG_VERB[l.type];
    if (v === undefined) continue;                 // 不在白名单的类型（含所有客观类型）一律不出现
    const desc = String(l.desc || '').slice(0, 60);
    const text = v ? (v + (desc ? '：' + desc : '')) : desc;
    if (!text) continue;
    out.push({ t: l.t, text: text });
  }
  return out.slice(-8);
}

// 我的概况：玩家对自己的认知（20.3）——自己知道的一切，不门控
// 占位废话清洗："按设定来"这类历史垃圾值/模板默认 → 空（宁缺勿滥）
function cleanV(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (/按设定来|^待定$|待补充|待接触|未知，先接触|^（未知）$|^未知$/.test(s)) return '';
  if (/^一位来到此地落脚的访客|^一位来到此处落脚的旅客|随和，心里有主意|先安顿下来/.test(s)) return '';
  return s;
}
function selfView(data) {
  const p = data.entities.player || {};
  const prof = p.profile || {};
  const idn = prof.identity || {};
  const myAge = RT.ageOf(data, p, data.current.time); // 年龄随世界年份实时增长
  const app = prof.appearance || {};
  const sur = prof.surface || {};
  const bg = prof.background || {};
  const sec = prof.secrets || {};
  const cfgN = AI.loadConfig();
  /* v2.04：不再透传 weight —— 前端从来没用过它（"权重"是引擎内部量，不该上桌）。 */
  const selfMem = RT.funnelMemories(data, 'player', [], 6).map(m => ({ id: m.id, content: m.content, tags: m.tags, t: m.t }));
  const claims = (data.claims || []).slice(-8).map(c => ({ title: c.title || '', when: c.when || '', date: c.date || '' }));
  const bonds = Object.keys(data.relations.player || {}).map(id => {
    const nm = viewName(data, id); if (!nm) return null;
    return { id, name: nm, tone: ((data.relations.player || {})[id] || {}).tone || '普通' };
  }).filter(Boolean).slice(0, 8);
  return {
    name: cfgN.playerName || p.name || '你',
    identity: { 姓名: idn.姓名 || p.name || '你', 年龄: cleanV(myAge != null ? String(myAge) + ' 岁' : idn.年龄), 身份: cleanV(idn.身份), 职业: cleanV(idn.职业) },
    appearance: cleanV(app.标志物 || ''),
    surface: cleanV(sur.待人 || ''), ability: cleanV(sur.能力 || ''),
    backstory: cleanV(bg.经历 || ''),
    secrets: cleanV(sec.包袱 || ''),
    state: p.state || {},
    inventory: (p.inventory || []).map(x => x.name || x.id || ''),
    money: p.money ? { currency: p.money.currency || '元', cash: p.money.cash || 0, digital: p.money.digital || 0 } : null,
    memories: selfMem,
    claims, bonds,
    selfSetup: (data.meta && data.meta.self) || null,
    worldEra: (data.meta && data.meta.era) || '',
    worldName: (data.meta && data.meta.name) || ''
  };
}

const STAGES = ['未见过', '只见过', '知道名字', '打过交道', '熟人'];
// 「TA 长什么样」——**把长相用语言说出来**（文字立绘）。
// 这一栏是给**所有玩家**的：生图引擎是"想看真容"的加分项，不是前提。
//
// 引擎侧的外貌数据分两种形态，处理方式完全不同：
//   · profile.visual.nine / anchor —— 九维档案（含几何量化 "眼宽:眼高≈3:1"）
//     → **不原样外露，但也不雪藏：翻译成人话**（"眼睛细长"）
//   · imp.look —— AI 一次写好的"长相散文"（按需生成、长期复用）
//     → 最优先，因为它本来就是人话
// stage 决定你看得见几句：越熟，长相越具体。
function plainLook(s) {
  return String(s || '')
    .replace(/[（(][^）)]*[)）]/g, '')                                  // 括号里的量化说明
    .replace(/[≈~]?\s*\d+(\.\d+)?(\s*[:：]\s*\d+(\.\d+)?)+/g, '')   // 3:1 / 1:1:1 整条数字比例
    .replace(/[\u4e00-\u9fa5A-Za-z]{1,4}[:：][\u4e00-\u9fa5A-Za-z]{1,4}(?=[，,。；;、]|$)/g, '') // "眼宽:眼高" 这类标签对
    .replace(/\d+\s*(cm|CM|厘米|毫米|mm|kg|公斤|斤)/g, '')             // 绝对长度/重量
    .replace(/(约|大约|大概|近|左右)\s*(?=[，,。；;、]|$)/g, '')          // 数值被剥后剩下的"约"
    .replace(/(身高|体重|肩宽|腰围|胸围|头身比|臂展|三庭|五眼|眼宽|眼高|瞳距)\s*(?=[，,。；;、]|$)/g, '')   // 数值被剥后剩下的空标签
    .replace(/[；;]/g, '，').replace(/\s+/g, '')
    .replace(/，{2,}/g, '，').replace(/^[，、]|[，、]$/g, '')
    .trim();
}
// 九维 → 人话（0 token 兜底）。顺序按"人描述一个人时先说什么"排：年龄感 → 脸 → 身材 → 头发 → 衣着
const LOOK_DIMS = ['脸型与年龄感', '眉眼与瞳孔', '鼻子与嘴唇', '肤色与肤质', '体型身材', '发型与发色', '衣着与配饰', '永久标记'];

// 「TA 长什么样」的按需生成（副 AI，一次写完长期复用）：
//   · 不预生成 —— 玩家不看这个人，就一分钱不花
//   · 不重复生成 —— 写完存进印象层 imp.look，之后 lookOf() 第一优先级直接命中
// 它要产出的是**人读的长相印象**（含一点主观判断），不是给生图引擎的提示词。
// 一次生成，两处产出（同一份长相认知的两种投影）：
//   · nine → profile.visual.nine  —— 引擎侧的**刚性锚点**（生图一致性靠它）
//   · look → impressions[id].look —— 玩家侧的**长相印象**（人话，文字立绘）
// 运行时冒出来的新人物只有"标志物"、没有九维；而 scheduler 的原则是"无锚点人物绝不写人貌"，
// 于是他们永远只画场景、不画人。这里补上那个缺口。
// 仍然是：不预生成（不看的就不花）· 不重复生成（写完存下来，之后 0 token）。
const PROFILE_SYS = [
  '你在为一个人物补**长相档案**。产出两份，用途不同，写法也不同。',
  '',
  '【nine】给生图引擎的**刚性锚点**（结构化、可画、可校验）：',
  '  八个维度固定：脸型与年龄感 / 眉眼与瞳孔 / 鼻子与嘴唇 / 肤色与肤质 / 体型身材 / 发型与发色 / 衣着与配饰 / 永久标记',
  '  每维写具体可画的特征；比例用相对写法（"三庭≈1:1:1"）；身高/肩宽这类可给数值',
  '  **禁止文学形容词**（"灵动""水汪汪"这种模型会瞎画）；没把握的维度宁可留空，别编',
  '',
  '【look】给玩家读的**长相印象**（人话）：',
  '  3 句，一句一层：① 大体（年龄感+脸型+第一眼气质）② 最抓眼的 1-2 处细节 ③ 身材衣着 + 一点主观判断（面善／不好惹／体面／邋遢）',
  '  **把 nine 翻译成人话**，禁止原样搬运量化；禁罗列式清单；禁写人物姓名；像熟人随口描述，节制可信',
  '',
  '【已有九维】为空 → 先按素材把 nine 建出来，再据它写 look。',
  '【已有九维】非空 → nine 保留原有内容（只补空缺维度），look 直接照它翻译。',
  '输出 JSON：{"nine":{"脸型与年龄感":"","眉眼与瞳孔":"","鼻子与嘴唇":"","肤色与肤质":"","体型身材":"","发型与发色":"","衣着与配饰":"","永久标记":""},"look":"第一句。第二句。第三句。"}'
].join('\n');
const NINE_DIMS_ = ['脸型与年龄感', '眉眼与瞳孔', '鼻子与嘴唇', '肤色与肤质', '体型身材', '发型与发色', '衣着与配饰', '永久标记'];
/* v1.62 引擎兜底画面笔记（配图偏好 always 用）。
   取"当前场景 + 你见过的人"里**档案最全**的那位；state 只写**看得见**的字段（心情）。
   实测反例（必须避免）：AI 把「确认嫡子的储位是否真的稳如泰山」这种隐藏目的写进了画面笔记 →
   它会被当外貌/状态塞进生图提示词（泄漏 + 画不出来）。引擎自己补的这条不会有这个问题。 */
function autoImgNote(data, out) {
  const beats = ((out && out.frame && out.frame.beats) || []).length;
  const seen = (data.knowledge && data.knowledge.knownPeople) || [];
  const here = Object.keys(data.entities || {})
    .map(function (id) { return data.entities[id]; })
    .filter(function (e) { return e && e.type === 'person' && e.state && e.state.location === data.current.sceneId && seen.indexOf(e.id) >= 0; })
    .sort(function (a, b) { return nineFilled(b) - nineFilled(a); });
  const p = here[0] || null;
  const mood = p ? String((p.state && p.state.mood) || '平静') : '';
  return { who: p ? [p.id] : [], at: beats > 0 ? beats - 1 : null, state: mood ? ('此刻：' + mood) : '', scene: '', note: '', auto: true };
}
function nineFilled(p) {
  const nine = (((p.profile || {}).visual || {}).nine) || {};
  return NINE_DIMS_.filter(k => String(nine[k] || '').trim()).length;
}
// 建档前查重：同一个人的**另一个实体**若已有档案 → 直接复用，**绝不给一个人造两套档案**。
// （重复实体由 mergeDupPersons 定期合并，但在合并发生之前，这里必须先挡住；
//   否则两次独立生成会得到两份不一样的九维 —— 同一个人画出来是两张脸。）
function twinProfile(data, p) {
  const app = (((p.profile || {}).appearance || {}).标志物) || '';
  const name = p.name || '';
  if (!app && !name) return null;
  for (const e of Object.values(data.entities || {})) {
    if (!e || e.id === p.id || e.type !== 'person' || e.id === 'player') continue;
    /* v1.98 · P0-3：判据收敛到 looksLikeSamePerson（原来这里第三次硬编码占位串 '（你还没看清）'）。 */
    if (!looksLikeSamePerson(p, e)) continue;
    const hasNine = nineFilled(e) >= 4;
    const hasLook = !!String(((data.impressions || {})[e.id] || {}).look || '').trim();
    if (hasNine || hasLook) return e;
  }
  return null;
}
// 把已有档案抄过来（只补空缺，不覆盖）
function adoptArchive(data, p, twin) {
  const vis = (p.profile.visual = p.profile.visual || {});
  const tn = (((twin.profile || {}).visual || {}).nine) || {};
  vis.nine = vis.nine || {};
  for (const k of NINE_DIMS_) if (!String(vis.nine[k] || '').trim() && tn[k]) vis.nine[k] = String(tn[k]).slice(0, 120);
  if (!vis.anchor) { const ta = String((((twin.profile || {}).visual || {}).anchor) || ''); if (ta) vis.anchor = ta.slice(0, 600); }
  if (!vis.dynamic) { const td = (((twin.profile || {}).visual || {}).dynamic) || null; if (td) vis.dynamic = Object.assign({}, td); }
  if (!vis.dynamic) vis.dynamic = {};
  const tl = String(((data.impressions || {})[twin.id] || {}).look || '').trim();
  if (tl) { const imp = ensureImp(data, p.id); if (!String(imp.look || '').trim()) imp.look = tl; }
}
async function genProfile(data, id, cfg) {
  const p = getEntity(data, id);
  if (!p || p.type !== 'person' || id === 'player') return { look: '', nineBuilt: false };
  const imp = ensureImp(data, id);
  const stage = Math.min(4, Math.max(0, imp.stage || 1));
  if (stage < 2) return { look: '', nineBuilt: false };        // 还没记住脸，不该有长相
  const hasLook = !!String(imp.look || '').trim();
  const filled = nineFilled(p);
  if (hasLook && filled >= 4) return { look: imp.look, nineBuilt: false };  // 两样都有 → 0 token
  // 查重：同一个人的另一个实体已有档案 → 抄过来，别造第二套
  if (filled < 4 || !hasLook) {
    const twin = twinProfile(data, p);
    if (twin) {
      adoptArchive(data, p, twin);
      // 九维抄够了就算建成（立绘可以之后单独补）—— 关键是**不新建第二套**
      if (nineFilled(p) >= 4) return { look: String(imp.look || '').trim(), nineBuilt: true, reused: true };
    }
  }
  if (!AI.isLive(cfg)) return { look: imp.look || '', nineBuilt: false };    // 演示模式：0 token 兜底
  const nine0 = (((p.profile || {}).visual || {}).nine) || {};
  const inp = {
    身份: (((p.profile || {}).identity || {}).身份) || '',
    已有的九维: nine0,
    标志物: ((p.profile || {}).appearance || {}).标志物 || '',
    随身: ((p.profile || {}).appearance || {}).随身 || '',
    玩家对TA的印象: (imp.traits || []).slice(0, 3),
    关系: (((data.relations || {}).player || {})[id] || {}).tone || '初识'
  };
  let built = false;
  try {
    const out = await AI.llmJSON(cfg, [{ role: 'system', content: AI.withCharter(PROFILE_SYS) }, { role: 'user', content: JSON.stringify(inp) }], {}, AI.cfgMax(cfg), null, 'none');
    const n9 = (out && out.nine) || null;
    if (n9 && typeof n9 === 'object') {
      const vis = (p.profile.visual = p.profile.visual || {});
      vis.nine = vis.nine || {};
      for (const k of NINE_DIMS_) {
        const v = String(n9[k] || '').trim();
        if (v && !String(vis.nine[k] || '').trim()) vis.nine[k] = v.slice(0, 120);   // 只补空缺，不覆盖既有
      }
      // 锚点兜底：九维齐全了就拼一个 anchor（老字段兼容）
      if (!vis.anchor) vis.anchor = NINE_DIMS_.map(k => vis.nine[k]).filter(Boolean).join('，').slice(0, 600);
      built = true;
    }
    const look = String((out && out.look) || '').trim();
    if (look) imp.look = look.slice(0, 260);
  } catch (e) { DEG.hit("game.js", e); }
  return { look: imp.look || '', nineBuilt: built };
}
// 兼容旧调用名（前端"文字立绘"走的是同一个入口）
async function genLook(data, id, cfg) { const r = await genProfile(data, id, cfg); return r.look; }
function lookOf(p, imp, stage) {
  if (stage <= 1) return '';                                    // 只见过一眼：还没记住脸
  // ① AI 写好的长相散文（按需生成、长期复用）：按句给，stage 决定给几句
  const prose = String((imp && imp.look) || '').trim();
  if (prose) {
    const sents = prose.split(/[。！？\n]/).map(s => s.trim()).filter(Boolean);
    const n = stage === 2 ? 1 : (stage === 3 ? 2 : sents.length);
    return sents.slice(0, n).join('。') + '。';
  }
  // ② 印象层已有的"人话印象"（世界生成时就写好的，本来就是给玩家读的）——直接用
  const seen = plainLook((imp && imp.seen) || '');
  if (seen && !/^一个陌生面孔$/.test(seen)) {
    const parts = seen.split(/[，,]/).map(s => s.trim()).filter(Boolean);
    const n = stage === 2 ? Math.max(1, Math.ceil(parts.length / 3))
            : (stage === 3 ? Math.max(2, Math.ceil(parts.length * 2 / 3)) : parts.length);
    const t = parts.slice(0, n).join('，');
    return /[。！？]$/.test(t) ? t : t + '。';
  }
  // ② 九维兜底：去量化后按维度拼人话
  const nine = (((p.profile || {}).visual || {}).nine) || {};
  const bits = [];
  for (const k of LOOK_DIMS) {
    const t = plainLook(nine[k]);
    if (t) bits.push(t);
  }
  if (bits.length) {
    const n = stage === 2 ? 2 : (stage === 3 ? 4 : bits.length);
    return bits.slice(0, n).join('。') + '。';
  }
  // ③ 只有标志物（行为特征，不是长相）：老实说清这是印象不是长相
  const mark = plainLook(((p.profile || {}).appearance || {}).标志物);
  return mark ? ('你记不太清 TA 的脸，只记得：' + mark + '。') : '';
}
function personView(data, p) {
  const imp = ensureImp(data, p.id);
  const rel = (data.relations.player || {})[p.id] || {};
  const stage = Math.min(4, Math.max(0, imp.stage || 1));
  const name = GATE.nameOf(data, p.id);   // v1.84：同一把尺子（原来这里既不查 nameKnown 也不拦 id 形态）
  return {
    id: p.id, name: name || '？',
    stage: stage, stageLabel: STAGES[stage],
    seen: imp.seen || (stage >= 3 ? ((p.profile || {}).appearance || {}).标志物 || '' : ''),
    // TA 长什么样：用语言说出来的长相印象，stage 决定看得见几句
    look: lookOf(p, imp, stage),
    // 是否已有"AI 写好的"长相（false = 现在显示的是 0 token 兜底，前端可按需请求升级）
    lookReady: !!String((imp && imp.look) || '').trim(),
    traits: imp.traits.slice(0, 6),
    notes: imp.notes.slice(0, 3),
    bonds: (imp.bonds.length ? imp.bonds : [rel.tone && /陌生|初识/.test(rel.tone) ? '初识' : (rel.tone || '初识')]),
    secret: '（不知道）',
    mood: (p.state || {}).mood || '',
    /* v1.97 ★ 修 X11：删掉 location —— 前端**一处都没用**，而它是"每个 NPC 此刻在世界的客观位置"，
       属于玩家不该直接拿到的数据（要用也得走门控/传闻）。 */
    known: !!name,
    dead: (p.state || {}).alive === false,
    deceasedAt: (p.state || {}).deceasedAt || null
  };
}

function buildAffordances(data) {
  const out = [];
  const scene = getEntity(data, data.current.sceneId);
  const tags = scene ? (scene.tags || []) : [];
  const presentNpc = Object.values(data.entities).find(e => e.type === 'person' && e.id !== 'player' && e.state.location === data.current.sceneId);
  const rel = presentNpc ? ((data.relations.player || {})[presentNpc.id] || {}) : null;
  const imp = presentNpc ? ensureImp(data, presentNpc.id) : null;
  const known = presentNpc ? GATE.nameOf(data, presentNpc.id) : null;   // v1.84：同一把尺子
  const how = known ? known : '她';
  /* v1.84：customActions（世界里注册的自定义动作）原来只有 parseIntent 一条路 ——
     玩家得**恰好打出那句话**才会触发，界面上没有任何东西提示它存在（"解析有了、发现没有"）。
     它们排在最前：世界自己长出来的东西优先于引擎的通用建议。 */
  for (const aid of Object.keys(data.customActions || {})) {
    const a = data.customActions[aid] || {};
    const ph = String((a.trigger_patterns || [])[0] || a.name || '').slice(0, 20);
    if (ph) out.push({ label: ph, action: ph });
  }
  /* v2.06 修 P1-1 E1：这一行原来直读 presentNpc.name —— 同一段里 1988/1998 两行都写着
     "known || 兜底"，只有它漏了。后果不是"显示难看"：这条 action 是**可点按钮的提交内容**，
     玩家点一下就等于替玩家把真名打出去，还会作为输入回灌 AI。 */
  if (presentNpc && rel && /紧张|僵|争吵|口角|梁子|闹/.test(rel.tone || '')) out.push({ label: '为之前的事道个歉', action: '我要给' + (known || '门口那个人') + '道歉' });
  if (presentNpc) out.push({ label: '和' + (known || '门口那个人') + '搭话', action: '你好，' + (known || '请问怎么称呼？') });
  const carryPhone = (data.meta.carries || {}).time === 'phone';
  if (carryPhone && presentNpc && imp && imp.stage >= 3) out.push({ label: '给' + known + '发条消息', action: '发消息：在吗？' });
  if (tags.join(',').indexOf('室内') >= 0) out.push({ label: '打量四周', action: '我打量一下四周' });
  for (const e of (scene ? scene.edges || [] : [])) {
    const d = getEntity(data, e.to);
    if (d) out.push({ label: '去' + d.name + '（步行' + e.minutes + '分）', action: '去' + d.name });
  }
  return out.slice(0, 6);
}


function advanceTutorial(data) {
  const t = data.tutorial;
  if (!t || !t.steps || t.steps.length === 0) return null;
  const st = t.steps.find(s => s.at === t.step + 1);
  if (!st) return null;
  t.step += 1;
  if (st.claim) { data.claims = data.claims || []; data.claims.push(st.claim); }
  if (st.msg) {
    const m = Object.assign({ id: data.id('msg'), status: 'unread', via: 'phone' }, st.msg, { t: RT.addMinutes(data.current.time, 1) });
    data.messages.push(m);
    return st.hint || '（新消息）';
  }
  if (st.cand) {
    /* v2.03：教程给的候选也走总线（口径统一）—— 落库只有这一条路，别再在别处 push。 */
    BUS.commit(data, [{ kind: 'candidate', source: 'candidate', level: 'L1', item: { text: st.cand, type: '剧情', t: data.current.time, expireM: 120 } }], { t: data.current.time });
    return st.hint || null;
  }
  return null;
}

// ---------- 身世日志 · 回想机制（玩家=角色扮演最重要的一环） ----------
// journal.known=开局全明（"我是谁"绝不黑幕）；journal.shadows=隐约记得。触发两路：
//   ① 关键词（剧情/对话提到）  ② 看见本人（targets 人物在场）——看到沈姨就该想起她
function recallCheck(data, texts, presentIds) {
  const j = data.journal;
  if (!j || !Array.isArray(j.shadows)) return [];
  const hay = (texts || []).filter(Boolean).join(' ');
  const present = (presentIds || []).filter(Boolean);
  const out = [];
  for (const s of j.shadows) {
    if (s.t) continue;
    const hitByText = Array.isArray(s.triggers) && s.triggers.length && s.triggers.some(k => k && hay.indexOf(k) >= 0);
    const hitBySight = Array.isArray(s.targets) && s.targets.length && s.targets.some(id => present.indexOf(id) >= 0);
    if (!hitByText && !hitBySight) continue;
    if (out.length >= 1) break; // 每回合最多想起一件：最扎心的先涌上来
    s.t = data.current.time;
    j.recalls = j.recalls || []; j.recalls.push(s.id);
    j.log = j.log || []; j.log.push({ t: data.current.time, title: s.hint, text: s.text });
    try { RT.writeMemory(data, { owner: 'player', content: s.text, tags: ['身世', s.id], impact: 45, t: data.current.time }); } catch (e) { DEG.hit("game.js", e); }
    out.push({ id: s.id, hint: s.hint, text: s.text, t: s.t });
  }
  return out;
}
function journalView(data) {
  const j = data.journal || { known: [], shadows: [], recalls: [], log: [] };
  return {
    known: (j.known || []).map(x => ({ k: x.k, v: String(x.v || '').slice(0, 160) })),
    shadows: (j.shadows || []).filter(s => !s.t).map(s => ({ id: s.id, hint: s.hint || '（有一件事……）', t: null })),
    recalled: (j.shadows || []).filter(s => s.t).map(s => ({ id: s.id, hint: s.hint, text: s.text, t: s.t })),
    events: (j.log || []).slice(-20).map(l => ({ t: l.t, title: l.title, text: l.text }))
  };
}

function buildReaction(data, updates) {
  const us = updates || [];
  /* v2.06 修 P1-1 E2a/E2b：原来取 Object.values(entities) 里**第一个非玩家人物** ——
     既不是"此刻在场的人"，也不是"本回合关系变了的那个人"（可能是离镇三天的 NPC），
     而且直读 ent.name（不过门控）。reaction 会进浏览器的 view 载荷，一旦有人渲染它就是活漏口。 */
  const hit = us.find(u => u && (u.type === '关系变化' || u.type === '情绪变化') && u.target);
  const byTarget = hit ? getEntity(data, hit.target) : null;
  const inScene = Object.values(data.entities).find(e => e.type === 'person' && e.id !== 'player' && e.state && e.state.location === data.current.sceneId);
  const npc = (byTarget && byTarget.type === 'person' && byTarget.state && byTarget.state.location === data.current.sceneId) ? byTarget : (inScene || byTarget);
  const n = npc ? (GATE.nameOf(data, npc.id) || '那个人') : '对方';
  if (us.some(u => u.type === '关系变化')) return n + '心里记下了什么。';
  if (us.some(u => u.type === '情绪变化')) return n + '看起来松快了一些。';
  /* v3.3 删：原来这里是 return '这个世界记住了一件事。'
     —— 三个问题叠在一句话里：
       ① 它是**引擎腔**：说话的不是世界里的人，是系统在报账（"记忆"就是系统术语本身）；
       ② 它**硬编码**：不管这回合记的是什么都印这一句，于是每回合的记忆新增都长得一模一样；
       ③ 它没必要：玩家自己的记忆已经在认知层（「我」面板 · 你记得的）里看得见，
          对方记下的事会在 TA 下一次的行为里体现出来 —— 那才是"世界给你的反应"。
     reaction 这一档的语义是"**世界**回给你的那一句"（关系/情绪真的变了才有），
     而"你记住了一件事"不是世界回给你的，是你自己脑子里的事。 */
  return '';
}

// 合并重复实体：同一人（同外貌标志物 / 同名）被创建两次时，并到优先保留的那个（先出现者）
// 动态维度 → 刚性锚点的沉淀（每回合调用一次；详见 runTurn 里的说明）
const DYN_TO_NINE = { 发型: '发型与发色', 衣着: '衣着与配饰', 配饰: '衣着与配饰' };
// **按世界时间判定，不按回合数**：5 个回合可能只过了 20 分钟，一晚上没换衣服不该被当成永久特征。
// "这个状态持续了两天以上" 才说明它不是临时状态。
const SEDIMENT_HOURS = 48;
const HAIR_COLOR = /(灰白|花白|银白|雪白|乌黑|黑色|棕色|褐色|金黄|亚麻|栗色|酒红|暗红|灰色|银灰|深棕|浅棕|茶色|白发)/;
function sedimentDynamic(data, nowISO) {
  const now = Date.parse(nowISO || (data && data.current && data.current.time) || '') || Date.now();
  let promoted = 0;
  for (const e of Object.values((data && data.entities) || {})) {
    if (!e || e.type !== 'person' || e.id === 'player') continue;
    const vis = (e.profile || {}).visual;
    if (!vis || !vis.dynaStable) continue;
    const dyn = vis.dynamic || {};
    for (const k of Object.keys(vis.dynaStable)) {
      const st = vis.dynaStable[k];
      if (!st) continue;
      const cur = String(dyn[k] || '').trim();
      if (!cur) { delete vis.dynaStable[k]; continue; }          // 动态层没了 → 停止计数
      if (cur !== st.v) { st.v = cur; st.t0 = now; st.n = 1; continue; }   // 值变了 → 重新计时
      // t0 统一成毫秒数（字符串 ISO 参与减法会得到 NaN，NaN<48 恒 false → 守卫会静默失效）
      if (typeof st.t0 !== 'number') st.t0 = Date.parse(st.t0) || now;
      st.n = (st.n || 0) + 1;
      if ((now - st.t0) / 3600000 < SEDIMENT_HOURS) continue;             // 还没持续够久 → 继续等
      const dim = DYN_TO_NINE[k];
      if (!dim) { delete vis.dynaStable[k]; continue; }                   // 表情/状态：不沉淀
      vis.nine = vis.nine || {};
      // 发型沉淀时**保留原发色**（剪发不染发：新值只说发型时，别把"灰白"丢了）
      const old = String(vis.nine[dim] || '');
      let nv = cur.slice(0, 120);
      if (k === '发型') { const oc = old.match(HAIR_COLOR); if (oc && !HAIR_COLOR.test(cur)) nv = nv + '，' + oc[1]; }
      if (old !== nv) { vis.nine[dim] = nv; promoted++; }
      delete dyn[k]; delete vis.dynaStable[k];                   // 已进锚点，从临时层摘掉
    }
  }
  return promoted;
}
/* ---------- 「这是同一个人吗」的两个判据（v1.98 · P0-3 收敛） ----------
   原来三处各写各的：mergeDupPersons 的 key()、applyUpdates 里的 dup、twinProfile 的 sameApp/sameName。
   而"占位串算不算标志物"**只在一处被排除**（'（你还没看清）'）——
   于是另外两处会把 '待发现'（import.js 导入默认）/ '（还没看清）'（director.js）当成真标志物：
   一张卡导进来，所有 NPC 的标志物都是 '待发现' ⇒ 判成同一个人 ⇒ 除第一个外全被合并掉、记忆与关系全塞给第一个。
   现在：占位串的清单只有一处（visual.js 的 PLACEHOLDER_RE，用 isPlaceholder 问），
   两个判据都只认它。两个函数放在一起，是因为它们回答的**不是同一个问题**：
     · personKey            = 身份键（优先级：真标志物 > 名字）→ 用来分桶，决定"谁是留下的那个"
     · looksLikeSamePerson  = 可能是同一个人吗（名字命中 **或** 真标志物命中的析取）→ 用来查重=是否复用已有档案 */
function personKey(e) {
  const app = String((((e || {}).profile || {}).appearance || {}).标志物 || '').trim();
  const name = String((e || {}).name || '').trim();
  if (app && !VIS.isPlaceholder(app)) return 'app:' + app;
  if (name) return 'name:' + name;
  return null;
}
function looksLikeSamePerson(a, b) {
  const an = String((a && a.name) || '').trim();
  const bn = String((b && b.name) || '').trim();
  if (an && bn && an === bn) return true;
  const aa = String(((((a || {}).profile || {}).appearance || {}).标志物) || '').trim();
  const ba = String(((((b || {}).profile || {}).appearance || {}).标志物) || '').trim();
  return !!(aa && ba && !VIS.isPlaceholder(aa) && aa === ba);
}

function mergeDupPersons(data) {
  if (!data || !data.entities) return 0;
  const persons2 = Object.values(data.entities).filter(e => e.type === 'person' && e.id !== 'player');
  let merged = 0;
  const key = personKey;
  const seen = new Map();
  for (const e of persons2) {
    const k = key(e);
    if (!k) continue;
    if (seen.has(k)) {
      const keep = seen.get(k);
      // 丢弃 e，改写一切引用
      for (const mid of Object.keys(data.memories || {})) { if (data.memories[mid].owner === e.id) data.memories[mid].owner = keep.id; }
      for (const m of (data.messages || [])) { if (m.from === e.id) m.from = keep.id; if (m.to === e.id) m.to = keep.id; }
      for (const l of (data.sceneLog || [])) { if (l.speaker === e.id) l.speaker = keep.id; if (l.speakerName === e.name) l.speakerName = keep.name; }
      const kr = data.knowledge || {};
      ['knownPeople', 'phoneContacts'].forEach(arr => { if (Array.isArray(kr[arr])) { const i = kr[arr].indexOf(e.id); if (i >= 0) kr[arr][i] = keep.id; } });
      // 关系合并
      for (const oid of Object.keys(data.relations || {})) {
        if (oid === e.id) { data.relations[keep.id] = data.relations[keep.id] || {}; for (const k2 of Object.keys(data.relations[e.id])) data.relations[keep.id][k2] = data.relations[e.id][k2]; delete data.relations[e.id]; }
        if (data.relations[oid] && data.relations[oid][e.id]) { data.relations[oid][keep.id] = data.relations[oid][e.id]; delete data.relations[oid][e.id]; }
      }
      // 印象合并（保留更高好感）
      if (data.impressions && data.impressions[e.id]) {
        const ki = data.impressions[keep.id] || (data.impressions[keep.id] = { stage: 1, seen: '', traits: [], notes: [], bonds: [], nameKnown: keep.name });
        const ei = data.impressions[e.id];
        if ((ei.stage || 1) > (ki.stage || 1)) ki.stage = ei.stage;
        if (!ki.seen) ki.seen = ei.seen || '';
        ki.nameKnown = ki.nameKnown || ei.nameKnown || keep.name;
        for (const t of (ei.traits || [])) if (!ki.traits.includes(t)) ki.traits.push(t);
        for (const n of (ei.notes || [])) if (!ki.notes.includes(n)) ki.notes.push(n);
        ki.traits = ki.traits.slice(-6); ki.notes = ki.notes.slice(-6);
        if (!ki.look && ei.look) ki.look = ei.look;                                  // 文字立绘（v1.18 新增，漏了会丢）
        for (const b of (ei.bonds || [])) if (!(ki.bonds || []).includes(b)) (ki.bonds = ki.bonds || []).push(b);
        delete data.impressions[e.id];
      }
      // 视觉档案合并（**这条是"一个人物两套档案"的防线**）：
      // nine 逐维只补空缺，dynamic 逐项只补空缺，anchor 谁有先用谁 —— 绝不整个覆盖。
      try {
        const ep = (e.profile || {}), kp = (keep.profile = keep.profile || {});
        const ev = ep.visual || {}, kv = (kp.visual = kp.visual || {});
        if (ev.nine || kv.nine) {
          kv.nine = kv.nine || {};
          for (const k2 of Object.keys(ev.nine || {})) if (!String(kv.nine[k2] || '').trim()) kv.nine[k2] = ev.nine[k2];
        }
        if (ev.dynamic || kv.dynamic) {
          kv.dynamic = kv.dynamic || {};
          for (const k2 of Object.keys(ev.dynamic || {})) if (!String(kv.dynamic[k2] || '').trim()) kv.dynamic[k2] = ev.dynamic[k2];
        }
        if (!kv.anchor && ev.anchor) kv.anchor = ev.anchor;
      } catch (e3) { DEG.hit("game.js", e3); }
      // 图片任务 / 行程计划里的 id 引用改写（否则指向已删除的实体）
      for (const tk of ((data.current && data.current.imgTasks) || [])) {
        if (Array.isArray(tk.who)) tk.who = tk.who.map(x => x === e.id ? keep.id : x);
      }
      for (const pl of (data.plans || [])) { if (pl && pl.who === e.id) pl.who = keep.id; }
      /* v1.83：补一处漏改写的引用（合并后留下的悬空 id）——
         待回复计划 pendingReplies[].from：不改的话回复会派给一个已不存在的 npc */
      for (const rp of ((data.current && data.current.pendingReplies) || [])) { if (rp && rp.from === e.id) rp.from = keep.id; }
      /* ── ★ v1.98 · P0-3：**账本不再被改写** ────────────────────────────────────
         原来这里有一段 "for (const lg of data.ledger) { lg.target = keep.id; ... }"：
         它把已经落账的历史逐条改写（只改外壳 target/owner/ref，连 d.owner 都不碰）。
         而账本的宪法是"只追加、永不修改"，两边直接冲突；更糟的是改一半——
         读侧（replay.js 看的是 d.owner/d.npc）看到的是**改之前**的 id，于是每次打开存档都判"账本 ≠ 内存"，
         然后按账本把记忆判回一个**已经被删掉的 id**。
         现在的语义：**发生过什么不改，只追加一条"我们现在改口了"的勘误**；
         谁需要"这个旧 id 现在是谁"，去读勘误（replay.js / query.js 都认它）。
         顺序要紧：先追加勘误，**再**删实体 —— 反过来的话中间态就是一个指向虚空的账本。 */
      try {
        const nowT = String((data.current && data.current.time) || '');
        if (typeof data.id !== 'function') DEG.hit('game.js', new Error('实体合并：data.id 不可用，勘误未落账'));
        else if (!nowT) DEG.hit('game.js', new Error('实体合并：世界时间缺失，勘误未落账'));
        else ledgerPush(data, {
          t: nowT, type: '实体合并', target: keep.id,
          desc: '（世界发现之前把两个人当成了同一个人）' + (keep.name || keep.id) + ' ← ' + (e.name || e.id),
          cause: '标志物/姓名重复判定',
          d: { kept: keep.id, merged: e.id, key: k, by: 'engine',
               before: { target: e.id, owner: e.id, ref: e.id },
               mergedName: e.name || '', keptName: keep.name || '' }
        });
      } catch (e4) { DEG.hit('game.js', e4); }
      delete data.entities[e.id];
      merged++;
    } else { seen.set(k, e); }
  }
  return merged;
}

module.exports = { buildDevView, buildViewRaw, autoImgNote, parseIntent, runTurn, sendMessage, readMessage, readNews, buildView, createDoc, knownDocs, docPublic, matchReadIntent, backfillDoc, startFx, openDocTurn, buildAffordances, advanceTutorial, buildReaction, resolveWakeTime, applyUpdates, mergeDupPersons, personKey, looksLikeSamePerson, recallCheck, resolveSpeaker, scrubSceneLog, mergeActorInto, genLook, genProfile, nineFilled, plainLook, sedimentDynamic, viewName, gateSuggestions,
  /* v3.3：采纳"玩家自己认知里的名字"这步长在 gate.nameOf 里（名字的尺子自己保证一致），
     这里只是把它转出来给断言脚本用，不另开第二个执行点。 */
  adoptSelfNames: GATE.adoptSelfNames };