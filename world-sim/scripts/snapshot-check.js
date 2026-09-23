// snapshot-check.js — v1.48 红线：快照（防 AI 犯病把存档搞坏）
// 规格来自用户：「5 个自动存档位 + 15 个手动存档位，自动的新的覆盖最旧的：1,2,3,4,5 → 6 进来则 2,3,4,5,6」
// 用法: node scripts/snapshot-check.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
// 隔离数据根：绝不碰用户存档（%APPDATA%/world-sim）
const TMP = path.join(__dirname, '..', '..', '.tmp-snap');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
process.env.WORLD_SIM_DATA = TMP;

const SNAP = require('../src/snapshot');
const W = require('../src/world');

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  << ' + extra : '')); }
};
const mkWorld = (turn) => { const d = W.buildDemoWorld(); d.id = (p) => p + '_x'; d.current.turnN = turn; d.meta.name = '测试世界'; return d; };
const WID = 'w__snaptest';

// ---------- [1] 环形：用户的例子逐字验 ----------
console.log('\n[1] 自动位环形（1,2,3,4,5 → 第 6 次落回 1）');
(function () {
  for (let i = 1; i <= 6; i++) {
    const r = SNAP.take(mkWorld(i), WID, 'auto');
    if (!r.ok) { ok(false, '第 ' + i + ' 次自动存档应成功', r.err); return; }
  }
  const files = fs.readdirSync(SNAP.snapDir(WID)).filter(f => /^auto-\d+\.json$/.test(f));
  ok(files.length === SNAP.AUTO_SLOTS, '自动位只留 ' + SNAP.AUTO_SLOTS + ' 个文件（收到 ' + files.length + '）', files.join(','));
  const map = {};
  for (let s = 1; s <= 5; s++) { const r = SNAP.read(WID, 'auto', s); if (r.ok) map[s] = r.world.current.turnN; }
  ok(map[1] === 6, '第 6 次**覆盖了最旧的 1 号位**（1 号位现在是第 6 次）', JSON.stringify(map));
  ok(map[2] === 2 && map[3] === 3 && map[4] === 4 && map[5] === 5, '其余位保持 2,3,4,5 —— 顺序即 2,3,4,5,6', JSON.stringify(map));
  const latest = SNAP.latestAuto(WID);
  ok(latest && latest.slot === 1, 'latestAuto = 最新那份（1 号位）', JSON.stringify(latest && latest.slot));
  const prev = SNAP.prevAuto(WID);
  ok(prev && prev.slot === 5, '★「回退一步」取的是**上一个**存档点（最新那份=现在，退它等于没退）', JSON.stringify(prev && prev.slot));
  const p5 = SNAP.read(WID, 'auto', 5);
  ok(p5.ok && p5.world.current.turnN === 5, '上一个存档点里是第 5 次那一刻（撤销最后一个回合）', String(p5.ok && p5.world.current.turnN));
})();

// ---------- [2] 手动位：15 个、满了要明说 ----------
console.log('\n[2] 手动位（15 个）');
(function () {
  for (let i = 0; i < 15; i++) {
    const r = SNAP.take(mkWorld(100 + i), WID, 'manual');
    if (!r.ok) { ok(false, '第 ' + (i + 1) + ' 次手动存档应成功', r.err); return; }
  }
  const used = SNAP.list(WID).filter(x => x.kind === 'manual');
  ok(used.length === 15, '手动位存满 15 个', String(used.length));
  const over = SNAP.take(mkWorld(999), WID, 'manual');
  ok(!over.ok && /满/.test(over.err || ''), '再存第 16 个 → **明确说满了**（不是静默覆盖）', JSON.stringify(over));
  const bad = SNAP.take(mkWorld(1), WID, 'manual', 99);
  ok(!bad.ok && /范围/.test(bad.err || ''), '越界位号被拒（1~15）');
  const overwrite = SNAP.take(mkWorld(777), WID, 'manual', 3);
  ok(overwrite.ok && SNAP.read(WID, 'manual', 3).world.current.turnN === 777, '指定位号可以覆盖');
})();

// ---------- [3] 快照 = 存档的完整副本 ----------
console.log('\n[3] 内容是一份完整副本');
(function () {
  const d = mkWorld(42);
  d.entities.npc_test = { id: 'npc_test', type: 'person', name: '测试人', state: { location: d.current.sceneId } };
  d.documents = { doc_t: { id: 'doc_t', title: '一封信', body: '正文正文正文正文', tags: ['信'] } };
  SNAP.take(d, WID, 'manual', 15);
  const r = SNAP.read(WID, 'manual', 15);
  ok(r.ok && r.world.entities.npc_test && r.world.entities.npc_test.name === '测试人', '实体跟着走');
  ok(r.ok && r.world.documents && r.world.documents.doc_t && r.world.documents.doc_t.body === '正文正文正文正文', '文书对象跟着走（v1.46/47 的新数据也在快照里）');
  ok(r.ok && r.world.current.turnN === 42, '回合数一致');
})();

// ---------- [4] 坏快照不许把系统带崩 ----------
console.log('\n[4] 坏快照：看得见、不炸');
(function () {
  fs.writeFileSync(SNAP.slotFile(WID, 'auto', 3), '{这不是 JSON', 'utf8');
  const l = SNAP.list(WID).filter(x => x.kind === 'auto' && x.slot === 3);
  ok(l.length === 1 && l[0].corrupt === true, '列表里被标成「坏了」（玩家看得见哪一格坏）', JSON.stringify(l[0] && l[0].corrupt));
  const r = SNAP.read(WID, 'auto', 3);
  ok(!r.ok && !!r.err, '读坏快照 → 返回错误而不是抛异常', JSON.stringify(r));
  const l2 = SNAP.list(WID);
  ok(l2.length >= 5, '其余快照不受影响（照常列出 ' + l2.length + ' 条）');
  const latest = SNAP.latestAuto(WID);
  ok(latest && !latest.corrupt, '「回退一步」不会挑到坏的那份');
})();

// ---------- [5] 原子写 + 独立目录 ----------
console.log('\n[5] 落盘方式');
(function () {
  const dir = SNAP.snapDir(WID);
  const tmps = fs.readdirSync(dir).filter(f => f.endsWith('.tmp'));
  ok(tmps.length === 0, '不留 .tmp 残file（原子写：tmp → rename）', tmps.join(','));
  const root = path.resolve(SNAP.rootDir());
  const worlds = path.resolve(TMP, 'data', 'worlds');
  ok(root.indexOf(worlds) < 0 && worlds.indexOf(root) < 0, '快照在**独立目录**（世界文件写坏时快照还在）', root);
})();

// ---------- [6] 恢复：世界回到那一刻 ----------
console.log('\n[6] 恢复语义');
(function () {
  const d = mkWorld(7);
  SNAP.take(d, WID, 'manual', 1);
  // 之后 AI 犯病：世界被改烂
  d.current.turnN = 999;
  d.entities.player.name = '被改坏的名字';
  d.sceneLog = [];
  const r = SNAP.read(WID, 'manual', 1);
  ok(r.ok && r.world.current.turnN === 7 && r.world.entities.player.name !== '被改坏的名字', '读回来的世界是**快照那一刻**（回合/实体都回去了）', JSON.stringify({ turn: r.world.current.turnN, name: r.world.entities.player.name }));
  const pre = SNAP.takePreRestore(d, WID);
  ok(pre.ok, '读取前留一份「你读取之前」（不占 5/15 配额）');
  const back = SNAP.readPreRestore(WID);
  ok(back.ok && back.world.current.turnN === 999, '那份「之前」记的是被改烂的状态（读错了还能回去）');
  const used = SNAP.list(WID).filter(x => x.kind === 'manual').length;
  ok(used === 15, 'pre-restore 没有挤掉手动位（仍是 15 个）', String(used));
})();

// ---------- [7] 写失败不许影响回合 ----------
console.log('\n[7] 失败隔离');
(function () {
  const weird = path.join(TMP, 'data', 'snapshots', 'blocked');
  fs.mkdirSync(path.dirname(weird), { recursive: true });
  fs.writeFileSync(weird, 'not a dir', 'utf8');           // 让目录名被一个文件占住 → 写必然失败
  const r = SNAP.take(mkWorld(1), 'blocked', 'auto');
  ok(!r.ok && !!r.err, '写不进去时返回错误（调用处 try/catch 包住，**这一回合照常完成**）', JSON.stringify(r));
  const d = mkWorld(1);
  const r2 = SNAP.read('blocked', 'auto', 1);
  ok(!r2.ok, '读不到也不抛异常');
  ok(!!d && d.current.turnN === 1, '世界对象毫发无损');
})();

fs.rmSync(TMP, { recursive: true, force: true });
console.log('\n==== snapshot-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
