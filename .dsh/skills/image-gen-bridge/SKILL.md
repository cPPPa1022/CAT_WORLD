---
name: image-gen-bridge
description: 生图链路联调与排障：world-sim(server.js comfyRender) ⇄ ComfyUI ⇄ sillyCAT(comfyui.js) 的提示词装配、工作流注入、缓存键、队列、图进叙事流映射，以及"出图完成后界面不自动出图"的排查顺序（交接文档 §6.9）。
whenToUse: 生图不出图、提示词装错、人物外貌不一致、引擎与插件出图结果不同、继续排查 §6.9 待办时。
---

# 生图链路

## 1. 引擎侧数据流（v1.10）
```
主AI 输出 img{at,note} → runTurn 登记 imgTasks(at ∈ 本回合 beats)
  → SCHED.dispatch('image') 生图提示词（src/prompts.js: IMAGE_JOB_BASE + zit/anime/anime_tag/nsfw 段）
  → server.js comfyRender：
       buildFinalPrompt()  包装残留清洗 → pPrefix → 画风(STYLE_PRESETS)/质量前缀+艺术家/清空中文
                            → stripCharacterNames() → 截断 1500
       wfInject()          %prompt%/%negative_prompt% 占位符、负面节点识别、随机 seed、UI格式→API格式
       queueRender()       busy 入队串行，不再报错
       cache               gallery/<world>/cache/，key = sha1(最终提示词)
  → gallerySave → sceneLog 记 _imgBeatSpan → buildView 把 imgs[] 挂到 span 内条目
  → 前端 beatLine 在对应 beat 后内联图卡（done/rendering/fail/prompted）
```
图与叙事的绑定靠 `at`（beat 序号），不靠文本匹配。图库面板（🎨 画面）按时间浏览全部图。

## 2. 人物一致性（引擎侧硬规则）
- 外貌**只**来自 `profile.visual`（`src/visual.js`）：`nine`（脸型/眉眼/鼻唇/肤色/体型/发型/衣着/标记）+ `dynamic`（本轮可变：发型/衣着/配饰/状态/表情，优先于 nine）+ `anchor`。
- `faceUsable()`：nine≥2 有效维度，或 anchor 含 ≥2 个人貌线索词且 ≥10 字；占位符（"（来自卡的原设）"/"（你还没看清）"）与标志物（"旧旅行包"）一律不算 → **自动降级场景图**。
- 主 AI **禁止写外貌**，只写本轮可变要素（衣着/发型/表情/动作/道具/场景/光影/构图）。
- 提示词里**不得出现角色名**（`stripCharacterNames` 是最后防线；`scripts/img-smoke.js` 断言这一点）。

## 3. 插件侧（sillyCAT）差异点
| 维度 | 插件 | 引擎 |
|---|---|---|
| 端点默认 | `http://localhost:8181` | `image.base`（空，需手填） |
| 触发 | 主 LLM 写 `[img:...]` 占位符 / 轮询扫描 | 主 AI 输出 `img{at}` + `imgTasks` |
| 档案 | `profiles{}`（localStorage，含 `base`/`live` 与 `resolveFacePrompt`） | `profile.visual`（世界 JSON） |
| 缓存 | 内存 + localStorage，按 prompt 与 blockId 两套键 | 磁盘 `gallery/<world>/cache/`，sha1(最终提示词) |
| 队列 | `enqueueGen/enqueueTask` 串行 | `queueRender` 串行（busy 挂起等待） |

排查"两边出图不同"时先对齐这三样：**最终提示词字符串**（各自打印一次）、**工作流 JSON**（UI 格式 vs API 格式）、**seed/尺寸**。

## 4. §6.9 待排查：出图完成后界面不自动出图
现象：ComfyUI 出图完成，剧情内联图/立绘/画面面板/手机相册都不出现；手动整页刷新后才出现。已试过（无效）：finally 里加 `loadGallery + /api/state + refresh`、抽 `afterRenderDone()` 覆盖 8 个调用点、`?v=10→11→12` 缓存戳。
排查顺序（每步都要有日志证据，别猜）：
1. `%TEMP%/worldsim.log` 里是否出现 `api state (tick=…)` 与 `api gallery-list (tick=…)`（server.js 已加 GL 日志）：
   - 两条都有 → 收尾跑了但渲染无效 → 查 `refresh` 渲染链（`V` 被覆盖后的 `renderStage/imgInline` 判定）。
   - 缺一条/都没有 → `afterRenderDone` 没跑或中途抛错被吞 → 查调用路径（用户点的是哪个按钮：剧情图按钮 / 画面任务条 / 人物面板立绘 / 自动批次，四条路径各自独立验证）。
2. `toast`（'🖼 完成'/'立绘完成'）是否出现：出现=回调在跑；不出现=走了自动批次等其他路径。
3. dist 里 `resources/app/public/app.js` 是否含 `async function afterRenderDone`；浏览器是否加载旧版（静态响应无 Cache-Control 时最可疑）。
4. 任务 `imgTasks` 已是 done 但 `__gallery` 无此 id → `gallerySave` 没执行（写 rec buf 失败/异常）；出图后立刻 fetch `/api/gallery/list` 核对。
**验证必须由用户开 Electron 做**（agent 沙箱起不了 GUI）；把"看哪条日志/哪个 toast"讲清楚再让用户操作一次。
