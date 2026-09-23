'use strict';
// png-scan.js — 扫描目录里每张 PNG 的角色块（定位问题卡：键名/格式异常都给列出来）
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const dir = process.argv[2] || path.join(process.env.USERPROFILE || 'C:\\Users\\qwe', 'Desktop', '角色卡');
for (const f of fs.readdirSync(dir)) {
  if (!/.png$/i.test(f)) continue;
  const buf = fs.readFileSync(path.join(dir, f));
  let off = 8; const keys = []; let ok = false;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      const body = buf.slice(off + 8, off + 8 + len);
      const nul = body.indexOf(0);
      if (nul >= 0) { const key = body.toString('ascii', 0, nul); keys.push(type + ':' + key); if (/^chara$|^ccv3$|^char$|^character$/i.test(key)) ok = true; }
    }
    off = off + 12 + len;
    if (type === 'IEND') break;
  }
  console.log((ok ? '[OK ] ' : '[!!] ') + f + '  ' + (keys.join(', ') || '（无文本块）'));
}
