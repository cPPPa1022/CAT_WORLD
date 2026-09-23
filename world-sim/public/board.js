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

  /* ② 焦点区：谁在场、说了什么。无卡片 —— 层次靠字号/亮度/留白，不靠色块 */
  function focusArea(act, focusIds) {
    const cast = ((V && V.cast) || []).filter(x => x && x.id !== 'player');
    const box = h('div', 'bfocus');
    if (!cast.length) {
      box.appendChild(h('div', 'bempty', '（此刻没有别人在场）'));
    }
    for (const person of cast) {
      const name = txt(person.name) || '？';
      const isFocus = focusIds.indexOf(txt(person.id)) >= 0 || focusIds.indexOf(name) >= 0;
      const mine = act.filter(bb => { const w = who(bb); return w && (w === name || w === txt(person.id)); });
      const blk = h('div', 'bperson' + (isFocus ? ' focus' : ''));
      const head = h('div', 'bname-row');
      head.appendChild(h('span', 'bname', name));
      /* 这里**不放 mood**。"烦躁/平静"是 TA 的内心状态，玩家看不见 ——
         引擎自己的契约就写着"写可被感知的征候，不写情绪词"（ai.js:399）。
         玩家能看见的那些征候，在同一条 beat 的小细节那一行里（动作/神态/声音）。 */
      blk.appendChild(head);
      let any = 0;
      for (const bb of mine) {
        const before = blk.childElementCount;
        if (bb.type === 'dialogue') {
          const s1 = cue('', '「' + txt(bb.text) + '」', 'said'); if (s1) blk.appendChild(s1);
          const detail = [txt(bb.action), txt(bb.expression), txt(bb.voice)].filter(Boolean).join('　');
          const c1 = cue('', detail, 'detail'); if (c1) blk.appendChild(c1);
        } else if (bb.type === 'action') {
          const a2 = cue('', bb.text, 'detail'); if (a2) blk.appendChild(a2);
        } else {
          /* 引擎契约外的旧类型（演示世界里阿岩那行 type:'bar'）把动作写在了台词括号里。
             契约本来明令"不要再把动作塞进台词括号里"（ai.js:398-404），所以这里替它拆开：
             前导（…）进小细节，剩下的才是台词。 */
          let said2 = txt(bb.text);
          let act2 = '';
          const mm = said2.match(/^\s*[（(]([^）)]{1,60})[）)]\s*/);
          if (mm) { act2 = mm[1]; said2 = said2.slice(mm[0].length); }
          const o = cue('', '「' + said2 + '」', 'said'); if (o) blk.appendChild(o);
          const d2 = cue('', act2, 'detail'); if (d2) blk.appendChild(d2);
        }
        if (blk.childElementCount > before) any++;
      }
      if (any) box.appendChild(blk);
    }
    return box.childElementCount ? box : null;
  }

  /* ③ 氛围区：环境 / 旁白 / 镇上在传 —— 最暗的一档，扫一眼 */
  function ambientArea(act, focusIds) {
    const box = h('div', 'bamb');
    const latest = (type, n) => {
      const out = [];
      for (let i = act.length - 1; i >= 0 && out.length < (n || 1); i--) if (act[i].type === type) out.push(act[i]);
      return out.reverse();
    };
    for (const bb of latest('ambient', 2)) { const r = cue('环境', bb.text); if (r) box.appendChild(r); }
    for (const bb of latest('narration', 2)) { const r = cue('旁白', bb.text); if (r) box.appendChild(r); }
    for (const bb of latest('outcome', 1)) { const r = cue('▸', bb.text, 'out'); if (r) box.appendChild(r); }
    for (const bb of latest('reaction', 1)) { const r = cue('·', bb.text, 'react'); if (r) box.appendChild(r); }
    /* 玩家也可能被 AI 点成主角（focus:['player']）—— 那一行就给同样的放大 */
    const meFocus = focusIds.indexOf('player') >= 0 || focusIds.indexOf(txt(V && V.playerName)) >= 0;
    for (const bb of latest('user-action', 1)) { const r = cue('你', bb.text, 'me' + (meFocus ? ' focus' : '')); if (r) box.appendChild(r); }
    const items = [];
    for (const n of ((V && V.news) || [])) items.push(n && (n.title || n.summary));
    const ov = (V && V.overview) || {};
    for (const n of (ov['近况'] || [])) items.push(n && n.title);
    const uniq = [];
    for (const it of items) { const s = txt(it); if (s && uniq.indexOf(s) < 0) uniq.push(s); }
    if (uniq.length) { const r = cue('听说', uniq.slice(0, 3).join('　·　')); if (r) box.appendChild(r); }
    return box.childElementCount ? box : null;
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

    const log = (V && V.sceneLog) || [];
    let cur = -1;
    for (let i = 0; i < log.length; i++) if (log[i].type === 'stage-tag') cur = i;
    const act = cur >= 0 ? log.slice(cur) : log;
    const hist = cur > 0 ? log.slice(0, cur) : [];
    /* 主次由 **AI** 定（V.focus = 引擎校验过的 id 列表，见 src/ai.js 的 focus 定义）：
       AI 给几个就几个（几个人都重要是正常的）；一个都不给 = 这一拍没有主次 ——
       界面**不许自己挑一个**（拿公式选主角，等于把叙事判断从 AI 手里抢回来）。 */
    const focusIds = ((V && V.focus) || []).map(txt).filter(Boolean);

    const wrap = h('div', 'board');
    const b = band(); if (b) wrap.appendChild(b);
    const f = focusArea(act, focusIds); if (f) wrap.appendChild(f);
    const a = ambientArea(act, focusIds); if (a) wrap.appendChild(a);

    if (hist.length) {
      const fold = h('div', 'bfold');
      const btn = h('button', 'bfold-btn', '▸ 更早：' + hist.length + ' 拍');
      const box = h('div', 'bfold-box hidden');
      for (const bb of hist) { const t = compact(bb); if (t) box.appendChild(h('div', 'bfl', t)); }
      btn.onclick = () => {
        const hid = box.classList.toggle('hidden');
        btn.textContent = (hid ? '▸ 更早：' : '▾ 更早：') + hist.length + ' 拍';
      };
      fold.appendChild(btn); fold.appendChild(box);
      wrap.appendChild(fold);
    }
    now.appendChild(wrap);
  }

  window.renderStage = renderBoard;
  window.__BOARD__ = renderBoard;
})();