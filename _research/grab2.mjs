
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
const dir = '_research';
fs.mkdirSync(dir, { recursive: true });
function extractPdfText(buf) {
  const s = buf.toString('latin1');
  const chunks = [];
  const re = /stream\r?\n?/g; let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endstream', start);
    if (end < 0) continue;
    const raw = buf.subarray(start, end);
    let data = null;
    try { data = zlib.inflateSync(raw); } catch { try { data = zlib.inflateRawSync(raw); } catch { data = null; } }
    if (!data) continue;
    const t = data.toString('latin1');
    if (!/(Tj|TJ)/.test(t)) continue;
    chunks.push(t);
  }
  let out = '';
  for (const t of chunks) {
    const tokRe = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>|\bTd\b|\bTD\b|\bT\*\b|\bTJ\b|\bTj\b|\bET\b/g;
    let mm;
    while ((mm = tokRe.exec(t))) {
      const tok = mm[0];
      if (tok.startsWith('(')) out += tok.slice(1,-1).replace(/\\([()\\])/g,'$1').replace(/\\n/g,'\n');
      else if (tok.startsWith('<')) { const hex = tok.slice(1,-1).replace(/\s+/g,''); let str=''; for (let i=0;i+1<hex.length;i+=2){const c=parseInt(hex.substr(i,2),16); if(c>=32) str+=String.fromCharCode(c);} out+=str; }
      else out += '\n';
    }
    out += '\n';
  }
  return out.replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n');
}
const jobs = JSON.parse(fs.readFileSync('_research/jobs2.json','utf8'));
for (const job of jobs) {
  console.log('BEGIN ' + job.name);
  try {
    const r = await fetch(job.url, { redirect: 'follow', headers: { 'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36', accept:'*/*' } });
    console.log('  status ' + r.status);
    if (!r.ok) continue;
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(path.join(dir, job.name + '.pdf'), buf);
    if (buf.subarray(0,5).toString() === '%PDF-') { const text = extractPdfText(buf); fs.writeFileSync(path.join(dir, job.name + '.txt'), text); console.log('  pdf ' + buf.length + ' -> text ' + text.length); }
    else { fs.writeFileSync(path.join(dir, job.name + '.html'), buf.toString('utf8')); console.log('  html ' + buf.length); }
  } catch (e) { console.log('  ERR ' + e.message); }
}
console.log('DONE');
