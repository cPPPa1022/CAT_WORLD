// worldlock.js — 世界级单写锁（v1.98 · P0-2）
'use strict';
/* 为什么（评审回执 P0-2）：内存里的世界是**进程级单例**（server.js 的 current），
   而会改它的 HTTP 入口有二十多个，其中十来个还会 await LLM（一次几十秒）。
   两个入口交错执行 = 世界被推到"逻辑上不存在的状态"：时钟推两次、NPC 走两遍、
   账本两次追加、后写的存档覆盖先写的。而且它是**前端可达**的（短信发送按钮不置忙）。
   语义选择：**拒绝**，不是排队。排队会把"玩家此刻的意图"变成"几步之后再执行的命令"——
   "睡觉跳过 8 小时"这种强时序动作尤其错；连点十次就是十个回合的 token。
   边界：锁只加在 **HTTP 入口**。内部函数（persist / touchMeta / saveMeta）信任调用方持锁、
   自己不加锁 —— 否则 render → stampImgOnBeat → persist 这类自身调用会把自己锁死。
   粒度：全局锁，但命名成"世界锁"。v1.98 同一时刻只有一个 current（进程级单例），
   所以"世界级"与"全局"是同一件事；将来若要多世界并行，升级路径 = 把 key 换成 currentId，
   只改这一个文件。
   超时：**必须有**。失效模式是"LLM 挂住 → 锁永久持有 → 游戏永久卡死"。
   阈值由调用方给（它才知道配置里的超时），到点强制释放并留一笔日志。 */

let __held = null;          // { what, since, timeoutMs }
let __onForce = null;       // 强制释放时的留痕回调（server.js 注入 GL）
let __forced = 0;           // 强制释放次数（可查）

function configure(opts) {
  if (opts && typeof opts.onForceRelease === 'function') __onForce = opts.onForceRelease;
}
function peek() {
  return __held ? { what: __held.what, since: __held.since, ms: Date.now() - __held.since } : null;
}
function busyMsg() {
  const w = __held ? __held.what : '';
  return '世界还在演算上一件事' + (w ? '（' + w + '）' : '') + '——等它演完再点';
}
/* 拿锁：拿不到返回 null（调用方决定"拒绝"还是"跳过写盘"）。
   过期的锁在这里被强制释放 —— 一个入口挂了不能把整个世界锁死。 */
function tryHold(what, timeoutMs) {
  if (__held) {
    const age = Date.now() - __held.since;
    const cap = __held.timeoutMs || 0;
    if (!cap || age <= cap) return null;
    __forced++;
    const msg = '★ 世界锁强制释放（' + __held.what + ' 持有 ' + Math.round(age / 1000) + 's > 上限 ' + Math.round(cap / 1000) + 's）';
    if (__onForce) { try { __onForce(msg); } catch (e) { /* 留痕失败不影响放锁 */ } }
    __held = null;
  }
  __held = { what: String(what || ''), since: Date.now(), timeoutMs: Number(timeoutMs) || 0 };
  return __held;
}
function release(h) {
  if (!h) return;
  if (__held === h) __held = null;   // 只放自己拿的那把（防止误放别人的）
}
/* 分发器唯一入口：'hold' = 拿锁（拿不到就拒绝）/ 'skip' = 拿不到也别拒绝，调用方跳过写盘 / null = 不用管 */
function enter(path, method, timeoutMs) {
  const what = String(path || '') + (method ? (' ' + method) : '');
  if (!needsLock(path, method)) return { mode: null, what: what };
  const h = tryHold(what, timeoutMs);
  if (!h) return { mode: 'reject', what: what, msg: busyMsg() };
  return { mode: 'hold', what: what, handle: h };
}
function exit(ent) {
  if (ent && ent.mode === 'hold') release(ent.handle);
}

/* ---------- 会改世界的入口清单（**唯一声明点**） ----------
   判断标准（三条任一条命中就必须进 REQUIRED）：
     ① 改 current / currentId（含整体替换、unloadWorld）
     ② 调 persist() / saveWorld() / saveMeta() / SNAP.take / SNAP.restore / 改世界文件
     ③ await 一个长任务（LLM / 调度器）之后可能落库
   漏一个 = 锁只剩假象。所以 scripts/world-lock-check.js 会**读源码做静态自检**：
   server.js 里任何含上述标记的路由块，必须出现在本表（或在 EXEMPT 里写明理由）。 */
const REQUIRED = [
  // —— A 组：长任务 + mutate current ——
  ['POST', '/api/turn'], ['POST', '/api/turn/stream'], ['POST', '/api/skip'],
  ['POST', '/api/msg/send'], ['POST', '/api/comfy/person'], ['POST', '/api/person/look'],
  ['POST', '/api/save/repair'], ['POST', '/api/world/gen'], ['POST', '/api/new'],
  ['POST', '/api/comfy/render'],
  // —— B 组：同步 mutate current ——
  ['POST', '/api/settings'], ['POST', '/api/wxmark'], ['POST', '/api/player-name'],
  ['POST', '/api/world/load'], ['POST', '/api/world/del'], ['POST', '/api/reset'],
  ['POST', '/api/msg/read'], ['POST', '/api/schema/register'], ['POST', '/api/framework/level'],
  ['POST', '/api/snapshot/save'], ['POST', '/api/snapshot/load'], ['POST', '/api/snapshot/stepback'],
  ['POST', '/api/doc/read'], ['POST', '/api/msg/readall'], ['POST', '/api/claim/save'],
  ['POST', '/api/worldinfo/save'], ['POST', '/api/worldinfo/del'],
  // —— C 组：整体替换 current / 改注册表 / 删数据（交错执行会撕裂） ——
  ['POST', '/api/demo'], ['POST', '/api/cards/launch'], ['POST', '/api/cards/del'],
  ['POST', '/api/save/import'], ['POST', '/api/storage/clean'], ['POST', '/api/image/workflow'],
];
/* 明确**不**加锁的入口 + 理由（写在这里，是为了让下一个人知道这是想过的，不是漏的）。
   共同点：不碰 current 的世界状态，也不调长任务；它们写的是**自己的文件**（原子写已封口）。 */
const EXEMPT = {
  'GET /api/state': '轮询入口，**不能拒绝**（前端 api() 见到 err 就 throw，界面会断）。它自己会写盘（自愈），所以它单独用 tryHold：拿不到就跳过自愈，只回视图。',
  'POST /api/menu': '只改 menuMode 这个"看菜单还是看世界"的开关，不碰世界数据。',
  'POST /api/resume-current': '同上（只改 menuMode）。',
  'POST /api/deg': '只累加前端上来的静默降级计数。',
  'POST /api/self': '只写 config.json（原子写；不碰 current）。',
  'POST /api/content/set': '只改 cfg.content 并写 config.json。',
  'POST /api/content/import': '只往内容目录拷文件。',
  'POST /api/comfy/test': '只测 ComfyUI 连通性、改 cfg.image.base。',
  'POST /api/settings/test': '只测模型连通性，不落库。',
  'POST /api/quit': '退出进程。',
  'POST /api/save/scan': '只读存档文件做扫描（LLM），不碰 current 也不落盘。',
  'POST /api/save/export': '只读 current 生成导出包（不写世界文件）。',
  'POST /api/snapshot/del': '只删一格快照文件。',
  'POST /api/cards/cache': '只读卡档。',
  'POST /api/world/footprint': '只读占用。',
  'GET /api/*': '其余 GET 都是只读（/api/state 见上）。',
};
const KEY = (p, m) => String(m || 'GET').toUpperCase() + ' ' + String(p || '');
const REQUIRED_MAP = new Set(REQUIRED.map(x => KEY(x[1], x[0])));
function needsLock(path, method) {
  if (String(method || '').toUpperCase() !== 'POST') return false;   // GET 全部只读（/api/state 自己 tryHold）
  return REQUIRED_MAP.has(KEY(path, method));
}
module.exports = { configure, peek, busyMsg, tryHold, release, enter, exit, needsLock, REQUIRED, EXEMPT, REQUIRED_MAP, forcedCount: () => __forced };
