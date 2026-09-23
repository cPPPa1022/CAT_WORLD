/* ══════════════════════════════════════════════════════════════════════
   studio.js — 生图工作台（窗口域 / 壳层）
   ---------------------------------------------------------------------
   设计依据：awesome-design-md 的 linear.app（暗色工具语言）+ runwayml（图像规则）
   替代：app.js 里的 openImageEngine()（256 行表单墙）+ imageStudioSections()（125 行）
   契约：**全即改即存**，没有「保存」按钮（原实现的"上面要保存、下面即时生效"是混乱源）
   数据：全部来自既有状态（SRVCFG.image / V.imgTasks / __gallery / /api/visual/lib），零新增后端
   ══════════════════════════════════════════════════════════════════════ */
'use strict';

var Studio = (function () {
  var host = null, rail = 'queue', dtab = 'conn', dok = false, sel = null;
  var lib = null, libErr = '', connMsg = null, connOk = false, busyGen = false;

  /* ── 数据 ── */
  function ic() { if (!SRVCFG) return {}; if (!SRVCFG.image) SRVCFG.image = {}; return SRVCFG.image; }
  function tasks() { return (V && V.imgTasks) || []; }
  function gal() { try { return (typeof __gallery !== 'undefined' && __gallery) || []; } catch (e) { return []; } }
  function wired() { var c = ic(); return !!(c.base && c.workflowJson); }
  function counts() {
    var t = tasks();
    return {
      pend: t.filter(function (x) { return x.status === 'prompted' || x.status === 'queued'; }).length,
      busy: t.filter(function (x) { return x.status === 'rendering'; }).length,
      fail: t.filter(function (x) { return x.status === 'fail'; }).length,
      all: t
    };
  }
  function selItem() { var g = gal(); if (!g.length) return null; return g.filter(function (x) { return x.id === sel; })[0] || g[0]; }

  /* ── DOM 助手 ── */
  function h(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function dotline(kind, txt) { var s = h('span'); s.appendChild(h('i', 'dot ' + kind)); s.appendChild(document.createTextNode(txt)); return s; }
  function field(label, ctrl, hint) {
    var f = h('div', 'f'); f.appendChild(h('label', null, label)); f.appendChild(ctrl);
    if (hint) f.appendChild(h('span', 'h', hint)); return f;
  }
  function txtInput(val, ph, onDone) {
    var i = h('input'); i.type = 'text'; i.value = val == null ? '' : String(val); if (ph) i.placeholder = ph;
    i.onchange = function () { onDone(i.value.trim()); }; return i;
  }
  function select(opts, val, onDone) {
    var s = h('select');
    opts.forEach(function (o) { var op = h('option', null, o[1]); op.value = o[0]; s.appendChild(op); });
    s.value = String(val == null ? '' : val);
    s.onchange = function () { onDone(s.value); }; return s;
  }
  function toggle(val, onTxt, offTxt, onDone) {
    var b = h('button', 'sw'); b.setAttribute('aria-pressed', String(!!val));
    b.appendChild(h('i')); b.appendChild(h('span', null, val ? onTxt : offTxt));
    b.onclick = function () { onDone(!val); }; return b;
  }
  function muted(t) { return h('div', 'empty', null).appendChild(h('div', 'sub', t)) && arguments; }

  /* ── 写入（即改即存）── */
  function save(patch, note) {
    Object.assign(ic(), patch);
    render();
    api('/api/settings', { image: patch })
      .then(function () { if (note) toast(note, false); })
      .catch(function (e) { toast('保存失败：' + (e && e.message || e), true); });
  }

  /* ── 打开 / 关闭 ── */
  function open() {
    if (!host) {
      host = h('div'); host.id = 'studio';
      document.body.appendChild(host);
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && host.classList.contains('on')) close(); });
    }
    dok = !wired();                       // 渐进披露：没接好就把「接入」摊开
    dtab = 'conn'; sel = null; connMsg = null;
    host.classList.add('on');
    var jk = document.getElementById('jsok'); if (jk) jk.style.display = 'none';   // 它是 z=300，会盖在工作台上
    render();
    api('/api/visual/lib').then(function (r) { lib = (r && r.ok) ? r : null; libErr = (r && r.err) || ''; render(); })
      .catch(function (e) { lib = null; libErr = String(e && e.message || e); render(); });
  }
  function close() {
    if (host) host.classList.remove('on');
    var jk = document.getElementById('jsok'); if (jk) jk.style.display = '';
    if (typeof afterRenderDone === 'function') afterRenderDone();   // 生图结果要回到世界里
  }

  /* ── 动作 ── */
  function doConnect() {
    connMsg = '测试中…'; connOk = false; render();
    api('/api/comfy/test', { base: ic().base || undefined }).then(function (r) {
      connOk = !!r.ok;
      connMsg = r.ok ? ('✔ 连接成功' + (r.comfy ? '（ComfyUI ' + r.comfy + '）' : '') + (r.models && r.models.length ? ' · ' + r.models.join('/') : ''))
                     : ('✘ ' + (r.err || '连接失败'));
      render();
    }).catch(function (e) { connOk = false; connMsg = '✘ ' + String(e && e.message || e); render(); });
  }
  function pickWorkflow() {
    var f = h('input'); f.type = 'file'; f.accept = '.json';
    f.onchange = function () {
      if (!f.files || !f.files[0]) return;
      var file = f.files[0];
      file.text().then(function (t) {
        return api('/api/image/workflow', { name: file.name, jsonText: t }).then(function (r) {
          if (!r.ok) { toast('导入失败：' + (r.err || '?'), true); return; }
          if (SRVCFG && SRVCFG.image) SRVCFG.image.workflow = file.name;
          if (SRVCFG && SRVCFG.image) SRVCFG.image.workflowJson = t;
          toast('工作流已导入（立即生效）', false); render();
        });
      }).catch(function (e) { toast('导入失败：' + (e && e.message || e), true); });
    };
    f.click();
  }
  function genScene() {
    var c = counts();
    if (!wired()) { toast('先去「接入」填 ComfyUI 地址并导入工作流', true); dok = true; dtab = 'conn'; render(); return; }
    var todo = c.all.filter(function (t) { return t.status === 'prompted' || t.status === 'queued' || t.status === 'fail'; });
    if (!todo.length) { toast('没有待出的图', false); return; }
    busyGen = true; render();
    (function step(i) {
      if (i >= todo.length) { busyGen = false; toast('已提交 ' + todo.length + ' 张', false); if (typeof afterRenderDone === 'function') afterRenderDone().then(render); else render(); return; }
      api('/api/comfy/render', { id: todo[i].id }).catch(function () { }).then(function () { step(i + 1); });
    })(0);
  }
  function renderTask(t) {
    var b = h('button', 'tbtn', '重试'); b.onclick = function (ev) {
      ev.stopPropagation(); b.disabled = true; b.textContent = '渲染中…';
      api('/api/comfy/render', { id: t.id }).then(function (r) {
        if (r.ok) { toast('已重新提交', false); if (typeof afterRenderDone === 'function') afterRenderDone().then(render); else render(); }
        else { toast('失败：' + (r.err || '?'), true); b.disabled = false; b.textContent = '重试'; }
      }).catch(function (e) { toast('失败：' + (e && e.message || e), true); b.disabled = false; b.textContent = '重试'; });
    };
    return b;
  }
  function genPerson(pe, btn) {
    btn.disabled = true; btn.textContent = '生成中…';
    api('/api/comfy/person', { id: pe.id }).then(function (r) {
      if (r.ok) { toast('「' + (pe.name || pe.id) + '」立绘完成', false); if (typeof afterRenderDone === 'function') afterRenderDone().then(render); else render(); }
      else { toast('生成失败：' + (r.err || '?'), true); btn.disabled = false; btn.textContent = '生成'; }
    }).catch(function (e) { toast('生成失败：' + (e && e.message || e), true); btn.disabled = false; btn.textContent = '生成'; });
  }

  /* ── 结构 ── */
  function topbar() {
    var c = counts(), top = h('div', 'wk-top');
    top.appendChild(h('span', 'wk-title', '生图'));
    var st = h('span', 'wk-status');
    st.appendChild(dotline(wired() ? 'on' : 'off', wired() ? 'ComfyUI 已接' : 'ComfyUI 未接'));
    if (c.busy) st.appendChild(dotline('busy', '出图中 ' + c.busy));
    if (c.pend) st.appendChild(dotline('off', '待出 ' + c.pend));
    if (c.fail) st.appendChild(dotline('fail', '失败 ' + c.fail));
    if (!c.all.length) st.appendChild(h('span', null, '还没有任务'));
    top.appendChild(st);

    var acts = h('span', 'wk-actions');
    var rb = h('button', 'btn', '返回世界'); rb.onclick = close; acts.appendChild(rb);
    if (selItem()) {                                   // 一屏一个 Primary：空态时由空态自己拿
      var gb = h('button', 'btn primary', busyGen ? '提交中…' : '生成当前场景');
      if (busyGen) gb.disabled = true;
      gb.onclick = genScene; acts.appendChild(gb);
    }
    top.appendChild(acts);
    return top;
  }

  function canvas() {
    var wrap = h('div', 'wk-canvas');
    var frame = h('div', 'frame');
    var g = selItem();
    if (g) {
      var im = h('img', 'shot');
      im.src = '/api/gallery/img?id=' + encodeURIComponent(g.id);
      im.alt = g.note || g.state || g.id;
      im.onclick = function () { if (typeof showModalImg === 'function') showModalImg(im.src); };
      im.style.cursor = 'zoom-in';
      frame.appendChild(im);
    } else {
      var e = h('div', 'empty');
      e.appendChild(h('div', 'big', '这个世界还没有画面'));
      e.appendChild(h('div', 'sub', '打一回合让引擎登记画面，或者直接生成当前场景。'));
      if (!wired()) {
        e.appendChild(h('div', 'sub', '还没接 ComfyUI —— 先在下面的「接入」里填地址、导入工作流。'));
      } else {
        var eb = h('button', 'btn primary', busyGen ? '提交中…' : '生成当前场景');
        eb.onclick = genScene; e.appendChild(eb);
      }
      frame.appendChild(e);
    }
    wrap.appendChild(frame);

    var cap = h('div', 'cap');
    if (g) {
      cap.appendChild(h('span', 'kicker', '当前选中'));
      cap.appendChild(h('span', 'cap-title', String(g.note || g.state || '画面').slice(0, 44)));
      var t = tasks().filter(function (x) { return x.id === g.id; })[0];
      /* 说明行不显示内部 id（工作台是给人看的，不是调试台）*/
      var kd = t ? (t.kind === 'portrait' ? '立绘' : '场景') : '画面';
      cap.appendChild(h('span', 'cap-meta', kd + (g.t ? ' · ' + String(g.t).slice(11, 16) : '')));
      var acts = h('span', 'cap-acts');
      if (t) acts.appendChild(renderTask(t));
      var cp = h('button', 'tbtn', '复制提示词');
      cp.onclick = function () {
        var s = (t && t.prompt) || g.note || '';
        if (!s) { toast('没有提示词', true); return; }
        if (navigator.clipboard) navigator.clipboard.writeText(s).then(function () { toast('已复制', false); });
        else toast('这个环境不支持复制', true);
      };
      acts.appendChild(cp);
      cap.appendChild(acts);
    }
    wrap.appendChild(cap);
    return wrap;
  }

  function railPane() {
    var p = h('div', 'wk-rail');
    var tabs = h('div', 'rail-tabs');
    [['queue', '队列'], ['gallery', '图库'], ['people', '人物'], ['profile', '档案']].forEach(function (k) {
      var b = h('button', 'rail-tab', k[1]);
      b.setAttribute('aria-selected', String(rail === k[0]));
      b.onclick = function () { rail = k[0]; render(); };
      tabs.appendChild(b);
    });
    p.appendChild(tabs);
    var body = h('div', 'rail-body');
    if (rail === 'gallery') body.appendChild(paneGallery());
    else if (rail === 'people') body.appendChild(panePeople());
    else if (rail === 'profile') body.appendChild(paneProfile());
    else body.appendChild(paneQueue());
    p.appendChild(body);
    var footTxt = rail === 'profile' ? '缺维度的人在生图时会漂 —— 补齐后可重出'
                : rail === 'gallery' ? ('共 ' + gal().length + ' 张 —— 点缩略图放大到画布')
                : rail === 'people' ? '立绘由生图引擎按九维档案生成'
                : '';
    if (footTxt) p.appendChild(h('div', 'rail-foot', footTxt));
    return p;
  }

  function paneQueue() {
    var box = h('div');
    var list = tasks().slice().reverse();
    if (!list.length) { var e = h('div', 'empty'); e.appendChild(h('div', 'sub', '还没有任务 —— 打一回合就有了')); box.appendChild(e); return box; }
    list.forEach(function (t) {
      var st = t.status === 'done' ? ['on', '已完成'] : t.status === 'fail' ? ['fail', '失败']
             : t.status === 'rendering' ? ['busy', '出图中'] : ['off', t.status === 'queued' ? '排队中' : '待出'];
      var row = h('div', 'task');
      if (t.id === sel || (!sel && t.id === (list[0] || {}).id)) row.setAttribute('aria-current', 'true');
      var g = gal().filter(function (x) { return x.id === t.id; })[0];
      if (g) { var th = h('img', 'thumb'); th.src = '/api/gallery/img?id=' + encodeURIComponent(t.id); row.appendChild(th); }
      else { var ph = h('div', 'thumb'); row.appendChild(ph); }
      var main = h('div', 't-main');
      var top = h('div', 't-top');
      top.appendChild(dotline(st[0], st[1]));
      top.appendChild(h('span', 't-st', t.kind === 'portrait' ? '立绘' : '场景'));
      main.appendChild(top);
      main.appendChild(h('div', 't-sub', String((typeof imgCaption === 'function' ? imgCaption(t) : t.prompt) || t.id).slice(0, 60)));
      if (t.status === 'fail' && t.err) main.appendChild(h('div', 't-err', String(t.err).slice(0, 90)));
      row.appendChild(main);
      if (t.status === 'fail') row.appendChild(renderTask(t));
      row.onclick = function () { if (g) { sel = t.id; render(); } };
      box.appendChild(row);
    });
    return box;
  }

  function paneGallery() {
    var box = h('div', 'grid'), g = gal();
    if (!g.length) { var e = h('div', 'empty'); e.appendChild(h('div', 'sub', '这个世界的图库还是空的')); box.className = ''; box.appendChild(e); return box; }
    g.forEach(function (it) {                       // 接口已是「新→旧」，别再 reverse
      var b = h('button', 'gitem');
      if (it.id === (selItem() || {}).id) b.setAttribute('aria-current', 'true');
      var im = h('img'); im.src = '/api/gallery/img?id=' + encodeURIComponent(it.id); im.alt = it.note || it.id;
      b.appendChild(im);
      b.appendChild(h('span', 'gl', String(it.t || '').slice(11, 16)));   // 接口给的是 t（ISO），不给 at
      b.onclick = function () { sel = it.id; render(); };
      box.appendChild(b);
    });
    return box;
  }

  function panePeople() {
    var box = h('div'), ppl = (V && V.people) || [];
    if (!ppl.length) { var e = h('div', 'empty'); e.appendChild(h('div', 'sub', '这个世界还没有人物')); box.appendChild(e); return box; }
    ppl.forEach(function (pe) {
      var row = h('div', 'person');
      var gi = (typeof galleryImgFor === 'function' ? galleryImgFor(pe.id) : null);
      if (gi) { var a = h('div', 'avatar'); var ai = h('img'); ai.src = '/api/gallery/img?id=' + encodeURIComponent(gi.id); a.appendChild(ai); row.appendChild(a); }
      else { var an = h('div', 'avatar none', '🖼'); row.appendChild(an); }
      var main = h('div', 'p-main');
      main.appendChild(h('div', 'p-name', pe.name || pe.id));
      main.appendChild(h('div', 'p-sub', '印象：' + (pe.stageLabel || '只见过')));
      row.appendChild(main);
      var b = h('button', 'tbtn', gi ? '重出' : '生成');
      b.onclick = function () { genPerson(pe, b); };
      row.appendChild(b);
      box.appendChild(row);
    });
    return box;
  }

  function paneProfile() {
    var box = h('div');
    if (!lib) {
      var e = h('div', 'empty');
      e.appendChild(h('div', 'sub', libErr ? ('读取失败：' + libErr) : '读取中…'));
      box.appendChild(e); return box;
    }
    var list = lib.list || [], dims = lib.dims || [];
    list.forEach(function (p) {
      var full = p.filled === dims.length;
      var head = h('div');
      head.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;margin-top:14px';
      head.appendChild(h('span', null, p.name || p.id));
      head.appendChild(h('span', null, p.filled + ' / ' + dims.length)).style.cssText = 'font-size:12px;color:var(--sh-ink-tertiary)';
      box.appendChild(head);
      var bar = h('div', 'bar'); var fill = h('i'); fill.style.width = Math.round(p.filled / Math.max(1, dims.length) * 100) + '%'; bar.appendChild(fill);
      box.appendChild(bar);
      dims.forEach(function (k) {
        var v = (p.nine || {})[k];
        var d = h('div', 'dim');
        d.appendChild(h('span', 'k', k));
        d.appendChild(h('span', 'v' + (v ? '' : ' miss'), v ? String(v) : '缺（生图时会漂）'));
        box.appendChild(d);
      });
    });
    return box;
  }

  function drawer() {
    var c = ic(), d = h('div', 'drawer'); d.setAttribute('data-open', String(dok));
    var head = h('div', 'drawer-head');
    var tgl = h('button', 'tbtn');
    tgl.appendChild(document.createTextNode('参数 '));
    tgl.appendChild(h('span', 'caret', '▾'));
    tgl.onclick = function () { dok = !dok; render(); };
    head.appendChild(tgl);
    var tabs = h('div', 'd-tabs');
    [['conn', '接入'], ['art', '美术'], ['out', '出图']].forEach(function (k) {
      var b = h('button', 'd-tab', k[1]);
      b.setAttribute('aria-selected', String(dtab === k[0]));
      b.onclick = function () { dtab = k[0]; dok = true; render(); };
      tabs.appendChild(b);
    });
    head.appendChild(tabs);
    head.appendChild(h('span', 'grow'));
    head.appendChild(h('span', null, '改动即时生效，没有「保存」按钮')).style.cssText = 'font-size:12px;color:var(--sh-ink-tertiary)';
    d.appendChild(head);

    var body = h('div', 'drawer-body');
    if (dtab === 'conn') body.appendChild(paneConn(c));
    else if (dtab === 'art') body.appendChild(paneArt(c));
    else body.appendChild(paneOut(c));
    d.appendChild(body);
    return d;
  }

  function paneConn(c) {
    var f = h('div', 'fields');
    f.appendChild(field('启用生图', toggle(!!c.enabled, '开着', '关着', function (v) { save({ enabled: v }, '生图已' + (v ? '启用' : '停用')); }),
      '不启用时零影响，世界照常玩'));
    f.appendChild(field('ComfyUI 地址', txtInput(c.base, 'http://127.0.0.1:8181', function (v) { save({ base: v }, '地址已保存'); }),
      '本地服务；连不上时队列停在「待出」，不会丢任务'));
    var wf = h('div', 'pair');
    var imp = h('button', 'mini', '📄 导入工作流 JSON'); imp.onclick = pickWorkflow; wf.appendChild(imp);
    wf.appendChild(h('span', c.workflow ? 'okl' : 'badl', c.workflow ? ('✔ ' + c.workflow) : '（未导入工作流）'));
    f.appendChild(field('工作流', wf, '导入即生效（和这里其他项一样）'));
    var cn = h('div', 'pair');
    var tb = h('button', 'mini', '🔌 测试连接'); tb.onclick = doConnect; cn.appendChild(tb);
    if (connMsg) cn.appendChild(h('span', connOk ? 'okl' : 'badl', connMsg));
    f.appendChild(field('连接', cn));
    return f;
  }
  function paneArt(c) {
    var f = h('div', 'fields');
    f.appendChild(field('美术模式', select([['zit', 'zit 中文自然语言'], ['anime', 'anime 英文描述'], ['anime_tag', 'anime_tag 英文标签'], ['nsfw', 'nsfw 直给（世界规则声明时）']], c.mode || 'zit', function (v) { save({ mode: v }, '美术模式 → ' + v); })));
    f.appendChild(field('画风预设', select([['', '（无）'],
      ['柯达金200胶片质感，暖黄色调，细腻胶片颗粒，复古写实质感', '🎞 柯达金胶片'],
      ['水墨写意画，宣纸质感，墨色浓淡晕染，大面积留白，东方写意意境', '🖌 水墨写意'],
      ['水彩画风格，半透明叠色水痕，水彩纸纹理，自然晕染过渡', '🎨 水彩'],
      ['日系柔和色调，低对比，胶片颗粒细，空气感通透', '🌸 日系柔和'],
      ['冷调赛博风，霓虹蓝紫，金属反光，颗粒感', '🌃 冷调赛博'],
      ['深色电影质感，暗部饱满，侧逆光，戏剧性氛围', '🎬 深色电影']], c.style || '', function (v) { save({ style: v }, '画风已切换'); }), 'ZIT 模式生效'));
    f.appendChild(field('AI 润色', toggle(!!c.aiPrompt, '开（多花 token）', '关（规则装配直出，零模型）', function (v) { save({ aiPrompt: v }, 'AI 润色已' + (v ? '开' : '关')); })));
    f.appendChild(field('负面提示词', txtInput(c.neg, 'lowres, bad anatomy, blur…', function (v) { save({ neg: v }, '负面提示词已保存'); }), '注入工作流负面节点'));
    f.appendChild(field('前置提示词', txtInput(c.pPrefix, '固定构图 / 镜头偏好，逗号分隔', function (v) { save({ pPrefix: v }, '前置提示词已保存'); }), '所有模式都会拼在最前面'));
    var pair = h('div', 'pair');
    pair.appendChild(txtInput(c.qPrefix, 'masterpiece, best quality', function (v) { save({ qPrefix: v }, '质量前缀已保存'); }));
    pair.appendChild(txtInput(c.artist, '@artist_name', function (v) { save({ artist: v }, '艺术家标签已保存'); }));
    f.appendChild(field('Anime 质量前缀 / 艺术家', pair, '仅 anime / anime_tag 模式使用'));
    f.appendChild(field('NSFW 增强', toggle(!!c.nsfw, '开（成人场景如实配图）', '关', function (v) { save({ nsfw: v }, 'NSFW 增强已' + (v ? '开' : '关')); })));
    return f;
  }
  function paneOut(c) {
    var f = h('div', 'fields');
    f.appendChild(field('配图偏好', select([['always', '⚡ 自动 —— 每回合至少 1 张'], ['encourage', '🌤 随缘 —— AI 写了画面笔记才出'], ['key', '🖐 手点 —— 只在状态条上点才出']], c.policy || 'always', function (v) { save({ policy: v }, '配图偏好 → ' + v); })));
    function sizeRow(label, key, dw, dh) {
      var d = c[key] || {};
      var pair = h('div', 'pair');
      var wi = h('input'); wi.type = 'text'; wi.value = String(d.w || dw);
      var hi = h('input'); hi.type = 'text'; hi.value = String(d.h || dh);
      function commit() { var o = {}; o[key] = { w: Number(wi.value) || dw, h: Number(hi.value) || dh }; save(o, label + ' → ' + o[key].w + '×' + o[key].h); }
      wi.onchange = commit; hi.onchange = commit;
      pair.appendChild(wi); pair.appendChild(h('span', null, '×')); pair.appendChild(hi);
      f.appendChild(field(label, pair));
    }
    sizeRow('人像 · 立绘尺寸', 'sizePortrait', 768, 768);
    sizeRow('场景插画尺寸', 'sizeScene', 1280, 720);
    f.appendChild(field('', h('span', 'h', '你设多少，出来的就是多少（工作流带放大模型时引擎会反推潜空间）'), ''));
    return f;
  }

  function render() {
    if (!host || !host.classList.contains('on')) return;
    host.innerHTML = '';
    host.appendChild(topbar());
    var body = h('div', 'wk-body');
    body.appendChild(canvas());
    body.appendChild(railPane());
    host.appendChild(body);
    host.appendChild(drawer());
  }

  return { open: open, close: close, render: render };
})();
