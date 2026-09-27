/* board.js —「世界的现在」（UX v4 · 2026-09-19）

   v3 的问题（用户原话）："有点对了 但是没有主次之分"。
   原因是我给**每一块都套了同样的卡片底色** —— 卡片一出现，重量就拉平了，
   于是'钱 52 元'和'沈姨说了什么'看起来一样重要。

   v4 定死一条层次律（位置 + 字号 + 亮度 + 留白，四样一起用，不许只靠颜色）：

    ① 世界带（最上，一行读数，13px 最暗，无卡片）—— 处境，扫一眼就够
    ② 焦点区（主体，最大最亮，无卡片）—— 谁在场、说了什么、做了什么；
       本回合最后开口的人是主角（名字 21px 琥珀 / 台词 20px 最亮），其余人降一档；
    ③ 氛围区（最下，13px 更暗）—— 环境音、旁白、镇上在传；
    ④ 更早（折叠一行）

   一句话：**屏幕只有一处最亮，其余都往后退。**

   退回旧版：?stream（流式叙事）
*/
(function () {
  'use strict';
  if (/(\?|&)stream/.test(location.search)) return;
  if (typeof window.renderStage !== 'function') return;

  const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const txt = (x) => String(x == null ? '' : x).trim();

  function compact(bb) {
    const t = bb.type;
    if (t === 'dialogue') return txt(bb.speakerName || bb.speaker) + ' 「' + txt(bb.text) + '」';
    if (t === 'action') return txt(bb.actorName || bb.actor) + ' ' + txt(bb.text);
    if (t === 'ambient') return '环境 ' + txt(bb.text);
    if (t === 'user-action') return '你 ' + txt(bb.text);
    if (t === 'outcome') return '▸ ' + txt(bb.text);
    if (t === 'stage-tag') return txt(bb.text);
    return txt(bb.text);
  }
  const who = (bb) => txt(bb.speakerName || bb.speaker || bb.actorName || bb.actor);
  const count = (n, unit) => n + ' ' + unit;

  function cue(k, v, cls) {
    v = txt(v); if (!v) return null;
    const row = h('div', 'bs' + (cls ? ' ' + cls : '') + (k ? '' : ' nok'));
    if (k) row.appendChild(h('span', 'bs-k', k));
    row.appendChild(h('span', 'bs-v', v));
    return row;
  }

  /* 走路时间 → 人话（不写"6 分"：人心里不是这么记路的） */
  function walkWords(min) {
    const m = Number(min) || 0;
    if (!m) return '就在附近';
    if (m <= 2) return '几步路';
    if (m <= 7) return '走几分钟';
    if (m <= 15) return '得走一刻钟';
    return '要走小半个钟头';
  }
  /* 身体状态 → 人话（不写"疲劳 低"：没人这样感觉自己的身体） */
  function bodyWords(st) {
    const out = [];
    const f = String((st && st.fatigue) || '');
    const h = String((st && st.hunger) || '');
    const s = String((st && st.sleep) || '');
    if (/高|重/.test(f)) out.push('有点撑不住了');
    else if (/中/.test(f)) out.push('有点乏');
    if (/高|重/.test(h)) out.push('饿得慌');
    else if (/中/.test(h)) out.push('肚子空着');
    if (/不足|缺|差/.test(s)) out.push('昨晚没睡够');
    return out.join('，');
  }
  /* ── ① 当前状态简介（用户 2026-09-27：「最上面的随身 去路 我 做成当前状态简介介绍
     （补齐需要的东西 这些东西不够）」「这个是每回合都会自己更新吗」「而且这个一直在最上面
     每次想看的时候都要翻到最上面？」）─────────────────────────────────────────────
     三件事一起改：
       · **补齐**：原来只有 在场/货架/随身/去路/我，钱只写现金、没有账目、没有时间地点与身份；
       · **每回合都刷新**：每一回合都由 V（这一回合的存档投影）重画一遍；值变不变，取决于世界
         有没有真的落账（钱由引擎按 tryPay/tryEarn 改，账目由 账目/钱款变动 两条 Update 落）；
       · **不用翻到最上面**：搬到滚动区**之外**（#brief）常驻在叙事流上方，点一下收起。
     仍然只放"你知道的"：去路只列认识的地方；账目上的名字在游戏侧已走同一把门控尺子。 */
  function brief() {
    const rows = [];
    /* ① 现在：什么时候 · 在哪儿 · 天什么样（天气没看见就不写"看见"了） */
    const time = (V && V.time) || {};
    const wx = (V && V.weather) || {};
    const nowTxt = [txt(time.label) + (time.precise ? '' : '（体感）'), txt((V && V.place) && V.place.name),
      (wx.seen ? txt(wx.text) : txt((V && V.weatherCue) || ''))].filter(Boolean).join(' · ');
    if (nowTxt) rows.push(['现在', nowTxt]);
    const cast = ((V && V.cast) || []).filter(x => x && x.id !== 'player');
    if (cast.length) rows.push(['在场', cast.map(x => txt(x.name)).filter(Boolean).join('　')]);
    const shop = (V && V.shop) || [];
    if (shop.length) rows.push(['货架', shop.slice(0, 4).map(it => txt(it.name) + (it.price ? ' ¥' + it.price : '')).join('　')]);
    /* ② 我：这个人是谁 —— 只写"他自己知道、也感觉得到"的（身份/职业/情绪/身体） */
    const mev = (V && V.me) || {};
    const idn = mev.identity || {};
    const mine = [];
    const myName = txt(mev.name);
    if (myName && myName !== '你') mine.push(myName);
    if (txt(idn.年龄)) mine.push(txt(idn.年龄));
    if (txt(idn.身份)) mine.push(txt(idn.身份));
    else if (txt(idn.职业)) mine.push(txt(idn.职业));
    if (txt((mev.state || {}).mood)) mine.push(txt(mev.state.mood));
    const bw = bodyWords(mev.state || {});
    if (bw) mine.push(bw);
    if (mine.length) rows.push(['我', mine.join(' · ')]);
    /* ③ 钱与账（v3.20）：**现金与电子分开写**，欠着的一笔笔列出来 ——
       用户那次 OOC 的一半就出在这里：界面上只写"兜里 15000 元"，
       而世界里的钱（现金/电子）与"欠着谁多少"从来没有一处摆齐过。 */
    const money = (V && V.money) || null;
    if (money) {
      const cur = txt(money.currency) || '元';
      const wallet = ['现金 ' + (money.cash || 0) + cur];
      if (money.digital) wallet.push('电子 ' + money.digital + cur);
      rows.push(['钱', wallet.join('　')]);
    }
    const accs = ((V && V.accounts) || []).filter(a => a && a.status !== 'settled');
    const accTxt = (a) => txt(a.name || a.who || '？') + ' ' + (a.amount || 0) + txt(a.currency || '元')
      + (txt(a.what) ? '（' + txt(a.what) + (txt(a.due) ? ' · ' + txt(a.due).slice(5) + ' 前' : '') + '）' : '');
    const owe = accs.filter(a => a.dir !== 'owed');
    const owed = accs.filter(a => a.dir === 'owed');
    if (owe.length) rows.push(['欠着', owe.slice(0, 4).map(accTxt).join('　')]);
    if (owed.length) rows.push(['被欠', owed.slice(0, 4).map(accTxt).join('　')]);
    /* ④ 随身：**列全**（原来越界 slice(0,6)，多了会被悄悄砍掉） */
    const inv0 = (V && V.inventory) || [];
    const invNames0 = inv0.map(x => txt(x && x.name ? x.name : x)).filter(Boolean);
    if (invNames0.length) rows.push(['随身', invNames0.join('　')]);
    /* ⑤ 去路：只列**你知道的**地方，不标"去过/没去过" —— 那是本局的足迹，不是这个人的经历。 */
    const place = (V && V.place) || {};
    const nodes = (V && V.map) || [];
    const here = nodes.filter(n => n && n.id === place.id)[0];
    if (here && (here.edges || []).length) {
      rows.push(['去路', here.edges.slice(0, 4).map(e => {
        const to = nodes.filter(n => n && n.id === e.to)[0];
        return txt(to ? to.name : e.to) + '（' + walkWords(e.minutes) + '）';
      }).join('　')]);
    }
    /* ⑥ 悬着的事：**照数据原样写**（name 是事情本身，如"口角"；why 是原因，常常为空）。
       不编"还欠着一句"这类句子 —— 那是替世界加戏。 */
    const dayWords = (x) => { const s = txt(x && x.t).slice(5, 10); return s ? '（' + Number(s.slice(0, 2)) + '月' + Number(s.slice(3, 5)) + '日）' : ''; };
    const loose = (V && V.loose) || [];
    const looseTxt = loose.slice(0, 3).map(x => txt(x && x.name) + (x && x.why ? '——' + txt(x.why) : '') + dayWords(x)).filter(Boolean).join('　');
    if (looseTxt) rows.push(['悬着', looseTxt]);
    if (!rows.length) return null;
    /* 收起时只留第一行（"现在"）。状态存在本地：收起过一次，下次进来还是收起的。 */
    let closed = false;
    try { closed = localStorage.getItem('ws_brief_closed') === '1'; } catch (e) { closed = false; }
    const box = h('div', 'bband' + (closed ? ' closed' : ''));
    rows.forEach((r, i) => {
      const row = h('div', 'brow' + (i === 0 ? ' brow-now' : ' bd'));
      const k = h('span', 'brow-k', r[0]);
      if (i === 0) {
        k.textContent = (closed ? '▸ ' : '▾ ') + r[0];
        k.classList.add('bhead');
        k.title = closed ? '展开当前状态简介' : '收起当前状态简介';
        k.onclick = function () {
          const c = box.classList.toggle('closed');
          try { localStorage.setItem('ws_brief_closed', c ? '1' : '0'); } catch (e) {}
          k.textContent = (c ? '▸ ' : '▾ ') + r[0];
          k.title = c ? '展开当前状态简介' : '收起当前状态简介';
        };
      }
      row.appendChild(k);
      row.appendChild(h('span', 'brow-v', r[1]));
      box.appendChild(row);
    });
    return box;
  }

  /* ② 焦点区 / ③ 氛围区（focusArea / ambientArea）**已删**（v3.3）。
     它们是 v2.13 之前"按人聚合 + 折叠"那一版的渲染，v2.14 上了块流（oneBlock）之后
     **全文再没有任何调用点**（renderBoard 只用 band / oneBlock / who）。留着它们的代价这次真撞上了：
       · 里面**另有一份 outcome 的渲染**（cue('▸', bb.text, 'out')），和块流里那份不一致 ——
         我这次修「结果行太暗」时，第一眼看的就是这一份，差点改在死码上。
       · 它们引用的 .bfocus / .bamb / .bs.out 样式还挂在 board.css 里（同批删掉），
         留着就是"屏幕上永远不出现、但永远有人维护"的第二套版式。 */

  /* ★ v2.14 **块流**（用户原话）：
     「每一个块生成好了就是**固定死了**的，不会再新增内容；接下来的块在下面继续做。」
     所以渲染必须是**无状态**的：只按 log 的顺序铺，一块一块往下堆，画完就不动。
     —— 原来按「人」聚合（focusArea 把某个人本幕说的做的全捞进同一块），于是屏幕上不是对话流，
        而是"按人分的资料卡"：秀秀说的三句话挤在一起，中间孙福来说了什么完全看不出来。
        **时间顺序被打散** = 用户说的"乱、无脑堆叠"；不在 cast 里的人则**整块消失** = "信息不全"。
     现在：talk/action 一人一块、旁白一块、环境一块；先来先排，后面往下接。 */
  function oneBlock(bb) {
    const t = bb.type;
    if (t === 'stage-tag') return h('div', 'bstage', txt(bb.text));
    if (t === 'ambient' || t === 'narration') {
      /* ★ v3.5：旁白/环境也走 cue() —— 不只是为了加标签，更是为了让**标签列对齐**。
         原来它们是一根光秃秃的 .bs-v（没有 .bs 这层 flex 父级），左边没有 46px 的标签列，
         于是它们的正文比台词靠左 46px，"列"根本不成列。 */
      const isAmb = (t === 'ambient');
      const bx = h('div', 'bnarr' + (isAmb ? ' amb' : ''));
      const s = cue(isAmb ? '环境' : '旁白', txt(bb.text), 'narr' + (isAmb ? ' amb' : ''));
      if (s) bx.appendChild(s);
      return bx;
    }
    const isMe = (t === 'user-action' || t === 'outcome');
    const blk = h('div', 'bperson' + (isMe ? ' mine' : ''));
    const nm = isMe ? '你' : who(bb);
    if (nm) { const head = h('div', 'bname-row'); head.appendChild(h('span', 'bname', nm)); blk.appendChild(head); }
    /* ★ v3.5：玩家那一行的文字里**带着「你: 」前缀**（sceneLog 里就是这么存的），
       而块头已经有一个「你」的名字行 + 一个「动作」标签 ⇒ 屏幕上三次说"这是你"：
       「你 / 动作 / 你: 嗯嗯 请进请进」。资料包那一侧早就剥掉了这个前缀
       （ai.js 的「最近场景原文」那一行做了剥离），界面这边漏了。
       ⚠️ 这里**不要写那条正则的字面量**：它里面有 `*` 加 `/`，放进块注释会把注释提前闭合。 */
    const body = (v) => { const s = txt(v); return isMe ? s.replace(/^你\s*[:：]\s*/, '') : s; };
    if (t === 'dialogue') {
      /* ★ v3.5 修（用户原话：「一行行的字的区分只有字号不同 颜色基本看不出差别
         很难区分这些是干什么的」）——
         `cue(k, v, cls)` 的第一个参数 k 就是「这一行是什么」的标签槽，
         而这里**三个调用点全传了空串** ⇒ `board.css` 里那条专为它写的版式
         （`.bs-k`：40px 固定列 + 字距 + user-select:none）**一次都没渲染过**。
         于是屏幕上只剩亮度差，而亮度差全在同一条灰蓝色轴上 → 分不出台词/旁白/动作/环境。
         更早那版（board.js:118 的注释里还留着）传的是 '▸' —— 换成块流时把标签丢了。
         现在把标签填回来：**"这是什么"由文字说，颜色只做辅助**（反模式 #6：颜色不能是唯一载体）。 */
      const s1 = cue('台词', '「' + txt(bb.text) + '」', 'said'); if (s1) blk.appendChild(s1);
      const detail = [txt(bb.action), txt(bb.expression), txt(bb.voice)].filter(Boolean).join('　');
      const c1 = cue('神情', detail, 'detail'); if (c1) blk.appendChild(c1);
    } else {
      /* v3.3：**结果行不能再混进 detail**。.bs.detail 的颜色是 --fg-3，而 tokens.css 给
         --fg-3 的注释是「极次要·纯装饰，不承载信息」—— 玩家动作的确定性结论
         （「你买好了去临江的车票——30块」）是事实，不是装饰。它原来和"他皱了皱眉"同色同字号。 */
      const isOut = (t === 'outcome');
      const a2 = cue(isOut ? '结果' : '动作', body(bb.text), isOut ? 'out' : 'detail'); if (a2) blk.appendChild(a2);
    }
    return blk;
  }

  function renderBoard() {
    const layout = document.getElementById('layout');
    const world = document.getElementById('world');
    const now = document.getElementById('now');
    if (!layout || !now) return;
    layout.classList.add('board');
    if (world) { world.innerHTML = ''; world.style.display = 'none'; }
    now.innerHTML = '';
    now.classList.remove('hidden');

    /* ★ v2.13：**不再把上一幕藏起来。**
       原来这里按最后一个 stage-tag 把 log 切成 act / hist，hist 收进「▸ 更早：N 拍」的折叠框 ——
       于是屏幕上永远只有一幕，玩家只能靠猜（用户实测：「我说出去，但我并不知道我没出去」）。
       改成**连续流**：所有幕都渲染，**越早越暗**（渐隐，不是隐藏）。
       历史都在（往上滚就能读，像酒馆），主次也在（只有当前幕最亮，仍然不用卡片底色）。 */
    const log = (V && V.sceneLog) || [];
    const marks = [];
    for (let i = 0; i < log.length; i++) if (log[i].type === 'stage-tag') marks.push(i);
    const spans = [];
    for (let k = 0; k < marks.length; k++) spans.push(log.slice(marks[k], (k + 1 < marks.length) ? marks[k + 1] : log.length));
    if (marks.length && marks[0] > 0) spans.unshift(log.slice(0, marks[0]));   // 第一个场次标签之前（开场旁白）
    const cur = spans.length - 1;
    const act = spans[cur] || log;
    /* 主次由 **AI** 定（V.focus = 引擎校验过的 id 列表，见 src/ai.js 的 focus 定义）：
       AI 给几个就几个（几个人都重要是正常的）；一个都不给 = 这一拍没有主次 ——
       界面**不许自己挑一个**（拿公式选主角，等于把叙事判断从 AI 手里抢回来）。 */
    const focusIds = ((V && V.focus) || []).map(txt).filter(Boolean);

    const wrap = h('div', 'board');
    /* ★ v3.20：状态简介搬到 #brief —— **滚动区之外**（用户：「这个一直在最上面
       每次想看的时候都要翻到最上面？」）。它每一回合都在这里被重画一次（V 是本回合投影）。 */
    const host = document.getElementById('brief');
    if (host) {
      host.innerHTML = '';
      const b = brief();
      if (b) { host.appendChild(b); host.classList.remove('hidden'); } else { host.classList.add('hidden'); }
    }
    /* ★ v2.14 顺序块流：**log 的顺序就是阅读顺序**，一条 beat 一块，画完就不动。
       不再按幕分组、不再按人聚合、不再渐隐 —— 因为"按人聚合"会打散时间，
       而"渐隐/折叠"会让玩家看不到自己刚做过什么（用户："我说出去，但我并不知道我没有出去"）。
       信息一条不丢：所有 beat 都在，滚上去就能读。 */
    const atBottom = (now.scrollTop + now.clientHeight) >= (now.scrollHeight - 24);
    const focusSet = {};
    for (const fid of focusIds) focusSet[fid] = 1;
    for (const bb of log) {
      const blk = oneBlock(bb);
      if (!blk) continue;
      /* AI 声明的"这一拍的主角"仍然提亮（主次由 AI 定、界面不许自己挑 —— v2.07 的原则不变） */
      if (focusSet[who(bb)]) blk.classList.add('focus');
      wrap.appendChild(blk);
    }
    now.appendChild(wrap);
    /* 只在"本来就在底部"时跟到底 —— 你往上翻历史的时候，不许被拽下来 */
    try { if (atBottom) now.scrollTop = now.scrollHeight; } catch (e) {}
  }

  window.renderStage = renderBoard;
  window.__BOARD__ = renderBoard;
})();