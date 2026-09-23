'use strict';
const IMP = require('../src/import');
const mk = (card, player) => {
  const c = { name: '测试', description: '小城', first_mes: '你走进一家店。' };
  Object.assign(c, card || {});
  const pack = IMP.heuristicPack(c);
  pack.player = Object.assign({}, pack.player, player || {});
  return IMP.packToData(pack);
};
const cases = [
  ['日元富二代', { description: '现代日本，东京的夜。', first_mes: '你在大阪的酒店醒来。' }, { wealth: '财力雄厚' }],
  ['韩元普通', { description: '首尔江南区的公寓。', first_mes: '首尔的早晨。' }, { wealth: '普通' }],
  ['人民币富二代', { description: '中国小城。', first_mes: '你走进一家店。' }, { wealth: '财力雄厚' }],
  ['古代普通', { description: '武林小镇，钱庄与当铺。', first_mes: '雨天的客栈。' }, { wealth: '普通' }],
  ['修真普通人', { description: '修仙门派的杂役弟子。', first_mes: '山门前。' }, {}]
];
for (const [n, card, pl] of cases) {
  const d = mk(card, pl);
  const m = d.entities.player.money;
  console.log(n.padEnd(12) + '→ ' + (d.meta.currency || '?') + ' cash=' + m.cash + ' digital=' + (m.digital || 0) + ' (一碗面≈' + (m.cash > 0 ? Math.round(m.cash / Math.max(1, m.cash / (m.cash / 100))) : '?') + ')');
}
process.exit(0);
