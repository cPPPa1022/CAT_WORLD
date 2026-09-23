'use strict';
// memory-gate-check.js — v1.96 **记忆的写入门**断言
//
// 为什么要有它（研究/07 的结论）：
//   「**写什么进记忆**比怎么检索更决定体验。」
//   Sonder Engine 的线上语料是 145 条对话记忆 vs 2601 条 episode（约 5.6% 过关）——
//   作者明说这是设计不是缺陷。它还记过一次事故：闸门加上之前，
//   356 行（占全库 7.3%、某一故事的三分之一）只是一句占位串，却照样能被塞给角色。
//
// 而 v1.94 让这个门变得**更必要**：角色模拟器现在每回合最多被问 2 次、每次写一条「此刻」，
// 那条 tags 只有一个 ⇒ 去重条件（重叠 ≥2）永远不触发 ⇒ 线性膨胀。
// 用法：node scripts/memory-gate-check.js   失败非零退出
const RT = require('../src/runtime');
const AI = require('../src/ai');
const W = require('../src/world');
const G = require('../src/game');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  OK  ' + m)) : (fail++, console.log('  FAIL ' + m)); };
const newWorld = () => { const d = W.buildDemoWorld(); d.id = (p) => p + '_' + Math.random().toString(36).slice(2, 8); return d; };
const nMem = (d) => Object.keys(d.memories).length;
const gate = (d) => (d.current && d.current.memGate) || { pass: 0, skip: 0, capped: 0 };
const T = '1996-06-14T21:00:00';

(async () => {
  // ---------- 1 · AI 写的低分寒暄：不过门 ----------
  {
    const d = newWorld();
    const before = nMem(d);
    const r = RT.writeMemory(d, { owner: 'npc_1', content: '他问了句今天天气怎么样', tags: ['闲聊'], impact: 20, t: T });
    ok(!!r.gated && r.id === null, '★ 低分 + 无标记词 → 不进记忆库');
    ok(nMem(d) === before, '记忆条数没变（' + before + '）');
    ok(gate(d).skip === 1, '跳过被计数（skip=' + gate(d).skip + '，可查）');
  }

  // ---------- 2 · 高分过关 / 标记词过关 ----------
  {
    const d = newWorld();
    const r1 = RT.writeMemory(d, { owner: 'npc_1', content: '他在门口站了很久没进来', tags: ['异样'], impact: 70, t: T });
    ok(!!r1.id && !r1.gated, '★ 冲击力够（70 ≥ ' + RT.GATE_IMPACT + '）→ 进');
    const r2 = RT.writeMemory(d, { owner: 'npc_1', content: '我答应过帮你把东西带回来', tags: ['约定'], impact: 20, t: T });
    ok(!!r2.id && !r2.gated, '★ 分数低但命中标记词（答应）→ 也进（转折/承诺不必高分也得记住）');
    const r3 = RT.writeMemory(d, { owner: 'npc_1', content: '邻居家今天包了饺子', tags: ['日常'], impact: 15, t: T });
    ok(!!r3.gated, '普通日常 → 不进');
  }

  // ---------- 3 · 没过门的不丢：账本照样记着 ----------
  {
    const d = newWorld();
    const before = (d.ledger || []).length;
    const frame = { beats: [] };
    G.applyUpdates ? null : null;
    // 走真实的 Update 管道：AI 提议一条低分记忆
    const r = G.__testApplyUpdates ? null : null;
    // 直接用 runtime 的门 + 手工模拟 applyUpdates 的记账顺序不方便，改用公开路径：
    const res = RT.writeMemory(d, { owner: 'npc_1', content: '他随口应了一声', tags: ['闲聊'], impact: 12, t: T });
    ok(!!res.gated, '低分记忆被门拦下');
    ok(AI.SYSTEM(d, {}).indexOf('记忆是筛过的') >= 0, '★ SYSTEM 里写明了这条规矩（AI 知道写了可能不进，不会以为坏了）');
    ok(AI.SYSTEM(d, {}).indexOf('冲击力标尺') >= 0, '★ SYSTEM 里有 impact 标尺（没有标尺，55 这条线就是抽签）');
    ok(AI.SYSTEM(d, {}).indexOf('不会丢') >= 0, '★ SYSTEM 里写明「没过的不会丢」');
  }

  // ---------- 4 · 引擎自写：不过内容门，但按标签限量 ----------
  {
    const d = newWorld();
    const r1 = RT.writeMemory(d, { owner: 'npc_1', content: '沈姨此刻：心里在盘算', tags: ['此刻'], impact: 8, t: T }, { by: 'engine' });
    ok(!!r1.id, '★ 引擎自写（角色内心）不过内容门 —— 分数低也留下');
    for (let i = 0; i < 12; i++) RT.writeMemory(d, { owner: 'npc_1', content: '沈姨此刻：第' + i + '次盘算', tags: ['此刻'], impact: 8, t: T }, { by: 'engine' });
    const mine = Object.values(d.memories).filter(m => m.owner === 'npc_1' && (m.tags || []).indexOf('此刻') >= 0);
    ok(mine.length <= 6, '★ 「此刻」按标签限量（实得 ' + mine.length + ' ≤ 6）—— v1.94 起这条不加限就是线性膨胀');
    ok(gate(d).capped > 0, '挤出旧条数被计数（capped=' + gate(d).capped + '）');
  }

  // ---------- 5 · 端到端：走真实回合管线 ----------
  {
    const realIsLive = AI.isLive, realLlm = AI.llmJSON;
    AI.isLive = () => true;
    AI.llmJSON = async function (cfg, messages) {
      const sys = String(((messages || [])[0] || {}).content || '');
      if (sys.indexOf('角色模拟器') >= 0) return { line: '原话', action: '动作', inner: '内心' };
      // 主 AI 提议：一条高分（该进）+ 一条低分寒暄（该被拦）
      return { frame: { tag: 't', beats: [] }, updates: [
        { type: '记忆新增', owner: 'npc_1', content: '他今天当众把话说破了', tags: ['冲突'], impact: 80 },
        { type: '记忆新增', owner: 'npc_1', content: '他问了句吃了没', tags: ['闲聊'], impact: 10 }
      ] };
    };
    const d = newWorld();
    const before = nMem(d);
    await G.runTurn(d, '你好', { llm: { baseURL: 'http://x', apiKey: 'k', model: 'm' }, roles: {} });
    const added = nMem(d) - before;
    /* 不能按条数断言：这一回合引擎还会问过在场的人，每个人的内心各写一条（by:'engine'）。
       要断的是「**AI 提议的那两条里，哪条进了**」—— 按内容判，不按条数。 */
    ok(added >= 1, '端到端：这一回合确实有新记忆进库（实增 ' + added + ' 条：1 条高分提议 + 角色内心若干）');
    ok(gate(d).skip >= 1, '端到端：被拦的那条进了 skip 计数（' + gate(d).skip + '）');
    const hasHigh = Object.values(d.memories).some(m => String(m.content || '').indexOf('当众把话说破') >= 0);
    const hasLow = Object.values(d.memories).some(m => String(m.content || '').indexOf('吃了没') >= 0);
    ok(hasHigh && !hasLow, '★ 高分进了、寒暄没进');
    // 账本照样记着两条（「不丢」的凭据）
    const led = (d.ledger || []).filter(l => l.type === '记忆新增' && String(l.desc || '').indexOf('吃了没') >= 0);
    ok(led.length === 1, '★ 被拦的那条**仍在账本里**（不丢，只是不会被人想起来）');
    ok(led[0].ref == null, '账本里它的 ref 是空的（看得出它没进记忆库）');
    AI.isLive = realIsLive; AI.llmJSON = realLlm;
  }

  console.log('');
  console.log('pass=' + pass + ' fail=' + fail);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });