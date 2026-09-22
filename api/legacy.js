const UA='Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36';
const {Readable,Transform}=require('stream');

function hostAllowed(value,kind){
  try{
    const u=new URL(value),h=u.hostname.toLowerCase();
    if(u.protocol!=='https:')return false;
    if(kind==='player')return h==='rptcdn.site'||h.endsWith('.rptcdn.site');
    return h==='m.defifa.com'||h.endsWith('.defifa.com');
  }catch(_){return false}
}

function endpoint(req,segment){
  const protocol=String(req.headers['x-forwarded-proto']||req.protocol||'https').split(',')[0];
  const host=String(req.headers['x-forwarded-host']||req.headers.host).split(',')[0];
  return protocol+'://'+host+'/api/legacy/segment/'+Buffer.from(segment).toString('base64url')+'.ts';
}

function tsUnwrapper(){
  let pending=Buffer.alloc(0),found=false;
  return new Transform({
    transform(chunk,_encoding,done){
      try{
        pending=Buffer.concat([pending,chunk]);
        if(!found){
          let start=-1;
          for(let i=0;i+188*5<pending.length;i++){
            let valid=true;
            for(let n=0;n<6;n++)if(pending[i+n*188]!==0x47){valid=false;break}
            if(valid){start=i;break}
          }
          if(start<0){if(pending.length>1024*1024)throw Error('MPEG-TS payload not found');return done()}
          pending=pending.subarray(start);found=true;
        }
        const packets=Math.floor(pending.length/188);
        const emitPackets=Math.max(0,packets-6);
        if(emitPackets){const length=emitPackets*188;this.push(pending.subarray(0,length));pending=pending.subarray(length)}
        done();
      }catch(e){done(e)}
    },
    flush(done){
      try{
        if(!found)throw Error('MPEG-TS payload not found');
        let end=0;while(end+188<=pending.length&&pending[end]===0x47)end+=188;
        if(end)this.push(pending.subarray(0,end));
        done();
      }catch(e){done(e)}
    }
  });
}

module.exports=async(req,res)=>{
  try{
    const pathMatch=String(req.path||'').match(/^\/segment\/([A-Za-z0-9_-]+)\.ts$/);
    const segment=pathMatch?Buffer.from(pathMatch[1],'base64url').toString('utf8'):String(req.query?.segment||'');
    if(segment){
      if(!hostAllowed(segment,'segment'))return res.status(400).send('Bad segment URL');
      const r=await fetch(segment,{headers:{'User-Agent':UA,'Referer':'https://yanhh3d.men/','Accept':'*/*'},redirect:'follow'});
      if(!r.ok&&r.status!==206)return res.status(r.status).send('Segment HTTP '+r.status);
      res.status(200).set({'Content-Type':'video/mp2t','Accept-Ranges':'none','Access-Control-Allow-Origin':'*','Cache-Control':'public, max-age=86400'});
      if(!r.body)return res.end();
      const source=Readable.fromWeb(r.body),unwrap=tsUnwrapper();
      source.on('error',e=>res.destroy(e));unwrap.on('error',e=>res.destroy(e));
      return source.pipe(unwrap).pipe(res);
    }

    const url=String(req.query?.url||'');
    if(!hostAllowed(url,'player'))return res.status(400).send('Bad player URL');
    const player=await fetch(url,{headers:{'User-Agent':UA,'Referer':'https://yanhh3d.men/','Cache-Control':'no-cache'},redirect:'follow'});
    if(!player.ok)return res.status(player.status).send('Player HTTP '+player.status);
    const html=await player.text();
    const match=html.match(/\bdata-obf=["']([^"']+)["']/i);
    if(!match)throw Error('Player data not found');
    const data=JSON.parse(Buffer.from(match[1],'base64').toString('utf8'));
    if(!data.pU||!hostAllowed(data.pU,'player'))throw Error('Plain playlist not found');
    const playlistResponse=await fetch(data.pU,{headers:{'User-Agent':UA,'Referer':url,'Origin':new URL(url).origin,'Cache-Control':'no-cache'},redirect:'follow'});
    if(!playlistResponse.ok)return res.status(playlistResponse.status).send('Playlist HTTP '+playlistResponse.status);
    const playlist=(await playlistResponse.text()).split(/\r?\n/).map(line=>{
      const value=line.trim();
      return hostAllowed(value,'segment')?endpoint(req,value):line;
    }).join('\n');
    res.set({'Content-Type':'application/vnd.apple.mpegurl','Access-Control-Allow-Origin':'*','Cache-Control':'no-store'});
    return res.send(playlist);
  }catch(e){
    console.error('[legacy]',e.stack||e.message);
    return res.status(502).send('YanHH3D stream proxy error');
  }
};
