'use strict';
const IMP = require('../src/import');
// 尝试探测函数（不可直接访问）→ 通过 heuristicPack 观察
const c1 = IMP.heuristicPack({ name: '测试', description: '现代日本，东京的夜。', first_mes: '你在大阪的酒店醒来。' });
const c2 = IMP.heuristicPack({ name: '测试', description: '首尔江南区的公寓。', first_mes: '首尔的早晨。' });
const c3 = IMP.heuristicPack({ name: '测试', description: '中国小城。', first_mes: '你走进一家店。' });
const c4 = IMP.heuristicPack({ name: '测试', description: '武林小镇，钱庄与当铺。', first_mes: '雨天的客栈。' });
for (const [n, p] of [['日本', c1], ['首尔', c2], ['中国', c3], ['古代', c4]]) console.log(n, '→', p.meta.currency);
process.exit(0);
