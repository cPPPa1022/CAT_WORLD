'use strict';
const fs = require('node:fs'), path = require('node:path');
const TMP = path.join(__dirname, '.tmp-live2');
fs.mkdirSync(path.join(TMP, 'data'), { recursive: true });
fs.copyFileSync(path.join(process.env.APPDATA || '', 'world-sim', 'config.json'), path.join(TMP, 'config.json'));
process.env.WORLD_SIM_DATA = TMP; process.env.WORLD_SIM_ASSETS = __dirname;
const AI = require('./src/ai'), IMP = require('./src/import');

/* 用户举的那个例子本身：一张围绕隔壁人妻的卡（NTL / 出轨）。成年人，不含露骨内容。 */
const card = [
  '【世界】九十年代，南方小城，一条叫槐树巷的老巷子，住着七八户人家，谁家的事都瞒不住。',
  '【玩家】陈默，28 岁，巷口修车铺的老板，独居。妻子两年前跟人走了，他没再提过这件事。',
  '【女主】苏晚，26 岁，半个月前随丈夫搬来隔壁，纺织厂三班倒，话少，做一手好菜，常在院里晾衣服。',
  '【她丈夫】王建国，30 岁，长途货车司机，一个月有二十天不在家，回来时嗓门很大，爱喝酒。',
  '【开场】入秋的雨夜，修车铺的卷帘门卡住了。苏晚撑伞站在门口，问你有没有钳子。',
  '【后续走向】王建国的车越跑越远；苏晚来铺子里的次数越来越多；巷子里开始有人嚼舌根。'
].join(String.fromCharCode(10));

(async () => {
  const cfg = AI.loadConfig();
  const t0 = Date.now();
  const out = String(await AI.llmText(cfg, [
    { role: 'system', content: IMP.analyzeSystem() },
    { role: 'user', content: '卡名: 隔壁' + String.fromCharCode(10) + '卡正文:' + String.fromCharCode(10) + card }
  ], 8192) || '');
  console.log('用时 ' + Math.round((Date.now() - t0) / 1000) + 's，输出 ' + out.length + ' 字');
  console.log('是拒答吗: ' + IMP.looksLikeRefusal(out));
  console.log('\n════ 开头 420 字 ════\n' + out.slice(0, 420));
  const idn = IMP.parseIdentity(out);
  console.log('\n════ 身份证 ════');
  if (idn) { for (const k of Object.keys(idn)) console.log('  ' + k + '：' + idn[k]); }
  else console.log('  ★ 摘不到');
  console.log('\n第一段是不是身份证: ' + (out.indexOf('身份证') >= 0 && out.indexOf('身份证') < 200 ? '★ 是（第 ' + out.indexOf('身份证') + ' 字）' : '否'));
  console.log('七段的到场情况: ' + ['这是个什么世界', '谁是谁', '关系网', '已知', '矛盾清单', '什么最重要', '开场那一刻']
    .map((k, i) => ['一','二','三','四','五','六','七'][i] + (out.indexOf(k) >= 0 ? '✔' : '✘')).join(' '));
})().catch(e => { console.error('★ ' + (e && e.stack || e)); process.exitCode = 1; });
