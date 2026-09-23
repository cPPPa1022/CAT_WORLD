// atomic-write-check.js — 原子写与"崩溃不坏档"（v1.98 · P0-1）
// 病：全项目的 JSON 落盘都是 writeFileSync(目标, 全量文本) —— 覆盖写**不是原子操作**。
// 进程在写第 3 万字节时被杀，磁盘上留下半份 JSON，而那是玩家的世界存档。
// 这个脚本守四件事：① 提交点是 rename（rename 之前失败，目标一个字都不许变）
//                   ② 成功后不留 .tmp   ③ 崩溃残骸能被捡回来   ④ "不存在"与"损坏"分得开
'use strict';
const path = require('path'), os = require('os'), fs = require('fs');
const TMP = path.join(os.tmpdir(), 'ws-atomic-' + Date.now());
process.env.WORLD_SIM_DATA = TMP; fs.mkdirSync(TMP, { recursive: true });
const ROOT = path.join(__dirname, '..');
process.env.WORLD_SIM_ASSETS = ROOT;
const ST = require(ROOT + '/src/store');
const { writeAtomic, loadWorldFile, makeStore, saveMeta, makeId } = ST;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const tmps = (dir) => fs.readdirSync(dir).filter(f => /\.tmp$/.test(f));

console.log('');
console.log('原子写：提交点是 rename / 不留残骸 / 残骸可救 / 故障分得开');

// ── ① 写成功：内容对、不留 .tmp、路径由目标派生 ──
{
  const dir = path.join(TMP, 'w1');
  const f = path.join(dir, 'a.json');
  writeAtomic(f, { hello: '世界', n: 1 });
  ok(fs.existsSync(f), '写进去了（目录也自动建了：' + fs.existsSync(dir) + '）');
  ok(JSON.parse(fs.readFileSync(f, 'utf8')).hello === '世界', '内容正确（UTF-8 中文不乱码）');
  ok(tmps(dir).length === 0, '成功后不留 .tmp（实测 ' + JSON.stringify(tmps(dir)) + '）');
  writeAtomic(f, 'plain text');
  ok(fs.readFileSync(f, 'utf8') === 'plain text', '字符串原样写（不是 JSON.stringify 一层引号）');
  writeAtomic(path.join(dir, 'b.png'), Buffer.from([1, 2, 3]));
  ok(Buffer.compare(fs.readFileSync(path.join(dir, 'b.png')), Buffer.from([1, 2, 3])) === 0, 'Buffer（PNG）也走原子写');
  ok(tmps(dir).length === 0, '三种载荷都不留 .tmp');
}
// ── ② 提交点：rename 之前/之时失败，**目标一个字都不许变** ──
{
  const dir = path.join(TMP, 'w2');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'a.json');
  writeAtomic(f, { v: 'old-good' });
  const before = fs.readFileSync(f, 'utf8');
  const realRename = fs.renameSync;
  fs.renameSync = () => { const e = new Error('模拟：rename 之前崩了 / 盘满了'); throw e; };
  let threw = false;
  try { writeAtomic(f, { v: 'new' }); } catch (e) { threw = true; }
  fs.renameSync = realRename;
  ok(threw, '写失败会**抛**（不许静默吞掉）');
  ok(fs.readFileSync(f, 'utf8') === before, '★ 失败后目标文件仍是**旧的那份完整内容**（半份 JSON 不可能存在）');
  ok(JSON.parse(fs.readFileSync(f, 'utf8')).v === 'old-good', '★ 而且它还能 parse（这就是"要么旧、要么新"）');
  ok(tmps(dir).length === 1, '失败只留下一个 .tmp（下次写入会覆盖它）');
}
// ── ③ 目录写不进去：抛，不装作成功（snapshot-check 靠这条制造失败） ──
{
  const dir = path.join(TMP, 'w3');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'blocked'), 'x');           // 用一个文件占住目录名
  let threw = false;
  try { writeAtomic(path.join(dir, 'blocked', 'a.json'), { v: 1 }); } catch (e) { threw = true; }
  ok(threw, '目标目录不可用时抛错（调用方才能记账，而不是以为写成功了）');
}
// ── ④ 真实写点：makeStore.save / saveMeta（A 组里可直接调到的那两个） ──
{
  const dir = path.join(TMP, 'w4');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'world.json');
  const store = makeStore(f);
  store.set({ meta: { name: '青石镇' }, current: { turnN: 7 } });
  ok(fs.existsSync(f) && tmps(dir).length === 0, 'makeStore.save 不留 .tmp');
  ok(JSON.parse(fs.readFileSync(f, 'utf8')).current.turnN === 7, 'makeStore.save 内容正确');
  const mf = ST.metaFile();
  saveMeta({ worlds: [{ id: 'w_1' }], current: 'w_1' });
  ok(JSON.parse(fs.readFileSync(mf, 'utf8')).current === 'w_1', 'saveMeta 写进去了');
  ok(tmps(path.dirname(mf)).length === 0, 'saveMeta 不留 .tmp');
}
// ── ⑤ 崩溃残骸能被捡回来（这是"不丢"，不只是"不坏"） ──
{
  const dir = path.join(TMP, 'w5');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'w_crash.json');
  fs.writeFileSync(f, '{"meta":{"name":"青石镇"},"entit');            // 半份
  writeAtomicRawTmp(f, { meta: { name: '青石镇' }, current: { turnN: 9 } });
  const r = loadWorldFile(f);
  ok(r.ok === true && r.recovered === true, '★ 目标半份 + .tmp 完整 → 用残骸救回来');
  ok(JSON.parse(fs.readFileSync(f, 'utf8')).current.turnN === 9, '★ 世界文件被换成了那份完整的（不是把残骸留在旁边）');
  ok(tmps(dir).length === 0, '残骸救回后 .tmp 已被消费掉');
  const bad = fs.readdirSync(dir).filter(x => /\.bad-\d+$/.test(x));
  ok(bad.length === 1, '半份的那份被备份成 .bad-<ts>（可查，不是直接扔了）');
  ok(loadWorldFile(f).ok === true, '再读一次正常（幂等）');
}
// ── ⑥ 残骸自己也坏 → 报"损坏"，且与"不存在"分得开 ──
{
  const dir = path.join(TMP, 'w6');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'w_bad.json');
  fs.writeFileSync(f, '{oops');
  fs.writeFileSync(f + '.tmp', '{also-bad');
  const r = loadWorldFile(f);
  ok(r.ok === false && r.why === 'corrupt', '半份 + 残骸也坏 → 判"损坏"（why=corrupt）');
  ok(r.msg.indexOf('w_bad.json') >= 0, '★ 文案报出**文件名**（玩家能查是哪个档）：' + JSON.stringify(r.msg.slice(0, 60)));
  ok(fs.readdirSync(dir).some(x => /\.bad-\d+$/.test(x)), '坏档有备份（.bad-<ts>，与 readJson/loadMeta 同一约定）');
  const miss = loadWorldFile(path.join(dir, 'not-here.json'));
  ok(miss.ok === false && miss.why === 'missing', '★ 不存在 → why=missing（与"损坏"是两句话）');
  ok(miss.msg !== r.msg && miss.msg.indexOf('损坏') < 0, '★ "不存在"的文案不许暗示损坏（原来两者是同一句）');
}
// ── ⑦ 目标完好 + 旁边有旧残骸 → **以目标为准**（不许拿残骸把好档换掉） ──
{
  const dir = path.join(TMP, 'w7');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'w_ok.json');
  writeAtomic(f, { current: { turnN: 3 } });
  fs.writeFileSync(f + '.tmp', JSON.stringify({ current: { turnN: 99 } }));
  const r = loadWorldFile(f);
  ok(r.ok === true && !r.recovered, '目标能 parse 时不动手（不"顺手恢复"）');
  ok(JSON.parse(fs.readFileSync(f, 'utf8')).current.turnN === 3, '★ 用的还是目标那一份（残骸只有目标坏了才轮到它）');
}
// ── ⑧ 静态：全仓只剩一份原子写实现；写点没有裸写 ──
{
  const sv = fs.readFileSync(ROOT + '/server.js', 'utf8');
  const sp = fs.readFileSync(ROOT + '/src/snapshot.js', 'utf8');
  const st = fs.readFileSync(ROOT + '/src/store.js', 'utf8');
  ok(!/function writeAtomic/.test(sp), '★ snapshot.js 不再自带一份原子写实现（"两个真相"消掉）');
  ok(/const \{ writeAtomic \} = require\('\.\/store'\)/.test(sp), 'snapshot.js 改为从 store 引入');
  ok((st.match(/function writeAtomic/g) || []).length === 1, 'store.js 里原子写只有一处实现');
  ok(/const t = file \+ '\.tmp'/.test(st), '★ tmp 路径由**目标路径**派生（不用 os.tmpdir，跨卷 rename 不原子）');
  ok(/fs\.mkdirSync\(path\.dirname\(file\), \{ recursive: true \}\);\n  const t = file/.test(st), 'mkdirSync 在 try 之外（照抄旧实现的形状 → snapshot-check 的失败路径不变）');
  ok(/writeAtomic\(worldFile\(currentId\), current\)/.test(sv), 'persist() 走原子写（主存档全量写）');
  ok(/writeAtomic\(worldFile\(id\), data\)/.test(sv), 'saveWorld() 走原子写');
  ok((sv.match(/writeAtomic\(fp, d\)/g) || []).length >= 3, 'loadWorld 的三处迁移回写都走原子写（实际 ' + (sv.match(/writeAtomic\(fp, d\)/g) || []).length + ' 处）');
  ok(/DEG\.hit\('server\.js', e\); GL\('\[persist\]/.test(sv), 'persist 写失败留痕（DEG + 日志），且不把这一回合赔进去');
  ok(!/writeFileSync\(worldFile/.test(sv) && !/writeFileSync\(metaFile/.test(sv) && !/writeFileSync\(f, JSON\.stringify\(c, null, 2\)\)/.test(fs.readFileSync(ROOT + '/src/ai.js', 'utf8')), '世界档/注册表/config 都不再裸写');
  ok(sv.indexOf('/\\.tmp$/') >= 0 && sv.indexOf('continue') >= 0, '占用盘点不计 .tmp（它是"正在写的那一下"，不是数据）');
  ok(!/os\.tmpdir\(\).*worldFile|worldFile.*os\.tmpdir\(\)/.test(sv), '没有任何世界文件路径用到 os.tmpdir()');
}
// ── ⑨ 性能：原子写的代价（rename 是同一目录内的元数据操作，应当很便宜） ──
{
  const dir = path.join(TMP, 'perf');
  fs.mkdirSync(dir, { recursive: true });
  const big = { pad: 'x'.repeat(2000) , list: [] };
  for (let i = 0; i < 600; i++) big.list.push({ id: 'm' + i, content: '记忆内容'.repeat(6) });
  const text = JSON.stringify(big, null, 1);
  const f1 = path.join(dir, 'plain.json'), f2 = path.join(dir, 'atomic.json');
  const t0 = Date.now(); for (let i = 0; i < 30; i++) fs.writeFileSync(f1, text, 'utf8'); const plain = (Date.now() - t0) / 30;
  const t1 = Date.now(); for (let i = 0; i < 30; i++) writeAtomic(f2, text); const atom = (Date.now() - t1) / 30;
  console.log('  · 单次落盘（约 ' + Math.round(text.length / 1024) + ' KB）：裸写 ' + plain.toFixed(2) + ' ms ／ 原子写 ' + atom.toFixed(2) + ' ms（增量 ' + (atom - plain).toFixed(2) + ' ms）');
  ok(atom - plain < 25, '★ 原子写的增量是可接受的（基线 ' + plain.toFixed(2) + ' ms → ' + atom.toFixed(2) + ' ms）');
}

// 造"完整残骸"：直接写 .tmp 不 rename（模拟崩溃在 rename 之前）
function writeAtomicRawTmp(file, obj) { fs.writeFileSync(file + '.tmp', JSON.stringify(obj, null, 1)); }

console.log('');
console.log('==== atomic-write-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
