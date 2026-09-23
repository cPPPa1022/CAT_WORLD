---
name: sillycat-plugin
description: SillyTavern 插件 sillyCAT（CATimage / SillyImage Lab v1.1.1）的模块地图、数据结构、提示词文件、设置键与占位符协议，以及它与 world-sim 的缝合点/重复资产清单与统一建议。
whenToUse: 要改插件、让 world-sim 与插件共用提示词或人物档案、排查"插件出图和引擎出图不一致"、判断某个能力该放插件还是放引擎时。
---

# sillyCAT 插件地图（D:\\SillyTavern-1.18.0\\data\\default-user\\extensions\\sillyCAT）

## 1. 它是谁
SillyTavern 前端扩展 `SillyImage Lab v1.1.1`：扫描聊天 → 建人物静态档案（九维外貌）→ 按提示词工程装配生图提示词 → 调 ComfyUI 出图 → 把图插回聊天。**只有浏览器侧（ES module + jQuery + localStorage），没有后端。**

## 2. 模块职责
| 文件 | 职责 |
|---|---|
| `index.js` | 入口：设置迁移/清缓存哨兵、加载 prompts、挂 UI、startPolling、协作卡刷新、slash 命令 `/sillylab` |
| `modules/scanner.js` | 轮询聊天 DOM、消息指纹/缓存、扫描触发、`runAuxImageScan` |
| `modules/pipeline/profile.js` | 角色静态档案（`profiles`）、动态行合并、NPC 唤醒/回收、`resolveFacePrompt` |
| `modules/pipeline/pipeline.js` | 对话场景管线：正文 → 图块/提示词 → 回插正文 |
| `modules/pipeline/roster-pipeline.js` | 名单/档案批量管线 + 占位符填充 |
| `modules/roster.js` | 人物表（`personKey(name,identity)` 去重）、档案合成、与酒馆 cast 同步 |
| `modules/comfyui.js` | **ComfyUI 客户端**：工作流 CRUD、`generateImage(workflow,prompt)`、`STYLE_PRESETS`、`stripCharacterNames` |
| `modules/queue.js` | 串行出图队列（`enqueueGen`/`enqueueTask`） |
| `modules/cache.js` | 图片缓存（按 prompt / 按 blockId）+ 上传图片回 ST |
| `modules/render.js` | 图块渲染/恢复（`buildImgCard`、`restoreImageBlocks`） |
| `modules/story.js` | 剧情库长期记忆：追加条目、按标签检索、达阈值摘要 |
| `modules/sync-cards.js` | **协作卡**：把【占位符协议 + 人物档案索引】注入主 LLM（`setExtensionPrompt`） |
| `modules/settings.js` | 设置默认值与持久化（localStorage `sillab_settings`） |
| `modules/ui/*` | 面板/主题/紧凑条/子面板（纯表现层） |
| `prompts/loader.js` | 按 URL 拉取 `prompts/**/*.txt` 到 `PROMPTS[path]` |

## 3. 关键设置键（`getDefaults()`）
- ComfyUI：`cUrl`（默认 `http://localhost:8181`）、`cTimeout`(180)、`cWf`/`cWfName`、`workflows{}`
- 辅助模型：`auxUrl`/`auxKey`/`auxModel`、`profileModel`
- 策略：`imgMode`('main' 酒馆AI写占位 / 'plugin' 插件AI)、`imageMode`('always'/'encourage'/'key')、`modelType`('zit'/'anime'/'anime_tag')、`nsfwEnhance`、`promptPrefix`、`animeQualityPrefix`、`animeArtist`、`neg`
- 一致性：`directorCastImport`（扫描档案作权威 base）、`historyRounds`(5)、`storyLib`/`summaryThreshold`(40)/`summaryGap`(15)
- 档案库：`profiles{}`、`msgMap{}`（都在 localStorage）

## 4. 占位符协议（主 LLM ↔ 插件唯一契约）
```
[img:场景|人物:名字（身份标签），外貌概要；人物:名B（身份），外貌|要点1，要点2]
```
硬规则：必须半角 `[img:`（禁 `[img ：`/`【img:`/`[IMG:`）；`|` 分三段（场景/人物/要点，要点可省）；人物段必须 `人物:` 前缀；**已建档人物只写名字**（脸与身材由插件档案提供，禁止主 LLM 写外貌）；未建档写 `名字（标签），外貌概要` 并自动建档；每轮 1-3 个占位符；不写画风术语。规则全文见 `prompts/main-llm-instruction.txt`。

## 5. 提示词资产（**唯一真源在这里**）
`prompts/pipeline/`：`system.txt`(9KB)、`zit-overlay.txt`(8.7KB，中文自然语言/五官显式化/亚洲面孔/词序)、`anime-overlay.txt`、`anime-tag-overlay.txt`、`nsfw-overlay.txt`、`summary.txt`、`worldcard-npc.txt`；`prompts/roster/system.txt`；`prompts/static-profile/system.txt`；`prompts/artist-worldbook.txt`。
**注意文档漂移**：`prompts/README.md` 描述的目录（`aux-pipeline/{system.txt,rules.json,examples.json}`、`rules.json`/`examples.json` 分离）与磁盘实际结构（`pipeline/*.txt` 单文件+overlay）已经不一致——改提示词时以 **磁盘文件** 为准。

## 6. 与 world-sim 的缝合点（现状：移植，不是集成）
| 能力 | 插件实现 | 引擎实现 | 风险 |
|---|---|---|---|
| 九维外貌档案 | `pipeline/profile.js` + `roster.js` + localStorage `profiles` | `src/visual.js`（`nine`/`anchor`/`dynamic`/`faceUsable`）+ 世界 JSON | 两份 schema 各自演化 |
| 生图提示词工程 | `prompts/pipeline/*.txt`（运行时 fetch） | `src/prompts.js`（**注释自述"移植自 sillyCAT prompts/pipeline"**，代码内嵌常量） | 改一边另一边漂移 |
| ComfyUI 客户端 | `modules/comfyui.js`（`cUrl` 8181） | `server.js comfyRender`（`image.base`） | 两套工作流注入/缓存/队列实现 |
| 占位符 → 图 | `[img:...]` 行内块 + DOM 恢复 | 主 AI `img.at` 绑定 beats + `imgTasks` | 协议不同名同义，无法互相复用 |
| 长期记忆 | `story.js` 摘要检索 | `memories` + 漏斗 + `archives` | 概念重叠，粒度不同 |

**统一建议（择一，别两头改）**：
- A. 引擎侧保持自足（推荐）：`src/prompts.js` 的常量改为从 `prompts/*.txt` 同构文件加载，并加 `scripts/check-prompts.js`：对每份提示词算 sha256 写进 `prompts.lock.json`，与插件目录比对，不一致就 fail（把"漂移"变成可检测事件）。
- B. 插件侧只做 ST 呈现：档案/提示词/ComfyUI 全部下沉到引擎，插件退化为"把引擎结果插回聊天"。改动大，但长期最干净。

## 7. 改插件的注意
- 没有构建步骤：改完刷新 ST 页面（Ctrl+Shift+R），看控制台 `[sillab]` 日志与 📋 日志面板。
- 状态在 localStorage：`sillab_settings`；index.js 顶部的"哨兵键 + 一次性迁移/清缓存"块动之前先想清楚，历史 bug（图片全丢）就出在那里。
- 远端更新检测已移除（上游仓库）。
