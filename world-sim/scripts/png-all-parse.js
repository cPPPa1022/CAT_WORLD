'use strict';
// png-all-parse.js — 用新解析器全量解析角色卡目录，列出失败文件
const fs = require('node:fs');
const path = require('node:path');
const IMP = require('../src/import');
(async () => {
  const dir = process.argv[2] || path.join(process.env.USERPROFILE || 'C:\\Users\\qwe', 'Desktop', '角色卡');
  let fail = 0; let ok = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!/\.png$/i.test(f)) continue;
    const buf = fs.readFileSync(path.join(dir, f));
    try {
      const card = IMP.pngExtract(buf);
      if (card && (card.name || card.first_mes)) { ok++; } else { console.log('[FAIL] ' + f + '  （无卡数据）'); fail++; }
    } catch (e) { console.log('[FAIL] ' + f + '  ' + e.message); fail++; }
  }
  console.log('成功 ' + ok + ' / 失败 ' + fail);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });
