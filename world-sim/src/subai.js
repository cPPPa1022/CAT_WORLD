// subai.js — 副 AI 三件套（计算/编辑/摘要）：只读结构化事件流，输出小 JSON；失败回退代码版/跳过
// v1.7：多 AI 协同（设计总稿 §5）：副 AI-计算=事件候选；副 AI-编辑=新闻/概况；副 AI-摘要=离线简报
'use strict';
const DEG = require('./degraded');
const { ledgerPush } = require('./store');   // v1.98 P0-3：账本只有这一个写入入口
const AI = require('./ai');
const RT = require('./runtime');

// ---------- 副 AI-计算：镜头外的事件候选（≤3 条；与环境/世界基调一致） ----------
function calcNeed(data, opts) {
  const n = (data.current.turnN || 0);
  if (opts && opts.sleeping) return true;
  return n > 0 && n % 5 === 0;
}
async function subCalc(data, cfg, opts) {
  if (!AI.isLive(cfg) || !calcNeed(data, opts)) return [];
  try {
    const scene = data.entities[data.current.sceneId] || {};
    const here = Object.values(data.entities).filter(e => e.type === 'person' && e.id !== 'player' && e.state && e.state.location === data.current.sceneId).map(e => e.name || e.id);
    const lastLedger = (data.ledger || []).slice(-8).map(l => (l.t || '').slice(5, 16) + ' ' + (l.type || '') + ' ' + (l.desc || ''));
    const input = {
      当前: { 时间: data.current.time, 地点: scene.name || '某处', 天气: data.current.weather, 在场: here },
      最近事件: lastLedger,
      世界基调: (data.meta && data.meta.era) || '', 烈度上限: (data.meta && data.meta.maxSeverity) || 'L2'
    };
    const out = await AI.llmJSON(cfg, [
      { role: 'system', content: AI.withCharter('你是【世界模拟器】的副 AI-计算。输入结构化世界快照（不含正文与对话）。只输出事件候选 JSON：{"candidates":[{"text":"一句话候选","type":"环境|遭遇|日常","expireM":分钟数,"sev":"低"}]}，1~3 条。候选必须贴合世界基调与在场人物，烈度不超过 L2（日常/小冲突），禁止重大事件凭空发生，禁止编造已有事实。除了"不越边界"之外，选什么题材、怎么描写、什么时候合适，都由你自行判断——没有注明的地方就是你的自由。') },
      { role: 'user', content: JSON.stringify(input) }
    ], () => null, AI.cfgMax(cfg));
    if (!out || out.__fallback || !Array.isArray(out.candidates)) return [];
    return out.candidates.slice(0, 3);
  } catch (e) { return []; }
}

// ---------- 镜头外并发（世界多线运转）：不在场的 NPC 之间也在发生事 ----------
const OFFSTAGE = {
  modern: ['隔壁铺子进了一批新货，老板娘逢人就夸', '巷口的修车摊接了个大活，师傅加班到半夜', '有人往墙根搁了两箱啤酒，到第二天也没人认领'],
  brick: ['修车铺昨天来了个年轻人，说要拜师学艺', '老茶馆的老周把棋摊搬到了门口，方便街坊路过', '沈姨家的租客前天搬走了，今天又来了新一户'],
  ancient: ['打更的老刘多喝了两盅，二更才打', '药铺进了批新药，掌柜捂着没声张', '驿站的马换了一匹，拴在了老槐树下'],
  default: ['镇上有户人家办了席面，路过的都给糖', '有人在井台边落了顶帽子，第二天还在']
};
function offstageFor(data) {
  const era = String((data.meta && data.meta.era) || '');
  const pool = /修|仙|志怪|灵|古|旧时|不知年月/.test(era) ? OFFSTAGE.ancient : (/九十|大哥大|199/.test(era) ? OFFSTAGE.brick : OFFSTAGE.modern);
  return pool[Math.floor(Math.random() * pool.length)];
}
// 触发节奏：每 7 回合 或 跳跃（时间大跳）
function offstageDue(data, opts) {
  const n = (data.current && data.current.turnN) || 0;
  if (opts && opts.sleeping) return true;
  return n > 0 && n % 7 === 0;
}
// 镜头外并发事件：**玩家不可见的内容 = 纯代码池，0 token**（AI 只花在玩家可能感知的线上）
async function subOffstage(data, cfg, opts) {
  if (!offstageDue(data, opts)) return [];
  try {
    const txt = offstageFor(data);
    const off = Object.values(data.entities).filter(x => x.type === 'person' && x.id !== 'player' && (!x.state || x.state.location !== data.current.sceneId));
    const who = off.length ? off[Math.floor(Math.random() * off.length)] : null;
    ledgerPush(data, { t: data.current.time, type: '镜头外事件', target: (who && who.name) || '镇子', desc: txt, cause: null });
    // v1.96：引擎自写 → 按标签限量（不经内容门）
    if (who) { try { RT.writeMemory(data, { owner: who.id, content: txt, tags: ['镜头外'], impact: 12, t: data.current.time }, { by: 'engine' }); } catch (e2) { DEG.hit("subai.js", e2); } }
    return [txt];
  } catch (e2) { return []; }
}

// ---------- 副 AI-编辑：每日 07:20-07:50 一次；输入事件流→新闻条目 ----------
function editDue(data, nowIso) {
  if (!data.meta) return false;
  const day = RT.dayKey(nowIso);
  if (data.meta.lastEditDay === day) return false;
  const h = RT.hourOf(nowIso);
  // 每日窗口：07:20~07:50；错过窗口则顺延到任意 07:20 之后（当天只补一次）
  if (h < 7 || (h === 7 && parseInt(String(nowIso).slice(14, 16), 10) < 20)) return false;
  return true;
}
async function subEdit(data, cfg, nowIso) {
  if (!data.meta) return [];
  if (!editDue(data, nowIso)) return [];
  data.meta.lastEditDay = RT.dayKey(nowIso); // 当天只产一次（无论成败，防重复刷）
  if (!AI.isLive(cfg)) return [];
  try {
    const dayStart = RT.addMinutes(String(nowIso).slice(0, 16) + ':00', -24 * 60);
    const stream = (data.ledger || []).filter(l => l.t >= dayStart && (l.type !== '交易拒绝')).slice(-20).map(l => ({ 时间: (l.t || '').slice(5, 16), 类型: l.type, 内容: l.desc }));
    if (!stream.length) return [];
    const out = await AI.llmJSON(cfg, [
      { role: 'system', content: AI.withCharter('你是【世界模拟器】的副 AI-编辑。输入近 24 小时事件流（结构化）。只输出 JSON：{"news":[{"title":"标题","summary":"一句话摘要","tags":["标签"],"region":"区域","severity":"低|中|高|灾难（高/灾难=重大事件，必须此前有过风声/前兆，否则会被引擎拦下）","impact":{"时长":"瞬间|短期|长期","范围":"个人圈|本地区|全国|世界"}}]}，0~5 条。只收录值得传的（重要度≥中或与玩家相关）；与既有世界事实冲突的不要写；严重性超过世界烈度上限的不要写。除此之外——哪条值得报道、怎么起标题、用什么措辞，由你自行判断，没有注明的就是你的自由。') },
      { role: 'user', content: JSON.stringify({ 世界: (data.meta && data.meta.name) || '', 时代: (data.meta && data.meta.era) || '', 烈度上限: (data.meta && data.meta.maxSeverity) || 'L2', 事件流: stream }) }
    ], () => null, AI.cfgMax(cfg));
    if (!out || out.__fallback || !Array.isArray(out.news)) return [];
    return out.news.slice(0, 5);
  } catch (e) { return []; }
}

// ---------- 副 AI-摘要：睡眠跳跃时"不在场简报" ----------
async function subDigest(data, cfg, sinceIso) {
  if (!AI.isLive(cfg)) return null;
  try {
    const stream = (data.ledger || []).filter(l => l.t >= sinceIso).slice(-20).map(l => ({ 时间: (l.t || '').slice(11, 16), 类型: l.type, 内容: l.desc }));
    const msgs = (data.messages || []).filter(m => m.t >= sinceIso && m.to === 'player' && m.body).map(m => m.body);
    const out = await AI.llmJSON(cfg, [
      { role: 'system', content: AI.withCharter('你是【世界模拟器】的副 AI-摘要。玩家睡着了。输入玩家睡着期间的结构化事件与消息。输出 JSON：{"digest":"200字以内中文简报：你睡着/离开期间，世界发生了什么与你（可能）相关的事；没有则不写"}。简报里挑什么、怎么说，由你自行判断——没有注明的地方就是你的自由。') },
      { role: 'user', content: JSON.stringify({ 事件: stream, 消息: msgs }) }
    ], () => null, AI.cfgMax(cfg));
    if (!out || out.__fallback || !out.digest) return null;
    return String(out.digest).slice(0, 400);
  } catch (e) { return null; }
}

module.exports = { subCalc, subEdit, subDigest, subOffstage };
