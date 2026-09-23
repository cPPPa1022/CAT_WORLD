// 下载 electron 二进制（node 网络栈，自动重定向，流式写盘）
'use strict';
const fs = require('node:fs');
const https = require('node:https');
const URL = require('node:url');
const out = 'electron-bin.zip';
let remaining = 3;
function fetch(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'node' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return resolve({ redirect: res.headers.location });
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const file = fs.createWriteStream(out);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve({ done: true })));
      file.on('error', reject);
    });
    req.on('error', reject);
  });
}
(async () => {
  let u = 'https://npmmirror.com/mirrors/electron/33.4.11/electron-v33.4.11-win32-x64.zip';
  while (true) {
    const r = await fetch(u);
    if (r.redirect && remaining-- > 0) { u = r.redirect; console.error('redirect ->', u); continue; }
    if (r.done) { console.log('downloaded', fs.statSync(out).size); break; }
    break;
  }
})().catch(e => { console.error('DL FAIL', e.message); process.exit(1); });
