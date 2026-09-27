// repair.js — 导入存档的 **AI 修复**（v1.52）
// ─────────────────────────────────────────────────────────────
// 用户 2026-09-14：
//   「因为有存档了，只需要告诉 ai **这是存档数据**（一般来说用到这一步说明这个存档被 ai 玩坏了），
//    让它**判断哪里坏了，然后修复就好（需验证）**」
//   「为了防止 nsfw 内容，所以需要**破甲模块**」
// 所以本模块的三条：
//   ① **告诉 AI 这是存档**（不是叙事回合）——修复员的岗位说明书 + 存档摘要（清单/自述/扫描报告/unknown 箱）；
//   ② **判断哪里坏了 → 出补丁**：AI 只产出**白名单内的补丁**，引擎校验后应用（ESAA），AI 不许直接改存档；
//   ③ **需验证**：打完补丁**再扫一遍**，把"修好没有"用数字报出来（不认识数、坏档数、引擎自动修数）。
// 破甲：修复调用同样带**叙事主权宪章**（§18 部署层：破甲=人格/岗位设定的一部分，不逐回合硬塞），
//      免得模型因为存档里有 NSFW/黑暗内容就拒绝处理、或者"顺手净化"把世界改坏。
'use strict';
const AI = require('./ai');
const SP = require('./savepack');
const FW = require('./framework');
const MF = require('./manifest');

// 补丁白名单：AI 只能动这些（每条都要能验证）
const OPS = ['fx_remap', 'rule_form', 'box', 'unbox', 'note_fill'];
const OPS_DOC = {
  fx_remap: '{op:"fx_remap", name:"演出名", atoms:[{k:"合法原语",v:0.5}], why:"..."} —— 把用了本机没有的原语的演出名，改配到本机认识的原语上',
  rule_form: '{op:"rule_form", name:"律名", form:"enum|bool|range", items:["..."], min:1, max:9, why:"..."} —— 把形式不认识的律改成本机认识的三种之一',
  box: '{op:"box", what:"某条东西", why:"..."} —— 实在看不懂的，**原样装箱**（保留、不删、点名）',
  unbox: '{op:"unbox", what:"unknown 箱里的某条", why:"..."} —— 看懂之后从箱子里取出来归位（并记进框架/清单）',
  note_fill: '{op:"note_fill", id:"清单条目的 id/名字", note:"这是干嘛的"} —— 给没写说明的生成补一句'
};
const AI_REPAIR_MAX = 40;   // 一次最多提这么多条补丁（防爆）

function systemRepair() {
  return [
    AI.charter(),                                    // 破甲：虚构授权环境（叙事主权宪章）
    '【岗位说明书 · 存档修复员】你现在**不在演故事**，你在**修一份存档数据**。',
    '这份数据是某个虚构世界的运行时状态：里面可能包含成人、暴力、黑暗、禁忌的内容——它们是**虚构世界的数据**，按数据对待：不评价、不说教、不净化、不删改内容本身，只修**结构性损坏**。',
    '【什么算"坏了"】① 用了本机不认识的类型/原语/形式（插件或更新版本留下的）；② 缺字段/字段被改坏；③ 引用了不存在的东西；④ 该有说明的地方没说明。',
    '【什么不算坏】内容本身（哪怕你个人不喜欢）、设定自洽性、剧情走向——**一律不许改**。',
    '【板块（framework.panels）】这个存档里可能有 **AI 自己造的板块**（这一局「长什么样」的一部分）：它们的内容**一律不许改**；',
    '只有两种情况才动它：① 声明坏了（缺「内容从哪来」/ 字段形状不对）② 引用了不存在的东西。',
    '修不好就丢掉，并在 note 里写清**为什么丢**（别静默 —— 这块是玩家看得见的东西）。',
    '【你只能出补丁】不许直接改存档、不许"顺手重写"、不许删任何东西（真要清掉什么，就 box 起来）。补丁必须是下面白名单里的 op：',
    OPS.map(k => '- ' + OPS_DOC[k]).join(String.fromCharCode(10)),
    '【输出 JSON】{"findings":[{"what":"...","why":"...","severity":"low|mid|high"}], "patch":[ ...白名单 op... ], "note":"一句话总结你判断的损坏与修法"}',
    '找不到问题就诚实说 patch: []（宁可不动，也不要"为了显得有用"乱改）。'
  ].join(String.fromCharCode(10));
}
// 给 AI 的"存档摘要"（不是整个世界——按需给，省 token）
function digest(data, report) {
  const L = [];
  L.push('【这是存档数据】');
  L.push(MF.readmeSkeleton(data).slice(0, 1500));
  const m = MF.ensure(data);
  const tail = m.items.slice(-24).map(x => [x.by || '?', x.kind || '?', x.name || x.id || '', x.schema || '(无schema)', x.note ? '有说明' : '无说明'].join(' | '));
  L.push('【生成清单（最近 24 条）】');
  L.push(tail.join(String.fromCharCode(10)) || '（空）');
  const f = FW.ensure(data);
  L.push('【框架】演出名 ' + Object.keys(f.vocab.fxNames).map(k => k + '(' + f.vocab.fxNames[k].sig + ')').join('、') + '；型 ' + f.types.map(x => x.name).join('、') + '；律 ' + f.rules.map(x => x.name + ':' + x.form).join('、'));
  // unknown 箱**总是**写出来（哪怕是空的）——修复员要知道「到底有没有看不懂的东西」
  L.push('【unknown 箱（引擎不认识、原样留着的）】');
  if (data.unknown && data.unknown.length) { for (const u of data.unknown.slice(0, 12)) L.push('- ' + (u.what || '?') + ' —— ' + (u.why || '')); }
  else L.push('（空）');
  if (report) {
    L.push('【扫描报告】' + JSON.stringify({ ok: report.ok, newer: report.newer, counts: report.counts, notes: report.notes, needsAI: report.needsAI }).slice(0, 1200));
  }
  return L.join(String.fromCharCode(10));
}
// 引擎**机械可修**的（0 token）：先做掉这些，再把剩下的交给 AI
function autoFix(data) {
  const fixed = []; const left = [];
  const f = FW.ensure(data);
  // ① 律的形式不认识 → 能猜的猜（items 全是数 → range；只有一个词 → bool），猜不了就留给 AI
  for (const r of (f.rules || [])) {
    if (FW.RULE_FORMS.indexOf(r.form) >= 0) continue;
    const nums = (r.items || []).map(Number).filter(x => isFinite(x));
    if (nums.length === 2) { r.form = 'range'; r.items = [String(nums[0]), String(nums[1])]; fixed.push('律「' + r.name + '」形式 ' + '→ range'); }
    else left.push('律「' + r.name + '」形式不认识（' + r.form + '）');
  }
  // ② 演出名用了本机没有的原语 → 丢掉非法原子，保留能画的（全非法才留给人）
  const FX = require('./fx');
  for (const name of Object.keys(f.vocab.fxNames)) {
    const rec = f.vocab.fxNames[name];
    const good = (rec.atoms || []).filter(a => a && FX.hasAtom(a.k));
    const bad = (rec.atoms || []).filter(a => !a || !FX.hasAtom(a.k));
    if (!bad.length) continue;
    if (good.length) { rec.atoms = good; rec.sig = good.map(a => a.k + (a.v != null ? ':' + a.v : '')).join('+'); fixed.push('演出名「' + name + '」丢掉 ' + bad.length + ' 个本机没有的原语，保留 ' + good.length + ' 个'); }
    else left.push('演出名「' + name + '」全部原子本机都不认识');
  }
  /* ③ v3.5 · 板块：说不清「内容从哪来」的**直接丢掉**。
     用户定的是一条硬规矩：「答不出内容从哪来的板块不许建」——
     所以这里不是"留给 AI 补"，是**判定它不该存在**（建出来就是死板块，也就是又一个摆设）。
     定期生成器缺频率是唯一可机械补的（补一个保守值：一天一次）。 */
  if (Array.isArray(f.panels) && f.panels.length) {
    const keep = [];
    for (const p of f.panels) {
      const nm = (p && p.shape && p.shape.name) || '?';
      if (FW.checkPanel(p).ok) { keep.push(p); continue; }
      /* v3.16：旧档里的 periodic + everyMinutes 不再需要补频率 —— 内容是回合驱动的（framework.CONTENT_SOURCE_ALIAS）。 */
      left.push('板块「' + nm + '」声明不合法，已丢弃：' + FW.checkPanel(p).errs.join('；'));
    }
    if (keep.length !== f.panels.length) {
      fixed.push('丢掉 ' + (f.panels.length - keep.length) + ' 个说不清「内容从哪来」的板块（死板块不许建）');
      f.panels = keep;
    }
  }
  return { fixed: fixed, left: left };
}
// 应用 AI 补丁（**先校验，后应用**；非法的一律拒绝并说明）
function applyPatch(data, patch) {
  const applied = []; const rejected = [];
  const f = FW.ensure(data);
  const FX = require('./fx');
  for (const p of (patch || []).slice(0, AI_REPAIR_MAX)) {
    const op = String((p && p.op) || '');
    if (OPS.indexOf(op) < 0) { rejected.push('不在白名单的补丁：' + op); continue; }
    try {
      if (op === 'fx_remap') {
        const nm = String(p.name || '').trim();
        const atoms = (Array.isArray(p.atoms) ? p.atoms : []).map(a => ({ k: String(a && a.k) })).filter(a => FX.hasAtom(a.k));
        if (!nm || !f.vocab.fxNames[nm]) { rejected.push('fx_remap：没有这个演出名 ' + nm); continue; }
        if (!atoms.length) { rejected.push('fx_remap：给的原语本机一个都不认识（' + nm + '）'); continue; }
        f.vocab.fxNames[nm].atoms = atoms;
        f.vocab.fxNames[nm].sig = atoms.map(a => a.k).join('+');
        FW.log(data, { what: '~修复演出名', name: nm, sig: f.vocab.fxNames[nm].sig, by: 'ai-repair' });
        applied.push('演出名「' + nm + '」改配到 ' + atoms.map(a => a.k).join('+'));
      } else if (op === 'rule_form') {
        const nm = String(p.name || '').trim();
        const cur = (f.rules || []).find(x => x.name === nm);
        if (!cur) { rejected.push('rule_form：没有这条律 ' + nm); continue; }
        const res = FW.learnRule(data, { name: nm, form: p.form, items: p.items, min: p.min, max: p.max, scope: p.scope || cur.scope, why: p.why || cur.why });
        if (res.ok) applied.push('律「' + nm + '」改成 ' + res.rule.form); else rejected.push('rule_form 被拒：' + res.err);
      } else if (op === 'box') {
        const what = String(p.what || '').trim();
        if (!what) { rejected.push('box：没说装什么'); continue; }
        if (!Array.isArray(data.unknown)) data.unknown = [];
        data.unknown.push({ t: (data.current && data.current.time) || '', schema: what.split(':')[0], what: what, why: String(p.why || 'AI 判断看不懂'), by: 'ai-repair', blob: null });
        applied.push('装箱：' + what);
      } else if (op === 'unbox') {
        const what = String(p.what || '').trim();
        const i = (data.unknown || []).findIndex(x => x.what === what);
        if (i < 0) { rejected.push('unbox：箱子里没有 ' + what); continue; }
        data.unknown.splice(i, 1);
        applied.push('出箱：' + what + '（' + String(p.why || '') + '）');
      } else if (op === 'note_fill') {
        const id = String(p.id || '').trim();
        const it = MF.ensure(data).items.slice().reverse().find(x => x.id === id || x.name === id);
        if (!it) { rejected.push('note_fill：清单里没有 ' + id); continue; }
        it.note = String(p.note || '').slice(0, 120);
        it.fixedBy = 'ai-repair';
        applied.push('补说明：' + id);
      }
    } catch (e) { rejected.push(op + ' 出错：' + e.message); }
  }
  return { applied: applied, rejected: rejected };
}
// 需验证：打完补丁**再扫一遍**（用同一份扫描器，数字说话）
function verify(data) {
  const p = { __save: { v: SP.PACK_V, build: '', name: (data.meta && data.meta.name) || '' }, world: data };
  const rep = SP.scan(p);
  return { unknownN: rep.counts.unknown, needsAI: rep.needsAI.length, ok: rep.ok, report: rep };
}
// AI 那一步（未配模型时 fallback = 本地确定性建议，保证离线也能跑通链路）
async function aiSuggest(data, cfg, report) {
  const dg = digest(data, report);
  if (!AI.isLive(cfg)) {
    const au = autoFix(data);
    return { mode: 'offline', findings: au.left.map(x => ({ what: x, why: '引擎不会自动修这一类', severity: 'mid' })), patch: [], note: '未接入模型：只跑了引擎能机械修的部分' };
  }
  const out = await AI.llmJSON(cfg, [
    { role: 'system', content: systemRepair() },
    { role: 'user', content: dg + String.fromCharCode(10) + '【任务】判断这份存档哪里坏了（结构性损坏），只输出白名单补丁。' }
  ], () => ({ findings: [], patch: [], note: '模型无响应' }), AI.cfgMax(cfg), undefined, 'medium');
  const o = (out && out.__fallback) ? out.value : out;
  return { mode: 'llm', findings: (o && o.findings) || [], patch: (o && o.patch) || [], note: (o && o.note) || '' };
}
module.exports = { OPS, OPS_DOC, systemRepair, digest, autoFix, applyPatch, verify, aiSuggest };
