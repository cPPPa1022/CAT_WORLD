// corrupt-check.js — 数据文件读坏了会怎样（v1.76）
// 起因：用户只看到一句 "Unexpected end of JSON input" —— 查不到是哪个文件、也开不了软件。
'use strict';
const fs = require('fs'); const path = require('path'); const os = require('os');
const TMP = path.join(os.tmpdir(), 'ws-corrupt-' + Date.now());
process.env.WORLD_SIM_DATA = TMP; fs.mkdirSync(TMP, { recursive: true });
const STORE = require('../src/store');
const AI = require('../src/ai');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
console.log('');
console.log('坏档容错 —— 不许再把一句英文甩到界面上，也不许静默把注册表抹掉');

// ① readJson：空文件 → 抛「能看懂的话」+ 留下备份
const bad = path.join(TMP, 'bad.json');
fs.writeFileSync(bad, '');
let msg = '';
try { STORE.readJson(bad); } catch (e) { msg = String(e.message || e); }
ok(msg.indexOf('数据文件损坏') >= 0, '★ 空 JSON → 说人话：' + msg.slice(0, 60));
ok(msg.indexOf('bad.json') >= 0, '★ 报出是哪个文件');
const baks = fs.readdirSync(TMP).filter(f => f.indexOf('bad.json.bad-') === 0);
ok(baks.length === 1, '★★ 坏档被备份下来（原件不丢）');

// ② loadConfig：config.json 坏了 → 不抛、回落默认、软件照常开
fs.writeFileSync(path.join(TMP, 'config.json'), '{"port":3088,"llm":{"baseURL":"http');
let cfg = null; let threw = '';
try { cfg = AI.loadConfig(); } catch (e) { threw = String(e.message || e); }
ok(!threw, '★★ config.json 半截 → loadConfig 不抛（原来会把那句英文甩到任意接口上）');
ok(cfg && cfg.port === 3088, '★ 回落默认值（port=3088）');
ok(cfg && cfg.llm && cfg.llm.baseURL === '', '★ 模型配置回落为空（不是崩，是"没配"）');
const cbak = fs.readdirSync(TMP).filter(f => f.indexOf('config.json.bad-') === 0);
ok(cbak.length === 1, '★ 坏的 config.json 也备份了');

// ③ loadMeta：注册表坏了 → 不抛 + 备份 + 标 __corrupt（原来静默返回 {worlds:[]} → 下次存档就抹库）
fs.mkdirSync(path.join(TMP, 'data'), { recursive: true });
fs.writeFileSync(path.join(TMP, 'data', 'meta.json'), '');
let meta = null;
try { meta = STORE.loadMeta(); } catch (e) { meta = { err: String(e.message) }; }
ok(meta && !meta.err, '★★ meta.json 空 → loadMeta 不抛');
ok(meta && meta.__corrupt === true, '★★ 标了 __corrupt（调用方能看出来"这是坏档，不是真没世界"）');
const mbak = fs.readdirSync(path.join(TMP, 'data')).filter(f => f.indexOf('meta.json.bad-') === 0);
ok(mbak.length === 1, '★ 坏的注册表备份了');

// ④ 正常档不受影响
fs.writeFileSync(path.join(TMP, 'ok.json'), '{"a":1}');
ok(STORE.readJson(path.join(TMP, 'ok.json')).a === 1, '好档照常读');

// ⑤ 界面：空响应要说清是哪个接口
const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
ok(/返回了空响应（HTTP/.test(ui) && /\+ path \+/.test(ui), '★★ api() 报错带接口名（不再是干巴巴一句英文）');
ok(/服务端返回了非 JSON/.test(ui), '★ 非 JSON 响应也报清楚');
const sv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
ok(/★ 500 /.test(sv), '★ 服务端 500 写进 worldsim.log（桌面应用里 stderr 看不到）');
ok(/await drawStorage\(listWrap\); return;/.test(ui), '★★ 0 个世界时也画存储行（那才是最需要清孤儿的时候）');

console.log('');
console.log('==== corrupt-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
