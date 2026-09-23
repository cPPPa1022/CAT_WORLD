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
  function band() {
    const rows = [];
    const cast = ((V && V.cast) || []).filter(x => x && x.id !== 'player');
    if (cast.length) rows.push(['在场', cast.map(x => txt(x.name)).filter(Boolean).join('　')]);
    const shop = (V && V.shop) || [];
    if (shop.length) rows.push(['货架', shop.slice(0, 4).map(it => txt(it.name) + (it.price ? ' ¥' + it.price : '')).join('　')]);
    const inv0 = (V && V.inventory) || [];
    const invNames0 = inv0.map(x => txt(x && x.name ? x.name : x)).filter(Boolean);
    if (invNames0.length) rows.push(['随身', invNames0.slice(0, 6).join('　')]);
    const place = (V && V.place) || {};
    const nodes = (V && V.map) || [];
    const here = nodes.filter(n => n && n.id === place.id)[0];
    if (here && (here.edges || []).length) {
      /* 只列**你知道的**地方，不标"去过/没去过" —— 那是本局的足迹，不是这个人的经历。
         （要标，得先把"开局认知清单"补上：见说明文档） */
      rows.push(['去路', here.edges.slice(0, 4).map(e => {
        const to = nodes.filter(n => n && n.id === e.to)[0];
        return txt(to ? to.name : e.to) + '（' + walkWords(e.minutes) + '）';
      }).join('　')]);
    }
    /* 我的处境：只写这个人**感觉得到**的东西（钱、身上、身体、欠着的话）。
       不写"疲劳 低 / 随身 4 件 / 还悬着 1 事" —— 那是数据库在说话，不是人。 */
    const me = [];
    const money = (V && V.money) || null;
    if (money) me.push('兜里 ' + (money.cash || 0) + (money.currency || '元'));
    const bw = bodyWords((V && V.me && V.me.state) || {});
    if (bw) me.push(bw);
    /* 悬着的事：**照数据原样写**（name 是事情本身，如"口角"；why 是原因，常常为空）。
       不编"还欠着一句"这类句子 —— 那是我替世界加戏。 */
    const dayWords = (x) => { const s = txt(x && x.t).slice(5, 10); return s ? '（' + Number(s.slice(0, 2)) + '月' + Number(s.slice(3, 5)) + '日）' : ''; };
    const loose = (V && V.loose) || [];
    const looseTxt = loose.slice(0, 3).map(x => txt(x && x.name) + (x && x.why ? '——' + txt(x.why) : '') + dayWords(x)).filter(Boolean).join('　');
    if (looseTxt) me.push('还悬着 ' + looseTxt);
    if (me.length) rows.push(['我', me.join('　')]);
    if (!rows.length) return null;
    const box = h('div', 'bband');
    for (const r of rows) {
      const row = h('div', 'brow');
      row.appendChild(h('span', 'brow-k', r[0]));
      row.appendChild(h('span', 'brow-v', r[1]));
      box.appendChild(row);
    }
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
      const bx = h('div', 'bnarr' + (t === 'ambient' ? ' amb' : ''));
      bx.appendChild(h('div', 'bs-v', txt(bb.text)));
      return bx;
    }
    const isMe = (t === 'user-action' || t === 'outcome');
    const blk = h('div', 'bperson' + (isMe ? ' mine' : ''));
    const nm = isMe ? '你' : who(bb);
    if (nm) { const head = h('div', 'bname-row'); head.appendChild(h('span', 'bname', nm)); blk.appendChild(head); }
    if (t === 'dialogue') {
      const s1 = cue('', '「' + txt(bb.text) + '」', 'said'); if (s1) blk.appendChild(s1);
      const detail = [txt(bb.action), txt(bb.expression), txt(bb.voice)].filter(Boolean).join('　');
      const c1 = cue('', detail, 'detail'); if (c1) blk.appendChild(c1);
    } else {
      /* v3.3：**结果行不能再混进 detail**。.bs.detail 的颜色是 --fg-3，而 tokens.css 给
         --fg-3 的注释是「极次要·纯装饰，不承载信息」—— 玩家动作的确定性结论
         （「你买好了去临江的车票——30块」）是事实，不是装饰。它原来和"他皱了皱眉"同色同字号。 */
      const a2 = cue('', txt(bb.text), t === 'outcome' ? 'out' : 'detail'); if (a2) blk.appendChild(a2);
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
    const b = band(); if (b) wrap.appendChild(b);
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