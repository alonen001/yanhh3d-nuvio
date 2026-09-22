const crypto = require('crypto');
const { Readable } = require('stream');

const UA='Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36';
const KEY=Buffer.from('a4cxe8d2f6b703915e2a4c8d9b1f6073');
const IV=Buffer.from('3a9f5c8e1b4d2074');

function allowed(url,segment=false){
  try{
    const u=new URL(url),h=u.hostname.toLowerCase();
    if(u.protocol!=='https:')return false;
    return segment
      ? ['play.cloudbeta.win','play.cbplay.live'].includes(h)&&u.pathname.startsWith('/file/segment/')
      : h==='play.cbplay.live'&&u.pathname.startsWith('/file/em3u8/')&&u.pathname.endsWith('.m3u8');
  }catch(_){return false}
}
function selfUrl(req,url,ref){
  const origin=(req.headers['x-forwarded-proto']||'https')+'://'+(req.headers['x-forwarded-host']||req.headers.host);
  return origin+'/api/cbplay?segment='+encodeURIComponent(url)+'&ref='+encodeURIComponent(ref);
}

module.exports=async(req,res)=>{
  try{
    const segment=String(req.query?.segment||''),url=String(req.query?.url||''),ref=String(req.query?.ref||'https://player.cbplay.live/');
    if(segment){
      if(!allowed(segment,true))return res.status(400).send('Bad segment URL');
      const headers={'User-Agent':UA,'Referer':ref,'Origin':'https://player.cbplay.live','Accept':'*/*'};
      if(req.headers.range)headers.Range=req.headers.range;
      const r=await fetch(segment,{headers,redirect:'follow'});
      if(!r.ok&&r.status!==206)return res.status(r.status).send('Segment HTTP '+r.status);
      for(const n of ['content-type','content-length','content-range','accept-ranges']){const v=r.headers.get(n);if(v)res.setHeader(n,v)}
      res.statusCode=r.status;res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Cache-Control','private, max-age=300');
      return r.body?Readable.fromWeb(r.body).pipe(res):res.end();
    }
    if(!allowed(url,false))return res.status(400).send('Bad playlist URL');
    const upstream=new URL(url);upstream.searchParams.set('cb',Date.now());
    const r=await fetch(upstream,{headers:{'User-Agent':UA,'Referer':ref,'Cache-Control':'no-cache'},redirect:'follow'});
    if(!r.ok)return res.status(r.status).send('Playlist HTTP '+r.status);
    const encrypted=(await r.text()).split(/\r?\n/).map(x=>x.trim()).filter(Boolean).at(-1);
    const decipher=crypto.createDecipheriv('aes-256-cbc',KEY,IV);
    const base64=Buffer.concat([decipher.update(Buffer.from(encrypted,'base64')),decipher.final()]).toString('utf8');
    const playlist=Buffer.from(base64,'base64').toString('utf8').split(/\r?\n/).map(line=>{
      const s=line.trim();return /^https:\/\//i.test(s)?selfUrl(req,s,ref):line;
    }).join('\n');
    res.setHeader('Content-Type','application/vnd.apple.mpegurl');res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Cache-Control','no-store');
    return res.send(playlist);
  }catch(e){console.error('[cbplay]',e.stack||e.message);return res.status(502).send('CBPlay proxy error');}
};
