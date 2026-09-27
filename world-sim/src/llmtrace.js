'use strict';
// llmtrace.js — AI 流量台的**内存环形缓冲**（外置只读工具的"门"）
//
// 分工照抄 wsq：**门在模拟器里，钥匙在工具手里**（`.dsh/tools/llm/`）。
// 为什么需要一个"门"而不是让工具去读磁盘：
//   请求与响应**从来没有任何地方留过** —— 它们只在一次 `llmOnce` 的栈上活了几秒。
//   服务端把它们留在内存里，钩子 `GET /api/llm` 只读地吐出来；工具不在模拟器里。
//
// 三条硬规矩（与 wsq 同一套）：
//   ① **只读**：这里只追加，工具那边没有任何写入口。
//   ② **有上限**：环形缓冲，绝不无限长（一局可能几百次调用）。
//   ③ **绝不改变行为** —— 这是最要紧的一条：
//      记日志本身失败一律吞掉；宁可丢一条记录，也不能让一个回合赔进去。
//      而且它**包在 llmOnce 外面**（见 ai.js），函数体里一个字节都没动。
//
// ⚠️ 诚实标注：这是**内存态**。进程一重启就没了 —— 页面上必须写出来（wsq 的老教训：
//   "服务端把世界缓存在内存里，直接读磁盘会拿到旧数据"；这里反过来，磁盘上什么都没有）。

const CAP = 80;                 // 最多留最近多少次调用
const BODY_CAP = 400000;        // 单条消息 / 响应的字符上限（防一份超长卡把内存撑爆）

const buf = [];
let seq = 0;
let refused = 0;                // 记日志自己失败了几次（可见，不静默）

function clip(s, n) {
  const t = String(s == null ? '' : s);
  const cap = n || BODY_CAP;
  return t.length > cap ? (t.slice(0, cap) + String.fromCharCode(10) + '…（已截断，原长 ' + t.length + ' 字符）') : t;
}

/* 调用点：从栈里找第一个"业务帧"。
   ⚠️ 判传输层要**按函数名精确比** —— 不能用 `Object\.\w+` 这种粗正则：
   `Object.llmJSON` 是传输层，但 `Object.exCalc` / `Object.runTurn` 是**真正的业务调用者**
   （charter-check.js 踩过这个坑：粗正则把业务帧全跳过了，报告里一片"(未知)"而断言照样全绿）。 */
const TRANSPORT = { llmOnce: 1, llmOnceRaw: 1, llmOnceFull: 1, llmJSON: 1, llmJSONDeep: 1, llmText: 1 };
const SELF_BASE = 'llmtrace.js';

/* 拆一个栈帧。**必须从右边拆**：Windows 路径自己带冒号（`D:\…\game.js:1124:20`），
   而帧头还顶着 `Object.begin (` 这一坨 —— 用 `\(?(.+?):(\d+):(\d+)$` 那种从左往右的非贪婪抓法，
   会把"函数名 + 半个路径"当成文件名（实测认出来的是 `llmtrace.js:109`，
   而那正是这一行自己）。**这个坑在提示词工作台的工具里也踩过一次**，写法照抄那边。 */
function parseFrame(s) {
  let t = String(s).replace(/^\s*at\s+/, '').trim();
  let fn = '';
  const lp = t.lastIndexOf(' (');
  if (t.endsWith(')') && lp >= 0) { fn = t.slice(0, lp).trim(); t = t.slice(lp + 2, -1); }
  const parts = t.split(':');
  if (parts.length < 3) return null;
  const col = parts.pop(), lineNo = parts.pop();
  if (!/^\d+$/.test(lineNo)) return null;
  const file = parts.join(':').replace(/\\/g, '/');
  return { fn: String(fn).split('.').pop(), file: file, line: Number(lineNo), base: file.slice(file.lastIndexOf('/') + 1) };
}
function siteOf() {
  try {
    const st = String(new Error().stack || '').split(String.fromCharCode(10)).slice(1);
    const here = __dirname.replace(/\\/g, '/') + '/';
    for (let i = 0; i < st.length; i++) {
      const f = parseFrame(st[i]);
      if (!f) continue;
      if (TRANSPORT[f.fn]) continue;                 // 传输层
      if (f.base === SELF_BASE) continue;            // ★ 本文件自己（begin 也在这一行上）
      if (f.file.indexOf(here) < 0) continue;        // 只要引擎自己的帧
      return f.base + ':' + f.line;
    }
  } catch (e) { }
  return '(未知)';
}

/* 角色标签：从 system 的岗位字样推。**推不出就说"（未知）"，不猜。** */
function labelOf(system) {
  const s = String(system || '');
  const R = [
    [/岗位说明书 · 主AI/, '主AI · 每回合'],
    [/世界分析师/, '建档 · 1 分析'],
    [/扫描 AI/, '建档 · 2 建世界'],
    [/开局编译/, '建档 · 3 开局编译'],
    [/世界生成器/, '生成器 · 世界'],
    [/设定核对员/, '生成器 · 设定核对'],
    [/人物生成器/, '生成器 · 人物'],
    [/地点生成器/, '生成器 · 地点'],
    [/物品生成器/, '生成器 · 物品'],
    [/机构生成器/, '生成器 · 机构'],
    [/规则生成器/, '生成器 · 自定义动作'],
    [/新闻\/传闻生成器/, '生成器 · 新闻'],
    /* ★ v3.15：创造者那一次调用原来被误标成「长相档案」——
       因为它的 system 里含「外貌 / 九维」这类词（creatorPromptBlock 的说明），先撞上了长相那条规则。
       这条必须排在长相前面：否则流量台上「造世界」会和「生成立绘」混在一起，看不出真相。 */
    [/世界模板创造者/, '世界模板创造'],
    [/世界演算 AI/, '时代 · 演算'],
    [/事件链生成器/, '时代 · 召唤链'],
    [/副 AI-消息/, '副AI · 消息'],
    [/副 AI-计算/, '副AI · 计算'],
    [/副 AI-编辑/, '副AI · 编辑'],
    [/副 AI-摘要/, '副AI · 摘要'],
    [/角色模拟器/, '角色自己开口'],
    [/SillyImage Lab/, '生图 · 提示词'],
    [/存档修复/, '存档修复'],
    [/九维|长相|外貌/, '长相档案']
  ];
  for (let i = 0; i < R.length; i++) if (R[i][0].test(s)) return R[i][1];
  return '（未知角色）';
}

/* 标记：一眼看出"这条不对劲"的那些。全是从**请求原文**里推的，不猜。 */
function flagsOf(messages, noJson) {
  const f = [];
  const all = (messages || []).map(function (m) { return String((m && m.content) || ''); }).join(String.fromCharCode(10));
  if (all.indexOf('你上一条输出被长度上限截断了') >= 0) f.push('续写');
  if (all.indexOf('上一次输出无法解析或不完整') >= 0) f.push('JSON重试');
  if (all.indexOf('【重写要求】') >= 0) f.push('说教重写');
  if (all.indexOf('【查询回执】') >= 0) f.push('查询回执');
  if (all.indexOf('【工具回执】') >= 0) f.push('工具回执');
  if (all.indexOf('【校验回执】') >= 0) f.push('校验打回');
  if ((messages || []).length > 2) f.push('多轮(' + messages.length + ')');
  if (noJson) f.push('纯文本');
  return f;
}

function begin(o) {
  const rec = {
    no: ++seq,
    t: new Date().toISOString(),
    site: o.site || siteOf(),
    label: labelOf(o.system),
    url: String(o.url || '').replace(/\/chat\/completions\/?$/, ''),
    model: String(o.model || ''),
    maxTokens: o.maxTokens,
    reason: o.reason || 'none',
    jsonMode: !!o.jsonMode,
    stream: !!o.stream,
    flags: flagsOf(o.messages, o.noJson),
    req: {
      system: clip(o.system),
      systemChars: String(o.system || '').length,
      messages: (o.messages || []).map(function (m) {
        return { role: String((m && m.role) || ''), content: clip(m && m.content) };
      })
    },
    res: null,
    ms: 0,
    err: ''
  };
  buf.push(rec);
  while (buf.length > CAP) buf.shift();
  return rec;
}

function end(rec, content, ms, finish, usage) {
  if (!rec) return;
  rec.ms = ms;
  const u = usage || null;
  rec.res = {
    content: clip(content),
    chars: String(content == null ? '' : content).length,
    finish: String(finish || ''),
    usage: u ? {
      prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens,
      cached_tokens: (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0
    } : null
  };
  if (String(finish || '') === 'length') rec.flags = (rec.flags || []).concat(['★被截断']);
  const c = String(content == null ? '' : content);
  if (c && c.length < 800 && /我不能|我无法|无法|不能帮|抱歉|不便|拒绝|不能分析|无法分析/.test(c.slice(0, 300))) rec.flags = (rec.flags || []).concat(['★疑似拒答']);
  if (!c.trim()) rec.flags = (rec.flags || []).concat(['★空返回']);
}

function fail(rec, err, ms) {
  if (!rec) return;
  rec.ms = ms;
  rec.err = String((err && err.message) || err || '').slice(0, 600);
  rec.flags = (rec.flags || []).concat(['★出错']);
}

/* 轻量列表：只给元信息（页面左边那张表）。
   为什么不一次把全文都吐出去：一次主 AI 调用的 system+user 就 1.6 万字，
   80 条 = 上百 MB —— 工具每 2 秒轮询一次会把浏览器打死。所以**分两段取**（wsq 的"点一行展开"）。 */
function list(n) {
  const k = Math.max(1, Math.min(CAP, parseInt(n, 10) || 40));
  return buf.slice(-k).reverse().map(function (r) {
    return {
      no: r.no, t: r.t, site: r.site, label: r.label, model: r.model,
      ms: r.ms, stream: r.stream, reason: r.reason, jsonMode: r.jsonMode,
      flags: r.flags || [], err: r.err || '',
      reqChars: r.req.systemChars, resChars: (r.res && r.res.chars) || 0,
      usage: (r.res && r.res.usage) || null,
      finish: (r.res && r.res.finish) || '',
      /* 还在飞：请求已经发出去了、响应还没回来（主 AI 一次要几十秒，这一栏让人知道
         "它正在写"而不是"它没反应"）。begin() 就 push 了记录，所以这是免费拿到的。 */
      pending: (!r.res && !r.err)
    };
  });
}
function one(no) {
  const k = parseInt(no, 10);
  for (let i = buf.length - 1; i >= 0; i--) if (buf[i].no === k) return buf[i];
  return null;
}
function view(n) { return { cap: CAP, seq: seq, n: buf.length, refused: refused, rows: list(n) }; }
function clear() { const n = buf.length; buf.length = 0; return n; }

module.exports = { begin: begin, end: end, fail: fail, list: list, one: one, view: view, clear: clear, labelOf: labelOf, siteOf: siteOf, CAP: CAP, bumpRefused: function () { refused++; } };
