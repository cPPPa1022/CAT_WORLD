// scripts/bundle.js — 迷你 CJS 打包器（SEA 用，零依赖）
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const abs = f => path.normalize(path.join(root, f));
const NATIVES = new Set(['fs','path','zlib','http','url','child_process','os','crypto','util','events','stream','https']);
const NATIVE_RE = new RegExp("require\\('\\s*((?:node:)?[a-zA-Z][a-zA-Z0-9_:.-]*)\\s*'\\)", 'g');
const REL_RE = new RegExp("require\\('\\s*(\\.[^']+)'\\s*\\)", 'g');
/* v2.05：模块表**不再手写**。手写的 7 条（server/store/world/runtime/ai/game/import）在
   v1.96 之后就跟不上代码了 —— gate / bus / worldlock / contract / retention / threads /
   manifest / director / replay / scheduler … 一个都没进包。那个包跑起来就是"require 不到模块"，
   而且**不会有人发现**（它只被 SEA 那条路用到）。
   现在从 server.js 出发走一遍真实的 require 图：谁被 require 谁进包，加新模块不必记得改这里。 */
const seen = new Set();
const files = [];
function resolveFile(from, rel) {
  const base = path.normalize(path.join(path.dirname(abs(from)), rel));
  for (const cand of [base, base + '.js', path.join(base, 'index.js')]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return path.relative(root, cand).replace(/\\/g, '/');
  }
  return null;
}
(function walk(f) {
  if (!f || seen.has(f)) return;
  seen.add(f);
  const src = fs.readFileSync(abs(f), 'utf8');
  files.push(f);
  for (const m of src.matchAll(REL_RE)) { const n = resolveFile(f, m[1]); if (n) walk(n); }
})('server.js');
const idx = new Map(files.map((f, i) => [abs(f), i]));
function resolve(f, rel) {
  const n = resolveFile(f, rel);
  return (n && idx.has(abs(n))) ? idx.get(abs(n)) : null;
}
const body = files.map((f, i) => {
  let src = fs.readFileSync(abs(f), 'utf8');
  src = src.replace(NATIVE_RE, (m, name) => { const bare = name.replace(/^node:/, ''); return NATIVES.has(bare) ? '__native(' + JSON.stringify(name) + ')' : m; });
  src = src.replace(/module\.exports/g, 'm.exports');
  src = src.replace(REL_RE, (m, rel) => { const n = resolve(f, rel); return n == null ? m : '__r(' + n + ')'; });
  return i + ':function(m,exports,__r){' + src + '\n}';
}).join(',\n');
const out = [
  'global.__BUNDLED__ = true;',
  'const __native = require;',
  'const __mods = {' + body + '};',
  'const __cache = {};',
  'function __r(i){ if(__cache[i]) return __cache[i].exports; const m={exports:{}}; __cache[i]=m; __mods[i](m,m.exports,__r); return m.exports; }',
  '__r(0);',
  ''
].join('\n');
fs.mkdirSync(path.join(root, 'dist-prep'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist-prep', 'bundle.js'), out);
console.log('[bundle] 打包 ' + files.length + ' 个模块 -> dist-prep/bundle.js (' + out.length + ' bytes)');