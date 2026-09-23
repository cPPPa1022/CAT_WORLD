// snapshot.js — 世界快照（防 AI 犯病把存档搞坏）
// ─────────────────────────────────────────────────────────────
// 用户规格（2026-09-14）：
//   「做一个快照（防止 ai 犯病给存档搞坏），快照就是 ai 回复完之后给存个档
//    （类似于 galgame 里面的快速存档/快速读取）。每个存档有 5 个自动存档位和 15 个手动存档位，
//    自动存档新的覆盖最旧的：1,2,3,4,5 此时 6 存进来，则 2,3,4,5,6」
// 三条设计约束：
//   ① **独立于世界文件**——世界文件被写坏时，快照必须还在（所以另存一个目录）；
//   ② **不能反过来把回合搞坏**——写快照失败绝不影响这一回合（调用处全部 try/catch 包住）；
//   ③ **原子写**——先写 .tmp 再 rename，断电/崩溃不会留下半个 JSON。
'use strict';
const DEG = require('./degraded');
const fs = require('node:fs');
const path = require('node:path');
const { resBase, stripBom } = require('./store');

const AUTO_SLOTS = 5;      // 自动位：环形，新的覆盖最旧的
const MANUAL_SLOTS = 15;   // 手动位
const SNAP_VERSION = 1;

function rootDir() { return path.join(resBase(), 'data', 'snapshots'); }
function snapDir(worldId) { return path.join(rootDir(), String(worldId || 'current').replace(/[^a-zA-Z0-9_-]/g, '')); }
function slotFile(worldId, kind, slot) { return path.join(snapDir(worldId), (kind === 'manual' ? 'manual-' : 'auto-') + Number(slot) + '.json'); }
function indexFile(worldId) { return path.join(snapDir(worldId), '_index.json'); }
function preRestoreFile(worldId) { return path.join(snapDir(worldId), 'pre-restore.json'); }

function readIndex(worldId) {
  try { return JSON.parse(stripBom(fs.readFileSync(indexFile(worldId), 'utf8'))) || {}; } catch (e) { return {}; }
}
function writeIndex(worldId, idx) {
  try {
    fs.mkdirSync(snapDir(worldId), { recursive: true });
    const f = indexFile(worldId), t = f + '.tmp';
    fs.writeFileSync(t, JSON.stringify(idx || {}), 'utf8');
    fs.renameSync(t, f);
  } catch (e) { /* 索引丢了也能跑：退化成按文件时间挑位 */ }
}
/* 原子写：v1.98 起**全项目只有一份实现**（store.writeAtomic）——
   这里原来有个私有副本（tmp+rename），与主存档那条路各写各的，等于"两个真相"。
   本文件本就 require('./store')（见顶部），方向安全，无循环依赖。 */
const { writeAtomic } = require('./store');
function slotOf(name) {
  const m = /^(auto|manual)-(\d+)\.json$/.exec(String(name || ''));
  return m ? { kind: m[1], slot: Number(m[2]) } : null;
}
// 列出某个世界的全部快照（坏文件不抛错，标 corrupt —— 玩家要看得见哪一格坏了）
function list(worldId) {
  const dir = snapDir(worldId);
  let names = [];
  try { names = fs.readdirSync(dir); } catch (e) { return []; }
  const out = [];
  for (const n of names) {
    const s = slotOf(n);
    if (!s) continue;
    const f = path.join(dir, n);
    const row = { kind: s.kind, slot: s.slot, file: f, bytes: 0, t: '', worldT: '', turnN: 0, name: '', corrupt: false };
    try {
      row.bytes = fs.statSync(f).size;
      const j = JSON.parse(stripBom(fs.readFileSync(f, 'utf8')));
      const m = (j && j.__snap) || {};
      row.t = m.t || ''; row.worldT = m.worldT || ''; row.turnN = m.turnN || 0; row.name = m.name || '';
      row.corrupt = !(j && j.world && j.world.entities && j.world.current);
    } catch (e) { row.corrupt = true; }
    out.push(row);
  }
  // 排序：自动位按世界时间/落盘时间倒序（谁最新谁在前），手动位按位号
  out.sort((a, b) => (a.kind === b.kind) ? (a.kind === 'manual' ? a.slot - b.slot : String(b.t).localeCompare(String(a.t))) : (a.kind === 'auto' ? -1 : 1));
  return out;
}
function metaOf(data, kind, slot) {
  return {
    v: SNAP_VERSION, kind: kind, slot: Number(slot), t: new Date().toISOString(),
    worldT: (data.current && data.current.time) || '', turnN: (data.current && data.current.turnN) || 0,
    name: (data.meta && data.meta.name) || '', build: data.__build || ''
  };
}
// 存一格。auto：不给 slot 就走环；manual：不给 slot 就挑第一个空位
function take(data, worldId, kind, slot) {
  const k = (kind === 'manual') ? 'manual' : 'auto';
  const idx = readIndex(worldId);
  let s = Number(slot) || 0;
  if (!s) {
    if (k === 'auto') {
      /* v2.06：索引坏了（缺失/NaN/越界）原来静默落回 1 —— 结果是"自动存档忽然从头开始覆盖"，
         而且没有任何痕迹。现在坏值照旧落 1，但记一笔（/api/diag.degraded 查得到）。 */
      const rawNext = Number(idx.autoNext);
      s = (Number.isFinite(rawNext) && rawNext >= 1 && rawNext <= AUTO_SLOTS) ? rawNext : 1;
      if (idx.autoNext !== undefined && s !== rawNext) {
        DEG.hit('snapshot.js:autoNext', '自动存档环指针是坏值（' + JSON.stringify(idx.autoNext) + '）→ 落回 1');
      }
      idx.autoNext = (s % AUTO_SLOTS) + 1;      // 1,2,3,4,5 → 6 存进来落到 1（画面顺序就成了 2,3,4,5,6）
    } else {
      const used = new Set(list(worldId).filter(x => x.kind === 'manual' && !x.corrupt).map(x => x.slot));
      for (let i = 1; i <= MANUAL_SLOTS; i++) { if (!used.has(i)) { s = i; break; } }
      if (!s) return { ok: false, err: '手动存档位已满（' + MANUAL_SLOTS + ' 个）——先删一个' };
    }
  }
  const max = (k === 'auto') ? AUTO_SLOTS : MANUAL_SLOTS;
  if (s < 1 || s > max) return { ok: false, err: (k === 'auto' ? '自动' : '手动') + '存档位范围 1~' + max + '，收到 ' + s };
  const rec = { __snap: metaOf(data, k, s), world: data };
  const text = JSON.stringify(rec);
  try {
    writeAtomic(slotFile(worldId, k, s), text);
  } catch (e) {
    return { ok: false, err: '写快照失败：' + String(e.message || e) };
  }
  if (k === 'auto') writeIndex(worldId, idx);
  return { ok: true, kind: k, slot: s, bytes: Buffer.byteLength(text, 'utf8') };
}
// 读一格
function read(worldId, kind, slot) {
  const f = slotFile(worldId, kind, slot);
  try {
    const j = JSON.parse(stripBom(fs.readFileSync(f, 'utf8')));
    if (!(j && j.world && j.world.entities && j.world.current)) return { ok: false, err: '这份快照是坏的（内容不完整）' };
    return { ok: true, snap: j.__snap || {}, world: j.world };
  } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: false, err: '这一格还是空的' };
    return { ok: false, err: '这份快照读不出来（' + String(e.message || e).slice(0, 60) + '）' };
  }
}
function remove(worldId, kind, slot) {
  try { fs.unlinkSync(slotFile(worldId, kind, slot)); return { ok: true }; }
  catch (e) { return { ok: false, err: String(e.message || e) }; }
}
// 自动存档按时间倒序（[0] = 最新）
function autosDesc(worldId) {
  return list(worldId).filter(x => x.kind === 'auto' && !x.corrupt)
    .sort((a, b) => String(b.t).localeCompare(String(a.t)));
}
function latestAuto(worldId) { return autosDesc(worldId)[0] || null; }
// ★「回退一步」= **上一个**存档点。
// 为什么要跳过最新那份：自动存档是在 AI 回复**之后**写的，所以最新那份 == 现在这一刻，
// 拿它"回退"等于原地不动。要撤销的"最后一个回合"，看的是**前一个**存档点。
function prevAuto(worldId) { return autosDesc(worldId)[1] || null; }
// 读取快照前，把"现在这一刻"另存一份（**不占 5/15 配额**）——恢复错了还能回来
function takePreRestore(data, worldId) {
  try {
    writeAtomic(preRestoreFile(worldId), JSON.stringify({ __snap: metaOf(data, 'pre', 0), world: data }));
    return { ok: true };
  } catch (e) { return { ok: false, err: String(e.message || e) }; }
}
function readPreRestore(worldId) {
  try {
    const j = JSON.parse(stripBom(fs.readFileSync(preRestoreFile(worldId), 'utf8')));
    return (j && j.world) ? { ok: true, snap: j.__snap || {}, world: j.world } : { ok: false, err: '没有' };
  } catch (e) { return { ok: false, err: '没有' }; }
}
// 完整包导入：把打包带过来的 20 格原样写回（不重算、不覆盖已有）
function restoreAll(worldId, items) {
  let n = 0;
  for (const it of (items || [])) {
    try {
      if (!it || !it.world) continue;
      const kind = it.kind === 'manual' ? 'manual' : 'auto';
      const slot = Number(it.slot) || 0;
      if (slot < 1 || slot > (kind === 'manual' ? MANUAL_SLOTS : AUTO_SLOTS)) continue;
      writeAtomic(slotFile(worldId, kind, slot), JSON.stringify({ __snap: it.__snap || {}, world: it.world }));
      n++;
    } catch (e) { DEG.hit("snapshot.js", e); }
  }
  if (n) writeIndex(worldId, { autoNext: ((n % AUTO_SLOTS) + 1) });
  return n;
}
// 完整包导出：把 20 格读出来（原样，含 __snap 元信息）
function dumpAll(worldId) {
  const out = [];
  for (const row of list(worldId)) {
    if (row.corrupt) continue;
    const one = read(worldId, row.kind, row.slot);
    if (one.ok) out.push({ kind: row.kind, slot: row.slot, __snap: one.snap, world: one.world });
  }
  return out;
}
module.exports = { AUTO_SLOTS, MANUAL_SLOTS, rootDir, snapDir, slotFile, list, take, read, remove, latestAuto, prevAuto, autosDesc, takePreRestore, readPreRestore, restoreAll, dumpAll };
