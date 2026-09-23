// llm-config-check.js — LLM 参数红线（离线 · 隔离在临时目录，不碰用户配置）
// 来源：用户实测三连问——
//   ① "我明明调整了 384k，保存再点开还是 65536" → saveConfig 里有 Math.min(65536, …) 静默夹取
//   ② "卡还是有问题" → 90 秒超时被掐断，静默退回 heuristic，玩家看不出真实原因
//   ③ "COT 也占用输出 token，锁死根本写不完大卡" → max_tokens = 思考 + 产出
// 这类"静默夹取/静默回退"最贵：玩家会归因到"模型不行"，而真相是一个参数。
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');

// ★ 隔离：先改数据目录再 require，避免碰用户真实 config.json
const TMP = path.join(os.tmpdir(), 'worldsim-cfgtest-' + Date.now());
fs.mkdirSync(TMP, { recursive: true });
process.env.WORLD_SIM_DATA = TMP;

const ROOT = path.join(__dirname, '..');
const AI = require(path.join(ROOT, 'src', 'ai'));

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✔', m)) : (fail++, console.log('  ✘ FAIL:', m)); };

// [1] 官方允许的上限必须存得进去（DeepSeek max_tokens 上限 393216）
{
  const n = AI.saveConfig({ baseURL: 'https://x/v1', apiKey: 'sk-test', model: 'm', maxTokens: 393216 });
  ok(n.llm.maxTokens === 393216, '填 393216 能存下来（实测 ' + n.llm.maxTokens + '）');
  const back = AI.loadConfig();
  ok(back.llm.maxTokens === 393216, '重新读出来还是 393216（实测 ' + back.llm.maxTokens + '）—— 这就是"保存后再点开变回去"那个 bug');
}

// [2] 超出官方上限的值要被夹住（但夹到的是官方线，不是旧的 65536）
{
  const n = AI.saveConfig({ baseURL: 'https://x/v1', apiKey: 'sk-test', model: 'm', maxTokens: 9999999 });
  ok(n.llm.maxTokens === 393216, '超大值被夹到官方上限 393216（实测 ' + n.llm.maxTokens + '）');
  const n2 = AI.saveConfig({ baseURL: 'https://x/v1', apiKey: 'sk-test', model: 'm', maxTokens: 100 });
  ok(n2.llm.maxTokens === 2048, '过小值被抬到 2048（实测 ' + n2.llm.maxTokens + '）');
}

// [3] 超时必须可配置（大卡扫描要几分钟；旧版写死 90 秒 → 静默超时退回本地猜）
{
  const n = AI.saveConfig({ baseURL: 'https://x/v1', apiKey: 'sk-test', model: 'm', timeoutMs: 900000 });
  ok(n.llm.timeoutMs === 900000, '超时可以设成 900000ms（实测 ' + n.llm.timeoutMs + '）');
  const n2 = AI.saveConfig({ baseURL: 'https://x/v1', apiKey: 'sk-test', model: 'm', timeoutMs: 1000 });
  ok(n2.llm.timeoutMs === 30000, '超时下界 30000ms 生效（实测 ' + n2.llm.timeoutMs + '）');
  const n3 = AI.saveConfig({ baseURL: 'https://x/v1', apiKey: 'sk-test', model: 'm', timeoutMs: 99999999 });
  ok(n3.llm.timeoutMs === 1800000, '超时上界 1800000ms 生效（实测 ' + n3.llm.timeoutMs + '）');
  // 不传 timeoutMs 时不能把已有值冲掉
  const keep = AI.saveConfig({ baseURL: 'https://x/v1', apiKey: 'sk-test', model: 'm' });
  ok(keep.llm.timeoutMs === 1800000, '不传 timeoutMs 时保留原值（实测 ' + keep.llm.timeoutMs + '）');
}

// [3.5] ★默认超时不能太短 —— 用户实测：默认 90000ms，21.7 万字的卡扫描被掐断，
//       而且**玩家没点过"保存"就一直是这个默认值**，表现就是"扫描永远退回本地猜"。
{
  const ai = fs.readFileSync(path.join(ROOT, 'src', 'ai.js'), 'utf8');
  const def = ai.match(/timeoutMs \|\| (\d+)/);
  ok(def && Number(def[1]) >= 600000, 'llmOnce 的兜底超时 ≥ 600000ms（实测 ' + (def ? def[1] : '找不到') + '）');
  ok(/c\.llm\.timeoutMs === 90000/.test(ai), '有"旧默认 90000 → 900000"的配置迁移（没点过保存的用户也能自动修好）');
  // 清空配置后走一遍 loadConfig，确认新用户/老配置都拿到足够长的默认
  fs.writeFileSync(path.join(TMP, 'config.json'), JSON.stringify({ port: 3088, playerName: '你', llm: { baseURL: 'h', apiKey: 'k', model: 'm', timeoutMs: 90000 } }, null, 2), 'utf8');
  delete require.cache[require.resolve(path.join(ROOT, 'src', 'ai.js'))];
  const AI2 = require(path.join(ROOT, 'src', 'ai.js'));
  ok(AI2.loadConfig().llm.timeoutMs >= 600000, '旧的 90000 配置被自动抬到 ' + AI2.loadConfig().llm.timeoutMs + 'ms');
}

// [3.8] ★带 BOM 的配置文件必须能读 —— 实测事故：PowerShell 的 Set-Content -Encoding UTF8 会写 BOM，
//       桌面应用启动时 JSON.parse 直接崩："Unexpected token '锘?, ... is not valid JSON"。
{
  const bomFile = path.join(TMP, 'bom-config.json');
  fs.writeFileSync(bomFile, '\uFEFF' + JSON.stringify({ port: 3088, llm: { baseURL: 'h', apiKey: 'k', model: 'm', timeoutMs: 900000 } }), 'utf8');
  const buf = fs.readFileSync(bomFile);
  ok(buf[0] === 0xEF && buf[1] === 0xBB, '（自检）测试文件确实带 BOM');
  const { readJson, stripBom } = require(path.join(ROOT, 'src', 'store'));
  let okRead = false, parsed = null;
  try { parsed = readJson(bomFile); okRead = true; } catch (e) { okRead = false; }
  ok(okRead && parsed && parsed.llm.timeoutMs === 900000, 'readJson 能读带 BOM 的 JSON（实测 ' + (okRead ? '成功' : '失败') + '）');
  ok(stripBom('\uFEFFabc') === 'abc', 'stripBom 去掉开头的 BOM 字符');
  // 直接钉住 ai.js 不再裸读
  const aiSrc = fs.readFileSync(path.join(ROOT, 'src', 'ai.js'), 'utf8');
  ok(aiSrc.indexOf('readJson(f)') >= 0, 'loadConfig 用 readJson（不再裸 JSON.parse）');
}

// [4] 主叙事出口必须有足够大的上限（8192 装不下一整个长回合）
{
  const g = fs.readFileSync(path.join(ROOT, 'src', 'game.js'), 'utf8');
  const caps = [...g.matchAll(/Math\.min\((\d+), AI\.cfgMax\(cfg\)\)/g)].map(m => Number(m[1]));
  ok(caps.length > 0 && caps.every(c => c >= 32768), '主叙事通道的上限 ≥ 32768（实测 ' + JSON.stringify([...new Set(caps)]) + '）');
}

// [5] 设置界面不能写着和代码不一致的值（旧版界面占位符写 32768，代码却夹 65536）
{
  const app = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  ok(app.indexOf('393216') >= 0, '设置界面写明了官方上限 393216（玩家才知道能填多大）');
  /* v2.05：标签改成了人话「等待上限（分钟）」（原来直接写后端字段语"单次请求超时（毫秒）"）。
     这里守的不再是某个字面标签，而是**两件真事**：输入框还在，且"填分钟 / 存毫秒"的换算没反。 */
  ok(app.indexOf('等待上限（分钟）') >= 0, '设置界面有"等待上限（分钟）"输入框（读大卡 / 长回复必需）');
  ok(/timeoutMs:\s*Math\.round\([^)]*\*\s*60000/.test(app) || /\*\s*60000/.test(app),
    '界面填的是分钟、存进去的是毫秒（单位换算不能反）');
  ok(/toIn\.value\s*=\s*st\.config\.timeoutMs\s*\?\s*String\(Math\.round\(st\.con/.test(app),
    '读回来时毫秒→分钟（否则"保存后再点开又变回去"）');
  ok(app.indexOf('finish_reason=length') >= 0 || app.indexOf('被截断') >= 0, '界面会提示"输出被截断"（否则玩家只看到 AI 变笨）');
}
// [v1.59 补] 开关穿透 L7：生图开关——**界面显示的 = 真实值**，而且真的存得住
(function () {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  ok(app.indexOf('SRVCFG.image') >= 0 || app.indexOf('view.config.image') >= 0, '界面读的是**服务端真实配置**（不是本地缓存的一份）');
  /* v1.86：这条断言从 v1.81 起就**过时**了 —— 生图开关那时从设置弹窗搬进了独立的生图工作台
   （public/studio.js），设置里只留一个「画面引擎」入口。断言改成查真实位置（两处之一即可）。 */
const studio = fs.readFileSync(path.join(__dirname, '..', 'public', 'studio.js'), 'utf8');
ok(app.indexOf('启用生图') >= 0 || studio.indexOf('启用生图') >= 0, '生图开关在界面上看得见（设置或生图工作台）');
  ok(app.indexOf('imgEnabled') >= 0, '前端有统一的 imgEnabled() 判定（不各写各的）');
  const AICFG = require(path.join(__dirname, '..', 'src', 'ai.js'));
  const before = AICFG.loadConfig();
  const want = !!(before.image && before.image.enabled);
  AICFG.saveConfig({ image: Object.assign({}, before.image || {}, { enabled: !want }) });
  const after = AICFG.loadConfig();
  ok(!!(after.image && after.image.enabled) === !want, '生图开关**存得进、读得出**（saveConfig → loadConfig 往返一致）');
  AICFG.saveConfig({ image: Object.assign({}, before.image || {}, { enabled: want }) });   // 还原
})();

// 清理临时目录
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { }

console.log('\n==== llm-config-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
