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

console.log('\n==== card-scan-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
