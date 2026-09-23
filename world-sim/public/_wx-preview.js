// 天气效果器预览 · 两类通路（独立页面，不接游戏）
// 直感（室外）：覆盖【整个舞台】—— 短边、亮、有方向感、会动
// 知晓（室内）：只覆盖【场景画】—— 长边、暗、慢，只传递"外面在下"，不把玩家拉进雨里
(function () {
const art = document.getElementById('art');
const bar = document.getElementById('bar');
const hint = document.getElementById('hint');
const modeTag = document.getElementById('modeTag');
let cur = null;
function clearAll() {
  // 必须把 .glass 一起清掉 —— 漏了它会让旧玻璃层叠在新玻璃下面，切档时读到的是上一档（实测踩过）
  document.querySelectorAll('.wxfx,.glare,.shaft,.dropsound,.glass').forEach(function(e){ e.remove(); });
  art.style.filter = '';
}
function el(tag, cls, parent) { var e = document.createElement(tag); if (cls) e.className = cls; (parent || document.body).appendChild(e); return e; }
var box = document.querySelector('.stagebox');

// ── 直感：室外阳光 ──
function senseSun() {
  modeTag.className = 'mode sense'; modeTag.textContent = '直感 · 室外';
  hint.textContent = '覆盖整个舞台：暖色罩把台词区也照进去，光柱有方向、有浮尘。动得很慢，不抢字。';
  var wrap = el('div', 'wxfx sun', box);
  wrap.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:5;overflow:hidden;border-radius:10px';
  var warm = el('div', 'glare', wrap);
  warm.style.cssText = 'position:absolute;inset:-10%;background:radial-gradient(80% 60% at 76% 12%, rgba(255,228,150,.22), rgba(255,206,120,.08) 45%, transparent 72%);animation:sunbreathe 7s ease-in-out infinite alternate';
  var s1 = el('div', 'shaft', wrap);
  s1.style.cssText = 'position:absolute;top:-30%;left:52%;width:34%;height:170%;transform:rotate(16deg);background:linear-gradient(90deg,transparent,rgba(255,236,180,.14) 35%,rgba(255,236,180,.05) 60%,transparent);animation:shaftdrift 11s ease-in-out infinite alternate;filter:blur(2px)';
  var s2 = el('div', 'shaft', wrap);
  s2.style.cssText = 'position:absolute;top:-30%;left:34%;width:12%;height:170%;transform:rotate(16deg);background:linear-gradient(90deg,transparent,rgba(255,240,200,.10),transparent);animation:shaftdrift2 14s ease-in-out infinite alternate;filter:blur(3px)';
  for (var i = 0; i < 16; i++) {
    var d = el('i', null, wrap);
    d.style.cssText = 'position:absolute;width:2px;height:2px;border-radius:50%;background:rgba(255,240,200,' + (0.25 + (i % 3) * 0.16) + ');left:' + ((i * 61) % 100) + '%;top:' + ((i * 37) % 100) + '%;animation:dustfloat ' + (9 + (i % 4) * 2.5) + 's ease-in-out infinite alternate';
  }
  art.style.transition = 'filter 1.4s ease'; art.style.filter = 'brightness(1.06) saturate(1.08)';
}

// ── 直感：室外大雨（说明"明显"的上限）──
function senseRain() {
  modeTag.className = 'mode sense'; modeTag.textContent = '直感 · 室外';
  hint.textContent = '同一条直感通路：雨丝穿过整个舞台、有斜度、地面反光。台词仍然读得清。';
  var wrap = el('div', 'wxfx rain-heavy', box);
  wrap.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:5;overflow:hidden;border-radius:10px';
  for (var i = 0; i < 60; i++) {
    var depth = i % 3; var d = el('i', null, wrap);
    d.style.cssText = 'position:absolute;top:-20%;width:1px;height:' + (18 - depth * 4) + 'px;border-radius:1px;background:linear-gradient(180deg,transparent,rgba(170,215,255,.8));left:' + ((i * 97) % 100) + '%;transform:rotate(14deg);animation:falldrop ' + (0.40 + depth * 0.2) + 's linear infinite;animation-delay:-' + (((i * 37) % 100) / 100 * 1.5) + 's;opacity:' + (0.85 - depth * 0.2);
  }
  var wet = el('div', null, wrap);
  wet.style.cssText = 'position:absolute;left:0;right:0;bottom:0;height:34%;background:linear-gradient(0deg,rgba(120,170,220,.16),transparent);animation:wetpulse 3.4s ease-in-out infinite alternate';
  art.style.transition = 'filter 1.2s ease'; art.style.filter = 'brightness(.86) saturate(.9)';
}

// ── 玻璃层（室内专用）── v3：按 GPT 的三条优先级重做
//
// GPT 的判断（我验证后同意，而且它比我说的更准）：
//   「你的问题不是水珠画得不够像，是你把雨窗理解成了『背景+模糊+一堆会折射的水珠』。」
//
// 而且我原来那套折射**数学上就是坏的**：
//   background-size:220% 在 3px 的珠子上 = 把 1100px 的底图压进 6.6px（压缩 167 倍）
//   要真做 2.2x 放大应该是 80667%。所以珠子里根本是糊色，不是「小地图」。
//
// 三条优先级：
//  ① 焦平面差 —— 世界不清晰、玻璃清晰（这是「隔着玻璃」的来源，不是 blur 大小的问题）
//  ② 水珠 = 局部光学扰动 + 边缘高光（不是放大镜）
//  ③ 玻璃上必须有大量「不是水珠」的东西 —— 小东西多、大东西少

// 把场景画变成一张图（用途变了：不再做折射采样，而是做**光晕**）
function artAsImage() {
  var DQ = String.fromCharCode(34);
  var lines = (art.textContent || '').split(String.fromCharCode(10));
  var w = 1000, h = Math.max(340, lines.length * 26);
  var svg = '<svg xmlns=' + DQ + 'http://www.w3.org/2000/svg' + DQ + ' width=' + DQ + w + DQ + ' height=' + DQ + h + DQ + ' viewBox=' + DQ + '0 0 ' + w + ' ' + h + DQ + ' preserveAspectRatio=' + DQ + 'none' + DQ + '>' +
    '<rect width=' + DQ + '100%' + DQ + ' height=' + DQ + '100%' + DQ + ' fill=' + DQ + '#0b1218' + DQ + '/>' +
    '<g font-family=' + DQ + 'monospace' + DQ + ' font-size=' + DQ + '19' + DQ + ' fill=' + DQ + '#a89263' + DQ + '>' +
    lines.map(function (line, i) { return '<text x=' + DQ + '18' + DQ + ' y=' + DQ + (24 + i * 26) + DQ + '>' + line + '</text>'; }).join('') +
    '</g></svg>';
  return 'url(' + DQ + 'data:image/svg+xml;utf8,' + encodeURIComponent(svg) + DQ + ')';
}

// 玻璃 = ①焦平面差 + 光晕 + 反光 + 边缘
function glassLayer(parent, opt) {
  opt = opt || {};
  var g = el('div', 'glass', parent);
  g.style.cssText = 'position:absolute;inset:0;pointer-events:none;border-radius:8px;overflow:hidden;z-index:3';
  // ① 外面的世界失焦 —— 这是「隔着玻璃」的第一来源
  var defocus = el('div', null, g);
  defocus.style.cssText = 'position:absolute;inset:0;backdrop-filter:blur(' + (opt.blur || 2.4) + 'px) saturate(.86) brightness(.94);-webkit-backdrop-filter:blur(' + (opt.blur || 2.4) + 'px) saturate(.86) brightness(.94)' + ';background:rgba(190,212,236,' + (opt.tint || 0.035) + ')' ;
  // ①b 光晕：亮的字符（灯/招牌/¥）向外散开 —— 雨夜里这才是「看不清」的真实形态
  var glow = el('div', null, g);
  glow.style.cssText = 'position:absolute;inset:0;background-image:' + artAsImage() + ';background-size:100% 100%;' +
    'filter:blur(' + (opt.glowBlur || 3.2) + 'px) brightness(1.9) saturate(1.25);mix-blend-mode:screen;opacity:' + (opt.glow || 0.5) + ';' +
    'animation:glowbreathe 6s ease-in-out infinite alternate';
  // 玻璃反光（室内光打上去的一条斜向亮带）
  var sheen = el('div', null, g);
  sheen.style.cssText = 'position:absolute;top:-40%;left:-32%;width:68%;height:180%;transform:rotate(14deg);background:linear-gradient(90deg,transparent,rgba(255,255,255,' + (opt.sheen || 0.055) + ') 50%,transparent);animation:sheen 18s ease-in-out infinite alternate';
  var edge = el('div', null, g);
  edge.style.cssText = 'position:absolute;inset:0;border-radius:8px;box-shadow:inset 0 0 0 1px rgba(220,235,255,.08), inset 0 0 30px rgba(180,210,240,.05)';
  return g;
}

// ③ 多尺度 + 真实水滴（v4）
//
// 用户指出两条：
//  ①「水滴不够真实」—— 旧版是同心圆渐变（看着像甜甜圈/发光球）：
//     缺高光点、缺不对称、边缘均匀。真水珠是「一个小亮点 + 近透明主体 + 下缘暗弧」。
//  ②「水渍做反了」—— 确认是 bug：水滴往下滑，尾迹却挂在 top:92%（下方 = 前方）。
//     真实的湿痕在【上方】（后方）= 它走过的路，且靠近水滴处最湿最亮。
// 位置/尺寸必须用散列，不能用取模 —— 实测 (a*53)%99 这类算法让所有点落在少数固定斜线上，肉眼能看出斜纹。
// 用一个便宜的确定性散列（同 seed 同结果，保证每次重绘一致）。
function rnd(i, salt) {
  var x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}
function dropBg(scale) {
  // 高光点（左上，光来的方向）+ 反弹光（右下，很弱）+ 主体/边缘暗弧/外缘焦散
  return 'radial-gradient(circle at 32% 26%, rgba(255,255,255,.92) 0%, rgba(255,255,255,.5) 7%, rgba(255,255,255,0) 19%),' +
    'radial-gradient(circle at 64% 74%, rgba(220,240,255,.30) 0%, rgba(220,240,255,0) 26%),' +
    'radial-gradient(circle at 50% 54%, rgba(200,228,255,.05) 0 40%, rgba(180,210,246,.20) 70%, rgba(16,34,56,.46) 92%, rgba(205,232,255,.28) 100%)';
}
// 走法表（散列分配，避免所有水滴同一套动作）
var MIDWALK = ['slideA', 'slideB', 'slideC'];
var BIGWALK = ['bigA', 'bigB'];
var TRAILWALK = ['trailGrow1', 'trailGrow2'];
var EASE = ['cubic-bezier(.33,.05,.6,.98)', 'cubic-bezier(.42,.02,.58,1)', 'cubic-bezier(.25,.08,.7,.95)'];
function rainScale(parent, rain) {
  rain = rain || {};
  var micro = rain.micro || 140, mid = rain.mid || 26, big = rain.big || 5, running = rain.running || 7;
  // ① 极细小水点：数量最多，几乎不动 —— 玩家第一眼意识不到，但缺了就假
  for (var a = 0; a < micro; a++) {
    var m = el('i', 'micro', parent);
    var sz = (0.9 + rnd(a, 7) * 1.6).toFixed(2);
    m.style.cssText = 'position:absolute;left:' + (rnd(a, 1) * 100).toFixed(2) + '%;top:' + (rnd(a, 2) * 100).toFixed(2) + '%;width:' + sz + 'px;height:' + sz + 'px;border-radius:50%;' +
      'background:radial-gradient(circle at 36% 32%, rgba(255,255,255,.72), rgba(255,255,255,.18) 45%, rgba(190,215,245,.06) 78%, transparent);' +
      'opacity:' + (0.16 + rnd(a, 8) * 0.42).toFixed(2) + ';' +
      'animation:microdrift ' + (9 + rnd(a, 9) * 22).toFixed(1) + 's ease-in-out infinite alternate;animation-delay:-' + (rnd(a, 10) * 20).toFixed(1) + 's;';
  }
  // ② 中等水珠：比周围玻璃【更清楚】（焦平面差），形状略不规则
  var RR = ['52% 48% 50% 50% / 48% 52% 52% 48%', '50% 50% 48% 52% / 52% 48% 52% 48%', '48% 52% 52% 48% / 50% 50% 48% 52%'];
  for (var b = 0; b < mid; b++) {
    var d = el('i', 'drop', parent);
    var w = 2.4 + rnd(b, 3) * 3.6;
    var slides = rnd(b, 11) < (rain.slideRatio == null ? 0.35 : rain.slideRatio);
    d.style.cssText = 'position:absolute;left:' + (3 + rnd(b, 4) * 91).toFixed(2) + '%;top:' + (rnd(b, 5) * 88).toFixed(2) + '%;width:' + w.toFixed(1) + 'px;height:' + (w * (slides ? 1.22 : 1.08)).toFixed(1) + 'px;' +
      'border-radius:' + RR[b % 3] + ';' +
      'background:' + dropBg() + ';' +
      // 亮度调低（旧的 1.42 会让水滴发亮像 LED）。靠「更清楚」而不是「更亮」体现透镜
      'backdrop-filter:blur(.2px) brightness(1.16) saturate(1.06);-webkit-backdrop-filter:blur(.2px) brightness(1.16) saturate(1.06);' +
      'box-shadow:0 1px 1.5px rgba(0,0,0,.22);' +
      (slides ? 'animation:' + MIDWALK[Math.floor(rnd(b, 17) * 3)] + ' ' + (11 + rnd(b, 18) * 14).toFixed(1) + 's ' + EASE[Math.floor(rnd(b, 19) * 3)] + ' infinite;animation-delay:-' + (rnd(b, 20) * 20).toFixed(1) + 's;' : 'animation:droprest ' + (6 + rnd(b, 21) * 8).toFixed(1) + 's ease-in-out infinite alternate;');
    if (slides) {
      // 水痕是【兄弟节点】不是子节点：水珠滑走，痕留在玻璃上。
      // 做法 = 锚在与水珠相同的起点，高度从 0 长到行程长度，时长/延迟与水珠一致。
      var t1 = el('b', 'trail', parent);
      var tl = parseFloat(d.style.left), tt = parseFloat(d.style.top);
      t1.style.cssText = 'position:absolute;left:' + tl.toFixed(2) + '%;top:' + tt.toFixed(2) + '%;width:' + Math.max(0.8, w * 0.24).toFixed(1) + 'px;' +
        'transform-origin:50% 0;' + (rnd(b, 22) < 0.5 ? 'transform:rotate(' + (rnd(b, 23) * 2.6 - 1.3).toFixed(2) + 'deg);' : '') +
        'background:linear-gradient(180deg, transparent, rgba(206,230,255,.10) 22%, rgba(220,238,255,.30) 74%, rgba(232,245,255,.42));border-radius:2px;' +
        'animation:' + TRAILWALK[Math.floor(rnd(b, 17) * 2)] + ' ' + (11 + rnd(b, 18) * 14).toFixed(1) + 's linear infinite;animation-delay:-' + (rnd(b, 20) * 20).toFixed(1) + 's;';
    }
  }
  // ③ 大水珠：少量，缓慢下爬，带长水痕（水痕在【上方】）
  for (var c = 0; c < big; c++) {
    var bigEl = el('i', 'bigdrop', parent);
    var bw = 5 + rnd(c, 6) * 4.5;
    bigEl.style.cssText = 'position:absolute;left:' + (5 + rnd(c, 12) * 83).toFixed(2) + '%;top:' + (rnd(c, 13) * 62).toFixed(2) + '%;width:' + bw.toFixed(1) + 'px;height:' + (bw * 1.18).toFixed(1) + 'px;' +
      'border-radius:' + RR[(c + 1) % 3] + ';' +
      'background:' + dropBg() + ';' +
      'backdrop-filter:blur(.12px) brightness(1.24) saturate(1.1);-webkit-backdrop-filter:blur(.12px) brightness(1.24) saturate(1.1);' +
      'box-shadow:0 1.5px 3px rgba(0,0,0,.26);' +
      'animation:' + BIGWALK[Math.floor(rnd(c, 24) * 2)] + ' ' + (19 + rnd(c, 25) * 14).toFixed(1) + 's ' + EASE[Math.floor(rnd(c, 26) * 3)] + ' infinite;animation-delay:-' + (rnd(c, 27) * 24).toFixed(1) + 's;';
    // 水痕同样是【兄弟节点】：留在玻璃上，高度长起来（水珠滑走、痕留下）
    var tail = el('b', 'trail', parent);
    var tll = parseFloat(bigEl.style.left), tlt = parseFloat(bigEl.style.top);
    tail.style.cssText = 'position:absolute;left:' + tll.toFixed(2) + '%;top:' + tlt.toFixed(2) + '%;width:' + Math.max(1, bw * 0.28).toFixed(1) + 'px;' +
      'transform-origin:50% 0;' + (rnd(c, 28) < 0.5 ? 'transform:rotate(' + (rnd(c, 29) * 3.4 - 1.7).toFixed(2) + 'deg);' : '') +
      'background:linear-gradient(180deg, transparent, rgba(210,232,255,.12) 20%, rgba(224,242,255,.34) 72%, rgba(236,248,255,.46));border-radius:2px;' +
      'animation:trailGrowBig ' + (19 + rnd(c, 25) * 14).toFixed(1) + 's linear infinite;animation-delay:-' + (rnd(c, 27) * 24).toFixed(1) + 's;';
  }
  // ④ 玻璃上零散的旧水痕（没有水滴的、已经快干的痕迹）
  for (var k = 0; k < running; k++) {
    var t2 = el('b', 'trail', parent);
    t2.style.cssText = 'position:absolute;left:' + (4 + rnd(k, 14) * 88).toFixed(2) + '%;top:' + (rnd(k, 15) * 70).toFixed(2) + '%;width:1.5px;height:' + (28 + rnd(k, 16) * 60).toFixed(0) + 'px;' +
      'background:linear-gradient(180deg, rgba(214,234,255,.20), rgba(210,232,252,.07) 60%, transparent);border-radius:2px;' +
      'animation:trailfade ' + (14 + (k % 4) * 4) + 's ease-in-out infinite;animation-delay:-' + ((k * 19) % 100) / 100 * 12 + 's;';
  }
}

var GLASS_PRESET = {
  storm:  { blur: 3.2, tint: 0.055, sheen: 0.07, glowBlur: 4.2, glow: 0.58, micro: 190, mid: 34, big: 8, running: 11, slideRatio: 0.45 },
  heavy:  { blur: 2.7, tint: 0.045, sheen: 0.06, glowBlur: 3.6, glow: 0.54, micro: 160, mid: 28, big: 6, running: 9,  slideRatio: 0.38 },
  mid:    { blur: 2.2, tint: 0.036, sheen: 0.05, glowBlur: 3.0, glow: 0.48, micro: 120, mid: 20, big: 4, running: 6,  slideRatio: 0.30 },
  light:  { blur: 1.6, tint: 0.024, sheen: 0.04, glowBlur: 2.2, glow: 0.40, micro: 70,  mid: 12, big: 2, running: 3,  slideRatio: 0.20 },
  night:  { blur: 2.4, tint: 0.045, sheen: 0.035, glowBlur: 3.4, glow: 0.44, micro: 100, mid: 17, big: 4, running: 5,  slideRatio: 0.30 }
};

function indoorGlass(kind, extra) {
  var cfg = GLASS_PRESET[kind] || GLASS_PRESET.mid;
  modeTag.className = 'mode know'; modeTag.textContent = '知晓 · 室内';
  var g = glassLayer(art, cfg);
  rainScale(g, cfg);
  if (extra) extra(g);
  art.style.transition = 'filter 1.6s ease';
  art.style.filter = extra && extra.dim ? ('brightness(' + extra.dim + ') saturate(.85)') : 'brightness(.98) saturate(.9)';
  return cfg;
}

function knowStorm() {
  hint.textContent = '雷阵雨：外景最糊、光晕最强、水珠最多最急，偶尔一道闪电透过玻璃。';
  indoorGlass('storm');
  var flash = el('div', null, art.querySelector('.glass'));
  flash.style.cssText = 'position:absolute;inset:0;background:rgba(226,238,255,.16);opacity:0;animation:glassflash 6.5s linear infinite;mix-blend-mode:screen';
}
function knowHeavy() { hint.textContent = '大雨：外景失焦明显、亮的招牌散成光斑；水珠多、大小不一，少数在滑并拖出水痕。'; indoorGlass('heavy'); }
function knowMid() { hint.textContent = '中雨：中等的水珠和细密的小水点，外景还能认出轮廓。'; indoorGlass('mid'); }
function knowLight() { hint.textContent = '小雨：水点稀、外景清楚 —— 只是「知道外面在下」。'; indoorGlass('light'); }
function knowNight() {
  hint.textContent = '「我听着雨声入眠」：玻璃外是夜色，水珠慢慢爬，几乎不打扰。';
  indoorGlass('night');
  var g = art.querySelector('.glass');
  var night = el('div', null, g);
  night.style.cssText = 'position:absolute;inset:0;background:linear-gradient(180deg, rgba(22,32,54,.42), rgba(12,20,36,.52));pointer-events:none;z-index:-1';
  art.style.filter = 'brightness(.72) saturate(.7)';
}

var MODES = [
  ['sun', '☀ 室外 · 阳光明媚', senseSun],
  ['rainheavy', '🌧 室外 · 大雨（对照）', senseRain],
  ['storm', '⛈ 室内 · 雷阵雨', knowStorm],
  ['heavy', '🌧 室内 · 大雨', knowHeavy],
  ['mid', '🌧 室内 · 中雨', knowMid],
  ['light', '🌦 室内 · 小雨', knowLight],
  ['night', '🌙 室内 · 听着雨声入眠', knowNight]
];
MODES.forEach(function (m) {
  var b = document.createElement('button'); b.textContent = m[1];
  b.onclick = function () {
    bar.querySelectorAll('button').forEach(function(x){ x.classList.remove('on'); });
    b.classList.add('on'); clearAll(); m[2](); cur = m[0];
  };
  bar.appendChild(b);
});
setTimeout(function(){ var b = bar.querySelector('button'); b.classList.add('on'); senseSun(); }, 80);
})();