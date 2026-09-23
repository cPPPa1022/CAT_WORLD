'use strict';
const fs = require('fs');
const path = require('path');
function scanDir(dir, label) {
  if (!fs.existsSync(dir)) { console.log(label + ': (无目录)'); return; }
  const cards = path.join(dir, 'cards');
  if (fs.existsSync(cards)) {
    const fs2 = fs.readdirSync(cards).filter(f => f.endsWith('.json'));
    let anchored = 0;
    for (const f of fs2) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(cards, f), 'utf8'));
        const npcs = (j.pack && j.pack.npcs) || [];
        const good = npcs.some(n => n.appearance && !/原设|待发现|还没看清/.test(String(n.appearance)));
        if (good) anchored++;
      } catch (e) { }
    }
    console.log(label + ' 卡盒: ' + fs2.length + ' 张；有可用外貌锚点 ' + anchored + ' 张');
  }
  const worlds = path.join(dir, 'worlds');
  if (fs.existsSync(worlds)) {
    const ws = fs.readdirSync(worlds).filter(f => f.endsWith('.json'));
    let anchored = 0, total = 0;
    for (const f of ws) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(worlds, f), 'utf8'));
        const ppl = Object.values(j.entities || {}).filter(e => e.type === 'person');
        total += ppl.length;
        const good = ppl.some(p => p.profile && p.profile.visual && p.profile.visual.anchor && !/原设/.test(String(p.profile.visual.anchor)));
        if (good) anchored++;
      } catch (e) { }
    }
    console.log(label + ' 世界存档: ' + ws.length + ' 个；含锚点人物档案 ' + anchored + ' (共 ' + total + ' 人)');
  }
}
scanDir(process.argv[2] || path.join(process.env.APPDATA || 'C:\\Users\\qwe\\AppData\\Roaming', 'world-sim', 'data'), '桌面版');
scanDir(path.join(__dirname, '..', 'data'), '开发版');
