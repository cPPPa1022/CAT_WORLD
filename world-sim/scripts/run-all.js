// run-all.js — 全量脚本运行器（M0「尺子」）
// v2.05：这段注释原来写着"45 个脚本…四类"，而实测是 **109 条登记 / 6 类**（A 断言 / B 需服务器 /
//        C 需外部依赖 / D 观察 / E 危险 / F 写产出）—— 说明注释是跟着人走的，得跟代码一起改。
// 目的：跑完打印一张表；**断言类（A）任何一条不是"通过"，本进程就非零退出** ——
//       "失败""超时""起不来""缺失""被杀""不可判读"六种都算红灯（v2.05 起，见下面判定段）。
// 隔离：全部子脚本在临时数据目录下运行（WORLD_SIM_DATA），绝不碰 %APPDATA%/world-sim 的用户存档；
//       直接 require('../server') 的两支脚本另有自证守卫。
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');

// ---------- 分类表：这是唯一真源，新增脚本请登记在这里 ----------
const T = [
  // [文件名, 类别, 超时秒]
  // A = 断言类（自己会设非零退出码，失败即红灯）
  ['gate-check.js', 'A', 60], ['art-check.js', 'A', 60], ['art-perspective-check.js', 'A', 60], ['ui-layout-check.js', 'A', 60], ['card-scan-check.js', 'A', 60], ['llm-config-check.js', 'A', 60], ['doc-fx-check.js', 'A', 90], ['snapshot-check.js', 'A', 90], ['framework-check.js', 'A', 90], ['savepack-check.js', 'A', 90], ['repair-check.js', 'A', 90], ['persona-check.js', 'A', 60], ['record-check.js', 'A', 60], ['query-check.js', 'A', 60], ['gate-check2.js', 'A', 60], ['switch-check.js', 'A', 60], ['content-check.js', 'A', 60], ['img-policy-check.js', 'A', 60], ['img-size-check.js', 'A', 60], ['scan-fallback-check.js', 'A', 60], ['scan-analyze-check.js', 'A', 90], ['corrupt-check.js', 'A', 60], ['bond-stage-check.js', 'A', 60], ['truncate-check.js', 'A', 60], ['img-stuck-check.js', 'A', 60], ['ui-loop-check.js', 'A', 60], ['img-kind-check.js', 'A', 60], ['img-bind-check.js', 'A', 60], ['selftest.js', 'A', 60],
  ['mem-recall.js', 'A', 60], ['mem-behavior-check.js', 'A', 60], ['money-check.js', 'A', 60], ['rel-check.js', 'A', 60],
  ['scene-check.js', 'A', 60], ['wx-check.js', 'A', 60], ['wx-perc-check.js', 'A', 60],
  ['token-est.js', 'A', 60], ['stripthink-check.js', 'A', 60], ['img-smoke.js', 'A', 90],
  ['png-all-parse.js', 'A', 60], ['opening-fold.js', 'A', 60], ['greeting-smoke.js', 'A', 90],
  ['cardbox-smoke.js', 'A', 90], ['card-vs-world.js', 'A', 90],
  ['ui-shell-check.js', 'A', 60],   // v1.84：§8 列为"每天必跑"，却一直没登记进分类表 → 日常回归漏掉全部壳层不变量
  ['ui-content-check.js', 'A', 30],   // v2.05：**字段→屏幕**的棘轮（P2-1 —— V.loose/V.myLog 曾在隐藏容器里躺了六个版本）
  ['updatetypes-check.js', 'A', 30],   // v1.84：白名单 ⊆ 执行器 + 校验器四条
  ['degrade-check.js', 'A', 30],   // v1.86：静默降级的棘轮（只许减不许增）
  ['import-relations-check.js', 'A', 30],   // v2.06：关系网/身份档案/浅拷/清单守卫 —— 这一批"静默丢数据"各钉一根柱子
  // v2.09：**「这些功能到底有没有被用过」**的尺子 —— 观察类（D），不参与红灯，
  //        因为它量的是"产物"，在一份全新的临时数据根里本来就该全是 0。
  //        手动跑（默认扫用户存档）：node scripts/reality-check.js
  //        要它变红（当发布闸门）：node scripts/reality-check.js --assert
  ['anchor-check.js', 'A', 30],   // v2.10「有主」：可观察物必须挂在已有的因上（顺带修了"造人这条路是死的"）
  ['reality-check.js', 'D', 30],
  ['dist-check.js', 'A', 30],   // v2.06：**交付副本 == 源码**（漏同步 = 源码修好了、用户打开还是老样子，而全部断言全绿）
  ['name-gate-check.js', 'A', 30],   // v2.06：名字门控出口（P1-1 E1/E2/E5/E6/E7b —— 没见过的人的名字到不了玩家眼前）
  ['replay-check.js', 'A', 30],   // v1.86：账本重放对账
  ['rebuild-check.js', 'A', 30],   // v1.87：账本重建（按账本修回去 + 边界）
  ['retention-check.js', 'A', 30],   // v1.87：统一留存策略（阈值一处 + 溢出落盘）
  ['scan-position-check.js', 'A', 30],   // v1.88：扫描落点（别人不许被兜进玩家家）
  ['conflict-loop-check.js', 'A', 30],   // v1.97：冲突回灌可达（修 X1 —— messages 作用域）
  ['secret-tier-check.js', 'A', 30],   // v1.97：秘密档可达（修 X2/X3 —— 有档 ≠ 见过）
  ['conflict-produce-check.js', 'A', 30],   // v1.97：冲突产生端六条规则逐条会响
  ['gate-channels-check.js', 'A', 30],   // v1.97：输出侧门控的通道覆盖（X4/X5/X9/X10）
  ['output-hygiene-check.js', 'A', 30],   // v1.97：不过度外发 / 不留死物（X6/X7/X11/X12）
  ['candidate-life-check.js', 'A', 30],   // v1.97：候选的寿命与上限（X8 —— expireAt 从没人读到有人读）
  ['news-impact-check.js', 'A', 30],   // v1.97：新闻影响三字段的消费者（X8 —— 时长/范围真用，严重性砍掉）
  ['atomic-write-check.js', 'A', 60],   // v1.98：原子写与"崩溃不坏档"（P0-1 —— 提交点是 rename）
  ['world-lock-check.js', 'A', 30],   // v1.98：世界级单写锁（P0-2 —— 互斥/超时/覆盖面自检）
  ['ledger-immutable-check.js', 'A', 30],   // v1.98：账本不可改写 + 勘误事件（P0-3）
  ['validator-loop-check.js', 'A', 60],   // v1.98：校验器闭环（P0-4 —— 结构化拒绝 + 回合内修正轮）
  ['severity-gate-check.js', 'A', 30],   // v1.98：事件烈度门（P0-5 第 1 步 —— 无条件执行 + 词表唯一）
  ['admit-event-check.js', 'A', 30],   // v1.99：引擎自产事件的裁决门（P0-5 第 2 步 —— 上限/前兆/节奏/留痕）
  ['custom-action-check.js', 'A', 60],   // v2.00：自定义动作的洞 + NPC 位置门（P0-6 第一批）
  ['bus-check.js', 'A', 60],   // v2.01：世界写入总线（P0-6 —— 生成器只产出提议 + news/候选也走它）
  ['memory-depth-check.js', 'A', 30],   // v2.04：记忆深度一套算法（P1-2 —— 检索真的会忘 / 激活真的会牢）
  ['contract-check.js', 'A', 30],   // S0：契约单一真源（白名单 <=> 执行器 <=> 提示词，三处一致）
  /* v3.20：钱与账（用户实测 OOC：「转钱 不够明显吗 2020年没有微信吗」）——
     白名单两种新类型 / 资料包里的钱包 / 校验器的余额门 / 执行器真的扣钱 / 状态简介看得见。 */
  ['money-account-check.js', 'A', 60],
  /* v3.18–v3.19 那批脚本原来只写在交接文档 §8、**没登记进这张表** ——
     没登记的脚本在日常回归里根本不会跑到（v1.99 就为这件事记过一笔）。这次一并补上。 */
  ['frame-lifecycle-check.js', 'A', 60], ['story-flow-check.js', 'A', 60],
  ['turn-stamp-check.js', 'A', 30], ['opening-picker-check.js', 'A', 60],
  ['context-order-check.js', 'A', 30],   // S1：资料包键序（稳定字段必须在前 —— 前缀缓存）
  ['context-cache-check.js', 'A', 60],   // S1：前缀缓存不变量（system 逐字节稳定 / 模块说明随资料包 / 计量口径）
  ['player-contract-check.js', 'A', 60],   // v1.90 玩家侧契约（结果行交付 / beat 槽位不拍平 / 悬着的事第二投影与门控）
  ['storyteller-check.js', 'A', 60],   // v1.91 叙事者（油门）：预设推导 / 张力三输入+空闲 / 门槛冷却适应度 / 补偿 / 零 token / 不可见
  ['module-gate-check.js', 'A', 30],   // v1.92 **属性级**开关检查（量产物不量源码：模块关掉时词汇必须是 0）
  ['threads-check.js', 'A', 30],   // v1.93 「悬着的线」唯一推导点（折叠只许有一份 / 门控只作用于玩家 / 三个出口一致）
  ['actor-check.js', 'A', 60],   // v1.94 角色分工：引擎先问（常态化/限量/并行）+ 原话直达 + 兜底交付 + 认知包补字段
  ['memory-gate-check.js', 'A', 30],   // v1.96 记忆写入门（低分寒暄不进库 / 标记词过关 / 引擎自写按标签限量 / 不丢）
  // B = 需要先起服务器（PORT 由环境变量给）
  ['api-smoke.js', 'B', 60], ['stream-test.js', 'B', 60], ['msg-async-test.js', 'B', 60],
  // C = 需要外部依赖（真模型 API / ComfyUI）——没配就跳过
  ['api-smoke.js#live', 'C', 60], ['jailbreak-arena.js', 'C', 120], ['comfy-probe.js', 'C', 60],
  ['realcard-test.js', 'C', 90], ['scan-npc.js', 'C', 90], ['scan2.js', 'C', 90], ['png-scan.js', 'C', 60],
  // D = 观察类（退出码恒 0，只打印，不是测试）
  ['anchor-scan.js', 'D', 60], ['peek-cards.js', 'D', 60], ['wb-dump.js', 'D', 60], ['qc.js', 'D', 60],
  ['curr-dbg.js', 'D', 60], ['comfy-probe.js#obs', 'D', 60],   // v2.06：删掉 epoch-test.js#obs（它和 A 段那条是同一个文件，跑两遍）
  /* v1.99：把 4 个"脚本存在但从没登记"的观察脚本补进分类表（不登记 = 日常回归里根本不会跑到） */
  ['arch-profile.js', 'D', 60], ['art-cache-test.js', 'D', 60], ['rp-check.js', 'D', 60], ['scrub-test.js', 'D', 60],
  /* v2.06（P1-5）：这 10 个原来登记在 A 类，但它们**既没有断言助手、也没有非零退出** ——
     意思是"跑挂了也是绿的"，而回归表上照样印 ✅ 通过（本册要修的那种"看起来通过"）。
     它们本身是有用的观察脚本（打印场景/开场/回忆的实际取值），所以不是删掉，是**如实降级为 D**：
     照样跑、照样打印，只是不再冒充断言。要把它们变回 A，就得先写真断言。 */
  ['epoch-test.js', 'D', 60], ['travel-test.js', 'D', 60], ['recall-test.js', 'D', 60],
  ['openings-test.js', 'D', 60], ['offstage-test.js', 'D', 60], ['spotlight-test.js', 'D', 60],
  ['stage-test.js', 'D', 60], ['ccv3-test.js', 'D', 60], ['resolve-test.js', 'D', 60], ['wf-ui-test.js', 'D', 60],
  // E = 危险：会改 src 源文件，永不自动跑
  ['fix-import.js', 'E', 0],
  // F = 会写产出（打包/导入预设），默认不跑
  ['bundle.js', 'F', 0],   // v1.84：删掉 'import-preset.js' —— 那个文件不存在（残留在 scripts/_backup/），每次跑都报"缺失"
];
const HEAD = { A: '断言类（应该红绿分明）', B: '需先起服务器', C: '需外部依赖(真模型/ComfyUI)', D: '观察类(只看不判)', E: '危险(会改源码)', F: '写产出(默认不跑)' };

const only = process.argv.slice(2).filter(a => a[0] !== '-');
const wantAssertOnly = process.argv.indexOf('--assert-only') >= 0;

const TMP = path.join(os.tmpdir(), 'worldsim-runall-' + Date.now());
fs.mkdirSync(TMP, { recursive: true });
const env = Object.assign({}, process.env, {
  WORLD_SIM_DATA: TMP,
  WORLD_SIM_ASSETS: ROOT,
  PORT: process.env.PORT || '3899',
  NO_COLOR: '1',
});

const rows = [];
for (const [file, cat, sec] of T) {
  const base = file.split('#')[0];
  if (only.length && only.indexOf(base) < 0) continue;
  const full = path.join(ROOT, 'scripts', base);
  /* v2.05（P1-5 §5.1）：**缺失 = 失败**。原来只写「缺失」，而下面的统计只认 ❌ 前缀 ⇒
     一个被删掉的脚本会让回归"看起来全绿"。 */
  if (!fs.existsSync(full)) { rows.push({ file, cat, status: '❌ 缺失', ms: 0 }); continue; }
  if (cat === 'E' || cat === 'F') { rows.push({ file, cat, status: '跳过(白名单外)', ms: 0 }); continue; }
  if (wantAssertOnly && cat !== 'A') { rows.push({ file, cat, status: '跳过(--assert-only)', ms: 0 }); continue; }
  const t0 = Date.now();
  /* 受限环境（沙箱）里带管道 stdio 的子进程起不来：r.error 有值、status 为 null。
     这时退回 stdio:'inherit'（不捕获输出，但**退出码是真的**）——
     宁可少一行输出尾巴，也不能把「起不来」当成「失败」或「通过」。 */
  let r = spawnSync(process.execPath, [full], { cwd: ROOT, env, encoding: 'utf8', timeout: Math.max(5, sec) * 1000, maxBuffer: 8 * 1024 * 1024 });
  let unreadable = false;
  if (r.error && r.status === null) {
    r = spawnSync(process.execPath, [full], { cwd: ROOT, env, stdio: 'inherit', timeout: Math.max(5, sec) * 1000 });
    /* v2.05（P1-5 §5.1-5）：退回 inherit 时**读不到输出** ⇒ 无法执行"断言计数"协议。
       原来它照样按退出码印 ✅ —— 那正是"看起来通过"的来源。现在算**不可判读**（A 类计失败）。 */
    unreadable = true;
  }
  const ms = Date.now() - t0;
  let status;
  if (r.error && r.error.code === 'ETIMEDOUT') status = '❌ 超时';
  else if (r.error && r.status === null) status = '❌ 起不来(' + (r.error.code || 'spawn') + ')';
  else if (r.signal) status = '❌ 被杀(' + r.signal + ')';   // v2.05：被杀 = 失败（原来只记一行）
  else if (r.status === 0) status = unreadable ? '⚠ 不可判读(exit 0)' : (cat === 'A' ? '✅ 通过' : '✓ 跑完');
  else if (cat !== 'A') status = '⤫ 环境未满足(exit ' + r.status + ')';   // B/C 类失败不算回归红灯，只是没起服务器/没配模型
  else status = '❌ 失败(exit ' + r.status + ')';
  const tail = String(r.stdout || '').trim().split(/\r?\n/).slice(-1)[0] || '';
  rows.push({ file, cat, status, ms, tail: tail.slice(0, 90) });
}

// ---------- 输出 ----------
const out = [];
out.push('世界模拟器 · 全量脚本运行器');
out.push('数据目录(隔离): ' + TMP);
out.push('');
for (const cat of ['A', 'B', 'C', 'D', 'E', 'F']) {
  const rs = rows.filter(x => x.cat === cat);
  if (!rs.length) continue;
  out.push('【' + cat + '】' + HEAD[cat] + '  (' + rs.length + ')');
  for (const x of rs) out.push('  ' + (x.status + '                    ').slice(0, 20) + x.file.padEnd(24) + (x.ms ? Math.round(x.ms / 100) / 10 + 's' : '') + (x.tail ? '   ' + x.tail : ''));
  out.push('');
}
const A = rows.filter(x => x.cat === 'A');
/* v2.06（P1-5）：A 类里"判不了红"的脚本**当场点名**。
   判据：源码里既没有断言助手（ok(/assert()，也没有非零退出（process.exit）——
   这种脚本跑挂了也是绿的，而回归表会印 ✅（正是"看起来通过"的来源）。
   v2.06 已经把当时那 10 个如实降级为 D；这条报告是防止**新的**假断言再溜进来。 */
const hollow = A.filter(x => {
  try {
    const s = fs.readFileSync(path.join(ROOT, 'scripts', x.file.split('#')[0]), 'utf8');
    return !/ok\(|assert\(/.test(s) && !/process\.exit/.test(s);
  } catch (e) { return false; }
}).map(x => x.file);
/* v2.05（P1-5 §5.1-4）：**判定与统计同源** —— 两者都只认 status 这一个真源，
   并且做一次恒等式自检（通过 + 失败 + 跳过 + 不可判读 == 总数），免得又出现"统计口径"与"显示口径"两套。 */
const pass = A.filter(x => x.status.indexOf('✅') === 0).length;
const fail = A.filter(x => x.status.indexOf('❌') === 0).length;
const unread = A.filter(x => x.status.indexOf('⚠') === 0).length;
const skip = A.length - pass - fail - unread;
out.push('==== 断言类: ' + pass + ' 通过 / ' + fail + ' 失败' + (unread ? (' / ' + unread + ' 不可判读') : '') + (skip ? (' / ' + skip + ' 跳过') : '') + '（共 ' + A.length + '） ====');
if (pass + fail + unread + skip !== A.length) out.push('⚠ 统计不自洽：' + [pass, fail, unread, skip].join('+') + ' ≠ ' + A.length + '（判定与统计口径分叉了）');
if (hollow.length) out.push('⚠ A 类里还有 ' + hollow.length + ' 个"判不了红"的脚本（既无断言助手、也无非零退出）：' + hollow.join('、') + ' —— 它们现在跑挂了也是绿的');
fs.writeFileSync(path.join(TMP, 'run-all.json'), JSON.stringify({ rows, pass, fail, unread, skip }, null, 1));
console.log(out.join('\n'));
process.exitCode = (fail || unread) ? 1 : 0;   // v2.05：不可判读也当红灯（"看起来通过"正是它造成的）
