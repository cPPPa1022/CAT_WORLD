// repair-check.js — v1.52 红线：**AI 修复（导入存档）**（离线，不联网）
// 用户定的流程：「告诉 ai 这是存档数据 → 让它判断哪里坏了 → 修复（**需验证**）」
// 三条必须守住：① 只出**白名单补丁**（不许删、不许顺手重写）② **先校验后应用** ③ **修完再扫一遍，用数字说话**
'use strict';
const REP = require('../src/repair');
const SP = require('../src/savepack');
const FW = require('../src/framework');
const MF = require('../src/manifest');
const W = require('../src/world');

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (x ? '  << ' + x : '')); } };
const mk = () => { const d = JSON.parse(JSON.stringify(W.buildDemoWorld())); d.id = (p) => p + '__r' + Math.random().toString(36).slice(2, 7); return d; };
// 一个"被玩坏/别处来的"存档：陌生律形式、未知原语、插件清单项、缺说明
const broken = () => {
  const d = mk(); FW.ensure(d, 3); MF.ensure(d);
  FW.learnFxName(d, '剑光出鞘', [{ k: 'flash' }, { k: '未来原语' }]);
  FW.learnFxName(d, '符箓燃起', [{ k: '未来原语2' }]);
  FW.learnRule(d, { name: '灵根', form: 'enum', items: ['金', '木'] });
  d.framework.rules.push({ name: '等级', form: 'custom', items: ['1', '9'], frozen: false });   // 陌生形式（两个数 → 可机械修）
  MF.record(d, { kind: '文档', name: '一封帖子', schema: 'fw.doc.v1', by: 'ai' });               // 缺说明
  MF.record(d, { kind: '怪东西', name: '插件件', schema: 'plugin.zzz.v9', by: 'plugin' });
  return d;
};

// ---------- [1] 引擎自动修（0 token）----------
console.log('\n[1] 引擎能机械修的，先修掉');
(function () {
  const d = broken();
  const au = REP.autoFix(d);
  ok(au.fixed.some(s => /演出名「剑光出鞘」/.test(s)), '未知原语：丢掉画不出来的、保留能画的', JSON.stringify(au.fixed));
  ok(d.framework.vocab.fxNames['剑光出鞘'].atoms.length === 1, '改完之后只剩合法原子');
  ok(au.fixed.some(s => /律「等级」/.test(s)) && d.framework.rules.find(x => x.name === '等级').form === 'range', '陌生律形式 + 两个数 → 机械修成 range', JSON.stringify(d.framework.rules.find(x => x.name === '等级')));
  ok(au.left.some(s => /符箓燃起/.test(s)), '★ 全是不认识的原语 → **不猜**，留给 AI/人', JSON.stringify(au.left));
})();

// ---------- [2] 补丁：只有白名单，先校验后应用 ----------
console.log('\n[2] AI 补丁：白名单 + 先校验后应用');
(function () {
  const d = broken();
  REP.autoFix(d);
  const ap = REP.applyPatch(d, [
    { op: 'fx_remap', name: '符箓燃起', atoms: [{ k: 'tint' }, { k: '本机也没有' }], why: '改配到色脉' },
    { op: 'rule_form', name: '灵根', form: 'enum', items: ['金', '木', '水', '火'] },
    { op: 'note_fill', id: '一封帖子', note: '锦儿送来的邀帖' },
    { op: 'box', what: '怪东西:插件件', why: '看不懂的插件产物' },
    { op: 'drop', what: '随便删点东西' },
    { op: 'rule_form', name: '不存在的律', form: 'enum', items: ['x'] }
  ]);
  ok(ap.applied.length === 4, '四条合法补丁被应用', JSON.stringify(ap.applied));
  ok(ap.rejected.length === 2 && ap.rejected.some(s => /白名单/.test(s)), '★ 白名单外的 op（drop）被拒 —— **AI 不许删数据**', JSON.stringify(ap.rejected));
  ok(d.framework.vocab.fxNames['符箓燃起'].atoms.length === 1 && d.framework.vocab.fxNames['符箓燃起'].atoms[0].k === 'tint', '改配时**只认本机认识的原语**（乱给的那个被丢掉）');
  ok(MF.ensure(d).items.find(x => x.name === '一封帖子').note === '锦儿送来的邀帖', '补说明生效');
  ok((d.unknown || []).some(x => x.what === '怪东西:插件件'), 'box 生效（进箱子，而不是删掉）');
  ok(!REP.OPS.some(o => /drop|delete|remove/i.test(o)), '★ 白名单里**根本没有"删"这个 op**（设计上就不给这条路）');
})();

// ---------- [3] 需验证：修完再扫一遍 ----------
console.log('\n[3] 需验证（数字说话）');
(function () {
  const d = broken();
  const before = REP.verify(d);
  const au = REP.autoFix(d);
  const ap = REP.applyPatch(d, [
    { op: 'fx_remap', name: '符箓燃起', atoms: [{ k: 'ripple' }] },
    { op: 'box', what: '怪东西:插件件', why: '插件产物' },
    { op: 'note_fill', id: '一封帖子', note: '邀帖' }
  ]);
  const after = REP.verify(d);
  ok(before.unknownN > after.unknownN, '★ 修完"不认识"的数量**下降**（' + before.unknownN + ' → ' + after.unknownN + '）');
  ok(au.fixed.length + ap.applied.length > 0 && after.ok, '修完仍然是**合法可导入**的存档（不是修坏了）');
  ok(after.needsAI <= before.needsAI, '待 AI 判断的事项没有变多');
})();

// ---------- [4] 破甲：修复调用也要带 ----------
console.log('\n[4] 破甲模块（§18 部署层）');
(function () {
  const sys = REP.systemRepair();
  ok(/叙事主权|虚构授权环境/.test(sys), '带上叙事主权宪章（破甲 = 岗位/人格设定的一部分）');
  ok(/不评价、不说教、不净化/.test(sys), '★ 明说：存档里的 NSFW/黑暗内容是**数据**，照数据对待');
  ok(/不在演故事/.test(sys) && /存档修复员/.test(sys), '岗位说明书：这是**修数据**，不是演故事');
  ok(REP.OPS.every(o => sys.indexOf(o) >= 0), '把补丁白名单原样写进提示词（AI 才知道能开什么药）');
  const d = broken();
  const dg = REP.digest(d, REP.verify(d).report);
  ok(/【这是存档数据】/.test(dg) && /生成清单/.test(dg) && /unknown 箱/.test(dg), '给 AI 的摘要里有"这是存档" + 清单 + 未知箱');
  ok(dg.length < 6000, '摘要有上限（4 千多字，不是整个世界塞进去）', String(dg.length));
})();

// ---------- [5] 没接模型也不能断链 ----------
console.log('\n[5] 离线也要能跑通链路');
(async function () {
  const d = broken();
  const r = await REP.aiSuggest(d, { llm: { baseURL: '', apiKey: '', model: '' } }, REP.verify(d).report);
  ok(r.mode === 'offline', '未配模型 → mode=offline（引擎机械修 + 留下待判断清单）');
  ok(Array.isArray(r.patch), '即使离线也返回**结构完整**的补丁数组（前端不用分支）');
})();

setTimeout(() => {
  console.log('\n==== repair-check: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exitCode = fail ? 1 : 0;
}, 200);
