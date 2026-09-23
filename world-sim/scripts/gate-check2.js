// gate-check2.js — v1.56 红线：输出侧门控 / 冲突检查（创造循环）/ 插件自报 schema / 相位推进
'use strict';
const GATE = require('../src/gate');
const PHASE = require('../src/phase');
const SP = require('../src/savepack');
const AI = require('../src/ai');
const MF = require('../src/manifest');
const W = require('../src/world');

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (x ? '  << ' + x : '')); } };
const mk = () => {
  const d = JSON.parse(JSON.stringify(W.buildDemoWorld())); d.id = (p) => p + '__g' + Math.random().toString(36).slice(2, 7);
  d.impressions.npc_x = { stage: 1, seen: '背着帆布工具袋', nameKnown: null };
  d.entities.npc_x = { id: 'npc_x', type: 'person', name: '周师傅', profile: { appearance: { 标志物: '背着帆布工具袋' } }, state: { location: d.current.sceneId } };
  return d;
};

// ---------- [1] 输出侧门控（A1） ----------
console.log('\n[1] 输出侧门控：不该出现的名字自动换成可见称呼');
(function () {
  const d = mk();
  const r = GATE.scrubFrame(d, { tag: '杂货铺', beats: [{ type: 'dialogue', speaker: 'npc_1', text: '周师傅刚才来过。', action: '看了周师傅一眼' }, { type: 'narration', text: '沈姨抬头。' }] });
  ok(r.frame.beats[0].text.indexOf('周师傅') < 0 && /工具袋/.test(r.frame.beats[0].text), '★ 真名被打码成「一个背着帆布工具袋的人」', r.frame.beats[0].text);
  ok(r.frame.beats[0].action.indexOf('周师傅') < 0, 'action 字段也过一遍（不是只扫 text）');
  ok(r.frame.beats[1].text.indexOf('沈姨') >= 0, '该知道的名字**不误伤**');
  ok(r.hits.length === 1 && r.hits[0].name === '周师傅', '命中记下来（可追溯：谁被打了码、为什么）');
  ok(GATE.scrubText(d, '沈姨和周师傅在店里。').indexOf('周师傅') < 0, 'scrubText 单测');
})();

// ---------- [1b] 导演笔记门控（v1.58） ----------
console.log('\n[1b] 导演笔记不许进正文（生图关着也一样）');
(function () {
  const d = mk();
  const r = GATE.scrubAll(d, { beats: [
    { type: 'action', text: '（画面笔记：暖黄灯光，浅景深，中景）她低头擦柜台。' },
    { type: 'dialogue', speaker: 'npc_1', text: '（用抹布擦了擦柜台，不抬头）问我？我还能说啥。' },
    { type: 'narration', text: '（生图提示词：rainy night, close-up）雨还在下。' }
  ] });
  ok(r.frame.beats[0].text.indexOf('画面笔记') < 0 && r.frame.beats[0].text.indexOf('她低头擦柜台') >= 0, '★ 导演笔记括号被删掉，正文保住', r.frame.beats[0].text);
  ok(r.frame.beats[2].text.indexOf('close-up') < 0 && r.frame.beats[2].text.indexOf('雨还在下') >= 0, '英文提示词（close-up/prompt）也删', r.frame.beats[2].text);
  ok(r.frame.beats[1].text.indexOf('用抹布擦了擦柜台') >= 0, '★ 正常动作括号不误删（旧写法的小动作是叙事，不是导演笔记）', r.frame.beats[1].text);
  ok(r.hits.some(h => h.name === '导演笔记'), '删掉的东西记账（可追溯）');
  /* v1.92 修正这条断言本身。
     原来它断言的是**字面串**：「/导演笔记不许进正文/.test(sys)」，cfg 里没有 image（= 生图关）也要求命中。
     而那段文案里印着「画面笔记 / 生图提示词 / 镜头机位 / 景深构图 / 打光」——**生图模块自己的词汇**。
     于是它表面在保证「AI 不许写导演笔记」，实际在**保证提示词一直教 AI 这套概念**，
     再由 L4 的 scrubNotes 把 AI 照做写出来的东西擦掉（输入侧教、输出侧擦，一个回合白跑两遍）。
     用户 v1.92 报案「生图模块明明关闭了却还是有图片提示词」，指的就是这一段。
     现在改成断言**意图**而不是字面串：关掉时有「不要写拍摄术语」的规矩，开着时有完整规矩。 */
  const sysOff = AI.SYSTEM(d, { llm: {} }, false);                              // 生图关
  const sysOn = AI.SYSTEM(d, { llm: {}, image: { enabled: true } }, false);     // 生图开
  ok(/拍摄术语|导演笔记/.test(sysOff), '★ 生图关着时，提示词里仍有「不要写拍摄术语」这条规矩');
  ok(/导演笔记不许进正文/.test(sysOn), '★ 生图开着时，提示词里有完整的导演笔记规矩');
  ok(sysOff.indexOf('画面笔记') < 0 && sysOff.indexOf('生图') < 0, '★ 生图关着时，提示词里不出现生图模块自己的词汇（v1.92）');
})();
// ---------- [2] 冲突检查（创造循环第③步） ----------
console.log('\n[2] 冲突检查：四类都能抓');
(function () {
  const d = mk();
  d.entities.npc_dead = { id: 'npc_dead', type: 'person', name: '老周', state: { location: 'pl_1', alive: false } };
  d.entities.npc_far = { id: 'npc_far', type: 'person', name: '阿岩', state: { location: 'pl_4' } };
  d.current.time = '1996-06-14T21:00:00';
  const cs = GATE.conflicts(d, [
    { type: '文档出现', title: '一张赊账纸条' },                    // 撞车（下面先记一条）
    { type: '记忆新增', owner: 'npc_1', t: '1996-06-14T20:00:00', impact: 50 }   // 时间倒退
  ], {
    beats: [
      { type: 'dialogue', speaker: 'npc_dead', text: '我回来了。' },
      { type: 'action', actor: 'npc_far', text: '阿岩推门进来。' },
      { type: 'dialogue', speaker: 'npc_1', text: '周师傅刚才来过。' }        // 门控
    ]
  }, {});
  MF.ensure(d); MF.record(d, { kind: '文档', name: '一张赊账纸条', schema: 'fw.doc.v1', by: 'ai', note: 'x' });
  const cs2 = GATE.conflicts(d, [{ type: '文档出现', title: '一张赊账纸条' }], { beats: [] }, {});
  const kinds = cs.map(c => c.kind);
  ok(kinds.indexOf('生死') >= 0, '生死：已故者开口 → 抓出来');
  ok(kinds.indexOf('位置') >= 0, '位置：不在场的人做在场的事 → 抓出来');
  ok(kinds.indexOf('门控') >= 0, '门控：画面里出现不该知道的名字 → 抓出来（同时会被打码）');
  ok(kinds.indexOf('时间') >= 0, '时间：Update 时间早于当前 → 抓出来');
  ok(cs2.some(c => c.kind === '撞车'), '撞车：同一份文书短期内重复生成 → 抓出来');
  ok(cs.every(c => c.fix), '每条冲突都带**改法**（不是只说"错了"）');
  ok(/冲突回执/.test(GATE.render(cs)) && /只改这几处/.test(GATE.render(cs)), '回执写明"只改这几处，其余不动"');
  const before = JSON.stringify(d);
  GATE.conflicts(d, [], { beats: [] }, {});
  ok(JSON.stringify(d) === before, '★ 冲突检查**只报不改**（改由 AI 修订或修复模式做）');
})();

// ---------- [3] 相位推进（0 token） ----------
console.log('\n[3] 相位推进（人设忠实 §29.3）');
(function () {
  const d = mk();
  const p = { id: 'npc_c', type: 'person', name: '周砚', profile: { condition: { 名: '双相', 相位: ['平稳', '躁期', '郁期'], 周期小时: 72, 起于: '1996-06-14T20:45:00' } }, state: { location: 'pl_1' } };
  d.entities.npc_c = p;
  ok(PHASE.norm(d) === 1 && p.state.phase === '平稳', '初次：按周期推出当前相位（平稳）', p.state.phase);
  d.current.time = '1996-06-17T22:00:00';
  ok(PHASE.norm(d) === 1 && p.state.phase === '躁期', '★ 三天后自动推进到下一相（**代码推，不靠 AI 随机**）', p.state.phase);
  d.current.time = '1996-06-21T00:00:00';
  PHASE.norm(d);
  ok(p.state.phase === '郁期', '再过一个周期 → 郁期', p.state.phase);
  const nx = PHASE.kick(d, 'npc_c', '被提起亡妻');
  ok(nx === '平稳' && p.state.phase === '平稳' && /亡妻/.test(p.state.phaseWhy || ''), '★ 触发（高冲击记忆）→ 相位往前推一格，并记下原因', nx + '/' + p.state.phase);
  ok((d.framework.log || []).some(x => x.what === '相位推进'), '相位变化**留痕**（世界什么时候被推了一下）');
  const noCond = mk();
  ok(PHASE.norm(noCond) === 0, '没有精神状态设定的角色：不动（不硬塞）');
})();

// ---------- [4] 插件自报 schema ----------
console.log('\n[4] 插件自报 schema：认识 ≠ 执行');
(function () {
  const d = mk(); MF.ensure(d);
  MF.record(d, { kind: '怪东西', name: '插件件', schema: 'plugin.zzz.v9', by: 'plugin' });
  const p1 = SP.pack(d, {});
  ok(SP.scan(p1).counts.unknown === 1, '没声明过 → 进 unknown（照旧）');
  d.schemas = { 'plugin.zzz.v9': { plugin: 'zzz', hint: '一个第三方小控件', fields: ['a', 'b'] } };
  const p2 = SP.pack(d, {});
  const r2 = SP.scan(p2);
  ok(r2.counts.unknown === 0 && r2.counts.known >= 1, '★ 世界**声明过** → 扫描算「认识」（不再进 unknown）');
  ok(!!SP.knownOf(d)['plugin.zzz.v9'], 'knownOf 把世界声明的 schema 并进能力表（不改引擎代码）');
  ok(!/require\(|eval\(/.test(String(SP.knownOf)), '★ 登记只是**声明**：引擎不执行插件代码（认识 ≠ 执行）');
})();

console.log('\n==== gate-check2: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
