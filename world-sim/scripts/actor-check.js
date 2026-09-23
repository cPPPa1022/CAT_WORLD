'use strict';
// actor-check.js — v1.94 **角色分工：引擎先问过在场的人**断言
//
// 为什么要它：这一批把「角色委派」从**极稀缺保险丝**改成了**常规部件** ——
//   判据从「必须命中极端词」改成「在场 ≥2 人就问，限量」；
//   通道从「主 AI 主动 delegate」改成「引擎先并行问、原话直达、引擎再兜一次」。
//   这条链上任何一环断掉，症状都很轻（人物变回由主 AI 代笔），没人会报错。
// 用法：node scripts/actor-check.js   失败非零退出
const AI = require('../src/ai');
const W = require('../src/world');
const G = require('../src/game');
const SCHED = require('../src/scheduler');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  OK  ' + m)) : (fail++, console.log('  FAIL ' + m)); };
const newWorld = () => { const d = W.buildDemoWorld(); d.id = (p) => p + '_' + Math.random().toString(36).slice(2, 8); return d; };
const here = (d) => Object.values(d.entities).filter(e => e.type === 'person' && e.id !== 'player' && e.state && e.state.location === d.current.sceneId);

(async () => {
  // ---------- 1 · 常态化：≥2 在场就问（不再需要极端词） ----------
  {
    const d = newWorld();
    ok(here(d).length >= 2, '演示世界开局有 ≥2 人在场（实得 ' + here(d).length + '）');
    const sp = AI.spotlight(d);
    ok(sp.length >= 1, '★ 没有极端冲突词也预标（原来这里返回空 = 默认全自己写）');
    ok(sp.every(x => x.who && x.name), '每人带 id 与名字');
  }

  // ---------- 2 · 单人戏不预标（成本） ----------
  {
    const d = newWorld();
    const hs = here(d);
    for (const p of hs.slice(1)) p.state.location = 'pl_99';   // 只留一个人在

    ok(here(d).length === 1, '场景里只剩一个人');
    ok(AI.spotlight(d).length === 0, '★ 单人戏不预标（没有「替所有人说话」的问题，主 AI 写更连贯）');
  }

  // ---------- 3 · 预算上限是硬约束 ----------
  {
    const d = newWorld();
    const hs = here(d);
    for (let i = 0; i < 3; i++) { const nid = 'np_' + i; d.entities[nid] = JSON.parse(JSON.stringify(hs[0])); d.entities[nid].id = nid; d.entities[nid].name = '路人' + i; d.entities[nid].state.location = d.current.sceneId; }
    ok(here(d).length >= 4, '场上 ≥4 人（实得 ' + here(d).length + '）');
    ok(AI.spotlight(d, 1).length === 1, 'actorBudget=1 → 只问 1 人');
    ok(AI.spotlight(d, 0).length === 0, 'actorBudget=0 → 一个都不问（可以关掉）');
    d.meta.actorBudget = 3;
    ok(AI.spotlight(d).length === 3, '世界包声明 actorBudget=3 → 问 3 人');
  }

  // ---------- 4 · 死者不入选 ----------
  {
    const d = newWorld();
    const hs = here(d);
    if (hs[0]) hs[0].state.alive = false;
    ok(AI.spotlight(d).every(x => x.who !== (hs[0] || {}).id), '已故的人不会被问');
  }

  // ---------- 5 · 端到端：引擎先问 → 原话进资料包 → 落到画面里 ----------
  {
    const calls = { actor: 0, main: 0, packs: [] };
    const realIsLive = AI.isLive, realLlm = AI.llmJSON;
    AI.isLive = () => true;
    AI.llmJSON = async function (cfg, messages) {
      const sys = String((messages[0] || {}).content || '');
      if (sys.indexOf('角色模拟器') >= 0) {
        calls.actor++;
        const nm = (sys.match(/你现在是：([^。]+)。/) || [])[1] || '某人';
        return { line: nm + '自己的原话', action: '抬了下眼', inner: '心里在盘算' };
      }
      calls.main++;
      const pack = messages.filter(m => m.role === 'user').map(m => String(m.content)).join(String.fromCharCode(10));
      /* 只有**主 AI** 的 user 消息才是资料包 —— 副 AI（reply/calc/digest/edit/news）也走 llmJSON，
         它们发的是各自的小 JSON，不认出来会把 packs[0] 取成副 AI 的回执（storyteller-check 踩过同一个坑）。 */
      let obj = null;
      try { obj = JSON.parse(pack); } catch (e) { obj = null; }
      if (obj && ('你的身世(你本人完全清楚的)' in obj)) calls.packs.push(obj);
      // 主 AI 故意**不写**任何人的台词（最坏情况），检验引擎的兜底交付
      return { frame: { tag: 't', beats: [{ type: 'narration', text: '屋里很安静。' }] }, updates: [] };
    };
    const d = newWorld();
    const r = await G.runTurn(d, '你好', { llm: { baseURL: 'http://x', apiKey: 'k', model: 'm' }, roles: {} });
    ok(calls.actor >= 1, '★ 引擎这一回合真的去问了角色（' + calls.actor + ' 次）');
    const p0 = calls.packs.filter(Boolean)[0] || {};
    ok(Array.isArray(p0['他们自己开口了']) && p0['他们自己开口了'].length >= 1, '★ 他们的原话进了资料包字段「他们自己开口了」');
    const spoken = (p0['他们自己开口了'] || []).map(x => x.line);
    const inFrame = ((r.frame && r.frame.beats) || []).filter(b => b && b.type === 'dialogue' && spoken.some(s => String(b.text || '').indexOf(s) >= 0));
    ok(inFrame.length === spoken.length && spoken.length > 0, '★ 主 AI 没写 → 引擎把原话补进了画面（' + inFrame.length + '/' + spoken.length + '）');
    ok(inFrame.every(b => !!b.action), '补进去的台词带 action 槽位（不塞进 text 的括号里）');
    AI.isLive = realIsLive; AI.llmJSON = realLlm;
  }

  // ---------- 6 · 主 AI 照做时不覆盖 ----------
  {
    const realIsLive = AI.isLive, realLlm = AI.llmJSON;
    let spoken = '';
    AI.isLive = () => true;
    AI.llmJSON = async function (cfg, messages) {
      const sys = String((messages[0] || {}).content || '');
      if (sys.indexOf('角色模拟器') >= 0) return { line: '引擎给的原话', action: '点头', inner: 'x' };
      const pack = messages.filter(m => m.role === 'user').map(m => String(m.content)).join(String.fromCharCode(10));
      try { const o = JSON.parse(pack); spoken = ((o['他们自己开口了'] || [])[0] || {}).line || ''; } catch (e) { /* ignore */ }
      const who = (function () { try { return JSON.parse(pack)['他们自己开口了'][0].who; } catch (e) { return 'npc_1'; } })();
      // 主 AI **照做**：原样使用那句话，并自己给了一个 action
      return { frame: { tag: 't', beats: [{ type: 'dialogue', speaker: who, action: '主AI写的动作', text: spoken }] }, updates: [] };
    };
    const d = newWorld();
    const r = await G.runTurn(d, '你好', { llm: { baseURL: 'http://x', apiKey: 'k', model: 'm' }, roles: {} });
    const b = (((r.frame && r.frame.beats) || []).find(x => x && x.type === 'dialogue')) || {};
    ok(!!b.text && b.text.indexOf('引擎给的原话') >= 0, '主 AI 照做时台词保留');
    ok(b.action === '主AI写的动作', '★ 主 AI 自己的 action 不被覆盖（引擎只在它没写时兜）');
    AI.isLive = realIsLive; AI.llmJSON = realLlm;
  }

  // ---------- 7 · 认知包补齐了「像不像这个人」的三样 ----------
  {
    const d = newWorld();
    const npc = here(d)[0];
    npc.locked = { core: '性格内核：嘴上不饶人，心里记着好' };
    npc.profile.surface = Object.assign({}, npc.profile.surface, { 口癖: '说话带「啧」' });
    d.meta.userSelf = { voice: '粗话不离口' };
    let sysTxt = '';
    const realIsLive = AI.isLive, realLlm = AI.llmJSON;
    AI.isLive = () => true;
    AI.llmJSON = async function (cfg, messages) { const s = String((messages[0] || {}).content || ''); if (s.indexOf('角色模拟器') >= 0) sysTxt = s; return { line: 'x', action: 'y', inner: 'z' }; };
    await SCHED.dispatch(d, { llm: { baseURL: 'http://x', apiKey: 'k', model: 'm' } }, 'actor', { npcId: npc.id, context: '测试' });
    ok(sysTxt.indexOf('性格内核') >= 0, '★ 认知包里有性格内核（TA 会怎么选）');
    ok(sysTxt.indexOf('口癖') >= 0, '★ 认知包里有口癖（TA 说话长什么样）');
    ok(sysTxt.indexOf('玩家说话的方式') >= 0, '★ 认知包里有玩家语域（该怎么接）');
    ok(sysTxt.indexOf('不许评价') >= 0, '语域那条带着「照常反应，不许评价」的边界');
    AI.isLive = realIsLive; AI.llmJSON = realLlm;
  }

  console.log('');
  console.log('pass=' + pass + ' fail=' + fail);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });