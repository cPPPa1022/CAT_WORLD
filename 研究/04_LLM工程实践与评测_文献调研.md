# 把 LLM 接进软件系统的工程实践与评测方法（2025–2026）

> **调研性质**：纯互联网资料调研。未修改任何项目源码，未启动项目服务。
> **调研方式**：12 轮、41 条不同角度的 web 检索 + 打开 12 个代表性页面读原文（Anthropic 官方文档与工程博客、OpenAI 官方文档、DeepSeek 官方文档、arXiv/ACL 论文、成熟开源项目文档与工程博客）。
> **时间范围**：以 2023–2026 年资料为主，2025–2026 年占绝大多数（含 2026 年发布的论文/文档）。
> **证据标注**：每条论点后括注来源类型（论文 / 官方文档 / 工程博客 / 开源项目）。凡属推断或本项目特有判断，均明确标注为"推断"。
> **项目背景**：world-sim（小猫的世界）为本地 Node.js 服务 + 单页 UI，OpenAI 兼容端点，每回合两轮主 AI 调用 + 多个副 AI 角色，角色级模型配置（`main`/`msg`/`scan`/`calc`/`edit`/`digest`）。为给出可落地结论，调研期间**只读**了 `world-sim/src/ai.js`、`world-sim/src/game.js`、`world-sim/src/scheduler.js`、`world-sim/src/import.js` 的提示词装配与调用链（未修改）。

---

## 1. 结论摘要

1. **上下文工程的核心命题从"写得好的提示词"变成"管理有限的注意力预算"**。Anthropic 明确把 context 定义为有限资源，随 token 增长出现 "context rot"（召回能力下降），并把上下文分为 system prompt / tools / examples / message history 四类分别做最小化与分区（[Anthropic, Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)，官方工程博客）。
2. **Prompt cache 不是"锦上添花"，而是多步调用系统的结构性成本项**。缓存读价格是基础输入价的 **0.1×**（Anthropic）或**折扣高达 90%**（OpenAI）；DeepSeek 缓存的命中价与未命中价差约 **30–50×**。不缓存时，"每步重发全部历史"会让成本随任务长度呈二次增长（[Anthropic Prompt caching](https://docs.claude.com/en/docs/build-with-claude/prompt-caching)、[OpenAI Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)、[DeepSeek Context Caching](https://api-docs.deepseek.com/guides/kv_cache)、[DeepSeek Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing)，均为官方文档）。
3. **破坏缓存命中的写法有明确清单**：断点打在"每次都变"的块上、时间戳/会话变量插在前缀里、工具定义或 JSON schema 的 key 顺序不稳定、同一回合内改动 `reasoning_effort`/`tool_choice`/有无图片。Anthropic 文档把这些逐条列为失效原因，并给出"断点放在最后一个跨请求不变的块上"这条唯一准则（官方文档）。
4. **cache 友好度的实质是内容排序问题**，可归纳为"稳定前缀 + 变动后缀"的固定分层（见 §2.2.4 的 R1–R10 排序规则）。真实工程案例显示：把动态内容从缓存前缀里搬走，单次部署就把命中率从 **7% → 74%**，最终 **84%**，整体成本降 **59%→70%**（[ProjectDiscovery, How We Cut LLM Costs by 59% With Prompt Caching](https://projectdiscovery.io/blog/how-we-cut-llm-cost-with-prompt-caching)，工程博客）。
5. **结构化输出的"合法"与"正确"是两件事**。硬约束解码能把 schema 合法率从 **61.5% 拉到 100%**，同时把答案正确率从 **19.7% 压到 11.0%**、"合法但错"的比例从 **49.5% 升到 88.9%**；同一工具调用任务从 **91.5% 可执行正确率掉到 48.0%**（[The Constraint Tax, arXiv:2605.26128](https://arxiv.org/abs/2605.26128)，论文）。因此"输出 JSON + 校验 + 重试修复"依然是必需品，且必须**分开统计合法率与正确率**。
6. **JSON Schema 的规模会直接击穿可靠性**：在 369 字段的企业级 schema 上，GPT-5/5.2、Gemini-3、Claude 4.5 等前沿模型的**合法输出率为 0%**（[ExtractBench, arXiv:2602.12247 / ar5iv](https://ar5iv.labs.arxiv.org/html/2602.12247)，论文）。"用一次大 JSON 承载全部结果"是反模式。
7. **分层与路由有实测收益，但成败取决于"质量估计器"**。RouteLLM 在多个基准上实现 **>2× 成本下降而不损质量**，且路由器可跨强弱模型对迁移（[arXiv:2406.18665](https://arxiv.org/abs/2406.18665)，论文，ICLR 2025）；统一 routing+cascading 的工作进一步指出质量估计器是决定性因素（[arXiv:2410.10347](https://arxiv.org/abs/2410.10347)，论文，ICML 2025）。
8. **LLM-as-judge 可作回归信号，不能作真理来源**。15 个评审模型 × MTBench/DevBench、22 个任务、约 40 个候选模型、**超过 15 万条评测实例**的研究确认位置偏见**非随机**，且强烈受"两个候选质量差"影响（[Judging the Judges, arXiv:2406.07791](https://arxiv.org/abs/2406.07791)，论文，AACL-IJCNLP 2025）；系统性偏差量化工作识别出 **12 类**偏见（[Justice or Prejudice?, arXiv:2410.02736](https://arxiv.org/abs/2410.02736)，论文，ICLR 2025）。工程上的对策是**断言式离线脚本 + 确定性校验优先，judge 只做兜底与排序**。
9. **本地推理的现实是"prefill 便宜、decode 贵，但 prefill 随上下文线性膨胀"**。在 DGX Spark 上，llama3.1-8B q4_K_M 的 prefill 约 **7,614 tok/s**、decode 约 **38 tok/s**；qwen3-32B q4_K_M 的 prefill 约 **705 tok/s**、decode 约 **9.4 tok/s**（[Ollama, NVIDIA DGX Spark performance](https://ollama.com/blog/nvidia-spark-performance)，官方博客）。这意味着本地部署对"每回合现配上下文"的惩罚比云端更重，缓存/前缀复用与上下文裁剪在本地是**性能问题**而非仅仅成本问题。
10. **评测驱动开发的最小闭环 = 固定用例集 + 确定性断言 + 版本化 prompt + trace 级计量**。promptfoo 把这件事定义为 "test-driven prompt engineering"（[promptfoo docs](https://www.promptfoo.dev/docs/intro/)，开源项目文档）；OpenTelemetry 的 GenAI 语义约定给出了 `gen_ai.request.model`、`gen_ai.usage.input_tokens`、`gen_ai.client.token.usage` 等标准字段与 span 结构 `invoke_agent → chat / execute_tool`（[Inside the LLM Call: GenAI Observability with OpenTelemetry](https://opentelemetry.io/blog/2026/genai-observability/)，官方标准博客）。本项目已自建等价物（`STATS`、`cached/cachePct`、`truncated`、`lastFinish`），但缺 span 级归因。

---

## 2. 分主题详述

### 2.1 上下文工程：从"写提示词"到"管理注意力预算"

**现状/主流做法。** Anthropic 把这一转变说得很直白：prompt engineering 关心"怎么写指令"，context engineering 关心"每次推理时到底该把哪些 token 放进去"（[Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)，官方工程博客，2025-09）。其论据是注意力预算有限：transformer 的 n² 关系随上下文变长被摊薄，加之训练数据里长序列更少，模型对"上下文级依赖"的专用参数更少，所以性能是**渐变而非断崖**。同一篇文档里明确提到 needle-in-a-haystack 类基准揭示的 **context rot**。另一条独立证据是 "Lost in the Middle"：关键信息位于上下文中间时检索/利用效果最差（[arXiv:2307.03172](https://arxiv.org/abs/2307.03172)，论文，2023）。

**system prompt 的结构。** Anthropic 的具体建议是"分区块"：用 `<background_information>`、`<instructions>`、`## Tool guidance`、`## Output description` 这类 XML 标签或 markdown 标题把用途不同的段落切开，并强调格式本身随模型变强而越来越不重要，**真正重要的是"最小但完整"的高信号集合**，以及落在"Goldilocks 区间"——既不是硬编码的 if-else 脆弱逻辑，也不是含糊的高层口号。同一篇文档还给出了工具设计的两条硬要求：工具集要小且**功能不重叠**（"如果人类工程师都说不清该用哪个工具，AI 更不可能"），工具返回要 token 高效。

**few-shot 例子的位置。** Anthropic 的立场是"继续强烈建议 few-shot"，但反对把边缘案例清单塞进提示词；应给**多样、典型**的例子。"位置"这个问题在 prompt caching 的语境下有了新的、更强的约束：例子属于"跨请求不变"的内容，应放在**断点之前**（即提示词前部），而 Anthropic 也顺带指出——有了缓存，"塞 20+ 个高质量例子"反而变得经济（[Prompt caching 文档](https://docs.claude.com/en/docs/build-with-claude/prompt-caching)，官方文档）。

**指令冲突的优先级。** 三条可归纳的实践共识（推断，但被多份官方文档共同支持）：① **位置权威**——越靠近生成位置、越晚出现的指令对当前任务的支配力越强（这也是 §2.2 说的"变动后缀"能承载本轮临时指令的原因）；② **角色分层**——Anthropic 在缓存文档中提到，某些模型支持在会话中途追加 `{"role":"system"}` 消息来新增系统指令而**不破坏已缓存的 system/messages 缓存**（官方文档），这正是"临时高优先级指令走尾部"的官方背书；③ **冲突显式化**——OpenAI 的 agent 指南要求把每一步动作与输出映射到明确条目，并把边界情况（信息不全、用户问意料之外的问题）写进指令，而不是留给模型临场判断（[OpenAI, A Practical Guide to Building Agents](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf)，官方文档）。

**代表系统与关键机制。** Anthropic 把长时任务的上下文管理归纳为三种机制：**compaction**（把接近上限的对话摘要后重开一个上下文窗口，保留架构决策/未解 bug/实现细节，丢弃冗余工具输出，并保留最近 5 个访问过的文件）、**structured note-taking**（把笔记落到上下文之外的持久存储，如 NOTES.md，之后按需拉回；Claude 玩 Pokémon 的例子中，代理自己发展出地图、成就清单与战斗策略笔记，上下文重置后照常续跑）、**sub-agent 架构**（子代理在自己的干净上下文里跑几十万 token，只回传 1000–2000 token 的浓缩结论）（同上，官方工程博客）。这三种机制对本项目分别对应"记录层/摘要"、"存档内的 journal/记忆库"、"副 AI 角色"，见 §3。

**教训。** "do the simplest thing that works" 是 Anthropic 给出的最终建议；`Building effective agents` 里则明确区分 **workflow（代码预定义路径）与 agent（模型自主决定路径）**，并指出框架的抽象层会**遮蔽底层的真实 prompt 与响应**，让调试变难——建议直接用 LLM API（[Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)，官方工程博客）。这一点对本项目"摆脱酒馆架构、自建提示词装配"的路线是正面的。

### 2.2 Prompt cache / KV cache：命中条件、价格、与"什么写法必然打不中"

这是本次调研里资料密度最高、也最直接影响本项目设计的部分。

#### 2.2.1 三家机制差异

| 维度 | Anthropic | OpenAI | DeepSeek |
|---|---|---|---|
| 开关 | 显式 `cache_control` 断点，或请求级 automatic caching | 默认开启；GPT-5.6+ 支持 explicit / implicit 模式 | **默认开启，无需改代码** |
| 缓存对象 | 整个 prompt 前缀：**tools → system → messages**（严格顺序） | 完整渲染上下文（含 OpenAI 隐藏系统消息、developer 消息、工具定义、历史） | 请求前缀的"缓存前缀单元" |
| 最小可缓存长度 | 512 / 1024 / 2048 / 4096 tokens（按模型不同） | **1,024 tokens**（GPT-5.6+；隐藏系统 token 不计入） | 未在文档中给出固定阈值 |
| 断点数量 | 最多 **4 个**；回看窗口 **20 个块** | 最多 **4 次 cache write**；查找边界含"最近 50 个显式断点 + 隐式断点 + 前 20 个合格消息结尾" | 无用户可控断点 |
| TTL | 默认 5 分钟（每次使用免费刷新）；可选 1 小时（更贵） | 可配 `ttl`（示例中出现 `30m`） | 自动清理，"通常几小时到几天" |
| 计量字段 | `cache_creation_input_tokens` / `cache_read_input_tokens` / `input_tokens`（**仅断点之后的 token**） | `input_tokens_details.cached_tokens` / `cache_write_tokens` | `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` |

来源：[Anthropic Prompt caching](https://docs.claude.com/en/docs/build-with-claude/prompt-caching)（官方文档）、[OpenAI Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)（官方文档）、[DeepSeek Context Caching](https://api-docs.deepseek.com/guides/kv_cache)（官方文档）。

DeepSeek 的持久化规则尤其值得注意，因为它和另外两家不同：缓存命中需要**完整匹配一个"缓存前缀单元"**。单元在三种情况下产生——**请求边界**（每次请求在用户输入结束处与模型输出结束处各产生一个单元）、**公共前缀检测**（系统发现多个请求共享前缀时把它单独持久化）、**固定 token 间隔**（长输入/长输出按固定间隔切单元，避免长前缀因为永远到不了结束位置而完全不可缓存）。这意味着"第一轮 A+B、第二轮 A+C"**打不中**，但系统会把公共前缀 A 单独持久化，第三轮 A+D 就能命中（官方文档）。

#### 2.2.2 价格差异（决定了投入产出的量级）

- **Anthropic**：5 分钟缓存写入 = 基础输入价的 **1.25×**，1 小时写入 = **2×**，缓存读取 = **0.1×**（部分新模型为 0.025×）。断点本身不额外收费（[官方文档](https://docs.claude.com/en/docs/build-with-claude/prompt-caching)）。
- **OpenAI**：cache write = **1.25×** 标准未缓存输入价，cache read = **0.1×**。文档直接算了一笔账：写一次 + 完整复用一次 = **1.35×**，而不缓存处理两次 = **2×**；写一次 + 读九次 = **2.15×**，对比不缓存的 **10×**（[官方文档](https://developers.openai.com/api/docs/guides/prompt-caching)）。
- **DeepSeek**：以 deepseek-flash 为例，命中价 **$0.003 /M** vs 未命中 **$0.15 /M**（非高峰）——约 **50×** 差距；deepseek-v4-pro 为 **$0.022** vs **$0.66**——约 **30×** 差距（[Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing)，官方文档）。DeepSeek 当年上线磁盘缓存时的官方说法就是"价格降一个数量级"（[news0802](https://api-docs.deepseek.com/news/news0802/)，官方文档）。

**推论（推断）**：对使用 OpenAI 兼容端点的本地项目而言，缓存是**唯一不改变模型质量、却能把输入成本压到 1/10 ~ 1/50 的杠杆**；相比换小模型（会改变质量曲线），缓存是无损优化，应优先做。

#### 2.2.3 什么写法必然打不中（官方 + 工程实证）

Anthropic 文档给出了几个必须背下来的硬事实：

- **缓存写入只发生在断点位置**。"标记某块为 cache_control 只会写入一个条目：以该块结尾的前缀哈希。系统不会为更早的位置写条目。"
- **回看只找"以前写过的条目"，而不是"稳定的内容"**。文档里有一个和本项目高度相关的反面教材：系统上下文（块 1–5）不变，块 6 是每请求都带时间戳的用户消息，`cache_control` 打在块 6 上——**每个请求都付费写、永远读不到**。修正方法是"把 `cache_control` 移到块 5，即最后一个跨请求不变的块"。文档还特别补了一句：**automatic caching 会掉进同一个陷阱**，因为它把断点放在最后一个可缓存块上。
- **改动会按层级向下失效**：**工具定义改动 → 整个缓存失效**；`tool_choice`、web search 开关、citations 开关、speed 设置、图片增删 → 失效 system+messages；`thinking` 配置与 `output_config.effort` 改动 → **总是**失效 messages 块。
- **JSON key 顺序不稳定也会破坏缓存**：文档专门提醒某些语言（举例 Swift、Go）在 JSON 转换时会随机化 key 顺序。
- **缓存按 workspace/组织隔离**：不同 provider（Anthropic Direct vs Bedrock vs Vertex）**不共享缓存**。
- **并发请求要在第一个响应开始之后才能命中**，因为条目在响应开始后才可用。

OpenAI 侧同样列了会改变"渲染后前缀"的设置：`model`、`tools`（名称/描述/schema/顺序）、`parallel_tool_calls`、`text.format`（结构化输出会额外加入输出格式指令与 schema）、`reasoning.effort`、`text.verbosity`、`context_management`（compaction 会从第一个被改动 token 起阻止复用）（[官方文档](https://developers.openai.com/api/docs/guides/prompt-caching)）。

**工程实证（最有说服力的一份）。** ProjectDiscovery 的 Neo（多智能体安全测试，平均 26 步 / 40 次工具调用，系统提示词 20K+ token）公开了完整数据（[工程博客](https://projectdiscovery.io/blog/how-we-cut-llm-cost-with-prompt-caching)）：

| 指标 | 优化前 | 优化后 |
|---|---|---|
| 缓存命中率 | 7% | **84%** |
| 整体成本 | 基线 | **−59%**（后续 −66%，最近 10 天 −70%） |
| 缓存供给 token | — | 98 亿 |

他们的关键动作按影响排序：

1. **relocation（把动态内容搬到尾部）**——这是"单次部署把命中率从 7% 推到 74%"的一击。原本 working memory / skills / runtime context 夹在 BP1 与 BP3 之间，而 working memory 几乎每步都变，**静默杀掉命中**。修法：从 system 消息里摘出这些块，合并成一个 `<system-reminder>` 推到消息尾部；并且必须加 XML 包裹，否则"模型有时会把它当成用户请求来回应"。
2. **三个断点**：BP1 = 最后一个静态 system 块（**1h TTL**，跨用户/跨任务保温）；BP3 = 静态工具定义（按"静态在前、按名排序；动态子代理工具在后"排序，形成跨用户共享的缓存链）；BP2 = 会话滑动窗口（最后一个 tool result，**5m TTL**）。
3. **稳定模板变量**：把 `{{current_datetime}}`、`{{env_vars_list}}` 这类变量渲染成稳定占位符（如 `[provided in Runtime Context]`），真实值走尾部注入——否则"每个用户的 system prompt 都不同，跨用户共享彻底消失"。
4. **冻结 datetime**：每个任务运行只取一次时间，且**只保留日期、去掉时钟**（"包含当前时间会让 Runtime Context 每秒都变"）。
5. **provider 路由保缓存局部性**：全部流量优先走 Anthropic Direct，只在故障时回落 Bedrock/Vertex。
6. **工具消息只标记最后一个 content part**：并行工具调用时 SDK 会把每个响应扇出成独立 wire message，逐条标记会一次耗尽 4 个断点槽位。

他们还给了两条非常实用的观测结论：**命中率随任务步数上升**（1 步 35.5% / 20+ 步 74.0%）——所以"最贵的任务恰好最可缓存"；以及**聚合指标会骗人**（"整体 69% 掩盖了最近 10 天 84%、优化路径上 90%+ 的真实情况"）。极端案例对比：67.5M 输入 token / 1225 步 / 91.8% 命中 vs 66.8M 输入 token / 3.2% 命中，**成本差约 60×**。

同时他们对 **automatic caching 的批评值得本项目注意**：自动缓存"不知道你 prompt 里哪部分稳定、哪部分动态"，当动态内容夹在中间时会"在最需要缓存的内容上持续 miss"；且缺少 TTL 控制，高频平台每 5 分钟冷启动一次会让很大比例请求变成"写"而不是"读"，而**写比普通输入更贵**。

#### 2.2.4 "稳定前缀 + 变动后缀"的具体排序规则

综合三份官方文档与上述工程实证，可落成一组可执行的排序规则（规则本身为**推断/综合**，每条的依据来源在括号内）：

- **R1｜分层固定**。把每次请求的内容切成四层，层内顺序固定：**L0 全局不变**（宪章/授权声明、系统身份、输出契约）→ **L1 每存档/每角色不变**（世界观规则、能力清单、few-shot 例子、工具定义）→ **L2 低频变动**（时代演进、规则修订；1h 断点）→ **L3 每回合变动**（资料包、在场人物、时间地点、状态）→ **L4 本轮变动**（玩家输入、模块说明、查询回执、工具回执、重写要求）。
- **R2｜断点打在"最后一个跨请求字节相同的块"上**，而不是变动块上；变动的尾部内容宁可完全不缓存（OpenAI explicit 模式的设计意图正是"避免为不太可能复用的变动内容付写入费"）（Anthropic / OpenAI 官方文档）。
- **R3｜时间戳、随机数、计数器、会话 id 一律禁止出现在断点之前**；确需则冻结成"每运行一次"粒度并只保留日期（官方文档 + 工程博客）。
- **R4｜模板变量用稳定占位符渲染**，真实值从尾部注入（工程博客）。
- **R5｜序列化必须字节稳定**：工具定义顺序、JSON Schema 的 key 顺序、updates 字段顺序都要显式排序并固定序列化器；注意不同运行时/语言的 map 遍历或 JSON 库可能改变 key 顺序（Anthropic 官方文档明确警告）。
- **R6｜同一会话内不要改动会影响渲染 prefix 的参数**：`reasoning_effort`/`reasoning.effort`、`tool_choice`、`text.format`（结构化输出）、有无图片、thinking 配置。若同一回合内要做"重试"，**保持参数一致**，否则重试会同时承担 cache miss 与额外成本（Anthropic / OpenAI 官方文档）。
- **R7｜追加式增长优于重排**。多轮对话天然是追加的，因此"最后一轮的最后一块"在每轮新增块数 < 20 时能自然命中（Anthropic 的 20 块回看窗口）。长会话要在**中途补第二个断点**（工程博客的做法是每 18 块补一个，支撑到 54 块）。压缩/摘要会从第一个被改动 token 起失效，属于"预期内的一次 miss"，应尽量在回合边界做（OpenAI 官方文档 + Anthropic 官方文档）。
- **R8｜跨角色/跨用户共享：把最长的公共部分放最前，差异放最后**。若 A、B 两个角色的 prompt 差异在第 3 行，则两者共享前缀为 0（工程博客的"共享缓存链"思路）。
- **R9｜provider / endpoint 一致性**。缓存不跨 provider、跨组织，跨 workspace 也隔离；多端点回退会打散缓存池（Anthropic 官方文档 + 工程博客）。
- **R10｜TTL 分层**。高频共享的静态前缀用长 TTL（1h）保温；会话级滑动窗口用短 TTL（5m）。注意 Anthropic 的 1h 条目必须排在 5m 条目之前；混合 TTL 时按 A/B/C 三个计费位置切分（官方文档）。

**"每回合现配上下文"意味着什么。** 只要"现配"的结果是**可预测的拼接顺序**（而不是"每次都重新生成整段提示词"），缓存就是友好的；真正致命的是"每回合重排"或"把每回合变动的东西放在开头"。对本项目而言，`packetFor(data, ctx)`（资料包）在 user 消息里、system 之后——这个结构**天然是"稳定前缀 + 变动后缀"**，方向是对的；问题在于 system 块内部本身混入了变动内容（见 §3）。

### 2.3 结构化输出可靠性：JSON mode / json_schema / 语法约束解码

**现状与数据。** 三类方案的能力递减排序是：**grammar-constrained decoding（最强，逐 token 屏蔽非法 token）> provider json_schema / strict 模式 > json_object 模式（只保证是合法 JSON，不保证字段）**。

关键实测数据：

- **The Constraint Tax（arXiv:2605.26128，论文，2026）**：在 15,000 次消费级 GPU 生成上，对 Qwen2.5-0.5B/1.5B、SmolLM2-1.7B 做"仅答案"硬 schema 解码——schema 合法率 **61.5% → 100.0%**，但答案正确率 **19.7% → 11.0%**，"合法但错"的比例 **49.5% → 88.9%**。在确定性日历工具调用任务上，Qwen2.5-1.5B 在"仅提示词约束 JSON"下可执行正确率 **91.5%**，换成硬工具调用 schema 后掉到 **48.0%**——而两种模式的 schema 合法率都是 **100%**。作者的结论是**错误是语义的、不是结构的**，并给出一个建设性设计模式：**"reason free, constrain late"（先自由推理，晚施加约束）**；同时要求生产系统**分别上报** schema 合法率、答案正确率、可执行正确率与"合法但错"率。
- **Let Me Speak Freely?（EMNLP 2024 Industry，论文，[ACL Anthology](https://aclanthology.org/2024.emnlp-industry.91/)）**：格式限制会显著降低推理能力，且**约束越严退化越大**。后续工作 "The Hidden Cost of Structure"（[RANLP 2025](https://aclanthology.org/2025.ranlp-1.124/)，论文）继续量化了约束解码对语言模型性能的影响。
- **ExtractBench（arXiv:2602.12247，论文，KDD 2026）**：35 份 PDF + JSON Schema + 人工金标，12,867 个可评估字段；**前沿模型在真实规模 schema 上依旧不可靠，性能随 schema 宽度急剧退化，在 369 字段的财报 schema 上所有被测模型合法输出率为 0%**。其方法论贡献同样重要：**schema 应同时声明"怎么评分"**（标识符用精确匹配、数量用容差、名称用语义等价、数组要区分"顺序无关匹配"与"缺失 vs 显式 null"）。

**为什么"输出 JSON 再校验"仍然必须有重试与修复层。** 三条理由：① 如上，**合法 ≠ 正确**，硬约束会通过"填一个格式正确但内容错的字段"来满足约束；② 长输出会被 `max_tokens` 截断，截断后的 JSON 是半截，此时**唯一正确的处理是续写而非重试**（重试会丢掉已付费的全部输出）；③ 大 schema 下模型会用"看似合理"的值填充（ExtractBench 的"缺失 vs 幻觉"区分正是为此）。

**工程修复层的标准技术栈**（开源项目）：`jsonrepair`（[GitHub](https://github.com/josdejong/jsonrepair)，开源项目）用于修补非法 JSON；`partial-json` / Vercel AI SDK 的 `streamObject`（[AI SDK](https://github.com/vercel/ai)，开源项目）用于**流式增量解析**；各 SDK 的 schema 校验（zod/pydantic）用于结构断言。注意：流式 + `json_schema` 的组合在生态里仍有兼容性问题（例如 [langchainjs #10505](https://github.com/langchain-ai/langchainjs/issues/10505)、[vercel/ai #8320](https://github.com/vercel/ai/issues/8320)，开源项目 issue），说明"结构化输出 + 流式"不能想当然。

**"用工具调用代替大 JSON"的取舍。** 工具调用的**好处**在于：schema 由 API 层保证、参数被"分片"成多个小对象（单个字段错误不会毁掉整份输出）、天然支持多轮"回执→整合"、且与 agent 循环语义一致。**代价**同样明确：Constrain Tax 的日历任务显示工具调用 schema 反而让**可执行正确率腰斩**（91.5% → 48.0%）；OpenAI 文档也指出工具定义的变化会失效整个缓存（工具是最前一层）。**结论（推断）**：把"需要推理才得到的创作内容"留在自由文本/轻约束里，把"引擎必须严格解析的状态变更"用**窄 schema 的小工具**承载；不要用一个大 schema 同时承载创作与状态。

### 2.4 分层与多模型：cascade、routing、小模型做分类/摘要/embedding

**主流做法。** 三个层次：**routing**（按 query 选一个模型）、**cascading**（先跑小模型，不满意再升级）、**混合 cascade routing**。

- **RouteLLM（[arXiv:2406.18665](https://arxiv.org/abs/2406.18665)，论文，ICLR 2025）**：用人类偏好数据 + 数据增强训练路由器，在强弱模型之间动态选择，**成本下降超过 2×** 且不损质量；且展现出明显的**迁移能力**——测试时替换强/弱模型对，路由器仍然有效。
- **Cascade Routing（[arXiv:2410.10347](https://arxiv.org/abs/2410.10347)，论文，ICML 2025）**：给出了 cascading 的最优策略与 routing 最优性的证明，指出**好的质量估计器（quality estimator）是模型选择范式成功的决定性因素**，并证明统一框架持续优于单独使用 routing 或 cascading。
- **OpenAI 的 agent 指南**（[官方文档](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf)）给出的操作性流程是：**先用最强的模型建立性能基线 → 再逐个子任务替换成更小/更快的模型**（意图分类、检索用小模型；退款审批等难任务用大模型），并强调"每次替换都要看成功/失败"。Anthropic 的 `Building effective agents` 则把 routing 列为**工作流原语**之一，明确举例"简单/常见问题路由到 Haiku 类小模型，困难/罕见问题路由到 Sonnet 类大模型"（官方工程博客）。

**关键机制细节与教训。** ① 路由的**分类器本身要便宜**，否则省下的钱被路由开销吃掉；实践中"用小模型做意图分类/摘要/embedding、大模型做创作"是主流分工（OpenAI 官方文档 + Anthropic 官方文档）。② **缓存与路由天然冲突**——不同模型、不同 provider 的缓存不共享（Anthropic 官方文档），把请求在多个端点之间负载均衡会打散缓存池；这与 §2.2 的 R9 是同一件事。③ 本项目已有的"角色级模型配置"本质上是**静态 routing**（按角色预先分派），比 per-query 动态路由更简单、更可预测，也更不容易出错——这在工程上是合理选择（推断）。

### 2.5 流式输出与用户体验

**机制。** OpenAI 的流式在 Chat Completions 里以 `data:` 行分片返回 delta；结构化输出的 schema 也会被流式分片下发（[Chat Completions streaming events](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events)，官方文档）。**首 token 延迟（TTFT）与续写速度是两条独立的体验指标**：TTFT 主要由输入长度（prefill）决定，解码速度由模型/硬件决定。Anthropic 的缓存文档明确写了缓存对 TTFT 的改善："你会普遍看到长文档的 time-to-first-token 提升"，并提供**缓存预热**（`max_tokens: 0`）来消除首次交互的 cache-miss 延迟惩罚。

**流式 JSON 的做法。** 主流是**增量解析（partial JSON）**：对累积的 buffer 反复尝试"宽松解析"，能解析出多少字段就先渲染多少（`partial-json`、Vercel AI SDK 的 `streamObject`/`parsePartialJson`，开源项目）。这带来两个工程约束：① 必须保存**原始全量 buffer**用于最终严格解析（增量解析结果只是 UI 投影）；② 必须防"半截字符串"（例如 `{"body":"他说`）导致的界面闪烁——常见办法是**只对已完成的结构化字段做渲染，文本字段做增量追加**。

**实测数据。** 面向设备-服务器协同的流式文本服务研究（[DiSCo, ACL 2025 Findings](https://aclanthology.org/2025.findings-acl.734/)，论文）指出流式服务下设备与服务器的协同调度对整体体验有实质影响；网络自适应推理控制的工作（[DRLLMS, ACM](https://dl.acm.org/doi/pdf/10.1145/3798065.3798072)，论文）则说明"在网络抖动下动态调整推理/流式策略"是一个独立的研究方向。人机交互侧的经典结论（100ms/1s/10s 三档感知阈值）在 LLM 场景需重新校准，因为生成式响应天然是"流式填充"（推断）。

**对本项目的直接含义（推断）**：`llmOnce` 已经支持 `stream: true` 并把 delta 透传给 `onDelta`；但**续写（`llmOnceFull`）与二次整合轮（查询回执/工具回执/重写）目前不传 `onDelta`**，这意味着"最贵的那几次调用反而是黑屏的"。把二次轮的增量也接到 UI，是低风险高收益的体验改进。

### 2.6 评测驱动开发与可观测性

**LLM-as-judge 的可靠性边界。** 三份高引用工作给出同一方向的结论：① MT-Bench/Chatbot Arena 的原始工作证明强 judge 与人类偏好有可观一致率，但已知存在位置偏见、冗长偏见、自我增强偏见（[arXiv:2306.05685](https://arxiv.org/abs/2306.05685)，论文，2023）；② **位置偏见不是随机噪声**——15 个 judge、22 个任务、约 40 个候选模型、15 万+ 评测实例，确认偏见随 judge 与任务显著变化，且**强烈受候选质量差影响**（[arXiv:2406.07791](https://arxiv.org/abs/2406.07791)，论文，AACL-IJCNLP 2025）；③ CALM 框架识别并量化 **12 类**偏见，结论是"即便先进模型整体表现不错，特定任务上偏见依然显著，LLM-as-judge 的可靠性仍有改进空间"（[arXiv:2410.02736](https://arxiv.org/abs/2410.02736)，论文，ICLR 2025）。亦有工作指出**没有人类锚定的 LLM judge 存在根本局限**（[No Free Labels, arXiv:2503.05061](https://arxiv.org/abs/2503.05061)，论文）。

**工程落法（工具链思路，不要求安装）。**

- **promptfoo**（[官方文档](https://www.promptfoo.dev/docs/intro/)，开源项目）：把提示词开发定义为 "test-driven"，核心是**声明式测试用例 + 多元 prompt/多 provider 矩阵对比 + 自动打分 + CI 集成**，强调完全本地运行（走你自己的 API 与 key，数据不出本机）；其断言体系支持确定性检查（包含/正则/JSON schema/自定义 JS 函数）与模型评分断言混用。
- **LangSmith / Braintrust 类**：核心思路是 **trace/span 级可观测 + 数据集回归 + 成本计量**（[LangSmith usage & billing](https://docs.langchain.com/langsmith/usage-and-billing)，官方文档）。
- **OpenTelemetry GenAI 语义约定**（[官方标准博客](https://opentelemetry.io/blog/2026/genai-observability/)）：给出了标准 span 结构与字段——顶层 `invoke_agent`，子 `chat`（每次 LLM 调用）与 `execute_tool`；属性包括 `gen_ai.request.model`、`gen_ai.usage.input_tokens`、`gen_ai.usage.output_tokens`、`gen_ai.response.finish_reasons`；指标含 `gen_ai.client.operation.duration`（延迟直方图）与 `gen_ai.client.token.usage`（token 直方图，可按 `gen_ai.token.type` 拆分输入/输出）。**默认不采集 prompt/response 内容**（敏感数据），需显式开启。本地可用免费开源的 OTLP 查看器（如 Aspire Dashboard，一条 docker 命令，无需云账号）。
- **CI 回归**：把"改提示词"当成"改代码"——固定黄金用例集、每次改动跑断言、对质量分设阈值而非二元通过（这类实践的公开写法见 [CI/CD for Evals](https://www.kinde.com/learn/ai-for-software-engineering/ai-devops/ci-cd-for-evals-running-prompt-and-agent-regression-tests-in-github-actions/)，工程博客）。

**教训。** 聚合指标会骗人（ProjectDiscovery 明确说"整体 69% 掩盖了最近 10 天 84%"）；评测必须**按路径/按角色/按模型分桶**（综合推断）。

### 2.7 失败模式清单与内容分级

| 失败模式 | 机制/成因 | 工程对策（含来源） |
|---|---|---|
| **幻觉（尤其 ID/实体幻觉）** | 大 schema 下模型用"合理值"填空；缺失与幻觉需要区分 | schema 声明逐字段评分语义；门控/白名单校验（[ExtractBench](https://ar5iv.labs.arxiv.org/html/2602.12247)，论文） |
| **指令遗忘 / 中间遗失** | 上下文变长后召回下降（context rot / lost-in-the-middle） | 最小高信号上下文、分区、把关键约束放在尾部、compaction（[Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)；[arXiv:2307.03172](https://arxiv.org/abs/2307.03172)） |
| **格式崩坏（半截/非法 JSON）** | 撞 `max_tokens`、流式分片、约束解码下的语义漂移 | 读 `finish_reason`；**截断→续写**而非重试；jsonrepair 兜底；合法率与正确率分开统计（论文 + 官方文档） |
| **重复退化（degenerate repetition）** | 自回归采样的固有退化；被截断续写时尤其明显 | 频率/存在惩罚；重复检测（n-gram/尾串重复率）；经典分析见 [Holtzman et al., arXiv:1904.09751](https://arxiv.org/abs/1904.09751)（论文）；近期抑制方法见 [LZ Penalty, arXiv:2504.20131](https://arxiv.org/abs/2504.20131)、[FOCUS & RePAIR, ICML 2026](https://icml.cc/virtual/2026/poster/66464)（论文） |
| **思维链泄漏** | 推理内容被当作正文流出；隐私层面同样危险 | 输出侧剥离（`<think>`/`思考:` 等）；更根本的是"推理 token 与输出同价"的成本问题（[Leaky Thoughts, EMNLP 2025](https://aclanthology.org/2025.emnlp-main.1347.pdf)，论文） |
| **越狱 / 内容分级** | 政策与创作自由度冲突；单点拦截易被绕过 | **分层防御**：多个专用 guardrail 并行（相关性分类器、安全分类器、PII、moderation、工具风险分级）；Anthropic 明确指出"一个模型实例处理请求、另一个实例同时筛查"比同一次调用兼顾两者效果更好（[Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)，官方工程博客；[OpenAI agent 指南](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf)，官方文档） |
| **多轮越狱** | 单轮安全的对话在长会话中被逐步引导 | MCTS 驱动的多轮红队框架等工作表明多轮场景需要专门评测（[MUSE, EMNLP 2025](https://aclanthology.org/2025.emnlp-main.1080/)，论文）；promptfoo 提供 red-team 插件与策略（[文档](https://www.promptfoo.dev/docs/red-team/strategies/retry/)，开源项目） |

**"内容分级提示词 / 内容模块化"在工程上怎么做。** 三条可迁移的做法：① **内容模块槽位独立成块**——把"内容档位"做成互斥的提示词模块，选中哪一档就只拼那一档（关=零字节），未选中的档位**不进上下文**（这是本项目 `src/content.js` + `CONTENT.blockFor()` 已在做的，方向正确；`ai.js` 注释明确写了"只拼选中的那一档（关 = 零字节）"）；② **把"授权/边界声明"与"具体内容"分开**——前者是 L0 全局不变层（有利于缓存复用与一致性），后者是随用户配置变化的低频层（L2，用长 TTL 断点隔离）；③ **判定与执行分离**——用独立调用做内容判定（可缓存、可评测），不要和创作同一次调用（Anthropic 的 parallelization / sectioning 原语，官方工程博客）。

### 2.8 本地/单机部署：本地推理与云端的混合

**性能现实。** Ollama 在 NVIDIA DGX Spark 上公布的实测（温度 0、固定 500 输出 token、关闭缓存）显示 prefill 与 decode 的**巨大不对称**（[官方博客](https://ollama.com/blog/nvidia-spark-performance)）：

| 模型 | 量化 | Prefill (tok/s) | Decode (tok/s) |
|---|---|---|---|
| llama3.1 8B | q4_K_M | 7,614 | 38.02 |
| llama3.1 8B | q8_0 | 6,110 | 25.23 |
| deepseek-r1 14B | q4_K_M | 5,919 | 19.99 |
| gemma3 12B | q4_K_M | 1,894 | 24.25 |
| gpt-oss 20B | MXFP4 | 3,224 | 58.27 |
| qwen3 32B | q4_K_M | 705.0 | 9.411 |
| gemma3 27B | q4_K_M | 834.1 | 10.83 |

**推论（推断）**：本地 decode 只有 10–60 tok/s 量级，因此"每回合重新处理 3 万 token 的上下文"在本地是**秒级到十秒级的纯等待**；云端因为 prefill 极快且可缓存，同样的浪费只体现在钱上。**本地部署把 prompt caching 从"省钱"变成"省时间"。**

**llama.cpp / Ollama 的缓存能力（开源项目文档）。** llama.cpp 的 server 已内建与云端同构的机制：`--cache-ram`（提示词缓存上限，默认 8192 MiB）、`--cache-idle-slots`（新任务时把空闲槽位存入提示词缓存）、`--kv-unified`（多序列共享单一 KV buffer）、`--ctx-checkpoints`（默认每 slot 32 个上下文检查点）、`--checkpoint-min-step`（默认 8192 token 最小间隔）、`--context-shift`，以及 `cache_prompt` 请求字段（[tools/server/README.md](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)，开源项目文档）。这与 DeepSeek 的"固定 token 间隔切缓存单元"是同一思想。

**混合架构。** 学界与业界都在推"本地优先 + 云端兜底/升级"：既有隐私保护与成本效率兼顾的本地-云混合架构研究（[IEEE, A Hybrid Local-Cloud LLM Architecture](https://ieeexplore.ieee.org/document/11525699)，论文），也有 AI-PC 场景的"设备优先混合推理"（[IEEE, On-Device-First Hybrid LLM Inference on AI-PCs](https://ieeexplore.ieee.org/abstract/document/11449769)，论文）。工程上的常见分工是：**本地跑分类/摘要/embedding/低风险生成，云端跑高价值创作与需要长上下文的推理**（综合推断）。

**单机跑一个"世界模拟器"的可行架构（推断，针对本项目）。** 本地 Node 进程作为**唯一编排者**：确定性状态机在本地（时间推进、ID、门控、校验），LLM 作为**可替换的能力后端**；主 AI 走云端（长上下文 + 强创作），副 AI（scan/calc/digest/msg）优先走本地小模型或廉价云端小模型；**本地模型同样要维持稳定前缀**（llama.cpp 的 slot prompt cache 对前缀敏感），并利用"本地零边际成本"把**离线批量任务**（年份演进、新闻生成、记忆摘要）放到本地队列而非在线回合里做。这一点和本项目已有的"每回合预算 `turnExtraBudget`（默认 3 次二轮）"是同一种思路，只是可以把"离线重活"进一步移出回合窗口。

---

## 3. 对本项目的可迁移结论

> 以下基于对 `world-sim/src/ai.js`、`game.js`、`scheduler.js` 的只读审阅。**未修改任何文件，未运行任何服务。**

### 3.1 现状评估：这套设计的工程合理性

**总体判断：这套设计（本地 Node 编排 + OpenAI 兼容端点 + 每回合两轮主调用 + 多个副 AI 角色 + 角色级模型配置）在工程上是合理的，且比多数同类项目更接近"生产级"。** 具体理由：

1. **workflow 优先于 agent**。Anthropic 的立场是"能用简单方案就别上 agent 框架"（[Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)，官方工程博客）。本项目是典型的**编排式 workflow**：回合由运行时管理、世界规则/时间/位置由引擎持有、AI 只在"行为级"自由。这与"LLM 自主决定工具循环"的 agent 相比，可预测性高得多，也没有框架抽象遮蔽 prompt 的问题。
2. **角色级模型配置 = 静态 routing**，与 OpenAI agent 指南"先用最强模型建基线，再逐子任务替换小模型"的流程一致（官方文档），比 per-query 动态路由更简单可控，也避免了路由分类器自身的成本与错误。
3. **已经内建了多条本文档推荐的做法**（这些是"已经做对了"的资产，不应推翻）：
   - **截断续写而非重试**：`llmOnceFull` 读 `LAST_FINISH === 'length'` 后自动续写（最多 4 次），并带"不要重复、不要重开头"的续写指令——这正是 §2.3 强调的正确处理。
   - **退化重复检测**：`looksDegenerate`（24 字尾串在全文出现 ≥5 次且覆盖 ≥15%）+ `looksLikeRepeat`（续写防重），对应 §2.7 的重复退化对策。
   - **思维链剥离**：`stripThink` / `sweepThink` 对 frame.beats 逐字段清洗，并做过"新槽位必须一起清洗+限长"的补丁——对应 §2.7 的 CoT 泄漏。
   - **截断可观测**：`STATS.truncated` / `lastFinish` 直接在状态条上暴露 `finish_reason`，这是 §2.6 强调的"把病因显示出来"。
   - **缓存命中计量**：`STATS.cached / cachePct` 已按 `usage.prompt_tokens_details.cached_tokens` 统计——这是做 §2.2 优化的**前提条件**，很多项目连这个都没有。
   - **每回合二轮预算**：`turnExtraBudget`（默认 3）明确限制"重写/查询/工具回执"的额外调用次数，对应 §2.4 的成本控制思路。
   - **内容模块槽位**：`CONTENT.blockFor()` 只拼选中的档位，未选中的零字节——对应 §2.7 的内容模块化。
   - **JSON 解析失败 → 重试 → 回退**：`llmJSON` 的三段式失败处理链完整，且回退是**确定性的本地模拟**（`mockMain`），这比"报错断服"稳健得多。
4. **值得警惕的是"已实测数据"的质量**。`ai.js` 注释里记了几条真实测量：`reasoning_effort: none` **省 68% 钱、快 3.7 倍**，但"引擎落库的变更"从 8/4/2 掉到 6/1/2 且偶发校验打回；`medium` 比原始行为便宜 14% 且**校验打回 0 次**；`minimal` 反而更贵（26→175）；`low` 钱没省质量最差。**这正是 §2.6 主张的那种"用可量化指标驱动档位选择"的正确做法**，建议把它固化成离线断言脚本而不是注释（见 §3.4）。

### 3.2 哪些机制可以直接照抄

| 机制 | 来源 | 在本项目的落点 |
|---|---|---|
| **稳定前缀 + 变动后缀的固定分层（R1）** | Anthropic / OpenAI 官方文档 + [ProjectDiscovery 工程博客](https://projectdiscovery.io/blog/how-we-cut-llm-cost-with-prompt-caching) | 重排 `SYSTEM()` 内部块顺序 |
| **缓存命中率按角色/按路径分桶统计** | 同上（"聚合指标会骗人"） | 扩展 `STATS` 为按 role/kind 分桶 |
| **截断→续写**（已有） | §2.3 | 保持，并补"续写也对 cache 友好"的断点设计 |
| **退化重复检测**（已有） | §2.7 | 保持，可加"重复率"写入计量 |
| **合法率 / 正确率分离上报** | [The Constraint Tax](https://arxiv.org/abs/2605.26128)，论文 | 在 `llmJSON` 出口加两个计数器：`jsonParsed` 与 `semanticRejected` |
| **"reason free, constrain late"** | 同上，论文 | 主 AI 的创作文本走自由/轻约束输出；只有 `updates` 走窄 schema 校验 |
| **确定性断言脚本 + 黄金用例集** | [promptfoo](https://www.promptfoo.dev/docs/intro/)，开源项目 | `scripts/*-check.js` 已有雏形（如 `scan-fallback-check.js`），可扩成提示词回归 |
| **OTel 风格的 span/字段命名** | [OTel GenAI](https://opentelemetry.io/blog/2026/genai-observability/)，官方标准 | 不必上 OTel，但可**照抄字段名**（model / input_tokens / output_tokens / finish_reasons）做日志与统计，未来导出零迁移 |
| **本地推理的 slot prompt cache** | [llama.cpp server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)，开源项目 | 若接本地端点，同样要保持前缀稳定 |

### 3.3 哪些不适用（及原因）

1. **Agentic 的"just-in-time 检索 + 子代理自主探索"**——Anthropic 描述的 `glob`/`grep`/文件系统导航（[官方工程博客](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)）依赖"环境可探索"这个前提。本项目的"按需调取"（`QUERY.resolve`）是**受控的只读查询协议**，由门控决定能返回什么，这比自由探索更符合"知识门控"的不变量，**不应改为自由工具循环**。
2. **Compaction（AI 自动摘要压缩上下文）**——本项目已有"记录层（按世界日摘要）"和"manifest 欠账"，属于**引擎侧确定性压缩**。让 AI 自主决定"哪些历史该压缩掉"会引入不确定性，与"事实级严格"的划分冲突（推断）。
3. **per-query 动态路由（RouteLLM 式）**——本项目是**单机、单用户、回合制**，请求类型高度同质（都是"这一回合演什么"），动态路由的分类器开销与误判风险大于收益；角色级静态配置已足够（推断）。
4. **LLM-as-judge 作为主要质量门**——位置偏见与 12 类偏见已被系统性量化（[arXiv:2406.07791](https://arxiv.org/abs/2406.07791)、[arXiv:2410.02736](https://arxiv.org/abs/2410.02736)，论文）。本项目的"校验器 + 确定性规则"应当是主门，judge 只用于**离线评测脚本**（例如"这一回合的台词是否像该角色"），不应进在线回合。
5. **云端 multi-tenant 的跨用户缓存共享**——ProjectDiscovery 的 1h TTL 跨用户保温策略对**单机单用户**没有意义：没有第二个用户来保持缓存热。本项目只用得上"同一次游戏会话内"的 5m 级滑动窗口（推断）。

### 3.4 具体改进项（按优先级）

**P0｜把"角色级共享前缀"提到最前，让所有角色共享一个缓存前缀。**
现状：`ai.js:352 SYSTEM()` 返回 `[jobCard('main'), charter(), contentBlock, dataCatalog(), toolProtocol(), ...]`，而副 AI 在 `scheduler.js` 里用的是 `charterShort()` + 角色说明。**因为 `jobCard` 在第一个位置且每个角色都不同，两个角色共享的前缀长度为 0**；而 `charter()` 与 `charterShort()` 又是两份不同的文本。
改法（不要求改代码，仅建议）：把**角色无关的最长稳定文本**（`charterShort()` 或统一的宪章块）放到**第 0 位**，其后接角色无关的 `dataCatalog()` / `toolProtocol()`，再后才是 `jobCard(role)`，最后才是每回合的资料包。这样 6 个角色至少能共享"宪章 + 目录 + 协议"这一整段。按 R8，差异放最后。

**P0｜把 `SYSTEM()` 内的变动内容搬出 system 消息。**
`SYSTEM()` 第 363–364 行嵌入了 `data.meta.era` / `maxSeverity` / `rules`。era 与 rules 通常稳定，但**`maxSeverity` 这类字段若随剧情变化，会从中间切断整条缓存链**。建议：凡"可能变"的世界数据一律移到 user 消息（资料包）里，system 只保留"世界规则文本"这种真正不变的契约。

**P0｜`moduleFor(kind)` 不要拼在 system 尾部。**
`game.js:799` 是 `AI.SYSTEM(data, cfg) + '\n' + AI.moduleFor(intent.kind)`——模块文本随 `intent.kind` 变（move/sleep/msg/shop/default）。虽然它在 system 末尾，但只要在它之前没有断点，它就不会破坏更早的前缀；**一旦给 system 加了断点，它就会成为"断点之后的变动内容"**（这其实是可接受的、也是 OpenAI explicit 模式推荐的做法：变动内容不缓存）。真正的问题是它属于**L4 本轮变动**，语义上应该和资料包一起放在 user 消息尾部——这样 system 块可以整体成为稳定前缀。**建议移到 user 消息开头（或与资料包合并）。**

**P0｜同回合内重试不要改动 `reasoning_effort`。**
`game.js:813` 在 guard 命中重写时把档位从 `think` 改成 `(think === 'none' ? 'medium' : 'high')`。Anthropic 文档明确：`output_config.effort` 改动**总是**失效 messages 缓存；OpenAI 文档也列出 `reasoning.effort` 会改变缓存前缀。**这意味着每一次"重写一轮"都在付一次 cache miss。** 建议：要么在回合开始时就把档位定死（重写沿用同一档），要么接受 miss 但把它计入计量（当前没有这一项）。

**P1｜把缓存计量按角色/按 kind 分桶。**
`STATS` 目前是全局累加（`calls/llmMs/tokIn/tokOut/cached`）。工程实证显示**聚合命中率会掩盖问题**（[ProjectDiscovery 博客](https://projectdiscovery.io/blog/how-we-cut-llm-cost-with-prompt-caching)）。建议增加 `byRole`、`byKind`、`byTurnRound`（首轮/查询轮/工具轮/重写轮）三组分桶，并新增两个字段：**`cacheMissWriteTokens`（付费写）** 与 **`extraRounds`（二轮触发次数）**。有了它们，"重写一轮值不值"就是可算的。

**P1｜续写与二轮整合要接上流式。**
`llmOnceFull` 与 `game.js` 里的三次 `messages.push(...)` 二次调用都没传 `onDelta`。§2.5 已说明 TTFT 是体验主轴，且这几次恰好是**最贵、最慢**的调用。建议把 `onDelta` 透传下去（续写时注意把 delta 追加到已渲染文本之后）。

**P1｜把"合法率 / 正确率"分离。**
现在 `llmJSON` 只区分"JSON.parse 成功/失败"。建议按 [The Constraint Tax](https://arxiv.org/abs/2605.26128)（论文）的建议，在离线脚本里报四个数：**schema 合法率、语义正确率、可执行正确率、"合法但错"率**。本项目已经有 `guardCheck`（现实化/说教检测）与各种校验打回，把它们计数即得。

**P1｜`response_format` 从 `json_object` 升级为窄 `json_schema`（仅对 updates）。**
`ai.js:136-137` 固定发 `response_format: { type: 'json_object' }`。`json_object` 只保证"是合法 JSON"。按 §2.3 的取舍：**创作文本（beats）保持自由**，**`updates` 用严格 schema + strict/tool-call 承载**。注意：`text.format`/工具定义属于缓存前缀的一部分，一旦启用就必须保持字节稳定（key 顺序、字段顺序都不能抖）。

**P2｜冻结"每回合时间"。**
`msgAI` 等副 AI 提示词里直接内联了 `data.current.time`，主 AI 的资料包里也有"当前时间/天气"。这些**必须留在变动后缀里**（现在确实在后面，方向对），但要确保没有一处把时间拼进 system。工程博客的"frozen datetime + 只保留日期"技巧，在本地缓存语境下同样适用。

**P2｜离线重活移出回合窗口。**
`edit`（每日/年份节点：新闻 + 时代演进）、`digest`（睡醒简报）、`calc`（每 5 回合）本质是**批量任务**。可以做成"回合结束后异步跑、结果下回合注入"，既不占用回合延迟，也能各自维持稳定的长前缀（这些任务的输入结构远比主 AI 稳定，缓存收益最高）。

**P2｜给"提示词版本"一个身份。**
现在提示词散落在 `ai.js` / `scheduler.js` / `import.js` 的字符串拼接中。建议在 system 前缀里放一个**版本号常量**（注意：它本身是稳定的，只在发版时变），并在日志/统计里带上。工程实践上这就是 [promptfoo](https://www.promptfoo.dev/docs/intro/) 所说的"把提示词当代码"的最小代价版本。

### 3.5 建议的量化验收方式（呼应 §2.6）

沿用项目已有的"把 claim 变成数字"的习惯（`scripts/scan-fallback-check.js`、`savepack-check.js` 的思路），建议新增一个**提示词/缓存回归脚本**，固定跑 N 个代表性回合（普通对话、移动、睡眠、消息、工具回执、重写），输出：

1. `cachePct` 按角色分桶、按首轮/二轮分桶（目标：二轮命中率显著高于现值）；
2. `extraRounds` 触发次数与每次的额外 token；
3. `jsonParsed` 与 `semanticRejected` 两个计数（合法率/正确率分离）；
4. `truncated` 次数与续写轮数；
5. 每次调用的 `finish_reason` 分布；
6. 同一份输入重复跑 3 次的**缓存命中稳定性**（用于验证 R4/R5：序列化是否字节稳定）。

---

## 4. 参考链接清单

### 官方文档 / 官方工程博客

1. [Anthropic — Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)（官方工程博客，2025-09）
2. [Anthropic — Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)（官方工程博客，2024-12，2026 有更新提示）
3. [Anthropic — Prompt caching](https://docs.claude.com/en/docs/build-with-claude/prompt-caching)（官方文档）
4. [Anthropic — Cache diagnostics（beta）](https://platform.claude.com/docs/en/build-with-claude/cache-diagnostics)（官方文档）
5. [OpenAI — Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)（官方文档）
6. [OpenAI — Prompt Caching 101（Cookbook）](https://developers.openai.com/cookbook/examples/prompt_caching101)（官方文档）
7. [OpenAI — A Practical Guide to Building Agents（PDF）](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf)（官方文档）
8. [OpenAI — Chat Completions streaming events](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events)（官方文档）
9. [DeepSeek — Context Caching](https://api-docs.deepseek.com/guides/kv_cache)（官方文档）
10. [DeepSeek — Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing)（官方文档）
11. [DeepSeek — Context Caching on Disk（news0802）](https://api-docs.deepseek.com/news/news0802/)（官方文档）
12. [OpenTelemetry — Inside the LLM Call: GenAI Observability with OpenTelemetry](https://opentelemetry.io/blog/2026/genai-observability/)（官方标准博客，2026-05）
13. [OpenTelemetry — GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)（官方标准）
14. [Ollama — NVIDIA DGX Spark performance](https://ollama.com/blog/nvidia-spark-performance)（官方博客，2025-10）
15. [LangChain — LangSmith usage and billing](https://docs.langchain.com/langsmith/usage-and-billing)（官方文档）

### 论文

16. [The Constraint Tax: Measuring Validity-Correctness Tradeoffs in Structured Outputs for Small Language Models（arXiv:2605.26128）](https://arxiv.org/abs/2605.26128)
17. [ExtractBench: A Benchmark and Evaluation Methodology for Complex Structured Extraction（arXiv:2602.12247 / ar5iv）](https://ar5iv.labs.arxiv.org/html/2602.12247)
18. [Let Me Speak Freely?（EMNLP 2024 Industry Track）](https://aclanthology.org/2024.emnlp-industry.91/)
19. [The Hidden Cost of Structure: How Constrained Decoding Affects Language Model Performance（RANLP 2025）](https://aclanthology.org/2025.ranlp-1.124/)
20. [RouteLLM: Learning to Route LLMs with Preference Data（arXiv:2406.18665，ICLR 2025）](https://arxiv.org/abs/2406.18665)
21. [A Unified Approach to Routing and Cascading for LLMs（arXiv:2410.10347，ICML 2025）](https://arxiv.org/abs/2410.10347)
22. [Doing More with Less: A Survey on Routing Strategies for Resource Optimisation in LLM-Based Systems（arXiv:2502.00409）](https://arxiv.org/abs/2502.00409)
23. [Judging the Judges: A Systematic Study of Position Bias in LLM-as-a-Judge（arXiv:2406.07791，AACL-IJCNLP 2025）](https://arxiv.org/abs/2406.07791)
24. [Justice or Prejudice? Quantifying Biases in LLM-as-a-Judge（arXiv:2410.02736，ICLR 2025）](https://arxiv.org/abs/2410.02736)
25. [Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena（arXiv:2306.05685）](https://arxiv.org/abs/2306.05685)
26. [No Free Labels: Limitations of LLM-as-a-Judge Without Human Grounding（arXiv:2503.05061）](https://arxiv.org/abs/2503.05061)
27. [Lost in the Middle: How Language Models Use Long Contexts（arXiv:2307.03172）](https://arxiv.org/abs/2307.03172)
28. [The Curious Case of Neural Text Degeneration（arXiv:1904.09751）](https://arxiv.org/abs/1904.09751)
29. [LZ Penalty: An information-theoretic repetition penalty for autoregressive language models（arXiv:2504.20131）](https://arxiv.org/abs/2504.20131)
30. [Leaky Thoughts: Large Reasoning Models Are Not Private Thinkers（EMNLP 2025）](https://aclanthology.org/2025.emnlp-main.1347.pdf)
31. [MUSE: MCTS-Driven Red Teaming Framework for Enhanced Multi-Turn Dialogue Safety（EMNLP 2025）](https://aclanthology.org/2025.emnlp-main.1080/)
32. [DiSCo: Device-Server Collaborative LLM-based Text Streaming Services（ACL 2025 Findings）](https://aclanthology.org/2025.findings-acl.734/)
33. [A Hybrid Local-Cloud Large Language Model Architecture for Privacy Preservation and Cost-efficient Inference（IEEE）](https://ieeexplore.ieee.org/document/11525699)
34. [On-Device-First Hybrid LLM Inference on AI-PCs（IEEE）](https://ieeexplore.ieee.org/abstract/document/11449769)

### 工程博客

35. [ProjectDiscovery — How We Cut LLM Costs by 59% With Prompt Caching](https://projectdiscovery.io/blog/how-we-cut-llm-cost-with-prompt-caching)（2026-04，含完整命中率/成本/步数数据）
36. [CI/CD for Evals: Running Prompt & Agent Regression Tests in GitHub Actions](https://www.kinde.com/learn/ai-for-software-engineering/ai-devops/ci-cd-for-evals-running-prompt-and-agent-regression-tests-in-github-actions/)（工程博客）
37. [CNCF — OpenTelemetry for generative AI](https://www.cncf.io/blog/2025/01/20/opentelemetry-for-generative-ai/)（工程博客）
38. [Uptrace — LLM Cost Monitoring with OpenTelemetry](https://uptrace.dev/blog/llm-cost-monitoring)（工程博客）

### 开源项目 / 项目文档

39. [promptfoo — Intro](https://www.promptfoo.dev/docs/intro/) 与 [Red-team 策略](https://www.promptfoo.dev/docs/red-team/strategies/retry/)
40. [jsonrepair](https://github.com/josdejong/jsonrepair) / [llm-json-repair](https://www.npmjs.com/package/llm-json-repair)
41. [Vercel AI SDK](https://github.com/vercel/ai)（`streamObject` / partial JSON 解析）
42. [llama.cpp — tools/server/README.md](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)
43. [ContextualAI/extract-bench](https://github.com/ContextualAI/extract-bench)
44. [SillyTavern — Context Template](https://docs.sillytavern.app/usage/prompts/context-template.md)（迁移参照：Story String / `{{anchorBefore}}` / `{{wiBefore}}` / `{{mesExamples}}` 的拼接顺序；"In-chat @ Depth" 会打乱稳定前缀）
45. [SillyTavern World Info 的 position / depth 指南](https://github.com/leyu6922-art/st-character-card-authoring-public/blob/main/references/st-technical/worldbook-position-depth-guide.md)（开源项目文档；说明"按 depth 注入"与"稳定前缀"天然冲突，是本项目摆脱酒馆架构时必须放弃的一类能力）

---

*文档结束。本文档为纯资料调研产物，未对 world-sim 项目做任何代码或服务改动。*
