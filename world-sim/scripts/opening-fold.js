'use strict';
// opening-fold.js — 长开场拆分验证（模拟用户的开场文本）
const IMP = require('../src/import');
const scene = [
  '幽蓝色的海水隔着整面弧形防弹玻璃缓缓荡漾，银色的鱼群像是被某种无形的漩涡牵引，在珊瑚礁上方盘旋。水下餐厅的穹顶折射出柔和的波光，光影斑驳地洒在柔软的天鹅绒地毯上。不远处的角落里，五名穿着纯白薄纱吊带裙的少女正聚在一起，她们看起来不过十二三岁，小小的手正拨弄着与她们体型极不相符的大提琴与竖琴，舒缓的肖邦夜曲在宽敞的餐厅内静静流淌。',
  '冰块"叮"的一声磕在水晶杯壁上。',
  '"主人。"清脆、甜腻，如同浸透了糖水般温柔的声音在身侧响起。莉莉静静地站在那里。一米六五的身高配上仅仅四十五公斤的体重，让她的骨架显得格外纤细，仿佛稍微用力触碰就会折断。作为一名白发的贴身侍从，她微微垂着眼，像是在等待你的任何指令。',
  '其余的五位少女也纷纷放下乐器，朝你的方向看了过来。与莉莉不同的是，她们的目光里混合着期待与畏惧，仿佛在等待着什么即将发生的事情。'
];
const card = { name: '深海餐厅', first_mes: scene.join('\n\n'), description: '主人与他的少女乐师们', personality: '殷勤' };
const pack = IMP.heuristicPack(card);
console.log('首帧(' + pack.firstScene.length + '字):', pack.firstScene.slice(0, 70) + '…');
console.log('种子:', JSON.stringify(pack.seeds));
const data = IMP.packToData(pack);
const first = (data.sceneLog.find(l => l.type === 'narration') || {});
console.log('世界首帧(' + first.text.length + '字):', first.text.slice(0, 60) + '…');
process.exit(0);
