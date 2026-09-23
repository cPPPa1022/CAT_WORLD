'use strict';
const fs = require('node:fs');
const path = require('node:path');
const IMP = require('../src/import');
(async () => {
  const dir = path.join(process.env.USERPROFILE || 'C:\\Users\\qwe', 'Desktop', '角色卡');
  const card = IMP.parseSource('png', fs.readFileSync(path.join(dir, 'a9492de01478ca73.png')).toString('base64'));
  const wb = card.character_book && Array.isArray(card.character_book.entries) ? card.character_book.entries : [];
  for (let i = 0; i < wb.length; i++) {
    console.log('===== 条目' + (i + 1) + ' [' + (wb[i].keys || []).join('|') + '] =====');
    console.log(String(wb[i].content || '').slice(0, 700));
    console.log('');
  }
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(2); });
