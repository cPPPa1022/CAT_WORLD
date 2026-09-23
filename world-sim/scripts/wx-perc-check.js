'use strict';
const RT = require('../src/runtime');
const mk = (place, weather, seen) => {
  const data = { current: { sceneId: 's1', weather, weatherSeen: !!seen, weatherVia: seen ? 'sight' : undefined }, entities: { s1: place } };
  return RT.perceiveWeather(data, '2026-05-21T20:00:00');
};
const sealed = { name: '卧室', tags: ['室内'], features: [] };
const windowed = { name: '客厅', tags: ['室内'], features: ['窗'] };
const curtain = { name: '大厅', tags: ['室内'], features: ['窗', '窗帘拉上'] };
for (const [label, d] of [
  ['卧室+雷阵雨', mk(sealed, '雷阵雨')],
  ['卧室+暴雨', mk(sealed, '暴雨')],
  ['卧室+小雨', mk(sealed, '小雨')],
  ['客厅(有窗)+雷阵雨', mk(windowed, '雷阵雨')],
  ['客厅(窗帘拉上)+雷阵雨', mk(curtain, '雷阵雨')],
  ['卧室+暴雨+看过窗外', mk(sealed, '暴雨', true)]
]) {
  const w = d;
  console.log(label.padEnd(24) + '→ via=' + w.via + ' heard=' + !!w.heard + ' seen=' + !!w.seen + ' | ' + String(w.text).slice(0, 30));
}
process.exit(0);
