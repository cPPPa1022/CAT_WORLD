'use strict';
const fs = require('node:fs'), path = require('node:path');
const B = 'http://127.0.0.1:3911';
const DIR = path.join("D:\\AI项目库\\小猫的世界\\.tmp-ui2", 'data', 'worlds');
const post = (p, b) => fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(r => r.json());
(async () => {
  const d = await post('/api/demo', {});
  console.log('建了演示世界: ' + (d.view && d.view.place ? d.view.place.name : '?'));
  const t1 = await post('/api/turn', { text: '你好' });   // 跑一回合：世界才会落盘
  console.log('回合跑完，地点=' + ((t1.view || {}).place || {}).name);
  await post('/api/quit', {});
  await new Promise(r => setTimeout(r, 1500));
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json'));
  console.log('世界文件: ' + files.join(', '));
  const fp = path.join(DIR, files[0]);
  const w = JSON.parse(fs.readFileSync(fp, 'utf8'));
  /* 注入念头：真实 AI 会给 6 条第一人称的念头，这里手工放 6 条最像真机的 */
  w.current.suggestions = [
    '那七块二，我兜里应该够',
    '先掏钱，还是先说句软话',
    '她刚那手，是去够烟了吧',
    '阿岩蹲那儿半天，不嫌腿麻',
    '上周五那句话，还搁在这儿呢',
    '雨不停，今晚二八大杠又得推回去'
  ];
  /* 再放一条结果行，验它新拿到的层级（原来和"他皱了皱眉"同色） */
  w.sceneLog = (w.sceneLog || []).concat([
    { t: w.current.time, type: 'outcome', text: '你买好了两包红塔山——十四块四，柜台上找了零。' },
    { t: w.current.time, type: 'action', actorName: '沈姨', text: '她把手在围裙上擦了擦，往柜台底下摸零钱。' }
  ]);
  fs.writeFileSync(fp, JSON.stringify(w, null, 1), 'utf8');
  console.log('已注入 ' + w.current.suggestions.length + ' 条念头 + 1 条结果行');
})().catch(e => { console.error('★ ' + (e && e.stack || e)); process.exitCode = 1; });
