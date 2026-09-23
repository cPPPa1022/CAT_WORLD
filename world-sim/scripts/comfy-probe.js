'use strict';
const fs = require('fs');
(async () => {
  const wf = JSON.parse(fs.readFileSync('E:\\迅雷下载\\INT8zimage彩绘.json', 'utf8'));
  // 填 positive（找 CLIPTextEncode）
  for (const k of Object.keys(wf)) {
    const n = wf[k];
    if (n && n.class_type === 'CLIPTextEncode' && n.inputs && n.inputs.text && /小萝莉|萝莉/.test(String(n.inputs.text))) { n.inputs.text = '1girl, simple test portrait, studio background'; console.log('positive node', k); }
  }
  const base = 'http://127.0.0.1:8181';
  try {
    const pr = await fetch(base + '/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: wf }) });
    const pj = await pr.json();
    console.log('submit ok?', !!pj.prompt_id, pj.error ? JSON.stringify(pj.error).slice(0, 300) : '');
    if (!pj.prompt_id) process.exit(1);
    for (let i = 0; i < 40; i++) {
      await new Promise(rs => setTimeout(rs, 1500));
      const h = await (await fetch(base + '/history/' + pj.prompt_id)).json();
      const e = h[pj.prompt_id];
      if (e && e.outputs) {
        for (const nid of Object.keys(e.outputs)) {
          const imgs = (e.outputs[nid].images || []);
          if (imgs.length) {
            const im0 = imgs[0];
            console.log('img found node', nid, 'filename', im0.filename, 'subfolder', im0.subfolder, 'type', im0.type);
            const ir = await fetch(base + '/view?filename=' + encodeURIComponent(im0.filename) + '&subfolder=' + encodeURIComponent(im0.subfolder || '') + '&type=' + encodeURIComponent(im0.type || 'output'));
            const buf = Buffer.from(await ir.arrayBuffer());
            console.log('bytes', buf.length, 'head', buf.slice(0, 8).toString('hex'), 'isPNG', buf[0] === 0x89 && buf[1] === 0x50);
            fs.writeFileSync('scripts/_comfy_test_out.png', buf);
            console.log('saved scripts/_comfy_test_out.png');
            process.exit(0);
          }
        }
        break;
      }
    }
    console.log('timeout');
    process.exit(2);
  } catch (e) { console.log('FETCH ERR', e.message); process.exit(3); }
})();
