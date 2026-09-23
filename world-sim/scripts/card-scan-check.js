// card-scan-check.js — 角色卡扫描红线（离线）
// 来源：用户实测卡「逍遥皇子模拟器」（231 条世界书 / 21.7 万字，description 为空）
// 扫出的结果：NPC 名字 = "萧承钧 头衔: 大昱王朝皇帝 种族/物种"，货币 = "美元"（大昱王朝！），
// 界面一句提示都没有。这三条各自钉一个断言。
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const IMP = require(path.join(ROOT, 'src', 'import'));

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✔', m)) : (fail++, console.log('  ✘ FAIL:', m)); };

// 造一张"世界书型卡"：description 空，内容全在 231 条世界书里（结构照抄用户那张）
function worldbookHeavyCard() {
  const entries = [];
  for (let i = 0; i < 231; i++) {
    entries.push({
      keys: i % 2 ? ['皇帝', '陛下'] : [],
      comment: '帝国之主：昱帝·萧承钧' + (i ? '_' + i : ''),
      content: '萧承钧 头衔: 大昱王朝皇帝\n种族/物种 | 人类\n支持度: 95\n主角后宫: {}\n夺嫡进程: 天子的试炼\n' + '大昱王朝，承平二十三年。皇帝、皇后、贵妃、皇子、丞相、首辅、尚书、衙门、后宫、朝堂、科举。'.repeat(3)
    });
  }
  return {
    name: '逍遥皇子模拟器', description: '', personality: '', scenario: '', first_mes: '', mes_example: '',
    character_book: { entries: entries }, characters: []
  };
}

const card = worldbookHeavyCard();
const pack = IMP.heuristicPack(card);

// [1] 人物名字不许是"属性栏"（含冒号/数字/字段名的都要被拦掉）
{
  const bad = (pack.npcs || []).map(n => String(n.name || '')).filter(n => /[:：|｜0-9]/.test(n) || /头衔|种族|物种|支持度|后宫|进程/.test(n));
  ok(bad.length === 0, 'NPC 名字不是属性栏（实测：' + JSON.stringify((pack.npcs || []).map(n => n.name)) + '）');
}

// [2] 古代卡不许被判成"美元"（旧 bug：卡里的 AI 提示词模板含 $(IN ENGLISH…) 就中招）
{
  ok(pack.meta.currency !== '美元', '大昱王朝的卡不用"美元"结算（实测：' + pack.meta.currency + '）');
  ok(pack.meta.era === '古代', '时代判定为古代（实测：' + pack.meta.era + '）');
  // 直接钉 detectCurrency 的关键行为
  const noisy = '萧承钧 头衔: 大昱王朝皇帝 <Analysis>$(IN ENGLISH, no more than 80 words)</Analysis> ' + '皇帝 王朝 皇子 皇后 贵妃 丞相 首辅'.repeat(3);
  ok(IMP.heuristicPack({ name: 'x', description: noisy, character_book: null }).meta.currency !== '美元',
    '文本里混着 $ 符号的古代卡，也不会被判成美元');
}

// [3] 世界书型卡必须给出可读警告（界面才能告诉玩家"建议接模型重扫"）
{
  const w = pack.__warnings || [];
  ok(w.length >= 1, '世界书型卡给出警告（实测 ' + w.length + ' 条）');
  ok(w.some(x => /世界书|模型|重新导入/.test(x)), '警告里明确提到"主体在世界书里 / 建议接模型重扫"：' + JSON.stringify(w[0] || '').slice(0, 90));
}

// [4] 正常卡（字段齐全）不该被误报
{
  const normal = {
    name: '青石镇小店', description: '九十年代小镇的杂货铺，沈姨守着铺子。'.repeat(20),
    personality: '嘴上不饶人，心软', scenario: '你来店里买东西', first_mes: '雨下了一整天，你推门进去。'.repeat(5),
    character_book: null, characters: []
  };
  const p2 = IMP.heuristicPack(normal);
  ok((p2.__warnings || []).length <= 1, '字段齐全的普通卡不会被误报（实测 ' + (p2.__warnings || []).length + ' 条警告）');
}

// ─────────────────────────────────────────────────────────────────────────────
// [5] ★ v3.4 卡的身份证（用户原话：「相当于给这个卡颁发一个身份证」）
//   为什么要有它：世界是按回合滚动的，AI 每回合只看得到近况。**没有这一行，世界会漂** ——
//   一张围绕隔壁人妻的卡，跑十回合后会变成"小镇日常生活"，卡里那个"戏"就散了。
//   为什么断言里要钉"必须排最前面"：实测用户那张「东北萝莉」卡的分析稿 5876 字，
//   写到第四段（§四 每个人的已知与空白）就被输出上限截断 —— §一/§五/§六/§七 一个字都没产出，
//   而"这张卡是围绕什么打的"正是全世界最需要的那一句。
{
  const AI = require(path.join(ROOT, 'src', 'ai'));
  const C = require(path.join(ROOT, 'src', 'contract'));
  const WB = require(path.join(ROOT, 'src', 'world'));

  const good = [
    '## ★ 零、先给这张卡发一张身份证',
    '题材：NTL / 出轨 / 日常 / 养成',
    '戏：隔壁搬来的年轻夫妻与主角之间的越界张力；推动它的是主角的欲望和她的将就。',
    '调性：日常、压抑里带一点暖；没有超自然。',
    '不是什么：不是纯日常温情卡，也不是战斗卡。',
    '',
    '## 一、这是个什么世界',
    '九十年代东北农村……（后面是几千字的长枚举）'
  ].join(String.fromCharCode(10));
  /* 真机实测（2026-09-24，"隔壁/ NTL" 那张卡）：模型**没写标题**，直接把四行放在最前面。
     所以判据必须是"首行就是字段"，不是"标题里有没有『身份证』" —— 我第一版按标题判，被这次实测打脸。 */
  const realShape = '题材：九十年代 / 南方小城 / 市井日常 / 婚外情 / 邻家禁忌' + String.fromCharCode(10)
    + '戏：丈夫常年出车，苏晚的寂寞与陈默的旧伤互相牵引，巷中闲话逼出越界。' + String.fromCharCode(10)
    + '调性：潮湿暧昧的年代日常，缓慢升温，写实无超自然。' + String.fromCharCode(10)
    + '不是什么：不是战斗卡 / 不是超自然卡 / 不是纯邻里温情卡' + String.fromCharCode(10) + String.fromCharCode(10) + '## 一、这是个什么世界' + String.fromCharCode(10) + '九十年代……';
  const realIdn = IMP.parseIdentity(realShape);
  ok(!!realIdn && /婚外情/.test(realIdn['题材']) && /不是战斗卡/.test(realIdn['不是什么']),
    '★ 真机输出的形状（**没有标题**、四行直接打头）也摘得到：题材=' + (realIdn ? realIdn['题材'] : 'null'));

  const idn = IMP.parseIdentity(good);
  ok(!!idn && idn['题材'].indexOf('NTL') >= 0 && idn['戏'].length > 8, '★ 能从分析稿里摘出身份证（题材=' + (idn ? idn['题材'] : 'null') + '）');

  /* ★ 这条把"必须排第一"钉死：长枚举会吃光配额，排到后面就等于没有 */
  const late = '长枚举'.repeat(700) + String.fromCharCode(10) + '题材：NTL' + String.fromCharCode(10) + '戏：隔壁那家人' + String.fromCharCode(10) + '调性：日常' + String.fromCharCode(10) + '不是什么：不是战斗卡';
  ok(IMP.parseIdentity(late) === null, '★ 身份证排在长枚举之后（>1500 字）-> 摘不到（这就是它必须第一个到达的理由）');
  ok(IMP.parseIdentity('题材：NTL / 出轨' + String.fromCharCode(10) + '调性：日常，无超自然' + String.fromCharCode(10) + '不是什么：不是战斗卡') === null, '★ 缺了一行（戏）-> null：宁可不发身份证，也不发半张');
  ok(IMP.parseIdentity('题材：……' + String.fromCharCode(10) + '戏：……' + String.fromCharCode(10) + '调性：……' + String.fromCharCode(10) + '不是什么：……') === null, '★ 模型把模板里的「……」照抄下来 -> 拒（值太短）');
  const longOne = IMP.parseIdentity('题材：NTL / 出轨' + String.fromCharCode(10) + '戏：' + '啊'.repeat(200) + String.fromCharCode(10) + '调性：日常' + String.fromCharCode(10) + '不是什么：不是战斗卡');
  ok(longOne && longOne['戏'].length === C.IDENTITY_LEN, '超长的行被夹到 IDENTITY_LEN=' + C.IDENTITY_LEN + ' 字（它是每回合都带着走的一行）');
  ok(IMP.normIdentity(null) === null && IMP.normIdentity({ 题材: 'x' }) === null, 'normIdentity：非对象 / 半张 -> null');

  /* 拒答识别（真机实测：用户那张卡模型回了 522 字拒信「这张卡我不能分析…」）
     —— 拒信原来会被当成「先一步的分析稿 · 必须遵守」喂给第二步去建世界。 */
  const refusal = '这张卡我不能分析。' + String.fromCharCode(10) + '原因很直接：卡的核心设定涉及未成年角色。无论包装成"世界模拟"还是"叙事主权"，这条线不移动。'.repeat(3);
  ok(IMP.looksLikeRefusal(refusal) === true, '★ 拒答文本 -> 认出来（不再当成"必须遵守的分析稿"喂给第二步）');
  ok(IMP.looksLikeRefusal(good) === false, '正常分析稿不会被误判成拒答');
  ok(IMP.looksLikeRefusal('我不能离开这个地方。' + '正文'.repeat(500)) === false, '长篇正文里出现"我不能"不会被误判（拒答的判据要看长度）');

  /* 落库 */
  const smallCard = { name: '测试卡', description: '隔壁搬来一家人。'.repeat(12), personality: '', scenario: '', first_mes: '门开了。', character_book: null, characters: [] };
  const pk = IMP.heuristicPack(smallCard);
  ok(!('identity' in pk.meta), '启发式兜底（没跑 AI）本来就没有身份证');
  const d0 = IMP.packToData(pk, { greeting: 0 });
  ok(!('identity' in (d0.meta || {})), '没有身份证时 data.meta 里**连这个键都没有**（不是 null 占位）');
  pk.meta.identity = idn;
  const d1 = IMP.packToData(IMP.heuristicPack(smallCard), { greeting: 0 });
  const pk2 = IMP.heuristicPack(smallCard); pk2.meta.identity = idn;
  const d2 = IMP.packToData(pk2, { greeting: 0 });
  ok(d2.meta.identity && d2.meta.identity['戏'] === idn['戏'] && (d1.meta.identity === undefined), '★ packToData 把身份证落进 data.meta.identity');

  /* 注入：进 system（前缀缓存），不进资料包；边界必须写在同一行里 */
  const demo = WB.buildDemoWorld();
  const sysNo = String(AI.SYSTEM(demo, { llm: {} }) || '');
  ok(sysNo.indexOf('【这出戏】') < 0, '★ 老存档没有 meta.identity -> 提示词里没有那一行（退化不崩，不是空行）');
  demo.meta.identity = idn;
  const sysYes = String(AI.SYSTEM(demo, { llm: {} }) || '');
  ok(sysYes.indexOf('【这出戏】') >= 0 && sysYes.indexOf('NTL') >= 0, '★ 有身份证 -> 题材/戏/调性/不是什么 四行都进 system');
  const seg = sysYes.slice(sysYes.indexOf('【这出戏】'), sysYes.indexOf('【这出戏】') + 420);
  ok(/不规定下一步该演什么/.test(seg), '★ 同一行里写死了边界：定调 != 剧情大纲（不写就会退化成任务系统）');
  ok(!/任务|目标：|必须推进/.test(seg), '★ 那一行里不许出现"任务/目标"这类引擎话');
}

console.log('\n==== card-scan-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
