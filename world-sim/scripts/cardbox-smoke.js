'use strict';
// cardbox-smoke.js — 卡盒 + 设定 端到端：扫描建档 → 卡盒列出 → 直接开局（选开场）→ 档案自动带入
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wsb-'));
/* v2.05 修：同 greeting-smoke —— WORD_SIM_DATA 拼错 ⇒ 隔离失效（会写真实数据目录）。 */
process.env.WORLD_SIM_DATA = TMP;
process.env.PORT = '3888';
const PORT = 3888;
if (!process.env.WORLD_SIM_DATA || path.resolve(process.env.WORLD_SIM_DATA) === path.resolve(__dirname, '..')) {
  throw new Error('拒绝运行：WORLD_SIM_DATA 没指向临时目录（会写坏真实存档）');
}
const server = require('../server');
const B = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const post = async (p, b) => (await (await fetch('http://127.0.0.1:' + PORT + p, B(b))).json());
const get = async (p) => (await (await fetch('http://127.0.0.1:' + PORT + p)).json());

(async () => {
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  let fails = 0;
  const ok = (cond, msg) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + msg); if (!cond) fails++; };

  // 1) 设定：保存我的身份档案
  const sel = await post('/api/self', { fields: { name: '老徐', identity: '退休法医', ability: '看尸体' } });
  ok(sel.ok && sel.userSelf.name === '老徐', '保存身份档案');
  const st0 = await get('/api/state');
  ok(st0.noWorld && st0.config.userSelf.name === '老徐', 'state 带出档案 currentWorld=' + st0.currentWorld);

  // 2) 扫描卡（NPC 模式，默认带档案）
  const dir = path.join(process.env.USERPROFILE || 'C:\\Users\\qwe', 'Desktop', '角色卡');
  const payload = fs.readFileSync(path.join(dir, '07c8904ab2ccb380.png')).toString('base64');
  const nw = await post('/api/new', { src: 'png', payload, role: 'npc', greeting: 0 });
  ok(!!nw.view && !!nw.archived, '扫描建档 archived=' + nw.archived);
  const my = (nw.view.me || {});
  const nameOk = JSON.stringify(nw.view).includes('老徐');
  ok(nameOk, '档案自动带入（view 含 老徐）');

  // 3) 卡盒列出
  const cl = await get('/api/cards');
  ok(cl.count === 1 && cl.list[0].name === nw.archived, '卡盒 1 张：' + (cl.list[0] || {}).name);
  ok((cl.list[0].openingList || []).length >= 1, '卡盒带开场列表');

  // 4) 直接从卡开局（选主开场 = 最后一条）
  const id = cl.list[0].id;
  const l0 = await post('/api/cards/launch', { id, greeting: 0 });
  const first0 = (l0.view.sceneLog || []).find((x) => x.type === 'narration') || {};
  const l1 = await post('/api/cards/launch', { id, greeting: 1 });
  const first1 = (l1.view.sceneLog || []).find((x) => x.type === 'narration') || {};
  ok(String(first0.text || '').slice(0, 10) !== String(first1.text || '').slice(0, 10), '开局开场可选（0≠1）');
  const cl2 = await get('/api/cards');
  ok(cl2.count === 1, '开局不消耗卡档');

  // 5) 不勾选档案（noSelf）→ 访客模板；同一张卡重复扫描 → 更新同一卡档（不重复堆卡）
  const nw2 = await post('/api/new', { src: 'png', payload, role: 'npc', greeting: 0, noSelf: true });
  ok(!JSON.stringify(nw2.view).includes('退休法医'), 'noSelf 不带入档案');
  const cl3 = await get('/api/cards');
  ok(cl3.count === 1 && cl3.list[0].id === id, '重复扫描同一卡 → 更新原卡档（不堆重复）');

  // 5.5) 回主菜单 → 继续当前世界
  await post('/api/menu', {});
  const stM = await get('/api/state');
  ok(stM.noWorld && !!stM.currentWorld, '主菜单显示当前世界：' + stM.currentWorld);
  const rc = await post('/api/resume-current', {});
  ok(rc.ok && rc.view && rc.view.place, '继续当前世界');

  // 6) 删除卡档
  const dd = await post('/api/cards/del', { id });
  const cl4 = await get('/api/cards');
  ok(dd.ok && cl4.count === 0, '删除卡档');

  console.log('SMOKE', fails ? 'FAIL(' + fails + ')' : 'OK');
  server.close();
  setTimeout(() => process.exit(fails ? 1 : 0), 100);
})().catch((e) => { console.error('SMOKE ERR', e); server.close(); setTimeout(() => process.exit(2), 100); });