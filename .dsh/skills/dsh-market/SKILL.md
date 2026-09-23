---
name: dsh-market
description: 检索 DSH 插件市场（dsh-plugin-catalog，3000+ 条）并给出可执行的安装命令；含市场目录/缓存位置、离线检索方法、安装与重启注意事项，以及与"小猫的世界"项目相关的候选清单与结论。
whenToUse: 需要给 DSH 加装能力（浏览器验证、生图、视觉、上下文洞察、Windows 修复等）、想知道某个插件是否值得装、或要复核市场里有没有替代方案时。
---

# DSH 插件市场检索

## 1. 市场本体在哪
- 宿主侧插件包：`~/.dsh/profiles/web/node_modules/dshmarket`（v1.45.1；由 profile 的 `package.json` → `dsh.profile.bundles` 装载，同一份还带一个 UI 皮肤 `@dsh-external/dsh-client-ui-skin-maid-atelier`）。
- 市场状态：`~/.dsh/profiles/<profile>/.dsh-market/state.json`（`{disabled,groups,groupOrder}`）。
- 目录源（`lib/regions.js`）：`dsh-plugin-catalog`（npm 包，内含 `package/plugins.json`）；官方 URL `https://awesome-dsh-plugin.com/plugins.json`；中国区走 npm 镜像 `https://mirrors.cloud.tencent.com/npm`。
- 条目字段：`name, owner, url, page, category, description{en,zh}, npm, version, stars, downloads, install, added`。
- **离线缓存**：`.dsh/market/catalog.json`（本次快照：3363 条 / version 2026.908.3168）+ `catalog-meta.json`（分类直方图）。市场每天新增约 250 条，需要新数据时按下面方法重取。

## 2. 重取目录（node，走腾讯镜像）
```js
// 直接复用市场自己的取目录实现（tar 解包逻辑不用自己写）
import { catalogFromPackage } from 'file:///C:/Users/qwe/.dsh/profiles/web/node_modules/dshmarket/lib/catalog-npm.js';
const { data, version } = await catalogFromPackage('https://mirrors.cloud.tencent.com/npm', 'dsh-plugin-catalog', undefined);
const list = Array.isArray(data) ? data : (data.plugins || []);
```
**检索纪律**：3000+ 条 / 2.7MB，**绝不要把 JSON 读进上下文**——写脚本过滤后只打印命中项（name/stars/desc 截断/install）。

## 3. 安装与重启（关键约束）
- 安装命令格式（条目里直接给了）：`dsh plugin --profile web add <npm包名>`，也支持 `github:owner/repo` 与本地目录/tarball。
- **web profile 关闭了插件 HMR**：装完必须完整停止并重启 `dsh --profile web`；只刷新页面不会加载新插件服务。
- 因此：**安装会重启宿主，当前会话会中断**；且写 `~/.dsh/profiles/...` 在本会话沙箱（workspace-write）之外 → 需要用户批准。
- 稳妥路径：**用户在 GUI 市场页点安装**（自动处理依赖/进度/重启），新能力在新会话生效（技能目录会热加载，工具目录未必——新工具一般要新会话）。

## 4. 与"小猫的世界"相关的候选（2026-09 复查结论）
| 插件 | 星 | 结论 |
|---|---|---|
| `dsh-builtin-browser`（wqty123/dsh-browser） | ★51 | **首选**：可见原生浏览器 + CDP，20-33 个 `browser_*` 工具（打开/快照/执行/填表/截图/下载/登录态），Windows 已验证，"装好即用、人机同页"。直击本项目最大结构限制：**GUI 结论只能靠用户验证**（交接文档 §5 步骤 4）。依赖 `electron`（体积大）。 |
| `dsh-verify`（Witness，263311487-ux） | ★3 | **推荐搭配**：Playwright 独立验收门——JSON 清单进，真实 Chromium 出 PASS/FAIL + 截图 + 控制台报错 + 视觉回归。"评判者不是 AI，是浏览器"，正好是 M0"尺子"的 UI 层。依赖 playwright+pngjs。 |
| `@wxg-prc-cpg/browser-skill-dsh-plugin`（Tencent/BrowserSkill 桥） | ★1855 | 能力强（可访问性/VOM 观察、多会话隔离），但**需额外装 `bsk` CLI + 在 Chrome/Edge 连扩展**，装好成本最高。星数记的是上游仓库，不是 DSH 插件本身。 |
| `@anweat/dsh-browser` | ★16 | 自包含 Playwright/Patchright，无外部依赖；配套 `dsh-web-search-pro`。备选。 |
| `dsh-vision-router` ★1086 / `modlens` ★3913 / `dsh-vision-toolkit` ★858 | 高 | **降级为可选（2026-09-10 二次纠正）**：原生视觉已经打通（见 §4.7），`read_image` 可用、我能直接看截图。这类插件现在的价值只剩**像素级工具**（元素定位/裁剪/像素对比/取色/OCR/长截图），做画面回归或立绘一致性时仍值得装；`modlens`=结构化 JSON 证据，`dsh-vision-router`=像素工具集，`dsh-tool-describe-image`=可配视觉端点。注：`dsh-vision-toolkit` 默认走作者自建免费服务，隐私自行判断。 |
| `dsh-context` | ★1328 | 上下文仪表盘（组成/演进/压缩事件/统计）。长会话看得见消耗，QoL 可选。 |
| `dsh-win32` | ★34 | Windows 原生修复（官方持久 PowerShell、Workspace Write、快捷方式）。当前 pwsh 每次调用都是新进程，若嫌烦可装。 |
| `dsh-tavern` | ★40 | 同类**竞品参考**（角色卡/世界书/预设/记忆总结/关系网/剧情选项），可用于对照设计；注意协议为 **PolyForm Noncommercial Copyleft 1.0.0（禁商用）**，只看不改。 |
| `dsh-image-gen` ★348 / `dsh-imagegen` ★56 | 中 | 会话内文生图（OpenAI 兼容端点）。本项目生图走本地 ComfyUI 工作流，**不替代**，价值有限。 |
| `dsh-skill-explorer`（属 dsh-web pack） | ★7131 | UI 里分级浏览/启停/新建/软删除技能——用来管理本项目 `.dsh/skills/` 下的自建技能，QoL 可选。 |
| `graphlint` | ★7 | AI 生成代码的死代码检测（入口不可达分析）。本项目积了 43 个脚本，清理时可用。 |

## 4.5 本项目已选定的安装清单（2026-09-09 用户确认，从市场 UI 安装）
按此顺序装（先浏览器 + 验收门，其余次要）：
1. `dsh-builtin-browser` — **33 个 `browser_*` 工具**（browser_open/click/type/fill/snapshot/screenshot/a11y/console/download/session…），Windows 已验证、装卸即用、人机同页；依赖 `electron`（下载较大）。
2. `dsh-verify` — 工具 `verify_spec` / `verify_url`：JSON 清单进 → 真实 Chromium 出 PASS/FAIL + 截图 + 控制台报错 + 视觉回归。
3. `dsh-context` — 上下文仪表盘 + `/context` 命令（无工具，UI/命令型）。
4. `dsh-win32` — Windows 原生修复：持久 PowerShell / Workspace Write / 快捷方式。
5. `@wxg-prc-cpg/browser-skill-dsh-plugin`（市场名 BrowserSkill）— 工具 `browser_page/browser_inspect/browser_interact/browser_tabs/browser_assist/browser_session`；**前置条件：先装 `bsk` CLI 并在 Chrome/Edge 连接 BrowserSkill 扩展**。
6. `dsh-tavern` — 同类竞品参考（角色卡/世界书/预设/记忆总结/关系网/剧情选项）；**PolyForm Noncommercial Copyleft 1.0.0，只读对照，不要抄代码**。

**命名冲突提醒**：`dsh-builtin-browser` 与 BrowserSkill **都注册 `browser_session`**（其余名字不重叠：前者 33 个 `browser_*`，后者 6 个）。建议：先只装 1-4 并确认加载正常，再装 5；若两者冲突，保留 `dsh-builtin-browser`（零外部依赖），BrowserSkill 属可选加强。

## 4.6 装完却用不了：四个检查点（2026-09-10 实战：dsh-verify / dsh-builtin-browser）
现象：市场 UI 上"装了很久"，插件文件已在 `node_modules`，但工具不出现、一用就报错。别猜，按序取证：
1. **真的还在装吗？** `GET http://127.0.0.1:3080/dsh-market/status` → 看 `active`/`busy`/`phase`/`done`/`currentPackage`。`busy:false` 就是装完了（本例 `active:false, phase:linking, done:112, currentPackage:playwright-core@1.63.0`）。市场日志：`~/.dsh/profiles/<profile>/.dsh-market/log.ndjson`（找 `event:install` + `exit=0`）。
2. **能不能热挂载？** `GET /dsh-market/installed` → `activation.<pkg>.state`。为 `restart` 时必须**完整重启**（`dsh --profile web`）。本例原因：`dsh-builtin-browser` 的 bundle patch 含配置/表达式（热挂载只支持纯 insert）；`dsh-verify` 的 loader entry 报 `cannot get property "tools" without inject`。
3. **postinstall 是否被 pnpm 拦掉？**（最隐蔽）pnpm 默认不跑依赖的构建脚本，凡**带二进制的包**都会静默缺件：
   - `playwright` 装好但没浏览器 → `%LOCALAPPDATA%\ms-playwright` 不存在，运行时 `Executable doesn't exist…`。
   - `electron` 装好但没运行时 → `node_modules/electron/path.txt` 与 `dist/electron.exe` 都不存在。
   - 确诊：`pnpm-workspace.yaml` 无 `onlyBuiltDependencies`/`allowBuilds` 条目。
   - **修法（国内网络：别走代理、别碰 GitHub——实测 releases 直接超时；npmmirror 434ms 返回 115MB）**：
     ```powershell
     $W='C:\Users\qwe\.dsh\profiles\web'; Set-Location $W
     $env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
     $env:PLAYWRIGHT_DOWNLOAD_HOST='https://cdn.npmmirror.com/binaries/playwright'
     node "$W\node_modules\electron\install.js"
     node "$W\node_modules\playwright\cli.js" install chromium
     ```
     （正统路径是市场 UI 的「放行构建脚本并重试」→ `POST /dsh-market/approve-builds {packages:[...]}` + 重装；但本例 `diagnostics.findings` 为空、横幅不保证出现，手补二进制更稳。）
   - 这两条命令写入工作区之外，workspace-write 沙箱下 **EPERM**，需要一次性提权。
4. **浏览器进程起不来？** 受限沙箱下 Playwright 用管道 stdio 启动浏览器 → `spawn EPERM`（文档化边界）。**不代表插件坏了**：插件跑在宿主进程里、不受该沙箱约束；本地自测需一次性提权。
   实测基线（2026-09-10）：`electron.exe --version` → v44.3.0；Playwright `chromium.launch()` → 153.0.8010.12，渲染+截图 4.7s，PNG 9.6KB。

## 4.7 模型能力（能不能看图）= 一条 input 声明的事（2026-09-10 实测）
看到 `read_image` 报 `model "X" does not declare image input` 时，**不要**下"模型不支持"的结论——先按下面三步查：
1. **判定点在 DSH 本地，不是问端点**：`@deepseek-ai/dsh-tool-fs/lib/index.js:941` 查 `active.inputModalities.includes("image")`；该值来自模型目录声明。
2. **声明从哪来**：`agent-default-model.provider` 指向 `llm-pi-ai.providers.<name>`（`~/.dsh/settings.yaml`）。该 schema（`dsh-llm-pi-ai/lib/index.js:918-942`）支持 **每个模型的 `input:`** 与 **provider 级 `defaultInput:`**；缺省是 `DEFAULT_INPUT = ["text"]`（`lib/index.js:862`）。源码注释写明取舍：宁可少声明（读图前就拒），也不要过度声明（回合中途被上游拒）。
3. **端点到底支不支持，只能实测**。直接打 `POST https://api.deepseek.com/chat/completions`，带一张**自己造的、已知答案的图**（例：48x48 左红右蓝，纯 node+zlib 手写 PNG 即可），问"左半边/右半边什么颜色"。2026-09-10 实测结论：
   | 模型 id | 看图 |
   |---|---|
   | `deepseek-flash`（`GET /models` 当前所列） | ✅ |
   | `deepseek-v4-flash`（旧 id，仍可用） | ✅ |
   | `deepseek-v4-flash-vision-exp` | ✅ |
   | `deepseek-v4-pro` | ❌（推理里自述"图片 unsupported"） |
   **修法**（只给支持图的模型加，别用 provider 级 `defaultInput` 一刀切，否则 pro 会被错误声明）：
   ```yaml
   llm-pi-ai:
     providers:
       deepseek:
         models:
           - { id: deepseek-v4-flash, name: DeepSeek V4 Flash, contextWindow: 1000000, maxTokens: 384000, input: [text, image] }
   ```
   **改完当场生效**（模型信息按请求快照解析，无需重启、无需新会话）——实测改完立刻 `read_image` 成功。
   `GET /models` 只列 `deepseek-flash` / `deepseek-v4-pro`，但旧 id（`deepseek-v4-flash` 等）仍可调用；**列不出来的 id 不代表不能用，列表里的名字也不代表就是你在用的那个**。
4. **别名背后到底是谁？看响应里的 `model` 字段 + `system_fingerprint`**（服务端会做别名规范化，自述不可信——模型会瞎猜自己是 V3/ChatGPT）：
   | 请求的 id | 响应 `model` | `system_fingerprint` |
   |---|---|---|
   | `deepseek-flash` | `deepseek-flash` | `aeb56401ca74e127821c4f9126dcb669` |
   | `deepseek-v4-flash` | **`deepseek-flash`** | **同一个** |
   | `deepseek-v4-flash-vision-exp` | **`deepseek-flash`** | **同一个** |
   | `deepseek-v4-pro` | `deepseek-v4-pro` | `a307abda487cd1b463329ccb945ce396`（不同后端，且不支持图） |
   → **2026-09-10 结论**：三个 flash 系 id 全部解析到同一个后端 = **DeepSeek V4.1 Flash**（当日发布/内测，原生多模态；旧名 `deepseek-v4-flash` 只是别名）。**指纹是判断"同一个模型"的唯一硬证据**，也是日后察觉后端被悄悄换掉的探测器。

## 4.8 两个反复踩到的坑（2026-09-10 二次实测）
**① profile 每次重装都会冲掉二进制**——pnpm 12.3.4 默认拦构建脚本，重装 `dsh-builtin-browser`/`dsh-verify` 时 `node_modules/electron/dist` 与 playwright 浏览器会被清掉且不再下载；症状是浏览器插件报 `no usable browser provider is registered`（`browser-electron/remote-host.js` 的 `available()` 探不到 electron 二进制）。
- **确诊**：`Test-Path profiles/web/node_modules/electron/path.txt`；或直接 `import .../dsh-builtin-browser/lib/browser-electron/remote-host.js` 调 `internals.resolveElectronPath()` 看它抛不抛。
- **一次性修好**（pnpm 12 的键是 `allowBuilds`，用市场路由写最稳）：
  ```powershell
  # 1) 放行构建脚本：POST http://127.0.0.1:3080/dsh-market/approve-builds
  #    headers 带 origin: http://127.0.0.1:3080，body {"packages":["electron","playwright"]}
  # 2) 立刻补回二进制（镜像，别走 GitHub——实测直连超时）
  $env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
  node "$env:USERPROFILE\.dsh\profiles\web\node_modules\electron\install.js"
  ```
  之后 `pnpm-workspace.yaml` 多出 `allowBuilds:\n  electron: true\n  playwright: true`，后续重装不再冲掉。
- **必须重启**：`available()` 在插件加载时把探测结果缓存了，补完二进制也要重启 DSH 才认。

**② `dsh-verify` 插件版会让宿主起不来**——它的 `cordis.patch.yml` 只写 `id`/`name`，缺 `inject: ['tools']`，而 `dsh/plugin.mjs` 的 `apply()` 直接读 `ctx.tools` → Cordis 抛 `cannot get property "tools" without inject` → 热挂载失败、开机时拖垮启动（市场随后把它回滚，目录消失）。
- **绕开**：不用插件，独立装它的 CLI（能力一样：真 Chromium + PASS/FAIL + 截图 + 视觉回归）：
  ```powershell
  # npm 必须用 npm.cmd（npm.ps1 被执行策略禁）
  & 'C:\Program Files\nodejs\npm.cmd' install dsh-verify --registry=https://mirrors.cloud.tencent.com/npm
  node "node_modules\dsh-verify\bin\verify.mjs" --spec spec.json --out out --json
  ```
  用法/spec 格式/踩坑见 `catworld-harness` §6。

## 5. 装完之后怎么用（给未来的自己）
装了浏览器类插件后，优先补上这三件事（都是本项目的历史欠账）：
1. 打开 `http://127.0.0.1:3088`（`npm run start:web`，与 Electron 同一套 UI）做 GUI 冒烟：菜单 → 生成/演示世界 → 提交一回合 → 截图。
2. **§6.9 出图后不自动刷新**：在浏览器里复现，看控制台报错与 `afterRenderDone` 的实际执行路径（这才是该 bug 的正确取证方式，之前只能靠用户描述）。
3. 把 UI 验收固化成 `dsh-verify` 清单（红/绿），与代码侧的 `scripts/run-all.js` 合成"M0 尺子"。
