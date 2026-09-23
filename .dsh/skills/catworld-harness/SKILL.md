---
name: catworld-harness
description: 给 world-sim 加"可量化验证"的手法与模板：离线断言脚本、临时服务器在线冒烟、无头多年仿真与统计、AI 调用计量（token/延迟/回退率）、契约合格率。用于把设计claim变成可跑的数字。
whenToUse: 要证明某个功能真的成立、写回归断言、跑长时仿真看事件分布、统计 AI 成本或合格率时。
---

# 可量化验证手册

## 0. 三层测试（按代价从低到高）
| 层 | 依赖 | 适合 | 现有例子 |
|---|---|---|---|
| L1 离线 | 直接 `require('../src/*')` | 纯逻辑（意图/校验/记忆/门控/提示词装配） | `img-smoke.js` `recall-test.js` `travel-test.js` `epoch-test.js` |
| L2 在线 | 起 `server.js`（临时数据目录） | HTTP 契约、SSE、读档持久化 | `api-smoke.js` `stream-test.js` `greeting-smoke.js` |
| L3 仿真 | 离线 + 循环推进世界时间 | 事件分布/人生弧线/调度护栏/长程不变量 | `epoch-test.js`（小规模） |

**硬性要求**：任何新断言脚本必须以非零退出码失败（`process.exitCode = 1`），否则等于没测。

## 1. L1 模板（离线断言 + 结果落盘再读）
```js
'use strict';
const W = require('../src/world'), G = require('../src/game'), RT = require('../src/runtime');
const fs = require('fs');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✔', m)) : (fail++, console.log('  ✘ FAIL:', m)); };
(async () => {
  const data = W.buildDemoWorld();
  data.id = (p) => p + '_' + Math.random().toString(36).slice(2, 8);   // 必须补 makeId
  const r = await G.runTurn(data, '买牛奶', {});                       // cfg={} → 演示模式，不调 API
  ok(r.view.money.cash === 47, '买牛奶后余额 47');
  fs.writeFileSync('out.json', JSON.stringify({ pass, fail }, null, 1)); // 中文结果用文件回读，别信控制台编码
  process.exitCode = fail ? 1 : 0;
})();
```
要点：意图解析是**逐字正则**——"买牛奶"→buy，但"我买牛奶"→act。写断言时用能命中的原句，并顺手把这个脆弱点记下来。

## 2. L2 模板（临时服务器，隔离用户数据）
```powershell
$env:PORT='3899'; $env:WORLD_SIM_DATA='<workspace>\\.tmp-smoke\\data'; $env:WORLD_SIM_ASSETS='<repo>\\world-sim'
node server.js            # 后台
node scripts/api-smoke.js # 客户端：node fetch + 中文安全
```
**中文必须走 node**：pwsh 的 `Invoke-RestMethod -Body '{"text":"买牛奶"}'` 会乱码，症状是 `intent=question`、`cash` 不变，极易误判为功能坏了。

## 3. L3 仿真模板（把 claim 变成直方图）
```js
// 例如：跑 24 个世界年，统计事件烈度分布 / 前兆链完整率 / NPC 主动发起率
let h = { L1:0, L2:0, L3:0, L4:0, noPremonition:0 };
for (let y = 0; y < 24; y++) {
  await G.runTurn(data, '跳到 ' + (1996 + y) + ' 年', cfg);   // 或 EPOCH.catchup 直调
  for (const e of data.news.slice(-99)) h[e.severity] = (h[e.severity]||0) + 1;
}
console.log(JSON.stringify(h));   // 断言：L3+/无前兆=0 / 分布单调
```
可断言的量化指标（当前缺失，建议补）：
- L3+ 事件中"有 pre 前兆新闻"的比例 = **100%**
- 事件烈度 ≤ `meta.maxSeverity` 的违规次数 = **0**
- 同年同月事件数上限（防止刷屏）
- 无人称代词的 AI 输出里出现未登记 ID = 0（校验器打回率）

## 4. AI 计量（把"零 token"变成数字）
建议在 `src/ai.js llmOnce` 出口统一埋点，写 `data.meta.stats`：
```js
{ role, phase, inChars, outChars, ms, fallback: !!j.__fallback, ok: !j.__fallback }
```
按角色聚合后即可回答：每回合花在 main/reply/calc/edit/epoch/actor 上的调用数与字符数；"不可见内容零 token"是否真的成立；回退率（`llmJSON` fallback）有多高。
中文粗略估算：`token ≈ 字符数 × 0.9`（仓库已有 `scripts/token-est.js` 可复用）。

## 4.5 成本口径与缓存（2026-09-10 实测，DSH 价表）
**价格（USD / 百万 token，DSH `~/.dsh/storages/cost-meter/ledger.json` 的本地价表）**：
| 模型 | cacheHit | cacheMiss | output | 峰值时段 |
|---|---|---|---|---|
| `deepseek-v4-flash` | **0.007** | **0.22** | **0.66** | 01-04、06-10 点翻倍 |
| `deepseek-v4-pro` | 0.022 | 0.66 | 1.98 | 同上 |

→ **缓存命中比未命中便宜 31 倍**；**输出单价是输入的 3 倍**。
**记账口径（照抄 DSH `dsh-llm-deepseek` 的 mapUsage）**：DeepSeek 的 `prompt_tokens` **包含**缓存命中，必须拆开：
```js
inputTokens = usage.prompt_tokens - (usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? 0)
cacheReadTokens = 上面那个缓存值      // 单独计费，别混进 input
```
world-sim 现状：`ai.js` 把 `prompt_tokens` 整个累进 `STATS.tokIn`（含缓存），**按全价估算会高估约 30 倍**（在缓存那部分上）。
**实测一轮（5 次调用）**：in 8774（hit 2560 / miss 6214）out 5885 → 成本 `6214×0.22 + 2560×0.007 + 5885×0.66` ≈ **$0.0053（≈¥0.038）**，其中**输出占 74%**。
→ 优化优先级：**① 控制推理 token（reasoning 与 output 同价）② 输出瘦身 ③ 输入前缀分层**。
**推理档位五档实测（2026-09-10，3 个硬回合真模型）**：`none` 0 推理 / 21s / $0.0032（但引擎落库 applied 从 8,4,2 掉到 6,1,2，偶发校验打回）｜`low` 7158 / 65s / $0.0087（**陷阱：钱没省、落库最少、打回 2 次**）｜**`medium` 8009 / 66s / $0.0086（甜点：比原始更便宜且打回 0 次）**｜`off`（不传参=原始）9509 / 80s / $0.0100｜`high` 9305 / 81s / $0.0099。
**要点**：① 原始行为本就等于高推理，一直在付这个钱；② `minimal` 不是省钱档（26→175）；③ 关推理不会"垮"（JSON/结构/不替玩家说话都合规），代价是**世界沉淀的事实变少**——与"散文问题"直接相关，别为省钱关掉主 AI 的推理；④ `roleCfg` 目前零调用点，所有 AI 共用主 cfg，**无法按角色分档**（要分档得先接线）。

**前缀缓存的唯一法则**：不变的东西放前面，会变的东西放后面。DeepSeek 是**服务端自动前缀缓存**，没有魔法标记，只能靠请求结构。
```
[0] system : 世界宪法（规则/协议/世界基调/工具说明）      ← 永不变 → 长期命中
[1] user   : 稳定资料（身世/设定/人物档案/世界书/装备）    ← 慢变 → 高命中
[2] user   : 本回合动态（时间/天气/在场/记忆/原文/行动）    ← 每回合变 → 放最后
```
world-sim 现状最糟：`moduleFor(intent.kind)` 拼在 system 末尾（意图类型一变，整个前缀失效），且 packet **第一个字段就是 `当前时间`**（user 消息从第 1 字符就不同）→ 实测缓存率仅 29%。
另一个可复用技术（DSH `offloadRequestImagesWithPolicy`）：**淘汰要成批且冻结**——"一次砍掉一大块，之后保持不动"，而不是每回合微调前缀（微调 = 每回合都让缓存失效）。

## 5. 契约合格率（AI 能力边界的唯一诚实指标）
跑 N 个真实回合，统计：`llmJSON` 首次解析成功率 / 过校验器一次通过率 / 需要打回次数 / 回退到 mock 的比例。建议基线：**首次解析 ≥95%、一次过校验 ≥85%**。低于这个数说明提示词或契约设计有问题，而不是"模型不行"。

## 6. L4 真实浏览器验收门（2026-09-10 打通，UI 层终于可量化）
**工具**：dsh-verify 的 CLI，独立装在 `D:\AI项目库\小猫的世界\.dsh\tools\verify\`（**不要用它的 DSH 插件**——插件版 `cordis.patch.yml` 缺 `inject: ['tools']`，会让宿主启动失败）。
```powershell
cd 'D:\AI项目库\小猫的世界\.dsh\tools\verify'
node "node_modules\dsh-verify\bin\verify.mjs" --spec "specs\xxx.json" --out "out\xxx" --json
```
**spec 格式（易错）**：顶层必须是 **对象**、步骤在 `steps` 数组里（README 里的裸数组示例是错的）：
```json
{ "name": "worldsim-ui-smoke", "base": "http://127.0.0.1:3901", "browser": "chromium",
  "steps": [
    { "action": "goto", "path": "/" },
    { "action": "wait", "ms": 1200 },
    { "action": "expect_text", "selector": "body", "text": "v1.10" },
    { "action": "expect_console_errors", "present": false },
    { "action": "click", "selector": "text=演示世界" },
    { "action": "wait", "ms": 3000 },
    { "action": "expect_text", "selector": "body", "text": "转角杂货铺" },
    { "action": "screenshot" }
  ] }
```
**动作与坑**：
- 动作：`goto wait click fill expect_text expect_class capture_style expect_style_changed expect_url_contains expect_navigation expect_console_errors expect_network_errors screenshot capture_baseline expect_screenshot`。
- `expect_console_errors` **默认为"期望有报错"**；要断言"零报错"必须写 `"present": false`。
- `click` 直接吃 Playwright 选择器引擎（`text=演示世界`、`#id`、`.cls` 都行）。
- `screenshot` 默认 `fullPage: true`，产物落在 out 目录 `shot-N.png`；`expect_screenshot` 做视觉回归（基线用 `--update-baselines` 刷）。
- 退出码即结论；`--json` 输出机读判定 `{verdict, passed, total}`。

**标准跑法（world-sim）**：临时数据目录起服务 → 跑 spec → **用 `read_image` 看 shot-N.png**（原生视觉已打通）。
实测基线（2026-09-10）：菜单 + 进入演示世界的 11 条断言全绿，真实 Chromium 153。

## 7. 一键跑全部（当前缺失，建议）
`world-sim/package.json` 现在 `npm test` 只跑 `selftest.js`。建议加 `scripts/run-all.js`：分类 [offline|online|manual]，逐个 `child_process.spawnSync`，超时 60s，汇总 pass/fail 并以非零退出。在线类需先起临时服务器；一次性的探测脚本（scan2/curr-dbg/qc/fix-import 等）标记 `manual` 不参与。
