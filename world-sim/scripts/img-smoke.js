'use strict';
// img-smoke.js — 生图链路冒烟：演示世界九维/无锚点降级/rulePrompt/图进叙事流定位
const WORLDS = require('../src/world');  // 演示世界构造
const VIS = require('../src/visual');
const G = require('../src/game');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔', m); } else { fail++; console.log('  ✘ FAIL:', m); } };

async function main() {
  const data = WORLDS.buildDemoWorld();
  data.id = (p) => p + '_' + Math.random().toString(36).slice(2, 8);
  console.log('== 1. 演示世界九维档案 ==');
  for (const id of ['npc_1', 'npc_2', 'player']) {
    const v = VIS.whoFace((data.entities[id] || {}).profile.visual, data.meta);
    ok(v.hasFace === true, id + ' 有九维（dims=' + v.dims + '）');
  }
  console.log('== 2. 无锚点降级（启发式导入的占位锚点） ==');
  const pv = VIS.normVisual({ anchor: '（来自卡的原设）', nine: {}, dynamic: {} }, {});
  ok(VIS.faceUsable(pv) === false, '占位锚点不视为人貌');
  const pv2 = VIS.normVisual({ anchor: '旧旅行包，风尘仆仆', nine: {}, dynamic: {} }, {});
  ok(VIS.faceUsable(pv2) === false, '标志物级锚点不视为人貌');
  console.log('== 3. rulePrompt 装配（模拟 SCHED 内部） ==');
  const pack = {
    whoInfo: [
      { id: 'npc_1', hasFace: true, face: VIS.nineText(VIS.normVisual(data.entities.npc_1.profile.visual)) },
      { id: 'npc_2', hasFace: true, face: VIS.nineText(VIS.normVisual(data.entities.npc_2.profile.visual)) }
    ],
    state: '不耐烦，抱臂', scene: '转角杂货铺', note: '雨天，货架前', style: ''
  };
  const prompt = pack.whoInfo.filter(w => w.hasFace).map(w => w.face).join('，') + '，' + pack.state + '，' + pack.scene + '；' + pack.note;
  ok(prompt.indexOf('沈姨') < 0 && prompt.indexOf('阿岩') < 0, '提示词无角色名（只外貌）');
  ok(prompt.indexOf('鹅蛋脸') >= 0 || prompt.indexOf('三庭') >= 0, '提示词含九维人貌');
  console.log('  样本:', prompt.slice(0, 90) + '…');
  console.log('== 4. 图进叙事流（buildView imgs 定位） ==');
  // 模拟 runTurn 后的状态：imgTasks + _imgBeatSpan + sceneLog
  const spanStart = data.sceneLog.length;
  data.sceneLog.push({ t: data.current.time, type: 'stage-tag', text: '[转角杂货铺 · 夜晚]' });
  const beats = [
    { type: 'narration', text: '沈姨看了你一眼。' },
    { type: 'dialogue', speaker: 'npc_1', text: '这么晚还来？' },
    { type: 'action', text: '她往火炉里添了块炭。' }
  ];
  for (const b of beats) data.sceneLog.push(Object.assign({ t: data.current.time }, b));
  data.current._imgBeatSpan = { start: spanStart + 1, count: beats.length, t: data.current.time };
  const imgTasks = samples => [
    // v1.88：任务必须带 t（真实生产端一定带；buildView 靠 t 判断"这条图属于哪一回合"，防跨回合串图）
    { id: 'img_a', at: 0, who: ['npc_1'], status: 'done', note: '摊位前', ai: { sceneTitle: '沈姨抬眼' }, t: data.current.time },
    { id: 'img_b', at: 2, who: ['npc_1'], status: 'prompted', note: '添炭', ai: null, t: data.current.time }
  ];
  data.current.imgTasks = imgTasks();
  const view = G.buildView(data);
  const sl = view.sceneLog;
  const withA = sl.find(x => x.imgs && x.imgs.indexOf('img_a') >= 0);
  const withB = sl.find(x => x.imgs && x.imgs.indexOf('img_b') >= 0);
  ok(!!withA && withA.text.indexOf('看了你') >= 0, 'img_a 挂在 beat0（' + (withA ? withA.text.slice(0, 16) : '无') + '）');
  ok(!!withB && withB.text.indexOf('添') >= 0, 'img_b 挂在 beat2');
  const taskFields = view.imgTasks.find(t => t.id === 'img_a');
  ok(taskFields && taskFields.at === 0 && taskFields.title === '沈姨抬眼', 'imgTasks 视图带 at/title');
  console.log('');
  console.log('PASS ' + pass + ' / FAIL ' + fail);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('冒烟崩溃:', e); process.exit(2); });