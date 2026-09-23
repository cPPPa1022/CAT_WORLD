// retention-check.js — 统一留存策略（v1.87）
// 病：7 个容器各写各的阈值、超出**直接丢**；设计文档只写"不删"，没写"存不下怎么办"。
// 治：阈值收进 src/retention.js 的策略表，溢出**落盘**到 data/retention/<kind>.jsonl。
// 本脚本守住：① 溢出真的落盘、不丢 ② 计数可见 ③ 阈值只有一处（源码里不许再硬编码窗口）
'use strict';
const path = require('path'), os = require('os'), fs = require('fs');
const TMP = path.join(os.tmpdir(), 'ws-ret-' + Date.now());
process.env.WORLD_SIM_DATA = TMP; fs.mkdirSync(TMP, { recursive: true });
const RET = require('../src/retention');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
console.log('');
console.log('统一留存策略（阈值一处 + 溢出落盘）');

const data = {};
const arr = [];
for (let i = 1; i <= 10; i++) arr.push({ n: i });
const kept = RET.cap('probe', arr, 4, data);
ok(kept.length === 4 && kept[0].n === 7 && kept[3].n === 10, '裁剪保留最新 4 条：' + JSON.stringify(kept.map(x => x.n)));
ok(data.spilled && data.spilled.probe === 6, '溢出计数记在存档里：spilled.probe = ' + (data.spilled && data.spilled.probe));
const f = path.join(RET.dir(), 'probe.jsonl');
ok(fs.existsSync(f), '溢出真的落盘：data/retention/probe.jsonl');
const lines = fs.readFileSync(f, 'utf8').split(String.fromCharCode(10)).filter(Boolean).map(JSON.parse);
ok(lines.length === 6 && lines[0].n === 1 && lines[5].n === 6, '落盘内容就是被裁掉的那 6 条（原顺序）：' + JSON.stringify(lines.map(x => x.n)));

RET.cap('probe', [{ n: 11 }, { n: 12 }], 0, data);
ok(fs.readFileSync(f, 'utf8').split(String.fromCharCode(10)).filter(Boolean).length === 6, 'max=0（不限）时不裁剪、不落盘');

const v = RET.view(data);
ok(v.caps && v.caps.ledger === 5000 && v.caps.sceneLog === 200, '策略表可见（ledger ' + v.caps.ledger + ' / sceneLog ' + v.caps.sceneLog + '）');
ok(v.files.some(x => x.kind === 'probe' && x.lines === 6), 'view() 报出落盘文件：' + JSON.stringify(v.files));

console.log('');
console.log('阈值只有一处（源码里不许再硬编码窗口）');
const ROOT = path.join(__dirname, '..');
const gm = fs.readFileSync(path.join(ROOT, 'src', 'game.js'), 'utf8');
const rc = fs.readFileSync(path.join(ROOT, 'src', 'records.js'), 'utf8');
ok(gm.indexOf('archiveSpill(data, 200)') < 0, 'game.js 不再写死 archiveSpill(data, 200)');
ok(gm.indexOf('RET.CAPS.sceneLog') >= 0 && rc.indexOf('RET.CAPS.sceneLog') >= 0, 'sceneLog 窗口来自 RET.CAPS.sceneLog');
ok(rc.indexOf('keep || 200') < 0, 'records.js 不再有 keep || 200 的硬编码兜底');
console.log('');
console.log('==== retention-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
