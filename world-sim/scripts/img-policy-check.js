// img-policy-check.js — 配图偏好 / 引擎兜底画面笔记 断言（v1.62）
// 用户：「当开启生图功能按照原有插件设计（需至少生成 1 张）」「我都开了生图模块了，为什么没有！」
'use strict';
const path = require('path'); const os = require('os'); const fs = require('fs');
const TMP = path.join(os.tmpdir(), 'ws-imgpol-' + Date.now());
process.env.WORLD_SIM_DATA = TMP; fs.mkdirSync(TMP, { recursive: true });
const G = require('../src/game');
const { buildDemoWorld } = require('../src/world');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
console.log('');
console.log('配图偏好 · 引擎兜底画面笔记（AI 没写笔记时引擎自己补一条，保证至少 1 张）');

const d = buildDemoWorld();
const sb = d.entities['npc_shenyi'] || Object.values(d.entities).find(e => e.type === 'person');
ok(!!sb, '演示世界里有人物（' + (sb && sb.name) + '）');
// 把 TA 放到当前场景，并让玩家"见过"
sb.state.location = d.current.sceneId;
d.knowledge.knownPeople = [sb.id];

// 1) 有在场人物 → 挑出来 + 绑定到本回合最后一个 beat
const out = { frame: { beats: [{ text: 'a' }, { text: 'b' }, { text: 'c' }] } };
const n1 = G.autoImgNote(d, out);
ok(Array.isArray(n1.who) && n1.who.length === 1 && n1.who[0] === sb.id, '挑中了在场的那位（' + n1.who.join(',') + '）');
ok(n1.at === 2, '★ 绑定到本回合最后一个 beat（at=2，beats 共 3 条）→ 图会进叙事流');
ok(typeof n1.state === 'string' && n1.state.indexOf('此刻：') === 0, 'state 只写看得见的字段（' + n1.state + '）');
ok(n1.auto === true, '★ 带 auto 标记（前端/日志能区分"引擎补的"和"AI 给的"）');

// 2) 隐藏目的绝不许进画面笔记（实测反例：AI 把"确认嫡子的储位…"写进了 state）
sb.locked = { core: '性格内核' };
sb.hidden = '确认嫡子的储位是否真的稳如泰山';
const n2 = G.autoImgNote(d, out);
ok(n2.state.indexOf('嫡子') < 0 && JSON.stringify(n2).indexOf('嫡子') < 0, '★ 隐藏目的一个字都没进（只取 mood）');

// 3) 没见过的人不画
d.knowledge.knownPeople = [];
const n3 = G.autoImgNote(d, out);
ok(n3.who.length === 0, '★ 没见过的人不挑（名字门控在登记端也拦一次）');
ok(n3.state === '' || n3.state.indexOf('此刻：') === 0, '没人 → 退化成纯场景图（who 空、state 空）');

// 4) 没人的场景也照样给一条（at 仍然有效）
ok(n3.at === 2, '★ 纯场景图也带上 at（否则不进叙事流，等于没出）');

// 5) 空 frame 不炸
const n4 = G.autoImgNote(d, { frame: { beats: [] } });
ok(n4.at === null, '没有 beat 时 at=null（不编造位置）');

// 6) 源码核对：策略门必须真的在登记端（只在 server 端拦 = 前端画一堆填不满的图位）
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'game.js'), 'utf8');
ok(/policy === 'always'/.test(src), '★ 登记端有 policy === \'always\' 的门');
ok(/cfg\.image\.policy \|\| 'always'/.test(src), '★ 默认策略 = always（用户要的"开了就至少 1 张"）');
ok(/Array\.isArray\(out\.img\)/.test(src), 'AI 给了笔记时仍以 AI 的为准（引擎只在它没给时兜底）');
const aiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'ai.js'), 'utf8');
ok(/policy: 'always'/.test(aiSrc), '★ config 里 image.policy 有默认值（老配置升级后也是 always）');

console.log('');
console.log('==== img-policy-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
