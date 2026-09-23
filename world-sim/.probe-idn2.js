'use strict';
const fs = require('node:fs'), path = require('node:path');
const TMP = path.join(__dirname, '.tmp-live2');
process.env.WORLD_SIM_DATA = TMP; process.env.WORLD_SIM_ASSETS = __dirname;
const AI = require('./src/ai'), IMP = require('./src/import');
(async () => {
  const cfg = AI.loadConfig();
  console.log('[1] 最小调用（32 token）:');
  const r1 = await AI.llmText(cfg, [{ role: 'user', content: '回答三个字：你好吗' }], 32);
  console.log('    返回类型=' + typeof r1 + ' 长度=' + String(r1 || '').length + ' 内容=' + JSON.stringify(String(r1 || '').slice(0, 80)));
  console.log('\n[2] 用新的 analyzeSystem 当 system、但正文只有一句话:');
  const r2 = await AI.llmText(cfg, [
    { role: 'system', content: IMP.analyzeSystem() },
    { role: 'user', content: '卡名: 测试' + String.fromCharCode(10) + '卡正文:' + String.fromCharCode(10) + '一个关于隔壁搬来一对年轻夫妻的小镇故事。' }
  ], 512);
  console.log('    长度=' + String(r2 || '').length + ' 前 200=' + JSON.stringify(String(r2 || '').slice(0, 200)));
  console.log('\n[3] analyzeSystem 的长度与末尾:');
  const s = IMP.analyzeSystem();
  console.log('    ' + s.length + ' 字，末尾 160 字=' + JSON.stringify(s.slice(-160)));
})().catch(e => { console.error('★ ' + (e && e.stack || e)); process.exitCode = 1; });
