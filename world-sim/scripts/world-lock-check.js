// world-lock-check.js — 世界级单写锁（v1.98 · P0-2）
// 病：内存里的世界是**进程级单例**，而会改它的 HTTP 入口有三十多条（其中十来条还会 await LLM）。
// 两个入口交错执行 = 世界被推到"逻辑上不存在的状态"：时钟推两次、NPC 走两遍、账本两次追加。
// 而且它是前端可达的（短信按钮不置忙）。这个脚本守三件事：
//   ① 锁本身（互斥 / 释放 / 超时强解 / 忙话术）
//   ② **覆盖面**（读 server.js 源码做静态自检：会改世界的路由块必须在锁的清单里）
//   ③ 前后端的话术与置位（被拒 ≠ 失败；静默 return 不许存在）
'use strict';
const path = require('path'), os = require('os'), fs = require('fs');
const TMP = path.join(os.tmpdir(), 'ws-lock-' + Date.now());
process.env.WORLD_SIM_DATA = TMP; fs.mkdirSync(TMP, { recursive: true });
const ROOT = path.join(__dirname, '..');
process.env.WORLD_SIM_ASSETS = ROOT;
const WL = require(ROOT + '/src/worldlock');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const sv = fs.readFileSync(ROOT + '/server.js', 'utf8');
const am = fs.readFileSync(ROOT + '/public/app.js', 'utf8');

console.log('');
console.log('世界锁：互斥 / 超时 / 覆盖面 / 前后端一致');

// ── ① 锁本身 ──
{
  const h1 = WL.tryHold('甲', 60000);
  ok(!!h1, '空锁能拿到');
  ok(WL.tryHold('乙', 60000) === null, '★ 已被占时拿不到（互斥）');
  const p = WL.peek();
  ok(p && p.what === '甲' && typeof p.ms === 'number', 'peek 报出"谁在占用 + 占了多久"：' + JSON.stringify(p && p.what));
  ok(WL.busyMsg().indexOf('等它演完再点') >= 0, '忙话术是给玩家看的：' + JSON.stringify(WL.busyMsg()));
  ok(!/损坏|不存在/.test(WL.busyMsg()), '★ 忙话术里不许混进 P0-1 的"不存在/损坏"（两种故障两种话）');
  WL.release(h1);
  ok(WL.peek() === null, 'release 之后锁是空的');
  const h2 = WL.tryHold('丙', 60000);
  WL.release(null);
  ok(WL.peek() !== null, '★ release(null) 不会误放别人的锁（只能放自己拿的那把）');
  WL.release(h2);
}
// ── ② 超时：一个入口挂住不许把世界锁死 ──
{
  let forced = '';
  WL.configure({ onForceRelease: (m) => { forced = m; } });
  const h = WL.tryHold('挂住的回合', 60);           // 上限 60ms
  ok(WL.tryHold('后来的', 60000) === null, '还没到上限时，后来的照样拿不到');
  const t0 = Date.now(); while (Date.now() - t0 < 90) { /* 等它过期 */ }
  const h2 = WL.tryHold('后来的', 60000);
  ok(!!h2, '★ 到上限后锁被强制释放（否则一次 LLM 挂住 = 游戏永久卡死）');
  ok(forced.indexOf('强制释放') >= 0 && forced.indexOf('挂住的回合') >= 0, '★ 强制释放留了一笔日志：' + JSON.stringify(forced.slice(0, 40)));
  ok(WL.forcedCount() >= 1, '强制释放次数可查（forcedCount=' + WL.forcedCount() + '）');
  WL.release(h2); WL.release(h);
}
// ── ③ 分发器入口：拿不到就拒绝（带上 busy 标记） ──
{
  const h = WL.tryHold('占着', 60000);
  const ent = WL.enter('/api/turn', 'POST', 60000);
  ok(ent.mode === 'reject', '★ 要锁的入口拿不到 → reject');
  ok(ent.msg === WL.busyMsg(), '拒绝时带的是同一句忙话术');
  ok(WL.enter('/api/deg', 'POST', 60000).mode === null, '不在清单里的入口不受影响（不拿锁）');
  ok(WL.enter('/api/state', 'GET', 60000).mode === null, 'GET 一律不走这把锁（/api/state 自己 tryHold）');
  WL.release(h);
  const ent2 = WL.enter('/api/turn', 'POST', 60000);
  ok(ent2.mode === 'hold' && !!ent2.handle, '空锁时正常拿到');
  WL.exit(ent2);
  ok(WL.peek() === null, 'exit 放锁');
}
// ── ④ 声明表：A 组（长任务）与 B 组（同步改世界）都在 ──
{
  const must = ['/api/turn', '/api/turn/stream', '/api/skip', '/api/msg/send', '/api/world/load', '/api/world/del',
    '/api/reset', '/api/snapshot/load', '/api/snapshot/stepback', '/api/snapshot/save', '/api/doc/read',
    '/api/claim/save', '/api/worldinfo/save', '/api/worldinfo/del', '/api/msg/read', '/api/msg/readall',
    '/api/schema/register', '/api/framework/level', '/api/player-name', '/api/wxmark', '/api/settings',
    '/api/new', '/api/world/gen', '/api/demo', '/api/cards/launch', '/api/cards/del', '/api/save/import',
    '/api/save/repair', '/api/comfy/render', '/api/comfy/person', '/api/person/look', '/api/image/workflow', '/api/storage/clean'];
  const missing = must.filter(x => !WL.REQUIRED_MAP.has('POST ' + x));
  ok(missing.length === 0, '★ 33 条已知写入口全部在清单里（缺：' + JSON.stringify(missing) + '）');
  ok(Object.keys(WL.EXEMPT).length >= 10, '豁免项逐条写了理由（' + Object.keys(WL.EXEMPT).length + ' 条）');
}
// ── ⑤ 覆盖面自检：读源码，凡会改世界的路由块都必须被锁覆盖 ──
{
  const lines = sv.split('\n');
  const MARK = /persist\(\)|current = |saveWorld\(|saveMeta\(|unloadWorld\(|G\.runTurn|G\.sendMessage|SNAP\.take|SNAP\.restore|mergeDupPersons|stampImgOnBeat|unlinkSync\(worldFile/;
  const blocks = [];
  let cur = null;
  for (const line of lines) {
    const m = /^      if \(u\.pathname === '(\/api\/[^']+)'\)/.exec(line);
    if (m) { cur = { p: m[1], body: [] }; blocks.push(cur); continue; }
    if (/^      return json\(res, 404/.test(line)) { cur = null; continue; }
    if (cur) cur.body.push(line);
  }
  ok(blocks.length > 30, '从源码里切出了路由块（' + blocks.length + ' 个）');
  const mutations = blocks.filter(b => MARK.test(b.body.join('\n')));
  const uncovered = mutations.filter(b => !WL.REQUIRED_MAP.has('POST ' + b.p) && !WL.EXEMPT['POST ' + b.p]
    && !(b.p === '/api/state' && WL.EXEMPT['GET /api/state']));
  ok(mutations.length >= 25, '识别出会改世界的路由块（' + mutations.length + ' 个）');
  ok(uncovered.length === 0, '★ 每一个会改世界的路由块都在锁的清单里（漏的：' + JSON.stringify(uncovered.map(x => x.p)) + '）');
  // 反证：清单里不许有"源码里根本不存在"的路径（写错了名字等于没锁）
  const paths = new Set(blocks.map(b => b.p));
  const ghosts = Array.from(WL.REQUIRED_MAP).map(k => k.replace('POST ', '')).filter(x => !paths.has(x));
  ok(ghosts.length === 0, '★ 清单里没有打错名字的路径（幽灵项：' + JSON.stringify(ghosts) + '）');
}
// ── ⑥ 接入点：唯一执行点 + GET /api/state 的特例 + 锁的 finally ──
{
  ok((sv.match(/WL\.enter\(/g) || []).length === 1, '★ 拿锁只有一处（分发器里）：' + (sv.match(/WL\.enter\(/g) || []).length + ' 处');
  ok((sv.match(/WL\.exit\(/g) || []).length === 1, '放锁也只有一处（finally 里）');
  ok(/\} finally \{\s*\n\s*\/\* v1\.98 · P0-2：锁必须在 finally 放/.test(sv), '★ 放锁在 finally —— 任何一条 return / 异常都不许把世界锁死');
  ok(/uPath = u\.pathname/.test(sv) && /GL\('★ 500 ' \+ req\.method \+ ' ' \+ uPath/.test(sv), '★ catch 里用的是块外变量（原来引用 try 里的 u ⇒ catch 自己抛 ReferenceError，500 不回包）');
  ok(/const __hh = WL\.tryHold\('GET \/api\/state 自愈'\)/.test(sv), '★ GET /api/state 的自愈写盘走 tryHold（拿不到就跳过，不能拒绝它）');
  ok(/finally \{ WL\.release\(__hh\); \}/.test(sv), 'state 自愈那条也要放锁');
  ok(/view\.busy = WL\.peek\(\)/.test(sv), '★ /api/state 把"世界正忙"外挂到视图（服务端说，前端不猜）');
  ok(!/^\s*let __turnBusy/m.test(sv) && !/[^\w]__turnBusy\s*=/.test(sv.replace(/\/\*[\s\S]*?\*\//g, '')), '★ 旧的 __turnBusy 已退场（同一规则只留一处实现）');
  ok(/persist\(\); autoSnap\(\); traceAppend\(\);   \/\/ v1\.98：原来这条漏了 traceAppend/.test(sv), '/api/skip 补上了 traceAppend（原来睡觉/等待的调取留痕是空的）');
}
// ── ⑦ 前端：忙态的两个来源 / 被拒有话术 / 不再静默 return ──
{
  ok(/let __localBusy = false;/.test(am) && /let __srvBusy = false;/.test(am), '前端忙态有两个来源（本地乐观 + 服务端说）');
  ok(/function setBusy\(b, fromServer\)/.test(am), 'setBusy 能区分来源');
  ok(/setBusy\(!!view\.busy, true\)/.test(am), '★ refresh 采纳服务端的忙态');
  ok(/e\.busy = !!j\.busy/.test(am), '★ api() 把 busy 标记带到错误对象上（同一句话两种处理）');
  ok(/if \(!inp\.value \|\| busy\) return;/.test(am) === false, '★ 短信按钮不再静默 return（点了必须有反应）');
  ok(/if \(busy\) \{ toast\('世界正在运转，稍等…', false\); return; \}/.test(am), '短信按钮忙时明说');
  ok(/setBusy\(true\);\s*\n\s*bt\.textContent = '…';/.test(am), '★ 短信发送期间置忙（这正是评审认定的前端可达并发入口）');
  ok(/e2\.busy\) \{\s*\n\s*toast\('世界还在演算上一回合（它会自己完成）/.test(am), '★ 被世界锁拒绝 ≠ 回合失败（abort 只断客户端，服务端那一回合还在跑）');
  ok(/__localBusy = false; __srvBusy = false;/.test(am), '页面报错解锁时三个标记一起清（不会卡在"世界在运转…"）');
}

console.log('');
console.log('==== world-lock-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
