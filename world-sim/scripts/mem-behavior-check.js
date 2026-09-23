// mem-behavior-check.js — 记忆机制的行为断言（不靠 recall，直接盯机制）
// 解决的真问题：mem-recall 的 recall@4 是"平均分"，对单点机制失效不敏感
// （实测：把 funnelMemories 的时效项乘 0，recall@4 仍是 55%，一把尺子抓不到）。
'use strict';
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
const W = require(path.join(ROOT, 'src', 'world'));
const RT = require(path.join(ROOT, 'src', 'runtime'));

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✔', m)) : (fail++, console.log('  ✘ FAIL:', m)); };

// ---------- [1] 时效必须在检索里起作用 ----------
// 两条记忆：标签、权重完全相同，只差在时间。若打分不看时间，就会退回文件顺序（旧的那条在前）。
{
  const d = W.buildDemoWorld();
  const T = ['杂货铺', '冲突'];
  d.memories['m_old'] = { id: 'm_old', owner: 'player', content: '很久以前在店里闹过一次', tags: T, impact: 50, weight: 50, t: '1996-01-01T10:00:00', activations: 1 };
  d.memories['m_new'] = { id: 'm_new', owner: 'player', content: '刚刚在店里又闹了一次', tags: T, impact: 50, weight: 50, t: '1996-06-14T20:00:00', activations: 1 };
  const top2 = RT.funnelMemories(d, 'player', T, 2).map(m => m.id);
  ok(top2[0] === 'm_new', '检索把更近的那条排在前面（拿到 [' + top2.join(' ') + ']，期望 m_new 在首位）');
}

// ---------- [2] 记忆深度：**一套算法**（v2.04 · P1-2 起） ----------
// 原来这里记的是"缺口"：权重 = impact × e^(-λ·月数)，随机抖动 ±2，**不看 activations**。
// 断言当时就写着"哪天有人把关联激活改成真的生效，这里会变红 → 逼他更新预期" —— 那一刻到了。
// 现在的契约（RT.memDepth 是唯一计算点）：
//   depth = clamp(impact × e^(-λ·Δt) × boost, impact×0.15, 100)
//   boost = 1 + 0.15·log2(1 + activations)，封顶 1.5×   ← "被反复想起会更牢"终于成立
//   没有随机项（同输入同输出）—— 接进主 AI 之后，"每回合想起的事"不许自己跳。
{
  const d = W.buildDemoWorld();
  d.memories['m_x'] = { id: 'm_x', owner: 'player', content: '权重被人为抬高，模拟"关联激活"加成', tags: ['杂货铺'], impact: 20, weight: 90, t: '1996-06-14T20:00:00', activations: 9 };
  const d2 = W.buildDemoWorld();
  d2.memories['m_x'] = { id: 'm_x', owner: 'player', content: '只被想起过一次', tags: ['杂货铺'], impact: 20, weight: 90, t: '1996-06-14T20:00:00', activations: 1 };
  RT.decayMemories(d, '1996-06-14T20:05:00');
  RT.decayMemories(d2, '1996-06-14T20:05:00');
  const w = d.memories['m_x'].weight, w1 = d2.memories['m_x'].weight;
  ok(w < 90, 'decayMemories 仍然会覆盖外部给的 weight（实测 ' + w + ' —— 存档里的旧值不是真源，memDepth 才是）');
  ok(w > w1, '★ 反复想起的更牢（activations=9 → ' + w + ' ＞ activations=1 → ' + w1 + '）—— 这条以前是"预告会红"的缺口，现在是真的');
  ok(Math.abs(w1 - 20) <= 0.5, '只被想起一次的记忆 ≈ impact（实测 ' + w1 + '，impact=20）');
  const again = (() => { const x = W.buildDemoWorld(); x.memories['m_x'] = { id: 'm_x', owner: 'player', content: 'c', tags: ['杂货铺'], impact: 20, t: '1996-06-14T20:00:00', activations: 9 }; RT.decayMemories(x, '1996-06-14T20:05:00'); return x.memories['m_x'].weight; })();
  ok(again === w, '★ 同输入同输出（去掉了随机抖动）：' + again + ' === ' + w);
  const floor = RT.memDepth(d, { owner: 'player', impact: 20, t: '1900-01-01T00:00:00', activations: 1 }, '1996-06-14T20:05:00');
  ok(Math.abs(floor - 3) < 0.01, '★ 15% 地板仍在（三百年后也不会归零 → 与"记忆永远保留"一致）：' + floor);
}

// ---------- [3] 去重规则的真实边界（★ 这里记录的是一个缺口，不是"通过"） ----------
// 规则：同主人 + 标签重叠 ≥2 + 3 天内才合并。而 m_2 的标签是 ['杂货铺','冲突','口误']，
// 新记忆若写成 ['杂货铺','冲突'] 只有 1 个重叠 → 不合并。
// 含义：AI 每次生成 tags 时的用词漂移（哪怕只差一个词），去重就会失效 → 记忆只增不减。
{
  // (a) 标签齐 + 3 天内（m_2 是 06-08，这里用 06-10，差 2 天）→ 应该合并
  const d = W.buildDemoWorld();
  const before = Object.keys(d.memories).length;
  RT.writeMemory(d, { owner: 'player', content: '又一次在店里把话说重了', tags: ['杂货铺', '冲突', '口误'], impact: 70, t: '1996-06-10T21:00:00' });   // v1.96：分数必须过写入门（≥55），否则这一段会因为「被门拦下」而**假绿**
  ok(Object.keys(d.memories).length === before, '同主人+标签≥2 重叠+3 天内 → 正确合并（' + before + ' → ' + Object.keys(d.memories).length + '）');
  // (b) 标签名有差异（用"口角"替代"口误"）：实测**仍然合并**（m_2 的标签是 杂货铺/冲突/口误，
  //     新记忆 杂货铺/冲突/口角 与之重叠 2 个 ≥ 阈值 2）→ 说明该去重对"换个近义词"是宽容的。
  //     这条**不是缺口**；原以为的"用词漂移导致去重失效"在本数据集上复现不出来，如实记录。
  const d2 = W.buildDemoWorld();
  const b2 = Object.keys(d2.memories).length;
  RT.writeMemory(d2, { owner: 'player', content: '又一次在店里把话说重了', tags: ['杂货铺', '冲突', '口角'], impact: 70, t: '1996-06-10T21:00:00' });
  ok(Object.keys(d2.memories).length === b2, '标签名称有出入（口角 vs 口误）仍能合并（' + b2 + ' → ' + Object.keys(d2.memories).length + '）');
  // (c) 超过 3 天窗口 → 不合并（这是设计如此）
  const d3 = W.buildDemoWorld();
  const b3 = Object.keys(d3.memories).length;
  RT.writeMemory(d3, { owner: 'player', content: '又一次在店里把话说重了', tags: ['杂货铺', '冲突', '口误'], impact: 70, t: '1996-06-14T21:00:00' });
  ok(Object.keys(d3.memories).length === b3 + 1, '超过 3 天窗口 → 不合并（' + b3 + ' → ' + Object.keys(d3.memories).length + '，设计如此）');
}

// ---------- [4] 不同主人之间不串（这是知识门控的底线） ----------
{
  const d = W.buildDemoWorld();
  const mine = RT.funnelMemories(d, 'player', [], 99).map(m => m.owner);
  ok(mine.length > 0 && mine.every(o => o === 'player'), '漏斗只返回该主人自己的记忆（拿到 owner=' + JSON.stringify([...new Set(mine)]) + '）');
}

/* ---------- [5] 记忆增长：缺口已在 v1.96 修好，这里改成记录**新事实** ----------
   原来这条断言的是「记忆会无限增长（塞 300 条后共 304 条）—— 这是设计缺口」。
   v1.96 加了写入门（impact ≥55 或命中转折/承诺/自白词）之后，300 条低分记忆**全被拦下**。
   这条断言于是变红 —— **红得对**：它锁的是一个已经不存在的缺口。
   注意这是本会话第 N 次遇到「断言把旧行为/补丁写成了契约」，所以这里不只改数字，
   而是把两件事分开断言：低分不再膨胀（门的功劳）+ 高分仍然会增长（门不是万能的）。 */
{
  const d = W.buildDemoWorld();
  const b = Object.keys(d.memories).length;
  for (let i = 0; i < 300; i++) RT.writeMemory(d, { owner: 'player', content: '测试记忆 ' + i + ' 内容各不相同避免去重', tags: ['测试_' + i], impact: 10, t: '1996-06-14T2' + (i % 10) + ':00:00' });
  const n = Object.keys(d.memories).length;
  ok(n === b, '★ 300 条低分记忆被写入门全部拦下（' + b + ' → ' + n + '）—— v1.96 之前这里是 304 条');
  ok((d.current.memGate || {}).skip >= 300, '拦住条数被计数（skip=' + ((d.current.memGate || {}).skip || 0) + '，可查）');
  // 高分仍然会增长：门不是为了「什么都别记」，是为了「只记值得记的」
  const d2 = W.buildDemoWorld();
  const b2 = Object.keys(d2.memories).length;
  for (let i = 0; i < 20; i++) RT.writeMemory(d2, { owner: 'player', content: '重要的第 ' + i + ' 件事内容各不相同', tags: ['重要_' + i], impact: 80, t: '1996-06-14T2' + (i % 10) + ':00:00' });
  ok(Object.keys(d2.memories).length === b2 + 20, '★ 高分记忆照样进（' + b2 + ' → ' + Object.keys(d2.memories).length + '）—— 门不是万能的，长局仍要另想留存策略');
}

console.log('\n==== mem-behavior-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
