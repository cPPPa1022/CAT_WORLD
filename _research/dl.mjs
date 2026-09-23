
import fs from 'node:fs';
const jobs = JSON.parse(fs.readFileSync('_research/jobs3.json','utf8'));
for (const j of jobs) {
  try {
    const r = await fetch(j.url, { redirect:'follow', headers:{ 'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36' } });
    if (!r.ok) { console.log(j.name + ' HTTP ' + r.status); continue; }
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync('_research/' + j.name + '.' + j.ext, buf);
    console.log(j.name + ' OK ' + buf.length);
  } catch(e) { console.log(j.name + ' ERR ' + e.message); }
}
console.log('DONE');
