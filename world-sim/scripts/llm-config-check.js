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

// [4] ★ 输出上限**只由设置决定**：src/ 里不许有任何 `Math.min(数字, cfgMax(...))` 硬帽子
/* 2026-09-26 用户原话：「扫描的时候为什么要设置限制？最大输出token数全部设置为不设限制。」
   这条原来是「主叙事通道的 Math.min 数字必须 ≥ 32768」—— **同一个意图，但当年是用硬帽子表达的**。
   硬帽子刚出过一次真事故：用户设置里填的是 384K，而建档第 1 步写的是 `Math.min(8192, cfgMax)`，
   实际只拿到 8192；而 8192 **正好是"非思考模式"的官方默认值**（思考模式默认 64K）——
   于是 8192 token 全被思考吃光、正文 0 字、finish_reason=length。
   现在守**更强的那件事**：一个硬帽子都不许有，上限一律来自 cfgMax。 */
/* ★ 扫之前必须**先去注释** —— 否则"注释里描述旧代码的那句话"会被当成旧代码。
   这条不是假想：第一版就死在 ai.js:84，命中的是我自己写的注释
   `· 而建档第 1 步写的是 Math.min(8192, cfgMax(cfg)) ⇒ …`。
   同一个坑在 charter-check 里踩过一次（注释被算成"调用点"）。
   实现要点：注释内容替换成**等长空格**（保留换行）⇒ **行号不变**，报错才能定位。
   （[4] 与 [4b] 共用，所以提到块外面。） */
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));

{
  const SRC = path.join(ROOT, 'src');
  const bad = [];
  for (const f of fs.readdirSync(SRC)) {
    if (!f.endsWith('.js')) continue;
    const raw = fs.readFileSync(path.join(SRC, f), 'utf8');
    const s = stripComments(raw);
    for (const m of s.matchAll(/Math\.min\(\d+,\s*(?:AI\.)?cfgMax\(/g)) {
      bad.push(f + ':' + (s.slice(0, m.index).split('\n').length) + ' 「' + m[0] + '」');
    }
  }
  ok(bad.length === 0, 'src/ 里没有输出上限硬帽子（实测 ' + (bad.length ? bad.join(' / ') : '一个都没有') + '）');

  const g = fs.readFileSync(path.join(ROOT, 'src', 'game.js'), 'utf8');
  ok(g.indexOf('AI.cfgMax(cfg)') >= 0, '主叙事通道的上限来自 cfgMax（= 设置里那个值）');

  const ai = fs.readFileSync(path.join(ROOT, 'src', 'ai.js'), 'utf8');
  ok(/function cfgMax\(c\)[^\n]*c\.llm\.maxTokens/.test(ai), 'cfgMax 仍是唯一真相源（读设置里的 maxTokens）');
  /* 「不设 ≠ 无限」这条坑必须留在代码里 —— 省掉字段拿到的是 8K/64K，比显式 384K 小得多。
     所以"不限"的正确写法是**显式写满**，不是删字段。 */
  ok(ai.indexOf('不设 max_tokens') >= 0, '注释里留了「不设 max_tokens ≠ 无限」这条坑（未来的人别踩）');
}

// [4b] ★ 换一个口径：**逐个调用点解析实参表**，看上限那个参数长什么样
/* 为什么 [4] 不够 —— 它抓的是 `Math.min(数字, cfgMax(...))` 这一种**形态**。
   第一版就是那个口径，于是漏掉了两处**直接传字面数字**的：
     · `game.js:2210`  `AI.llmJSON(…, {}, 900, null, 'none')`      ← 长相档案，只有 900
     · `repair.js:147` `AI.llmJSON(…, () => ({…}), 8192, …)`       ← 存档修复员
   而 **repair.js 连最初的 grep 都没进网** —— 它整个文件里没有 cfgMax / maxTokens / max_tokens
   任何一个字样。⇒ 教训：**扫"形态"永远会漏，得扫"实参"**。
   ⚠️ 上限的位置**因函数而异**（`llmText` 是第 3 个、`llmJSON` 是第 4 个）——
      第一版统一按第 4 个取，于是把 `llmText(…, cfgMax, onDelta)` 的 `onDelta`
      当成了上限，报了个**假警**。这也是为什么下面要把位置写成表。 */
{
  const MT_POS = { llmText: 2, llmOnceFull: 2, llmOnce: 2, llmJSON: 3, llmJSONDeep: 3 };
  const SRC = path.join(ROOT, 'src');

  /* s[from] 必须是 '('；返回括号**内部**的原文（按括号与引号配平，别被字符串里的 ) 骗了） */
  const parenBody = (s, from) => {
    let depth = 0, q = '';
    for (let i = from; i < s.length; i++) {
      const c = s[i];
      if (q) { if (c === '\\') i++; else if (c === q) q = ''; continue; }
      if (c === "'" || c === '"' || c === '`') { q = c; continue; }
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) return s.slice(from + 1, i); }
    }
    return '';
  };
  /* 顶层逗号切分：括号/方括号/花括号里与引号里的逗号都不算分隔 */
  const splitArgs = (raw) => {
    const out = []; let d = 0, q = '', cur = '';
    for (let k = 0; k < raw.length; k++) {
      const c = raw[k];
      if (q) { cur += c; if (c === '\\') { cur += raw[++k] || ''; } else if (c === q) q = ''; continue; }
      if (c === "'" || c === '"' || c === '`') { q = c; cur += c; continue; }
      if (c === '(' || c === '[' || c === '{') d++;
      if (c === ')' || c === ']' || c === '}') d--;
      if (c === ',' && d === 0) { out.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  };

  const rows = [];
  for (const f of fs.readdirSync(SRC)) {
    if (!f.endsWith('.js')) continue;
    const s = stripComments(fs.readFileSync(path.join(SRC, f), 'utf8'));
    for (const m of s.matchAll(/AI\.(llmJSONDeep|llmJSON|llmText|llmOnceFull|llmOnce)\s*\(/g)) {
      const parts = splitArgs(parenBody(s, m.index + m[0].length - 1));
      const raw = parts[MT_POS[m[1]]];
      rows.push({
        at: f + ':' + (s.slice(0, m.index).split('\n').length),
        mt: raw === undefined ? '(缺省)' : raw.replace(/\s+/g, ' ')
      });
    }
  }
  /* ★ 先守"扫描器自己没瞎" —— 抓不到调用点时，下面的断言会**全绿地骗人** */
  ok(rows.length >= 25, '逐个解析到 ' + rows.length + ' 个 AI.llm* 调用点（<25 说明扫描器没抓到，不是"没问题"）');

  const bad = rows.filter(r => /^\d+$/.test(r.mt));
  ok(bad.length === 0, '没有一个调用点把上限写成字面数字' +
    (bad.length ? '：\n' + bad.map(b => '         ★ ' + b.at + '  上限=' + b.mt).join('\n') : ''));

  const weird = rows.filter(r => !/cfgMax/.test(r.mt) && r.mt !== 'undefined' && r.mt !== '(缺省)');
  ok(weird.length === 0, '每个调用点要么显式 cfgMax、要么走缺省（缺省最终也落到 cfgMax）' +
    (weird.length ? '：' + JSON.stringify(weird.map(r => r.at + '=' + r.mt)) : ''));

  const explicit = rows.filter(r => /cfgMax/.test(r.mt)).length;
  console.log('       （' + explicit + ' 个显式 cfgMax · ' + (rows.length - explicit) + ' 个走缺省 ⇒ 上限一律由设置决定）');
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
