'use strict';
const fs = require('node:fs'), path = require('node:path');
const TMP = path.join(__dirname, '.tmp-live2');
fs.mkdirSync(path.join(TMP, 'data'), { recursive: true });
fs.copyFileSync(path.join(process.env.APPDATA || '', 'world-sim', 'config.json'), path.join(TMP, 'config.json'));
process.env.WORLD_SIM_DATA = TMP; process.env.WORLD_SIM_ASSETS = __dirname;
const AI = require('./src/ai'), IMP = require('./src/import');

const rec = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'world-sim', 'data', 'cards', 'c__muem2r2gjnnn7.json'), 'utf8'));
const pk = rec.pack || {}, p = pk.player || {};
/* 从 pack 重建一份"卡文本"（原卡没存，这是近似：玩家身世 + 人物 + 开场画面） */
const lines = [];
lines.push('【玩家】' + (p.name || '') + ' ' + (p.age || '') + ' ' + (p.identity || ''));
lines.push('身世：' + String(p.backstory || '').slice(0, 400));
lines.push('想要的：' + String(p.desire || '') + ' | 性格：' + String(p.personality || '').slice(0, 200));
lines.push('【人物】');
for (const n of (pk.npcs || []).slice(0, 22)) lines.push('- ' + n.name + '：' + String(n.identity || n.role || '').slice(0, 60) + ' ' + String(n.personality || '').slice(0, 60));
lines.push('【开场】' + String(pk.firstScene || '').slice(0, 700));
lines.push('【后续走向】' + (pk.premise || []).join(' / '));
const cardish = lines.join(String.fromCharCode(10));

(async () => {
  const cfg = AI.loadConfig();
  console.log('模型=' + (cfg.llm || {}).model + '  重建的卡文本=' + cardish.length + ' 字');
  const t0 = Date.now();
  const out = String(await AI.llmText(cfg, [
    { role: 'system', content: IMP.analyzeSystem() },
    { role: 'user', content: '卡名: 东北萝莉' + String.fromCharCode(10) + '卡正文:' + String.fromCharCode(10) + cardish }
  ], 8192) || '');
  console.log('用时 ' + Math.round((Date.now() - t0) / 1000) + 's，输出 ' + out.length + ' 字');
  console.log('\n════ 开头 360 字 ════\n' + out.slice(0, 360));
  const i0 = out.indexOf('身份证');
  console.log('\n════ 检查 ════');
  console.log('身份证是不是第一段: ' + (i0 >= 0 && i0 < 200 ? '★ 是（第 ' + i0 + ' 字）' : '否（位置 ' + i0 + '）'));
  const idn = IMP.parseIdentity(out);
  console.log('parseIdentity: ' + (idn ? '★ 摘到 ✔' : '★ 摘不到 ✘'));
  if (idn) for (const k of Object.keys(idn)) console.log('   ' + k + '：' + idn[k]);
  console.log('出现的小标题: ' + (out.match(/^#+\s*.*$/gm) || []).slice(0, 14).join(' | '));
  console.log('含「核心冲突」: ' + (out.indexOf('核心冲突') >= 0) + ' | 含「什么最重要」: ' + (out.indexOf('什么最重要') >= 0) + ' | 含「这是个什么世界」: ' + (out.indexOf('这是个什么世界') >= 0));
})().catch(e => { console.error('★ ' + (e && e.stack || e)); process.exitCode = 1; });
