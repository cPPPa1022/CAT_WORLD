// accounts.js —「钱与账」的唯一真源（v3.20）
// ─────────────────────────────────────────────────────────────
// 为什么会有这个文件（用户实测 OOC，2026-09-27 那局「都市神壕之我爱装逼」）：
//   玩家说「给房东先把欠的房租和这个月的房租转过去」，AI 演了一整段转账 —— 打开银行 App、
//   输金额、拇指悬在「确认」上，然后被一个凭空冒出来的「房东王师傅」敲门打断。
//   存档里：money.spent 还是 0、余额一分没动，而账本里写着「欠租结清…钱已出账」。
//   根因两条都在引擎这一侧：
//     ① 钱**没有 AI 的写入路径** —— UPDATE_TYPES 里一条钱的类型都没有，applyUpdates 里也没有分支；
//     ② 资料包里**根本没有钱包** —— AI 只能从「你的身份」那句散文里猜（它照着卡里的
//        "当前现金余额1,001,234元"写，而引擎的钱包是 15000 + 12000）。
//   这个文件只管两件事：**归一金额**、**找到某一笔账**。
//   为什么单独一个文件：校验器（放不放行）与执行器（真的改世界）都要用同一套判据 ——
//   两处各写一份，迟早对不上（这个项目最老的一个毛病，见 contract.js 的开头）。
'use strict';

/* 金额归一：2400 / "2400" / "2,400元" / "¥2400" → 2400；认不出来 → 0（0 一律当"没写"）。
   为什么不在各处 parseFloat：AI 写 "2400元" 是常态，parseFloat 在那儿是对的、
   在 "¥2,400" 上是 0 —— 同一个字段两种结局，就是"静默降级"。 */
function amountOf(x) {
  const s = String(x == null ? '' : x).replace(/[^\d.]/g, '');
  const n = Number(s);
  return (isFinite(n) && n > 0) ? Math.round(n * 100) / 100 : 0;
}

function ensure(data) {
  if (!data) return [];
  if (!Array.isArray(data.accounts)) data.accounts = [];
  return data.accounts;
}

// 只读：账目表（不建、不写 —— 读路径不该改存档）
function all(data) {
  return (data && Array.isArray(data.accounts)) ? data.accounts : [];
}
// 没结清的账（可选按"谁"过滤）
function openOf(data, who) {
  const list = all(data).filter(x => x && x.status !== 'settled');
  const w = String(who || '').trim();
  return w ? list.filter(x => String(x.who || '') === w) : list;
}

/* 找"这一笔说的是哪条账"：id 优先 → 谁 → 谁+什么事。
   找不到 = 没有这条账（**别凭空结清**）；同时只认"没结清的"账。 */
function find(data, u) {
  const list = openOf(data, '');
  if (!list.length) return null;
  const id = String((u && (u.account || u.accId || u.acc)) || '').trim();
  if (id) { const a = list.find(x => String(x.id) === id); if (a) return a; }
  const who = String((u && (u.who || u.to || u.from || u.target)) || '').trim();
  const what = String((u && u.what) || '').trim();
  /* 指明了"是谁"（id 或名字，AI 两种都可能写）→ 只在那个人的账里找；
     一个人都没匹配上 = **没有这条账**（原来这里会回落到"所有账"，于是"结清沈姨的账"
     能把张三的账销掉 —— 静默的错账比拒掉它糟得多）。 */
  const cands = who ? list.filter(x => String(x.who || '') === who || (x.name && String(x.name) === who)) : list;
  if (who && !cands.length) return null;
  if (what && cands.length > 1) {
    const hit = cands.find(x => { const w = String(x.what || ''); return !!w && (w.indexOf(what) >= 0 || what.indexOf(w) >= 0); });
    if (hit) return hit;
  }
  return cands[0] || null;
}

/* 玩家侧那一栏（三投影的第三投影）：账目本身就是"你知道的事"，不门控；
   但**名字**仍然要走门控（viewName）—— 所以这里只给 id 与金额，名字由 game.js 用同一把尺子填。 */
function view(data) {
  return all(data).map(a => ({
    id: a.id, dir: a.dir || 'owe', who: a.who || '', name: a.name || '',
    amount: Number(a.amount) || 0, currency: a.currency || '元',
    what: a.what || '', due: a.due || '', status: a.status || 'open', t: a.t || ''
  }));
}

module.exports = { amountOf: amountOf, ensure: ensure, all: all, openOf: openOf, find: find, view: view };
