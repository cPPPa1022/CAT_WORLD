'use strict';
// token-est.js — 估算"破甲宪章"每轮输入增量（未调用 LLM；按中文字符≈0.9 token 估算）
const AI = require('../src/ai');
const data = { meta: { era: '现代（2026）', maxSeverity: 'L2', rules: [] } };
let sys = '';
try { sys = AI.SYSTEM(data, AI.loadConfig()); } catch (e) { console.error('SYSTEM err', e.message); process.exit(1); }
const cn = (s) => (String(s).match(/[\u4e00-\u9fff]/g) || []).length;
const approx = (s) => Math.round(cn(s) * 0.9 + (String(s).length - cn(s)) * 0.28);

const ch = AI.charter();
const chS = AI.charterShort();
const style = '【文风直给 · 严格档】禁止"先否定、再补充"句式（不写"不是X，而是Y"）；描写直给，禁止用隐喻、比喻、抽象词替代具体感官细节。';

const sysTk = approx(sys);
const sysNo = approx(AI.SYSTEM(data, AI.loadConfig(), true));
const chTk = approx(ch);
const stTk = approx(style);
console.log('现状 SYSTEM（含宪章）≈ ' + sysTk + ' tok | 无宪章版 ≈ ' + sysNo + ' tok');
console.log('宪章全文 ≈ ' + chTk + ' tok（' + ch.length + ' 字符）');
console.log('子调用精简宪章 ≈ ' + approx(chS) + ' tok');
console.log('文风直给（严格档追加）≈ ' + stTk + ' tok');