'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const dir = path.join(process.env.USERPROFILE || 'C:\\Users\\qwe', 'Desktop', '角色卡');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.png')).slice(0, 14);
function extract(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504E47) return null;
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const body = buf.slice(off + 8, off + 8 + len);
    off = off + 12 + len;
    if (type === 'tEXt' || type === 'zTXt') {
      const nul = body.indexOf(0);
      const key = body.toString('ascii', 0, nul);
      if (key === 'chara' || key === 'ccv3') {
        try {
          let raw = body.slice(nul + 1);
          if (type === 'zTXt') raw = zlib.inflateSync(raw.slice(1));
          return JSON.parse(Buffer.from(raw.toString('utf8').trim(), 'base64').toString('utf8'));
        } catch (e) { return { __err: String(e.message).slice(0, 60) }; }
      }
    }
    if (type === 'IEND') break;
  }
  return null;
}
for (const f of files) {
  const buf = fs.readFileSync(path.join(dir, f));
  const j = extract(buf);
  if (!j) { console.log(f.padEnd(26) + ' (无chara/ccv3块)'); continue; }
  const spec = j.spec || j.spec_version || 'v2';
  const d = j.data || j;
  const keys = Object.keys(d);
  const ch = Array.isArray(d.characters) ? d.characters.length : 0;
  const wb = (d.character_book && d.character_book.entries) ? d.character_book.entries.length : (!d.character_book ? (d.world_info ? Object.keys(d.world_info).length : 0) : 0);
  const alts = Array.isArray(d.alternate_greetings) ? d.alternate_greetings.length : 0;
  const ext = d.extensions ? Object.keys(d.extensions).join(',') : '';
  console.log(f.padEnd(26) + ' spec=' + spec + ' | name=' + String(d.name || d.char_name || '?').slice(0, 14) + ' | 字段=' + keys.length + ' [' + keys.slice(0, 14).join(',') + ']' + ' | 多角色=' + ch + ' | 世界书=' + wb + ' | 备选开场=' + alts);
  if (ext) console.log('    extensions=' + ext.slice(0, 120));
}
