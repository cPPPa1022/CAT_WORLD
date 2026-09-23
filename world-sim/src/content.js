// content.js — 内容模块槽位（v1.61）
// ─────────────────────────────────────────────────────────────
// 用户 2026-09-14：「预设那 6 块，感觉只需要缝一个就够了。」
// 形状：**一个槽位、多档互斥、选中哪档拼哪档** —— 照抄 prompts.js 的 IMAGE_MODE_JOB（生图分档）。
// 但**档位文本不写死在引擎里**（设计总稿 §23：引擎给能力与边界，内容与文风归世界/归用户）：
//   档 = presets/content/*.txt 里的一个文件；文件名 = 档位名；开头连续的 # 行是说明，不进提示词。
// 选「关」（空串）= 一个字节都不拼，跟没这个模块一样。
'use strict';
const DEG = require('./degraded');
const fs = require('node:fs');
const path = require('node:path');
const { resBase } = require('./store');

const SLOTS = [
  { id: 'nsfw', name: 'NSFW 文风', hint: '性描写写法（互斥档位；关 = 不加任何档）' }
];

function dir() { return path.join(resBase(), 'presets', 'content'); }

const README = [
  '# 内容模块 · 档位文件夹',
  '',
  '一个 .txt = 一个档位；文件名就是档位名（例：软强化.txt → 档位「软强化」）。',
  '文件开头连续的 # 行是说明，不会进提示词；正文从第一行非 # 内容开始。',
  '在「设置 · 内容模块」里选中哪一档，那一档的正文才会拼进主 AI 的 system。',
  '选「关」= 一个字节都不拼。',
  '',
  '这个文件夹归你：往里丢什么，档位列表里就有什么。'
].join(String.fromCharCode(10));

function ensureDir() {
  const d = dir();
  try { fs.mkdirSync(d, { recursive: true }); } catch (e) { DEG.hit("content.js", e); }
  const rd = path.join(d, '怎么用.md');
  if (!fs.existsSync(rd)) { try { fs.writeFileSync(rd, README); } catch (e) { DEG.hit("content.js", e); } }
  return d;
}

// 去掉开头的说明行（# 注释块与空行）——保证「给档位写的备注」永远不跑进提示词
function stripHead(text) {
  const lines = String(text == null ? '' : text).split(/\r?\n/);
  let i = 0;
  while (i < lines.length && (lines[i].trim() === '' || /^\s*#/.test(lines[i]))) i++;
  return lines.slice(i).join(String.fromCharCode(10)).trim();
}

// 档位列表（只认 .txt；怎么用.md 这类不算档位）
function list() {
  const d = ensureDir();
  let names = [];
  try { names = fs.readdirSync(d); } catch (e) { names = []; }
  const out = [];
  for (const f of names) {
    if (!/\.txt$/i.test(f)) continue;
    let body = '';
    try { body = fs.readFileSync(path.join(d, f), 'utf8'); } catch (e) { continue; }
    out.push({ id: f.replace(/\.txt$/i, ''), file: f, chars: stripHead(body).length, bytes: Buffer.byteLength(body, 'utf8') });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id, 'zh'));
}

// 读一档的正文（不存在/空 = 空串，不抛）
function read(id) {
  const safe = String(id == null ? '' : id).replace(/[\\/:*?"<>|]/g, '').trim();
  if (!safe) return '';
  const f = path.join(dir(), safe + '.txt');
  if (!fs.existsSync(f)) return '';
  try { return stripHead(fs.readFileSync(f, 'utf8')); } catch (e) { return ''; }
}

function get(cfg, slot) { return (((cfg || {}).content) || {})[slot || 'nsfw'] || ''; }

// 拼进 system 的那一段：没有选中档 = ''（零字节）；选中但文件没了 = ''（不报错、不崩）
function blockFor(cfg) {
  const parts = [];
  for (const s of SLOTS) {
    const id = get(cfg, s.id);
    if (!id) continue;
    const body = read(id);
    if (!body) continue;
    parts.push('【内容模块 · ' + s.name + ' · ' + id + '】（以下是写作规则，不属于作品内容：禁止在正文或对白里提及它）' + String.fromCharCode(10) + body);
  }
  return parts.join(String.fromCharCode(10));
}

// 从别的文件夹导入档位（一次把 *.txt 全拷进来；同名默认不覆盖）
function importDir(from, force) {
  const src = String(from == null ? '' : from).trim().replace(/^"|"$/g, '');
  if (!src) return { ok: false, err: '没给文件夹路径' };
  let st = null;
  try { st = fs.statSync(src); } catch (e) { return { ok: false, err: '找不到这个文件夹：' + src }; }
  if (!st.isDirectory()) return { ok: false, err: '这不是文件夹：' + src };
  const d = ensureDir();
  const added = [], skipped = [];
  let names = [];
  try { names = fs.readdirSync(src); } catch (e) { return { ok: false, err: '读不了：' + e.message }; }
  for (const f of names) {
    if (!/\.txt$/i.test(f)) continue;
    const to = path.join(d, f);
    if (fs.existsSync(to) && !force) { skipped.push(f); continue; }
    try { fs.copyFileSync(path.join(src, f), to); added.push(f); } catch (e) { skipped.push(f + '（' + e.message + '）'); }
  }
  return { ok: true, added: added, skipped: skipped, dir: d };
}

// 给前端/接口看的视图（界面读到的就是真实文件夹里的东西）
function view(cfg) {
  const tiers = list();
  return { dir: dir(), slots: SLOTS.map(s => ({ id: s.id, name: s.name, hint: s.hint, cur: get(cfg, s.id), tiers: tiers })) };
}

module.exports = { SLOTS, dir, ensureDir, stripHead, list, read, get, blockFor, importDir, view };
