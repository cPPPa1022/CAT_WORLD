// fx.js — 演出：**引擎原语 + 参数**（v1.47）
// ─────────────────────────────────────────────────────────────
// 设计原则（用户 2026-09-14）：
//   「我们能够覆盖的仅仅只有部分，不可能完全弄完——如果这是一个架空世界呢？软件 AI 知道逻辑，你知道吗？
//     我们要做的是**给出 AI 允许的权限边界**。」
// 所以：
//   · 这里列的是**引擎能力清单**（"我能画什么"）——CSS 总得有人写，这部分枚举是必要的；
//   · **不是**世界内容清单（"世界里有什么纸、什么信、什么术法"）——那是 AI 的事，它才知道那个世界的逻辑。
//   · AI 可以给演出起**世界内的名字**（"信纸展开"/"剑光出鞘"/"符箓燃起"，自由文本），
//     但必须落在下面这些原语上；参数可调，超范围由引擎钳制。
// 边界（校验器 = 限制区执行者）：原语白名单、每回合预算、同效果冷却、一回合≤1 条、演出不替代叙事。
'use strict';

// 原语 = 引擎真的会画的东西。params: [最小, 最大, 默认]
const ATOMS = {
  unfold: { name: '展开',  params: { dur: [0.4, 4, 1.8], v: [0, 1, 1] },        desc: '一件东西从折叠/闭合到摊开（信、卷轴、折页）' },
  turn:   { name: '翻页',  params: { dur: [0.3, 3, 1.1], v: [0, 1, 1] },        desc: '翻页 / 掀开' },
  seal:   { name: '印现',  params: { dur: [0.4, 4, 1.6], v: [0, 1, 1] },        desc: '印记、落款、符印浮现' },
  pulse:  { name: '震动',  params: { dur: [0.2, 2, 0.6], v: [0, 1, 1] },        desc: '载体或画面轻震（信匣/大哥大/手机/传音符）' },
  flash:  { name: '闪光',  params: { dur: [0.1, 2, 0.5], v: [0, 0.7, 0.35] },   desc: '一闪（雷、兵刃、爆）' },
  dim:    { name: '压暗',  params: { dur: [0.4, 6, 1.6], v: [0, 0.8, 0.25] },   desc: '画面暗下去（天暗、灯灭、走进阴影）' },
  push:   { name: '推近',  params: { dur: [0.4, 4, 1.2], v: [0, 0.5, 0.15] },   desc: '视线被拉近（**不改变画的内容**，只是分量）' },
  ripple: { name: '涟漪',  params: { dur: [0.4, 4, 1.4], v: [0, 1, 0.6] },      desc: '一圈一圈荡开（水、回声、灵气）' },
  tint:   { name: '色脉',  params: { dur: [0.4, 5, 1.5], v: [0, 1, 0.5], hue: [0, 360, null] }, desc: '一层颜色脉动；hue 不给就用世界的强调色' },
  wx:     { name: '天象',  params: { dur: [1, 8, 5], v: [0, 1, 1], w: ['rain-heavy', 'storm', 'fog', 'snow', 'sun', 'overcast'] }, desc: '天气级表现（复用天气效果器）' }
};
const ATOM_KEYS = Object.keys(ATOMS);
const BUDGET = 3;          // 一回合最多几个原语（多了就是"每回合都在闪"）
const MAX_PER_TURN = 1;    // 一回合最多 1 条演出
const COOLDOWN_MIN = 6;    // 同组合冷却（世界分钟）

// 旧词表（v1.46）→ 原语组合。兼容老存档/老提示词，也让"点名制"平滑升级成"配菜制"。
const LEGACY = {
  letterOpen:  [{ k: 'unfold' }],
  pageTurn:    [{ k: 'turn' }],
  sealGlow:    [{ k: 'seal' }],
  devicePulse: [{ k: 'pulse' }],
  rainHeavy:   [{ k: 'wx', w: 'rain-heavy' }],
  lightning:   [{ k: 'wx', w: 'storm' }]
};
const LEGACY_NAMES = Object.keys(LEGACY);

function atomInfo(k) { return ATOMS[String(k || '')] || null; }
function hasAtom(k) { return !!atomInfo(k); }
function sig(atoms) { return (atoms || []).map(a => String(a && a.k)).sort().join('+'); }

// 参数钳制：超范围不是"违规"，是物理限制 → 夹取（不拦），保证画得出来
function clampAtoms(atoms) {
  const out = [];
  for (const a of (atoms || [])) {
    const info = atomInfo(a && a.k);
    if (!info) continue;
    const one = { k: String(a.k) };
    for (const [p, range] of Object.entries(info.params)) {
      if (p === 'w') { one.w = range.indexOf(a.w) >= 0 ? a.w : range[0]; continue; }
      const lo = range[0], hi = range[1], dv = range[2];
      const raw = (a[p] === undefined || a[p] === null) ? dv : Number(a[p]);
      if (raw === null || !isFinite(raw)) { one[p] = dv; continue; }
      one[p] = Math.max(lo, Math.min(hi, raw));
    }
    out.push(one);
  }
  return out;
}

// 校验一条"演出"提案。seen = 本回合已放行的演出数
function check(data, u, seen) {
  const raw = (u && Array.isArray(u.atoms)) ? u.atoms : null;
  const legacy = raw ? null : LEGACY[String((u && (u.fx || u.name)) || '')];
  const atomsIn = raw || legacy;
  if (!atomsIn || !atomsIn.length) {
    return { ok: false, err: '演出必须给 atoms（原语数组），可用：' + ATOM_KEYS.join('/') + '；或旧词表名 ' + LEGACY_NAMES.join('/') };
  }
  const bad = atomsIn.map(a => String((a && a.k) || '')).filter(k => !hasAtom(k));
  if (bad.length) return { ok: false, err: '原语不在能力清单里: ' + bad.join('/') + '（可用：' + ATOM_KEYS.join('/') + '）' };
  if (atomsIn.length > BUDGET) return { ok: false, err: '一回合最多 ' + BUDGET + ' 个原语（收到 ' + atomsIn.length + ' 个）——多了就不叫重点了' };
  if ((seen || 0) >= MAX_PER_TURN) return { ok: false, err: '一回合最多 1 条演出' };
  const atoms = clampAtoms(atomsIn);
  const key = sig(atoms);
  const cur = (data && data.current) || {};
  const at = ((cur.fxAt || {})[key]) || null;
  if (at && cur.time) {
    const dm = Math.abs(new Date(cur.time).getTime() - new Date(at).getTime()) / 60000;
    if (dm < COOLDOWN_MIN) return { ok: false, err: '同样的演出冷却中（还有 ' + Math.round(COOLDOWN_MIN - dm) + ' 世界分钟）：' + key };
  }
  const name = String((u && u.fx) || '').trim().slice(0, 16) || atoms.map(a => atomInfo(a.k).name).join('·');
  return { ok: true, atoms: atoms, key: key, name: name };
}

// 代码点名（玩家动作触发，不经 AI）：同样只给原语
function specOf(atomList, name, why) {
  const atoms = clampAtoms(atomList);
  return { atoms: atoms, key: sig(atoms), name: String(name || '').slice(0, 16), why: String(why || '').slice(0, 80) };
}

function list() { return ATOM_KEYS.map(k => ({ k: k, name: ATOMS[k].name, desc: ATOMS[k].desc })); }
// 给提示词的清单：只讲"引擎能画什么"，不讲"世界里有什么"
function promptList() { return ATOM_KEYS.map(k => k + '(' + ATOMS[k].name + '：' + ATOMS[k].desc + ')').join('、'); }

module.exports = { ATOMS, ATOM_KEYS, BUDGET, MAX_PER_TURN, COOLDOWN_MIN, LEGACY, LEGACY_NAMES, hasAtom, atomInfo, clampAtoms, sig, check, specOf, list, promptList };
