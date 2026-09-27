'use strict';
/* story-flow-check.js — 「一场戏怎么连起来」的四条红线（v3.8）
 *
 * 为什么要有它（用户 2026-09-27 连着报的四件事）：
 *   ① 「这样看来不能以散文的形式了 需要阅读前x轮的内容以确保剧情连贯性」 —— 回读窗口原来只有 24 条**条目**（≈2~3 回合）。
 *   ② 「漏到正文的你改一下」 —— firstScene 第一句是「情景推演：…」，那是扫描模板里的说明被抄回来了。
 *   ③ 「认识的 像旧识 会记不住脸吗？…陈思思…不符合逻辑」 —— 关系判定的两个病：
 *      强制六选一（把卡里真实的关系挤没了）+ 「不在场 ⇒ 一律只见过」（把熟人写成陌生人）。
 *   ④ 「玩家说什么 和 做什么 需要 ai 去合理化的补全…猜测玩家的意图」 —— 一行字要能被补成一场戏。
 *
 * 用法：node scripts/story-flow-check.js（失败非零退出）。纯离线，0 token。
 */
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
process.env.WORLD_SIM_DATA = process.env.WORLD_SIM_DATA || path.join(os.tmpdir(), 'ws-story-' + process.pid);
process.env.WORLD_SIM_ASSETS = process.env.WORLD_SIM_ASSETS || ROOT;

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const AJ = read('src/ai.js');
const IMP = read('src/import.js');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  OK   ' + m)) : (fail++, console.log('  FAIL ' + m)); };

console.log('');
console.log('一场戏怎么连起来 · ① 回读窗口（按回合，不按条目）');
{
  ok(/function recentSceneEntries\(data, turns, cap\)/.test(AJ), 'recentSceneEntries(data, turns, cap) 在');
  ok(/最近场景原文: recentSceneEntries\(data, 4, 80\)/.test(AJ), '资料包那条走它（最近 4 回合 / 硬上限 80 条）');
  ok(!/最近场景原文: \(data\.sceneLog \|\| \[\]\)\.slice\(-24\)/.test(AJ), '旧的 slice(-24)**条目**窗口已经不在');
  const AI = require('../src/ai');
  /* 造一段日志：5 个回合，每回合 10 条 —— 旧的 24 条只会给到最后 2 个多回合 */
  const log = [];
  for (let t = 1; t <= 5; t++) {
    log.push({ type: 'stage-tag', text: '[屋 ' + t + ']' });
    log.push({ type: 'user-action', text: '你: 第' + t + '回合做什么' });
    for (let k = 0; k < 8; k++) log.push({ type: 'dialogue', text: '第' + t + '回合第' + k + '句' });
  }
  const win = AI.recentSceneEntries({ sceneLog: log }, 4, 80);
  ok(win.length === 40, '★ 5 回合 × 10 条 → 取最近 4 回合 = 40 条（实测 ' + win.length + '；旧的 24 条会取到 24）');
  ok(win[0].type === 'stage-tag' && String(win[0].text).indexOf('屋 2') >= 0,
    '窗口从第 2 回合的地点标签开始（含它，模型才知道那一场戏发生在哪儿）—— 实测 ' + JSON.stringify(win[0]));
  ok(win.some(x => String(x.text).indexOf('第2回合做什么') >= 0), '第 2 回合玩家那句话也在窗口里（不是从半截开始）');
  const oneTurn = AI.recentSceneEntries({ sceneLog: log.slice(0, 10) }, 4, 80);
  ok(oneTurn.length === 10, '回合数不够时**从头上取**（开局不能把开场原文切掉）—— 实测 ' + oneTurn.length);
  const huge = []; for (let i = 0; i < 300; i++) huge.push({ type: 'narration', text: 'x' + i });
  ok(AI.recentSceneEntries({ sceneLog: huge }, 4, 80).length === 80, '硬上限 80 条（长档不会把资料包撑爆）');
}

console.log('');
console.log('一场戏怎么连起来 · ② 提示词帽子不许漏进开场正文');
{
  ok(!/'\s*"firstScene": "情景推演/.test(IMP), '扫描模板里 firstScene 不再以「情景推演：」开头');
  ok(/【正文不许带帽子】/.test(IMP), '模板里明写了【正文不许带帽子】');
  ok(/function scrubSceneLeak\(t\)/.test(IMP), '输出侧有 scrubSceneLeak（白名单刮帽子）');
  ok(/pack\.firstScene = scrubSceneLeak\(pack\.firstScene\)/.test(IMP), '落库前会过一遍（不是只在提示词里求它）');
}

console.log('');
console.log('一场戏怎么连起来 · ③ 关系：AI 自己判 + 「认不认识」不由在场决定');
{
  ok(!/只能从这六个里选一个/.test(IMP), 'bond 不再是"只能从六个里选一个"（六个词降级成例子）');
  ok(/用你自己的话写，别为了套词而改掉卡里真实的关系/.test(IMP), 'bond 的说明改成"用你自己的话写"');
  const norm = IMP.replace(/\/\*[\s\S]*?\*\//g, ' ');
  ok(!/inScene \? stageOf : 1/.test(norm), '★ 代码里不再有「不在场 ⇒ stage 一律 1」这一票否决');
  ok(/stage: stageOf,/.test(IMP), '印象档 stage 由关系（stageFromBond）说了算');

  const I = require('../src/import');
  const mk = (bond, rel) => ({
    meta: { name: 'T', era: '九十年代' }, time: '1996-06-14T20:45:00', weather: '晴',
    player: { name: '你' },
    npcs: [ { id: 'npc1', name: '陈思思', bond: bond, rel: rel, inScene: false, atStart: 'p2', home: 'p2' },
            { id: 'npc2', name: '路人', bond: '初识', rel: '', inScene: false, atStart: 'p2', home: 'p2' } ],
    places: [ { id: 'p1', name: '屋里' }, { id: 'p2', name: '街上' } ],
    firstScene: '情景推演：1994年8月12日，星期五。屋外是三伏天。', rules: []
  });
  const d1 = I.packToData(mk('从小一块儿在河里摸鱼的玩伴兼军师', '玩伴兼军师'));
  ok(d1.impressions.npc1.stage >= 2, '★ 自由写的关系（「玩伴兼军师」）也判成"认识"（实测 stage=' + d1.impressions.npc1.stage + '）');
  ok(!!d1.impressions.npc1.nameKnown, '★ 她**不在场**（inScene 没填）也记得住名字 —— 这正是「陈思思会记不住脸吗」那一问');
  ok(d1.knowledge.knownPeople.indexOf('npc1') >= 0, '开局"认识的人"里就有她');
  ok(d1.impressions.npc2.stage === 1 && !d1.impressions.npc2.nameKnown, '真·初识的人仍旧是"只见过"（别把门控整个拆了）');
  ok(d1.knowledge.knownPeople.indexOf('npc2') < 0, '初识的人不进"认识的人"');
  const narration = (d1.sceneLog || []).find(x => x.type === 'narration') || {};
  ok(String(narration.text || '').indexOf('情景推演') < 0, '★ 开场正文里的「情景推演：」被刮掉了（实测开头：' + String(narration.text || '').slice(0, 16) + '）');
  ok(String(narration.text || '').indexOf('1994年8月12日') === 0, '刮完直接就是正文（不是把整段丢掉）');
  const d2 = I.packToData(Object.assign(mk('旧识', '发小'), { firstScene: '1994年8月12日，星期五。屋外是三伏天。' }));
  ok(String(((d2.sceneLog || []).find(x => x.type === 'narration') || {}).text || '') === '1994年8月12日，星期五。屋外是三伏天。', '正常的开头一个字都不动（白名单只刮已知帽子）');
}

console.log('');
console.log('一场戏怎么连起来 · ④ 玩家的一行字 = 意图');
{
  ok(/【玩家的一行字 = 意图，不是台词】/.test(AJ), 'system 里有这条（先判断是哪一种：台词 / 动作目标 / 混合）');
  ok(/去买包烟/.test(AJ) && /同一回合\*\*推到有结果/.test(AJ), '动作/目标要"在同一回合推到有结果"（举的例子就是用户说的买包烟）');
  ok(/中途失败也要给结果/.test(AJ), '失败也算结果（没货/关门/被拦）—— 不许"其实你没去"');
  ok(/不许把玩家的短句扩写成他\*\*没说过\*\*的新台词/.test(AJ), '补全的是过程与细节，不是替玩家改主意/编台词');
  ok(/【指令里的称呼】/.test(AJ) && /不要凭空造一个人出来/.test(AJ), '「和X说…」的 X 要对号入座，对不上不许造人');
  ok(/按意图补全/.test(AJ), '资料包里"本条行动"那一行也点明它是玩家原话');
}

console.log('');
console.log('一场戏怎么连起来 · ⑤ 长度与结束点（v3.14：写到玩家的选择点）');
{
  ok(/【这一段戏有多长】/.test(AJ) && /500~900 字/.test(AJ), '★ 给了长度目标（500~900 字）');
  ok(/少于 300 字算不合格/.test(AJ), '★ 给了下限（300 字）—— 用户原话「至少达到酒馆 300-800 字的水平」');
  ok(/【这一段戏结束在哪 · 推到玩家的选择点】/.test(AJ), '★ 收束点 = 玩家的选择点');
  ok(/先推测玩家想干什么/.test(AJ), '★ 先推测玩家意图再往下推（用户：「推测玩家的意图 推动剧情的发展」）');
  ok(/不要写成提问机/.test(AJ), '★ 不许变成提问机（一次只推到一个选择点，不出系统口气的问句）');
  ok(!/不要吊着玩家等决定/.test(AJ), '★ 旧的「不要吊着玩家等决定」已改掉（与这一版方针冲突的那半条）');
  ok(/世界留线/.test(AJ) && /世界里的事照旧可以没完/.test(AJ), '「世界留线」那半条保留（欠着的事可以没完）');
  ok(/8~16 条/.test(AJ) && !/beats 4~10 条/.test(AJ), 'beats 条数跟着长度上调（8~16），两处指导不再打架');
  ok(/绝对禁止替玩家写下一句台词/.test(AJ), '★ 但不许替玩家写台词（推测意图 ≠ 代写台词）');
  ok(/一条 narration 可以是一整段/.test(AJ), '允许一条 narration 写一整段（不然凑不出字数）');
}

console.log('');
console.log('==== story-flow-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
