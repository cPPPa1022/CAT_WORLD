// sandbox.js — 「创造框架」那一步写的代码，**跑在哪**
//
// 用户 2026-09-26 的决定：第三步权限大到可以写代码改写布局/创造功能。
// 用户原话：「需要禁止让 ai 给整个模拟器搞坏 最多让它搞坏存档」
//           「A 是创造 从 0.5 到 1…存档是建立在这个基础之上的」
//           「无非就是代码写多了一个破折号和引号之类的」
//
// 所以这个沙箱要挡三样，一样都不能少：
//   ① **宿主能力**：没有 require / process / fs / global / Buffer —— 它碰不到系统，坏只坏存档
//   ② **不确定**：不给 `Date`、剔掉 `Math.random` —— 否则 replay / 三投影 / 快照全破
//      （用户：「不认识 刚认识没多久 那掷骰子呗」→ 骰子走 framework.seededRoll，不走宿主随机）
//   ③ **写入口**：只给 `write.postUpdate`（= 发 Update）。
//      19 种 Update 的校验/门控/记账因此**全部继续生效** —— 一行都不用重写。
//
// 三层保护里它是第②层（第①层是写入前的 `syntaxCheck`，第③层是 opening 的三级恢复）。
'use strict';
const vm = require('node:vm');

const MAX_MS = 300;        // 单次执行上限：超时即掐（不给死循环拖死主进程的机会）
const MAX_CODE = 20000;    // 代码长度上限：防止一次性塞进来一整个程序

/* 确定性 Math：剔掉 random。世界要随机就走 seededRoll（可重放）。 */
const SAFE_MATH = Object.create(null);
for (const k of Object.getOwnPropertyNames(Math)) if (k !== 'random') SAFE_MATH[k] = Math[k];

/* 必须**逐样抹掉**的东西。
   ⚠️ 这不是洁癖，是实测出来的：`vm.createContext` 默认给一整套 JS 内建，
      于是 `Date` / `eval` / `Function` / `globalThis` **本来都拿得到**——
      沙箱第一版就漏了这四个（自检当场抓出来）。
      · `Date` 最要紧：能拿墙钟就等于**破坏可重放**（replay / 三投影 / 快照全破）。
        世界要时间就读 `read.projection`，要随机就走 `framework.seededRoll`。
      · `eval` / `Function`：虽然 `codeGeneration.strings:false` 会让它们**调用时**抛，
        但 `typeof` 仍是 function —— 留着只会让人误判边界在哪。直接抹成 undefined。 */
const FORBIDDEN = ['require', 'process', 'global', 'globalThis', 'Buffer', 'module', 'exports',
  '__dirname', '__filename', 'fetch', 'Date', 'eval', 'Function', 'setTimeout', 'setInterval',
  'setImmediate', 'queueMicrotask', 'structuredClone', 'performance', 'console'];

function buildContext(api) {
  const a = api || {};
  const sandbox = Object.create(null);
  /* ① 白名单 API —— 只有这三组，没有第四样 */
  sandbox.read = a.read || {};
  sandbox.draw = a.draw || {};
  sandbox.write = a.write || {};
  /* ② 语言内建（够写逻辑：条件/循环/计算），但**没有 Date、没有 random** */
  sandbox.Math = SAFE_MATH;
  sandbox.JSON = JSON;
  sandbox.Array = Array;
  sandbox.Object = Object;
  sandbox.String = String;
  sandbox.Number = Number;
  sandbox.Boolean = Boolean;
  sandbox.isFinite = isFinite;
  sandbox.isNaN = isNaN;
  sandbox.parseInt = parseInt;
  sandbox.parseFloat = parseFloat;
  /* ③ 把整套默认内建里的危险项**逐样抹平** */
  for (const k of FORBIDDEN) sandbox[k] = undefined;
  return vm.createContext(sandbox, {
    /* 连字符串代码生成都关掉 —— 不然它能在里面再 new Function 一次绕出来 */
    codeGeneration: { strings: false, wasm: false }
  });
}

/* 跑一段 AI 写的代码。返回 { ok, out } 或 { ok:false, err }（err 是**代码层级**的，0 token） */
function run(code, api) {
  const s = String(code == null ? '' : code);
  if (!s.trim()) return { ok: false, err: '空代码' };
  if (s.length > MAX_CODE) return { ok: false, err: '代码太长（' + s.length + ' > ' + MAX_CODE + '）—— 这么长的东西该拆成板块声明，不该写成程序' };
  /* 第①层：语法预检。语法错**根本不进沙箱**，更不进存档。 */
  const syn = require('./framework').syntaxCheck(s);
  if (!syn.ok) return { ok: false, err: '语法没过（写进存档之前就挡住了）：' + syn.err };
  const ctx = buildContext(api);
  try {
    const out = vm.runInContext('(function(){' + s + '\n})()', ctx, { timeout: MAX_MS });
    return { ok: true, out: out === undefined ? null : out };
  } catch (e) {
    return { ok: false, err: String((e && e.message) || e) };
  }
}

/* 自检：这几样必须**拿不到**。少一样都是后门。 */
function selfCheck() {
  const bad = [];
  try {
    const ctx = buildContext({ read: {}, draw: {}, write: {} });
    for (const k of FORBIDDEN) {
      const v = vm.runInContext('typeof ' + k, ctx, { timeout: 50 });
      if (v !== 'undefined') bad.push(k + '=' + v);
    }
    if (vm.runInContext('typeof Math.random', ctx, { timeout: 50 }) !== 'undefined') bad.push('Math.random');
  } catch (e) { bad.push('自检自己炸了:' + String((e && e.message) || e)); }
  return { ok: bad.length === 0, leaked: bad };
}

module.exports = { run, selfCheck, buildContext, SAFE_MATH, MAX_MS, MAX_CODE, FORBIDDEN };
