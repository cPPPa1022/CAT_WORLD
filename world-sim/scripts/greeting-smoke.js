'use strict';
// greeting-smoke.js — 多开局 HTTP 端到端：preview 列出开场 → apply 带上 greeting 选择首帧
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wsg-'));
/* v2.05 修：这里原来写的是 **WORD_SIM_DATA**（少一个 L）—— 隔离**从来没生效过**，
   而这支脚本是直接 require('../server') 的，于是它会往**真实数据目录**写东西。
   顺手加一道自证守卫：隔离变量没设对就不许起服务。 */
process.env.WORLD_SIM_DATA = TMP;
process.env.PORT = '3887';
const PORT = 3887;
if (!process.env.WORLD_SIM_DATA || path.resolve(process.env.WORLD_SIM_DATA) === path.resolve(__dirname, '..')) {
  throw new Error('拒绝运行：WORLD_SIM_DATA 没指向临时目录（会写坏真实存档）');
}
const server = require('../server');

(async () => {
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  const dir = path.join(process.env.USERPROFILE || 'C:\\Users\\qwe', 'Desktop', '角色卡');
  const f = path.join(dir, '07c8904ab2ccb380.png');
  const payload = fs.readFileSync(f).toString('base64');
  const body = { src: 'png', payload, role: 'npc', preview: true };
  const pv = await (await fetch('http://127.0.0.1:' + PORT + '/api/new', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  console.log('[1] preview.openings=', pv.preview && pv.preview.openings, '| openingList=', (pv.preview.openingList || []).map(s => s.slice(0, 14)));

  const app0 = await (await fetch('http://127.0.0.1:' + PORT + '/api/new', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ src: 'png', payload, role: 'npc', greeting: 0 }) })).json();
  const first0 = (app0.view.sceneLog || []).find((l) => l.type === 'narration') || {};
  console.log('[2] greeting=0 首帧=', String(first0.text || '').slice(0, 18));

  const app1 = await (await fetch('http://127.0.0.1:' + PORT + '/api/new', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ src: 'png', payload, role: 'npc', greeting: 1 }) })).json();
  const first1 = (app1.view.sceneLog || []).find((l) => l.type === 'narration') || {};
  console.log('[3] greeting=1 首帧=', String(first1.text || '').slice(0, 18));
  const same = String(first0.text || '') === String(first1.text || '');
  console.log('[4] 两条开场不同=', !same, same ? 'FAIL' : 'PASS');
  console.log('SMOKE', same ? 'FAIL' : 'OK');
  const code = same ? 1 : 0;
  server.close();
  setTimeout(() => process.exit(code), 100);
})().catch((e) => { console.error('SMOKE ERR', e); server.close(); setTimeout(() => process.exit(2), 100); });