// world.js — 新手指引世界（中性示例，无真实地名人物；正式内容由扫描导入产生）
'use strict';
const { makeId, ledgerPush } = require('./store');
const PRES = require('./presentation');
const VIS = require('./visual');

function buildDemoWorld() {
  const now = '1996-06-14T20:45:00';
  const data = {
    meta: {
      name: '青石镇 · 老街区',
      era: '九十年代 · 青石镇',
      eraCode: 'nineties',
      maxSeverity: 'L2',
      theme: 'terminal',
      carries: { time: 'brick', news: 'paper', map: 'paper', note: 'letter' },
      importRole: null, importSource: null,
      worldClock: { year: 1996, lastSettled: now }, calendar: [], techItems: [],
      tools: PRES.deriveTools({ time: 'brick', news: 'paper', map: 'paper', note: 'letter' }, '九十年代 · 青石镇')
    },
    current: { time: now, weather: '小雨', sceneId: 'pl_1', pendingDecisions: [], weatherSeen: true, device: { name: '大哥大', icon: '📟', apps: ['sms', 'contacts'] } },
    claims: [],
    accounts: [],   // v3.20 钱与账：欠着谁 / 谁欠你（AI 只提议，数字由引擎落）
    entities: {}, memories: {}, news: [], ledger: [], messages: [],
    relations: {},
    knowledge: { visited: ['pl_1'], knownPlaces: ['pl_1', 'pl_2', 'pl_3', 'pl_4', 'pl_5'], knownPeople: ['npc_1', 'npc_2'], phoneContacts: ['npc_1'], readMsgs: [], heardNews: ['n_1'], knownDocs: ['doc_note1'] },
    archives: {}, autoId: 1
  };
  const E = data.entities;

  E['pl_1'] = { id: 'pl_1', type: 'place', name: '转角杂货铺', geo: ['青石镇', '老街区'], tags: ['室内', '店铺'], openHours: '07:30-22:00', edges: [{ to: 'pl_2', level: '同街区', minutes: 6 }], features: ['货架', '油布雨棚', '老柜台', '收音机'], state: {} };
  E['pl_2'] = { id: 'pl_2', type: 'place', name: '老街口', geo: ['青石镇', '老街区'], tags: ['室外', '路口'], openHours: '全天', edges: [{ to: 'pl_1', level: '同街区', minutes: 6 }, { to: 'pl_4', level: '同街区', minutes: 8 }], state: {} };
  E['pl_3'] = { id: 'pl_3', type: 'place', name: '你住的巷房', geo: ['青石镇', '老街区'], tags: ['住宅', '室内'], openHours: '全天', edges: [{ to: 'pl_2', level: '同街区', minutes: 7 }], features: ['窗', '床', '门'], state: {} };
  E['pl_4'] = { id: 'pl_4', type: 'place', name: '老茶馆', geo: ['青石镇', '老街区'], tags: ['室内', '茶馆'], openHours: '10:00-22:00', edges: [{ to: 'pl_2', level: '同街区', minutes: 8 }, { to: 'pl_5', level: '相邻街区', minutes: 15 }], features: ['棋桌', '老柜台', '门'], state: {} };
  E['pl_5'] = { id: 'pl_5', type: 'place', name: '沈姨家', geo: ['青石镇', '老街区'], tags: ['住宅', '室内'], openHours: '全天', edges: [{ to: 'pl_4', level: '相邻街区', minutes: 15 }], features: ['窗', '床', '门'], state: {} };
  E['pl_6'] = { id: 'pl_6', type: 'place', name: '镇汽车站', geo: ['青石镇'], tags: ['室外', '交通'], openHours: '06:00-20:00', edges: [{ to: 'pl_2', level: '相邻街区', minutes: 12 }], features: ['售票口', '候车室'], state: {} };

  E['npc_1'] = {
    id: 'npc_1', type: 'person', name: '沈姨', avatar: null,
    tags: ['杂货铺老板娘', '青石镇', '五十岁', '嘴碎心软'],
    indexes: { geo: ['青石镇', '老街区'], org: ['转角杂货铺'], family: ['沈家'] },
    profile: {
      identity: { 姓名: '沈姨', 年龄: '五十多点', 职业: '转角杂货铺老板娘', 关系: '你的房东兼邻居（在青石镇，老熟人）' },
      appearance: { 标志物: '腰间总别着串钥匙、说话带手势、爱嗑瓜子', 随身: '老花镜、大蒲扇', 口癖: '要死咯' },
      surface: { 待人: '热情、嘴碎、爱管闲事、心软' },
      hidden: { 真实: '其实记仇，尤其记"谁让她在街坊面前下不来台"；算账精明' },
      background: { 经历: '在这条老街守店二十多年；丈夫走得早；儿子在城里' },
      schedule: { workday: [{ from: '07:30', to: '22:00', place: 'pl_1' }], weekend: [{ from: '09:00', to: '22:00', place: 'pl_1' }] },
      desires: { 现在想: '打烊前听人说说话；惦记那笔被赊走的账' },
      finance: { 概况: '小本生意；城里供应商催了一笔货款' },
      secrets: { 包袱: '她最怕被人说"老了不中用"——上周争执就是这句话闹的' },
      visual: { anchor: '五十多岁，圆润鹅蛋脸，两颊有肉，灰白发短卷发，深蓝色碎花棉布衬衫，腰间围裙', nine: {"脸型与年龄感":"五十多岁，圆润鹅蛋脸，两颊有肉，轻微法令纹，三庭≈1:1:1","眉眼与瞳孔":"单眼皮，眼形细长略弯（笑眼），瞳色深棕，眉型自然下垂的淡眉","鼻子与嘴唇":"鼻梁不高，鼻头圆润，唇薄偏干，唇色暗红，爱撇嘴","肤色与肤质":"暖黄肤色，肤质偏糙，颧骨有轻微日晒斑","体型身材":"身高约158cm，中年微胖体态，肩宽背厚","发型与发色":"灰白发，短卷发，额前碎发，发际线略高","衣着与配饰":"深蓝色碎花棉布衬衫，黑色布裤，围裙系在腰间，布鞋","永久标记":"左眉尾一小颗痣，右手虎口茧"}, dynamic: {} }
    },
    locked: { core: '性格内核：护短、要面子，但刀子嘴豆腐心' },
    birthYear: 1941,
    state: { location: 'pl_1', mood: '烦躁', fatigue: '中', hunger: '低', sleep: '正常' },
    trait: { lambda: 0.03, memory: '记仇型' }
  };

  E['npc_2'] = {
    id: 'npc_2', type: 'person', name: '阿岩', avatar: null,
    tags: ['修车工', '青石镇', '话少'],
    indexes: { geo: ['青石镇', '老街区'], org: ['老茶馆常客'], family: [] },
    profile: {
      identity: { 姓名: '阿岩', 年龄: '29', 职业: '修车铺伙计（夜里常来老茶馆）' },
      appearance: { 标志物: '总穿深蓝工装、手指有油渍、烟不离手' },
      surface: { 待人: '闷、话少、但说话算话' },
      hidden: { 真实: '其实心思细，谁对他好他记着' },
      background: { 经历: '镇上长大的，手艺是祖传' },
      schedule: { workday: [{ from: '08:00', to: '21:00', place: 'pl_4' }] },
      desires: { 现在想: '雨停，收工回家' },
      secrets: { 包袱: '瞒着家里在攒钱想盘下修车铺' },
      visual: { anchor: '二十多岁，长脸，黑色短发偏分，深蓝色工装外套，劳保鞋', nine: {"脸型与年龄感":"二十多岁，长脸，下颌线明显，三庭≈1:1:1","眉眼与瞳孔":"内双，细长眼，瞳色黑亮，眉浓且平","鼻子与嘴唇":"鼻梁挺直，鼻翼略宽，唇薄，唇色偏淡","肤色与肤质":"偏白略晒红，肤质偏粗，鼻翼微起皮","体型身材":"身高约178cm，偏瘦，肩膀宽，手臂线条结实","发型与发色":"黑色短发，碎发，刘海偏分，发量多","衣着与配饰":"深蓝色工装外套（袖口有油渍），黑色长裤，劳保鞋，腰间一串钥匙","永久标记":"右手食指第二关节一道小旧疤"}, dynamic: {} }
    },
    locked: { core: '性格内核：闷葫芦，认死理' },
    birthYear: 1967,
    state: { location: 'pl_1', mood: '平静', fatigue: '低', hunger: '中', sleep: '正常', override: { reason: '在铺子门口檐下避雨', until: '1996-06-14T22:00:00' } },
    trait: { lambda: 0.08, memory: '普通' }
  };

  E['player'] = {
    id: 'player', type: 'person', name: '你', avatar: null,
    tags: ['玩家', '青石镇', '暂住'],
    indexes: { geo: ['青石镇', '老街区'], family: ['巷房'] },
    profile: {
      identity: { 姓名: '你', 年龄: '27', 职业: '自由职业，在青石镇租了间巷房住一阵', 外号: '（街坊还没给你起外号）' },
      appearance: { 标志物: '黑色挎包' },
      surface: { 待人: '随和、嘴快、有时大大咧咧' },
      hidden: { 真实: '其实怕冷场，吵架后会惦记' },
      background: { 经历: '上周五傍晚在杂货铺门口说顺了嘴，当着阿岩的面说沈姨"这店再这样撑不了几年"' },
      desires: { 现在想: '把上周那事圆过去' },
      secrets: { 包袱: '你其实知道话说重了' },
      visual: { anchor: '二十多岁，偏瓜子脸，杏眼，黑色短发，黑色夹克白色T恤，黑色挎包', nine: {"脸型与年龄感":"二十多岁，偏瓜子脸，下颌线流畅，三庭≈1:1:1，眼角微下垂","眉眼与瞳孔":"双眼皮，杏眼，瞳色黑棕，眉型平直偏细","鼻子与嘴唇":"鼻梁直，鼻头小巧，唇厚适中，唇色自然","肤色与肤质":"暖白肤色，肤质较细腻","体型身材":"身高约172cm，中等偏瘦，肩平","发型与发色":"黑色短发，随手抓的层次碎发，发量中等","衣着与配饰":"黑色夹克，白色T恤，卡其长裤，黑色挎包","永久标记":"（无）"}, dynamic: {} }
    },
    locked: { core: '性格内核：嘴快心软' },
    birthYear: 1969,
    state: { location: 'pl_1', fatigue: '低', hunger: '低', sleep: '正常' },
    money: { currency: '元', cash: 52, digital: 0, spent: 0, earned: 0 },
    inventory: [{ id: 'it_phone', name: '大哥大', can: '通话/短信' }, { id: 'it_watch', name: '手表', can: '时间' }, { id: 'it_wallet', name: '钱包', can: '现金' }, { id: 'it_key', name: '巷房钥匙', can: '开锁' }]
  };

  E['it_milk'] = { id: 'it_milk', type: 'item', name: '牛奶', tags: ['食品'], at: 'pl_1', price: 5, desc: '250ml 盒装' };
  E['it_smoke'] = { id: 'it_smoke', type: 'item', name: '红塔山', tags: ['烟'], at: 'pl_1', price: 12, desc: '沈姨自己也抽这个' };
  E['it_scarf'] = { id: 'it_scarf', type: 'item', name: '老式雨披', tags: ['杂物'], at: 'pl_1', price: 15, desc: '厚塑料，老味儿' };

  data.relations['player'] = { npc_1: { tone: '有点僵（上周五说重了话，你还没进过店）', causes: ['上周口角'] }, npc_2: { tone: '点头之交', causes: [] } };
  data.relations['npc_1'] = { player: { tone: '看见你就别扭，但也惦记你租约到期', causes: ['上周口角'] }, npc_2: { tone: '常来避雨的熟脸', causes: [] } };
  data.relations['npc_2'] = { player: { tone: '认识的镇上看样子', causes: [] } };

  data.memories['m_1'] = { id: 'm_1', owner: 'npc_1', content: '上周五，你在店门口当着阿岩的面说她店撑不了几年', tags: ['杂货铺', '冲突', '面子'], impact: 70, weight: 61, t: '1996-06-08T21:10:00', lastActivation: '1996-06-08T21:10:00', activations: 1, repeat: false };
  data.memories['m_2'] = { id: 'm_2', owner: 'player', content: '上周五嘴快，说了伤人的话（"撑不了几年"）', tags: ['杂货铺', '冲突', '口误'], impact: 55, weight: 48, t: '1996-06-08T21:10:00', lastActivation: '1996-06-08T21:10:00', activations: 1, repeat: false };
  data.memories['m_3'] = { id: 'm_3', owner: 'npc_1', content: '三年前你手头紧，她赊了你半个多月账', tags: ['杂货铺', '情分', '帮忙'], impact: 60, weight: 40, t: '1993-09-01T12:00:00', lastActivation: '1993-09-01T12:00:00', activations: 1, repeat: false };
  data.memories['m_4'] = { id: 'm_4', owner: 'player', content: '三年前手头最紧时，沈姨赊过账', tags: ['杂货铺', '情分', '帮忙'], impact: 60, weight: 42, t: '1993-09-01T12:00:00', lastActivation: '1993-09-01T12:00:00', activations: 1, repeat: false };

  data.messages.push({ id: 'msg_1', from: 'npc_1', to: 'player', body: '到了没？雨不小，我铺子灯还亮着。', t: '1996-06-14T20:40:00', status: 'unread', via: 'phone' });

  data.news.push({ id: 'n_1', t: '1996-06-14T07:00:00', title: '青石镇今宵小雨，后半夜或转中雨', summary: '镇广播站的喇叭傍晚播了天气预报：外出记得带伞，老街区低洼处注意积水。', tags: ['本地', '天气'], region: '青石镇', severity: '低', impact: { 时长: '短期', 范围: '本地区' } });
  data.worldinfo = {
    w1: { uid: 'w1', keys: ['老茶馆', '棋局'], content: '老茶馆每晚八点摆棋，老周坐庄；输的人请茶钱，赢了能得半斤炒瓜子——镇上的规矩，输不起的人不来。', enabled: true },
    w2: { uid: 'w2', keys: ['沈姨', '儿子'], content: '沈姨的儿子在城里干装修，一年到头不回来；她嘴上说“省心”，其实每晚都守着电话机，等他在公用电话亭打回来。', enabled: true }
  };
  data.news.push({ id: 'n_2', t: '1996-06-13T19:00:00', title: '老茶馆贴了个"棋局会友"的告示', summary: '每晚八点，馆里老周摆棋，输的人请茶钱。', tags: ['本地', '生活'], region: '老街区', severity: '低', impact: { 时长: '长期', 范围: '本地区' } });

  data.id = makeId;
  // 身世日志：开局=我全明白；旧账/见过谁/手艺=隐约记得，剧情说到才会想起来
  data.journal = {
    known: [
      { k: '你是谁', v: '27岁，自由职业——镇上人都喊你"小游"。这半个月靠给铺子修收音机、电扇糊口。' },
      { k: '来历', v: '你妈是青石镇人。上个月你在城里跟合伙人闹僵，辞了工，拎着包回了镇上，租了巷房先住下。' },
      { k: '你的样貌', v: '黑色挎包，洗得发白的夹克；手上有拧螺丝磨出的茧。' },
      { k: '性格', v: '嘴上快、心软；怕冷场，更怕被人戳到痛处。' },
      { k: '本领', v: '会修小电器；会记账；骑二八大杠很稳。' },
      { k: '眼下想', v: '攒点钱，想清楚自己该往哪走。' },
      { k: '心里压着的', v: '上次分伙闹得不体面；还有——你知道自己上周话说重了。' }
    ],
    shadows: [
      { id: 'j_shenyi', hint: '关于沈姨……好像有一笔旧账？', targets: ['npc_1'], triggers: ['赊账', '赊', '欠', '旧账'], text: '三年前你手头最紧、货全断在那天，她在账本上记了你半个多月，让你先把东西拿走，从没催过你。' },
      { id: 'j_ayan', hint: '阿岩……你好像在哪见过他？', targets: ['npc_2'], triggers: ['阿岩', '修车铺', '轮胎'], text: '去年秋天你在城里见过他——修车摊前，他蹲着给人换轮胎，深蓝外套袖子上全是油。他大概已经不记得你。' },
      { id: 'j_skill', hint: '手艺上的事……你好像会点什么？', triggers: ['收音机', '电扇', '电器'], text: '上个月你还在城里的电器修理铺帮工。收音机、电扇、电视机——会修的你十分钟修好，不会修的就摇头说修不好。' }
    ],
    recalls: [], log: []
  };
  ledgerPush(data, { t: '1996-06-08T21:10:00', type: '事件开始', target: '口角', desc: '你在杂货铺门口对沈姨说了难听话', cause: null, scene: 'pl_1' });
  ledgerPush(data, { t: '1996-06-14T20:40:00', type: '信息到达', target: 'player', desc: '沈姨发来短信：-到了没-', via: 'phone', cause: null });

  data.tutorial = {
    step: 0,
    steps: [
      { at: 1, msg: { from: 'npc_1', to: 'player', body: '明天上午帮我看半天店？我儿子那边有点事。', t: '1996-06-15T09:10:00' }, hint: '沈姨给你发了一条消息——回她？' },
      { at: 3, cand: '货架上来了一批新货，沈姨正挨个贴价签', hint: '店里来了批新货，去看看吧。' },
      { at: 5, msg: { from: 'npc_1', to: 'player', body: '要不要明晚去老茶馆坐坐？老周摆棋，输了的请茶钱。', t: '1996-06-15T20:30:00' }, hint: '老茶馆的棋局，沈姨邀了你去。', claim: { title: '老茶馆棋局（沈姨约）', when: '20:00', date: '1996-06-16' } },
      { at: 7, cand: '沈姨不小心把一包烟钱算错了，正盯着账本发呆', hint: '沈姨好像算错了账——去提醒她？' },
      { at: 9, cand: '老街口的广播在播：今晚放露天电影', hint: '今晚有露天电影。' }
    ]
  };
  data.impressions = {
    npc_1: { stage: 4, seen: '五十来岁，腰上挂着一串钥匙，说话爱比划，手边总搁着嗑开的瓜子', traits: ['热情、嘴碎', '爱管闲事，看着心软'], notes: ['她就是你要打交道的老街坊'], bonds: ['房东兼邻居', '老熟人', '上周拌过嘴'] },
    npc_2: { stage: 2, seen: '深蓝工装，手指有油渍', traits: ['话少'], notes: ['在老茶馆常碰见'], bonds: ['点头之交'] }
  };
  // v1.46 可读文本（文档对象）：可读的东西是**对象**，不是只有旁白。
  // 演示世界给一份：玩家在「信匣 · 文书」里能看到它，打「打开纸条」就能读（展开动画 + 正文一起到）。
  data.documents = {
    doc_note1: {
      id: 'doc_note1', title: '一张赊账纸条', kind: 'doc', source: 'seed',
      body: '六月十一 · 赵子俊 赊 红塔山两包、汽水一瓶，共七块二。\n下月初五前还。\n——字是沈姨的，笔画很用力，最后那个“还”字洇开了一小团墨。',
      from: '', to: '', tags: ['纸条', '账'], read: false, at: 'pl_1', t: '1996-06-14T20:45:00'
    }
  };
  data.sceneLog = [
    { t: '1996-06-14T20:45:00', type: 'stage-tag', text: '[转角杂货铺 · 夜晚 · 小雨]' },
    { t: '1996-06-14T20:45:00', type: 'dialogue', speaker: 'npc_1', speakerName: '沈姨', text: '你怎么现在才回来？', tone: '皱眉' },
    { t: '1996-06-14T20:45:00', type: 'narration', text: '她站在铺子门口的油布棚下，手里的烟快燃到滤嘴了。' },
    { t: '1996-06-14T20:45:00', type: 'ambient', text: '雨点打在棚布上；收音机在播天气预报。' },
    { t: '1996-06-14T20:45:00', type: 'bar', speaker: 'npc_2', speakerName: '阿岩', text: '（蹲在檐下，抬头看了你一眼）……回来了？', tone: '没话找话' }
  ];
  return data;
}

module.exports = { buildDemoWorld };