// game.js — 回合管线：意图解析 → 推进 → 主AI → 校验 → 提交 → 投影
'use strict';
const { getEntity, persons, present, ledgerPush } = require('./store');
const RT = require('./runtime');
const AI = require('./ai');
const PRES = require('./presentation');
const SUB = require('./subai');
const EPOCH = require('./epoch');
const DIR = require('./director');
const SCHED = require('./scheduler');

const PLACE_ALIAS = { 家: 'pl_3', 巷房: 'pl_3', 出租屋: 'pl_3', 杂货铺: 'pl_1', 老茶馆: 'pl_4', 茶馆: 'pl_4', 老街口: 'pl_2', 车站: 'pl_6', 汽车站: 'pl_6' };
// ---------- 旅程计划（计划→买票→上车；城市蓝图=异步任务，到站才物化；可被"封路"中断） ----------

function parseIntent(data, text) {
  const t = (text || '').trim();
  // 动态动作注册表优先（玩家/世界配置的动作先于内置规则）
  const cus = DIR.matchCustom(data, t);
  if (cus) return cus;
  const mSleepTo = t.match(/睡到(\d+)点/);
  if (mSleepTo) return { kind: 'sleep', wakeHour: parseInt(mSleepTo[1], 10) };
  if (/睡觉|去睡|睡了|休息|晚安/.test(t)) return { kind: 'sleep' };
  const mWait = t.match(/等(\d+)分钟?/);
  if (mWait) return { kind: 'skip', minutes: parseInt(mWait[1], 10) };
  const mHour = t.match(/等([0-9两二三四五]+)\s*(?:个?小时|钟头|时辰|上午|下午)/);
  if (mHour) {
    const CN = { 两: 2, 二: 2, 三: 3, 四: 4, 五: 5 };
    const hh = CN[mHour[1]] || parseInt(mHour[1], 10);
    return { kind: 'skip', minutes: Math.min(1440, (hh || 1) * 60) };
  }
  const mGo = t.match(/(?:去|到|前往|返回|回)(杂货铺|老茶馆|老街口|巷房|家|茶馆)/);
  if (mGo) return { kind: 'move', destId: PLACE_ALIAS[mGo[1]], destName: mGo[1] };
  if (/回家/.test(t)) return { kind: 'move', destId: 'pl_5', destName: '家' };
  const mG = t.match(/^(?:去|前往|到|回)([^，。！？、\s]+)$/);
  if (mG) {
    const name = mG[1].trim();
    const place = Object.values(data.entities).find(e => e.type === 'place' && e.name.indexOf(name) >= 0 && e.id !== data.current.sceneId);
    if (place) return { kind: 'move', destId: place.id, destName: place.name };
  }
  if (/买车票|买张票|买票/.test(t)) return { kind: 'travelTicket' };
  if (/(?:出发|上路|动身|上车|走人)\b|我出发|这(?:就|次?)走/.test(t)) return { kind: 'travelGo' };
  if ((/回(?:青石镇|镇上|老家|家)/.test(t)) && String(data.current.sceneId).indexOf('city1_') === 0) return { kind: 'move', destId: 'pl_6', destName: '镇汽车站' };
  const mTravel = t.match(/去(省城|临江|外地|大城市|新城市|城里)/);
  const mDest = t.match(/^(?:我要|我想|打算)?去([^，。！？、\s]{2,6}市?)$/);
  const farDest = (mTravel && mTravel[1]) || (mDest ? mDest[1] : null);
  if (farDest) {
    const known = Object.values(data.entities).some(e => e.type === 'place' && (e.name.indexOf(farDest) >= 0 || e.geo.join('').indexOf(farDest) >= 0));
    if (!known) return { kind: 'travelPlan', dest: farDest };
  }
  if (/发(?:个)?(?:消息|微信|短信|信息)|打电话|电话给|回复(?:他|她)/.test(t)) return { kind: 'msg' };
  const mY = t.match(/(?:跳过|过|等到?|到)(\d{4})年/);
  if (mY) return { kind: 'era', year: parseInt(mY[1], 10) };
  const mD = t.match(/等(\d+)天/);
  if (mD) return { kind: 'skip', minutes: Math.min(43200, parseInt(mD[1], 10) * 1440) };
  if (/看(?:看|一|一下)?(?:窗外|外面|外头|天气|雨)|拉开窗帘|开窗/.test(t)) return { kind: 'peek' };
  if (/听(?:段|一会儿|一会|会儿|一点|点|下)?(?:收音机|广播|新闻)|打开电视|看(?:电视|电视新闻)/.test(t)) return { kind: 'radio' };
  const mBuy = t.match(/^(?:买|来|要|拿)(?:一?|瓶|包|把|盒|袋|个|份)(.+)$/) || t.match(/^(?:买|来|要|拿)([^，。！？、\s]+)$/);
  if (mBuy) {
    const nm = mBuy[1].trim();
    const item = Object.values(data.entities).find(e => e.type === 'item' && (e.at === data.current.sceneId) && (e.name.indexOf(nm) >= 0 || nm.indexOf(e.name) >= 0));
    if (item) return { kind: 'buy', itemId: item.id };
    // 演示世界兼容
    const legacy = { 牛奶: 'it_milk', 水: 'it_milk', 烟: 'it_smoke', 红塔山: 'it_smoke', 雨披: 'it_scarf', 伞: 'it_umbrella' }[nm];
    if (legacy) return { kind: 'buy', itemId: legacy };
  }
  const mSell = t.match(/^(?:卖|出|退)(?:掉|了)?(.+)$/);
  if (mSell) {
    const nm = mSell[1].trim();
    const p = data.entities.player || {};
    const item = (p.inventory || []).find(x => (x.name || '').indexOf(nm) >= 0 || nm.indexOf(x.name || '') >= 0);
    if (item) return { kind: 'sell', itemId: item.id, itemName: item.name };
  }
  if (/道歉|对不起|抱歉|赔罪/.test(t)) return { kind: 'say', apology: true };
  if (/我(?:说|问|告诉)|在吗|早上好|晚上好|谢谢|你好/.test(t)) return { kind: 'say' };
  if (/\?|？|吗|呢|哪|谁|什么|为什么|怎么/.test(t)) return { kind: 'question' };
  return { kind: 'act' };
}

// ---------- 货币（确定性；无赊账） ----------
function playerWallet(data) {
  const p = data.entities.player;
  if (!p) return null;
  if (!p.money) p.money = { cash: 20, digital: 0, spent: 0, earned: 0, currency: '元' };
  return p.money;
}
function tryPay(data, price, what) {
  const w = playerWallet(data);
  if (!w) return { ok: false, shortfall: price };
  const total = (w.cash || 0) + (w.digital || 0);
  if (total < price) return { ok: false, shortfall: price - total };
  // 先电子后现金
  let need = price;
  const fromDig = Math.min(w.digital || 0, need); w.digital -= fromDig; need -= fromDig;
  w.cash -= need;
  return { ok: true };
}
function tryEarn(data, price, what) {
  const w = playerWallet(data);
  if (!w) return { value: price };
  w.cash += price; w.earned += price;
  return { value: price };
}

function resolveWakeTime(nowIso, wakeHour) {
  const d = new Date(nowIso);
  const h = wakeHour != null ? wakeHour : (6 + Math.floor(Math.random() * 3));
  const m = Math.floor(Math.random() * 60);
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= new Date(nowIso).getTime()) d.setDate(d.getDate() + 1);
  return RT.fmtISO(d);
}

function firstNpcId(data) {
  const e = Object.values(data.entities).find(x => x.type === 'person' && x.id !== 'player');
  return e ? e.id : 'npc1';
}

// speaker/actor 解析容错：AI 可能写 npc1 / npc_1 / 名字 → 一律解析成玩家可见的名字
function resolveSpeaker(data, sid) {
  if (!sid) return '';
  if (sid === 'player') return (data.entities.player || {}).name || '你';
  const e = getEntity(data, sid);
  if (e && e.name) return e.name;
  const m = String(sid).match(/(\d+)$/);
  if (m) {
    const byNum = Object.values(data.entities).find(x => x.type === 'person' && x.id.replace(/\D/g, '') === m[1]);
    if (byNum && byNum.name) return byNum.name;
  }
  const byName = Object.values(data.entities).find(x => x.type === 'person' && x.name === String(sid));
  if (byName && byName.name) return byName.name;
  return String(sid);
}

function offlineEvents(data, wakeIso) {
  const ev = [];
  const npcId = firstNpcId(data);
  const phone = (data.meta.carries || {}).time === 'phone';
  if (phone && new Date(wakeIso).getHours() >= 6) {
    ev.push({ from: npcId, to: 'player', body: '醒了没？昨晚雨下得大，店里没事。今晚还来不来？', t: RT.addMinutes(wakeIso, -28), status: 'unread', via: 'phone', offline: true });
  }
  return ev;
}

function applyUpdates(data, updates, nowIso) {
  let applied = 0;
  for (const u of (updates || [])) {
    try {
      if (u.type === '记忆新增') {
        const r = RT.writeMemory(data, { owner: u.owner, content: u.content, tags: u.tags, impact: u.impact, t: u.t || nowIso });
        ledgerPush(data, { t: nowIso, type: '记忆新增', target: u.owner, desc: u.content, ref: r.id });
        applied++;
      } else if (u.type === '记忆激活') {
        const m = Object.values(data.memories).find(x => x.owner === u.target);
        if (m) { m.weight = Math.min(100, m.weight + 8); m.lastActivation = nowIso; m.activations = (m.activations || 1) + 1; applied++; }
      } else if (u.type === '关系变化') {
        const npcId = u.target || 'npc_1';
        if (data.relations.player && data.relations.player[npcId]) { data.relations.player[npcId].tone = u.change; applied++; }
        if (data.relations[npcId] && data.relations[npcId].player) { data.relations[npcId].player.tone = u.change; applied++; }
        ledgerPush(data, { t: nowIso, type: '关系变化', target: npcId, desc: u.change, cause: u.cause || null });
      } else if (u.type === '情绪变化' || u.type === 'NPC状态更新') {
        const e = getEntity(data, u.target);
        if (e) { if (u.to) e.state.mood = u.to; if (u.field && u.to !== undefined) e.state[u.field] = u.to; applied++; }
      } else if (u.type === '人物出现' && u.spawn && u.spawn.name) {
        const sp = u.spawn;
        // 查重：可能是"重复出现"的已知人物（同名 / 同外貌标志）→ 补全已有实体，不新建
        const dup = Object.values(data.entities).find(e => e.type === 'person' && e.id !== 'player' && ((e.name && e.name === String(sp.name).slice(0, 30)) || (sp.appearance && (e.profile || {}).appearance && ((e.profile.appearance.标志物 || '') === sp.appearance && !!sp.name))))
          || Object.values(data.entities).find(e => e.type === 'person' && e.id !== 'player' && sp.appearance && (e.profile || {}).appearance && (e.profile.appearance.标志物 === sp.appearance));
        if (dup) {
          // 同一人：更新已知信息，保留原 id（玩家已认识 TA）
          const prof = dup.profile || (dup.profile = {});
          prof.identity = prof.identity || {}; prof.appearance = prof.appearance || {}; prof.surface = prof.surface || {}; prof.hidden = prof.hidden || {}; prof.background = prof.background || {}; prof.secrets = prof.secrets || {};
          if (sp.name && !prof.identity.姓名) prof.identity.姓名 = String(sp.name).slice(0, 30);
          if (sp.role && !prof.identity.身份) prof.identity.身份 = sp.role;
          if (sp.appearance && !prof.appearance.标志物) prof.appearance.标志物 = String(sp.appearance).slice(0, 40);
          if (sp.surface && !prof.surface.待人) prof.surface.待人 = sp.surface;
          if (sp.hidden && !prof.hidden.真实) prof.hidden.真实 = sp.hidden;
          if (sp.backstory && !prof.background.经历) prof.background.经历 = sp.backstory;
          const imp = ensureImp(data, dup.id);
          if (imp.nameKnown && sp.name && imp.nameKnown !== sp.name && imp.stage < 3) imp.stage = 3;
          ledgerPush(data, { t: nowIso, type: '人物出现', target: dup.name, desc: ('又见到了 ' + (dup.name || sp.name) + (u.cause ? '——' + u.cause : '')), cause: u.cause || null });
          applied++;
        } else {
        const npcId = data.id('npc');
        data.entities[npcId] = { id: npcId, type: 'person', name: String(sp.name).slice(0, 30), avatar: null, tags: [sp.name, '新面孔'], indexes: { geo: [], org: [], family: [] },
          profile: { identity: { 姓名: sp.name, 身份: sp.role || '（来历未知）' }, appearance: { 标志物: sp.appearance || '' }, surface: { 待人: sp.surface || '（待相处）' }, hidden: { 真实: sp.hidden || '（未知）' }, background: { 经历: sp.backstory || '' }, schedule: {}, desires: { 现在想: sp.desire || '' }, secrets: { 包袱: '（未知）' } },
          locked: { core: '性格内核（运行时生成）' }, state: { location: data.current.sceneId, mood: '平静', fatigue: '中', hunger: '低', sleep: '正常' }, trait: { lambda: 0.06, memory: '普通' } };
        data.relations['player'] = data.relations['player'] || {};
        data.relations['player'][npcId] = { tone: u.relation || '初识', causes: [u.cause || '（新人物出现）'] };
        data.relations[npcId] = { player: { tone: u.relation || '初识', causes: [u.cause || ''] } };
        if (u.relationToKnown) { const k = Object.values(data.entities).find(e => e.type === 'person' && e.id !== 'player' && e.name === u.relationToKnown); if (k) { data.relations[npcId][k.id] = { tone: '（你发现的关系）', causes: [] }; data.relations[k.id] = data.relations[k.id] || {}; data.relations[k.id][npcId] = { tone: '（TA 之间似乎认识）', causes: [] }; } }
        if (!data.knowledge.knownPeople.includes(npcId)) { data.knowledge.knownPeople.push(npcId); }
        ensureImp(data, npcId);
        data.impressions[npcId].stage = 1; data.impressions[npcId].seen = sp.appearance || '一个陌生面孔'; data.impressions[npcId].nameKnown = sp.name;
        ledgerPush(data, { t: nowIso, type: '人物出现', target: sp.name, desc: (sp.name + ' 出现' + (u.cause ? '——' + u.cause : '')), cause: u.cause || null });
        applied++;
        }
      } else if (u.type === '印象更新') {
        const imp = ensureImp(data, u.target);
        const npc = getEntity(data, u.target) || {};
        if (u.note) {
          const note = String(u.note).slice(0, 60);
          // 去重：同内容或高度相似不重复追加；限长：notes 最多 6 / traits 最多 6（旧的先丢）
          if (!imp.notes.some(n => n === note || (note.length > 6 && n.indexOf(note.slice(0, 6)) >= 0) || (n.length > 6 && note.indexOf(n.slice(0, 6)) >= 0))) {
            imp.notes.push(note); if (imp.notes.length > 6) imp.notes.shift();
            const tr = String(u.note).slice(0, 30);
            if (!imp.traits.some(t => t === tr || (tr.length > 6 && t.indexOf(tr.slice(0, 6)) >= 0))) { imp.traits.push(tr); if (imp.traits.length > 6) imp.traits.shift(); }
          }
        }
        imp.nameKnown = npc.name || imp.nameKnown;
        if (imp.stage < 3) imp.stage = 3;
        applied++;
      } else if (u.type === '事件开始' || u.type === '事件结束') {
        ledgerPush(data, { t: nowIso, type: u.type, target: u.target, desc: '事件: ' + u.target, cause: u.cause || null });
        applied++;
      } else if (u.type === '物品获取') {
        const p = data.entities.player;
        if (p) { p.inventory.push({ id: data.id('item'), name: u.item || '物品' }); applied++; }
      } else if (u.type === '地点变化') {
        if (u.to && data.entities[u.to]) { data.current.sceneId = u.to; const p = data.entities.player; if (p) p.state.location = u.to; applied++; }
      }
    } catch (e) { console.error('[apply]', e.message); }
  }
  return applied;
}

// 存量清洗：把历史场景日志里 id 形态的 speaker 一次性重写成真名（幂等）
// 组装：角色回执 → 替换/插入该角色 beat（首轮必写=兜底；空回=保留原稿，零缺口）
function mergeActorInto(frame, d) {
  try {
    if (!frame || !Array.isArray(frame.beats)) return frame;
    const who = d.who, line = String(d.line || ''), action = String(d.action || '');
    const idx = frame.beats.findIndex(b => b && b.speaker === who);
    if (idx >= 0) {
      if (line) frame.beats[idx].text = line;
      if (action && frame.beats[idx].type === 'dialogue') frame.beats[idx].text = ('（' + action + '）' + frame.beats[idx].text);
    } else if (line) {
      frame.beats.push({ type: 'dialogue', speaker: who, tone: '', text: line });
    }
    return frame;
  } catch (e) { return frame; }
}

function scrubSceneLog(data) {
  const idRE = /^[a-z]+_?\d+$/;
  for (const l of (data.sceneLog || [])) {
    if (!l) continue;
    if (l.speaker && idRE.test(String(l.speaker))) {
      const r = resolveSpeaker(data, l.speaker);
      l.speaker = idRE.test(String(r)) ? '？' : r;
    }
    if (l.speakerName && idRE.test(String(l.speakerName))) l.speakerName = l.speaker;
  }
}

async function runTurn(data, text, cfg, opts) {
  scrubSceneLog(data);
  const intent = parseIntent(data, text);
  const before = data.current.time;
  let newTime = before;
  const via = PRES.mainVia(data);
  const ctx = { intent, action: text };
  let offline = [];

  if (intent.kind === 'sleep') {
    newTime = resolveWakeTime(before, intent.wakeHour);
    offline = offlineEvents(data, newTime);
    for (const ev of offline) data.messages.push(Object.assign({ id: data.id('msg') }, ev));
  } else if (intent.kind === 'skip') {
    newTime = RT.addMinutes(before, Math.max(1, Math.min(1440, intent.minutes || 10)));
  } else if (intent.kind === 'move') {
    const c = RT.moveCost(data, data.current.sceneId, intent.destId, before);
    if (c.ok) {
      ctx.move = c;
      newTime = RT.addMinutes(before, c.minutes);
      data.current.sceneId = intent.destId;
      data.current.ambientDone = false;
      data.entities.player.state.location = intent.destId;
      if (!data.knowledge.visited.includes(intent.destId)) data.knowledge.visited.push(intent.destId);
      const dest = getEntity(data, intent.destId);
      if (dest && !data.knowledge.knownPlaces.includes(intent.destId)) data.knowledge.knownPlaces.push(intent.destId);
      // 感知插件：进屋=没看外面；室外=天然知道
      data.current.weatherSeen = !(dest && (dest.tags || []).includes('室内')) ? true : false;
    } else {
      newTime = RT.addMinutes(before, 2);
      ctx.move = { ok: false, err: c.err };
    }
  } else if (intent.kind === 'travelPlan' || intent.kind === 'travelTicket' || intent.kind === 'travelGo') {
    // 旅程管线：计划卡（零生成）→ 车票（票价校验=30）→ 上车（异步任务入队，到站才物化）
    data.plans = data.plans || [];
    const cur = data.plans.filter(p => p.status === 'planned' || p.status === 'aboard').slice(-1)[0];
    newTime = RT.addMinutes(before, 2);
    if (intent.kind === 'travelPlan') {
      const dest = String(intent.dest || '远方');
      data.plans.push({ id: data.id('trv'), dest: dest, purpose: '', mode: '班车', status: 'planned', ticket: false, createdAt: before });
      ctx.opLog = '（你的计划：坐班车去' + dest + '——先到镇汽车站买票）';
    } else if (intent.kind === 'travelTicket') {
      if (!cur || cur.status !== 'planned') ctx.opLog = '（你还没有明确的出行计划——想说"去XX"才行）';
      else if (data.current.sceneId !== 'pl_6') ctx.opLog = '（买票要去镇汽车站——老街口过去几分钟）';
      else {
        const ok = tryPay(data, 30, '车票');
        if (ok.ok) { cur.ticket = true; cur.departsAt = RT.addMinutes(before, 10); ctx.opLog = '（你买好了去' + cur.dest + '的车票——30块，10分钟后发车）'; }
        else ctx.opLog = '（你摸遍口袋，差' + (ok.shortfall || 0) + '块——票钱30）';
      }
    } else {
      if (!cur || cur.status !== 'planned' || !cur.ticket) ctx.opLog = '（还没有票——先去镇汽车站买票；或者你根本没计划，想说"去XX"）';
      else {
        cur.status = 'aboard'; cur.boardingAt = before;
        data.current.pendingBuilds = data.current.pendingBuilds || [];
        data.current.pendingBuilds.push({ id: data.id('bld'), planId: cur.id, dest: cur.dest, due: RT.addMinutes(before, 8 * 60), built: false, created: before });
        data.current.sceneId = 'pl_6'; data.entities.player.state.location = 'pl_6';
        ctx.opLog = '（你登上了开往' + cur.dest + '的班车——灰扑扑的车厢，窗外的田野。大约8小时后到）';
        newTime = RT.addMinutes(before, 5);
      }
    }
  } else if (intent.kind === 'era') {
    // 时代跳跃：直接到 X 年 1 月 1 日；回不去的年份只当过了一小时
    const ny = Math.max(1997, intent.year || 2026);
    const curY = parseInt(before.slice(0, 4), 10);
    newTime = ny > curY ? (String(ny) + '-01-01T08:00:00') : RT.addMinutes(before, 60);
  } else if (intent.kind === 'peek' || intent.kind === 'radio') {
    // 感知插件（确定性）：看窗外→weatherSeen；听新闻→heardNews。玩家"知道什么"由代码管
    newTime = RT.addMinutes(before, 2);
    if (intent.kind === 'peek') {
      if (PRES.canSeeWeather(data)) { data.current.weatherSeen = true; ctx.opLog = '你走过去看了看外面——' + (data.current.weather || '晴'); }
      else ctx.opLog = '你找了一圈，屋里没有窗户，只听到雨点打在别处的声响';
    } else if (PRES.canRadio(data)) {
      const fresh = data.news.filter(n => !(data.knowledge.heardNews || []).includes(n.id));
      if (fresh.length) { data.knowledge.heardNews = data.knowledge.heardNews || []; data.knowledge.heardNews.push(fresh[0].id); ctx.opLog = '你听了一会儿——「' + fresh[0].title + '」'; }
      else ctx.opLog = '你听了一会儿，都是听过的旧消息';
    } else {
      ctx.opLog = '你找了找，屋里没有收音机';
    }
  } else {
    newTime = RT.addMinutes(before, (/msg|buy/.test(intent.kind)) ? 3 : 2);
  }
  // 副 AI-摘要：睡眠跳跃时生成"不在场简报"（接入模式走 LLM；演示用离线消息文案）
  if (intent.kind === 'sleep') ctx.digestText = await SUB.subDigest(data, cfg, before);
  data.current.time = newTime;
  RT.tickNPCs(data, newTime);
  RT.decayMemories(data, newTime);
  data.current.turnN = (data.current.turnN || 0) + 1;
  try { AI.statMarkCallStart(); } catch (e) { }
  // ---------- 动态调度：due 任务并发（演算/镜头外/候选 走调度器；消息/旅程/新闻仍按各自回调并行） ----------
  const schedRun = await SCHED.schedulerRun(data, cfg, newTime, { sleeping: intent.kind === 'sleep' });
  const schedCalc = (schedRun[2] || {}).detail || {};
  data.current.pendingCandidates = data.current.pendingCandidates || [];
  for (const c of ((schedCalc.candidates) || [])) {
    if (!c || !c.text || data.current.pendingCandidates.some(x => x.text === c.text)) continue;
    data.current.pendingCandidates.push({ id: data.id('cand'), text: c.text, type: c.type || '事件', expireAt: RT.addMinutes(newTime, (c.expireM || 60)), sev: c.sev || '低' });
  }
  const epochOut = (schedRun[0] || {}).detail ? (schedRun[0].detail.settled || []) : [];
  const offstageOut = (schedRun[1] || {}).conclusion ? [schedRun[1].conclusion] : [];
  const [delivered, editOut, travelOut] = await Promise.all([
    deliverPendingReplies(data, cfg, newTime),
    SUB.subEdit(data, cfg, newTime),
    travelTick(data, cfg, newTime)
  ]);
  if (travelOut && travelOut.length) ctx.opLog = (ctx.opLog ? ctx.opLog + '；' : '') + travelOut.join('；');
  if (delivered.length) {
    ctx.opLog = (ctx.opLog ? ctx.opLog + '；' : '') + delivered.map(d => (d.body ? ('收到' + resolveSpeaker(data, d.from) + '的回复：' + d.body) : (resolveSpeaker(data, d.from) + '看了消息，没有回'))).join('；');
  }
  if (epochOut && epochOut.length) {
    ctx.opLog = (ctx.opLog ? ctx.opLog + '；' : '') + '『世界变化』' + epochOut.slice(0, 3).join('；');
  }
  // 接力链示例：消息AI 完成 → 热词判定 → 派给 news 生成器（payload 交代消息全文/双方/时间）
  const HOT = /火|着|偷|警|炸|死|救|抓|事发|出事|完蛋/;
  const hotMsg = delivered.find(d => (d.msgs || []).join('').match(HOT) || (d.body && HOT.test(d.body)));
  if (hotMsg) {
    try {
      const routed = await DIR.routeRequests(data, cfg, [{ kind: 'news', need: '把这件事变成镇上的谈资', hint: '市井传闻', payload: { text: (hotMsg.msgs || []).join('；') || hotMsg.body || '', from: hotMsg.from, t: hotMsg.t } }]);
      for (const rr of routed) if (rr && rr.name) ctx.opLog = (ctx.opLog ? ctx.opLog + '；' : '') + '（街坊都在传：' + rr.name + '）';
    } catch (e5) { }
  }
  if (offstageOut && offstageOut.length) {
    ctx.offstage = offstageOut;
    ctx.opLog = (ctx.opLog ? ctx.opLog + '；' : '') + '（你不在场时：' + offstageOut.join('；') + '）';
  }
  if (editOut && editOut.length) {
    for (const n of editOut) if (n && n.title && !data.news.some(x => x.title === n.title)) data.news.push(Object.assign({ id: data.id('new'), t: newTime, tags: n.tags || [], region: n.region || '', severity: n.severity || '低', impact: n.impact || { 时长: '短期', 范围: '本地' } }, n));
  }

  // ---------- 副 AI-计算：并发解耦——不挡主 AI（本回合用已有候选；新候选回合末产出，下回合生效） ----------
  const candidates = RT.genCandidates(data);
  const scene = getEntity(data, data.current.sceneId) || {};
  const sceneTags = (scene.tags || []).concat([data.current.weather, '便利店']);
  ctx.memories = RT.funnelMemories(data, 'player', sceneTags, 4).concat(RT.funnelMemories(data, firstNpcId(data), sceneTags, 4));
  ctx.candidates = candidates;
  ctx.offlineMsgs = offline;
  ctx.destId = intent.destId;
  ctx.destName = intent.destName;
  ctx.msgReply = null;
  ctx.itemId = intent.itemId;
  if (intent.kind === 'msg') {
    ctx.msgReply = AI.mockReply(data, text, firstNpcId(data));
    data.messages.push({ id: data.id('msg'), from: 'player', to: 'npc_1', body: text, t: before, status: 'sent', via });
    data.messages.push({ id: data.id('msg'), from: 'npc_1', to: 'player', body: ctx.msgReply && ctx.msgReply.body ? ctx.msgReply.body : null, t: RT.addMinutes(before, 3), status: ctx.msgReply && ctx.msgReply.body ? 'replied' : 'read', via });
  }
  // ---------- 动态动作（customActions：确定性 effects 执行） ----------
  if (intent.kind === 'custom' && intent.action) {
    const fxs = DIR.applyCustom(data, intent.action, cfg, newTime);
    ctx.custom = { id: intent.customId, effects: fxs };
    ctx.opLog = (ctx.opLog ? ctx.opLog + '；' : '') + '（' + fxs.join('；') + '）';
  }
  // ---------- 交易（确定性；账本 + 余额；世界不赊账） ----------
  if (intent.kind === 'buy' && intent.itemId) {
    const it = getEntity(data, intent.itemId);
    const price = it ? (it.price || 0) : 0;
    const afford = tryPay(data, price, it ? it.name : '东西');
    ctx.trade = { ok: afford.ok, price, item: it ? it.name : '东西', shortfall: afford.shortfall, err: afford.err };
    if (afford.ok) {
      // 物品进包（item 实体在场时移除/标记购买）
      if (it) it.bought = (it.bought || 0) + 1;
      const p = data.entities.player;
      if (p && price > 0) p.inventory.push({ id: data.id('item'), name: it.name, can: '', value: it.price || 0 });
      else if (p && !price) p.inventory.push({ id: data.id('item'), name: it.name, can: '', value: 0 });
      // 换机：买的设备（swapDevice）→ 玩家随身设备更新（工具 app 随型号走）
      if (it && it.swapDevice && p) {
        data.current.device = Object.assign({}, it.swapDevice);
        const oldDev = p.inventory.find(x => /大哥大|诺基亚|手机/.test(x.name || '') && x.id !== it.id && !x.swapped);
        if (oldDev) { oldDev.swapped = true; oldDev.name = '旧' + oldDev.name; }
        ctx.opLog = (ctx.opLog ? ctx.opLog + '；' : '') + '你换上了一部' + it.name;
      }
      ledgerPush(data, { t: newTime, type: '物品获取', target: 'player', desc: '买入 ' + it.name + '（' + price + '）', cause: '交易', scene: data.current.sceneId });
      if (it && it.price && data.entities.player && data.entities.player.money) data.entities.player.money.spent += price;
    } else {
      ledgerPush(data, { t: newTime, type: '交易拒绝', target: 'player', desc: '余额不足购买 ' + (it ? it.name : '物品'), cause: '余额不足', scene: data.current.sceneId });
    }
    ctx.tradeDone = true;
  } else if (intent.kind === 'sell' && intent.itemId) {
    const p = data.entities.player;
    const ix = (p && p.inventory || []).findIndex(x => x.id === intent.itemId);
    if (ix >= 0) {
      const item = p.inventory[ix];
      const price = item.value != null ? item.value : (item.price || 2);
      const got = tryEarn(data, price, item.name);
      p.inventory.splice(ix, 1);
      ctx.trade = { ok: true, price: got.value, item: item.name };
      ledgerPush(data, { t: newTime, type: '物品消耗', target: 'player', desc: '卖出 ' + item.name + '（' + got.value + '）', cause: '交易', scene: data.current.sceneId });
    } else {
      ctx.trade = { ok: false, item: intent.itemName || '东西', err: '没带在身上' };
      ledgerPush(data, { t: newTime, type: '交易拒绝', target: 'player', desc: '卖出失败（没带在身上）', cause: '物品不在', scene: data.current.sceneId });
    }
  }

  let out;
  if (AI.isLive(cfg)) {
    const messages = [
      { role: 'system', content: AI.SYSTEM(data, cfg) + '\n' + AI.moduleFor(intent.kind) },
      { role: 'user', content: AI.packetFor(data, ctx) }
    ];
    // 动态思考档位：0 token 打分（多方在场/极端冲突/关系张力/离线积压/上回合打回）
    const think = AI.thinkBudget(data, intent, ctx, !!(data.current && data.current._hardLast));
    if (ctx) ctx.think = think;
    out = await AI.llmJSON(cfg, messages, () => AI.mockMain(data, ctx), Math.min(8192, AI.cfgMax(cfg)), (opts && opts.onDelta) || undefined, think);
    if (out && out.__fallback) out = out.value;
    // ---- 叙事主权闭环：现实化/说教检测命中 → 带重写要求重试一次（仅一次，不循环） ----
    const guardHit = (out && !out.__fallback) ? AI.guardCheck(out) : null;
    if (guardHit) {
      try {
        console.log('[guard] 命中 ' + guardHit.join('/') + ' → 重写一轮');
        messages.push({ role: 'user', content: '【重写要求】上一版出现「' + guardHit.join('、') + '」——以现实视角介入或说教式处理，违反叙事主权（虚构内容按世界规则演进，不作现实道德裁决，不解释、不道歉）。请完全以本世界观重写，只输出最终 JSON。' });
        const outR = await AI.llmJSON(cfg, messages, () => null, Math.min(8192, AI.cfgMax(cfg)), (opts && opts.onDelta) || undefined, (think === 'none' ? 'medium' : 'high'));
        if (outR && !outR.__fallback && outR.frame) out = outR;
      } catch (e) { }
    }
    // ---- requests（世界导演）：罕见 → 回执 → 二轮整合（保留） ----
    const reqs = (out && out.requests && out.requests.length) ? out.requests : (out && out.summon ? [out.summon] : null);
    if (reqs) {
      try {
        const routed = await DIR.routeRequests(data, cfg, reqs);
        if (routed && routed.length && routed.some(r => r.name || r.id)) {
          const recap = routed.map(r => (r.name || r.note || r.kind)).filter(Boolean).slice(0, 4).join('；');
          messages.push({ role: 'user', content: '【工具回执】' + recap + '（已入库，可用名字引用）。请利用它们一次性输出最终 frame/updates（不要再调用工具）。' });
          const out2 = await AI.llmJSON(cfg, messages, () => null, Math.min(8192, AI.cfgMax(cfg)), undefined, 'medium');
          if (out2 && !out2.__fallback && out2.frame) out = out2;
        }
      } catch (e5) { }
    }
    // ---- 生图导演笔记（A 步：登记任务；B 步 server 接 ComfyUI 出图）----
    // 开关必须在**登记端**也拦一次：只在 server 端拦的话，主 AI 仍会输出 img、任务仍会登记、
    // 前端仍会画出一堆"永远填不满的图位"（用户实测：关了生图还是有 img 块）。
    if (cfg.image && cfg.image.enabled && out && Array.isArray(out.img) && out.img.length) {
      try {
        const beatCount = ((out.frame && out.frame.beats) || []).length;
        const picks = [];
        for (let ii = 0; ii < Math.min(2, out.img.length); ii++) {
          const im = out.img[ii] || {};
          const whoArr = Array.isArray(im.who) ? im.who : (im.who ? [im.who] : []);
          const okWho = whoArr.filter(id => (data.knowledge.knownPeople || []).includes(id)); // 名字门控：见过的才画
          if (!okWho.length && whoArr.length) continue; // 全是没见过的 → 跳过
          const at = (im.at != null && Number(im.at) >= 0 && Number(im.at) < beatCount) ? Number(im.at) : null; // at 必须指到本回合 beat，否则不进叙事流
          picks.push(Object.assign({}, im, { who: okWho, at: at }));
        }
        // 剧情里新冒出来的人没有九维档案，而 scheduler 的原则是"无锚点人物绝不写人貌"——
        // 不先补档，这一张图只会画成没有人的空场景。补档只发生在**每个人第一次被画**时，之后 0 成本。
        // 多人并行补，避免串行叠加等待。
        const need = [...new Set(picks.flatMap(x => x.who || []))]
          .filter(id => { const e = data.entities[id]; return e && e.type === 'person' && nineFilled(e) < 4; });
        if (need.length && AI.isLive(cfg)) {
          try { await Promise.all(need.map(id => genProfile(data, id, cfg).catch(() => null))); } catch (e2) { }
        }
        // 记下**拍摄时的场景 id**：舞台选图要按它匹配，否则离开这个场景后还会一直挂着这张图
        for (const pk of picks) await SCHED.dispatch(data, cfg, 'image', { img: Object.assign({}, pk, { sceneId: data.current.sceneId }) });
      } catch (e) { }
    }
    // ---- delegate（角色委派·极稀缺）：主AI首轮(流式)完成后 → 并行 actor（3-6s）→ 组装替换/插入；无二轮 ----
    // 容错：actor 空回 → 保留主AI首轮已写的该角色台词（兜底成片，零缺口）
    if (out && out.delegate && out.delegate.who) {
      try {
        const act = await SCHED.dispatch(data, cfg, 'actor', { npcId: out.delegate.who, context: (data.sceneLog || []).slice(-2).map(l => String(l.text || '')).join('。') });
        if (act && act.detail && (act.detail.line || act.detail.action)) {
          out.frame = mergeActorInto(out.frame, act.detail);
        }
      } catch (e6) { }
    }
  } else {
    out = AI.mockMain(data, ctx);
  }
  if (!out || !out.frame) out = AI.mockMain(data, ctx);

  const v = RT.validateUpdates(data, out.updates || [], out.frame || {}, ctx);
  let allowedU = v.allowed;
  if (ctx.tradeDone && ctx.trade) {
    // 交易已由运行时写库存与账本：AI 再输出同一物品获取/消耗 → 过滤防重复
    allowedU = allowedU.filter(u => !((u.type === '物品获取' || u.type === '物品消耗') && u.item && u.item === ctx.trade.item));
    if (intent.kind === 'sell') allowedU = allowedU.filter(u => !(u.type === '物品消耗' && u.target === 'player' && !u.item));
  }
  // ── 动态维度 → 刚性锚点的**沉淀** ──
  // 某个 dynamic 维度连续 N 轮指向同一结果，说明它已不是"临时状态"而是**永久特征**
  // （**剪了头发** ≠ **今天头发湿了**）。沉淀后写进 nine（锚点），并从 dynamic 摘掉。
  // 跟"注记晋升为实体"是同一个模式。
  // 注意：只有 发型/衣着/配饰 参与沉淀；**表情/状态本质上就是临时的，永远不该进锚点**。
  try { sedimentDynamic(data, newTime); } catch (e0) { }
  // 动态视觉追踪：视觉变化（衣/发/妆/饰/体态状态句）→ 对应人物 profile.visual.dynamic（生图用实时状态；维度字典）
  try {
    for (const u of (allowedU || [])) {
      if (!u || !u.target || u.target === 'player') continue;
      const c = String(u.content || '');
      if (c && /衣|裙|鞋|袜|发|妆|帽|伞|领|链|手饰|外套|袍|裤|丝|露|湿|汗|泪|绷带|伤口/.test(c)) {
        const ent = data.entities[u.target];
        const vis = ((ent || {}).profile || {}).visual;
        if (!vis) continue;
        if (!vis.dynamic) vis.dynamic = {};
        const dyn = vis.dynamic;
        // 维度归类：发型/衣着/配饰/状态（旧{时间:句}快照迁移为"状态"）
        if (!Array.isArray(dyn._hist)) dyn._hist = [];
        const dim = /发|刘海|马尾|髻|辫|发色|发型/.test(c) ? '发型' : (/衣|裙|罩|衫|袍|裤|袜|鞋|靴|帽|袖|领|链|手饰|围巾/.test(c) ? '衣着' : (/妆|饰|伞|包/.test(c) ? '配饰' : '状态'));
        if (dyn[dim] && dyn[dim] !== c) dyn._hist.push(dim + (dyn[dim] || '').slice(0, 12));
        dyn[dim] = c.slice(0, 60);
        // 稳定性计数：值变了就重新从 1 开始（连续 N 轮不变才会沉淀进锚点）
        vis.dynaStable = vis.dynaStable || {};
        { const st = vis.dynaStable[dim]; if (!st || st.v !== dyn[dim]) vis.dynaStable[dim] = { v: dyn[dim], n: 1 }; }
        dyn._hist = dyn._hist.slice(-10);
        if (Object.keys(dyn).length > 14) { for (const k of Object.keys(dyn)) if (k !== '_hist' && k !== dim && typeof dyn[k] === 'string' && /^\d{1,2}:\d{2}$/.test(k)) delete dyn[k]; }
      }
    }
  } catch (e) { }
  // 世界导演：任何岗位 AI 的"创造请求"（主AI requests/summon 兼容；≤1条/回合，按 kind 路由生成器）
  const reqs = (out.requests && out.requests.length ? out.requests : null) || (out.summon ? [out.summon] : null);
  if (reqs) {
    try {
      const routed = await DIR.routeRequests(data, cfg, reqs);
      for (const rr of routed) if (rr && rr.name) ctx.opLog = (ctx.opLog ? ctx.opLog + '；' : '') + '（新出现：' + rr.name + '）';
    } catch (e4) { }
  }
  const applied = applyUpdates(data, allowedU, newTime);

  // ---------- 场景画：唯一来源=引擎程序大图（画内交互/布局缓存）；AI 不再提供画（防指令打架） ----------
  if (data.current.sceneArtAI) delete data.current.sceneArtAI; // 残留旧 AI 画一次性清除

  // 场景日志（限长 30）
  const line = function (type, text2, speaker, tone) { return { t: newTime, type, speaker, tone, text: text2 }; };
  data.sceneLog = data.sceneLog || [];
  const spanStart = data.sceneLog.length;
  data.sceneLog.push(line('user-action', '你: ' + text));
  if (out.frame.tag) {
    const last = data.sceneLog[data.sceneLog.length - 1];
    if (!(last && last.type === 'stage-tag' && last.text === out.frame.tag)) data.sceneLog.push(line('stage-tag', out.frame.tag));
  }
  const hasTag = data.sceneLog.length > spanStart + 1 && data.sceneLog[spanStart + 1] && data.sceneLog[spanStart + 1].type === 'stage-tag';
  const beatsStart = spanStart + 1 + (hasTag ? 1 : 0);
  for (const b of (out.frame.beats || [])) {
    const nm = b.speaker ? resolveSpeaker(data, b.speaker) : '';
    data.sceneLog.push({ t: newTime, type: b.type, speaker: nm, tone: b.tone, text: b.text });
  }
  // 生图定位：本回合 beats 在 sceneLog 中的 span（img 任务的 at 对应其中序号；buildView 依此挂图）
  const beatsLen = (out.frame.beats || []).length;
  if (beatsLen > 0) data.current._imgBeatSpan = { start: beatsStart, count: beatsLen, t: newTime };
  else delete data.current._imgBeatSpan;
  if (data.sceneLog.length > 200) data.sceneLog = data.sceneLog.slice(-200);

  let view2;
  const fresh = { kind: intent.kind, destName: intent.destName, offline: offline.length };
  let rawOpts = (out.frame && out.frame.options) || null;
  if (Array.isArray(rawOpts)) {
    rawOpts = rawOpts.map(o => (typeof o === 'string' ? o : ((o && (o.label || o.text || o.title)) || String(o)))).filter(Boolean).slice(0, 6);
  } else { rawOpts = null; }
  data.current.lastOptions = rawOpts;
  try { updateImpressions(data, out.frame, v.allowed); } catch (e) { }
  // 身世回想：剧情/对话命中「隐约记得」→ 想起 + 写入记忆/日志
  const recalled = recallCheck(data, [text, '你']
    .concat((out.frame && out.frame.beats || []).map(b => b.text || ''))
    .concat((data.sceneLog || []).slice(-3).map(l => (l.text || '') + ' ' + ((l.speakerName) || (l.speaker) || ''))),
    present(data, data.current.sceneId).filter(p => p.id !== 'player').map(p => p.id));
  const tutorHint = advanceTutorial(data);
  view2 = buildView(data);
  view2.reaction = buildReaction(data, v.allowed) + (tutorHint ? ('　★' + tutorHint) : '');
  return { intent, frame: out.frame, errors: v.errors, applied, fresh, recalled: recalled || [], view: view2 };
}

// ---------- 消息异步回复（§9：物理运行时算"何时回"，消息 AI 判"回不回/回什么"，到期才生成） ----------
async function sendMessage(data, toId, text, cfg) {
  const target = getEntity(data, toId);
  if (target && target.state && target.state.alive === false) return { reply: null, status: 'dead', view: buildView(data) };
  const now = data.current.time;
  const via = PRES.mainVia(data);
  data.knowledge = data.knowledge || {}; data.knowledge.phoneContacts = data.knowledge.phoneContacts || [];
  if (!data.knowledge.phoneContacts.includes(toId)) data.knowledge.phoneContacts.push(toId); // 主动发消息=存了号码
  data.messages.push({ id: data.id('msg'), from: 'player', to: toId, body: text, t: now, status: 'sent', via });
  // 回复计划：何时能看到/回（忙/夜里/连发→更晚），由插件确定性推导
  data.current.pendingReplies = data.current.pendingReplies || [];
  const myPend = data.current.pendingReplies.filter(p => p.from === toId).length + 1;
  const plan = RT.replyPlan(data, toId, now, myPend);
  data.current.pendingReplies.push({ id: data.id('rep'), from: toId, to: 'player', due: plan.due, plan: 'reply' });
  data.current.time = RT.addMinutes(now, 2);
  RT.tickNPCs(data, data.current.time);
  const v = buildView(data);
  v.msgReplyAt = plan.due.slice(5, 16).replace('T', ' ');
  return { reply: null, status: 'sent', view: v };
}

// 到期投递：世界时间到达计划时刻 → 生成回复（live=消息 AI；demo=mock）+ 写消息/状态
// 旅程 tick：班车途中（中断概率+到站物化）——世界时间驱动，异步无感
async function travelTick(data, cfg, nowISO) {
  const out = [];
  const plans = data.plans || [];
  const builds = (data.current.pendingBuilds = data.current.pendingBuilds || []);
  for (const pb of builds.slice()) {
    const plan = plans.find(p => p.id === pb.planId);
    if (!plan || plan.status !== 'aboard') { builds.splice(builds.indexOf(pb), 1); continue; }
    // 中断（事出有因：雨灾封路，概率小且在发车1小时后才可能发生）
    if (!pb.blocked && new Date(nowISO).getTime() > new Date(RT.addMinutes(pb.created || nowISO, 60)).getTime() && Math.random() < 0.06) {
      pb.blocked = true; plan.status = 'blocked'; plan.blockReason = '前方雨势过大，列车在半路停了，广播让大家等待';
      data.current.sceneId = 'pl_6'; data.entities.player.state.location = 'pl_6';
      data.sceneLog.push({ t: nowISO, type: 'narration', text: '列车在荒站停了两小时。广播通了：前方雨势过大，道路封闭，班车折返。' });
      out.push('你的班车被雨截住了——折返回了镇汽车站（改天再走）；');
      builds.splice(builds.indexOf(pb), 1);
      continue;
    }
    if (new Date(nowISO).getTime() >= new Date(pb.due).getTime() && !pb.built) {
      // 到站：物化城市蓝图（第一次到才生成；失败回退代码池）
      pb.built = true;
      let cityName = '临江市';
      try {
        const r = await DIR.routeRequests(data, cfg, [{ kind: 'city', need: '把' + pb.dest + '从计划变成一座城', hint: '旅途终点', payload: { dest: pb.dest, plan: plan } }], 2);
        if (r && r.length && r[0].name) cityName = String(r[0].name);
      } catch (e) { }
      plan.status = 'done'; plan.arrivedAt = nowISO;
      data.current.sceneId = 'city1_p1'; data.entities.player.state.location = 'city1_p1';
      const kp = data.knowledge.knownPlaces || (data.knowledge.knownPlaces = []);
      if (kp.indexOf('city1_p1') < 0) kp.push('city1_p1');
      data.sceneLog.push({ t: nowISO, type: 'stage-tag', text: '[站前街 · 到站]' });
      data.sceneLog.push({ t: nowISO, type: 'narration', text: '列车到站了。' + cityName + '的空气比家里潮，站前街挤着卖早点、拉客的、问路的——你踏上了这座城。' });
      out.push('列车到站：' + cityName + '（站前街）——子地点/NPC 已就绪：' + Object.keys(data.entities).filter(k => k.indexOf('city1_') === 0).length + ' 个单位');
      builds.splice(builds.indexOf(pb), 1);
    }
  }
  return out;
}

// 到期投递：多条到期=多个独立需求 → 并发请求（同一 API 下多请求并行，按 NPC 拆）
async function deliverPendingReplies(data, cfg, nowISO) {
  // 已故之人的消息不再回复；到期任务 → 调度器的 reply 能力（动态调度入口）
  const deadIds = Object.values(data.entities).filter(x => x.type === 'person' && x.state && x.state.alive === false).map(x => x.id);
  data.current.pendingReplies = (data.current.pendingReplies || []).filter(p => deadIds.indexOf(p.from) < 0);
  const due = RT.dueReplies(data, nowISO);
  if (!due.length) return [];
  const out = [];
  for (const p of due) {
    const sentMsgs = (data.messages || []).filter(m => m.from === 'player' && m.to === p.from && m.status === 'sent').slice(-5);
    const r = await SCHED.dispatch(data, cfg, 'reply', { npcId: p.from, msgs: sentMsgs, due: p.due });
    if (r && r.detail) out.push(Object.assign({ from: p.from, msgs: sentMsgs.map(m => m.body) }, r.detail));
  }
  return out;
}

function readMessage(data, id) {
  const m = data.messages.find(x => x.id === id);
  if (m) { m.status = 'read'; if (!data.knowledge.readMsgs.includes(id)) data.knowledge.readMsgs.push(id); }
  return buildView(data);
}

function readNews(data, id) {
  if (!data.knowledge.heardNews.includes(id)) data.knowledge.heardNews.push(id);
  return buildView(data);
}

function ensureImp(data, id) {
  data.impressions = data.impressions || {};
  if (!data.impressions[id]) {
    const rel = ((data.relations || {}).player || {})[id] || {};
    const tone = rel.tone || '';
    const npc = getEntity(data, id) || {};
    const warm = /熟|房东|邻居|老友|旧识|多年|一家|亲人|恋人|兄弟|姐妹/.test(tone) ? 4 : (/点头|常客|见过|邻居家/.test(tone) ? 2 : (/陌生|初识/.test(tone) ? 1 : 1));
    data.impressions[id] = {
      stage: warm,
      seen: ((npc.profile || {}).appearance || {}).标志物 || '',
      traits: warm >= 3 ? ['（老街坊的熟面孔）'] : [],
      notes: [],
      bonds: tone ? [tone] : ['初识'],
      nameKnown: npc.name
    };
  }
  return data.impressions[id];
}
// 玩家视角的名字：只有印象达"知道名字(>=2)"才显示；否则返回 null
function viewName(data, id) {
  if (id === 'player') return (data.entities.player || {}).name || '你';
  const imp = ensureImp(data, id);
  const npc = getEntity(data, id) || {};
  if (imp && imp.stage >= 2 && (imp.nameKnown || npc.name)) {
    const n = (imp.nameKnown || npc.name || '');
    return /^[a-z]+_\d+$/.test(String(n)) ? null : n; // 兜底：id 形态永不作为玩家所见名字
  }
  return null;
}
function updateImpressions(data, frame, updates) {
  const us = updates || [];
  for (const u of us) {
    if (u.type === '印象更新' && u.target) {
      const imp = ensureImp(data, u.target);
      const ego = getEntity(data, u.target) || {};
      if (u.note) {
        const note = String(u.note).slice(0, 60);
        if (!imp.notes.some(n => n === note || (note.length > 6 && n.indexOf(note.slice(0, 6)) >= 0) || (n.length > 6 && note.indexOf(n.slice(0, 6)) >= 0))) {
          imp.notes.push(note); if (imp.notes.length > 6) imp.notes.shift();
          const tr = String(u.note).slice(0, 30);
          if (!imp.traits.some(t => t === tr || (tr.length > 6 && t.indexOf(tr.slice(0, 6)) >= 0))) { imp.traits.push(tr); if (imp.traits.length > 6) imp.traits.shift(); }
        }
      }
      if (imp.stage < 3) imp.stage = 3;
      if (ego.name && !imp.nameKnown) { imp.nameKnown = ego.name; imp.stage = Math.max(imp.stage, 2); }
    }
  }
  const presentIds = present(data, data.current.sceneId).filter(p => p.id !== 'player').map(p => p.id);
  for (const id of presentIds) {
    const imp = ensureImp(data, id);
    const beats = (frame && frame.beats) || [];
    const interacted = beats.some(b => b.speaker === id || b.actor === id);
    const npc = getEntity(data, id) || {};
    if (imp.stage < 2 && (interacted || (data.sceneLog || []).slice(-8).some(l => (l.speaker === npc.name || l.speaker === id)))) {
      imp.stage = 2; imp.nameKnown = npc.name || imp.nameKnown;
      if (!imp.seen) imp.seen = ((npc.profile || {}).appearance || {}).标志物 || '（只记得 TA 出现在眼前）';
    }
    if (imp.stage >= 2 && !imp.nameKnown) imp.nameKnown = npc.name;
    if (imp.stage >= 3 && !imp.seen) imp.seen = ((npc.profile || {}).appearance || {}).标志物 || '';
  }
}
// 工具视图：玩家随身的通信用具（device，买新机即换代）+ 世界环境工具（舆图/收音机…）
function buildViewTools(data) {
  const dev = data.current && data.current.device;
  const base = (data.meta && data.meta.tools) || [];
  const out = [];
  if (dev) out.push({ id: 'device', name: dev.name || '手机', icon: dev.icon || '📱', apps: (dev.apps || ['sms', 'contacts']) });
  for (const t of base) {
    if (t.id === 'phone' || t.id === 'brick' || t.id === 'letter' || t.id === 'talisman') { if (!dev) out.push({ id: t.id, name: t.name, icon: t.icon, apps: t.apps || [] }); continue; }
    out.push({ id: t.id, name: t.name, icon: t.icon, apps: t.apps || [] });
  }
  return out;
}
function buildView(data) {
  // 场景画（v1.31）：**底版**存在 place.art（随存档持久化，长期骨架），这里只做「底版 + 本回合叠加」。
  // 指纹一致 → 复用上一回合渲染好的成品（省掉逐格重绘）；指纹变了（人动了/货架变了/格局改了/天气时段变了）→ 重渲染。
  const artFn = (id) => viewName(data, id);
  const fp = PRES.layoutFingerprint(data, artFn);
  const sceneKey = data.current.sceneId;
  let sm = (data.current.artCache || {})[sceneKey];
  if (!sm || sm.fp !== fp || !sm.art) {
    sm = PRES.sceneModel(data, artFn);
    sm.fp = fp;
    data.current.artCache = data.current.artCache || {};
    data.current.artCache[sceneKey] = sm;
  }
  const scene = getEntity(data, data.current.sceneId) || { name: '某处', tags: [] };
  const cast = present(data, data.current.sceneId).map(p => ({ id: p.id, name: (p.id === 'player' ? (p.name || '你') : (viewName(data, p.id) || '？')), mood: (p.state || {}).mood || '', state: p.state || {} }));
  const unread = data.messages.filter(m => m.to === 'player' && m.status === 'unread');
  const msgs = data.messages.filter(m => m.to === 'player' || m.from === 'player').slice(-40).reverse();
  const known = data.knowledge;
  const mapNodes = known.knownPlaces.map(id => getEntity(data, id)).filter(Boolean).map(p => ({ id: p.id, name: p.name, geo: p.geo, edges: (p.edges || []).map(e => ({ to: e.to, level: e.level, minutes: e.minutes })), visited: known.visited.includes(p.id), open: p.openHours }));
  // 人物面板 = **"你见过的人"的并集**。原来只列 knownPeople，于是"场上站着 4 个人、面板里只有 1 个"
  // —— 在场的人当然见过，却没进那个名单。stage 门控仍由 personView 负责（没名字的显示为"你还不认识"）。
  const seenIds = new Set([].concat(
    known.knownPeople || [],
    present(data, data.current.sceneId).map(x => x.id),
    Object.keys(data.impressions || {})
  ));
  const people = [...seenIds]
    .filter(id => id && id !== 'player' && getEntity(data, id))
    .map(id => personView(data, getEntity(data, id)))
    .sort((a, b) => (b.stage || 0) - (a.stage || 0));
  const storeItems = Object.values(data.entities).filter(e => e.type === 'item' && e.at === data.current.sceneId && !e.bought).map(e => ({ id: e.id, name: e.name, price: e.price || 0, desc: e.desc, sold: e.bought || 0, stock: e.stock != null ? e.stock : (e.bought ? Math.max(0, e.stock0 - e.bought) : null) }));
  const wallet = data.entities.player.money || { currency: '元', cash: 20, digital: 0, spent: 0, earned: 0 };
  const inv = (data.entities.player.inventory || []).filter(x => !/手机|表|钱包|行囊/.test(x.name) || true).map(x => ({ id: x.id, name: x.name, value: (x.value != null ? x.value : (x.price || null)) }));
  const news = data.news.filter(n => known.heardNews.includes(n.id)).map(n => ({ id: n.id, title: n.title, summary: n.summary, t: n.t, severity: n.severity }));
  const firstNpc = Object.values(data.entities).find(x => x.type === 'person' && x.id !== 'player');
  const relId = firstNpc ? firstNpc.id : 'npc1';
  const relation = (data.relations.player || {})[relId] || {};
  const npcMood = firstNpc ? ((firstNpc.state || {}).mood || '') : '';
  const scenePlace = getEntity(data, data.current.sceneId) || {};
  const geoChain = (scenePlace.geo || []).slice(-2).join(' · ');
  const region = geoChain || ((data.entities[data.current.sceneId] || {}).name || '此地');
  const orgs = Object.values(data.entities).filter(e => e.type === 'org').map(e => e.name);
  const month = parseInt((data.current.time || '').slice(5, 7), 10) || 5;
  const season = month >= 3 && month <= 5 ? '春末夏初' : (month >= 6 && month <= 8 ? '盛夏' : (month >= 9 && month <= 11 ? '深秋' : '寒冬'));
  const overview = {
    era: data.meta.era || '现代',
    近况: news.slice(0, 5),
    地区: region,
    势力组织: orgs.length ? orgs : [(data.meta.name || '青石镇'), (scenePlace.name || '')],
    要闻人物: known.knownPeople.map(id => viewName(data, id)).filter(Boolean),
    时令: month + '月 · ' + season,
    你的身份: (data.entities.player.profile || {}).identity || {}
  };
  const cfgNow = AI.loadConfig();
  const carries = data.meta.carries || {};
  const claims = (data.claims || []).map(c => ({ title: c.title || '', when: c.when || '', date: c.date || '' }));
  const temp = (data.current.weather || '').indexOf('雨') >= 0 ? 22 : 27;
  const weatherInfo = { now: data.current.weather || '晴', temp: temp + '°C', trend: [ { t: '今晚', d: data.current.weather || '晴' }, { t: '明天', d: '多云转阴' }, { t: '后天', d: '晴' } ] };
  const contacts = (known.phoneContacts || []).map(id => { const e = getEntity(data, id) || {}; const nm = viewName(data, id) || '陌生号码'; const dead = (e.state || {}).alive === false; return { id: e.id, name: dead ? (nm + '（已故）') : nm, mood: dead ? '故人' : ((e.state || {}).mood || '') }; });
  return {
    mode: AI.isLive(cfgNow) ? 'live' : 'demo',
    apiModel: (cfgNow.llm && cfgNow.llm.model) || '',
    carries: carries,
    tools: buildViewTools(data),
    sceneArt: sm.art || null,
    interacts: PRES.sceneModel(data, artFn).interacts,
    artMarks: sm.marks,
    log: journalView(data),
    plans: (data.plans || []).slice(-5).map(p => ({ dest: p.dest, status: p.status, ticket: !!p.ticket, mode: p.mode || '', reason: p.blockReason || '' })),
    stats: AI.statsView(),
    turnN: data.current.turnN || 1,
    delegates: ((data.current && data.current.delegateStreak) || []).length,
    imgTasks: ((data.current && data.current.imgTasks) || []).slice(-8).map(t => ({ id: t.id, who: t.who || [], state: t.state || '', note: t.note || '', status: t.status || 'queued', err: t.err || '', title: (t.ai && t.ai.sceneTitle) || '', at: (t.at != null ? t.at : null), noFace: t.noFace || [], style: t.style || '', mode: t.mode || '', t: t.t || '' })),
    options: data.current.lastOptions || null,
    playerName: (cfgNow.playerName || (data.entities.player || {}).name || '你'),
    me: selfView(data),
    affordances: buildAffordances(data),
    phoneInfo: { contacts: contacts, clock: data.current.time.slice(0, 16).replace('T', ' '), claims, weatherInfo },
    meta: { era: data.meta.era, maxSeverity: data.meta.maxSeverity, importSource: data.meta.importSource },
    time: RT.perceiveTime(data, data.current.time),
    weather: RT.perceiveWeather(data, data.current.time),
    weatherFx: (function () {
      const wx = RT.perceiveWeather(data, data.current.time);
      return wx.seen ? PRES.weatherFx(data.current.weather || '晴', false) : null;
    })(),
    weatherCue: (function () {
      const wx = RT.perceiveWeather(data, data.current.time);
      return (wx.heard && !wx.seen && wx.cue) ? wx.cue : null;
    })(),
    place: { id: scene.id, name: scene.name, tags: scene.tags, features: scene.features },
    cast, unread: unread.length,
    msgs, map: mapNodes, people, shop: storeItems, inventory: inv, news, overview,
    money: { currency: wallet.currency || '元', cash: wallet.cash || 0, digital: wallet.digital || 0, spent: wallet.spent || 0, earned: wallet.earned || 0 },
    relation: { tone: relation.tone || '普通', npcMood },
    sceneLog: (function () {
      // 生图定位：本回合 beats（_imgBeatSpan）里的条目，at 对应序号 → 挂 imgs（图卡随叙事流显示）
      const span = data.current && data.current._imgBeatSpan;
      const imgByAt = {};
      for (const t of ((data.current && data.current.imgTasks) || [])) {
        if (t.at == null) continue;
        (imgByAt[t.at] = imgByAt[t.at] || []).push(t.id);
      }
      const outArr = [];
      const src = (data.sceneLog || []).slice(-30);
      for (let i = 0; i < src.length; i++) {
        const l = src[i];
        const imgs = (span && i >= span.start && i < span.start + span.count) ? (imgByAt[i - span.start] || null) : null;
        let item;
        const sp = l.speaker;
        if (!sp) item = l;
        else {
          const ent = getEntity(data, sp) || Object.values(data.entities).find(x => x.type === 'person' && x.name === sp);
          if (ent && ent.type === 'person') {
            const nm = ent.id === 'player' ? '你' : (viewName(data, ent.id) || '？');
            item = Object.assign({}, l, { speaker: nm, speakerName: nm });
          } else {
            const resolved = resolveSpeaker(data, sp);
            const safe = /^[a-z]+\d+$/.test(resolved) ? '？' : resolved;
            item = Object.assign({}, l, { speaker: safe, speakerName: safe });
          }
        }
        if (imgs) item = Object.assign({}, item, { imgs: imgs });
        outArr.push(item);
      }
      return outArr;
    })(),
    archives: data.archives || {},
    // A5：这里原来是 lastLedger（客观事件流）——那是导演台本，含玩家不在场的事，且 type 是数据库字段名。
    // 玩家界面只呈现"玩家认知视图"；客观账本改由 /api/diag 供诊断用（AI 侧 subai 仍读 data.ledger，不受影响）。
    myLog: myLogView(data)
  };
}
// 「你记得的」：只含玩家亲历的事（ledger.target === 'player'），且把人话写出来——不出现 ledger.type 字段名。
const MYLOG_VERB = {
  '物品获取': '你拿到了', '物品消耗': '你用掉了', '物品转移': '你经手了',
  '地点变化': '你到了', '事件开始': '你经历了', '事件结束': '这件事结束了',
  '信息到达': '你收到了', '交易拒绝': '这笔没谈成', '关系变化': '', '记忆新增': ''
};
function myLogView(data) {
  const out = [];
  for (const l of (data.ledger || [])) {
    if (!l || l.target !== 'player') continue;
    const v = MYLOG_VERB[l.type];
    if (v === undefined) continue;                 // 不在白名单的类型（含所有客观类型）一律不出现
    const desc = String(l.desc || '').slice(0, 60);
    const text = v ? (v + (desc ? '：' + desc : '')) : desc;
    if (!text) continue;
    out.push({ t: l.t, text: text });
  }
  return out.slice(-8);
}

// 我的概况：玩家对自己的认知（20.3）——自己知道的一切，不门控
// 占位废话清洗："按设定来"这类历史垃圾值/模板默认 → 空（宁缺勿滥）
function cleanV(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (/按设定来|^待定$|待补充|待接触|未知，先接触|^（未知）$|^未知$/.test(s)) return '';
  if (/^一位来到此地落脚的访客|^一位来到此处落脚的旅客|随和，心里有主意|先安顿下来/.test(s)) return '';
  return s;
}
function selfView(data) {
  const p = data.entities.player || {};
  const prof = p.profile || {};
  const idn = prof.identity || {};
  const myAge = RT.ageOf(data, p, data.current.time); // 年龄随世界年份实时增长
  const app = prof.appearance || {};
  const sur = prof.surface || {};
  const bg = prof.background || {};
  const sec = prof.secrets || {};
  const cfgN = AI.loadConfig();
  const selfMem = RT.funnelMemories(data, 'player', [], 6).map(m => ({ id: m.id, content: m.content, tags: m.tags, weight: m.weight, t: m.t }));
  const claims = (data.claims || []).slice(-8).map(c => ({ title: c.title || '', when: c.when || '', date: c.date || '' }));
  const bonds = Object.keys(data.relations.player || {}).map(id => {
    const nm = viewName(data, id); if (!nm) return null;
    return { id, name: nm, tone: ((data.relations.player || {})[id] || {}).tone || '普通' };
  }).filter(Boolean).slice(0, 8);
  return {
    name: cfgN.playerName || p.name || '你',
    identity: { 姓名: idn.姓名 || p.name || '你', 年龄: cleanV(myAge != null ? String(myAge) + ' 岁' : idn.年龄), 身份: cleanV(idn.身份), 职业: cleanV(idn.职业) },
    appearance: cleanV(app.标志物 || ''),
    surface: cleanV(sur.待人 || ''), ability: cleanV(sur.能力 || ''),
    backstory: cleanV(bg.经历 || ''),
    secrets: cleanV(sec.包袱 || ''),
    state: p.state || {},
    inventory: (p.inventory || []).map(x => x.name || x.id || ''),
    money: p.money ? { currency: p.money.currency || '元', cash: p.money.cash || 0, digital: p.money.digital || 0 } : null,
    memories: selfMem,
    claims, bonds,
    selfSetup: (data.meta && data.meta.self) || null,
    worldEra: (data.meta && data.meta.era) || '',
    worldName: (data.meta && data.meta.name) || ''
  };
}

const STAGES = ['未见过', '只见过', '知道名字', '打过交道', '熟人'];
// 「TA 长什么样」——**把长相用语言说出来**（文字立绘）。
// 这一栏是给**所有玩家**的：生图引擎是"想看真容"的加分项，不是前提。
//
// 引擎侧的外貌数据分两种形态，处理方式完全不同：
//   · profile.visual.nine / anchor —— 九维档案（含几何量化 "眼宽:眼高≈3:1"）
//     → **不原样外露，但也不雪藏：翻译成人话**（"眼睛细长"）
//   · imp.look —— AI 一次写好的"长相散文"（按需生成、长期复用）
//     → 最优先，因为它本来就是人话
// stage 决定你看得见几句：越熟，长相越具体。
function plainLook(s) {
  return String(s || '')
    .replace(/[（(][^）)]*[)）]/g, '')                                  // 括号里的量化说明
    .replace(/[≈~]?\s*\d+(\.\d+)?(\s*[:：]\s*\d+(\.\d+)?)+/g, '')   // 3:1 / 1:1:1 整条数字比例
    .replace(/[\u4e00-\u9fa5A-Za-z]{1,4}[:：][\u4e00-\u9fa5A-Za-z]{1,4}(?=[，,。；;、]|$)/g, '') // "眼宽:眼高" 这类标签对
    .replace(/\d+\s*(cm|CM|厘米|毫米|mm|kg|公斤|斤)/g, '')             // 绝对长度/重量
    .replace(/(约|大约|大概|近|左右)\s*(?=[，,。；;、]|$)/g, '')          // 数值被剥后剩下的"约"
    .replace(/(身高|体重|肩宽|腰围|胸围|头身比|臂展|三庭|五眼|眼宽|眼高|瞳距)\s*(?=[，,。；;、]|$)/g, '')   // 数值被剥后剩下的空标签
    .replace(/[；;]/g, '，').replace(/\s+/g, '')
    .replace(/，{2,}/g, '，').replace(/^[，、]|[，、]$/g, '')
    .trim();
}
// 九维 → 人话（0 token 兜底）。顺序按"人描述一个人时先说什么"排：年龄感 → 脸 → 身材 → 头发 → 衣着
const LOOK_DIMS = ['脸型与年龄感', '眉眼与瞳孔', '鼻子与嘴唇', '肤色与肤质', '体型身材', '发型与发色', '衣着与配饰', '永久标记'];

// 「TA 长什么样」的按需生成（副 AI，一次写完长期复用）：
//   · 不预生成 —— 玩家不看这个人，就一分钱不花
//   · 不重复生成 —— 写完存进印象层 imp.look，之后 lookOf() 第一优先级直接命中
// 它要产出的是**人读的长相印象**（含一点主观判断），不是给生图引擎的提示词。
// 一次生成，两处产出（同一份长相认知的两种投影）：
//   · nine → profile.visual.nine  —— 引擎侧的**刚性锚点**（生图一致性靠它）
//   · look → impressions[id].look —— 玩家侧的**长相印象**（人话，文字立绘）
// 运行时冒出来的新人物只有"标志物"、没有九维；而 scheduler 的原则是"无锚点人物绝不写人貌"，
// 于是他们永远只画场景、不画人。这里补上那个缺口。
// 仍然是：不预生成（不看的就不花）· 不重复生成（写完存下来，之后 0 token）。
const PROFILE_SYS = [
  '你在为一个人物补**长相档案**。产出两份，用途不同，写法也不同。',
  '',
  '【nine】给生图引擎的**刚性锚点**（结构化、可画、可校验）：',
  '  八个维度固定：脸型与年龄感 / 眉眼与瞳孔 / 鼻子与嘴唇 / 肤色与肤质 / 体型身材 / 发型与发色 / 衣着与配饰 / 永久标记',
  '  每维写具体可画的特征；比例用相对写法（"三庭≈1:1:1"）；身高/肩宽这类可给数值',
  '  **禁止文学形容词**（"灵动""水汪汪"这种模型会瞎画）；没把握的维度宁可留空，别编',
  '',
  '【look】给玩家读的**长相印象**（人话）：',
  '  3 句，一句一层：① 大体（年龄感+脸型+第一眼气质）② 最抓眼的 1-2 处细节 ③ 身材衣着 + 一点主观判断（面善／不好惹／体面／邋遢）',
  '  **把 nine 翻译成人话**，禁止原样搬运量化；禁罗列式清单；禁写人物姓名；像熟人随口描述，节制可信',
  '',
  '【已有九维】为空 → 先按素材把 nine 建出来，再据它写 look。',
  '【已有九维】非空 → nine 保留原有内容（只补空缺维度），look 直接照它翻译。',
  '输出 JSON：{"nine":{"脸型与年龄感":"","眉眼与瞳孔":"","鼻子与嘴唇":"","肤色与肤质":"","体型身材":"","发型与发色":"","衣着与配饰":"","永久标记":""},"look":"第一句。第二句。第三句。"}'
].join('\n');
const NINE_DIMS_ = ['脸型与年龄感', '眉眼与瞳孔', '鼻子与嘴唇', '肤色与肤质', '体型身材', '发型与发色', '衣着与配饰', '永久标记'];
function nineFilled(p) {
  const nine = (((p.profile || {}).visual || {}).nine) || {};
  return NINE_DIMS_.filter(k => String(nine[k] || '').trim()).length;
}
// 建档前查重：同一个人的**另一个实体**若已有档案 → 直接复用，**绝不给一个人造两套档案**。
// （重复实体由 mergeDupPersons 定期合并，但在合并发生之前，这里必须先挡住；
//   否则两次独立生成会得到两份不一样的九维 —— 同一个人画出来是两张脸。）
function twinProfile(data, p) {
  const app = (((p.profile || {}).appearance || {}).标志物) || '';
  const name = p.name || '';
  if (!app && !name) return null;
  for (const e of Object.values(data.entities || {})) {
    if (!e || e.id === p.id || e.type !== 'person' || e.id === 'player') continue;
    const ea = (((e.profile || {}).appearance || {}).标志物) || '';
    const sameApp = !!(app && app !== '（你还没看清）' && ea === app);
    const sameName = !!(name && e.name === name);
    if (!sameApp && !sameName) continue;
    const hasNine = nineFilled(e) >= 4;
    const hasLook = !!String(((data.impressions || {})[e.id] || {}).look || '').trim();
    if (hasNine || hasLook) return e;
  }
  return null;
}
// 把已有档案抄过来（只补空缺，不覆盖）
function adoptArchive(data, p, twin) {
  const vis = (p.profile.visual = p.profile.visual || {});
  const tn = (((twin.profile || {}).visual || {}).nine) || {};
  vis.nine = vis.nine || {};
  for (const k of NINE_DIMS_) if (!String(vis.nine[k] || '').trim() && tn[k]) vis.nine[k] = String(tn[k]).slice(0, 120);
  if (!vis.anchor) { const ta = String((((twin.profile || {}).visual || {}).anchor) || ''); if (ta) vis.anchor = ta.slice(0, 600); }
  if (!vis.dynamic) { const td = (((twin.profile || {}).visual || {}).dynamic) || null; if (td) vis.dynamic = Object.assign({}, td); }
  if (!vis.dynamic) vis.dynamic = {};
  const tl = String(((data.impressions || {})[twin.id] || {}).look || '').trim();
  if (tl) { const imp = ensureImp(data, p.id); if (!String(imp.look || '').trim()) imp.look = tl; }
}
async function genProfile(data, id, cfg) {
  const p = getEntity(data, id);
  if (!p || p.type !== 'person' || id === 'player') return { look: '', nineBuilt: false };
  const imp = ensureImp(data, id);
  const stage = Math.min(4, Math.max(0, imp.stage || 1));
  if (stage < 2) return { look: '', nineBuilt: false };        // 还没记住脸，不该有长相
  const hasLook = !!String(imp.look || '').trim();
  const filled = nineFilled(p);
  if (hasLook && filled >= 4) return { look: imp.look, nineBuilt: false };  // 两样都有 → 0 token
  // 查重：同一个人的另一个实体已有档案 → 抄过来，别造第二套
  if (filled < 4 || !hasLook) {
    const twin = twinProfile(data, p);
    if (twin) {
      adoptArchive(data, p, twin);
      // 九维抄够了就算建成（立绘可以之后单独补）—— 关键是**不新建第二套**
      if (nineFilled(p) >= 4) return { look: String(imp.look || '').trim(), nineBuilt: true, reused: true };
    }
  }
  if (!AI.isLive(cfg)) return { look: imp.look || '', nineBuilt: false };    // 演示模式：0 token 兜底
  const nine0 = (((p.profile || {}).visual || {}).nine) || {};
  const inp = {
    身份: (((p.profile || {}).identity || {}).身份) || '',
    已有的九维: nine0,
    标志物: ((p.profile || {}).appearance || {}).标志物 || '',
    随身: ((p.profile || {}).appearance || {}).随身 || '',
    玩家对TA的印象: (imp.traits || []).slice(0, 3),
    关系: (((data.relations || {}).player || {})[id] || {}).tone || '初识'
  };
  let built = false;
  try {
    const out = await AI.llmJSON(cfg, [{ role: 'system', content: PROFILE_SYS }, { role: 'user', content: JSON.stringify(inp) }], {}, 900, null, 'none');
    const n9 = (out && out.nine) || null;
    if (n9 && typeof n9 === 'object') {
      const vis = (p.profile.visual = p.profile.visual || {});
      vis.nine = vis.nine || {};
      for (const k of NINE_DIMS_) {
        const v = String(n9[k] || '').trim();
        if (v && !String(vis.nine[k] || '').trim()) vis.nine[k] = v.slice(0, 120);   // 只补空缺，不覆盖既有
      }
      // 锚点兜底：九维齐全了就拼一个 anchor（老字段兼容）
      if (!vis.anchor) vis.anchor = NINE_DIMS_.map(k => vis.nine[k]).filter(Boolean).join('，').slice(0, 600);
      built = true;
    }
    const look = String((out && out.look) || '').trim();
    if (look) imp.look = look.slice(0, 260);
  } catch (e) { }
  return { look: imp.look || '', nineBuilt: built };
}
// 兼容旧调用名（前端"文字立绘"走的是同一个入口）
async function genLook(data, id, cfg) { const r = await genProfile(data, id, cfg); return r.look; }
function lookOf(p, imp, stage) {
  if (stage <= 1) return '';                                    // 只见过一眼：还没记住脸
  // ① AI 写好的长相散文（按需生成、长期复用）：按句给，stage 决定给几句
  const prose = String((imp && imp.look) || '').trim();
  if (prose) {
    const sents = prose.split(/[。！？\n]/).map(s => s.trim()).filter(Boolean);
    const n = stage === 2 ? 1 : (stage === 3 ? 2 : sents.length);
    return sents.slice(0, n).join('。') + '。';
  }
  // ② 印象层已有的"人话印象"（世界生成时就写好的，本来就是给玩家读的）——直接用
  const seen = plainLook((imp && imp.seen) || '');
  if (seen && !/^一个陌生面孔$/.test(seen)) {
    const parts = seen.split(/[，,]/).map(s => s.trim()).filter(Boolean);
    const n = stage === 2 ? Math.max(1, Math.ceil(parts.length / 3))
            : (stage === 3 ? Math.max(2, Math.ceil(parts.length * 2 / 3)) : parts.length);
    const t = parts.slice(0, n).join('，');
    return /[。！？]$/.test(t) ? t : t + '。';
  }
  // ② 九维兜底：去量化后按维度拼人话
  const nine = (((p.profile || {}).visual || {}).nine) || {};
  const bits = [];
  for (const k of LOOK_DIMS) {
    const t = plainLook(nine[k]);
    if (t) bits.push(t);
  }
  if (bits.length) {
    const n = stage === 2 ? 2 : (stage === 3 ? 4 : bits.length);
    return bits.slice(0, n).join('。') + '。';
  }
  // ③ 只有标志物（行为特征，不是长相）：老实说清这是印象不是长相
  const mark = plainLook(((p.profile || {}).appearance || {}).标志物);
  return mark ? ('你记不太清 TA 的脸，只记得：' + mark + '。') : '';
}
function personView(data, p) {
  const imp = ensureImp(data, p.id);
  const rel = (data.relations.player || {})[p.id] || {};
  const stage = Math.min(4, Math.max(0, imp.stage || 1));
  const name = (stage >= 2) ? (imp.nameKnown || p.name) : null;
  return {
    id: p.id, name: name || '？',
    stage: stage, stageLabel: STAGES[stage],
    seen: imp.seen || (stage >= 3 ? ((p.profile || {}).appearance || {}).标志物 || '' : ''),
    // TA 长什么样：用语言说出来的长相印象，stage 决定看得见几句
    look: lookOf(p, imp, stage),
    // 是否已有"AI 写好的"长相（false = 现在显示的是 0 token 兜底，前端可按需请求升级）
    lookReady: !!String((imp && imp.look) || '').trim(),
    traits: imp.traits.slice(0, 6),
    notes: imp.notes.slice(0, 3),
    bonds: (imp.bonds.length ? imp.bonds : [rel.tone && /陌生|初识/.test(rel.tone) ? '初识' : (rel.tone || '初识')]),
    secret: '（不知道）',
    mood: (p.state || {}).mood || '',
    location: (p.state || {}).location,
    known: !!name,
    dead: (p.state || {}).alive === false,
    deceasedAt: (p.state || {}).deceasedAt || null
  };
}

function buildAffordances(data) {
  const out = [];
  const scene = getEntity(data, data.current.sceneId);
  const tags = scene ? (scene.tags || []) : [];
  const presentNpc = Object.values(data.entities).find(e => e.type === 'person' && e.id !== 'player' && e.state.location === data.current.sceneId);
  const rel = presentNpc ? ((data.relations.player || {})[presentNpc.id] || {}) : null;
  const imp = presentNpc ? ensureImp(data, presentNpc.id) : null;
  const known = imp && imp.nameKnown && imp.stage >= 2 ? imp.nameKnown : null;
  const how = known ? known : '她';
  if (presentNpc && rel && /紧张|僵|争吵|口角|梁子|闹/.test(rel.tone || '')) out.push({ label: '为之前的事道个歉', action: '我要给' + presentNpc.name + '道歉' });
  if (presentNpc) out.push({ label: '和' + (known || '门口那个人') + '搭话', action: '你好，' + (known || '请问怎么称呼？') });
  const carryPhone = (data.meta.carries || {}).time === 'phone';
  if (carryPhone && presentNpc && imp && imp.stage >= 3) out.push({ label: '给' + known + '发条消息', action: '发消息：在吗？' });
  if (tags.join(',').indexOf('室内') >= 0) out.push({ label: '打量四周', action: '我打量一下四周' });
  for (const e of (scene ? scene.edges || [] : [])) {
    const d = getEntity(data, e.to);
    if (d) out.push({ label: '去' + d.name + '（步行' + e.minutes + '分）', action: '去' + d.name });
  }
  return out.slice(0, 6);
}


function advanceTutorial(data) {
  const t = data.tutorial;
  if (!t || !t.steps || t.steps.length === 0) return null;
  const st = t.steps.find(s => s.at === t.step + 1);
  if (!st) return null;
  t.step += 1;
  if (st.claim) { data.claims = data.claims || []; data.claims.push(st.claim); }
  if (st.msg) {
    const m = Object.assign({ id: data.id('msg'), status: 'unread', via: 'phone' }, st.msg, { t: RT.addMinutes(data.current.time, 1) });
    data.messages.push(m);
    return st.hint || '（新消息）';
  }
  if (st.cand) {
    data.current.pendingCandidates = data.current.pendingCandidates || [];
    data.current.pendingCandidates.push({ id: data.id('cand'), text: st.cand, type: '剧情', expireAt: RT.addMinutes(data.current.time, 120), sev: '低' });
    return st.hint || null;
  }
  return null;
}

// ---------- 身世日志 · 回想机制（玩家=角色扮演最重要的一环） ----------
// journal.known=开局全明（"我是谁"绝不黑幕）；journal.shadows=隐约记得。触发两路：
//   ① 关键词（剧情/对话提到）  ② 看见本人（targets 人物在场）——看到沈姨就该想起她
function recallCheck(data, texts, presentIds) {
  const j = data.journal;
  if (!j || !Array.isArray(j.shadows)) return [];
  const hay = (texts || []).filter(Boolean).join(' ');
  const present = (presentIds || []).filter(Boolean);
  const out = [];
  for (const s of j.shadows) {
    if (s.t) continue;
    const hitByText = Array.isArray(s.triggers) && s.triggers.length && s.triggers.some(k => k && hay.indexOf(k) >= 0);
    const hitBySight = Array.isArray(s.targets) && s.targets.length && s.targets.some(id => present.indexOf(id) >= 0);
    if (!hitByText && !hitBySight) continue;
    if (out.length >= 1) break; // 每回合最多想起一件：最扎心的先涌上来
    s.t = data.current.time;
    j.recalls = j.recalls || []; j.recalls.push(s.id);
    j.log = j.log || []; j.log.push({ t: data.current.time, title: s.hint, text: s.text });
    try { RT.writeMemory(data, { owner: 'player', content: s.text, tags: ['身世', s.id], impact: 45, t: data.current.time }); } catch (e) { }
    out.push({ id: s.id, hint: s.hint, text: s.text, t: s.t });
  }
  return out;
}
function journalView(data) {
  const j = data.journal || { known: [], shadows: [], recalls: [], log: [] };
  return {
    known: (j.known || []).map(x => ({ k: x.k, v: String(x.v || '').slice(0, 160) })),
    shadows: (j.shadows || []).filter(s => !s.t).map(s => ({ id: s.id, hint: s.hint || '（有一件事……）', t: null })),
    recalled: (j.shadows || []).filter(s => s.t).map(s => ({ id: s.id, hint: s.hint, text: s.text, t: s.t })),
    events: (j.log || []).slice(-20).map(l => ({ t: l.t, title: l.title, text: l.text }))
  };
}

function buildReaction(data, updates) {
  const us = updates || [];
  const npc = Object.values(data.entities).find(e => e.type === 'person' && e.id !== 'player');
  const n = npc ? npc.name : '对方';
  if (us.some(u => u.type === '关系变化')) return n + '心里记下了什么。';
  if (us.some(u => u.type === '情绪变化')) return n + '看起来松快了一些。';
  if (us.some(u => u.type === '记忆新增')) return '这个世界记住了一件事。';
  return '';
}

// 合并重复实体：同一人（同外貌标志物 / 同名）被创建两次时，并到优先保留的那个（先出现者）
// 动态维度 → 刚性锚点的沉淀（每回合调用一次；详见 runTurn 里的说明）
const DYN_TO_NINE = { 发型: '发型与发色', 衣着: '衣着与配饰', 配饰: '衣着与配饰' };
// **按世界时间判定，不按回合数**：5 个回合可能只过了 20 分钟，一晚上没换衣服不该被当成永久特征。
// "这个状态持续了两天以上" 才说明它不是临时状态。
const SEDIMENT_HOURS = 48;
const HAIR_COLOR = /(灰白|花白|银白|雪白|乌黑|黑色|棕色|褐色|金黄|亚麻|栗色|酒红|暗红|灰色|银灰|深棕|浅棕|茶色|白发)/;
function sedimentDynamic(data, nowISO) {
  const now = Date.parse(nowISO || (data && data.current && data.current.time) || '') || Date.now();
  let promoted = 0;
  for (const e of Object.values((data && data.entities) || {})) {
    if (!e || e.type !== 'person' || e.id === 'player') continue;
    const vis = (e.profile || {}).visual;
    if (!vis || !vis.dynaStable) continue;
    const dyn = vis.dynamic || {};
    for (const k of Object.keys(vis.dynaStable)) {
      const st = vis.dynaStable[k];
      if (!st) continue;
      const cur = String(dyn[k] || '').trim();
      if (!cur) { delete vis.dynaStable[k]; continue; }          // 动态层没了 → 停止计数
      if (cur !== st.v) { st.v = cur; st.t0 = now; st.n = 1; continue; }   // 值变了 → 重新计时
      // t0 统一成毫秒数（字符串 ISO 参与减法会得到 NaN，NaN<48 恒 false → 守卫会静默失效）
      if (typeof st.t0 !== 'number') st.t0 = Date.parse(st.t0) || now;
      st.n = (st.n || 0) + 1;
      if ((now - st.t0) / 3600000 < SEDIMENT_HOURS) continue;             // 还没持续够久 → 继续等
      const dim = DYN_TO_NINE[k];
      if (!dim) { delete vis.dynaStable[k]; continue; }                   // 表情/状态：不沉淀
      vis.nine = vis.nine || {};
      // 发型沉淀时**保留原发色**（剪发不染发：新值只说发型时，别把"灰白"丢了）
      const old = String(vis.nine[dim] || '');
      let nv = cur.slice(0, 120);
      if (k === '发型') { const oc = old.match(HAIR_COLOR); if (oc && !HAIR_COLOR.test(cur)) nv = nv + '，' + oc[1]; }
      if (old !== nv) { vis.nine[dim] = nv; promoted++; }
      delete dyn[k]; delete vis.dynaStable[k];                   // 已进锚点，从临时层摘掉
    }
  }
  return promoted;
}
function mergeDupPersons(data) {
  if (!data || !data.entities) return 0;
  const persons2 = Object.values(data.entities).filter(e => e.type === 'person' && e.id !== 'player');
  let merged = 0;
  const key = (e) => {
    const app = ((e.profile || {}).appearance || {}).标志物 || '';
    const name = e.name || '';
    if (app && app !== '（你还没看清）') return 'app:' + app;
    if (name) return 'name:' + name;
    return null;
  };
  const seen = new Map();
  for (const e of persons2) {
    const k = key(e);
    if (!k) continue;
    if (seen.has(k)) {
      const keep = seen.get(k);
      // 丢弃 e，改写一切引用
      for (const mid of Object.keys(data.memories || {})) { if (data.memories[mid].owner === e.id) data.memories[mid].owner = keep.id; }
      for (const m of (data.messages || [])) { if (m.from === e.id) m.from = keep.id; if (m.to === e.id) m.to = keep.id; }
      for (const l of (data.sceneLog || [])) { if (l.speaker === e.id) l.speaker = keep.id; if (l.speakerName === e.name) l.speakerName = keep.name; }
      const kr = data.knowledge || {};
      ['knownPeople', 'phoneContacts'].forEach(arr => { if (Array.isArray(kr[arr])) { const i = kr[arr].indexOf(e.id); if (i >= 0) kr[arr][i] = keep.id; } });
      // 关系合并
      for (const oid of Object.keys(data.relations || {})) {
        if (oid === e.id) { data.relations[keep.id] = data.relations[keep.id] || {}; for (const k2 of Object.keys(data.relations[e.id])) data.relations[keep.id][k2] = data.relations[e.id][k2]; delete data.relations[e.id]; }
        if (data.relations[oid] && data.relations[oid][e.id]) { data.relations[oid][keep.id] = data.relations[oid][e.id]; delete data.relations[oid][e.id]; }
      }
      // 印象合并（保留更高好感）
      if (data.impressions && data.impressions[e.id]) {
        const ki = data.impressions[keep.id] || (data.impressions[keep.id] = { stage: 1, seen: '', traits: [], notes: [], bonds: [], nameKnown: keep.name });
        const ei = data.impressions[e.id];
        if ((ei.stage || 1) > (ki.stage || 1)) ki.stage = ei.stage;
        if (!ki.seen) ki.seen = ei.seen || '';
        ki.nameKnown = ki.nameKnown || ei.nameKnown || keep.name;
        for (const t of (ei.traits || [])) if (!ki.traits.includes(t)) ki.traits.push(t);
        for (const n of (ei.notes || [])) if (!ki.notes.includes(n)) ki.notes.push(n);
        ki.traits = ki.traits.slice(-6); ki.notes = ki.notes.slice(-6);
        if (!ki.look && ei.look) ki.look = ei.look;                                  // 文字立绘（v1.18 新增，漏了会丢）
        for (const b of (ei.bonds || [])) if (!(ki.bonds || []).includes(b)) (ki.bonds = ki.bonds || []).push(b);
        delete data.impressions[e.id];
      }
      // 视觉档案合并（**这条是"一个人物两套档案"的防线**）：
      // nine 逐维只补空缺，dynamic 逐项只补空缺，anchor 谁有先用谁 —— 绝不整个覆盖。
      try {
        const ep = (e.profile || {}), kp = (keep.profile = keep.profile || {});
        const ev = ep.visual || {}, kv = (kp.visual = kp.visual || {});
        if (ev.nine || kv.nine) {
          kv.nine = kv.nine || {};
          for (const k2 of Object.keys(ev.nine || {})) if (!String(kv.nine[k2] || '').trim()) kv.nine[k2] = ev.nine[k2];
        }
        if (ev.dynamic || kv.dynamic) {
          kv.dynamic = kv.dynamic || {};
          for (const k2 of Object.keys(ev.dynamic || {})) if (!String(kv.dynamic[k2] || '').trim()) kv.dynamic[k2] = ev.dynamic[k2];
        }
        if (!kv.anchor && ev.anchor) kv.anchor = ev.anchor;
      } catch (e3) { }
      // 图片任务 / 行程计划里的 id 引用改写（否则指向已删除的实体）
      for (const tk of ((data.current && data.current.imgTasks) || [])) {
        if (Array.isArray(tk.who)) tk.who = tk.who.map(x => x === e.id ? keep.id : x);
      }
      for (const pl of (data.plans || [])) { if (pl && pl.who === e.id) pl.who = keep.id; }
      delete data.entities[e.id];
      merged++;
    } else { seen.set(k, e); }
  }
  return merged;
}

module.exports = { parseIntent, runTurn, sendMessage, readMessage, readNews, buildView, buildAffordances, advanceTutorial, buildReaction, resolveWakeTime, applyUpdates, mergeDupPersons, recallCheck, resolveSpeaker, scrubSceneLog, mergeActorInto, genLook, genProfile, nineFilled, plainLook, sedimentDynamic, viewName };