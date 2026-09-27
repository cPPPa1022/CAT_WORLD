// worldgen.js — AI 从0生成全新世界（素材库随机组合 + LLM 自由创作；无固定世界模板）
// v1.7 新增：玩家自定义 User 设定（userSelf）+ 一句话创作世界 + 设定核对（以世界为准）
'use strict';
const AI = require('./ai');

// —— 素材库（组合件，不是世界模板） ——
const ERAS = [
  { key: '现代', era: '现代都市', carries: { time: 'phone', news: 'phone', map: 'phone', note: 'phone' }, currency: '元', weathers: ['小雨', '晴 · 傍晚', '雾', '热气腾腾的午后', '闷热'] },
  { key: '九零', era: '九十年代 · 小城', carries: { time: 'brick', news: 'paper', map: 'paper', note: 'letter' }, currency: '元', weathers: ['黄昏蝉鸣', '雷阵雨前', '煤炉子的烟', '雪夜'] },
  { key: '古', era: '旧时 · 不知年月', carries: { time: 'none', news: 'oral', map: 'paper', note: 'paper' }, currency: '文', weathers: ['细雨', '薄雾', '月光很亮', '沙尘', '初雪'] },
  { key: '修', era: '山野志怪', carries: { time: 'none', news: 'oral', map: 'compass', note: 'jade' }, currency: '灵石', weathers: ['山雾', '萤火', '云海翻涌', '夜露'] },
  { key: '末', era: '末世 · 灰历', carries: { time: 'none', news: 'radio', map: 'paper', note: 'paper' }, currency: '物资券', weathers: ['沙尘', '辐射雨', '闷热无风', '大雾'] },
  { key: '星', era: '星际时代', carries: { time: 'phone', news: 'phone', map: 'phone', note: 'phone' }, currency: '星币', weathers: ['星云掠过', '舷窗外真空', '港内恒温'] },
  { key: '赛', era: '赛博都市', carries: { time: 'phone', news: 'phone', map: 'phone', note: 'phone' }, currency: '信用点', weathers: ['霓虹雨', '酸雾', '深夜静电'] },
  { key: '奇', era: '轻微奇幻', carries: { time: 'phone', news: 'phone', map: 'phone', note: 'phone' }, currency: '元', weathers: ['晴 · 多云', '雨后天晴', '晚霞'] },
  { key: '寒', era: '克苏鲁式怪谲', carries: { time: 'none', news: 'oral', map: 'paper', note: 'paper' }, currency: '文', weathers: ['浓雾', '湿冷', '涨潮夜'] }
];
const PLACES = ['街角小店', '深夜小吃摊', '旧书店', '理发铺', '修车棚', '糖果铺', '旅行社', '打铁铺', '药铺', '棋牌室', '后巷黑市', '码头仓库', '山顶客栈', '沙漠水站', '养老院', '中学后门', '茶水间', '地下室酒吧', '寺庙厢房', '朝圣者营地', '浮桥渡口', '老式照相馆', '殡葬一条街 38 号', '过夜的候车厅'];
const NAMES = ['沈听澜', '李二白', '阿九', '陈独行', '小满', '老常', '铁叔', '苏晚晴', '胡一刀', '江野', '苏小婉', '老侯', '阿萤', '盐酥', '赵铁柱', '林晚', '白鸦', '钱串子', '苟大富', '十一', '何苦', '温言', '方外', '谢无衣', '桑榆', '曲终', '白芷', '顾长风', '小鹿', '老六'];
const PERSONAS = [
  { surface: '话不多，但句句算数', hidden: '藏着一段不敢提的旧事', desire: '今晚想早点关门', role: '铺子的当家人' },
  { surface: '嘴碎，走得近就热闹', hidden: '其实一直在等一个人', desire: '想听人说说话', role: '这条街的老面孔' },
  { surface: '半信半疑地客气', hidden: '看人的眼光很毒', desire: '把一桩心事结掉', role: '新接手的掌柜' },
  { surface: '见谁都笑，滴水不漏', hidden: '账上有不对的地方', desire: '今晚别出事', role: '生意人' },
  { surface: '沉默得像块石头', hidden: '手艺惊人，藏得深', desire: '把活干完就走', role: '来路不明的帮工' },
  { surface: '爽快，嗓门大', hidden: '最恨被人骗', desire: '收摊前喝一杯', role: '这片的熟人' }
];
const OPENERS = [
  '你刚落脚，推门的瞬间，{n}从{(place)}的方向看了过来：「新来的？」',
  '雨没下透，{n}把灯调亮了一点：「坐吧，不赶你。」',
  '门帘一晃，{n}手里的活没停："今晚就你一个。"',
  '{n}抬起头，打量了你一会，像是认出了什么又没说。',
  '你走了一路，只有{(place)}还亮着。{n}见你进来，往炉子添了块炭。',
  '广播报了句什么，{n}侧耳听完，才转过来看你：「迷路了吧。」'
];
const RULES = ['夜里十一点后不上门', '账要当面结清', '墙上的钟慢了五分钟，但谁都不调', '下雨天不涨价', '旧东西不收来历不明的', '说出口的话要算数', '这里的人不打听名字', '如果听到三声梆子，别回头'];
const SEEDS = ['（店里的常客少了两个，{n}没提）', '（墙角的影子比往常多了一个）', '（来了封没有署名的信）', '（镇上的人路过都会多看一眼）', '（广播里提到了你的名字）', '（{n}递给你一张旧照片）'];
// 玩家身世素材（技能/经验：作为"隐约记得"的回想种子）
const SKILLS = {
  现代: ['修点小家电', '骑车', '做饭'], 九零: ['修收音机', '骑车', '记账'],
  古: ['写一手好字', '算账', '赶车'], 修: ['认草药', '巡山辨路', '生火'],
  末: ['辨路', '讨价还价', '修机械'], 星: ['检修管线', '认星图', '应答礼仪'],
  赛: ['接线', '讨价还价', '走夜路'], 奇: ['识天气', '记路', '讲价'],
  寒: ['抄写', '守夜', '认潮汐']
};
// 随机世界的可画外貌池（九维：避免（你还没看清）占位导致生图无锚点；结构仿扫描协议）
const NINE_POOL = [
  '①三十多岁，方脸，眉骨略高，三庭≈1:1:1②内双细长眼，瞳色深棕，眉浓而直③鼻梁高挺，鼻翼略窄，唇厚适中，唇色偏深④偏白肤色，肤质一般，鬓角微有晒痕⑤身高约176cm，肩宽，较结实⑥黑色短发，后脑剃短，额前一绺碎发⑦深色夹克，灰色长裤，旧皮鞋⑧左手虎口一道浅疤',
  '①四十上下，圆脸，两颊有肉，三庭≈1:1:1②单眼皮，眼形圆，瞳色黑亮，眉短而淡③鼻梁不高，鼻头圆，唇薄，嘴角向上④暖黄肤色，肤质偏细，颧骨散着些粟点⑤身高约155cm，微胖，肩窄⑥黑发盘成低髻，鬓角碎发，发色乌⑦碎花布衫，深色裤，围裙，布鞋⑧右眼角下一颗泪痣',
  '①二十多岁，鹅蛋脸，下颌线收窄，三庭≈1:1:1②双眼皮，杏眼，瞳色黑棕，眉细而平③鼻梁直，鼻头小巧，唇润，唇色淡红④暖白肤色，肤质细腻⑤身高约163cm，纤细，窄肩⑥黑长直发披肩，发梢微卷，偏分⑦白色衬衫，卡其长裙，帆布鞋⑧（无）',
  '①五十多岁，长方脸，皱纹深，三庭≈1.1:1:1②单眼皮，眼袋明显，瞳色灰褐，眉白而稀③鼻梁宽，鼻头钝，唇薄干裂，唇色沉④深色粗皮，风霜明显，两颊有斑⑤身高约170cm，干瘦，背微驼⑥灰白短发，花白胡茬，发际后移⑦灰布褂子，黑棉裤，解放鞋⑧右眉角一道旧疤'
];

function pick(arr, lastIdx) { let i = Math.floor(Math.random() * arr.length); if (arr.length > 1 && i === lastIdx) i = (i + 1) % arr.length; return { item: arr[i], i }; }
// 玩家身份池：按时代取自然身份（外来者只是其中之一，不留白）
const SELF_POOL = {
  现代: ['这条街的老住户，每晚都来坐坐', '刚搬来不久，还在认门', '在附近上班，下班顺路进来', '替家里跑腿，路过'] ,
  九零: ['厂里的职工，下了夜班', '街坊邻里的老熟人', '帮家里看店的小辈', '从乡下进城，头一回来'] ,
  古: ['镇上的居民，与店主人相识', '路过借宿的行商', '本地的读书人', '受人所托来送一封信'] ,
  修: ['山下的猎户，迷路至此', '外来的散修，来拜会', '山脚村子的采药人', '跟随师门巡山的弟子'] ,
  末: ['灰丘的幸存者，出来找补给', '巡逻队的编外成员', '废墟里的搜集者', '从避难所逃出来的'] ,
  星: ['星站的技术员，轮班刚下', '随舰中转的旅人', '港口的装卸工', '来交接货物的商队护卫'] ,
  赛: ['夜班的数据工，下班路上', '本地街区的人，混个脸熟', '接单跑腿的' , '从城外来的'], 
  奇: ['镇上的邮差', '猎魔人预备役，巡街', '教会的信使', '来收账的同乡'] ,
  寒: ['镇上的医生，出诊回来', '写小说的，来挑素材', '守夜人，换班', '查案的人']
};
function randomIdentity(eraKey) {
  const pool = SELF_POOL[eraKey] || ['初到此地的人'];
  return pool[Math.floor(Math.random() * pool.length)];
}
function pickEra(prompt) {
  const kw = prompt || '';
  if (/赛博|未来|科技/.test(kw)) return ERAS.find(e => e.key === '赛');
  if (/古|民国|朝/.test(kw)) return ERAS.find(e => e.key === '古');
  if (/仙|修|妖|狐/.test(kw)) return ERAS.find(e => e.key === '修');
  if (/末|废|灰/.test(kw)) return ERAS.find(e => e.key === '末');
  if (/星|太空/.test(kw)) return ERAS.find(e => e.key === '星');
  if (/奇|魔法/.test(kw)) return ERAS.find(e => e.key === '奇');
  if (/怪|克苏/.test(kw)) return ERAS.find(e => e.key === '寒');
  if (/九|八十|老街/.test(kw)) return ERAS.find(e => e.key === '九零');
  return ERAS[Math.floor(Math.random() * ERAS.length)];
}

function randomPack(prompt) {
  const era = pickEra(prompt);
  const p1 = pick(PLACES); const n1 = pick(NAMES); const pe = pick(PERSONAS); const o = pick(OPENERS); const r1 = pick(RULES); const s1 = pick(SEEDS);
  const selfId = randomIdentity(era.key);
  const npcName = n1.item;
  const eraName = era.key === '星' ? '星尘港 · ' + p1.item : era.key === '赛' ? '霓虹城 · ' + p1.item : era.key === '末' ? '灰丘 · ' + p1.item : (npcName.slice(0, 1) + '家铺子所在的镇子 · ' + p1.item);
  const weather = era.weathers[Math.floor(Math.random() * era.weathers.length)];
  const firstScene = o.item.replace('{n}', npcName).replace('{(place)}', p1.item);
  return {
    meta: { name: eraName, era: era.era, theme: 'terminal', maxSeverity: 'L2', carries: era.carries, currency: era.currency || '元' },
    time: '2026-05-21T20:45:00', weather: weather,
    player: (function () {
      const skills = SKILLS[era.key] || ['识路'];
      return {
        name: '你', identity: selfId, origin: '你是' + selfId + '。今晚，你到了这里。',
        appearance: '随身旧行囊，风尘仆仆', personality: '话不多，心里有主意', inner: '认生，但认下的人会护',
        ability: skills.join('、'), desire: '先安顿下来，看看这里有没有自己的活',
        skills: skills.slice(0, 3),
        shadows: [{ hint: '手艺上的事……你好像会点什么？', triggers: ['手艺', '修'].concat(skills.slice(0, 2).map(s => String(s).slice(0, 3))), text: '你' + skills.slice(0, 3).join('、') + '——不算精，但糊口够用。' }],
        inventory: era.carries.time === 'phone' ? ['手机', '钱包'] : (era.carries.time === 'brick' ? ['大哥大', '手表', '钱包'] : ['随身行囊'])
      };
    })(),
    npcs: [{ id: 'npc1', name: npcName, surface: pe.item.surface, hidden: pe.item.hidden, appearance: NINE_POOL[Math.floor(Math.random() * NINE_POOL.length)], desire: pe.item.desire, role: pe.item.role, home: 'p3', workPlace: 'p1', workFrom: '08:00', workTo: '21:00', inScene: true }],
    places: [
      { id: 'p1', name: p1.item, tags: ['室内'], geo: [eraName.split(' · ')[0] || '某处', p1.item], openHours: '08:00-21:00', edges: [{ to: 'p2', level: '同街区', minutes: 6 }] },
      { id: 'p2', name: '街口', tags: ['室外'], geo: [eraName.split(' · ')[0] || '某处', '街口'], openHours: '全天', edges: [{ to: 'p1', level: '同街区', minutes: 6 }, { to: 'p3', level: '相邻街区', minutes: 16 }] },
      { id: 'p3', name: '你落脚的地方', tags: ['住宅'], geo: [eraName.split(' · ')[0] || '某处'], openHours: '全天', edges: [] }
    ],
    firstScene: firstScene,
    seeds: [s1.item, '（（此处埋一件事））'], rules: [r1.item, '世界按自己的规则运转']
  };
}

// ---------- 世界生成系统提示（v1.7：支持玩家一句话指令 + User 设定） ----------
/* v2.06 修 P1-3 B-1/B-2：玩家身份档案（/api/self 收的那 11 个键）原来被 `String(userSet)` 拼进提示词 ——
   一个普通对象 String() 出来就是 **"[object Object]"**：玩家精心填的"我是谁"一个字都没到世界生成器手上，
   而生成器还在按"玩家对自己有设定"这条分支走（条件里那个 `userSet.JSON` 也是个永远不存在的键）。
   现在按字段拼成人话；空档案照旧走"由世界替你设计身份"那条分支。 */
const SELF_LABEL = {
  name: '名字', age: '年龄', identity: '身份', role: '职业/角色', ability: '本事', appearance: '样貌',
  backstory: '来历', attitude: '待人', secret: '藏在心里的事', desire: '想要什么', wealth: '手头'
};
function userSelfText(userSet) {
  if (!userSet || typeof userSet !== 'object') return '';
  const parts = [];
  for (const k of Object.keys(SELF_LABEL)) {
    const v = String(userSet[k] == null ? '' : userSet[k]).trim();
    if (v) parts.push(SELF_LABEL[k] + '：' + v);
  }
  return parts.join('；');
}
function worldGenSystem(userSet) {
  const selfTxt = userSelfText(userSet);
  const selfLine = selfTxt
    ? '【玩家对自己的设定】玩家填的身份档案：' + selfTxt.slice(0, 800) + '。这些是"玩家想成为的样子"，你生成世界时可以把它们变成"玩家在这个世界的样子"，但它们不是世界规则——世界可以拒绝它们（见【冲突规则】）；能被世界接纳的部分，请写进 player{name,identity,等}。'
    : '【玩家设定】玩家未填写自我设定：请由你为玩家【设计一个与这个世界及开场最契合的、具体的身份】——本地人、过客、学徒、旧识、来办事的、逃出来的、迷路的……都可以，判断标准只有一个：这个身份放进你创造的世界里是否"自然成立"。外来者只是众多可能之一（且只在真正合适时才是答案），禁止使用"初来乍到/身份留白/待定"这类空泛占位。必须写进 player{name,identity}，其中 identity 用一句话说清"我是谁、我为什么在这里、我对这里熟不熟"；可加 age/role/appearance/backstory/secret 让"我"更立体。';
  return AI.withCharter([
    '你是【世界模拟器】的世界生成器。请从零创造【一个完整的、崭新的世界】。',
    '不要模仿、套用或参考任何已有的故事、游戏、设定模板——世界可以是你想象的任何样子：古代/现代/未来/修仙/志怪/末世/星际/奇幻/蒸汽/克苏鲁/荒诞派……全由你判断，只要让它自己自洽。',
    '世界要有呼吸：一个地方 + 一个以上鲜明的人 + 你作为初来乍到者，且要有"这里为什么安静/嘈杂/奇怪"的一层氛围。可以是一个大世界的切面（王朝的一角、都市的一隅、星际的小站、宇宙的尽头都可以）。',
    '【一句话指令】用户在发起时给出了一句创作指令（也可能没有）。指令里提到的一切时代/地点/氛围/人物/冲突/玩家身份，都必须原样成立；没有提到的部分由你按自洽补全。指令只是世界的第一条线索，不是全部限制，也不是都要用。',
    '【未注明=自由补全】除用户指令与下面规则之外的一切世界细节（物价/作息/天气规律/邻里关系/小风俗/人物习惯），由你自由推测补全，只要与你的世界自洽即可；不需要为每个细节立规则，也没人会替你改。',
    '【冲突规则 · 核心】世界是主体，玩家的设定不能凌驾于世界之上：如果用户指令或 User 设定与你选择的世界类型冲突（例如"修仙者"+现实世界），你有三条路：① 直接按世界拒绝（世界没有灵气，玩家就是普通人）；② 用户从指令中显式给了"穿越/天降/系统/重生"之类的桥，则允许，并把桥写进世界规则；③ 其他情况（如"赛博朋克+2019 末年"，这是相容的）——直接相容。绝不为了迁就玩家而破坏世界自洽性。',
    '【语言强制】无论你的倾向，整个世界包必须用中文输出：世界名、人物名（取中文名）、地点名、开场白、种子、规则全部中文；注释与说明无。',
    '输出 JSON 字段（结构为协议，内容完全自由）：meta{name,era,carries按时代,currency(货币名,按世界语境;金额要配得上其购买力:现代日本→"日元",韩国→"韩元",古代→"文",修真→"灵石"),artStyle(画风约束:水墨古风/冷调赛博/暖日式/废土粗粝等，按世界基调)}, time(格式如 2026-05-21T20:45:00), weather, player{name, age, identity, origin(来历一句话), appearance(样貌), personality(表面性格), inner(内心), ability, desire, secret, wealth(揭不开锅|普通|小康|富裕|财力雄厚——按身份语义选一，禁止照字面猜), money(可选:{cash,digital,按wealth与时代给合理数字}), skills[2-3个技能/经验], shadows(可选0-2条:{hint:隐约记得的一句话, text:想起来时的完整内容, triggers:[2-3个触发词]})}, npcs[至少1个：name,surface,hidden,appearance(外观用刚性锚点九维度写（分号分隔）：①脸型与年龄感（视觉标签+脸型轮廓+三庭比例≈1:1:1）②眉眼与瞳孔（眼型+眼裂长宽比+眼距比+眼尾+瞳色+眉型）③鼻子与嘴唇（鼻型+鼻宽比+唇型+上下唇比+唇色）④肤色与肤质（暖白/冷白/蜜色+色号+肤质）⑤体型（身高+头身比+肩型+体型）⑥发型与发色（长度+刘海/发际线+发色）⑦衣着与配饰（品类+材质+款式；无写无）⑧永久标记（痣/疤痕/纹身+位置；无写无）；比例用≈相对关系，禁文学形容词),desire,role,workFrom,workTo,inScene], places[3含开场地，edges用minutes], firstScene（1-3句，有画面），seeds[2], rules[2]。',
    '【人物一致性】firstScene 与 seeds 里出现的任何人物，都必须来自 npcs 列表（用 npcs 里的名字和称谓），禁止提到 npcs 之外的人物；npcs 里的每个人要有可区分的 name 与 appearance（不要两个 NPC 长得像/重名）。inScene:true 的 NPC 才是开场时在开场的，其余 NPC 不应出现在 firstScene。',
    '【玩家身世 · 关键】玩家的身份/来历/样貌/性格/本领/愿望必须给具体完整内容，禁止"身份待定/初来乍到/随缘"等空泛占位——游戏开局玩家就要清清楚楚知道自己是谁、为什么在这里。玩家现在明白的一切放进 player 字段；存在但还没想起来的旧事/渊源放进 shadows，剧情提到时才想起来。',
    selfLine,
    '不要输出 JSON 之外的文字。'
  ].join(String.fromCharCode(10)));
}

async function genWorldPack(cfg, prompt, userSet) {
  if (AI.isLive(cfg)) {
    // 接入模式：AI 真正生成；失败必须显式报错，绝不回退本地组合器
    const pack = await AI.llmJSONDeep(cfg, [
      { role: 'system', content: worldGenSystem(userSet) },
      { role: 'user', content: prompt ? ('玩家想要这样的世界：' + prompt + '。请从零创造。') : '从零创造吧。' }
    ], null, AI.cfgMax(cfg));
    if (pack && pack.meta && pack.npcs && pack.places) return { pack, mode: 'llm' };
    throw new Error('AI 返回的世界包不完整（缺 meta/npcs/places）');
  }
  return { pack: randomPack(prompt), mode: 'demo-random' };
}

// ---------- 设定核对：User 设定 vs 世界（以世界为准） ----------
// v1.57：+ voice（语域/说话方式，含口癖、爆粗习惯）—— 见《设计总稿.md》§29.2
const SELF_FIELDS = ['name', 'age', 'role', 'identity', 'ability', 'appearance', 'backstory', 'voice', 'note'];
function selfPresent(us) {
  if (!us) return false;
  return SELF_FIELDS.some(f => (us[f] || '').toString().trim());
}
const CULT_WORDS = /修仙|仙师|修真|灵气|御剑|金丹|元婴|飞升|法术|法力|功法|炼气|剑修|仙门|双修|渡劫|斗气|魔法|魔力|巫术|灵力|真气/;
const BRIDGE_WORDS = /穿越|天降|重生|转世|系统|快穿|夺舍|灵魂|梦入|异界|平行世界|时空|封印|师从|师承|祖传|家族|天生|传人/;
const TECH_WORDS = /手机|微信|网络|互联网|电脑|外卖|扫描|码支付|wifi|WiFi|5G/;

// 启发式核对（无 AI 的最简版：修仙能力 vs 世界基调 / 现代工具 vs 无表世界）
function heuristicCheck(pack, us) {
  const issues = [];
  if (!selfPresent(us)) {
    return { status: 'pass', issues: [], note: '未提供玩家设定（按世界默认生成）' };
  }
  const all = SELF_FIELDS.map(f => (us[f] || '')).join(' ');
  const era = ((pack.meta || {}).era || '');
  const carries = ((pack.meta || {}).carries || {});
  const hasPhone = carries.time === 'phone' || /现代|星际|赛博/.test(era);
  const isCultWorld = /修|仙|志怪|奇幻|魔法/.test(era);
  const isModern = /现代|都市|星际|赛博|2026|二十|九零|九十/.test(era);
  const hasCult = CULT_WORDS.test(all);
  const hasBridge = BRIDGE_WORDS.test(all);
  const hasTech = TECH_WORDS.test(all);

  if (hasCult && !isCultWorld && !isModern) {
    // 古风世界无修（无灵气世界），修仙设定=冲突（除非有桥）
    issues.push({
      point: '能力/力量设定', verdict: hasBridge ? '需补桥' : '冲突',
      advice: hasBridge ? '检测到穿越类设定——按"此界无灵气，你空有记忆没有力量，或力量被世界规则压制"处理，写进世界规则。' : '这个世界没有灵气——你无法施展修仙之力。三个选择：改设定 / 补一个自洽的桥（如穿越）/ 接受降级（按普通人行动）。'
    });
  } else if (hasCult && isModern && !isCultWorld) {
    // 现代都市 + 修仙 = 冲突（无桥）/ 需补桥（有桥）
    issues.push({
      point: '能力/力量设定', verdict: hasBridge ? '需补桥' : '冲突',
      advice: hasBridge ? '检测到穿越/天降类桥——按"灵气稀薄、法术时灵时不灵、不能暴露"处理，写进世界规则。' : '这个世界没有灵气——修仙之力无法成立。三个选择：改设定 / 补一个自洽的桥（如穿越）/ 接受降级（按普通人行动）。'
    });
  } else if (hasCult && isCultWorld) {
    issues.push({ point: '能力/力量设定', verdict: '通过', advice: '世界有灵气/超凡因子——与你的设定相容。' });
  }
  if (hasTech && !hasPhone && !isModern) {
    issues.push({
      point: '随身工具/身份设定', verdict: '冲突',
      advice: '这个世界没有手机/网络（载体：' + (carries.time || '未知') + '）——你的现代通讯设定无法成立。改设定，或接受"没有这些东西"的世界。'
    });
  }
  if (hasTech && hasPhone) {
    issues.push({ point: '随身工具/身份设定', verdict: '通过', advice: '世界有现代载体——与设定相容。' });
  }
  if (!issues.length) {
    issues.push({ point: '整体设定', verdict: '通过', advice: '与世界基调相容，未发现明显冲突。' });
  }
  const status = issues.some(i => i.verdict === '冲突') ? 'conflict' : (issues.some(i => i.verdict === '需补桥') ? 'bridge' : 'pass');
  return { status, issues };
}

// LLM 核对（接入模式）：给出更准的三档判定
function checkSystem() {
  return AI.withCharter([
    '你是【世界模拟器】的设定核对员。输入：一份世界包摘要 + 一份玩家自我设定（User 设定）。',
    '你的唯一任务：判断玩家设定能否在世界上成立，输出三档之一。世界是主体，玩家设定不能凌驾于世界之上。',
    '判定规则：',
    '  1. 相容（用例：现代→现代都市；古代人→古代市井；修仙者→修仙世界）→ verdict=通过。',
    '  2. 冲突但有自洽的桥（用例：修仙者 + 现实世界，但玩家写了"穿越/天降/系统/重生"）→ verdict=需补桥，advice 里写出桥怎么写进世界规则（例：灵气稀薄，法术时灵时不灵，不可暴露）。',
    '  3. 冲突且无可自洽的桥（用例：修仙者硬闯现实世界，没写穿越）→ verdict=冲突，advice 给出三个选项：改设定 / 补自洽的桥 / 接受降级（按普通人行动）。',
    '  4. 玩家的"年龄/姓名/性格/背景"等在世界上总能成立（除非与硬事实冲突如"灵族活了三百年"在无灵世界）——这些不算冲突。',
    '输出 JSON（不要多余文字）：{ "status": "pass或bridge或conflict", "issues": [ { "point": "设定点", "verdict": "通过或需补桥或冲突", "advice": "一句话说明并给出处理" } ] }'
  ].join(String.fromCharCode(10)));
}
async function checkSetup(pack, us, cfg) {
  if (!selfPresent(us)) return { status: 'pass', issues: [], note: '未提供玩家设定（按世界默认生成）' };
  if (AI.isLive(cfg)) {
    try {
      const sum = JSON.stringify({
        世界名: (pack.meta || {}).name, 时代: (pack.meta || {}).era,
        载体: (pack.meta || {}).carries,
        规则: (pack.rules || []).slice(0, 6),
        开场: String((pack.firstScene || '')).slice(0, 200)
      });
      const out = await AI.llmJSONDeep(cfg, [
        { role: 'system', content: checkSystem() },
        { role: 'user', content: '【世界包摘要】' + sum + '\n【玩家自我设定】' + JSON.stringify(us) }
      ], () => heuristicCheck(pack, us), AI.cfgMax(cfg));
      if (out && out.__fallback) return out.value;
      if (out && out.status && out.issues) return out;
    } catch (e) { /* 落回启发式 */ }
  }
  return heuristicCheck(pack, us);
}

module.exports = { worldGenSystem, userSelfText, randomPack, genWorldPack, checkSetup, heuristicCheck, POOL: ERAS };
