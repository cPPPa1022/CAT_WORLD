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

/* v2.08 删：OPENING_TIER 常量随之移除 —— 档位没了，开局编译和其他时候一样能力全开，
   不再需要"临时提到 3 档、完了还原"（那两次 setLevel 就是权限日志说谎的来源）。 */
const TIMEOUT_MS = 25000;               // 超时就退回确定性兜底，不让玩家卡在门口

function done(data) { return !!(data && data.meta && data.meta.openingAt); }
function mark(data, how, note) {
  data.meta = data.meta || {};
  data.meta.openingAt = new Date().toISOString();
  data.meta.openingHow = String(how || 'ai');
  if (note) data.meta.openingNote = String(note).slice(0, 160);
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
  return {
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
  return [
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
    '',
    '【权限边界（硬）】',
    '· 你只能改存档里的事物；引擎契约不归你管：不新增字段类型、不写公式与算术、不删任何既有实体。',
    '· 关系一律定性，不许数字、不许等级。',
    '· 身上的东西与通信条件必须与时代和身份自洽：九十年代小镇的普通人不会有大哥大和短信。',
    '· 禁止占位串：待发现 / 未知 / 待接触 / 未定 / 待补全。宁可留空，也不要写这些。',
    '· 判断不了就留空。留空是合法的，编造不是。',
    '',
    '【输出 JSON，只输出 JSON】字段名照抄下面：',
    '{',
    '  player: { fields: { 身份: … }, relations: [ { with: npc1, tone: 房东兼邻居, how: 住了两年 } ],',
    '            contacts: [ { id: npc1, kind: landline, label: 铺子柜台那台 } ] },',
    '  npcs: [ { id: npc1, fields: { 职业: … }, relations: [ { with: npc2, tone: 老邻居 } ] } ],',
    '  world: { fields: { era: …, currency: …, note: 这个世界在讲什么（2~3 句） } },',
    '  framework: [ { slot: rule, name: …, form: enum, items: [ … ], why: … } ],',
    '  selfcheck: { 不该有: 这个人身上有不该有的东西吗, 该有没有: 有该有却没有的东西吗（例如通讯录里没有家人） }',
    '}',
    'framework 是**可选**的：这个世界确实需要一条规则/一个称谓才写，不需要就留空数组。'
  ].join(String.fromCharCode(10));
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
      AI.llmJSON(cfg, [{ role: 'system', content: systemPrompt() }, { role: 'user', content: JSON.stringify(packet(data)) }], () => null, Math.min(4096, AI.cfgMax(cfg))),
      new Promise((res) => setTimeout(() => res(null), TIMEOUT_MS))
    ]);
    out = (r && !r.__fallback) ? r : null;
  } catch (e) { err = String((e && e.message) || e); DEG.hit('opening.js', e); }
  let applied = 0, dropped = 0;
  const us = out ? toUpdates(out, data) : [];
  if (us.length) {
    try {
      const rec = BUS.commit(data, [{ kind: 'update', updates: us }], { t: data.current.time });
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
  return { ok: !!applied, applied: applied, dropped: dropped, why: err || null, selfcheck: (out && out.selfcheck) || null };
}

module.exports = { compile, toUpdates, fallback, packet, systemPrompt, done, mark };
