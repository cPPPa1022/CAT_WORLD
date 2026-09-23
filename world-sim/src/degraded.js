// degraded.js — 静默降级的统一计数（v1.86）
// ─────────────────────────────────────────────────────────────
// 为什么有它：全项目 121 处 `catch (e) { }`。一个回合里十几处静默降级，
// 任何一环失败都表现为"AI 好像变笨了"（v1.76 那个"只看到一句 Unexpected end of JSON input"
// 就是这条的产物：真正的失败被吞掉，报错在别处冒出来）。
// 设计文档里"仍未做（诚实记录）"的文化，在代码层面此前**没有任何对应机制**。
// 现在：每一次静默吞异常都记一笔（按模块计数 + 最近错误样本），/api/diag 可查、可排序。
'use strict';
const S = { byFile: {}, last: {}, total: 0, recent: [] };
function hit(where, e) {
  try {
    S.total++;
    const k = String(where || '?');
    S.byFile[k] = (S.byFile[k] || 0) + 1;
    const msg = String((e && e.message) || e || '').slice(0, 120);
    if (msg) {
      S.last[k] = msg;
      S.recent.push({ t: new Date().toISOString().slice(11, 19), where: k, msg: msg });
      if (S.recent.length > 40) S.recent.shift();
    }
  } catch (e2) { }
}
function reset() { S.byFile = {}; S.last = {}; S.total = 0; S.recent = []; }
function view() {
  const top = Object.keys(S.byFile).sort((a, b) => S.byFile[b] - S.byFile[a]).slice(0, 12)
    .map(k => ({ where: k, n: S.byFile[k], last: S.last[k] || '' }));
  return { total: S.total, modules: Object.keys(S.byFile).length, top: top, recent: S.recent.slice(-8) };
}
module.exports = { hit, reset, view };
