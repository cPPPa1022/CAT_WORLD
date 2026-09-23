
const urls = [
 'https://web.archive.org/web/2020/https://www.valvesoftware.com/publications/2009/ai_systems_of_l4d_mike_booth.pdf',
 'https://archive.org/download/valve-publications/2009/ai_systems_of_l4d_mike_booth_djvu.txt',
 'https://www.cs.drexel.edu/~so367/teaching/2012/CS680/papers/11%20Secrets%20about%20LEFT%204%20DEAD%E2%80%99s%20AI%20Director%20and%20its%20Procedural%20Zombie%20Population%20%7C%20AiGameDev.com.pdf',
 'https://www.gameanim.com/2009/12/22/the-ai-systems-of-left-4-dead/',
 'https://www.gamedeveloper.com/design/game-design-as-narrative-architecture',
 'https://www.raphkoster.com/2005/07/',
 'https://tecfalabs.unige.ch/mediawiki-narrative/index.php?title=Facade',
 'https://developer.valvesoftware.com/wiki/The_A.I._Director',
];
for (const u of urls) {
  try {
    const r = await fetch(u, { redirect:'follow', headers:{ 'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36' } });
    const b = Buffer.from(await r.arrayBuffer());
    console.log(r.status, b.length, u.slice(0,80), b.subarray(0,5).toString().replace(/\W/g,'.'));
  } catch(e) { console.log('ERR', u.slice(0,80), e.message, e.cause && e.cause.message); }
}
