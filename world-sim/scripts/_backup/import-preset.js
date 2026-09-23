// import-preset.js — 酒馆 v2 预设导入与编译（文本100%保留，机制等效翻译）
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { resBase } = require('./store');

function parsePreset(raw) {
  const d = JSON.parse(raw);
  if (!Array.isArray(d.prompts)) throw new Error('不是酒馆 v2 预设（缺 prompts 数组）');
  return d;
}

function compilePreset(d) {
  const segs = (d.prompts || []).map((x, i) => ({ i, name: (x && x.name) || '', content: (x && x.content) || '' }));
  // 1) 变量候选：按变量名收集（setvar 首次定义为主值；同名后续=候选）
  const varOptions = {};
  for (const s of segs) {
    const m = s.content.match(/\{\{setvar::([a-zA-Z0-9_:-]+)::/);
    if (m) {
      const name = m[1];
      if (!varOptions[name]) varOptions[name] = [];
      varOptions[name].push({ id: s.i, name: s.name || ('选项' + s.i), content: s.content.slice(s.content.indexOf('::') + 2).replace(/\}\}$/, '').trim() });
    }
  }
  // 2) 变量值表（每个变量的实际内容块）
  const varValues = {};
  for (const s of segs) {
    const setRe = /\{\{setvar::([a-zA-Z0-9_:-]+)::([\s\S]*?)\}\}/g;
    let m; while ((m = setRe.exec(s.content))) { varValues[(m[1] + '|' + s.i)] = m[2]; }
    const addRe = /\{\{addvar::([a-zA-Z0-9_:-]+)::([\s\S]*?)\}\}/g;
    while ((m = addRe.exec(s.content))) { varValues[(m[1] + '|' + s.i)] = (varValues[(m[1] + '|' + s.i)] || '') + '\n' + m[2]; }
  }
  // 3) 默认选择：每个有候选项的变量取第一个，并标记
  const defaults = {};
  for (const k of Object.keys(varOptions)) { const o = varOptions[k]; defaults[k] = o[0].id; }
  // 4) 生成全文本（含变量替换+指令剥离），并保存候选结构供 UI 用
  function buildText(chosen) {
    const chosenMap = {}; for (const k of Object.keys(varOptions)) { const id = (chosen && chosen[k] != null) ? chosen[k] : defaults[k]; const found = varValues[k + '|' + id]; if (found !== undefined) chosenMap[k] = found; }
    let text = segs.map(s => s.content).join('\n\n');
    text = text.replace(/\{\{getglobalvar::([a-zA-Z0-9_:-]+)\}\}/g, '@GVG_$1@');
    text = text.replace(/\{\{getvar::([a-zA-Z0-9_:-]+)\}\}/g, '@GV_$1@');
    text = text.replace(/\{\{trim\}\}/g, '');
    text = text.replace(/\{\{setvar::[^{}]+\}\}/g, '');
    text = text.replace(/\{\{addvar::[^{}]+\}\}/g, '');
    text = text.replace(/\s*\{\{[^{}]+\}\}\s*/g, '\n');
    text = text.replace(/@GVG_([a-zA-Z0-9_:-]+)@/g, '{{getglobalvar::$1}}');
    text = text.replace(/@GV_([a-zA-Z0-9_:-]+)@/g, '{{getvar::$1}}');
    // 剥离空段标题行（如 📚===主要文风=== 后空行保留）
    return text;
  }
  const text = buildText(null);
  const adapter = '【系统适配 · 必须遵守】你同时服务于世界模拟器：输出仍然是本系统的 JSON（frame=正文，对应 dream_plot 的 dream_body；updates=状态栏，对应 dream_after_format；frame.options=正文后的下一步选项）。正文内容必须遵守以下预设的全部文风与规则要求。';
  const varsMeta = Object.keys(varOptions).map(k => ({ name: k, options: varOptions[k].map(o => ({ id: o.id, name: o.name })) }));
  const niceName = d.name || ((d.prompts || []).find(p => p && p.name && /思客|梦|预设|文风/.test(String(p.name))) || {}).name || '导入预设';
  const compiled = { name: niceName, adapter, text, defaults, varsMeta, varValues, sample: { temperature: d.temperature, topP: d.top_p, presence: d.presence_penalty, frequency: d.frequency_penalty, maxTokens: Math.min(d.openai_max_tokens || 2500, 8192) } };
  return compiled;
}

function applyVars(compiled, chosen, customs) {
  if (!compiled) return '';
  const chosenMap = {};
  for (const k of Object.keys(compiled.varValues || {})) {
    const sep = k.indexOf('|');
    const vn = k.slice(0, sep), vid = k.slice(sep + 1);
    const want = (chosen && chosen[vn] != null) ? chosen[vn] : (compiled.defaults[vn]);
    if (String(want) === '@@CUSTOM@@') { chosenMap[vn] = (customs && customs[vn]) || ''; }
    else if (String(want) === String(vid)) chosenMap[vn] = compiled.varValues[k];
  }
  let text = compiled.text .replace(/\{\{getglobalvar::([a-zA-Z0-9_:-]+)\}\}/g, (mm, n) => chosenMap[n] || '');
  text = text.replace(/\{\{getvar::([a-zA-Z0-9_:-]+)\}\}/g, (mm, n) => chosenMap[n] || '');
  return (compiled.adapter || '') + '\n\n' + text;
}

function saveImported(id, compiled) {
  const dir = path.join(resBase(), 'presets');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify(compiled, null, 2));
}

function loadImported(id) {
  const f = path.join(resBase(), 'presets', id + '.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

function listImported() {
  const dir = path.join(resBase(), 'presets');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(x => x.endsWith('.json')).map(x => {
    try { const c = JSON.parse(fs.readFileSync(path.join(dir, x), 'utf8')); return { id: x.replace(/\.json$/, ''), name: c.name, len: c.text.length, vars: c.varsMeta || [] }; } catch (e) { return null; }
  }).filter(Boolean);
}

async function importPreset(raw) {
  const d = parsePreset(raw);
  const compiled = compilePreset(d);
  const id = 'p_' + Date.now().toString(36);
  saveImported(id, compiled);
  return { id, name: compiled.name, len: compiled.text.length, sample: compiled.sample, vars: compiled.varsMeta };
}

module.exports = { parsePreset, compilePreset, applyVars, saveImported, loadImported, listImported, importPreset };