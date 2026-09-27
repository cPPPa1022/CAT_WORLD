'use strict';
/* dist-check.js —— 交付副本与源码必须一致（v2.06 · P1-5）
 *
 * 为什么要有它：交付给用户的不是 public/app.js，而是
 *   dist-app/世界模拟器/resources/app/ 这一份副本（桌面快捷方式指向它）。
 * 每次发布都要"改源码 → 同步副本 → 打包"，而**没有任何东西检查同步有没有漏**。
 * 漏了的表现是最坑的一种：源码里明明修好了，用户打开还是老样子，而所有断言全绿
 * （它们读的是源码）。v2.05 就出现过一批过期副本（dist-app 根目录躺着 4 个旧 ai.js/game.js）。
 *
 * 断言：① 两边该有的文件都在；② 逐字节一致；③ dist-app 里不许有源码里没有的 .js（过期副本）。
 * dist-app 不存在时**跳过**（新克隆的仓库没有交付目录，不该因此变红）。
 *
 * 用法：node scripts/dist-check.js
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'dist-app', '世界模拟器', 'resources', 'app');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };

if (!fs.existsSync(APP)) {
  console.log('  --   dist-app 不存在，跳过（源码仓库里没有交付副本是正常的）');
  console.log('==== dist-check: skip ====');
  process.exit(0);
}

const FILES = ['server.js', 'electron-main.js', 'package.json'];
const DIRS = ['public', 'src'];

const listDir = (base, rel) => {
  const out = [];
  const walk = (d, prefix) => {
    for (const name of fs.readdirSync(path.join(d)).sort()) {
      const fp = path.join(d, name);
      const st = fs.statSync(fp);
      if (st.isDirectory()) walk(fp, prefix + name + '/');
      else out.push(prefix + name);
    }
  };
  walk(path.join(base, rel), '');
  return out;
};

console.log('');
console.log('交付副本 vs 源码（' + path.relative(ROOT, APP) + '）');

// ① 单文件
for (const f of FILES) {
  const a = path.join(ROOT, f), b = path.join(APP, f);
  if (!fs.existsSync(b)) { ok(false, f + '：副本里没有这个文件'); continue; }
  ok(fs.readFileSync(a, 'utf8') === fs.readFileSync(b, 'utf8'), f + '：两边逐字节一致');
}

// ② 目录（源码里的每一个文件都要在副本里、且一致）
let mismatch = [];
for (const d of DIRS) {
  const srcList = listDir(ROOT, d);
  const appList = fs.existsSync(path.join(APP, d)) ? listDir(APP, d) : [];
  const missing = srcList.filter(f => appList.indexOf(f) < 0);
  const extra = appList.filter(f => srcList.indexOf(f) < 0);
  const diff = srcList.filter(f => appList.indexOf(f) >= 0 &&
    fs.readFileSync(path.join(ROOT, d, f), 'utf8') !== fs.readFileSync(path.join(APP, d, f), 'utf8'));
  mismatch = mismatch.concat(diff.map(f => d + '/' + f));
  ok(missing.length === 0, d + '/ 里 ' + srcList.length + ' 个文件副本都有' + (missing.length ? '（缺：' + missing.slice(0, 5).join(', ') + '）' : ''));
  ok(extra.length === 0, d + '/ 里没有源码里不存在的文件（过期副本）' + (extra.length ? '（多：' + extra.slice(0, 5).join(', ') + '）' : ''));
}
ok(mismatch.length === 0, '★ 每个文件内容都一致' + (mismatch.length ? '（不一致 ' + mismatch.length + ' 个：' + mismatch.slice(0, 8).join(', ') + '）' : ''));

// ③ 副本根目录不许有源码根目录没有的 .js（v2.05 清掉的那 4 个旧副本就是这种形状）
{
  const srcRoot = fs.readdirSync(ROOT).filter(f => f.endsWith('.js'));
  const appRoot = fs.readdirSync(APP).filter(f => f.endsWith('.js'));
  const stale = appRoot.filter(f => srcRoot.indexOf(f) < 0);
  ok(stale.length === 0, '副本根目录没有源码里不存在的 .js' + (stale.length ? '（' + stale.join(', ') + '）' : ''));
}

/* ④ ★ v3.6：**裁判清单必须与部署脚本对得上**。
   起因：deploy-dist.js 原来只拷 src/ 与 public/，而上面的 FILES 是连根目录单文件一起判的
   —— 于是"改了 server.js 没进交付副本"没有任何东西会拦（实测两条红才发现）。
   这类"两处清单各写一份"的账，本项目栽过太多次：让裁判自己盯着部署脚本。 */
{
  const dep = fs.readFileSync(path.join(ROOT, 'scripts', 'deploy-dist.js'), 'utf8');
  const miss = FILES.filter(f => dep.indexOf("'" + f + "'") < 0);
  ok(miss.length === 0, 'deploy-dist.js 覆盖了裁判清单里的每个文件' + (miss.length ? '（漏：' + miss.join(', ') + '）' : '（' + FILES.length + ' 个）'));
}

console.log('');
console.log('==== dist-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
