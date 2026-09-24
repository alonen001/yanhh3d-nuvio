const addonInterface = require('../addon');

const UA='Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36';

function allowedPlaylist(value){
  try{
    const url=new URL(value),host=url.hostname.toLowerCase();
    return url.protocol==='https:'&&(host==='scontent.ibytedance.net'||host.endsWith('.ibytedance.net'));
  }catch(_){return false}
}

module.exports=async(req,res)=>{
  try{
    const slug=String(req.query?.slug||''),ep=String(req.query?.ep||'');
    if(!/^[a-z0-9-]+$/i.test(slug)||!/^\d+$/.test(ep))return res.status(400).send('Bad HH3D request');
    const data=await addonInterface.resolveHh3dBySlug(slug,ep);
    if(!allowedPlaylist(data.file))throw Error('Unexpected HH3D playlist host');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
    let upstream;
    try{upstream=await fetch(data.file,{signal:controller.signal,redirect:'follow',headers:{'User-Agent':UA,'Referer':'https://hoathinh3d.de/','Accept':'application/vnd.apple.mpegurl,*/*'}})}finally{clearTimeout(timer)}
    if(!upstream.ok)return res.status(upstream.status).send('HH3D playlist HTTP '+upstream.status);
    const playlist=await upstream.text();
    if(!playlist.startsWith('#EXTM3U'))throw Error('Invalid HH3D playlist');
    res.set({'Content-Type':'application/vnd.apple.mpegurl','Access-Control-Allow-Origin':'*','Cache-Control':'no-store'});
    return res.status(200).send(playlist);
  }catch(e){
    console.error('[hh3d]',e.stack||e.message);
    return res.status(502).send('HH3D stream error: '+String(e.message||'unknown').slice(0,180));
  }
};
