'use strict';
// context-order-check.js - S1 资料包顺序断言
// 为什么要有它：DeepSeek 是服务端前缀缓存（命中比未命中便宜约 31x），
// 「稳定字段在前」是唯一法则；而顺序一旦被改回去，钱就悄悄涨回去，没人会报错。
// 用法：node scripts/context-order-check.js   失败时非零退出
const AI = require('../src/ai');
const W = require('../src/world');
const C = require('../src/contract');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  OK  ' + m)) : (fail++, console.log('  FAIL ' + m)); };

const data = W.buildDemoWorld();
data.id = (p) => p + '_' + Math.random().toString(36).slice(2, 8);
const ctx = { memories: [], candidates: [], action: '你好' };
const raw = AI.packetFor(data, ctx);
let o;
try { o = JSON.parse(raw); } catch (e) { console.log('  FAIL 资料包不是合法 JSON: ' + e.message); process.exit(1); }
const keys = Object.keys(o);

const r = C.assertContextOrder(keys);
ok(r.ok, '键序合法（stable 段全在 volatile 段之前）' + (r.ok ? '' : ' -> ' + r.why));

const unregistered = keys.filter(k => C.CONTEXT_ORDER.indexOf(k) < 0);
ok(unregistered.length === 0, '没有未登记分层的字段' + (unregistered.length ? ' -> ' + unregistered.join(' / ') : ''));

const declared = C.CONTEXT_ORDER.filter(k => keys.indexOf(k) >= 0);
ok(declared.length === keys.length, '声明数 === 实际数（声明 ' + declared.length + ' / 实际 ' + keys.length + '）');

// 头两个字段必须都是稳定的（这是缓存能不能命中的分水岭）
const head = keys.slice(0, 3);
ok(head.every(k => C.CONTEXT_TIERS.stable.indexOf(k) >= 0), '头 3 个字段都在稳定段: ' + head.join(' | '));

// 当前时间/天气/地点 必须不在前 10 个字段里（原来是第 1 个）
const hot = ['当前时间', '天气', '地点', '最近场景原文'];
const hotEarly = hot.filter(k => keys.indexOf(k) >= 0 && keys.indexOf(k) < 10);
ok(hotEarly.length === 0, '每回合必变的字段不在前 10 位' + (hotEarly.length ? ' -> ' + hotEarly.join(' / ') : ''));

console.log('');
console.log('键序: ' + keys.slice(0, 5).join(' | ') + ' ... ' + keys.slice(-3).join(' | '));
console.log('pass=' + pass + ' fail=' + fail);
process.exitCode = fail ? 1 : 0;