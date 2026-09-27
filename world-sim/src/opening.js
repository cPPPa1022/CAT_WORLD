// opening.js — 开局编译（v3.1 · 2026-09-19）
//
// 用户定的四件事：
//   ① 玩家（角色）设定补全（+ 周边人际关系**轻度**补全）
//   ② 已出场 NPC 设定补全（+ NPC 周边关系**轻度**补全）
//   ③ 世界说明 / 设定补全
//   ④ 默认以 3 档授权，把世界调整到合适的样子
//
// 权限声明（用户原话：框架档位的所有权限仅能修改存档里的任何事物，但禁止动模拟器里的根代码）：
//   ✅ 可改：存档里的一切 —— 玩家 / NPC / 地点 / 世界说明 / 框架（词·型·律）
//   ❌ 不可：引擎契约 —— 不新增字段类型、不改确定性算法（时间/位置/钱）、
//            不删实体（冻结不删）、不写公式与算术（档 3 硬约束）、不越烈度上限、不许占位串
//
// 为什么需要它（四个洞其实是同一个洞）：
//   世界说九十年代小镇，人身上却有大哥大；说你在镇上住了 27 年，地图上却显示没去过；
//   说你是个大学生，通讯录里却没有父母；人物面板里第一个人还没记住脸。
//   —— 都是因为**没有一个步骤把世界的声明翻译成这个人的字段**。这一步就是开局编译。

'use strict';
const AI = require('./ai');
const DEG = require('./degraded');
const BUS = require('./bus');
const FW = require('./framework');
const ACC = require('./accounts');    // v3.20 钱与账：把开场白里写明的处境落成账目

/* v2.08 删：OPENING_TIER 常量随之移除 —— 档位没了，开局编译和其他时候一样能力全开，
   不再需要"临时提到 3 档、完了还原"（那两次 setLevel 就是权限日志说谎的来源）。 */
const TIMEOUT_MS = 25000;               // 超时就退回确定性兜底，不让玩家卡在门口

/* ★ v3.5 修（用户：「第三步出现异常 要么修复 要么重新弄」）：
   原来 mark() **无条件**写 `meta.openingAt`，而 done() 只看 openingAt ⇒
   **一次超时（fallback）就把门永久锁上**：既不会重试、也没入口重跑，
   而它本该补的那四个洞永远留着（交接文档 §7.2 #5 记着这条）。

   现在分两类：
     ai / noop / off  → **终局**（真做完了 / 没得做 / 玩家关了），done 为真
     fallback         → **不算做完**，可以重跑；但有次数上限
                        （`OPENING_MAX_TRIES`，免得每次进世界都重烧一次 token）
   失败原因照旧写进 `openingNote` —— **代码层级、0 token**，
   对应「报错了不能静默，原因是什么」这条要求。 */
const OPENING_OK = ['ai', 'noop', 'off'];
const OPENING_MAX_TRIES = 2;

function done(data) {
  const m = (data && data.meta) || null;
  if (!m || !m.openingAt) return false;
  if (OPENING_OK.indexOf(String(m.openingHow || '')) >= 0) return true;
  return Number(m.openingTries || 0) >= OPENING_MAX_TRIES;
}
function mark(data, how, note) {
  data.meta = data.meta || {};
  const h = String(how || 'ai');
  data.meta.openingAt = new Date().toISOString();
  data.meta.openingHow = h;
  if (OPENING_OK.indexOf(h) < 0) data.meta.openingTries = Number(data.meta.openingTries || 0) + 1;
  if (note) data.meta.openingNote = String(note).slice(0, 160);
}
/* 「重跑第三步」的入口 —— 用户原话：「要么**重试**（第三步重新跑一遍），要么**修复**」。
   清掉终局标记与次数，compile() 下次就能再跑一遍。 */
function reset(data) {
  if (!data) return false;
  data.meta = data.meta || {};
  delete data.meta.openingAt;
  delete data.meta.openingHow;
  delete data.meta.openingNote;
  data.meta.openingTries = 0;
  return true;
}

/* 输入包：只给结构化快照（不给正文、不给对话） */
function packet(data) {
  const E = (data && data.entities) || {};
  const pl = E.player || {};
  const pr = pl.profile || {};
  const pick = (o) => String(o == null ? '' : o).trim();
  const K = data.knowledge || {};
  const npcs = Object.values(E).filter(e => e && e.type === 'person' && e.id !== 'player').slice(0, 12).map(e => {
    const q = e.profile || {};
    return {
      id: e.id, 名字: e.name,
      身份: pick((q.identity || {}).身份), 职业: pick((q.identity || {}).职业),
      样貌: pick((q.appearance || {}).标志物), 待人: pick((q.surface || {}).待人),
      里子: pick((q.hidden || {}).真实), 现在想: pick((q.desires || {}).现在想),
      此刻: (e.state || {}).location === data.current.sceneId ? '在场' : pick((e.state || {}).location)
    };
  });
  const places = Object.values(E).filter(e => e && e.type === 'place').slice(0, 12).map(e => ({ id: e.id, 名字: e.name, 标签: (e.tags || []).join('/') }));
  const empty = [];
  const slots = [['身份', (pr.identity || {}).身份], ['来历', (pr.background || {}).经历], ['样貌', (pr.appearance || {}).标志物], ['性格', (pr.surface || {}).待人], ['现在想', (pr.desires || {}).现在想]];
  for (const s of slots) if (!pick(s[1])) empty.push(s[0]);
  /* ★ v3.20：**开场白也算"世界的声明"**。它上面明写着这个人的处境（月租多少、欠了多久、谁在催），
     而在此之前开局编译看不到它 —— 于是"欠租"只活在散文里，之后每回合被重编一次
     （实测同一笔房租先后被说成"半个月 / 两个月 / 五千二 / 八百"）。 */
  const greet = String((data.meta || {}).usedGreeting || (((data.meta || {}).greetings || [])[0] || '')).trim();
  return {
    开场白: greet ? greet.slice(0, 1200) : '（这张卡没有开场白）',
    世界: { 名称: (data.meta || {}).name, 时代: (data.meta || {}).era, 科技线: (data.meta || {}).carries, 货币: (data.meta || {}).currency, 烈度上限: (data.meta || {}).maxSeverity },
    玩家: {
      名字: pl.name, 年龄: (pr.identity || {}).年龄, 身份: pick((pr.identity || {}).身份), 职业: pick((pr.identity || {}).职业),
      来历: pick((pr.background || {}).经历), 样貌: pick((pr.appearance || {}).标志物), 性格: pick((pr.surface || {}).待人),
      现在想: pick((pr.desires || {}).现在想), 钱: pl.money || null, 随身: (pl.inventory || []).map(x => x && x.name).filter(Boolean),
      缺的槽位: empty
    },
    NPC: npcs, 地点: places,
    已知: { 认识的人: K.knownPeople || [], 知道的地方: K.knownPlaces || [], 去过: K.visited || [] }
  };
}

/* 提示词：四件事 + 权限边界 + 输出形状（用中文引号，避免任何转义） */
function systemPrompt() {
  return AI.withCharter([
    '你是【世界模拟器】的开局编译。这一趟不演剧情，只做一件事：',
    '把「世界的声明」翻译成「每个人此刻的字段」，让这一局从第一秒就是自洽的。',
    '',
    '【四件事，都要做】',
    '① 玩家（角色）设定补全：把「缺的槽位」补全。已有内容一字不改。',
    '② 玩家周边人际关系（轻度）+ **通信条件**：只给名单里已有的人写关系基调（家人 / 房东兼邻居 / 同学 / 点头之交…），',
    '   判据：**这个身份真的会认识、且真的会有交集的人**才写；只有一面之缘、或这个身份不该认识的人，不写。',
    '   不算条数、也不限字数 —— 写准就行（凑数比写少更糟）。不许凭空造人。',
    '   同时写清**你能怎么联系到谁**（这一条极重要）：',
    '     mobile 手机 / landline 座机 / pager 传呼机 / letter 只有信和口信 / none 联系不上。',
    '   联系方式必须与**时代和身份**自洽：九十年代小镇的人不该有手机（有座机、传呼、口信就够了）；',
    '   而一个 2020 年的大学生，父母一定在手机通讯录里 —— 该有却没有，就是错。',
    '   none 是合法的（刚认识、只有一面之缘）。不许为了填满给每个人编一个号码。',
    '③ NPC 设定补全 + 他们的周边（轻度）：补空字段；NPC 之间的关系**写得出来就写**（老邻居 / 师徒 / 有旧账），判断不了的留空，不要凑数。',
    '④ 世界说明/设定补全：只补世界级的空字段（era / currency / artStyle / note）。',
    '⑤ 处境与账目（**只读开场白里已经写明的**）：这个世界的开头常常把处境写在纸面上了 ——',
    '   月租多少、欠了几个月、欠谁的、借过谁的钱、该还什么礼。把它们落成 debts，让这一局从第一秒就有账可查。',
    '   ⚠️ 这是【事实层】：开场白 / 卡里**没说**的账，一个字都不许写（不许"推测他大概欠着"）。',
    '   金额说不清就整条不写 —— **留空是合法的，编一个数字比留空糟得多**（之后每回合都会引用它）。',
    /* ★ v3.20：玩家钱包里的数与"世界声明"里的数**必须是一套**。
       实测那局：卡里白纸黑字写着【当前余额：1,001,234.00元】，存档里却是 15000+12000
       （扫描那一步的兜底按"普通"档 3 个月算出来的）—— 两个数都进了提示词，正文必然打架。 */
    '⑥ 钱要对齐（只看世界声明）：如果开场白 / 卡 / 世界规则里**写明了金额**（余额、存款、奖励、"系统给的"），',
    '   而 packet 里【钱】给的跟它对不上，就在 moneyFix 里写出**按声明应有的那个数**（cash / digital）和 why（依据是哪一句原话）。',
    '   引擎**只会把差额记成一笔 钱款变动**（有账可查、有头有尾），不会凭空改余额；对得上就整个 moneyFix 省略。',
    '',
    '【权限边界（硬）】',
    '· 你只能改存档里的事物；引擎契约不归你管：不新增字段类型、不写公式与算术、不删任何既有实体。',
    '· 关系一律定性，不许数字、不许等级。',
    '· 身上的东西与通信条件必须与时代和身份自洽：九十年代小镇的普通人不会有大哥大和短信。',
    '· 禁止占位串：待发现 / 未知 / 待接触 / 未定 / 待补全。宁可留空，也不要写这些。',
    /* ★ v3.11（用户 2026-09-27）：「判断不了就留空。留空是合法的，编造不是」这段我没搞懂 ——
       我鼓励的是 ai 创造，**合理编造是合法的，禁止空白**。不过这个应该是第一步/第二步的内容？」
       他说得对：那条规矩属于**读卡**（第一/二步）—— 读卡时编 = 把假设当真相喂给玩家。
       所以这里拆成两层，各管各的： */
    '· 【事实层 · 不许编】玩家会当成真相的东西（谁是谁、谁认识谁、已经发生过什么、关系与认知）：',
    '  判断不了就留空 —— **留空是合法的，编造不是**（这是第一/二步读卡那套规矩，不是这一层）。',
    '· 【创造层 · 禁止留空】这个世界/界面/功能/器物/规矩「长什么样」：**判断不了就合理编一个**，',
    '  并说清依据（卡里哪句 / 世界基调 / 时代常识）。空着的界面不是谨慎，是没做。',
    '  两句话不矛盾：**编事实是错的，编世界是本职。**',
    '',
    '【输出 JSON，只输出 JSON】字段名照抄下面：',
    '{',
    '  player: { fields: { 身份: … }, relations: [ { with: npc1, tone: 房东兼邻居, how: 住了两年 } ],',
    '            contacts: [ { id: npc1, kind: landline, label: 铺子柜台那台 } ] },',
    '  npcs: [ { id: npc1, fields: { 职业: … }, relations: [ { with: npc2, tone: 老邻居 } ] } ],',
    '  world: { fields: { era: …, currency: …, note: 这个世界在讲什么（2~3 句） } },',
    '  debts: [ { who: npc1, dir: 欠, amount: 2400, what: 两个月房租, due: 2020-10-10, since: 2020-08-01 } ],',
    '  moneyFix: { cash: 1001234, digital: 0, what: 神豪系统新人奖励, why: "开场白写着【当前余额：1,001,234.00元】" },',
    '  framework: [ { slot: rule, name: …, form: enum, items: [ … ], why: … } ],',
    '  selfcheck: { 不该有: 这个人身上有不该有的东西吗, 该有没有: 有该有却没有的东西吗（例如通讯录里没有家人） }',
    '}',
    'framework 是**可选**的：这个世界确实需要一条规则/一个称谓才写，不需要就留空数组。'
  ].join(String.fromCharCode(10)));
}

/* 翻译：AI 的输出 → 白名单里的 Update（不合法的丢，不替它编） */
function toUpdates(out, data) {
  const us = [];
  const has = (id) => !!(data.entities && data.entities[id]);
  const who = (x) => String((x && x.id) || '').trim();
  const rel = (arr) => (Array.isArray(arr) ? arr : [])
    .map(r => ({ with: String((r && r.with) || '').trim(), tone: String((r && r.tone) || '').trim(), how: String((r && r.how) || '').trim() }))
    .filter(r => r.with && r.tone && has(r.with));
  /* 通信条件：kind 白名单（与 game.js 的 CONTACT_KINDS 同源）；id 必须存在。 */
  const KINDS = ['mobile', 'landline', 'pager', 'letter', 'none'];
  const contacts = (arr) => (Array.isArray(arr) ? arr : [])
    .map(c => ({ id: String((c && c.id) || '').trim(), kind: String((c && c.kind) || '').trim().toLowerCase(), label: String((c && c.label) || '').trim() }))
    .filter(c => c.id && has(c.id) && KINDS.indexOf(c.kind) >= 0);
  const o = out || {};
  if (o.player && (o.player.fields || o.player.relations || o.player.contacts)) {
    us.push({ type: '设定补全', target: 'player', fields: o.player.fields || {}, relations: rel(o.player.relations), contacts: contacts(o.player.contacts), why: '开局编译' });
  }
  for (const n of (Array.isArray(o.npcs) ? o.npcs : [])) {
    const id = who(n);
    if (!id || !has(id)) continue;                       // 名单外的人：不认
    us.push({ type: '设定补全', target: id, fields: (n && n.fields) || {}, relations: rel(n && n.relations), why: '开局编译' });
  }
  if (o.world && o.world.fields) us.push({ type: '设定补全', target: 'world', fields: o.world.fields, why: '开局编译' });
  /* ★ v3.20：账目（处境的账）。三条硬规矩：
     ① who 必须是名单里已有的人（名单外的：不认）② 金额归一后必须 > 0（说不清就不记，绝不替它编数字）
     ③ 只记"开场白/世界声明里写着"的那一笔 —— 判据在提示词里，代码这一侧只能守住前两条。 */
  for (const d of (Array.isArray(o.debts) ? o.debts : []).slice(0, 6)) {
    if (!d) continue;
    const id = who(d);
    const amt = ACC.amountOf(d.amount);
    if (!id || !has(id) || !(amt > 0)) continue;
    us.push({ type: '账目', op: '记', dir: (String(d.dir || '').indexOf('被') >= 0 ? '被欠' : '欠'),
      who: id, amount: amt, what: String(d.what || '').slice(0, 30),
      due: String(d.due || '').slice(0, 10), since: String(d.since || '').slice(0, 10),
      cause: '开场白里写明的处境' });
  }
  /* ★ v3.20：世界声明的钱 vs 存档钱包 —— **差额走一笔 钱款变动**（引擎会记账），不直接改余额。
     两个安全阀：① 算不出来/是 0 → 整条不发；② 要往下调而钱包不够 → 不发
     （第三步是"全有或全无"，一条会被拒的提案能把整批拖回滚，那比不对齐更糟）。 */
  if (o.moneyFix && (o.moneyFix.cash != null || o.moneyFix.digital != null)) {
    try {
      const w = (((data.entities || {}).player || {}).money) || {};
      const target = (Number(o.moneyFix.cash) || 0) + (Number(o.moneyFix.digital) || 0);
      const have = (Number(w.cash) || 0) + (Number(w.digital) || 0);
      const diff = Math.round(target - have);
      const why = String(o.moneyFix.why || '').slice(0, 60) || '世界声明里的钱';
      const what = String(o.moneyFix.what || '世界声明里就有的钱').slice(0, 30);
      if (diff > 0) us.push({ type: '钱款变动', dir: '收', amount: diff, what: what, cause: why });
      else if (diff < 0 && have + diff >= 0) us.push({ type: '钱款变动', dir: '付', amount: -diff, what: what, cause: why });
    } catch (e) { DEG.hit('opening.js', e); }
  }
  for (const f of (Array.isArray(o.framework) ? o.framework : []).slice(0, 6)) {
    if (!f || !f.slot || !f.name) continue;
    us.push({ type: '框架', slot: f.slot, name: f.name, form: f.form, items: f.items, min: f.min, max: f.max, scope: f.scope, why: f.why || '开局编译' });
  }
  return us;
}

/* 确定性兜底（零 token）：只做世界里已经声明过的事 */
function fallback(data) {
  const us = [];
  const R = ((data.relations || {}).player) || {};
  for (const id of Object.keys(R)) {
    if (!data.entities || !data.entities[id]) continue;
    const tone = String((R[id] || {}).tone || '').trim();
    if (!tone) continue;
    us.push({ type: '印象更新', target: id, note: tone.slice(0, 40) });   // 关系存在 = 你认识这个人
  }
  return us;
}

/* 主入口：进世界之前跑一次，失败退回兜底，绝不让玩家卡在门口 */
async function compile(data, cfg, opts) {
  const o = opts || {};
  if (!data || done(data)) return { ok: false, why: 'already' };
  if (o.off) { mark(data, 'off'); return { ok: false, why: 'off' }; }
  if (!AI.isLive(cfg)) {
    const us = fallback(data);
    if (us.length) { try { BUS.commit(data, [{ kind: 'update', updates: us }], { t: data.current.time }); } catch (e) { DEG.hit('opening.js', e); } }
    mark(data, 'fallback', '未接入模型：只做了确定性兜底（关系→认识）');
    return { ok: false, why: 'no_ai', applied: us.length };
  }
  let out = null, err = '';
  try {
    const r = await Promise.race([
      AI.llmJSON(cfg, [{ role: 'system', content: systemPrompt() }, { role: 'user', content: JSON.stringify(packet(data)) }], () => null, AI.cfgMax(cfg)),
      new Promise((res) => setTimeout(() => res(null), TIMEOUT_MS))
    ]);
    out = (r && !r.__fallback) ? r : null;
  } catch (e) { err = String((e && e.message) || e); DEG.hit('opening.js', e); }
  let applied = 0, dropped = 0;
  const us = out ? toUpdates(out, data) : [];
  if (us.length) {
    try {
      /* ★ v3.5：第三步走**全有或全无**（用户：「最后全部写完之后再检查一遍 没问题就应用」）。
       为什么是这一步：它是唯一"一次性大批量改这个存档"的地方 ——
       部分生效的话，世界会建到一半（有的槽位补了、有的没补），
       而那种状态**既不知道该回滚到哪、也没法重跑**。
       ⚠️ 整批被回滚时**不要在这里提前 return** ——
          那样会跳过下面的 `fallback(data)`，玩家直接卡在门口。
          正确做法：把原因写进 err，让**同一套**降级路去处理（确定性兜底 + 记 fallback）。 */
    const rec = BUS.commit(data, [{ kind: 'update', updates: us }], { t: data.current.time, allOrNone: true });
    if (rec && rec.rolledBack) {
      err = '整批校验没过，已回滚（未落库 ' + rec.rolledBackN + ' 条）：' + String(rec.rolledBackWhy || '').slice(0, 100);
    }
      /* ★ v2.08 修（真 bug，骗了很久）：这里原来读 `rec.applied` ——
         而 BUS.commit 的返回是 { id, committed[], rejected[], clockDelta, ledgerIds[] }，
         **没有顶层 applied**（计数在 committed[i].applied 里）。
         于是 applied **恒为 0** → 每一次开局编译都走失败分支 → `openingHow` **永远是 'fallback'**，
         哪怕 AI 的提案全部落库了（实测：存档 framework.log 里有 by:'ai' 的律，同一份存档却写 openingHow=fallback）。
         这是"世界包越完整、开局编译越像失败"的根源 —— 也是一直读到假失败信号的根源。 */
      applied = (rec && Array.isArray(rec.committed) ? rec.committed : [])
        .reduce((s, c) => s + (Number(c && c.applied) || 0), 0);
      dropped = (rec && rec.rejected && rec.rejected.length) || 0;
    } catch (e) { err = String((e && e.message) || e); DEG.hit('opening.js', e); }
  }
  if (!applied) {
    /* v2.08：没落库**有两种完全不同的原因**，原来都记 'fallback'（看起来像 AI 挂了）：
       ① AI 真失败：形状认不出（us 为空）/ 提案被校验器全拒 / 超时；
       ② 世界包已经把该填的都填好了：执行器"只补空槽位"，于是**它无事可做** —— 这不是错误。 */
    const noop = !!(out && us.length > 0 && dropped === 0);
    if (noop) {
      mark(data, 'noop', '世界包已把该填的填好了：' + us.length + ' 条提案没有一条需要写（开局编译无事可做，不是失败）');
    } else {
      const fb = fallback(data);
      if (fb.length) { try { BUS.commit(data, [{ kind: 'update', updates: fb }], { t: data.current.time }); applied = fb.length; } catch (e) { DEG.hit('opening.js', e); } }
      const why = err || (out ? (us.length ? '提案被校验器全数拒绝' : 'AI 返回了内容，但形状认不出（toUpdates 空）') : '超时或空返回');
      mark(data, 'fallback', why);
    }
  } else {
    mark(data, 'ai', '开局编译：' + applied + ' 条落库' + (dropped ? '，' + dropped + ' 条被校验器拒' : ''));
  }
  try { if (out && out.selfcheck) data.current.openingSelfcheck = out.selfcheck; } catch (e) { DEG.hit('opening.js', e); }
  /* ★ v3.15 · **第三步的后半段：世界建立**（用户 2026-09-27：「我的意思你没搞懂吗？」）——
     建档那一步就该把这一局「造出来」，而不是等回合里 AI 偶尔提一句。
     放在这里是因为它是**所有入口的唯一汇合点**（开新局 / 卡盒开局 / AI 生成世界都走 compile）。
     任何异常都不许连累开局：造不出来就是个没有板块的世界，照样能玩。 */
  let created = null;
  try { created = await require('./creator').openingCreate(data, cfg); } catch (eC) { DEG.hit('opening.js:create', eC); }
  return { ok: !!applied, applied: applied, dropped: dropped, why: err || null, selfcheck: (out && out.selfcheck) || null,
    panels: created ? (created.kept || []).length : 0, panelRows: created ? (created.rows || 0) : 0, panelErr: created ? (created.dropped || []).length : 0 };
}

module.exports = { compile, toUpdates, fallback, packet, systemPrompt, done, mark, reset, OPENING_OK, OPENING_MAX_TRIES };
