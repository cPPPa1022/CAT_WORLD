// art-perspective-check.js — 场景画的空间关系断言（俯视平面图）
// 用户 2026-09-14 两次实测反馈定下来的规则：
//   ① "账本/算盘/糖罐看着像在柜台下面" → 东西必须画在柜台**框内**
//   ② "这是上帝视角、垂直向下，不是斜面；沈姨怎么站在柜台里" → 用矩形框表达平面，人站在**框外**
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const W = require(path.join(ROOT, 'src', 'world'));
const PRES = require(path.join(ROOT, 'src', 'presentation'));

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✔', m)) : (fail++, console.log('  ✘ FAIL:', m)); };
const vw = (s) => { let w = 0; for (const ch of String(s)) w += (ch.codePointAt(0) > 0x2e80 ? 2 : 1); return w; };

const d = W.buildDemoWorld();
const m = PRES.sceneModel(d, (id) => (d.entities[id] && d.entities[id].name) || '？');
const L = String(m.art || '').split('\n');

// [1] 50 列对齐（错一列整张画就歪）
{
  const bad = L.map((l, i) => ({ i, w: vw(l) })).filter(x => x.w !== 52 && x.w !== 50);
  ok(bad.length === 0, '所有行视觉宽 = 52（异常行：' + JSON.stringify(bad) + '）');
}

// [2] 柜台必须画成**矩形框**（俯视平面），不是一行标签
const top = L.findIndex(l => /┌─{6,}┐/.test(l));
const bottom = L.findIndex((l, i) => i > top && /└─{6,}┘/.test(l));
ok(top > 0, '柜台有一个矩形框的上边 ┌───┐（第 ' + top + ' 行）');
ok(bottom === top + 3, '柜台矩形框是闭合的（上边 ' + top + ' → 下边 ' + bottom + '，共 4 行）');

// [3] ★核心一：台面上的东西必须画在**框内**
{
  const itemRow = L.findIndex(l => /账本/.test(l));
  ok(itemRow > top && itemRow < bottom, '账本在柜台框内（第 ' + itemRow + ' 行，框 ' + top + '–' + bottom + '）');
  const lb = L[itemRow].indexOf('│'), rb = L[itemRow].lastIndexOf('│');
  const a = L[itemRow].indexOf('账本'), z = L[itemRow].indexOf('糖罐') + 4;
  ok(a > lb && z < rb, '账本/算盘/糖罐都在框的左右壁之间（东西 ' + a + '–' + z + ' ⊂ 框内 ' + lb + '–' + rb + '）');
}

// [4] ★核心二：人（●/○）必须画在**框外**
{
  const inBox = [];
  for (let r = top; r <= bottom; r++) { if (/[●○]/.test(L[r])) inBox.push(r); }
  ok(inBox.length === 0, '柜台框内没有任何人物标记（框内行：' + JSON.stringify(inBox) + '）—— 人不会"站在柜台里"');
  const anyPerson = L.some(l => /[●○]/.test(l));
  ok(anyPerson, '画里确实有人物标记（否则上一条是空过）');
}

// [5] 人物标记都要有对应 mark，且不压在框线上
{
  const pmarks = (m.marks || []).filter(x => /^npc_|^player$/.test(String(x.id)));
  ok(pmarks.length >= 1, '人物标记已登记在 marks 里（' + pmarks.length + ' 个）');
  const onLine = pmarks.filter(x => /[┌┐└┘│──]/.test(String(L[x.row] || '').slice(x.col, x.col + 3)));
  ok(onLine.length === 0, '没有人物标记压在柜台框线上（' + JSON.stringify(onLine.map(x => x.id)) + '）');
}

// [6] 玩家标记只出现一次（曾经模板里手写一份 + 锚点又画一份 = [你 [你 ]）
{
  const cnt = (String(m.art || '').match(/\[你/g) || []).length;
  ok(cnt === 1, '玩家标记 [你 只出现一次（实测 ' + cnt + ' 次）');
}

// [7] 呈现门控：画里不出现数据库字段名式的术语
{
  ok(!/账本记录|关系变化|记忆新增|事件开始|信息到达|impact|ledger/.test(String(m.art || '')), '画里不含系统术语（术语不上桌）');
}

// [8] ★画布宽度可变（v1.37）：任何宽度都必须成框，不许破
//     用户口径：「不限制，画出来怎样就是怎样（别出现 UI 错误）」——这条就是"别出 UI 错误"的守门人。
{
  const widths = [30, 50, 70, 100, 140];
  const bad = [];
  for (const w of widths) {
    const d2 = W.buildDemoWorld();
    const p2 = d2.entities['pl_1'];
    p2.layout = { w: w, north: ['木货架', '挂钟'], east: ['挂历'], west: ['煤炉'], floor: ['货垛', '条凳', '水缸'] };
    let m2 = null;
    try { m2 = PRES.sceneModel(d2, (id) => (d2.entities[id] && d2.entities[id].name) || '？'); } catch (e) { bad.push(w + '列 抛错:' + String(e.message).slice(0, 30)); continue; }
    const art = String(m2.art || '');
    if (!art) { bad.push(w + '列 渲染为空'); continue; }
    const L2 = art.split('\n').filter(x => x.indexOf('║') === 0);
    const want = w + 2;
    const off = L2.map((l, i) => ({ i, v: vw(l) })).filter(x => x.v !== want);
    if (off.length) bad.push(w + '列 有 ' + off.length + ' 行不成框（如第 ' + off[0].i + ' 行宽 ' + off[0].v + '）');
  }
  ok(bad.length === 0, '画布 30/50/70/100/140 列都能成框（问题：' + JSON.stringify(bad) + '）');
}

// [9] 超宽/超窄请求要被夹到安全区（防止一行几万字符把渲染拖死 = UI 错误）
{
  const d3 = W.buildDemoWorld();
  const p3 = d3.entities['pl_1'];
  let okMin = true, okMax = true;
  p3.layout = { w: 3, north: [], east: [], west: [], floor: [] };
  try { const a3 = PRES.ensureArt(d3, p3); okMin = a3.w >= 24; } catch (e) { okMin = false; }
  const d4 = W.buildDemoWorld();
  const p4 = d4.entities['pl_1'];
  p4.layout = { w: 100000, north: [], east: [], west: [], floor: [] };
  try { const a4 = PRES.ensureArt(d4, p4); okMax = a4.w <= 160; } catch (e) { okMax = false; }
  ok(okMin && okMax, '过窄(3)/过宽(100000) 的请求被夹进 24–160 安全区（防止渲染被拖死）');
}

// [10] 落格必须落在**纯空地行**上（写在陈设/纹理上会撑破行 = 破框；这是生成器按容量放大后的新风险）
{
  const bad = [];
  for (const w of [40, 70, 100, 140]) {
    const d5 = W.buildDemoWorld();
    const p5 = d5.entities['pl_1'];
    p5.layout = { w: w, north: ['行车梁', '通风窗', '广播喇叭'], east: ['磅秤', '记账桌'], west: ['麻袋堆', '独轮车', '油桶'], south: ['值班室'], floor: ['输送带', '谷堆', '木梯', '照明灯', '消防桶'] };
    let m5 = null;
    try { m5 = PRES.sceneModel(d5, (id) => (d5.entities[id] && d5.entities[id].name) || '？'); } catch (e) { bad.push(w + '列 抛错'); continue; }
    const L5 = String(m5.art || '').split('\n');
    for (const mk of (m5.marks || [])) {
      const seg = String(L5[mk.row] || '').slice(mk.col, mk.col + Math.max(2, mk.len));
      if (/[░▇★]/.test(seg)) bad.push(w + '列 ' + mk.id + '=' + JSON.stringify(seg));
    }
  }
  ok(bad.length === 0, '任何画布宽度下，标记都不会落在陈设/纹理上（问题：' + JSON.stringify(bad.slice(0, 4)) + '）');
}

console.log('\n==== art-perspective-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
