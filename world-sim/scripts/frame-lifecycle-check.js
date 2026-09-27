'use strict';
/* frame-lifecycle-check.js — 模块的一生：寿命 · 归档（降级不是删） · 沉寂库 · 淘汰规则（v3.17）
   用户 2026-09-27 定：「禁止无限流内容」「还需要有一个模块啊 那就是淘汰规则」
   「需要有善后工作 并且要有头有尾」「1 还会被 ai 看到吗？还是会放进沉寂库？」
   每条断言各自 try/catch：一条炸了不许把整份结论吞掉。 */
const path = require('node:path'), os = require('node:os'), fs = require('node:fs');
const ROOT = path.resolve(__dirname, '..');
process.env.WORLD_SIM_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-life-'));
process.env.WORLD_SIM_ASSETS = ROOT;
const W = require('../src/world');
const CR = require('../src/creator');
const FW = require('../src/framework');
const Q = require('../src/query');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  OK   ' + m)) : (fail++, console.log('  FAIL ' + m)); };
const safe = (m, fn) => { try { fn(); } catch (e) { fail++; console.log('  FAIL ' + m + ' —— 抛异常：' + String((e && e.message) || e).slice(0, 90)); } };
const mk = () => { const d = W.buildDemoWorld(); d.id = (p) => p + '_' + Math.random().toString(36).slice(2, 7); return d; };
console.log('');
console.log('模块的一生：寿命 · 归档 · 沉寂库 · 淘汰规则');
safe('寿命有默认（不许无限流）', () => {
  ok(FW.KEEP_DEFAULT && FW.KEEP_DEFAULT.rows > 0 && FW.KEEP_DEFAULT.days > 0, '★ 内容寿命有默认（' + JSON.stringify(FW.KEEP_DEFAULT) + '）');
  ok(FW.normKeep({ rows: 0 }).rows === FW.KEEP_DEFAULT.rows, 'keep 写坏/缺失 → 补默认（不拒整块）');
  ok(FW.normRetire({ who: '乱写' }).who === FW.RETIRE_DEFAULT.who, 'retire 写坏 → 补默认');
  ok(FW.RETIRE_WHO.length === 3, '淘汰规则三种判定形态都在：' + JSON.stringify(FW.RETIRE_WHO));
});
const dL = mk();
safe('板块记下自己的寿命与出生', () => {
  CR.addPanels(dL, [{ shape: { id: 'feed', name: '屯里风声' }, source: { kind: 'inline' }, when: '回合', keep: { rows: 3, days: 90 }, retire: { who: 'code', check: '超过 90 天没更新' } }], '', 'ai');
  const p0 = (FW.ensure(dL).panels || [])[0] || {};
  ok((p0.keep || {}).rows === 3, '面板记下了自己的寿命（rows=3）');
  ok(!!p0.born, '★ 有头：出生留痕（哪一轮、什么时候、为什么）');
});
safe('超出寿命 → 归档（不是删）+ 折叠成一句', () => {
  CR.addRows(dL, 'feed', [['8-12', 'a'], ['8-12', 'b'], ['8-13', 'c'], ['8-13', 'd']]);
  const dropped = CR.enforceKeep(dL);
  const fL = FW.ensure(dL);
  ok(dropped === 1 && ((fL.panelRows || {}).feed || []).length === 3, '★ 超出寿命的行被挤出去（挤掉 ' + dropped + ' 条，剩 ' + (((fL.panelRows || {}).feed || []).length) + '）');
  ok((fL.archive || []).length === 1, '★ 进沉寂库（归档 ' + ((fL.archive || []).length) + ' 条）—— 降级不是删');
  ok(!!(fL.panelDigest || {}).feed, '★ 折叠成一句留在眼前那一轨：' + JSON.stringify(String((fL.panelDigest || {}).feed || '').slice(0, 24)));
});
safe('沉寂库：AI 主动查得到', () => {
  const av = CR.archiveView(dL, { q: 'a' });
  ok(av.length === 1 && av[0].turn != null, '★ 归档带出处（第几轮/哪个模块）');
  const r = Q.resolve(dL, { what: 'archive', q: 'a' });
  ok((r.items || []).length === 1, '★ query what:archive 查得回来（' + JSON.stringify((r.items || [])[0] || {}).slice(0, 60) + '）');
});
safe('淘汰规则：纯代码 / 纯 AI / 代码+AI', () => {
  const srcC = fs.readFileSync(path.join(ROOT, 'src/creator.js'), 'utf8');
  ok(/retireByCode/.test(srcC), '(一) 纯代码淘汰在（检测时间/条数）');
  ok(/每 1 年游戏时间送审/.test(srcC) || /lastReviewYear/.test(srcC), '(三) 代码+AI 年度送审在');
  ok(/applyReview/.test(srcC), '(二) AI 判过时的回执落库在（keep/retire/note）');
  const d2 = mk();
  CR.addPanels(d2, [{ shape: { id: 'x', name: '过时的东西' }, source: { kind: 'inline' }, when: '回合', keep: { rows: 5, days: 1 }, retire: { who: 'code' } }], '', 'ai');
  const p2 = (FW.ensure(d2).panels || [])[0];
  p2.lastAt = '1990-01-01T00:00:00';
  CR.retireByCode(d2);
  ok(!!p2.retired, '★ 超过寿命没更新 → 退休（' + JSON.stringify((p2.retired || {}).why || '').slice(0, 30) + '）');
  ok((FW.ensure(d2).review || []).length >= 1, '★ 退休后排队等一句**世界内的交代**（有头有尾）');
});
safe('判断权归 AI：代码不再用冷却/预算否决', () => {
  const srcC = fs.readFileSync(path.join(ROOT, 'src/creator.js'), 'utf8');
  ok(!/冷却中（还差/.test(srcC), '★ 代码里不再有冷却这道否决闸');
  ok(/creatorUsedTurn/.test(srcC), '防重入仍在：同一回合最多改一次');
  ok(/frame.creator/.test(srcC) || /want/.test(srcC), '它说 want 就执行（AI 负责想，也负责判断）');
  const jb = CR.judgeBlock(mk());
  ok(/一次性改到位/.test(jb) && /最好不要超过 5 个模块/.test(jb), '★ 软约束（不是闸）：一次性改到位 + 别超过 5 个');
  ok(/该放手/.test(jb) && /该拦自己/.test(jb), '判据也给了（什么时候该动、什么时候该收）');
});
safe('判断指令搭在每回合里（0 额外调用）', () => {
  ok(/生成框架/.test(fs.readFileSync(path.join(ROOT, 'src/ai.js'), 'utf8')), '★ 资料包里有「生成框架」块');
  ok(/生成框架/.test(fs.readFileSync(path.join(ROOT, 'src/contract.js'), 'utf8')), '契约分层登记了它（volatile）');
});
safe('呈现：能力由引擎给，形式由 AI 定（v3.19）', () => {
  const UAJ = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
  const UCS = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
  ok(FW.MOUNTS.length === 4 && FW.LAYOUTS.length === 4 && FW.PANEL_KINDS.indexOf('messages') >= 0,
    '★ 引擎给的「能力」齐了：挂载 ' + JSON.stringify(FW.MOUNTS) + ' · 排法 ' + JSON.stringify(FW.LAYOUTS) + ' · 交互 ' + JSON.stringify(FW.PANEL_KINDS));
  const s0 = FW.normShape({ id: 'x', name: 'X', mount: '乱写', layout: '乱写', style: '铁皮白瓷、手写体' });
  ok(s0.mount === 'panel' && s0.layout === 'list' && s0.style === '铁皮白瓷、手写体', '★ 呈现缺/写坏 → 补默认；**风格（style）原样留着**（那是 AI 按世界写的，引擎不指定）');
  ok(FW.OVERLAY_MAX > 0 && FW.OVERLAY_MAX <= 5, '红线：同时挂着的浮层有上限（' + FW.OVERLAY_MAX + ' 个）');
  const d = mk();
  CR.addPanels(d, [{ shape: { id: 'wx', name: '微信', mount: 'overlay', layout: 'cards', style: '玻璃发光', kind: 'messages' }, source: { kind: 'view', of: 'messages' }, when: '回合' }], '', 'ai');
  const pv = CR.panelView(d);
  ok(pv[0].mount === 'overlay' && pv[0].layout === 'cards' && pv[0].kind === 'messages' && pv[0].style === '玻璃发光', '★ 呈现信息一路带到界面这一层（mount/layout/kind/style）');
  ok(/function mountAIOverlays/.test(UAJ) && /paintPanelRows/.test(UAJ), '★ 界面按 mount 分流（浮层挂在屏幕上，不是全塞进「更多」）');
  ok(/pm\.kind === 'messages'/.test(UAJ) && /submit\(/.test(UAJ), '★ messages 类给回复入口（走引擎既有的回合链路，不用另写收发）');
  ok(/\.tiles \{[^}]*overflow-y:auto/.test(UCS), '★ 「更多」可滚动（原来装不下直接溢出屏幕 —— 真 bug）');
});

console.log('');
console.log('==== frame-lifecycle-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
