// phase.js — 相位的确定性推进（v1.56，0 token）
// ─────────────────────────────────────────────────────────────
// 设计见《设计总稿.md》§29.3：精神状态的**"什么时候"归代码**（随世界时间 tick + 触发偏移），
// **"怎么表现"归 AI**。这样同一个 NPC 的躁期/郁期是稳定的，不会变成刻板印象或每回合贴标签。
// 数据形状（AI 建档时写，世界自己的词汇）：
//   profile.condition = { 名:'双相', 相位:['平稳','躁期','郁期'], 周期小时:72, 起于:'1996-06-14T20:45:00', 触发:['被提起亡妻'] }
//   state.phase = '郁期'（由本模块写）
// 玩家侧看不到 phase（那是诊断，不是印象）——personView 不发它。
'use strict';
const DEG = require('./degraded');
function hoursBetween(a, b) { const x = new Date(a).getTime(), y = new Date(b).getTime(); return (isFinite(x) && isFinite(y)) ? (y - x) / 3600000 : 0; }
function norm(data) {
  let n = 0;
  for (const id of Object.keys((data && data.entities) || {})) {
    const e = data.entities[id];
    if (!e || e.type !== 'person') continue;
    const c = (e.profile || {}).condition;
    if (!c || typeof c !== 'object') continue;
    const ph = Array.isArray(c.相位) ? c.相位.filter(Boolean) : null;
    if (!ph || !ph.length) continue;
    const per = Number(c.周期小时) || 72;
    const from = c.起于 || (data.current && data.current.cycleStart) || (data.current && data.current.time);
    if (!c.起于 && from) c.起于 = from;
    const idx = Math.floor(hoursBetween(from, (data.current && data.current.time) || from) / per) % ph.length;
    const want = ph[(idx + ph.length) % ph.length];
    if (e.state && e.state.phase !== want) { e.state.phase = want; n++; }
    else if (e.state && !e.state.phase) { e.state.phase = want; n++; }
  }
  return n;
}
// 触发：一条高冲击记忆被激活 / 事件发生 → 相位往前推一格（戏剧性来自"世界里发生了什么"，不是抽签）
function kick(data, personId, why) {
  try { require('./framework').ensure(data); } catch (e0) { DEG.hit("phase.js", e0); }
  const e = (data.entities || {})[personId];
  const c = e && (e.profile || {}).condition;
  if (!c || !Array.isArray(c.相位) || !c.相位.length) return null;
  const cur = (e.state || {}).phase || c.相位[0];
  const i = c.相位.indexOf(cur);
  const next = c.相位[(i + 1) % c.相位.length];
  e.state = e.state || {};
  e.state.phase = next;
  e.state.phaseWhy = String(why || '').slice(0, 60);
  try { const FW = require('./framework'); FW.ensure(data); FW.log(data, { what: '相位推进', name: (e.name || personId) + ' → ' + next, by: 'world' }); } catch (e2) { DEG.hit("phase.js", e2); }
  return next;
}
module.exports = { norm, kick, hoursBetween };
