// anchor-check.js — 「有主」系统的断言（v2.10）
// 用法：node scripts/anchor-check.js
//
// 一条不变量：**玩家能看见的每一样东西，都必须有主。**
//   —— 凡是"凭空出现在玩家世界里的东西"，都必须能沿 causeRef 走回一个**已经存在**的因。
//
// 为什么单独一个脚本：这条不变量跨"校验器 / 资料包 / 提示词"三处（给规矩必须同时给工具），
// 而原来的 cause 只是"非空字符串"——AI 写一句「剧情需要」就能过，director.js 的默认值
// **就是**那句。实测后果：一个"恰好路过的侦察兵/恰好知道情报的线人"可以凭空落地。
'use strict';
const RT = require('../src/runtime');
const W = require('../src/world');
const fs = require('node:fs');
const path = require('node:path');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
/* 注意：JSON 往返会把 data.id 这个**函数**剥掉（framework-check 的 mk 里专门补了回来）。
   不补的话，任何走 ledgerPush 的路径都会以 "data.id is not a function" 静默失败 —— 我第一版就栽在这。 */
const mk = () => { const d = JSON.parse(JSON.stringify(W.buildDemoWorld())); d.id = (p) => p + '_a' + Math.random().toString(36).slice(2, 7); d.current.turnN = 1; return d; };
/* ★ v3.3：把名字从**玩家自己的认知**里挖掉 —— gate.nameOf 现在会拿
   "经历/记忆里出现过这个名字"当已知证据（gate.js · adoptSelfNames）。
   只 delete 印象档已经造不出"玩家从没见过的人"了（演示世界的玩家经历里就点着沈姨的名）。 */
const stripSelfName = (d, npc) => {
  const cut = (s) => String(s == null ? '' : s).split(npc.name).join('某个人');
  const walk = (o, dep) => {
    if (o == null || dep > 3 || typeof o !== 'object') return;
    for (const k of Object.keys(o)) { if (typeof o[k] === 'string') o[k] = cut(o[k]); else walk(o[k], dep + 1); }
  };
  walk((d.entities.player || {}).profile, 0);
  for (const m of Object.values(d.memories || {})) if (m && m.owner === 'player' && m.content) m.content = cut(m.content);
  d._selfNameSig = null;
};
const spawn = (extra) => Object.assign({
  type: '人物出现', target: 'npc_新面孔', relation: '陌生人',
  spawn: { name: '一个穿军装的年轻人', appearance: '靴子磨破了' },
  cause: '镇口来了个生面孔'
}, extra || {});

console.log('');
console.log('[1] 没有锚 -> 拒（人话 cause 不算数）');
{
  const v = RT.validateUpdates(mk(), [spawn()], {}, {});
  ok(v.allowed.length === 0, '★ 只给 cause 人话、不给 causeRef -> 拒');
  ok(/挂在已有的因上/.test(v.errors.join('|')), '拒绝理由说清了"要挂在已有的因上"：' + String(v.errors[0] || '').slice(0, 40));
}

console.log('');
console.log('[2] 锚指向不存在的东西 -> 拒');
{
  const v = RT.validateUpdates(mk(), [spawn({ causeRef: { kind: 'ledger', id: '根本不存在的条目' } })], {}, {});
  ok(v.allowed.length === 0, '★ 锚解析不到 -> 拒');
}

console.log('');
console.log('[3] 三种锚都认（全部纯查表，0 token）');
{
  const d1 = mk();
  d1.ledger.push({ id: 'led_off_1', t: d1.current.time, type: '镜头外事件', target: '镇子', desc: '北边下来的人越来越多' });
  const v1 = RT.validateUpdates(d1, [spawn({ cause: '北边下来的人越来越多，镇口多了个生面孔', causeRef: { kind: 'ledger', id: 'led_off_1' } })], {}, {});
  ok(v1.allowed.length === 1, '★ 锚 = 一条已有的「镜头外事件」-> 过（**玩家可能从没见过它**，这是伏笔）');

  const d2 = mk();
  const someone = Object.keys(d2.entities).find(k => k !== 'player');
  const nm = d2.entities[someone].name;
  const v2 = RT.validateUpdates(d2, [spawn({ cause: nm + '带来的生面孔', causeRef: { kind: 'entity', id: someone } })], {}, {});
  ok(v2.allowed.length === 1, '★ 锚 = 一个已有实体 -> 过（"' + nm + '带来的"）');

  const d3 = mk();
  d3.beyond = [{ id: 'by_war', what: '北方战事，败局已定', visible: 'secret' }];
  const v3 = RT.validateUpdates(d3, [spawn({ cause: '北方战事打输了，有人一路往南走', causeRef: { kind: 'beyond', id: 'by_war' } })], {}, {});
  ok(v3.allowed.length === 1, '★ 锚 = 世界上游事实 -> 过（更远的因，玩家永远够不到）');
}

console.log('');
console.log('[3.5] ★ 锚存在、但"说不到一块去" -> 拒（v2.10.1 补的洞）');
{
  /* 自评时发现的洞：只验"锚存在"，AI 就能**乱指一条无关的账本条目** ——
     从"编一个字符串"变成"乱指一个 id"。下面两条就是那道新门。 */
  const d = mk();
  d.ledger.push({ id: 'led_off_9', t: d.current.time, type: '镜头外事件', target: '镇子', desc: '沈姨的账本上记过你半个多月' });
  const v = RT.validateUpdates(d, [spawn({ cause: '北边打仗，来了个逃兵', causeRef: { kind: 'ledger', id: 'led_off_9' } })], {}, {});
  ok(v.allowed.length === 0, '★ 锚存在、但 cause 和它说不到一块 -> 拒（拦"乱指"）');
  ok(/说不到一块去/.test(v.errors.join('|')), '拒绝理由点明了是"说不到一块去"');

  const d2 = mk();
  const someone = Object.keys(d2.entities).find(k => k !== 'player');
  const v2 = RT.validateUpdates(d2, [spawn({ cause: '一个陌生人自己走来的', causeRef: { kind: 'entity', id: someone } })], {}, {});
  ok(v2.allowed.length === 0, '★ 锚是实体、但 cause 里没提那个人的名字 -> 拒');
}

console.log('');
console.log('[4] 另外两条硬要求没被放松');
{
  const d = mk();
  d.ledger.push({ id: 'x1', t: d.current.time, type: '镜头外事件', target: '镇子', desc: '镇口来了个生面孔' });
  const v = RT.validateUpdates(d, [spawn({ causeRef: { kind: 'ledger', id: 'x1' }, relation: '' })], {}, {});
  ok(v.allowed.length === 0 && /relation/.test(v.errors.join('|')), 'relation 仍然是硬要求');
  const v2 = RT.validateUpdates(d, [spawn({ causeRef: { kind: 'ledger', id: 'x1' }, spawn: {} })], {}, {});
  ok(v2.allowed.length === 0 && /spawn\.name/.test(v2.errors.join('|')), 'spawn.name 仍然是硬要求');
}

console.log('');
console.log('[5] 给规矩必须同时给工具（资料包里要有可引用的 id）');
{
  const aiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'ai.js'), 'utf8');
  ok(/镜头外近况\(你不在场时发生的\)'[\s\S]{0,220}l\.id/.test(aiSrc),
    '★ 资料包的「镜头外近况」带上条目 **id**（否则 AI 看得见那些事、却拿不到可引用的东西）');
  ok(/causeRef/.test(aiSrc), '★ 提示词里写了 causeRef 的用法');
}

console.log('');
console.log('[6] ★ 上游用尽即拒（宽度也要有上限）');
{
  /* 没有上限的话，一个「北方战事」能造出无限个逃兵 —— 那比"空降一个"还假。 */
  const d = mk();
  d.beyond = [{ id: 'by_war2', what: '北方战事打输了', visible: 'secret', spawned: 2, cap: 2 }];
  const v = RT.validateUpdates(d, [spawn({ cause: '北方战事打输了，有人往南逃', causeRef: { kind: 'beyond', id: 'by_war2' } })], {}, {});
  ok(v.allowed.length === 0 && /已经用尽/.test(v.errors.join('|')), '★ 兑现满 cap -> 拒（否则一个战事造出无限逃兵）');

  const d2 = mk();
  d2.beyond = [{ id: 'by_w3', what: '北方战事打输了', visible: 'secret', spawned: 1, cap: 2 }];
  const v2 = RT.validateUpdates(d2, [spawn({ cause: '北方战事打输了，有人往南逃', causeRef: { kind: 'beyond', id: 'by_w3' } })], {}, {});
  ok(v2.allowed.length === 1, '★ 还没满 -> 过');
}

console.log('');
console.log('[7] 「世界上游」这一类真的接通了（契约 <-> 执行器 <-> 账本）');
{
  const C = require('../src/contract');
  const G = require('../src/game');
  ok(C.UPDATE_TYPE_NAMES.indexOf('世界上游') >= 0, '契约里有「世界上游」这一类');
  const d = mk();
  const n0 = (d.beyond || []).length;
  const applied = G.applyUpdates(d, [{ type: '世界上游', what: '北方战事，败局已定', yields: ['逃兵', '难民'], cap: 2 }], d.current.time);
  ok(applied === 1 && (d.beyond || []).length === n0 + 1, '★ 执行器能落库（beyond 多了一条）');
  ok(d.beyond[0] && d.beyond[0].cap === 2 && d.beyond[0].visible === 'secret', '默认 secret、cap 生效');
  ok((d.ledger || []).some(l => l.type === '世界上游'), '落账（可追溯）');
}

console.log('');
console.log('[8] ★ v3.3 念头门控：**脑子里想的，不能超出玩家自己知道的**');
{
  const G = require('../src/game');
  const d = mk();
  const pid = Object.keys(d.entities).find(k => d.entities[k].type === 'person' && k !== 'player');
  const pname = d.entities[pid].name;
  delete (d.impressions || {})[pid];   // 玩家还不认识他：门控唯一的尺子 gate.nameOf 会给 null
  stripSelfName(d, d.entities[pid]);
  ok(G.viewName(d, pid) === null, '前置：此刻玩家确实不知道「' + pname + '」这个名字');

  const out = G.gateSuggestions(d, ['要不要去问问' + pname + '', '天不早了，该往回走了']);
  ok(out.indexOf('要不要去问问' + pname + '') < 0, '★ 念头里写了还不认识的人的真名 -> 那条被丢（否则界面替玩家剧透）');
  ok(out.length === 1, '同批里没泄露的那条照常留下（**只丢坏的那条，不整批丢**）');

  d.impressions[pid] = { stage: 2, nameKnown: pname, traits: [], notes: [], bonds: [], seen: '' };
  ok(G.viewName(d, pid) === pname, '前置：印象到"知道名字"之后 viewName 给得出名字');
  ok(G.gateSuggestions(d, ['要不要去问问' + pname + '']).length === 1, '★ 认得了的人就可以想（挡的是"玩家不知道"，不是"人名"）');

  /* v3.3 硬化：nameKnown 写成 true（"看起来对"的错写法）时，不能把字面量 "true" 当人名。
     这条是写上面那句夹具时真撞出来的 —— 契约是**人名字符串**，不是布尔。 */
  d.impressions[pid] = { stage: 2, nameKnown: true, traits: [], notes: [], bonds: [], seen: '' };
  ok(G.viewName(d, pid) === pname, '★ nameKnown 误写成 true -> 回落到实体真名，不会管人叫"true"');
  ok(G.viewName(d, pid) !== 'true', '★ 反例：返回值不是字符串 "true"');
}

console.log('');
console.log('[9] 念头是短的、有限的、**丢光了不补**的');
{
  const G = require('../src/game');
  const C = require('../src/contract');
  const d = mk();
  ok(G.gateSuggestions(d, ['啊'.repeat(C.SUGGEST_LEN + 1)]).length === 0, '★ 超过 ' + C.SUGGEST_LEN + ' 字 -> 丢（长句子是旁白，不是念头）');
  ok(G.gateSuggestions(d, ['出去走走']).length === 1, '短念头照常留下');
  const many = ['念头一二三四五', '念头六七八九十', '念头甲乙丙丁戊', '念头子丑寅卯辰', '念头金木水火土', '念头风雨雷电云', '念头上下左右中', '念头东西南北中'];
  const capped = G.gateSuggestions(d, many);
  ok(capped.length === C.SUGGEST_MAX && C.SUGGEST_MAX === 6, '★ 最多 ' + C.SUGGEST_MAX + ' 条（AI 多给也不吃）');
  ok(G.gateSuggestions(d, ['出去走走', '出去走走']).length === 1, '重复的念头只留一条');

  const d2 = mk();
  const pid2 = Object.keys(d2.entities).find(k => d2.entities[k].type === 'person' && k !== 'player');
  const pn2 = d2.entities[pid2].name;
  delete (d2.impressions || {})[pid2];
  stripSelfName(d2, d2.entities[pid2]);
  const leakAll = G.gateSuggestions(d2, ['问问' + pn2 + '', '找' + pn2 + '聊聊', '等' + pn2 + '回来', '给' + pn2 + '带个话']);
  ok(leakAll.length === 0, '★ 全泄了 -> 返回空数组，**不补**（补一条 = 代码替玩家想，念头立刻退化成任务列表）');

  const d3 = mk();
  const qid = Object.keys(d3.entities).find(k => d3.entities[k].type === 'place'
    && (d3.knowledge.visited || []).indexOf(k) < 0 && (d3.knowledge.knownPlaces || []).indexOf(k) < 0);
  if (qid) {
    const qn = d3.entities[qid].name;
    ok(G.gateSuggestions(d3, ['去' + qn + '看看']).length === 0, '★ 提到玩家没去过、也不知道的地名（' + qn + '）-> 丢');
  } else { ok(true, '（演示世界里没有"未知道的地点"可测，跳过）'); }
}

console.log('');
console.log('==== anchor-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
