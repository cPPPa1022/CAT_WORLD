// storyteller.js — **叙事者**：一台「油门」（v1.91）
// ─────────────────────────────────────────────────────────────
// 为什么需要它（审视 §8.2 的结论）：
//   本项目有**刹车**（烈度上限 / 概率门 / 前兆链），没有**油门** ——
//   事件的节奏与强度没有任何东西在管：候选按 `Math.random() > 0.10` 抽，
//   副 AI 的调度按 `n % 5` / `n % 7` 的回合取模走。
//   结果就是用户说的「世界像一篇篇散文，没有拉力」。
//
// 参照物是 RimWorld 的 AI Storyteller —— 那是这个领域里唯一跑通了几百万份的答案：
//   · 玩家选一个**看不见的神**（叙事者没有游戏内的身体、位置或显形）；
//   · 它**持续算一个点数**（家底 + 人口），用点数**购买**事件（不是掷骰子）；
//   · 你过得好 → 适应度涨 → 更难；你受挫 → 掉 → 松手；
//   · 三个叙事者 = 三条节奏曲线（推—松—推 / 重创后补偿 / 不管形状）。
//
// 本模块的三条硬边界（照抄设计不变量）：
//   ① **不是任务系统**：不判定成功失败、不进任何 UI、不给玩家任何提示；
//      它的产物全部是 diegetic 的（有人来找你 / 你欠的事被催 / 传闻传到当事人耳朵里）；
//   ② **代码定「何时/多急」，AI 定「是什么」**（设计总稿 §12：判定类决策代码定，AI 只演）；
//   ③ **零 token 自驱**：张力与适应度全是纯算术（0 token）；
//      只有「演成文字」花 token，而且**搭车**已有通道（主 AI 本回合顺手演）。
'use strict';
const DEG = require('./degraded');
const TH = require('./threads');   // v1.93 悬着的线：唯一推导点
const CONTRACT = require('./contract');   // v1.98 P0-5：烈度词表/归一化的唯一来源

// ---------- 阈值表（唯一来源；改参数只改这里） ----------
const PARAMS = {
  W_WEALTH: 0.5,      // 每 100 块钱 = 0.5 点（家底越厚，世界越扛得住给你事）
  W_SOCIAL: 1.0,      // 每个「认识的人」= 1 点（社会资本）
  W_THREAD: 2.0,      // 每条「悬着的线」= 2 点（★ RimWorld 没有的输入：你自己的债）
  /* ★ RimWorld 三输入里的「距上次大事多久」—— **没有它，平静的世界永远不会起事**：
     一个穷、孤独、什么事都没有的存档，张力会永远卡在门槛下面。
     所以空闲本身要产生张力（每 24 世界小时 +W_IDLE），但有上限（IDLE_MAX），不能无限攒。 */
  W_IDLE: 0.8,        // 每 24 世界小时没放行 = +0.8 点
  IDLE_MAX: 8.0,      // 空闲最多贡献这么多点（封顶，防止憋出一个大的）
  GATE_BASE: 8,       // 张力达到这个数才允许放行（世界包可覆盖 meta.tensionGate）
  COOLDOWN_H: 12,     // 两次放行之间至少 N 世界小时（防刷屏）
  ADAPT_STEP: 1,      // 每次放行 → 适应度 +1（你扛得住，就再加码）
  ADAPT_MAX: 6,
  ADAPT_DECAY_H: 72,  // 每 N 世界小时没放行 → 适应度 -1（世界会忘）
  SETBACK_H: 24,      // 近 N 世界小时内的受挫算数
  SETBACK_MIN: 2,     // 受挫条目达到这个数 → 允许一条**补偿性**候选
  COMP_COOLDOWN_H: 24 // 补偿同样有冷却
};

// ---------- 三个叙事者 = 三条节奏曲线（世界包用 meta.storyteller 选） ----------
// 默认由 meta.maxSeverity 推导（框架认参数不认假设）：
//   日常恋爱卡（≤L2）→ gentle；都市/地区（L3）→ classic；末世/战争（L4）→ wild
/* 三个预设 = 三条节奏曲线。它们**只写相对倍率**，绝对值一律从 PARAMS 来 ——
   否则预设里的数字会变成「写了不用」的死字段（原来的 cooldownH / adapt 就是这样：
   表里写着 20/12/6 和 0.5/1.0/1.5，代码只读 gate，另两个从来没被读过）。
   · cooldownMul 越大 → 两次之间隔得越久（温和）
   · adaptMul    越大 → 同样一次放行，适应度涨得越快（无常：越玩越乱） */
const PRESETS = {
  gentle:  { gate: 11, cooldownMul: 1.7, adaptMul: 0.5, compensate: true,  name: '温和' },
  classic: { gate: 8,  cooldownMul: 1.0, adaptMul: 1.0, compensate: true,  name: '经典' },
  wild:    { gate: 6,  cooldownMul: 0.5, adaptMul: 1.5, compensate: false, name: '无常' }
};
function presetOf(data) {
  const want = String(((data.meta || {}).storyteller) || '').trim();
  if (PRESETS[want]) return Object.assign({ key: want }, PRESETS[want]);
  /* v1.98 · P0-5：归一化只有一处（contract.normSev）—— 原来这里自己 String() 比一次，
     'L4 '（带空格）会落到 gentle，与烈度门判出的上限**不是同一个值**（同一张表的第二份实现）。 */
  const sev = CONTRACT.normSev((data.meta || {}).maxSeverity) || CONTRACT.MAX_DEFAULT;
  const key = (sev === 'L4') ? 'wild' : (sev === 'L3' ? 'classic' : 'gentle');
  return Object.assign({ key: key }, PRESETS[key]);
}

const mmin = (a, b) => Math.round((new Date(a).getTime() - new Date(b).getTime()) / 60000);
const hoursBetween = (a, b) => Math.max(0, mmin(a, b) / 60);

// ---------- 三个输入（全是已有的数据，一个都不新造） ----------
function wealth(data) {
  const p = (data.entities || {}).player || {};
  const cash = Number(((p.money || {}).cash) || 0);
  const inv = Array.isArray(p.inventory) ? p.inventory.length : 0;
  return (cash / 100) * PARAMS.W_WEALTH + inv * 0.3;
}
function social(data) {
  let n = 0;
  const imp = data.impressions || {};
  for (const id of Object.keys(imp)) { if (((imp[id] || {}).stage || 0) >= 2) n++; }   // stage>=2 = 知道名字的人
  return n * PARAMS.W_SOCIAL;
}
function threads(data) {
  /* v1.93：折叠收进 threads.js（唯一推导点）。
     这里用 count —— **故意不过滤**：叙事者算的是「这个世界欠着多少事」，
     不是「玩家知道多少事」。用 list(data,'player') 会让叙事者跟着玩家的认知走（错的门）。 */
  return TH.count(data);
}

// 受挫信号：世界刚刚推回来过。三个来源都是**已经发生的事实**，不新造数据。
function setback(data, now) {
  let n = 0;
  try {
    if (data.current && data.current._hardLast) n += 2;             // 上回合校验打回
    const since = new Date(new Date(now).getTime() - PARAMS.SETBACK_H * 3600000).toISOString();
    for (const l of (data.ledger || [])) {
      if (!l || !l.t || l.t < since) continue;
      if (l.type === '交易拒绝') n += 1;
      if (l.type === '关系变化' && /吵|僵|仇|翻脸|闹|冷|断/.test(String(l.desc || ''))) n += 1;
    }
  } catch (e) { DEG.hit('storyteller.js', e); }
  return n;
}

// ---------- 状态（住在存档里，跟着世界走） ----------
function ensure(data) {
  const c = data.current = data.current || {};
  if (!c.storyteller || typeof c.storyteller !== 'object') {
    c.storyteller = { adapt: 0, lastFireAt: '', lastCompAt: '', sinceAt: '', fired: 0, compensated: 0, tension: 0, setback: 0 };
  }
  const s = c.storyteller;
  if (typeof s.adapt !== 'number') s.adapt = 0;
  if (typeof s.fired !== 'number') s.fired = 0;
  return s;
}

// ---------- 主入口：每回合算一次（纯算术，0 token） ----------
// 返回 { tension, gate, fire, compensate, why }；tick 决定要不要给主 AI 一条节拍指令。
function evalOnce(data, now) {
  const s = ensure(data);
  const p = presetOf(data);
  const w = wealth(data), so = social(data), th = threads(data);
  /* 空闲项：**距上次「有事发生」多久** —— RimWorld 三个输入里的第三个。
     锚点是显式的 sinceAt（安静期从哪一刻算起）：第一次求值时起算，每次放行后重置。
     为什么不借账本最后一条的时间：账本**每回合都在长**（记忆新增/状态更新），那样空闲永远归零。 */
  if (!s.sinceAt) s.sinceAt = now;
  let idleH = 0;
  try { idleH = hoursBetween(now, s.sinceAt); } catch (e) { DEG.hit('storyteller.js', e); }
  if (!isFinite(idleH) || idleH < 0) idleH = 0;
  const idlePts = Math.min(PARAMS.IDLE_MAX, (idleH / 24) * PARAMS.W_IDLE);
  s.tension = w + so + th * PARAMS.W_THREAD + idlePts;
  s.setback = setback(data, now);
  s.idleH = Math.round(idleH);
  // 适应度自然衰减（世界会忘掉你曾经很能扛）。注意：衰减要自己的时间戳，
  // 不能借用 lastFireAt —— 那会把冷却一起清掉（写错了会让冷却永远失效）。
  try {
    const from = s.lastDecayAt || s.lastFireAt;
    if (from) {
      const idle2 = hoursBetween(now, from);
      const decay = Math.floor(idle2 / PARAMS.ADAPT_DECAY_H);
      if (decay > 0) { s.adapt = Math.max(0, s.adapt - decay); s.lastDecayAt = now; }
    }
  } catch (e) { DEG.hit('storyteller.js', e); }
  const gate = Number((data.meta || {}).tensionGate) || p.gate;
  /* 适应度越高 → 门槛**越低** → 越容易有事（你过得好，世界就加码 —— RimWorld 的 Adaptation）。
     方向别写反：这里原来是 `gate + adapt * 0.6`（过得好反而更平静），和注释说的正好相反。 */
  const effGate = Math.max(1, gate - s.adapt * 0.6);
  s.effGate = effGate;
  const cool = s.lastFireAt ? hoursBetween(now, s.lastFireAt) : 999;
  const compCool = s.lastCompAt ? hoursBetween(now, s.lastCompAt) : 999;
  const cooldownH = PARAMS.COOLDOWN_H * p.cooldownMul;   // 冷却 = 基准 × 预设倍率（绝对值只有一个来源）
  const canFire = s.tension >= effGate && cool >= cooldownH;
  const canComp = p.compensate && s.setback >= PARAMS.SETBACK_MIN && compCool >= PARAMS.COMP_COOLDOWN_H;
  let why = '';
  if (canFire) why = '你攒下的东西（家底 ' + w.toFixed(1) + ' + 熟人 ' + so.toFixed(0) + ' + 悬着的事 ' + th + ' 条）已经够世界回应一次；距上次 ' + Math.round(cool) + ' 小时';
  else if (canComp) why = '近 ' + PARAMS.SETBACK_H + ' 小时受了 ' + s.setback + ' 次挫，世界该给点甜头';
  else if (s.tension < effGate) why = '张力 ' + s.tension.toFixed(1) + ' < 门槛 ' + effGate.toFixed(1) + '（太安静：已 ' + s.idleH + ' 小时没事）';
  else why = '刚给过（' + Math.round(cool) + ' 小时前），冷却中';
  s.cooldownH = cooldownH;
  return { tension: s.tension, gate: effGate, cooldownH: cooldownH, preset: p.key, adapt: s.adapt, setback: s.setback,
    fire: canFire, compensate: canComp && !canFire, why: why, parts: { wealth: w, social: so, threads: th } };
}

// 放行后记账（必须由调用方在真的放行时调）
function mark(data, kind, now) {
  const s = ensure(data);
  if (kind === 'compensate') { s.lastCompAt = now; s.compensated += 1; }
  else {
    const p = presetOf(data);
    s.lastFireAt = now; s.sinceAt = now; s.fired += 1;
    // 适应度增量也走预设倍率（wild 涨得快：越玩越乱；gentle 涨得慢）
    s.adapt = Math.min(PARAMS.ADAPT_MAX, s.adapt + PARAMS.ADAPT_STEP * p.adaptMul);
  }
}

// ---------- 给主 AI 的那一行（世界节拍） ----------
// 空字符串 = 世界此刻平静 → 提示词里**零字节**（照抄内容模块槽位的做法）
function promptBlock(e) {
  if (!e || (!e.fire && !e.compensate)) return '';
  if (e.compensate) {
    return '【世界节拍 · 补偿】' + e.why + '。这一回合**让一件顺心的事发生**（不是赏赐、不是天降横财，'
      + '是这个世界本来就会有的那种好事：有人替你说话、账结清了、天气放晴、她主动开口）。'
      + '烈度不超过世界上限。**不要告诉玩家这是补偿**。';
  }
  return '【世界节拍 · 该有点事了】' + e.why + '。这一回合把张力**兑现成一件与玩家有关的事**：'
    + '有人来找他 / 他欠的事被催 / 一件悬着的事推进了一步 / 传闻传到了当事人耳朵里。'
    + '**烈度不得超过世界上限**；**不要凭空创造与玩家无关的大事件**（那是刷屏，不是叙事）。'
    + '怎么发生、谁来做、说什么，由你决定。';
}

// ---------- 给诊断用的可读视图（**绝不上玩家界面**） ----------
function view(data) {
  const s = ensure(data);
  const p = presetOf(data);
  return { preset: p.key, presetName: p.name, tension: Math.round(s.tension * 10) / 10, adapt: s.adapt,
    setback: s.setback, fired: s.fired, compensated: s.compensated, lastFireAt: s.lastFireAt || '' };
}

module.exports = { PARAMS: PARAMS, PRESETS: PRESETS, presetOf: presetOf, evalOnce: evalOnce, mark: mark,
  promptBlock: promptBlock, view: view, threads: threads, wealth: wealth, social: social, setback: setback };