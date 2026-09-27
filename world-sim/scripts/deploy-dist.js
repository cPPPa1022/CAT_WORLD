// deploy-dist.js — 把源码同步进交付副本（`dist-app/<打包名>/resources/app`）
//
// 为什么要有它：`dist-check.js` 会逐字节比对交付副本与源码，**改完不拷就红灯**。
//   而这件事以前是手工做的，实测代价：我把路径写错过两次
//   （一次写成仓库根的 `dist-app`，一次被 PS 5.1 的中文路径问题坑了），
//   两次都是"命令没报错、结论却是错的"。⇒ 手工拷贝这件事本身就是个 bug 源。
//
// 用法：node scripts/deploy-dist.js           只拷**不一样**的
//       node scripts/deploy-dist.js --all     无条件全拷
//
// 两条刻意的设计：
//   ① 打包目录名（「世界模拟器」）**不硬编码** —— 扫出来。改名了也不会静默拷空。
//   ② 候选数必须**恰好 1 个**，否则报错退出。多一个少一个都说明我看错了地方，
//      这时候"继续拷"比"停下来"危险得多。
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ALL = process.argv.includes('--all');

const distApp = path.join(ROOT, 'dist-app');
if (!fs.existsSync(distApp)) { console.log('✘ 找不到 ' + distApp); process.exit(1); }

const cands = fs.readdirSync(distApp)
  .map((n) => path.join(distApp, n, 'resources', 'app'))
  .filter((p) => fs.existsSync(path.join(p, 'src')));
if (cands.length !== 1) {
  console.log('✘ 交付副本应恰好有 1 个，实测 ' + cands.length + ' 个：\n  ' + cands.join('\n  '));
  process.exit(1);
}
const APP = cands[0];
console.log('交付副本: ' + path.relative(ROOT, APP));

/* ★ v3.6：根目录的单文件也要拷 —— 原来这里只有 src/ 与 public/，
   而 dist-check.js 的 FILES 是 ['server.js','electron-main.js','package.json']（它是裁判）。
   于是"改了 server.js 却没进交付副本"这件事**没有任何东西会拦**：
   所有断言读的都是源码，用户打开的还是旧副本（v2.05 那批过期副本的同一个形状，
   只不过这次是自己家门口）。实测：v3.6 改完 server.js，dist-check 直接两条红。 */
const FILES = ['server.js', 'electron-main.js', 'package.json'];   // ⚠ 必须与 dist-check.js 的 FILES 一致

let copied = 0, same = 0, missing = 0;
for (const f of FILES) {
  const from = path.join(ROOT, f), to = path.join(APP, f);
  if (!fs.existsSync(from)) { console.log('✘ 源码里没有 ' + f + '（FILES 写错了）'); process.exit(1); }
  const a = fs.readFileSync(from);
  if (fs.existsSync(to) && Buffer.compare(a, fs.readFileSync(to)) === 0 && !ALL) { same++; continue; }
  fs.writeFileSync(to, a);
  console.log('  拷 ' + f);
  copied++;
}
for (const sub of ['src', 'public']) {
  const from = path.join(ROOT, sub);
  const to = path.join(APP, sub);
  if (!fs.existsSync(from)) continue;
  const files = fs.readdirSync(from);
  if (!files.length) { console.log('✘ ' + sub + '/ 是空的 —— 路径不对，结果不可信'); process.exit(1); }
  for (const f of files) {
    const src = path.join(from, f);
    if (!fs.statSync(src).isFile()) continue;
    const dst = path.join(to, f);
    const a = fs.readFileSync(src);
    const isSame = fs.existsSync(dst) && Buffer.compare(a, fs.readFileSync(dst)) === 0;
    if (isSame && !ALL) { same++; continue; }
    if (!fs.existsSync(to)) fs.mkdirSync(to, { recursive: true });
    if (!fs.existsSync(dst)) missing++;
    fs.writeFileSync(dst, a);
    console.log('  拷 ' + sub + '/' + f);
    copied++;
  }
}
console.log('已同步 ' + copied + ' 个（本来就一致 ' + same + ' 个，其中新建 ' + missing + ' 个）。');
console.log('下一步：node scripts/dist-check.js 复核；然后**重启模拟器**（旧的还在内存里跑）。');
