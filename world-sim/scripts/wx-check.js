'use strict';
const PRES = require('../src/presentation');
const cases = [
  ['小雨', '室内'], ['暴雨', ''], ['雷阵雨', ''], ['台风', ''], ['龙卷风', ''],
  ['大雪', ''], ['雾', ''], ['晴', ''], ['多云', ''], ['阴', ''], ['高温', ''], ['未知字', '']
];
for (const [w, place] of cases) {
  const fx = PRES.weatherFx(w, place === '室内');
  console.log(w.padEnd(4) + ' → ' + fx.kind.padEnd(12) + (fx.mute ? ' [mute] ' : ' ') + (fx.note || ''));
}
process.exit(0);
