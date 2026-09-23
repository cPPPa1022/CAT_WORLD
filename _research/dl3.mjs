
process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';
import fs from 'node:fs';
const jobs = JSON.parse(fs.readFileSync('_research/jobs5.json','utf8'));
for(const j of jobs){
  try{
    const r = await fetch(j.url,{redirect:'follow',headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'}});
    if(!r.ok){ console.log(j.name+' HTTP '+r.status); continue; }
    const buf=Buffer.from(await r.arrayBuffer());
    fs.writeFileSync('_research/raw_'+j.name+(j.ext?'.'+j.ext:'.bin'), buf);
    console.log(j.name+' OK '+buf.length+' '+(buf.subarray(0,4).toString('latin1')));
  }catch(e){ console.log(j.name+' ERR '+e.message.slice(0,120)); }
}
console.log('DONE');
