// epoch.js — 世界演算（世界会进步）：年度计划 = AI 填血肉（自由节点）+ 插件调度（时间/条件）
// 设计：插件每年（世界时间跨年）触发一次演算 → 计划 { 时代标语, tech[新品(价格/apps)], events[{at,title,summary,type,condition}] }
//       → 插件按 at/condition 调度：到期+条件满足 → news(进新闻)/cand(进候选)/tech(注商店货架)/legacy(世界事实)
'use strict';
const DEG = require('./degraded');
const { getEntity, ledgerPush } = require('./store');   // v1.98 P0-3：账本只有这一个写入入口
const AI = require('./ai');
const RT = require('./runtime');
const GATE = require('./gate');   // v1.99 P0-5 第 2 步：引擎自产事件也要过同一道门（**只读预检**）
const BUS = require('./bus');     // v2.03 P0-6 收尾：新闻/候选的**落库**走总线（裁决点唯一）

const YEAR0 = 1996;

// ---------- 演示模式：预置"时代演进节点"（AI 自由节点的确定性替代，0 token） ----------
// 每年最多一次演算；这里给出关键年份的"过去式结果"，未列年份由插件补白（普通年份 news 一条）
const PRESET = {
  2000: {
    eraLabel: '千禧年 · 小镇开始安静地变化',
    tech: [{ name: '公用电话IC卡', price: 30, icon: '☎', apps: [], desc: '街口的电话亭换成了插卡式' }],
    events: [
      { at: '2000-01-01T07:00:00', title: '镇上的钟楼敲了二十四下', summary: '跨世纪了。老茶馆里人们碰了杯，说下个十年谁也不知道什么样。', type: 'event', condition: 'always' },
      { at: '2000-02-10T10:00:00', title: '第一家网吧开张', summary: '邮电局旁新开了"星星网吧"，五台机器，一小时五块。年轻人开始聊 QQ。', type: 'news', condition: 'always', foreshadow: '邮电局后头空了两间房，有人说租给外乡人了' }
    ]
  },
  2007: {
    eraLabel: '2007 · 视频屏幕开始进入每个口袋',
    tech: [{ name: '诺基亚N95', price: 1500, icon: '📱', apps: ['sms', 'contacts', 'clock', 'news'], desc: '街尾手机店新到的货，能拍照、能上网（慢）。' }],
    events: [
      { at: '2007-06-20T10:00:00', title: '外地打工的人教会了全镇发短信', summary: '春运回来的人兜里揣着彩色屏手机，消息一条一毛，谁还写信。', type: 'event', condition: 'always' },
      { at: '2007-11-05T09:00:00', title: '电视里在放一部新手机', summary: '新闻说国外有家公司发布了一款"打电话的电脑"。老电工嗤之以鼻。', type: 'news', condition: 'always', foreshadow: '省城有人在卖一种能拍照的手机，新闻里提了一嘴' }
    ]
  },
  2011: {
    eraLabel: '2011 · 触屏时代',
    tech: [{ name: '触屏智能手机', price: 3000, icon: '📱', apps: ['sms', 'contacts', 'clock', 'calendar', 'news', 'weather', 'map'], desc: '手机店老板说这个能装应用，地图、天气都能看。' }],
    events: [
      { at: '2011-04-15T09:00:00', title: '镇上通了 3G', summary: '信号塔立起来那天，老茶馆的年轻人不再下棋了，都在低头刷屏。', type: 'event', condition: 'always' }
    ]
  },
  2016: {
    eraLabel: '2016 · 人人都有手机',
    tech: [{ name: '新款智能机', price: 4500, icon: '📱', apps: ['sms', 'contacts', 'clock', 'calendar', 'news', 'weather', 'map'], desc: '一年一换？手机店老板说：人人都得有一部。' }],
    events: [
      { at: '2016-09-01T09:00:00', title: '镇上第一家快递代收点开张', summary: '卖杂货的老铺子接了个快递生意，沈姨学会了扫码。', type: 'news', condition: 'always' }
    ]
  },
  2020: {
    eraLabel: '2020 · 一个口罩的年份',
    tech: [],
    events: [
      { at: '2020-02-03T09:00:00', title: '街口支起了检查点', summary: '广播天天喊戴口罩。老茶馆歇了两个月，再开张时棋友少了一半。', type: 'event', condition: 'always' },
      { at: '2020-12-20T09:00:00', title: '镇上有人开始直播卖货', summary: '供销社的老周学着举着手机卖橘柑，一晚上卖完了库存。', type: 'news', condition: 'always' }
    ]
  },
  2026: {
    eraLabel: '2026 · 小镇和老去的人',
    tech: [{ name: '智能屏', price: 2000, icon: '📺', apps: ['news', 'weather', 'map'], desc: '放在客厅的智能屏，说句话就能放节目。' }],
    events: [
      { at: '2026-01-01T09:00:00', title: '三十周年', summary: '你在青石镇的路口站了一会儿。老街坊还是那些老街坊，只是都老了。', type: 'event', condition: 'always' }
    ]
  }
};

// ---------- 时代演算 AI 提示（接入模式：自由节点，AI 定义事件的触发时间/条件） ----------
function epochSystem() {
  return AI.withCharter([
    '你是【世界模拟器】的世界演算 AI。每年一算：给出"下一年会发生什么"的计划。你的世界是一座中国小镇（九十年代末起）——让它自然地随时间变化：技术、观念、人口、天灾人祸，都按你判断的"真实节奏"来。',
    '输出 JSON（不要多余文字）：',
    '{',
    '  "year": 年份(整数), "eraLabel": "一句话时代标语（供世界上下文使用）",',
    '  "tech": [ { "name": "新品名", "price": 价格, "icon": "emoji", "apps": ["sms","contacts","clock","calendar","news","weather","map"], "desc": "一句说明" } ],',
    '  "events": [ { "at": "YYYY-MM-DDTHH:MM:00 触发时刻", "title": "事件名", "summary": "一句话内容", "type": "news|cand|event|person", "person": "人物id(可选)", "what": "老态|体弱|交代|离世|意外", "cause": "离世/意外的因(寿终|病故|车祸|案情…)", "condition": "always 或 money:500(玩家钱≥500) 或 era:2020(年份≥某年) 或 npc:npc_1(玩家见过该NPC)" } ]',
    '}',
    '【规则】事件必须给出明确的触发时间/条件（插件按此调度，条件不满足则延后）；重大事件要前兆（2026 没有"天降外星人"）；tech 是"当年市面上出现的东西"，价格要符合年代；每年 1~5 条事件，1~2 件 tech。没有大事的年份，给 1 条生活琐事即可。禁止虚构玩家本人。',
    '【人事】type:person 用于人与人的命运变化：老态/体弱/交代（人物状态自然演变，逐年前兆：先老态再体弱再交代，至少隔2年）→ 离世（寿终或病故，必须走完前兆链）或 意外（车祸/案件——意外可以突然，但必须有因：谁的车、哪条街、为什么；意外事件与玩家有关联时要留线索）。离世人物之后不再开口/不在场，但可被提起。'
  ].join('\n'));
}

// 生成"下一年"计划（live=AI；demo=PRESET 命中或补白）
async function evolvePlan(data, cfg, year) {
  if (AI.isLive(cfg)) {
    try {
      const cur = data.meta || {};
      const out = await AI.llmJSONDeep(cfg, [
        { role: 'system', content: epochSystem() },
        { role: 'user', content: '当前：' + (cur.eraLabel || cur.era || '九十年代末的中国小镇') + '（年份：' + year + '）。计划下一年：' + (year + 1) + '。' }
      ], () => presetPlan(data, year), AI.cfgMax(cfg));
      if (out && out.__fallback) return out.value;
      if (out && out.year == year + 1) return out;
      if (out && out.year == null && (out.tech || out.events)) return Object.assign({ year: year + 1 }, out);
    } catch (e) { DEG.hit("epoch.js", e); }
  }
  return presetPlan(data, year);
}

// 演示/兜底年度计划
function presetPlan(data, year) {
  const p = PRESET[year];
  const ev = [{ at: String(year) + '-05-01T09:00:00', title: '这一年的小镇', summary: '日子照旧过。', type: 'event', condition: 'always' }];
  if (p) return Object.assign({ year: year, tech: (p.tech || []).slice(), events: (p.events || []).concat(ev) });
  return { year: year, eraLabel: year + ' · 小镇按自己的节奏走着', tech: [], events: ev };
}

// 人物生命周期级联器（纯代码·零 token·同步）：年龄=因果；跳年也把缺环按真实年份补全（前兆链完整）
// 链：老态≥65 → 体弱≥70 → 交代≥74 → 离世≥76（由 state.ailment/alive 驱动，天然去重；AI 计划落账也写同一状态，双轨兼容）
function pagePersonLifecycle(data, nowISO) {
  const years = parseInt(String(nowISO).slice(0, 4), 10);
  const order = ['老态', '体弱', '交代', '离世'];
  const ths = [65, 70, 74, 76];
  const out = [];
  for (const id of (((data.knowledge || {}).knownPeople || []))) {
    const p = data.entities[id];
    if (!p || p.type !== 'person' || !p.state || p.state.alive === false || RT.birthYearOf(p) == null) continue;
    const age = RT.ageOf(data, p, nowISO);
    if (age == null) continue;
    let idx = p.state.ailment ? order.indexOf(p.state.ailment) : -1;
    while (idx + 1 < order.length && age >= ths[idx + 1]) {
      idx += 1;
      const stage = order[idx];
      const at = String(p.birthYear + ths[idx]).slice(0, 4) + '-06-01T09:00:00';
      const who = p.name || 'TA';
      /* v1.99 · P0-5 第 2 步：离世是 L3+ 的大事件 —— 过门。
         前兆就是**这条链的上一环**（老态/体弱/交代 已经落过账了）：
         faction: 'chain' ⇒ 不看节奏门（节奏由世界时间给），但**必须有前兆**这件事必须成立。 */
      if (stage === '离世') {
        const ad0 = GATE.admitEvent(data, { source: 'chain', level: 'L3', newsSeverity: '高', kind: '事件开始', at: at, foreshadowRef: '人事:' + who });
        if (!ad0.ok) { GATE.noteRejected(data, ad0, { what: who + '离世' }); break; }   // 门不让过 → 今年不发生（链停在这里，明年再判）
        GATE.noteAdmitted(data, ad0, at);
      }
      let noteTxt = '';
      if (stage === '老态') { p.state.ailment = '老态'; noteTxt = who + '到底也老了——走路慢了，记性也差了些。'; }
      else if (stage === '体弱') { p.state.ailment = '体弱'; noteTxt = who + '身子一年不如一年，柜上常备着药。'; }
      else if (stage === '交代') { p.state.ailment = '交代'; noteTxt = who + '开始交代身后事，把铺子/家事一样样说给人听。'; }
      else {
        p.state.alive = false; p.state.deceasedAt = at;
        data.current.pendingReplies = (data.current.pendingReplies || []).filter(x => x.from !== id);
        noteTxt = who + '走了——寿终正寝。夜里走的，走得安详。';
        /* v2.03 · P0-6 收尾：新闻落库走总线（admitEvent 的唯一裁决点在里面）。
           上面那次 admitEvent 是**只读预检**（决定"这个人今年走不走"），不写任何东西。 */
        const recN = BUS.commit(data, [{ kind: 'news', source: 'chain', level: 'L3', foreshadowRef: '人事:' + who,
          item: { t: at, title: who + '与世长辞', summary: noteTxt, tags: ['人事'], region: '青石镇', impact: { 时长: '长期', 范围: '本地区' } } }], { t: at });
        if (!recN.committed.length) {   // 新闻没落成 → **状态也回退**（不许"人死了却没有这条消息"的中间态）
          p.state.alive = true; delete p.state.deceasedAt;
          GATE.noteRejected(data, (recN.rejected[0] || {}).ad || { why: 'news_not_committed' }, { what: who + '离世' });
          break;
        }
      }
      ledgerPush(data, { t: at, type: '人事', target: who, desc: who + '『' + stage + '』' + noteTxt, cause: stage === '离世' ? '寿终正寝' : null });
      data.sceneLog = data.sceneLog || [];
      data.sceneLog.push({ t: at, turn: (data.current && data.current.turnN) || 0, type: 'ambient', text: '【人事】' + noteTxt });
      out.push('人事：' + noteTxt);
    }
  }
  return out;
}

// ---------- 插件调度：跨年批量演算 + 到期事件结算 ----------
const condOk = (c, data) => {
  const s = String(c || 'always');
  if (s === 'always' || !s) return true;
  let m = s.match(/^money:(\d+)$/);
  if (m) {
    const w = (data.entities.player || {}).money || {};
    return ((w.cash || 0) + (w.digital || 0)) >= Number(m[1]);
  }
  m = s.match(/^era:(\d+)$/);
  if (m) return parseInt(String(data.current.time || '').slice(0, 4), 10) >= Number(m[1]);
  m = s.match(/^npc:(.+)$/);
  if (m) return ((data.knowledge || {}).knownPeople || []).indexOf(m[1]) >= 0;
  return true;
};
function yearTitle(y) { return String(y) + '-01-01T00:00:00'; }

// 结算从 lastSettled 到 now 之间的所有年度计划（每缺一年演化一次；最多把 pending 事件挂进 calendar）
async function catchup(data, cfg, nowISO) {
  if (!data.meta) return;
  // 人事链（纯代码级联）：不管年份请求是否并发，先按年龄把该走的前兆/离世补齐（幂等，见状态机）
  pagePersonLifecycle(data, nowISO);
  data.meta.worldClock = data.meta.worldClock || { year: parseInt(String(data.meta.startedAt || data.current.time).slice(0, 4), 10) || YEAR0, lastSettled: data.current.time };
  const nowY = parseInt(String(nowISO).slice(0, 4), 10);
  let y = (data.meta.worldClock.year || YEAR0) + 1; // 已演算过的年份不再重复
  const years = [];
  for (let yy = y; yy <= nowY; yy++) years.push(yy);
  // 多并发：要补的年份按需求拆成多个请求同时发（live 各年份互不依赖）；分批上限5防限流
  const MAX = 5, plans = [];
  for (let i = 0; i < years.length; i += MAX) {
    const batch = years.slice(i, i + MAX);
    const res = await Promise.all(batch.map(yy => evolvePlan(data, cfg, yy)));
    for (const pl of res) plans.push(pl);
  }
  if (years.length) data.meta.worldClock.year = nowY;
  for (const pl of plans) {
    data.meta.eraLabel = pl.eraLabel || data.meta.eraLabel;
    data.calendar = data.calendar || [];
    for (const e of (pl.events || [])) {
      if (!e || !e.title) continue;
      const evId = data.id('evt');
      let refNews = null;
      // 伏笔：大事件带 foreshadow → 提前 3~9 个月自动埋一条小新闻（玩家可能早已听说）
      if (e.foreshadow && (e.type === 'news' || e.type === 'event' || e.type === 'person')) {
        try {
          const fDate = new Date(new Date(String(e.at).replace('T', 'T') + 'Z').getTime() - (90 + Math.floor(Math.random() * 180)) * 86400000);
          const fISO = fDate.toISOString().slice(0, 10) + 'T' + '07:30:00';
          const recF = BUS.commit(data, [{ kind: 'news', source: 'yearly', level: 'L1', item: { t: fISO, title: String(e.foreshadow).slice(0, 60), summary: String(e.foreshadow).slice(0, 160), tags: ['伏笔'], region: String((data.meta && (data.meta.region || data.meta.name)) || '本地').slice(0, 20), impact: { 时长: '短期', 范围: '本地' } } }], { t: fISO });
          const fId = recF.committed.length ? recF.committed[0].id : '';
          if (fId) refNews = { id: fId, text: String(e.foreshadow).slice(0, 120) };
        } catch (e2) { DEG.hit("epoch.js", e2); }
      }
      data.calendar.push({ id: evId, at: e.at, title: String(e.title).slice(0, 60), summary: String(e.summary || '').slice(0, 200), type: e.type || 'event', condition: e.condition || 'always', done: false, year: Number(pl.year), person: e.person || null, what: e.what || null, cause: e.cause || null, refNews: refNews || null });
    }
    /* v1.84：科技货架只给**声明了现代科技线**的世界（演示世界 eraCode='nineties'，或世界包自带 modernTech）。
       原来无条件落地 —— 一个修仙/古代世界跨年时，货架上会长出"触屏智能手机 3000"（M9 的第 9 类）。 */
    const techOK = ((data.meta || {}).eraCode === 'nineties') || !!(data.meta && data.meta.modernTech);
    for (const t of (techOK ? (pl.tech || []) : [])) {
      if (!t || !t.name) continue;
      data.meta.techItems = data.meta.techItems || [];
      data.meta.techItems.push(Object.assign({ id: data.id('tch'), at: String(t.year || pl.year) + '-01-01T00:00:00', sold: false }, t));
    }
  }
}

// 到期+条件满足 → 落账（news→heard 视渠道；cand→候选；event→世界事实(场景日志+账本)；tech→商店货架 item 实体）
function settle(data, nowISO) {
  const cal = data.calendar || [];
  const out = [];
  for (const e of cal) {
    if (e.done) continue;
    if (!(new Date(e.at).getTime() <= new Date(nowISO).getTime())) continue;
    if (!condOk(e.condition, data)) continue;
    e.done = true;
    if (e.type === 'news') {
      /* v1.99 · P0-5 第 2 步：年度演算的新闻也过门。
         来源是 'yearly'（已排定：由世界时间与前兆链决定节奏，不看冷却），
         但**烈度上限与前兆**照样要成立；被拒的留痕，不静默消失。 */
      /* v2.03：走总线（裁决点唯一）—— 时代大事"镇上人人都在传"，所以 heard 默认开 */
      const recN = BUS.commit(data, [{ kind: 'news', source: 'yearly', level: 'L2', foreshadowRef: (e.refNews && e.refNews.id) || '',
        item: { t: e.at, title: e.title, summary: String(e.summary || '') + (e.refNews ? ('（此前就有风声——"' + e.refNews.text + '"）') : ''), tags: ['时代'], region: '青石镇', impact: { 时长: '长期', 范围: '本地区' } } }], { t: e.at });
      if (!recN.committed.length) continue;
      out.push('新闻：「' + e.title + '」');
    } else if (e.type === 'person') {
      const npc = data.entities[e.person];
      if (npc && npc.state.alive !== false) {
        const who = npc.name || 'TA';
        const t = e.at || nowISO;
        let noteTxt = '';
        if (e.what === '老态') { npc.state.ailment = '老态'; noteTxt = who + '到底也老了——走路慢了，记性也差了些。'; }
        else if (e.what === '体弱') { npc.state.ailment = '体弱'; noteTxt = who + '身子一年不如一年，柜上常备着药。'; }
        else if (e.what === '交代') { npc.state.ailment = '交代'; noteTxt = who + '开始交代身后事，把铺子/家事一样样说给人听。'; }
        else if (e.what === '离世' || e.what === '意外') {
          /* v1.99 P0-5 第 2 步：L3+ 过门（前兆 = 这条链的上一环，或计划里带的 refNews） */
          const ad2 = GATE.admitEvent(data, { source: 'chain', level: 'L3', newsSeverity: '高', kind: '事件开始', at: t, foreshadowRef: (e.refNews && e.refNews.id) || ('人事:' + who) });
          if (!ad2.ok) { GATE.noteRejected(data, ad2, { what: who + (e.what || '人事') }); e.done = false; continue; }
          GATE.noteAdmitted(data, ad2, t);
          npc.state.alive = false; npc.state.deceasedAt = t;
          data.current.pendingReplies = (data.current.pendingReplies || []).filter(p => p.from !== e.person || p.to !== 'player');
          noteTxt = (e.what === '意外' ? who + '没了——' : who + '走了——') + (e.cause || '寿终正寝') + '。' + (e.condMsg || '');
          const recN2 = BUS.commit(data, [{ kind: 'news', source: 'chain', level: 'L3', foreshadowRef: (e.refNews && e.refNews.id) || ('人事:' + who),
            item: { t: t, title: e.title || (who + (e.what === '意外' ? '意外离世' : '与世长辞')), summary: noteTxt, tags: ['人事'], region: '青石镇', impact: { 时长: '长期', 范围: '本地区' } } }], { t: t });
          if (!recN2.committed.length) { npc.state.alive = true; delete npc.state.deceasedAt; e.done = false; continue; }
        }
        if (noteTxt) {
          ledgerPush(data, { t: t, type: '人事', target: who, desc: who + '『' + (e.what || '人事') + '』' + noteTxt, cause: e.cause || null });
          data.sceneLog.push({ t: t, turn: (data.current && data.current.turnN) || 0, type: 'ambient', text: '【人事】' + noteTxt });
          out.push('人事：' + noteTxt);
        }
      }
    } else if (e.type === 'cand') {
      /* 候选是"提议"，不是已发生的事：L1 过门只为统一口径（口径一致才不会有第二条暗中绕过的路） */
      const recC = BUS.commit(data, [{ kind: 'candidate', source: 'candidate', level: 'L1', item: { text: e.summary || e.title, type: '时代', t: e.at, expireAt: RT.addMinutes(nowISO, 60 * 72) } }], { t: e.at });
      if (!recC.committed.length) continue;
      out.push('有件小事发生：' + e.title);
    } else {
      data.sceneLog = data.sceneLog || [];
      data.sceneLog.push({ t: e.at, turn: (data.current && data.current.turnN) || 0, type: 'ambient', text: '【世界变化】' + e.summary || e.title });
      out.push('世界变化：' + e.title);
    }
  }
  // tech → 商店上新（找店铺场景；生成 item 实体，玩家买=换机/新工具）
  for (const t of (data.meta.techItems || [])) {
    if (t.sold || t.injected) continue;
    if (new Date(t.at).getTime() > new Date(nowISO).getTime()) continue;
    const shop = Object.values(data.entities).find(p => p.type === 'place' && /店铺|杂货|百货|铺|店/.test(String((p.tags || []).join(' '))));
    if (!shop) continue;
    t.injected = true;
    data.entities[t.id] = { id: t.id, type: 'item', name: String(t.name).slice(0, 20), tags: ['科技'], at: shop.id, price: t.price || 99, desc: String(t.desc || '').slice(0, 60), swapDevice: { name: String(t.name).slice(0, 20), icon: t.icon || '📱', apps: (t.apps || []).slice(0, 8) } };
    out.push('商店上新：' + t.name + '（¥' + (t.price || 99) + '）');
  }
  return out;
}

// ---------- AI 自主申领（主AI 判断"此处需要一件事"→ 事件链生成器产完整链 → 插件入库按条件触发） ----------
// 每回合≤1条申领；未触发链≤2；同一世界每 12 回合最多 1 条（令牌护栏，防滥用爆量）
function summonDue(data, req) {
  if (!req) return false;
  const cal = (data.calendar || []).filter(c => c.summoned && !c.done);
  if (cal.length >= 2) return false;
  if ((data.meta.summonCount || 0) >= Math.max(1, Math.floor(((data.current.turnN || 0) + 11) / 12))) return false;
  return true;
}
// 演示/兜底：需求关键词 → 一条完整链（前兆+主体），0 token
const SUMMON_POOL = [
  { re: /外乡|客人|生人|冷清|新面孔/, pre: '镇口来了个生面孔，逢人问路，又不多说', main: '镇口那个生面孔在街角蹲了两天，后来在一户人家住了下来', mainKind: 'news' },
  { re: /雨|夜|灯|停电|暗/, pre: '线路检修的告示贴在了电线杆上', main: '晚上七点，整条老街突然停了电，人们拿出手电筒照来照去', mainKind: 'event' },
  { re: /热闹|集|节|摊|吃/, pre: '供销社进了一箱过节的货', main: '入秋的头个集日，镇口支起了十几顶帐篷，人声鼎沸', mainKind: 'news' },
  { re: /吵|架|买卖|争执|账/, pre: '有人在茶馆里为了一笔账吵了起来', main: '那笔账隔天还在吵，最后老周作保，两人各退一步', mainKind: 'event' }
];
function poolSummon(req, nowISO) {
  const k = String(req.need || req.hint || '');
  const pick = SUMMON_POOL.find(x => x.re.test(k)) || { pre: '镇子上有了点新鲜事', main: '过了几天，这事有了下文', mainKind: 'event' };
  const base = new Date(String(nowISO || req.now || '').replace('T', 'T') + 'Z');
  const preAt = new Date(base.getTime() + 36 * 3600000).toISOString().slice(0, 16) + ':00';
  const mainAt = new Date(base.getTime() + 5 * 86400000).toISOString().slice(0, 16) + ':00';
  return { pre: { at: preAt, title: pick.pre, summary: pick.pre }, main: { at: mainAt, title: pick.main, summary: pick.main, type: pick.mainKind, condition: 'always' } };
}
function epochSummonSystem() {
  return AI.withCharter([
    '你是【世界模拟器】的事件链生成器（AI-a）。主 AI 判断当前场景需要一件事发生，把你的任务发给：' + String((arguments[0] || {}).need || ''),
    '你的产出：一条完整事件链——从早期预兆（看到的人多、能被新闻写到）到主体事件（触发时间/条件），全部事件彼此因果，禁止凭空、禁止暴力。',
    '输出 JSON：{ "pre": {"at":"YYYY-MM-DDTHH:MM:00(预兆时刻,在主体前3-20天)","title":"预兆标题","summary":"一句话"}, "main": {"at":"YYYY-MM-DDTHH:MM:00","title":"事件标题","summary":"一句话","type":"news|cand|event","condition":"always|money:N|era:N|npc:id"} }'
  ].join('\n'));
}
async function summonChain(data, cfg, req) {
  if (!summonDue(data, req)) return null;
  data.meta.summonCount = (data.meta.summonCount || 0) + 1;
  let chain = null;
  if (AI.isLive(cfg)) {
    try {
      const out = await AI.llmJSONDeep(cfg, [
        { role: 'system', content: epochSummonSystem() },
        { role: 'user', content: JSON.stringify({ 需求: req, 时代: (data.meta && data.meta.eraLabel) || (data.meta && data.meta.era) || '', 在场主要人物: Object.values(data.entities).filter(x => x.type === 'person' && x.id !== 'player').slice(0, 5).map(x => x.name) }) }
      ], () => poolSummon(req, data.current.time), AI.cfgMax(cfg));
      if (out && out.__fallback) chain = out.value;
      else if (out && out.pre && out.main) chain = { pre: out.pre, main: out.main };
    } catch (e) { DEG.hit("epoch.js", e); }
  }
  if (!chain) chain = poolSummon(req, data.current.time);
  // 入库：预兆→新闻（伏笔味）；主体→calendar（由插件按条件触发）
  data.calendar = data.calendar || [];
  const preAt = String(chain.pre.at || '');
  /* v2.03：伏笔新闻也走总线（它是"前兆"，本身是 L1 —— 但同样要过门与统一落库） */
  const recPre = BUS.commit(data, [{ kind: 'news', source: 'yearly', level: 'L1', item: { t: preAt, title: String(chain.pre.title || '').slice(0, 60), summary: String(chain.pre.summary || chain.pre.title || '').slice(0, 160), tags: ['伏笔'], region: String((data.meta && (data.meta.region || data.meta.name)) || '本地').slice(0, 20), impact: { 时长: '短期', 范围: '本地' } } }], { t: preAt });
  const preId = recPre.committed.length ? String(recPre.committed[0].id || '') : '';
  const mainAt = String(chain.main.at || '');
  data.calendar.push({ id: data.id('evt'), at: mainAt, title: String(chain.main.title || '').slice(0, 60), summary: String(chain.main.summary || '').slice(0, 200), type: chain.main.type || 'event', condition: chain.main.condition || 'always', done: false, year: parseInt(mainAt.slice(0, 4), 10) || 1996, summoned: true, refNews: { id: preId, text: String(chain.pre.title || chain.pre.summary || '').slice(0, 120) } });
  return { pre: chain.pre, main: chain.main, count: data.meta.summonCount };
}

module.exports = { catchup, settle, PRESET, epochSystem, condOk, pagePersonLifecycle, summonChain, summonDue };
