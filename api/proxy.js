const ALLOWED_HOSTS = ['yanhh3d.pw', 'fbcdn.cloud'];
const UA = 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36';
function allowed(url){try{const h=new URL(url).hostname.toLowerCase();return ALLOWED_HOSTS.some(x=>h===x||h.endsWith('.'+x));}catch(_){return false;}}
function proxyUrl(url){return '/proxy?u='+encodeURIComponent(url);}
module.exports=async(req,res)=>{try{
 const target=String(req.query?.u||''); if(!target||!allowed(target))return res.status(400).send('Bad stream URL');
 const ref=target.includes('fbcdn.cloud')?'https://yanhh3d.pw/':'https://yanhh3d.pw/';
 const r=await fetch(target,{headers:{'User-Agent':UA,'Referer':ref,'Origin':'https://yanhh3d.pw','Accept':'*/*'}});
 if(!r.ok)return res.status(r.status).send('Upstream HTTP '+r.status);
 const type=(r.headers.get('content-type')||'').toLowerCase();
 if(type.includes('mpegurl')||/\.m3u8(?:$|\?)/i.test(target)){
   let text=await r.text(),base=new URL(target);
   text=text.split('\n').map(line=>{const s=line.trim();if(!s)return line;
     if(s.startsWith('#')&&/URI="([^"]+)"/i.test(s))return line.replace(/URI="([^"]+)"/i,(_,u)=>`URI="${proxyUrl(new URL(u,base).href)}"`);
     if(s.startsWith('#'))return line;
     try{return proxyUrl(new URL(s,base).href);}catch(_){return line;}
   }).join('\n');
   res.setHeader('Content-Type','application/vnd.apple.mpegurl');res.setHeader('Cache-Control','no-store');return res.status(200).send(text);
 }
 const buf=Buffer.from(await r.arrayBuffer());res.setHeader('Content-Type',type||'application/octet-stream');res.setHeader('Cache-Control','no-store');return res.status(200).send(buf);
}catch(e){console.error('[proxy]',e.message);return res.status(502).send('Proxy error');}};
