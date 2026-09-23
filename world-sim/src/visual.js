'use strict';
// visual.js — 视觉档案基座（生图人物一致性核心）：九维刚性锚点 + 动态维度字典 + 文本工具
// profile.visual 结构（向后兼容旧档）：
//   nine:     { 脸型与年龄感, 眉眼与瞳孔, 鼻子与嘴唇, 肤色与肤质, 体型身材, 发型与发色, 衣着与配饰, 永久标记 }   // 可缺省维度
//   anchor:   旧版字符串（九维全文拼接 或 标志物级描述）——兼容保留
//   dynamic:  { 发型, 衣着, 配饰, 状态, 表情 }    // 维度:值 词典（本轮可变，值优先于 nine）
//   style:    画风标签（缺省继承 meta.artStyle）
// 原则：没有九维 → 不写人貌（只画场景/状态），宁缺毋滥；九维里的文学形容词清掉（模型会瞎画）。

const NINE_KEYS = ['脸型与年龄感', '眉眼与瞳孔', '鼻子与嘴唇', '肤色与肤质', '体型身材', '发型与发色', '衣着与配饰', '永久标记'];
const PLACEHOLDER_RE = /（来自卡的原设）|（你还没看清）|待发现|（未知）|（无）|未知|待接触|（待接触）|暂无|没有|无永久标记/g;
/* v1.98 · P0-3：「这段文字是不是占位串」的**唯一判据**（三个调用点原来只有一处排除了它）。
   注意不能用上面那个带 g 的正则去 test —— 带 g 的 test 有 lastIndex 状态，
   连着问两次会一次真一次假（经典坑）。这里用同一份 source 建一个不带 g 的。 */
const PLACEHOLDER_TEST = new RegExp(PLACEHOLDER_RE.source);
function isPlaceholder(s) { const t = String(s == null ? '' : s).trim(); return !!t && PLACEHOLDER_TEST.test(t); }
const LITERARY_RE = /灵动|水汪汪|炯炯有神|明眸皓齿|倾国倾城|花容月貌|国色天香|沉鱼落雁|闭月羞花|英姿飒爽|气宇轩昂|玉树临风|文质彬彬|彪形大汉|虎背熊腰|魔鬼身材|凹凸有致|肌肤胜雪|肤白貌美|艳光四射|气质出众|很魅惑|很有气质|很性感/g;
// 人貌线索词：出现 ≥2 个命中 → 视为"可画的外貌信息"（否则只当标志物，不用于人貌）
const FACE_HINTS = /(脸型|脸|眉眼|眼睛|眼|瞳|眉毛|眉|鼻子|鼻头|嘴唇|唇|肤色|肤质|发色|发型|长发|短发|卷发|直发|黑发|金发|白发|棕发|银发|发髻|马尾|刘海|辫|体型|身材|身高|头身比|肩宽|腰|胸|臀|腿|雀斑|泪痣|疤痕|痣|纹身|耳环|项链|眼镜|旗袍|长裙|连衣裙|和服|制服|工装|西装|袍|衣|靴|鞋|袜|丝袜|裙|裤)/;

// 清理一段锚点文本：去占位符、去文学形容词、去多余空白（逐字段用）
function cleanText(t) {
  return String(t || '')
    .replace(PLACEHOLDER_RE, '')
    .replace(LITERARY_RE, '')
    .replace(/[；;]\s*$/, '')
    .trim();
}

// 归一：容忍 anchor 为字符串（旧档）、nine/dynamic 缺失（演示/随机世界）→ 输出可读结构（不改写 data）
function normVisual(visual, meta) {
  const v = visual || {};
  const out = {
    nine: (v.nine && typeof v.nine === 'object') ? v.nine : {},
    anchor: (typeof v.anchor === 'string') ? v.anchor : (v.anchor ? String(v.anchor) : ''),
    dynamic: (v.dynamic && typeof v.dynamic === 'object') ? v.dynamic : {},
    style: (typeof v.style === 'string') ? v.style : (meta && meta.artStyle) || ''
  };
  return out;
}

// 九维解析：把"①②…⑧…"分号/换行格式的字符串 → {维度:值}。
// 兼容两种格式：序号前缀（①②… / (1)(2)… / 1. 2. / 【1】）与"维度名："直接前缀。
// 九维解析：把"①②…⑧…"分号/换行格式的字符串 → {维度:值}。
// 兼容格式：序号前缀（①②… / 1. 2. / 逐行）与"维度名："前缀；无结构文本 → {}（由 anchor 兜底）。
function parseNineDim(str) {
  let s = String(str || '').trim();
  const out = {};
  if (!s) return out;
  let parts = [];
  if (/[①-⑧]/.test(s)) {
    const m = s.split(/([①-⑧])/);
    let cur = -1;
    for (const tok of m) {
      if (/^[①-⑧]$/.test(tok)) { cur = tok.codePointAt(0) - 0x2460; parts[cur] = ''; }
      else if (cur >= 0 && parts[cur] !== undefined) parts[cur] += tok;
    }
  } else if (/(^|\n)\s*\d+\s*[、.．]/.test(s)) {
    const pm = s.split(/(?:^|\n)\s*\d+\s*[、.．]/).map(x => x.trim()).filter(Boolean);
    parts = pm.length >= 2 ? pm : s.split(/\n+/).filter(x => x.trim());
  } else if (s.indexOf('\n') >= 0 && s.split('\n').length >= 3) {
    parts = s.split('\n').filter(x => x.trim());
  }
  // 模式 B/D：无序号分节（"维度名：值；…" 或 无序关键词段）
  if (!parts.length && /[；;|\n]/.test(s)) {
    return parseNineBySegs(s, out);
  }
  if (!parts.length) return out;
  const seq = NINE_KEYS;
  for (let i = 0; i < Math.min(parts.length, seq.length); i++) {
    let body = String(parts[i] || '').trim();
    if (!body) continue;
    // 去前导维度名（"脸型与年龄感：xxx" / "1.xxx"）
    for (const k of seq) {
      const idx = body.indexOf(k);
      if (idx === 0) { body = body.slice(k.length).replace(/^\s*[:：、.,]\s*/, '').trim(); break; }
    }
    body = cleanText(body);
    if (body) out[seq[i]] = body;
  }
  return out;
}

// 段级关键词归类：无序/无维度名前缀（如"三庭1:1:1；圆杏眼…；小巧圆鼻…"）+ 段级"维度名："前缀
function guessDim(seg) {
  const s = seg;
  // 先精确的（独有词），再宽松的（避免"脸两倍大/到大腿"误命中肢体量词）
  if (/头身比|头身|身高|体型|身形|肩宽|窄肩|宽肩|娇小|纤细|微胖|丰满|平胸|巨乳|胸围|腰身|臀|腿型|S形|匀称/.test(s)) return '体型身材';
  if (/脸型|脸轮廓|视觉年龄|年龄感|三庭|鹅蛋|瓜子脸|圆脸|方脸|长脸|娃娃脸|圆润脸|少女感|少年感|年约|岁数/.test(s)) return '脸型与年龄感';
  if (/眼距|眼裂|杏眼|单眼皮|双眼皮|瞳色|瞳孔|眸|眼尾|睫毛|眉毛|细弯眉|下垂眼|丹凤眼/.test(s)) return '眉眼与瞳孔';
  if (/鼻梁|鼻翼|鼻头|鼻型|唇形|上下唇|唇色|嘴唇|小嘴|樱粉/.test(s)) return '鼻子与嘴唇';
  if (/肤色|肤质|雀斑|日晒|红血丝|细腻|白皙|蜜色|暖白|冷白/.test(s)) return '肤色与肤质';
  if (/发色|发型|长直发|短卷发|刘海|发髻|中分|辫子|双马尾|黑长直|银发|棕发|獠牙|发量/.test(s)) return '发型与发色';
  if (/衬衫|棉袄|长裙|连衣裙|旗袍|和服|制服|工装|西装|外套|大衣|夹克|T恤|裤|袜|鞋|靴|帽|领口|袖口|围裙|丝袜|蕾丝|皮质|布料|衣摆/.test(s)) return '衣着与配饰';
  if (/泪痣|伤疤|疤痕|胎记|纹身|永久标记|标记|痣/.test(s)) return '永久标记';
  return null;
}
// 模式 D：按分号/换行分节，节内先查"维度名："前缀，再按关键词猜维（无序号/无序文本）
function parseNineBySegs(s, out) {
  const segs = String(s).split(/[；;|\n]+/).map(x => x.trim()).filter(Boolean);
  for (const seg of segs) {
    let key = null;
    let body = seg;
    for (const k of NINE_KEYS) {
      if (seg.indexOf(k) === 0) { key = k; body = seg.slice(k.length).replace(/^\s*[:：]、?\s*/, ''); break; }
    }
    if (!key) key = guessDim(seg);
    const v = cleanText(body);
    if (key && v && /^(无|无永久标记|没有)$/.test(v.replace(/永久标记/g, ''))) continue;
    if (key && v && !out[key]) out[key] = v;
  }
  return out;
}

// 验证/清理 nine：单字段清占位与文学词；空字段剔除
function nineValid(nine) {
  const out = {};
  for (const k of NINE_KEYS) {
    const v = cleanText(nine && nine[k]);
    if (v) out[k] = v;
  }
  return out;
}

// 是否有"可画的人貌"：nine ≥2 有效维度，或 anchor 含 ≥2 个人貌线索词
function faceUsable(v) {
  const n = nineValid(v && v.nine);
  const dims = Object.keys(n).filter(k => k !== '衣着与配饰');
  if (dims.length >= 2) return true;
  const a = cleanText(v && v.anchor);
  if (a && (a.match(FACE_HINTS) || []).length >= 2 && a.length >= 10) return true;
  return false;
}

// 弱锚点：只有 anchor 级（线索词达标但无九维结构）
function faceWeak(v) {
  const n = nineValid(v && v.nine);
  const dims = Object.keys(n).filter(k => k !== '衣着与配饰');
  if (dims.length >= 2) return false;
  const a = cleanText(v && v.anchor);
  return !!(a && (a.match(FACE_HINTS) || []).length >= 2 && a.length >= 10);
}

// 人貌文本（供提示词/LLM 资料包）：九维字段优先，anchor 兜底（清占位/文学词）
function nineText(v, dynamic) {
  const n = nineValid(v && v.nine);
  const parts = [];
  if (Object.keys(n).length) {
    for (const k of NINE_KEYS) if (n[k]) parts.push(n[k]);
  } else {
    const a = cleanText(v && v.anchor);
    if (a && (a.match(FACE_HINTS) || []).length >= 2) parts.push(a);
  }
  // 动态维度覆盖：发型/衣着/配饰/状态/表情 有值 → 追加（优先级=正文>动态>静态，由生成层用）
  const d = dynamic || (v && v.dynamic) || {};
  const dynTxt = dynamicText(d);
  if (dynTxt) parts.push(dynTxt);
  return parts.join('，');
}

// 动态维度 → 逗号文本
function dynamicText(dynamic) {
  const d = dynamic || {};
  const out = [];
  for (const k of ['发型', '衣着', '配饰', '表情', '状态']) {
    const v = cleanText(d[k]);
    if (v) out.push(v);
  }
  return out.join('，');
}

// 动态档案退化兼容：旧结构是 {时间戳: 视觉句}（game.js 视觉追踪写的）→ 归入"状态"
function dynCompat(dynamic) {
  const d = dynamic || {};
  const out = {};
  const keys = Object.keys(d);
  if (!keys.length) return out;
  const dimKeys = ['发型', '衣着', '配饰', '表情', '状态'];
  for (const k of keys) {
    if (dimKeys.indexOf(k) >= 0) out[k] = d[k];
    else if (/\d{1,2}:\d{2}/.test(k)) out['状态'] = [out['状态'], d[k]].filter(Boolean).join('；');
  }
  return out;
}

// ---------- 年龄修正：世界会老去 ----------
// 九维是**刚性锚点**，管的是"不随年龄变的东西"：脸型骨骼、五官、痣、疤。
// 而"年龄感"随世界时间变 —— 它不该被写死在档案里，也不该为了它每十年去改一次档案。
// 所以：**档案不动**，只在**生图这一刻**按实际年龄覆盖年龄描述。（0 token，纯代码）
const DECADE_CN = { 20: '二十', 30: '三十', 40: '四十', 50: '五十', 60: '六十', 70: '七十', 80: '八十', 90: '九十' };
const AGE_TOKEN = /(\d{1,3}\s*[-~～至]\s*\d{1,3}\s*岁|\d{1,3}\s*岁(?:左右|上下|出头|有余|多)?|二十多岁|三十多岁|四十多岁|五十多岁|六十多岁|七十多岁|八十多岁|九十多岁|少年|青年|中年|壮年|老年)/;
function ageTraits(age) {   // 只写"往下走"的变化，不会把年轻人写老
  if (age >= 80) return '面部塌陷、深皱纹、白发稀疏、体态佝偻';
  if (age >= 70) return '脸颊松弛下垂、皱纹深刻、头发花白';
  if (age >= 60) return '法令纹加深、眼袋明显、两鬓斑白';
  if (age >= 45) return '眼角与法令纹初现、面部线条变硬';
  if (age >= 30) return '面部饱满紧实';
  return '年少、面部圆润';
}
const CN_NUM = { '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
function parseCnAge(s) {                 // "五十多岁"→50 / "七十"→70 / "二十"→20 / "十"→10
  const m = String(s || '').match(/([零一二三四五六七八九十]{1,3})/);
  if (!m) return null;
  const t = m[1];
  const i = t.indexOf('十');
  if (i < 0) return CN_NUM[t] != null ? CN_NUM[t] : null;
  const hi = i === 0 ? 1 : (CN_NUM[t[0]] || 0);
  const lo = i === t.length - 1 ? 0 : (CN_NUM[t[i + 1]] || 0);
  return hi * 10 + lo;
}
function ageLabel(age) {
  const a = Math.max(0, Math.round(age));
  if (a < 20) return a + '岁';
  return (DECADE_CN[Math.floor(a / 10) * 10] || String(a)) + '多岁';
}
// 把文本里的年龄描述换成"按世界时间算出来的真实年龄"。**只有跨了 10 岁才动**——
// 否则每年微调会让同一个人忽老忽少（锚点必须稳）。
function ageFix(text, age) {
  const t = String(text || '');
  if (!t || age == null || !isFinite(age)) return t;
  const a = Math.max(0, Math.round(age));
  const m = t.match(AGE_TOKEN);
  if (!m) return t;
  let was = null;
  const nums = m[0].match(/\d{1,3}/g);
  if (nums && nums.length) was = parseInt(nums[0], 10);
  else was = parseCnAge(m[0]);                            // 中文数字："五十多岁" → 50
  if (was == null) { const i = ['少年', '青年', '中年', '壮年', '老年'].indexOf(m[0]); if (i >= 0) was = [16, 26, 45, 55, 70][i]; }
  if (was != null && Math.abs(a - was) < 10) return t;    // 没跨档 → 原样（不加任何东西）
  return t.replace(AGE_TOKEN, ageLabel(a) + '（' + ageTraits(a) + '）');
}

// 快照：whoInfo 用（构人貌 + 弱锚标记 + 无脸标记 + 按实际年龄修正）
function whoFace(visual, meta, age) {
  const v = normVisual(visual, meta);
  const usable = faceUsable(v);
  return {
    hasFace: usable,
    weak: faceWeak(v),
    text: ageFix(nineText(v, dynCompat(v.dynamic)), age),
    dims: Object.keys(nineValid(v.nine)).length
  };
}

module.exports = { NINE_KEYS, cleanText, normVisual, parseNineDim, nineValid, faceUsable, faceWeak, nineText, dynamicText, dynCompat, whoFace, ageFix, ageLabel, ageTraits, parseCnAge, PLACEHOLDER_RE, isPlaceholder };
