'use strict';
const DEG = require('./degraded');
// scheduler.js — 动态调度器：不设岗位，设"能力单元"；任务出现 → 代码规则/ AI 声明 → 选能力+模型档执行
// 能力=executor（提示词或代码池）；模型档=tier(high/med/low)，可被 data.meta.roles[tier] 覆盖（缺省=主模型）
// 结论化：executor 返回 { conclusion(≤200字/进剧情投影), detail(台账) }
'use strict';
const { getEntity } = require('./store');
const AI = require('./ai');
const RT = require('./runtime');
const EPOCH = require('./epoch');
const DIR = require('./director');

// ---------- 能力注册表（映射任务 kind → executor；提示词按任务类型而非岗位名） ----------
const executors = {};

// reply：消息回复（原"消息AI"的职责成为一项能力）
async function exReply(data, cfg, task) {
  const npcId = task.npcId; const sentMsgs = task.msgs || [];
  const joined = sentMsgs.map(m => m.body).filter(Boolean).join('；') || '（一条消息）';
  let reply = null;
  const cfgMsg = cfg;   // v1.83：原来是 (cond) ? cfg : cfg —— 两个分支都是 cfg，纯死代码（角色级模型覆盖在 tierCfg 里，正常生效）
  if (AI.isLive(cfgMsg)) {
    try {
      const r = await AI.llmJSON(cfgMsg, [
        { role: 'system', content: AI.charterShort() + '\n' + AI.msgAI(data, { npc: getEntity(data, npcId) || {}, msgs: sentMsgs }) },
        { role: 'user', content: '到时间了，回吧。' }
      ], () => AI.mockReply(data, joined, npcId), Math.min(2048, AI.cfgMax(cfgMsg)));
      if (r && r.__fallback) reply = r.value;
      else if (r && typeof r.body !== 'undefined') reply = { body: r.body, note: r.note || '' };
    } catch (e) { DEG.hit("scheduler.js", e); }
  }
  if (!reply) reply = AI.mockReply(data, joined, npcId) || { body: null, note: '' };
  const body = reply.body ? String(reply.body) : null;
  const note = (reply.note || (body ? null : '看了没回'));
  for (const m of sentMsgs) m.status = body ? 'delivered' : 'read';
  data.messages.push({ id: data.id('msg'), from: npcId, to: 'player', body: body, t: task.due || data.current.time, status: body ? 'replied' : 'read', via: (data.meta && data.meta.tools ? 'phone' : 'phone'), note: note });
  return { conclusion: body ? ('收到' + ((getEntity(data, npcId) || {}).name || '对方') + '的回复：' + body) : (((getEntity(data, npcId) || {}).name || '对方') + '看了消息，没有回'), detail: { from: npcId, body: body, note: note, t: task.due || data.current.time } };
}

// calc：事件候选（原"副AI-计算"）
async function exCalc(data, cfg, task) {
  if (!AI.isLive(cfg)) return { conclusion: '', detail: {} };
  try {
    const out = await AI.llmJSON(cfg, [
      { role: 'system', content: AI.charterShort() + '\n你是【世界模拟器】的副 AI-计算（能力：发现镜框外的小事）。输入结构化世界快照，输出事件候选 JSON：{"candidates":[{"text":"一句话","type":"环境|遭遇|日常","expireM":分钟,"sev":"低"}]}，1~3条，烈度不超L2，禁止大事凭空，禁止编造已有事实。除了不越界，选什么由你判断——没有注明的就是你的自由。' },
      { role: 'user', content: JSON.stringify({ 时间: data.current.time, 地点: (data.entities[data.current.sceneId] || {}).name || '某处', 天气: data.current.weather, 在场: Object.values(data.entities).filter(e => e.type === 'person' && e.id !== 'player' && e.state && e.state.location === data.current.sceneId).map(e => e.name || e.id), 世界基调: (data.meta && data.meta.era) || '' }) }
    ], () => null, Math.min(2048, AI.cfgMax(cfg)));
    if (!out || out.__fallback || !Array.isArray(out.candidates)) return { conclusion: '', detail: {} };
    return { conclusion: (out.candidates[0] || {}).text || '', detail: { candidates: out.candidates.slice(0, 3) } };
  } catch (e) { return { conclusion: '', detail: {} }; }
}

// digest：离线简报（原"副AI-摘要"）
async function exDigest(data, cfg, task) {
  if (!AI.isLive(cfg)) return { conclusion: '', detail: {} };
  try {
    const stream = (data.ledger || []).filter(l => l.t >= (task.since || data.current.time)).slice(-20).map(l => ({ 时间: (l.t || '').slice(11, 16), 类型: l.type, 内容: l.desc }));
    const msgs = (data.messages || []).filter(m => m.t >= (task.since || data.current.time) && m.to === 'player' && m.body).map(m => m.body);
    const out = await AI.llmJSON(cfg, [
      { role: 'system', content: AI.charterShort() + '\n你是【世界模拟器】的副 AI-摘要（能力：不在场简报）。输出 JSON：{"digest":"200字以内中文简报：你睡着/离开期间世界发生了什么与你相关的事；没有则不写"}。挑什么怎么说由你判断。' },
      { role: 'user', content: JSON.stringify({ 事件: stream, 消息: msgs }) }
    ], () => null, Math.min(1024, AI.cfgMax(cfg)));
    if (!out || out.__fallback || !out.digest) return { conclusion: '', detail: {} };
    return { conclusion: String(out.digest).slice(0, 400), detail: {} };
  } catch (e) { return { conclusion: '', detail: {} }; }
}

// news：新闻/传闻
async function exNews(data, cfg, task) {
  const r = await DIR.routeRequests(data, cfg, [{ kind: 'news', need: task.need || '把这件事变成谈资', hint: task.hint || '市井传闻', payload: task.payload || {} }], task.depth || 0);
  return { conclusion: (r && r.length && r[0].name) ? ('街坊都在传：' + r[0].name) : '', detail: { routed: r } };
}

// requests：AI 自主动态调度（executor 路由在 DIR 内）
async function exRequests(data, cfg, task) {
  const r = await DIR.routeRequests(data, cfg, task.requests || [task] , task.depth || 0);
  return { conclusion: (r || []).map(x => x.name || x.note || x.kind).filter(Boolean).slice(0, 3).join('；'), detail: { routed: r } };
}

// epoch：年度演算（能力：时代计划）
async function exEpoch(data, cfg, task) {
  try { await EPOCH.catchup(data, cfg, task.nowISO || data.current.time); } catch (e) { DEG.hit("scheduler.js", e); }
  const settled = EPOCH.settle(data, task.nowISO || data.current.time);
  return { conclusion: (settled || []).slice(0, 3).join('；'), detail: { settled: settled } };
}

// actor：角色模拟器（主AI 判断戏份重→委派；按 TA 自己的认知（数据包）+ 情景 → 台词/动作/内心）
const ACTOR_LINES = {
  calm: ['（看了看你）……你说，我听着。', '（把东西放下，转过来）怎么？', '（叹了口气）这事说来话长。'],
  cold: ['（没抬眼）还有事？', '（语气没变）……嗯。', '（沉默了一会儿）随你。'],
  hot: ['（语气硬了）你这话什么意思？', '（冷笑一声）行啊，都说到这了。', '（别过脸）我不想谈这个。']
};
function mockActor(data, npc) {
  if (!npc) return { line: '……', action: '（看了看你）', inner: '（心里在琢磨）' };
  const mood = String((npc.state || {}).mood || '平静');
  const pool = /烦躁|愤怒|僵/.test(mood) ? ACTOR_LINES.hot : (/冷淡|冷/.test(mood) ? ACTOR_LINES.cold : ACTOR_LINES.calm);
  const pick = pool[Math.floor(Math.random() * pool.length)];
  const app = String(((npc.profile || {}).appearance || {}).标志物 || '').slice(0, 8);
  return { line: pick, action: '（' + (app || '沉默了一瞬') + '）', inner: '（他心里有事没说出来）' };
}
async function exActor(data, cfg, task) {
  const npcId = task.npcId;
  const npc = getEntity(data, npcId) || {};
  const name = npc.name || '对方';
  // 数据包（模块化：TA 自己的认知；≤600 token）
  const prof = npc.profile || {};
  const relTone = ((data.relations && data.relations.player && data.relations.player[npcId]) || {}).tone || '起初素不相识';
  /* v1.94：补三个最要紧的字段。
     原来这里没有「性格内核」「口癖」「玩家说话的方式」—— 而这三样正是「像不像这个人」的分水岭：
     内核决定 TA 会怎么选，口癖决定 TA 说话长什么样，玩家语域决定 TA 该怎么接（照常反应，不许评价）。
     同一条毛病在 v1.87 的主 AI 资料包上修过一次（人物块补 此刻想要/性格内核/口癖），这里是它的姊妹处。 */
  const packLines = [
    '身份：' + String((prof.identity || {}).身份 || (prof.identity || {}).姓名 || '未知'),
    '外表：' + String((prof.appearance || {}).标志物 || ''),
    '性格内核：' + String((npc.locked || {}).core || '').replace(/^性格内核[：:]/, '').slice(0, 60),
    '表面：' + String((prof.surface || {}).待人 || ''),
    '口癖：' + String((prof.surface || {}).口癖 || ''),
    '里子：' + String((prof.hidden || {}).真实 || ''),
    '背景：' + String((prof.background || {}).经历 || '').slice(0, 80),
    '关系：' + relTone + '（你与这名玩家：认识多久/什么关系，说话语气由此定）',
    '此刻：' + String((prof.desires || {}).现在想 || '') + '；情绪：' + String((npc.state || {}).mood || '平静'),
    '玩家说话的方式：' + (String((((data.meta || {}).userSelf || {}).voice) || '') || '（未声明）').slice(0, 60) + '（照常反应，不许评价）'
  ].filter(function (s) { return s && s.indexOf('：') > 0 && s.slice(s.indexOf('：') + 1).trim(); });
  /* v2.04 P1-2：角色"自己想起什么"与喂给主 AI 的检索**用同一个深度**（原来一个是 weight、
     一个是原始 impact —— 同一个"记得多深"两套打分）。 */
  const mems = Object.values(data.memories || {}).filter(m => m.owner === npcId).sort((a, b) => RT.memDepth(data, b) - RT.memDepth(data, a)).slice(0, 3).map(m => m.content);
  const scene = getEntity(data, data.current && data.current.sceneId) || {};
  const seen = ['情景：你在' + (scene.name || '此处') + '，' + ((task.context || '') || '有人正看着你。')];
  let out = null;
  if (AI.isLive(cfg)) {
    try {
      const r = await AI.llmJSON(cfg, [
        { role: 'system', content: AI.charterShort() + '\n你是【世界模拟器】的角色模拟器。你现在是：' + name + '。' + packLines.join('；') + '。' + (mems.length ? ('你记得：' + mems.join('；')) : '') + '。' + seen.join('。') + '。' + '输出 JSON：{"line":"你的一句台词（口语化）","action":"你的一动作（三四字）","inner":"你的内心判断（一句话，给导演看的）"}。你只代表' + name + '说话，禁止写他人、禁止导演口吻、禁止超出一句台词。' },
        { role: 'user', content: task.context || '面对眼前的人，你的反应？' }
      ], () => mockActor(data, npc), Math.min(768, AI.cfgMax(cfg)));
      if (r && !r.__fallback && (r.line || r.action)) out = r;
    } catch (e) { DEG.hit("scheduler.js", e); }
  }
  if (!out) out = mockActor(data, npc);
  // 对内影响：内心→TA 的记忆（低冲击）；情绪微变
  try {
    if (out.inner) {
      // v1.96：引擎自写 → 走「按标签限量」那条路（不经内容门；角色要有内心生活，
      // 但「内心生活」≠ 每回合一条永久记忆 —— 去重条件（标签重叠≥2）对单标签永远不触发）
      RT.writeMemory(data, { owner: npcId, content: name + '此刻：' + String(out.inner).slice(0, 60), tags: ['此刻'], impact: 8, t: data.current.time }, { by: 'engine' });
    }
  } catch (e) { DEG.hit("scheduler.js", e); }
  return { conclusion: (name + '（' + (out.line || '') + '）' + (out.action || '')), detail: { who: npcId, line: out.line, action: out.action, inner: out.inner } };
}

// ---------- 生图：人物外貌库（visual.js 九维）→ 提示词（prompts.js 完整规则；LLM 或规则装配） ----------
const VIS = require('./visual');
const PRM = require('./prompts');
function imageJobCard(mode) { return PRM.imageJobCard(mode); }
// 规则装配提示词（零 LLM，默认路径）：九维人貌 + 状态 + 场景/天气 + 导演笔记 → 中文自然短句链（ComfyUI 直接可用）
// 无锚点人物：绝不写人貌（宁缺毋滥）——只有人脸可用才写
function rulePrompt(pack) {
  const face = (pack.whoInfo || []).filter(w => w.hasFace).map(w => String(w.face || '').slice(0, 400)).filter(Boolean).join('，');
  const st = String(pack.state || '').slice(0, 80);
  const sc = String(pack.scene || (pack.sceneNow && pack.sceneNow.place) || '').slice(0, 40);
  const wx = (pack.sceneNow && pack.sceneNow.weather) || '';
  const no = String(pack.note || '').slice(0, 80);
  return [face, st, (sc + (wx ? ('，' + wx) : '')), no].filter(Boolean).join('，');
}
// image：生图导演笔记 → 提示词（B 步：ComfyUI 提交+取图，见 server.js comfyRender）
async function exImage(data, cfg, task) {
  const img = task.img || {};
  const whoArr = Array.isArray(img.who) ? img.who : (img.who ? [img.who] : []);
  // v1.65b：kind 必须跟着走 —— 立绘(portrait)/场景的分辨率不同（§27），丢了它立绘就会被当场景画
  // v1.83 修 P0-2：sceneId 必须跟着任务走 —— 舞台选图按它匹配（原来派发时传了 sceneId，
  // 但任务里没存、视图里也没输出 ⇒ latestSceneImage() 里 t.sceneId 恒为 undefined，舞台永远是 ASCII 画）
  const pack = { at: img.at != null ? Number(img.at) : null, kind: String(img.kind || '').slice(0, 20), state: String(img.state || '').slice(0, 140), scene: String(img.scene || '').slice(0, 80), note: String(img.note || '').slice(0, 140), style: String(img.style || '').slice(0, 40), sceneId: String(img.sceneId || '').slice(0, 40) };
  const whoInfo = [];
  const noFace = [];
  for (const id of whoArr) {
    const e = data.entities[id] || {};
    const prof = e.profile || {};
    // 第三参 = 按世界时间算出的真实年龄 → nine 里的年龄感会随之被覆盖（世界会老去；档案不动）
    const face = VIS.whoFace(prof.visual, data.meta, RT.ageOf(data, e, data.current.time));
    whoInfo.push({ id, name: e.name || id, hasFace: face.hasFace, weak: face.weak, face: face.text, state: ((e.state || {}).mood || '') + '；此刻：' + ((prof.desires || {}).现在想 || '') });
    if (!face.hasFace) noFace.push(e.name || id);
  }
  pack.whoInfo = whoInfo;
  pack.noFace = noFace; // 无锚点名单：提示词规则已让 LLM 只画场景/状态
  pack.sceneNow = {
    place: (data.entities[data.current.sceneId] || {}).name || '',
    weather: data.current.weather || '', time: data.current.time || '',
    era: (data.meta || {}).era || ''
  };
  // 提示词来源：① AI 润色（设置开且模型在）② 规则装配（默认，零 LLM：锚点+状态+场景直连）
  const mode = String(((cfg.image || {}).mode) || 'zit');
  const aiPrompt = !!(cfg.image && cfg.image.aiPrompt);
  let ai = null;
  if (aiPrompt && AI.isLive(cfg)) {
    try {
      const r = await AI.llmJSON(cfg, [
        { role: 'system', content: imageJobCard(mode) },
        { role: 'user', content: JSON.stringify({
          导演笔记: { 谁: whoArr, 状态: pack.state, 场景: pack.scene || null, 要点: pack.note || '', 临时笔触: pack.style || '' },
          人物外貌库: whoInfo.map(w => ({ 名字: w.name, 锚点: (w.hasFace ? w.face : '（无）') + (w.weak ? '（弱锚点）' : ''), 当前状态: w.state })),
          场景快照: pack.sceneNow,
          世界设定: { 时代: (data.meta || {}).era || '', 画风: ((data.meta || {}).artStyle || (cfg.image && cfg.image.style)) || '' }
        }) }
      ], () => null, Math.min(1024, AI.cfgMax(cfg)));
      if (r && !r.__fallback && (r.prompt || r.提示词)) ai = { sceneTitle: String(r.sceneTitle || '').slice(0, 15), prompt: String(r.prompt || r.提示词 || '').slice(0, 1200) };
    } catch (e) { DEG.hit("scheduler.js", e); }
  }
  // 任务登记
  data.current.imgTasks = data.current.imgTasks || [];
  const prompt = (ai && ai.prompt) || rulePrompt(pack);
  // v1.83：sceneId（舞台选图）+ turn（图只认自己那一回合的 beat，防跨回合串图）
  const tw = { id: data.id('img'), at: pack.at, kind: pack.kind || '', who: whoArr, state: pack.state, scene: pack.scene || pack.sceneNow, note: pack.note, style: pack.style, noFace, mode, ai, prompt, sceneId: pack.sceneId || '', turn: (data.current && data.current.turnN) || 0, t: data.current.time, status: prompt ? 'prompted' : 'queued' };
  data.current.imgTasks.push(tw);
  if (data.current.imgTasks.length > 30) data.current.imgTasks = data.current.imgTasks.slice(-30);
  return { conclusion: (pack.note ? '（图『' + String(pack.note).slice(0, 14) + '…』' + (ai ? '提示词就绪' : '已进队列') + '）' : '（一张画面待生成）'), detail: { task: tw, pack } };
}
// offstage：镜头外（0 token 代码池）
async function exOffstage(data, cfg, task) {
  const r = await require('./subai').subOffstage(data, cfg, { sleeping: !!task.sleeping });
  return { conclusion: (r || []).join('；'), detail: {} };
}

executors.actor = { fn: exActor, tier: 'med' };
executors.reply = { fn: exReply, tier: 'med' };
executors.calc = { fn: exCalc, tier: 'med' };
executors.digest = { fn: exDigest, tier: 'low' };
executors.image = { fn: exImage, tier: 'low' };
executors.news = { fn: exNews, tier: 'low' };
executors.requests = { fn: exRequests, tier: 'high' };
executors.epoch = { fn: exEpoch, tier: 'med' };
executors.offstage = { fn: exOffstage, tier: 'low' };

// ---------- 调度入口 ----------
// 模型档（tier → roles 覆盖或主模型）
function tierCfg(cfg, tier) {
  const over = cfg && cfg.roles && cfg.roles[tier];
  if (!over) return cfg;
  return Object.assign({}, cfg, { llm: Object.assign({}, cfg.llm || {}, { baseURL: (over.baseURL || (cfg.llm && cfg.llm.baseURL) || '').trim(), apiKey: (over.apiKey || (cfg.llm && cfg.llm.apiKey) || '').trim(), model: (over.model || (cfg.llm && cfg.llm.model) || '').trim() }) });
}
function dispatch(data, cfg, kind, task) {
  const ex = executors[kind];
  if (!ex) return Promise.resolve({ conclusion: '', detail: {}, error: 'no executor:' + kind });
  // 委派护栏：同一人连续 5 回合被委派 → 拒绝（该导演自己写了）
  if (kind === 'actor' && task && task.npcId) {
    data.current = data.current || {};
    const arr = (data.current.delegateStreak = data.current.delegateStreak || []);
    const last = arr[arr.length - 1];
    if (last === task.npcId && arr.length >= 5) return Promise.resolve({ conclusion: '', detail: {}, error: 'delegate-limit-5:' + task.npcId });
    if (last === task.npcId) arr.push(task.npcId); else { arr.length = 0; arr.push(task.npcId); }
  }
  return ex.fn(data, tierCfg(cfg, ex.tier), task || {}).then(r => {
    try {
      data.current = data.current || {};
      data.current.aiTrace = data.current.aiTrace || [];
      data.current.aiTrace.push({ t: data.current.time, call: kind, ok: !!r, conc: String((r && r.conclusion) || '').slice(0, 40) });
      if (data.current.aiTrace.length > 40) data.current.aiTrace.shift();
    } catch (e) { DEG.hit("scheduler.js", e); }
    return r;
  }).catch(e => ({ conclusion: '', detail: {}, error: String(e && e.message || e) }));
}
// 每回合调度：due 任务并发执行（现有并行组入口统一）
function schedulerRun(data, cfg, nowISO, opts) {
  const tasks = [];
  tasks.push(dispatch(data, cfg, 'epoch', { nowISO: nowISO }));
  tasks.push(dispatch(data, cfg, 'offstage', { sleeping: !!(opts && opts.sleeping) }));
  tasks.push(dispatch(data, cfg, 'calc', { sleeping: !!(opts && opts.sleeping) }));
  return Promise.all(tasks);
}

module.exports = { dispatch, schedulerRun, executors, tierCfg, exCalc, exDigest, exEpoch, exNews, exOffstage, exReply };
