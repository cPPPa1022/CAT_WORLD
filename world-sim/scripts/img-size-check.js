// img-size-check.js — 生图尺寸注入断言（v1.63 §27：人像 768×768 / 其他 1280×720）
'use strict';
const path = require('path'); const os = require('os'); const fs = require('fs');
const TMP = path.join(os.tmpdir(), 'ws-imgsize-' + Date.now());
process.env.WORLD_SIM_DATA = TMP; fs.mkdirSync(TMP, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
console.log('');
console.log('生图尺寸注入 —— 最终尺寸 = 用户设的值（不论工作流里放大了几倍）');

const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
ok(/function applySize/.test(src), '有 applySize（尺寸注入的唯一入口）');
ok(/sizePortrait/.test(src) && /sizeScene/.test(src), '人像档 / 场景档分开');
ok(/kind === 'portrait'/.test(src), '★ 立绘任务带 kind=portrait（按类型选尺寸）');
ok(/UpscaleModelLoader/.test(src) && /__lastSizeFactor/.test(src), '★ 从放大模型名读倍数（2xNomos… → 2）');
ok(/Math\.round\(size\.w \/ f \/ 8\) \* 8/.test(src), '★ 潜空间按 目标÷倍数 设，并 8 对齐');
ok(/fit_final_size/.test(src), '★ SaveImage 前插 ImageScale 钉死最终尺寸（链尾兜底）');
ok(/sha1\(prm \+ '@' \+ sz\.w/.test(src), '★ 尺寸进缓存键（同词不同尺寸不复用旧图）');

console.log('');
console.log('（server.js 是入口脚本，不能 require（会真起服务）；尺寸逻辑以上面的源码核对为准，真链路待浏览器/ComfyUI 实测）');
console.log('');
console.log('==== img-size-check: ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
