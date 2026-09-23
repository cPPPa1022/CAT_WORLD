// knowledge.js — 知识三档尺子（v1.55）
// ─────────────────────────────────────────────────────────────
// 设计见《设计总稿.md》§28.11 A2。用户 2026-09-14 点出 A 是**双向**问题：
//   不只是"AI 查不到"，还有"玩家看到了不该看的"。判据就是这一把尺子：
//     **确知**（登记过：knowledge / impressions / knownDocs / heardNews / visited）→ 可以写进画面
//     **可推断**（从已知 + 常识一步能到）→ 也可以写（★ 从宽认定：宁可放过，不可僵硬）
//     **秘密**（都不能）→ 不许出现在任何要进玩家界面的文本里
// 用途：① 查询协议的门控 ② 输出侧门控的负面清单（哪些名字不许写出来）
'use strict';

const TIERS = ['known', 'inferable', 'secret'];
function t(name) { return name; }

// 人物：名字门控与 viewName 同一把尺子（印象 stage>=2 才算"知道名字"）
function person(data, id) {
  const e = data.entities && data.entities[id];
  if (!e || e.type !== 'person') return { tier: 'secret', as: '', why: '没有这个人' };
  const imp = (data.impressions || {})[id] || null;
  const stage = imp ? (imp.stage || 0) : 0;
  const known = ((data.knowledge || {}).knownPeople || []).indexOf(id) >= 0;
  /* v1.97 ★ 修 X2/X3（评审回执_v1.96 挖出，两份外部评审都没发现）：
     原来只看"**有没有印象档这一行**"—— 而 v1.30 的载入迁移给**每个 person** 都建了行
     （v1.88 的"回合开头播种"又让它变成普遍状态）⇒ **secret 这一档永远不可达** ⇒
     输出侧门控对人物永远不启用"不许出现"那一支；人物面板也会列出世上每一个 NPC。
     现在按"**玩家到底知道什么**"判：stage≥1 或见过(seen 是文本) 才算见过。
     只有一行空档（stage 0 / seen 空 / nameKnown 只是数据字段）等同"没印象"。
     注意：**不能把 nameKnown 当成"见过"的证据** —— ensureImp 播种时会把它填成人名。 */
  const seenTxt = (imp && typeof imp.seen === 'string') ? imp.seen.trim() : '';
  const saw = !!(imp && ((imp.stage || 0) >= 1 || seenTxt));
  if (!saw && !known) return { tier: 'secret', as: '', why: '你没见过这个人' };
  if (stage >= 2 && imp.nameKnown !== false) return { tier: 'known', as: e.name || '', why: '印象 stage ' + stage + '（知道名字）' };
  // 见过面但还叫不出名字 → 可推断（**只能用看得见的样子指代**）
  const look = (imp && imp.seen) || ((e.profile || {}).appearance || {}).标志物 || '';
  return { tier: 'inferable', as: look ? ('一个' + String(look).slice(0, 20) + '的人') : '一个见过面的人', why: '见过，但你还不知道 TA 的名字', mustNot: e.name || '' };
}
// 文书：只有 knownDocs 里的才算"你手上有"
function doc(data, id) {
  const d = (data.documents || {})[id];
  if (!d) return { tier: 'secret', as: '', why: '没有这份文书' };
  const owned = ((data.knowledge || {}).knownDocs || []).indexOf(id) >= 0;
  return owned ? { tier: 'known', as: d.title || '', why: '在你手上' } : { tier: 'secret', as: '', why: '这份文书你还没见过' };
}
// 地点
function place(data, id) {
  const p = data.entities && data.entities[id];
  if (!p || p.type !== 'place') return { tier: 'secret', as: '', why: '没有这个地方' };
  const k = data.knowledge || {};
  if ((k.visited || []).indexOf(id) >= 0) return { tier: 'known', as: p.name || '', why: '你去过' };
  if ((k.knownPlaces || []).indexOf(id) >= 0) return { tier: 'known', as: p.name || '', why: '你听说过/在地图上' };
  // 同地区 → 可推断（你在青石镇，就知道青石镇还有别的地方）
  const here = (data.entities[data.current && data.current.sceneId] || {}).geo || [];
  const there = p.geo || [];
  if (here.length && there.length && here[there.length - 1] === there[there.length - 1]) return { tier: 'inferable', as: p.name || '', why: '和你现在在同一个地方（' + there[there.length - 1] + '）' };
  return { tier: 'secret', as: '', why: '你没去过、也没听说过' };
}
/* ---------- 新闻的"影响"三字段（v1.97 · X8） ----------
   设计总稿 §174 要求每条事件/新闻带 {时长, 严重性, 范围}。此前它们是**写了没人读**的死字段
   （impact 写 6 处 / 读 0 处）。死字段比没有字段更坏 —— 它让人以为这件事已经在运转了。
   现在逐个交代：
     · 时长 → **真用**：新闻有保质期。瞬间=1 天 / 短期=7 天 / 长期=90 天。过了期的仍留在
       data.news（那是世界记忆，不删），只是不再算"近况"（newsCurrent）。
     · 范围 → **真用**：它是**门控输入**。个人圈=别人的私事，没落到你耳朵里就是 secret；
       本地区=得落在你这一带；全国/世界=这么大的事到处都在传（inferable）。
     · 严重性 → **砍掉**：烈度轴已经由 news.severity + 世界烈度上限（P0-5 闸门）承担，
       再开第二个"严重性"就是第二个真相源。所以 impact 只有两个字段。
   合法取值只在这里定义，别处一律走这里的函数 —— 否则又是"两套尺子"。 */
/* 新闻严重性（**上屏那一根轴**）：低/中/高/灾难。它和事件的 L 级不是一回事 ——
   这里管"这条消息看上去多要紧"，L 级管"引擎放不放行"。两轴的桥在 contract.levelFromNews。 */
const NEWS_SEV = ['低', '中', '高', '灾难'];
function newsSeverity(x) { const s = String(x == null ? '' : x).trim(); return NEWS_SEV.indexOf(s) >= 0 ? s : ''; }

const NEWS_LIFE = { 瞬间: 1440, 短期: 10080, 长期: 129600 };   // 分钟
const NEWS_SCOPES = ['个人圈', '本地区', '全国', '世界'];
function newsScope(n) {
  const s = String(((n && n.impact) || {})['范围'] || '').trim();
  if (NEWS_SCOPES.indexOf(s) >= 0) return s;
  if (/个人|私人|家事|私下/.test(s)) return '个人圈';
  if (/全国|国内|国家/.test(s)) return '全国';
  if (/世界|全球|国际/.test(s)) return '世界';
  return '本地区';            // 含旧值"本地"、空值、以及一切认不出来的 —— 就是旧的默认行为
}
function newsLifeMin(n) {
  const d = String(((n && n.impact) || {})['时长'] || '').trim();
  return NEWS_LIFE[d] || NEWS_LIFE['短期'];
}
/* 还在的新闻：你听闻过的 ∩ 没过保质期的，按时间倒序。
   注意方向 —— 原来的 news.slice(0, 5) 在追加序的数组上取的是**最早**的五条，
   于是"近况"里躺着的是开局的旧闻。坏数据一律**倾向显示**（算不出年龄的就当它新）：
   藏起一条新闻比多显示一条更糟。 */
/* 时间倒序。**不能用 localeCompare** —— 它跟着运行环境的语言走，同一份存档在两台机器上
   可能排出两种顺序，而本项目要的是确定性：这里一律 parse 成毫秒数再比。
   解析不出来的（时间坏掉）排最后：它只是"没时间"，并不等于"最新"。 */
function cmpIsoDesc(a, b) {
  const ms = (o) => { const n = new Date(String((o && o.t) || '')).getTime(); return isNaN(n) ? null : n; };
  const x = ms(a), y = ms(b);
  if (x === null || y === null) return x === null ? (y === null ? 0 : 1) : -1;
  return y - x;
}
function newsCurrent(data, nowIso, limit) {
  const now = nowIso || ((data.current || {}).time) || '';
  const heard = ((data.knowledge || {}).heardNews) || [];
  return (data.news || [])
    .filter(n => n && heard.indexOf(n.id) >= 0)
    .filter(n => {
      if (!now || !n.t) return true;
      const ageMin = (new Date(now) - new Date(n.t)) / 60000;
      return !(ageMin > newsLifeMin(n));
    })
    .sort(cmpIsoDesc)
    .slice(0, limit || 5);
}
// 新闻 / 传闻（复用既有的 tier：public / rumor / secret）
function newsItem(data, id) {
  const n = (data.news || []).find(x => x.id === id);
  if (!n) return { tier: 'secret', as: '', why: '没有这条新闻' };
  const heard = ((data.knowledge || {}).heardNews || []).indexOf(id) >= 0;
  if (heard) return { tier: 'known', as: n.title || '', why: '你听说过' };
  const scope = newsScope(n);
  // 个人圈：别人的私事 —— 哪怕就发生在隔壁，没人跟你说，你就是不知道
  if (scope === '个人圈') return { tier: 'secret', as: '', why: '这是别人的私事，没人跟你提过' };
  // 全国/世界：这种事靠广播、报纸、街头口耳相传，谁都听过一耳朵
  if (scope === '全国' || scope === '世界') return { tier: 'inferable', as: n.title || '', why: '这么大的事，消息到处都是' };
  const region = String(n.region || '');
  const here = ((data.entities[data.current && data.current.sceneId] || {}).geo || []).join('');
  if (region && here && here.indexOf(region) >= 0) return { tier: 'inferable', as: n.title || '', why: '就发生在你这一带' };
  return { tier: 'secret', as: '', why: '跟你没关系，你也没听说' };
}
// 通用入口
function check(data, kind, id) {
  if (kind === 'person') return person(data, id);
  if (kind === 'doc') return doc(data, id);
  if (kind === 'place') return place(data, id);
  if (kind === 'news') return newsItem(data, id);
  return { tier: 'secret', as: '', why: '尺子不认识这一类：' + kind };
}
// ⭐ 输出侧门控用的**负面清单**：哪些名字**不许**出现在要进玩家界面的文本里
function mustNotSay(data) {
  const out = [];
  for (const id of Object.keys(data.entities || {})) {
    const e = data.entities[id];
    if (!e || e.type !== 'person' || id === 'player') continue;
    const r = person(data, id);
    if (r.tier === 'secret' && e.name) out.push(e.name);
    else if (r.tier === 'inferable' && r.mustNot) out.push(r.mustNot);
  }
  return out;
}
// 一段文本里出现了不该出现的名字吗？（给输出侧门控用；返回命中的名字）
function leaks(data, text) {
  const s = String(text || '');
  if (!s) return [];
  const hit = [];
  for (const nm of mustNotSay(data)) {
    if (nm && nm.length >= 2 && s.indexOf(nm) >= 0) hit.push(nm);
  }
  return hit;
}
module.exports = { TIERS, check, person, doc, place, newsItem, mustNotSay, leaks, newsScope, newsLifeMin, newsCurrent, NEWS_LIFE, NEWS_SCOPES, NEWS_SEV, newsSeverity };
