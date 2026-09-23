// retention.js — 统一留存策略（v1.86）
// ─────────────────────────────────────────────────────────────
// 病：7 个容器各写各的阈值（ledger 5000 / experience 5000 / archives 800−100 /
//     manifest 2000 / framework.log 400 / sceneLog 200 / dayDigest 400 天），
//     而设计文档只写了"不删"，**没写"存不下怎么办"** —— 于是每个模块各拍一个数，且都不留痕。
// 治：① **一份策略表**（改阈值只改这里）；② 溢出**落盘**而不是丢掉
//     （`data/retention/<kind>.jsonl`，追加式）—— 存档保持小、可读，"全存"落在磁盘上。
// v1.98 · P0-3 补最后一块：**落盘的东西要能读回来**（read()） —— 否则"归档"这个词是假的：
//   文件在磁盘上，却没有任何入口能取到它，"永不删"就还是空话。
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const DEG = require('./degraded');   // v1.87：本文件是在 codemod 之后新建的，忘了它会导致 view() 直接抛错

let _base = null;
function setBase(fn) { _base = fn; }
function base() { if (_base) return _base(); try { return require('./store').resBase(); } catch (e) { return process.cwd(); } }
function dir() { return path.join(base(), 'data', 'retention'); }

// ── 策略表（唯一阈值来源）──
const CAPS = {
  ledger: 5000,        // 审计日志（超出的**归档**到 data/retention/ledger.jsonl，可用 read('ledger') 取回；data.ledgerDropped 仍计数——名字是历史遗留，语义是"归档"不是"删除"）
  experience: 5000,    // 认知轨：玩家亲历（只追加）
  archivesDay: 800,    // 剧本存档：一天最多留在存档里多少行
  archivesBatch: 100,  // 每次溢出多少行落盘
  manifest: 2000,      // 生成清单（"这份存档生成过什么"的账）
  frameworkLog: 400,   // 框架演化日志
  sceneLog: 200,       // 最近场景原文（窗口；溢出的由 records.archiveSpill 转进 archives）
  dayDigestDays: 400   // 日摘要保留天数
};
function spill(kind, rows) {
  if (!rows || !rows.length) return 0;
  try {
    fs.mkdirSync(dir(), { recursive: true });
    const f = path.join(dir(), String(kind).replace(/[^\w-]/g, '_') + '.jsonl');
    fs.appendFileSync(f, rows.map(r => JSON.stringify(r)).join(String.fromCharCode(10)) + String.fromCharCode(10));
    return rows.length;
  } catch (e) { return 0; }
}
/* 统一裁剪：超上限 → 老数据**落盘**（不再静默丢），返回保留的部分。
   data 给了就记一笔"落了多少"，可在 /api/diag 与存档里查。 */
function cap(kind, arr, max, data) {
  const n = Number(max) || 0;
  if (!Array.isArray(arr) || !n || arr.length <= n) return arr;
  const cut = arr.slice(0, arr.length - n);
  const kept = arr.slice(-n);
  const spilled = spill(kind, cut);
  if (data) {
    data.spilled = data.spilled || {};
    data.spilled[kind] = (data.spilled[kind] || 0) + spilled;
  }
  return kept;
}
/* 把某个 kind 归档出去的行**读回来**（v1.98 · P0-3）。
   opts.n 取最后 n 行（缺省全部）；坏行跳过并在结果里报数（不抛）。 */
function read(kind, opts) {
  const o = opts || {};
  const out = { kind: String(kind || ''), rows: [], bad: 0, file: '' };
  try {
    const f = path.join(dir(), String(kind).replace(/[^\w-]/g, '_') + '.jsonl');
    out.file = f;
    if (!fs.existsSync(f)) return out;
    let lines = fs.readFileSync(f, 'utf8').split(String.fromCharCode(10)).filter(Boolean);
    if (o.n > 0) lines = lines.slice(-Math.floor(o.n));
    for (const l of lines) {
      try { out.rows.push(JSON.parse(l)); } catch (e) { out.bad++; }
    }
  } catch (e) { DEG.hit('retention.js', e); }
  return out;
}
// 落盘情况一览（/api/diag 与 /api/dev 用）：policy 阈值 + 各 kind 落了多少行 + 文件多大
function view(data) {
  const out = { caps: CAPS, spilled: (data && data.spilled) || {}, files: [] };
  try {
    const d = dir();
    for (const f of fs.readdirSync(d)) {
      if (!/\.jsonl$/.test(f)) continue;
      let bytes = 0, lines = 0;
      try { const st = fs.statSync(path.join(d, f)); bytes = st.size; lines = fs.readFileSync(path.join(d, f), 'utf8').split(String.fromCharCode(10)).filter(Boolean).length; } catch (e) { DEG.hit('retention.js', e); }
      out.files.push({ kind: f.replace(/\.jsonl$/, ''), kb: Math.round(bytes / 1024 * 10) / 10, lines: lines });
    }
  } catch (e) { DEG.hit('retention.js', e); }
  out.ledgerDropped = (data && data.ledgerDropped) || 0;
  return out;
}
module.exports = { CAPS, spill, cap, dir, setBase, view, read };
