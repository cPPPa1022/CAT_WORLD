// switches.js — 用户开关的**穿透度注册表**（v1.59）
// 用户：「像这种用户层级的模块开关都（体验上）没作用，那剩下那些模块，是不是也有问题？」
// 结论：这是一**类** bug —— 开关在「入口」做了，没在「出口」「回喂」做。尺子 = 七层，缺一层即体验不完整。
// 本文件只**声明**（每层检查点该长什么样）；判定在 scripts/switch-check.js（直接读源码核对）。
'use strict';
const LAYERS = {
  L1: '输入侧（提示词/资料包不提它）',
  L2: '生成侧（引擎不产生相关任务/数据）',
  L3: '存储侧（不残留进存档）',
  L4: '输出侧（AI 写出来的字里不许提它）',
  L5: '回喂侧（历史回喂给 AI 时要滤掉）',
  L6: '渲染侧（前端不画入口/图位）',
  L7: '设置一致性（界面显示值=真实值，存得住）'
};
const SWITCHES = [
  /* v1.91：**属性级检查的数据源**。
     原来这里只有 checks（源码正则）—— 那只能回答「有没有这段代码」，
     **回答不了「产物里有没有这个词」**。于是出现了一个正则全绿、体验却坏着的 bug：
     `【导演笔记不许进正文】画面笔记 / 生图提示词 / 镜头机位 / 景深构图 / 打光` 这一段是**常驻的**，
     生图关掉时它照样在提示词里 —— 而 L1 那条检查查的是 `/cfg2\.image && cfg2\.image\.enabled/`，
     只要 ai.js 里**某处**还有这个闸门，它就绿。
     vocab / onVocab 交给 scripts/module-gate-check.js 去**量产物**（不读源码）。 */
  { id: 'image', name: '生图模块', setting: '设置 · 生图 启用开关',
    probe: { what: 'SYSTEM', off: { image: { enabled: false } }, on: { image: { enabled: true } } },
    // 这些词**只因为生图模块存在才存在**：关掉时提示词里一个都不许有
    vocab: ['画面笔记', '画面要素', '生图', '导演笔记', '画师', '景深', '构图', '打光', '配图', '九维', 'Comfy'],
    // 反过来：开启时必须有（防止「把整段删掉」也算修好）
    onVocab: ['画面笔记', '生图'],
    checks: [
    { L: 'L1', file: 'src/ai.js', re: /cfg2\.image && cfg2\.image\.enabled/, note: 'img 提示词块只在开启时注入' },
    { L: 'L2', file: 'src/game.js', re: /cfg\.image && cfg\.image\.enabled/, note: '不登记 img 任务' },
    { L: 'L4', file: 'src/gate.js', re: /DIRECTOR_HINT/, note: '正文里的画面笔记/生图提示词要被删掉' },
    { L: 'L5', file: 'src/game.js', re: /scrubLegacyNotes/, note: '历史正文回喂前清洗（截断自我强化）' },
    { L: 'L6', file: 'public/app.js', re: /function imgEnabled/, note: '前端不画图位/任务条' },
    { L: 'L7', file: 'scripts/llm-config-check.js', re: /image/, note: '设置值与真实值一致' }
  ] },
  { id: 'severity', name: '事件烈度上限 maxSeverity', setting: '世界包 · maxSeverity', checks: [
    { L: 'L1', file: 'src/ai.js', re: /事件烈度上限/, note: '提示词里告诉 AI 上限' },
    { L: 'L2', file: 'src/runtime.js', re: /maxSeverity/, note: '★ 校验器要真的拦（超上限的事件 Update 必须被拒）' }
  ] },
  { id: 'selfProfile', name: '带入我的身份档案', setting: '导入世界勾选框 / 设定·我的身份档案', checks: [
    { L: 'L2a', file: 'src/worldgen.js', re: /userSelf/, note: 'AI 生成世界这条路生效' },
    { L: 'L2b', file: 'src/import.js', re: /userSelf/, note: '★ 卡盒开局（扫描角色卡）这条路也要生效' }
  ] },
  { id: 'carrier', name: '载体门控（没有的不显示）', setting: '世界包 · carries', checks: [
    { L: 'L1', file: 'src/presentation.js', re: /function deriveTools/, note: '工具由世界声明推导' },
    { L: 'L2', file: 'src/game.js', re: /buildViewTools/, note: '视图只给世界有的' },
    { L: 'L6', file: 'public/app.js', re: /function currentTool/, note: '前端只渲染 view.tools 里有的' }
  ] },
  { id: 'msgModel', name: '消息回复模型分块', setting: '设置 · 消息回复模型（留空=复用主模型）', checks: [
    { L: 'L2', file: 'src/ai.js', re: /function roleCfg/, note: '按角色取模型' },
    { L: 'L2b', file: 'src/scheduler.js', re: /roleCfg|msgAI/, note: '★ 消息这条路真的用分块模型' }
  ] },
  { id: 'theme', name: '主题（界面配色）', setting: '设置 · 主题', checks: [
    { L: 'L6', file: 'public/app.js', re: /localStorage.getItem\('wx_theme'\)/, note: '前端按主题渲染' },
    { L: 'L7', file: 'public/app.js', re: /function applyThemeSel/, note: '显示与真实一致（applyThemeSel 是唯一入口）' }
  ] },
  { id: 'tutorial', name: '新手引导', setting: '演示世界自带（data.tutorial）', checks: [
    { L: 'L2', file: 'src/game.js', re: /function advanceTutorial/, note: '按步推进' },
    { L: 'L4', file: 'src/game.js', re: /tutorHint/, note: '★ 提示只出现在 reaction，不许混进正文' },
    { L: 'L3', file: 'src/game.js', re: /data.tutorial/, note: '不残留（走完就停）' }
  ] },
  { id: 'playerName', name: '玩家名字', setting: '设置 · 你的名字', checks: [
    { L: 'L2', file: 'src/ai.js', re: /playerName/, note: 'AI 侧用玩家名字' },
    { L: 'L6', file: 'src/game.js', re: /playerName/, note: '视图里给前端' },
    { L: 'L7', file: 'src/ai.js', re: /function saveConfig/, note: '存得住' }
  ] },
  { id: 'snapshot', name: '存档快照（5 自动 + 15 手动）', setting: '世界内 · 存档面板', checks: [
    { L: 'L2', file: 'src/snapshot.js', re: /function take/, note: '引擎写快照' },
    { L: 'L3', file: 'src/snapshot.js', re: /AUTO_SLOTS/, note: '环形上限（不无限膨胀）' },
    { L: 'L6', file: 'public/app.js', re: /function panelSaves/, note: '前端有面板' },
    { L: 'L7', file: 'server.js', re: /api\/snapshots/, note: '界面读到的是真实快照列表' }
  ] },
  { id: 'content', name: '内容模块（NSFW 文风档位）', setting: '设置 · 内容模块（一档互斥）',
    probe: { what: 'SYSTEM', off: { content: { nsfw: '' } }, on: null },   // 开启态要真实档位文件，这里只验「关 = 干净」
    vocab: ['SillyImage', '配图义务'],
    checks: [
    { L: 'L1', file: 'src/ai.js', re: /CONTENT\.blockFor/, note: '只把选中的那一档拼进 system（关 = 零字节）' },
    { L: 'L1b', file: 'src/content.js', re: /function stripHead/, note: '★ 档位文件开头的 # 说明行不许进提示词' },
    { L: 'L6', file: 'public/app.js', re: /function contentTierBlock/, note: '前端有选择器（档位列表来自真实文件夹）' },
    { L: 'L7', file: 'server.js', re: /api\/content\/list/, note: '界面读到的是真实档位列表' },
    { L: 'L7b', file: 'src/ai.js', re: /content: c\.content !== undefined/, note: '存得住（写进 config.json，重启还在）' }
  ] }
];
module.exports = { LAYERS, SWITCHES };
