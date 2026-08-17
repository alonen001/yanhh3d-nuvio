const { getRouter } = require('stremio-addon-sdk');
const addonInterface = require('../addon');
const router = getRouter(addonInterface);
const ADDON_ORIGIN='https://yanhh3d-nuvio-lovat.vercel.app';
const UA='Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36';

module.exports = async (req, res) => {
  const path=req.url||'';
  if(!path.startsWith('/api/proxy')) return router(req,res);
  try{
    const parsed=new URL(path,ADDON_ORIGIN);
    const target=parsed.searchParams.get('url');
    const referer=parsed.searchParams.get('ref')||'https://yanhh3d.pw/';
    if(!target) return res.status(400).send('Missing url');
    const u=new URL(target);
    if(!/^https?:$/i.test(u.protocol)) return res.status(400).send('Invalid protocol');
    const headers={'User-Agent':UA,'Referer':referer};
    try{headers.Origin=new URL(referer).origin}catch(_){}
    const upstream=await fetch(u.href,{headers,redirect:'follow'});
    if(!upstream.ok)return res.status(upstream.status).send('Upstream HTTP '+upstream.status);
    const type=(upstream.headers.get('content-type')||'').toLowerCase();

    if(type.includes('mpegurl') || /\.m3u8(?:$|\?)/i.test(u.href)){
      const body=await upstream.text();
      const base=new URL(u.href);
      const proxy=x=>'/api/proxy?url='+encodeURIComponent(new URL(x,base).href)+'&ref='+encodeURIComponent(referer);
      const lines=body.split(/\r?\n/).map(line=>{
        const t=line.trim();
        if(!t)return '';
        if(t.startsWith('#')) return t.replace(/URI="([^"]+)"/gi,(_,x)=>'URI="'+proxy(x)+'"');
        return proxy(t);
      });
      res.setHeader('Content-Type','application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control','no-store, no-cache');
      res.setHeader('Access-Control-Allow-Origin','*');
      return res.status(200).send(lines.join('\n'));
    }

    const data=Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type',type||'video/mp4');
    res.setHeader('Cache-Control','no-store, no-cache');
    res.setHeader('Access-Control-Allow-Origin','*');
    return res.status(200).send(data);
  }catch(e){
    console.error('[proxy]',e.stack||e.message);
    return res.status(502).send('Proxy error: '+e.message);
  }
};
