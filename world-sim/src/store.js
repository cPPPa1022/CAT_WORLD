// store.js — 世界库：实体/记忆/流水账/知识视图 + JSON 持久化
'use strict';
const DEG = require('./degraded');
const RET = require('./retention');   // v1.86 统一留存策略（阈值一处、溢出落盘）
const fs = require('node:fs');
const makeId = (p) => p + '__' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const path = require('node:path');

/* ---------- 原子写（v1.98 · P0-1） ----------
   病：全项目的 JSON 落盘都是 `writeFileSync(目标, 全量文本)`。覆盖写**不是原子操作** ——
   进程在写到第 3 万字节时被杀（任务管理器 / 断电 / 崩溃），磁盘上留下的就是**半份 JSON**，
   而这份文件恰好是玩家的世界存档或世界注册表。窗口极窄，代价最高：丢一局。
   做法：写到**目标同目录**的 `<目标>.tmp` → `rename` 覆盖。同一文件系统内 rename 是原子的 ——
   要么还是旧文件、要么已经是完整的新文件，中间态不存在。
   三条不许改的细节（踩过就是灾难）：
     · tmp 路径必须由**目标路径**派生。不许用 os.tmpdir()：跨卷 rename 会退化成"复制+删除"，就不原子了
     · `mkdirSync` 放在 try **外面**：写不进去要抛给调用方（snapshot-check 靠这条制造写失败）
     · 不 fsync：Windows 上对目录 fd 调 fsync 会 EPERM/EISDIR（照搬 POSIX 写法必踩），
       而每回合有 3 次落盘，桌面单机不值得为它付这个代价（评审 §8-1 的实测项，结论：不做）
   全项目**只有这一份**原子写实现（snapshot.js 原来那份私有的已改为从这里引入）。 */
function writeAtomic(file, data) {
  const body = (typeof data === 'string' || Buffer.isBuffer(data)) ? data : JSON.stringify(data, null, 1);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const t = file + '.tmp';
  fs.writeFileSync(t, body);   // 字符串默认 utf8；Buffer（PNG）原样
  fs.renameSync(t, file);
}

function makeStore(file) {
  let cache = null;
  const load = () => {
    if (cache) return cache;
    if (fs.existsSync(file)) {
      try { cache = JSON.parse(fs.readFileSync(file, 'utf8')); if (cache) cache.id = makeId; return cache; } catch (e) { console.error('[store] 世界文件损坏，重建演示世界:', e.message); }
    }
    cache = null;
    return cache;
  };
  const save = () => {
    if (!cache) return;
    writeAtomic(file, cache);
  };
  const set = (d) => { cache = d; if (cache) cache.id = makeId; save(); };
  return {
    load, save, set,
    get() { const d = load(); if (!d) throw new Error('世界未加载'); return d; },
    id: (p) => p + '__' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
  };
}

/* 读 JSON（v1.45）：**必须先去掉 UTF-8 BOM**。
   实测事故：用 Windows PowerShell 的 Set-Content -Encoding UTF8 写 config.json 会带上 BOM（EF BB BF），
   而 JSON.parse 直接崩 —— 桌面应用启动时报
     server fail: Unexpected token '锘?, "锘縶 "p"... is not valid JSON
   以后所有读 JSON 都走这里，不再各处裸读。 */
function stripBom(s) { s = String(s == null ? '' : s); return (s.charCodeAt(0) === 0xFEFF) ? s.slice(1) : s; }
function readJson(file) {
  const s = stripBom(fs.readFileSync(file, 'utf8'));
  try { return JSON.parse(s); } catch (e) {
    /* v1.76：原来坏文件直接把 "Unexpected end of JSON input" 抛到界面上 ——
       那句英文等于没说（用户实测只看到这一句，查不到是哪个文件）。
       现在：**先把坏文件备份下来**（原件不丢，能查），再抛一句能看懂的。 */
    let bak = '';
    try { bak = file + '.bad-' + Date.now(); fs.copyFileSync(file, bak); } catch (e2) { DEG.hit("store.js", e2); }
    const err = new Error('数据文件损坏，读不出来：' + path.basename(file)
      + (bak ? ('（原件已备份为 ' + path.basename(bak) + '）') : '')
      + ' —— ' + String(e.message || e));
    err.corruptFile = file;
    throw err;
  }
}

// 资源根：开发=世界库根；打包(SEA)=exe 旁的 resources
function resBase() {
  if (process.env.WORLD_SIM_DATA) return process.env.WORLD_SIM_DATA;
  if (process.env.WORLD_SIM_ROOT) return process.env.WORLD_SIM_ROOT;
  if (global.__BUNDLED__) return path.join(path.dirname(process.execPath), 'resources');
  return path.join(__dirname, '..');
}
function resAssets() {
  if (process.env.WORLD_SIM_ASSETS) return process.env.WORLD_SIM_ASSETS;
  if (process.env.WORLD_SIM_ROOT) return process.env.WORLD_SIM_ROOT;
  if (global.__BUNDLED__) return path.join(path.dirname(process.execPath), 'resources');
  return path.join(__dirname, '..');
}

// 实体辅助
const getEntity = (data, id) => data.entities[id] || null;
const persons = (data) => Object.values(data.entities).filter(e => e.type === 'person');
const places = (data) => Object.values(data.entities).filter(e => e.type === 'place');
const present = (data, placeId) => persons(data).filter(p => p.state.location === placeId && p.state.alive !== false);

// 流水账（事实账本）：追加式
/* v1.84：ledger 是**审计日志**（v1.86 起 replay.js 兑现了"重放"的一个**明确划界的子集**：
   current.sceneId / memories / relations —— 完整的划界见 replay.js 头注释；账本本身仍不是状态真源）。
   v1.98 · P0-3：账本**不可改写** —— 实体合并这类"事后改口"只追加一条勘误（type:'实体合并'），
   读侧按勘误把旧 id 解释成当前 id。所以这里也是全项目**唯一**的账本写入入口。
   上限保留（无上限会让单 JSON 存档无限膨胀），但**不再悄悄删**：丢了多少笔要留痕、要可查。 */
/* v1.98 · P0-3：上限**只有一个来源**（retention.js 的策略表）。
   原来这里写死 5000，而 retention.js 里也有一份 5000 —— 改哪个都不生效（改 CAPS 不影响这里，
   于是"统一留存策略"对本容器其实是失效的：测试里把 CAPS.ledger 压到 10，这里照样留 27 笔）。
   现在读策略表；表里给了 0（不限）就真的不裁。 */
const ledgerMax = () => {
  const n = Number(RET.CAPS && RET.CAPS.ledger);
  return (isFinite(n) && n > 0) ? Math.floor(n) : 0;
};
/* ★ v3.9 · 每条产出都要能回答两件事：**这是哪一轮、因为什么**（用户 2026-09-27）。
   账本只有一个写入口（下面那个），所以在这里统一盖章 —— type/cause 本来就是「什么事件」。
   为什么在数据里盖而不是在界面上补：界面会重画、会过滤、会搬迁，**记录本身不带出处，事后就再也查不出来**。
   （注意：这些标记是给引擎和 ?dev 看的，不上玩家的屏幕 —— 越权红线 4。） */
const stampTurn = (data, rec, why) => {
  const t = rec || {};
  if (t.turn == null) t.turn = (data && data.current && data.current.turnN) || 0;
  if (why && t.why == null) t.why = String(why).slice(0, 80);
  return t;
};
const ledgerPush = (data, rec) => {
  stampTurn(data, rec);
  rec.id = data.id('ledg');
  data.ledger.push(rec);
  const MX = ledgerMax();
  if (MX && data.ledger.length > MX) {
    const dropped = data.ledger.length - MX;
    data.ledger = RET.cap('ledger', data.ledger, MX, data);   // v1.86：溢出**归档**到 data/retention/ledger.jsonl（v1.98 起可 read() 取回）
    data.ledgerDropped = (data.ledgerDropped || 0) + dropped;   // 计数（可查、可见）—— 语义是"归档"，不是"删除"
  }
};

// 剧本存档：按场景会话折叠
const archivePush = (data, sceneKey, line) => {
  if (!data.archives[sceneKey]) data.archives[sceneKey] = [];
  data.archives[sceneKey].push(line);
  if (data.archives[sceneKey].length > 800) data.archives[sceneKey].splice(0, 100);
};

function worldsDir() { return path.join(resBase(), 'data', 'worlds'); }
// 角色卡盒：扫描过的卡存档（只存卡，不是世界存档）；meta.json 的 cards 数组是索引
function cardsDir() { return path.join(resBase(), 'data', 'cards'); }
function cardFile(id) { return path.join(cardsDir(), String(id).replace(/[^a-zA-Z0-9_-]/g, '') + '.json'); }
function metaFile() { return path.join(resBase(), 'data', 'meta.json'); }
function loadMeta() {
  const f = metaFile();
  if (!fs.existsSync(f)) return { worlds: [], current: null, cards: [] };
  try { return JSON.parse(stripBom(fs.readFileSync(f, 'utf8'))); }
  catch (e) {
    /* v1.76：原来静默返回 {worlds:[]} —— 意味着**下一次存档就把整个注册表抹了**（世界文件还在，但列表空了）。
       现在：备份坏档 + 明确报出来。 */
    let bak = '';
    try { bak = f + '.bad-' + Date.now(); fs.copyFileSync(f, bak); } catch (e2) { DEG.hit("store.js", e2); }
    console.error('[meta] 注册表损坏' + (bak ? ('，已备份为 ' + path.basename(bak)) : '') + '：' + String(e.message || e));
    return { worlds: [], current: null, cards: [], __corrupt: true, __backup: bak };
  }
}
function saveMeta(meta) {
  writeAtomic(metaFile(), meta);
}
function worldFile(id) { return path.join(worldsDir(), id + '.json'); }

/* ---------- 读世界文件：把"不存在"和"损坏"分开说，并且**先看崩溃残骸**（v1.98 · P0-1） ----------
   原来 server.js 的 loadWorld 是一行裸 JSON.parse 外面套 `catch (e) { return null; }`：
     ① 所有故障被压成同一句话「世界不存在或已损坏」—— 玩家查不出到底怎么了、该不该救；
     ② 崩在原子写窗口里的那半份文件，旁边明明躺着**完整**的 `<f>.tmp`（rename 之前的内容），
        却没有任何代码看它一眼。那是白捡的一份救命数据 —— 丢的只是"这半次写"，不是整局。
   返回 { ok:true, data } 或 { ok:false, why:'missing'|'corrupt', msg, file, backup, recovered }。
   `why` 给调用方判分支，`msg` 给人看（含文件名 —— 与 readJson / loadMeta 的口吻一致）。 */
function loadWorldFile(file) {
  if (!fs.existsSync(file)) return { ok: false, why: 'missing', file: file, msg: '这个世界不在了：' + path.basename(file) };
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (e) { return { ok: false, why: 'corrupt', file: file, msg: '世界文件读不出来：' + path.basename(file) + ' —— ' + String(e.message || e) }; }
  try {
    const d = JSON.parse(stripBom(text));
    if (d && typeof d === 'object') return { ok: true, data: d };
    return { ok: false, why: 'corrupt', file: file, msg: '世界文件是空的：' + path.basename(file) };
  } catch (e) {
    const t = file + '.tmp';
    if (fs.existsSync(t)) {
      try {
        const alt = JSON.parse(stripBom(fs.readFileSync(t, 'utf8')));
        if (alt && typeof alt === 'object') {
          let bak = '';
          try { bak = file + '.bad-' + Date.now(); fs.copyFileSync(file, bak); } catch (e2) { DEG.hit('store.js', e2); }
          try { fs.renameSync(t, file); } catch (e3) { DEG.hit('store.js', e3); }   // 残骸转正，顺带把 .tmp 收掉
          return { ok: true, data: alt, recovered: true, backup: bak, file: file,
            msg: '上一次写入没写完（世界文件是半份），已用未完成的写入恢复' + (bak ? ('；半份的那份备份为 ' + path.basename(bak)) : '') };
        }
      } catch (e2) { /* 残骸本身也坏 → 落到下面按"损坏"报 */ }
    }
    let bak = '';
    try { bak = file + '.bad-' + Date.now(); fs.copyFileSync(file, bak); } catch (e2) { DEG.hit('store.js', e2); }
    return { ok: false, why: 'corrupt', file: file, backup: bak,
      msg: '世界文件损坏，读不出来：' + path.basename(file) + (bak ? ('（原件已备份为 ' + path.basename(bak) + '）') : '') + ' —— ' + String(e.message || e) };
  }
}

module.exports = { stampTurn, makeStore, makeId, resBase, resAssets, stripBom, readJson, loadWorldFile, writeAtomic, getEntity, persons, places, present, ledgerPush, archivePush, worldsDir, cardsDir, cardFile, metaFile, loadMeta, saveMeta, worldFile };

// ../src/data 目录由调用方创建
module.exports.DATA_DIR = path.join(__dirname, '..', 'data');