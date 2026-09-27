// content-check.js — 内容模块槽位断言（v1.61）
// 覆盖：档位文件夹是唯一真源 / # 说明行不进提示词 / 关 = 零字节 / 坏档不崩 /
//       导入（含同名跳过与坏路径）/ 选中的档真的进了 SYSTEM / 存得住（config.json）
'use strict';
const fs = require('fs'); const path = require('path'); const os = require('os');
const TMP = path.join(os.tmpdir(), 'ws-content-' + Date.now());
process.env.WORLD_SIM_DATA = TMP;
fs.mkdirSync(TMP, { recursive: true });
const C = require('../src/content');
const AI = require('../src/ai');
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  OK   ' + msg); } else { fail++; console.log('  FAIL ' + msg); } }
console.log('');
console.log('内容模块槽位 —— 一个槽位 · 多档互斥 · 档位来自真实文件夹');

// 1) 落地位置 + 初始为空
ok(C.dir() === path.join(TMP, 'presets', 'content'), '档位文件夹在数据目录下（' + C.dir() + '）');
ok(Array.isArray(C.list()) && C.list().length === 0, '刚建好时一个档都没有');

// 2) 丢一个带 # 说明头的档进去
const T1 = '# 这是说明，不该进提示词' + String.fromCharCode(10) + '# 第二行说明' + String.fromCharCode(10) + String.fromCharCode(10) + '正文第一句。' + String.fromCharCode(10) + '正文第二句。';
fs.writeFileSync(path.join(C.dir(), '测试档.txt'), T1);
const ls = C.list();
ok(ls.length === 1 && ls[0].id === '测试档', '文件名 = 档位名（列表里有 1 档：' + (ls[0] && ls[0].id) + '）');
ok(ls[0].chars === 13, '字数统计只算正文（13 字，不含 # 说明）');
ok(C.stripHead(T1).indexOf('#') < 0, '★ # 说明行被剥掉（不进提示词）');
ok(C.stripHead(T1).indexOf('正文第一句') === 0, '★ 正文从第一行非 # 内容开始');
ok(C.stripHead('# 全是注释') === '', '全是注释的档 → 正文为空');

// 3) 关 = 零字节；选中 = 有内容
ok(C.blockFor({ content: { nsfw: '' } }) === '', '关（空串）→ 拼接结果零字节');
ok(C.blockFor({}) === '', '配置里没有这个槽位 → 零字节');
ok(C.blockFor({ content: { nsfw: '不存在的档' } }) === '', '选了一个不存在的档 → 零字节（不报错、不崩）');
const blk = C.blockFor({ content: { nsfw: '测试档' } });
ok(blk.indexOf('正文第一句') >= 0, '选中档 → 正文进了拼接结果');
ok(blk.indexOf('这是说明') < 0, '★ 选中档的 # 说明也没混进去');
ok(blk.indexOf('不属于作品内容') >= 0, '拼接块自带「不属于作品内容」标注（L4 输出侧）');

// 4) 导入：正常 / 同名跳过 / 坏路径
const SRC = path.join(TMP, 'from');
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, '甲.txt'), '甲的正文');
fs.writeFileSync(path.join(SRC, '乙.txt'), '乙的正文');
fs.writeFileSync(path.join(SRC, '不是档位.md'), '不该被导入');
const imp = C.importDir(SRC);
ok(imp.ok && imp.added.length === 2, '导入 2 个 .txt（' + (imp.added || []).join('/') + '）');
ok(C.list().length === 3, '导入后一共 3 档（.md 不算档）');
const imp2 = C.importDir(SRC);
ok(imp2.ok && imp2.added.length === 0 && imp2.skipped.length === 2, '同名默认不覆盖（跳过 ' + imp2.skipped.length + ' 个）');
const imp3 = C.importDir(path.join(TMP, '根本不存在'));
ok(imp3.ok === false && !!imp3.err, '坏路径 → ok:false 且有 err（不抛）');
ok(C.importDir('').ok === false, '空路径 → ok:false');

// 5) 真的进了 SYSTEM（L1 输入侧）
let sysWith = '', sysWithout = '';
try {
  const { buildDemoWorld } = require('../src/world');
  const d = buildDemoWorld();
  sysWith = AI.SYSTEM(d, { content: { nsfw: '测试档' } });
  sysWithout = AI.SYSTEM(d, { content: { nsfw: '' } });
} catch (e) { sysWith = 'THREW:' + e.message; }
ok(sysWith.indexOf('正文第一句') >= 0, '★ 选中档的正文出现在主 AI 的 SYSTEM 里');
ok(sysWithout.indexOf('正文第一句') < 0 && sysWithout.indexOf('内容模块') < 0, '★ 关掉后 SYSTEM 里一个字都没有');

// 6) 存得住（L7 设置一致性）
fs.writeFileSync(path.join(TMP, 'config.json'), JSON.stringify({ port: 3088, playerName: '你', llm: { baseURL: 'http://x/v1', apiKey: 'K', model: 'M' }, content: { nsfw: '' } }));
AI.saveConfig({ content: { nsfw: '测试档' } });
const cur = AI.loadConfig();
ok(cur.content && cur.content.nsfw === '测试档', '★ 选中的档写进了 config.json（重启还在）');
ok(cur.llm.baseURL === 'http://x/v1' && cur.llm.apiKey === 'K' && cur.llm.model === 'M', '★ 只改内容模块不会清空模型配置（llm 回落，v1.61 修）');
const v = C.view(cur);
const nsfwSlot = (v.slots || []).filter(s => s.id === 'nsfw')[0] || {};
ok(v.slots.length === C.SLOTS.length && nsfwSlot.cur === '测试档', '界面视图回读的值 = 真实值（v3.5 起是 ' + C.SLOTS.length + ' 个槽）');

// 7) v3.5：多槽 —— 前缀认领 / 无前缀老档归尺度槽 / 多个槽同时拼进 SYSTEM
ok(C.SLOTS.length >= 5, '槽位表有 ' + C.SLOTS.length + ' 个槽（文风/尺度/节奏/分量/禁词）');
ok(C.slotOfTier('文风-梦白话') === 'style' && C.slotOfTier('尺度-防回避') === 'nsfw', '★ 文件名前缀认领槽位');
ok(C.slotOfTier('软强化') === 'nsfw', '★ 无前缀的老档归「尺度」槽（v1.61 零迁移）');
ok(C.tierShort('文风-梦白话') === '梦白话' && C.tierShort('软强化') === '软强化', '界面显示名去掉前缀，无前缀原样');
fs.writeFileSync(path.join(C.dir(), '文风-甲档.txt'), '甲档正文。');
ok(C.list('style').length === 1 && C.list('style')[0].id === '文风-甲档', 'list(slot) 只列自己那个槽的档');
fs.writeFileSync(path.join(TMP, 'config.json'), JSON.stringify({ port: 3088, playerName: '你', llm: { baseURL: 'http://x/v1', apiKey: 'K', model: 'M' }, content: { nsfw: '', style: '' } }));
let both = '';
try {
  const { buildDemoWorld } = require('../src/world');
  both = AI.SYSTEM(buildDemoWorld(), { content: { nsfw: '测试档', style: '文风-甲档' } });
} catch (e) { both = 'THREW:' + e.message; }
ok(both.indexOf('正文第一句') >= 0 && both.indexOf('甲档正文') >= 0, '★ 两个槽同时选中 → 两段都进 SYSTEM');
ok(both.indexOf('【内容模块 · 尺度 · 测试档】') >= 0 && both.indexOf('【内容模块 · 文风 · 文风-甲档】') >= 0, '★ 拼接块各自标了槽位名（便于排查是谁写的）');

console.log('');
console.log('==== content-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
