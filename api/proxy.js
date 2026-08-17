const { Readable } = require('stream');

const ALLOWED_HOSTS = ['yanhh3d.pw','fbcdn.cloud','odycdn.com','player.odycdn.com'];
const UA='Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36';

function allowed(url){
  try{
    const u=new URL(url);
    if(u.protocol!=='https:') return false;
    const h=u.hostname.toLowerCase();
    return ALLOWED_HOSTS.some(x=>h===x||h.endsWith('.'+x));
  }catch(_){ return false; }
}

function proxyUrl(url,ref){
  return '/api/proxy?url='+encodeURIComponent(url)+'&ref='+encodeURIComponent(ref||'https://yanhh3d.pw/');
}

function copy(res,headers,names){
  for(const n of names){const v=headers.get(n);if(v)res.setHeader(n,v);}
}

module.exports=async(req,res)=>{
  try{
    const q=req.query||{};
    const target=String(q.url||q.u||'');
    if(!target||!allowed(target)) return res.status(400).send('Bad stream URL');

    const referer=String(q.ref||'https://yanhh3d.pw/');
    const headers={
      'User-Agent':UA,
      'Referer':referer,
      'Origin':'https://yanhh3d.pw',
      'Accept':'*/*',
      'Accept-Encoding':'identity'
    };
    if(req.headers?.range) headers.Range=req.headers.range;
    if(req.headers?.['if-range']) headers['If-Range']=req.headers['if-range'];

    const method=req.method==='HEAD'?'HEAD':'GET';
    const r=await fetch(target,{method,headers,redirect:'follow'});
    if(!r.ok && r.status!==206) return res.status(r.status).send('Upstream HTTP '+r.status);

    const type=(r.headers.get('content-type')||'').toLowerCase();
    const isHls=type.includes('mpegurl')||/\.m3u8(?:$|\?)/i.test(target);

    if(isHls && method!=='HEAD'){
      let text=await r.text();
      const base=new URL(target);
      text=text.split(/\r?\n/).map(line=>{
        const s=line.trim();
        if(!s) return line;
        if(s.startsWith('#')) return line.replace(/URI="([^"]+)"/gi,(_,u)=>{
          try{return 'URI="'+proxyUrl(new URL(u,base).href,referer)+'"';}catch(_){return 'URI="'+u+'"';}
        });
        try{return proxyUrl(new URL(s,base).href,referer);}catch(_){return line;}
      }).join('\n');
      res.statusCode=200;
      res.setHeader('Content-Type','application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control','no-store');
      res.setHeader('Access-Control-Allow-Origin','*');
      res.setHeader('Access-Control-Allow-Headers','Range,Origin,Accept,Content-Type');
      return res.end(text);
    }

    copy(res,r.headers,['content-type','content-length','content-range','etag','last-modified']);
    res.setHeader('Accept-Ranges',r.headers.get('accept-ranges')||'bytes');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Access-Control-Allow-Origin','*');
    res.setHeader('Access-Control-Allow-Headers','Range,Origin,Accept,Content-Type');
    res.setHeader('Access-Control-Expose-Headers','Content-Length,Content-Range,Accept-Ranges,Content-Type,ETag,Last-Modified');

    if(method==='HEAD') return res.status(r.status).end();

    // Do not buffer video into Vercel memory. Stream the upstream body directly.
    if(r.body){
      res.statusCode=r.status;
      return Readable.fromWeb(r.body).pipe(res);
    }
    return res.status(r.status).end();
  }catch(e){
    console.error('[proxy]',e.stack||e.message);
    return res.status(502).send('Proxy error: '+e.message);
  }
};
