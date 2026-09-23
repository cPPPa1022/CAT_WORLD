
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const dir = '_research';
fs.mkdirSync(dir, { recursive: true });

function extractPdfText(buf) {
  const s = buf.toString('latin1');
  const chunks = [];
  const re = /stream\r?\n?/g;
  let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endstream', start);
    if (end < 0) continue;
    let raw = buf.subarray(start, end);
    let data = null;
    try { data = zlib.inflateSync(raw); } catch (e) {
      try { data = zlib.inflateRawSync(raw); } catch (e2) { data = null; }
    }
    if (!data) continue;
    const t = data.toString('latin1');
    if (!/(Tj|TJ|Td|TD)/.test(t)) continue;
    chunks.push(t);
  }
  let out = '';
  for (const t of chunks) {
    // pull strings from text-showing operators
    const tokRe = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>|\bTd\b|\bTD\b|\bT\*\b|\bTJ\b|\bTj\b|\bET\b/g;
    let mm;
    while ((mm = tokRe.exec(t))) {
      const tok = mm[0];
      if (tok.startsWith('(')) {
        out += tok.slice(1, -1).replace(/\\([()\\])/g, '$1').replace(/\\n/g, '\n').replace(/\\r/g, '');
      } else if (tok.startsWith('<')) {
        const hex = tok.slice(1, -1).replace(/\s+/g, '');
        let str = '';
        for (let i = 0; i + 1 < hex.length; i += 2) {
          const c = parseInt(hex.substr(i, 2), 16);
          str += c >= 32 ? String.fromCharCode(c) : '';
        }
        out += str;
      } else if (tok === 'Td' || tok === 'TD' || tok === 'T*' || tok === 'ET') {
        out += '\n';
      }
    }
    out += '\n';
  }
  return out.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
}

const jobs = JSON.parse(fs.readFileSync('_research/jobs.json', 'utf8'));
const report = [];
for (const job of jobs) {
  const pdfPath = path.join(dir, job.name + '.pdf');
  const txtPath = path.join(dir, job.name + '.txt');
  try {
    const r = await fetch(job.url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
    if (!r.ok) { report.push(job.name + ' HTTP ' + r.status); continue; }
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(pdfPath, buf);
    if (buf.subarray(0, 5).toString() === '%PDF-') {
      const text = extractPdfText(buf);
      fs.writeFileSync(txtPath, text);
      report.push(job.name + ' PDF ' + buf.length + 'B -> ' + text.length + ' chars text');
    } else {
      fs.writeFileSync(txtPath, buf.toString('utf8'));
      report.push(job.name + ' HTML ' + buf.length + 'B');
    }
  } catch (e) { report.push(job.name + ' ERR ' + e.message); }
}
console.log(report.join('\n'));
