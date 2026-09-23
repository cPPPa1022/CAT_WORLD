'use strict';
// scene-check.js — 验证启发式扫描的场景推断（芭蕾卡→练功房；恋爱卡→教室系）
const fs = require('node:fs');
const path = require('node:path');
const IMP = require('../src/import');
(async () => {
  const dir = path.join(process.env.USERPROFILE || 'C:\\Users\\qwe', 'Desktop', '角色卡');
  for (const f of ['0.85.png', '07c8904ab2ccb380.png']) {
    const card = IMP.parseSource('png', fs.readFileSync(path.join(dir, f)).toString('base64'));
    const pack = IMP.heuristicPack(card);
    console.log(f, '→', (pack.places || []).slice(0, 4).map(p => p.name).join(' / '));
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });
