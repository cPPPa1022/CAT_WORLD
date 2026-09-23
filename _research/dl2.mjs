
process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';
import fs from 'node:fs';
import zlib from 'node:zlib';
function htmlToText(h){
  return h.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi,'\n').replace(/<br\s*\/?>/gi,'\n')
    .replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&#39;|&rsquo;|&lsquo;/g,"'").replace(/&quot;|&ldquo;|&rdquo;/g,'"')
    .replace(/&mdash;/g,'—').replace(/&ndash;/g,'–').replace(/&hellip;/g,'…')
    .replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n');
}
function extractPdfText(buf){
  const s = buf.toString('latin1'); const chunks=[]; const re=/stream\r?\n?/g; let m;
  while((m=re.exec(s))){ const a=m.index+m[0].length; const b=s.indexOf('endstream',a); if(b<0) continue;
    const raw=buf.subarray(a,b); let d=null;
    try{d=zlib.inflateSync(raw);}catch{try{d=zlib.inflateRawSync(raw);}catch{d=null;}}
    if(!d) continue; const t=d.toString('latin1'); if(!/(Tj|TJ)/.test(t)) continue; chunks.push(t); }
  let out='';
  for(const t of chunks){ const re2=/\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>|\bTd\b|\bTD\b|\bT\*\b|\bTJ\b|\bTj\b|\bET\b/g; let mm;
    while((mm=re2.exec(t))){ const k=mm[0];
      if(k[0]==='(') out+=k.slice(1,-1).replace(/\\([()\\])/g,'$1').replace(/\\n/g,'\n');
      else if(k[0]==='<'){ const hx=k.slice(1,-1).replace(/\s+/g,''); let st=''; for(let i=0;i+1<hx.length;i+=2){const c=parseInt(hx.substr(i,2),16); if(c>=32) st+=String.fromCharCode(c);} out+=st; }
      else out+='\n'; }
    out+='\n'; }
  return out.replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n');
}
const jobs = JSON.parse(fs.readFileSync('_research/jobs4.json','utf8'));
for(const j of jobs){
  try{
    const r = await fetch(j.url,{redirect:'follow',headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'}});
    if(!r.ok){ console.log(j.name+' HTTP '+r.status); continue; }
    const buf=Buffer.from(await r.arrayBuffer());
    if(buf.subarray(0,5).toString()==='%PDF-'){ const t=extractPdfText(buf); fs.writeFileSync('_research/'+j.name+'.txt',t); console.log(j.name+' PDF '+buf.length+' -> '+t.length); }
    else { fs.writeFileSync('_research/'+j.name+'.txt', htmlToText(buf.toString('utf8'))); console.log(j.name+' HTML '+buf.length); }
  }catch(e){ console.log(j.name+' ERR '+e.message); }
}
console.log('DONE');
