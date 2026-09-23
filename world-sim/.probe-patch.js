'use strict';
const fs = require('node:fs'), path = require('node:path');
const ROOT = "D:\\AI项目库\\小猫的世界\\.tmp-ui2";
const hits = [];
(function walk(d, dep) {
  if (dep > 4) return;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, dep + 1);
    else if (e.name.endsWith('.json') && d.endsWith('worlds')) hits.push(p);
  }
})(ROOT, 0);
hits.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
console.log('候选世界文件: ' + hits.map(h => path.basename(h)).join(', '));
const fp = hits[0];
const w = JSON.parse(fs.readFileSync(fp, 'utf8'));
w.current.suggestions = [
  '那七块二，我兜里应该够',
  '先掏钱，还是先说句软话',
  '她刚那手，是去够烟了吧',
  '阿岩蹲那儿半天，不嫌腿麻',
  '上周五那句话，还搁在这儿呢',
  '雨不停，今晚二八大杠又得推回去'
];
w.sceneLog = (w.sceneLog || []).concat([
  { t: w.current.time, type: 'outcome', text: '你买好了两包红塔山——十四块四，柜台上找了零。' },
  { t: w.current.time, type: 'action', actorName: '沈姨', text: '她把手在围裙上擦了擦，往柜台底下摸零钱。' },
  { t: w.current.time, type: 'dialogue', speakerName: '沈姨', text: '零钱在底下那个铁盒里，自己拿。' }
]);
fs.writeFileSync(fp, JSON.stringify(w, null, 1), 'utf8');
console.log('已改: ' + path.basename(fp) + ' → ' + w.current.suggestions.length + ' 条念头 + 结果行 + 一句台词');
