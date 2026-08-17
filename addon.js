const { addonBuilder } = require('stremio-addon-sdk');

const BASE = 'https://yanhh3d.pw';
const UA = 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36';
const TIMEOUT = 20000;

const CATALOGS = {
  recent: { id: 'yanhh3d-recent', name: 'Mới cập nhật', path: '/' },
  ongoing: { id: 'yanhh3d-ongoing', name: 'Phim bộ', path: '/phim-bo' },
  movies: { id: 'yanhh3d-movies', name: 'Phim lẻ', path: '/phim-le' },
  popular: { id: 'yanhh3d-popular', name: 'Đánh giá cao', path: '/danh-gia-cao' }
};

const manifest = {
  id: 'community.yanhhh3d', version: '1.3.0', name: 'YanHH3D',
  description: 'YanHH3D Vietnamese animation catalog and streams', logo: BASE + '/favicon.ico',
  resources: ['catalog', {name:'meta',types:['series'],idPrefixes:['yanhh3d:']}, {name:'stream',types:['series'],idPrefixes:['yanhh3d:']}],
  types: ['series'],
  catalogs: Object.values(CATALOGS).map(c => ({type:'series',id:c.id,name:c.name,extra:[{name:'search',isRequired:false},{name:'skip',isRequired:false}]})),
  behaviorHints: { configurable:false }
};
const builder = new addonBuilder(manifest);

function decode(s){return String(s||'').replace(/\\\//g,'/').replace(/\\u0026/gi,'&').replace(/\\u003d/gi,'=').replace(/&amp;/g,'&').replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>');}
function clean(s){return decode(String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();}
function abs(url,base=BASE){if(!url)return null;try{return new URL(decode(url),base).href}catch(_){return null}}
function slugify(s){return clean(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')}
async function get(url,referer=BASE+'/'){const c=new AbortController(),t=setTimeout(()=>c.abort(),TIMEOUT);try{const r=await fetch(url,{signal:c.signal,headers:{'User-Agent':UA,'Accept':'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8','Referer':referer||BASE+'/'}});if(!r.ok)throw new Error('HTTP '+r.status);return await r.text()}finally{clearTimeout(t)}}
function attr(tag,name){const re=new RegExp(name+'\\s*=\\s*[\"\']([^\"\']+)','i');const m=String(tag||'').match(re);return m?decode(m[1]):null}
function anchors(html){const out=[],re=/<a\b([^>]*?)>([\s\S]*?)<\/a>/gi;let m;while((m=re.exec(html||''))){const href=abs(attr(m[1],'href')),text=clean(m[2]);if(href)out.push({href,text,tag:m[1]})}return out}
function posterFromBlock(block){const m=String(block||'').match(/<img\b[^>]*>/i);return m?abs(attr(m[0],'src')||attr(m[0],'data-src')):null}
function extractCards(html){const seen=new Set(),out=[],re=/<(?:div|article|li)\b[^>]*>[\s\S]{0,5000}?<\/\s*(?:div|article|li)>/gi;let m;while((m=re.exec(html||''))){const block=m[0];for(const a of anchors(block)){const href=a.href.replace(/\/$/,'');if(!/yanhh3d\.pw\/(?!sever\d+\/).*[^/]/i.test(href)||/\/sever\d+\//i.test(href)||/\/xem\//i.test(href))continue;const title=a.text||clean((block.match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i)||[])[1]);if(!title||title.length<2||seen.has(href))continue;seen.add(href);out.push({url:href,title,poster:posterFromBlock(block)})}}return out}
function extractSearch(html){let body=html;try{const j=JSON.parse(html);body=j.data||j.html||html}catch(_){}const out=[],seen=new Set();for(const a of anchors(body)){if(!/yanhh3d\.pw/i.test(a.href)||/\/sever\d+\//i.test(a.href)||/\/xem\//i.test(a.href))continue;const href=a.href.replace(/\/$/,'');if(!a.text||a.text.length<2||seen.has(href))continue;seen.add(href);out.push({url:href,title:a.text,poster:null})}return out}
function detailUrl(id){return BASE+'/'+String(id).replace(/^yanhh3d:/,'').replace(/[^a-z0-9-]/gi,'')}
function parsePoster(html){const og=html.match(/<meta\b[^>]*property=["']og:image["'][^>]*>/i);if(og)return abs(attr(og[0],'content'));const m=html.match(/<img\b[^>]*>/i);return m?abs(attr(m[0],'data-src')||attr(m[0],'src')):null}
function parseTitle(html,fallback){const og=html.match(/<meta\b[^>]*property=["']og:title["'][^>]*>/i);if(og)return clean(attr(og[0],'content')).replace(/\s*[-|]\s*YanHH3D.*$/i,'').trim();const h=html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);return clean(h?h[1]:fallback)}

function parseEpisodes(html){
  const found=new Map();
  for(const a of anchors(html)){
    const m=a.href.match(/\/sever(\d+)\/([^/]+)\/tap-(\d+)(?:\/?|\?)/i); if(!m)continue;
    const ep=Number(m[3]); if(!Number.isFinite(ep))continue;
    if(!found.has(ep))found.set(ep,{episode:ep,url:a.href,server:Number(m[1]),slug:m[2]});
  }
  return [...found.values()].sort((a,b)=>a.episode-b.episode);
}
function maxEpisodeFromHtml(html){
  const nums=[]; const re=/\/tap-(\d+)/gi; let m; while((m=re.exec(html||''))) nums.push(Number(m[1]));
  return nums.length?Math.max(...nums):0;
}
async function completeEpisodes(html,detailUrlValue){
  const eps=parseEpisodes(html); let max=Math.max(maxEpisodeFromHtml(html),...eps.map(e=>e.episode),0);
  const slug=(String(detailUrlValue).match(/\/([^/]+)\/?$/)||[])[1];
  if(!max||!slug)return eps;
  const by=new Map(eps.map(e=>[e.episode,e]));
  // The site paginates old episode buttons. Generate the real episode URLs
  // for missing numbers instead of depending on only the visible page.
  for(let n=1;n<=max;n++) if(!by.has(n)) by.set(n,{episode:n,url:BASE+'/sever2/'+slug+'/tap-'+n,server:2,slug});
  return [...by.values()].sort((a,b)=>a.episode-b.episode);
}

async function catalogItems(path,search){if(search)return extractSearch(await get(BASE+'/ajax/search/suggest?ajaxSearch=1&keysearch='+encodeURIComponent(search)));return extractCards(await get(BASE+path))}
builder.defineCatalogHandler(async args=>{const cfg=Object.values(CATALOGS).find(c=>c.id===args.id);if(!cfg||args.type!=='series')return{metas:[]};try{const q=args.extra?.search?String(args.extra.search).trim():'';let items=await catalogItems(cfg.path,q);const skip=Number(args.extra?.skip)||0;items=items.slice(skip,skip+100);return{metas:items.map(x=>({id:'yanhh3d:'+slugify((new URL(x.url).pathname.match(/\/([^/]+)\/?$/)||[])[1]||x.title),type:'series',name:clean(x.title),poster:x.poster||undefined,posterShape:'poster'})),cacheMaxAge:q?30:90}}catch(e){console.error('[catalog]',args.id,e.message);return{metas:[]}}});

builder.defineMetaHandler(async args=>{if(args.type!=='series'||!String(args.id).startsWith('yanhh3d:'))return{meta:null};const url=detailUrl(args.id);try{const html=await get(url),title=parseTitle(html,String(args.id).replace(/^yanhh3d:/,'').replace(/-/g,' ')),eps=await completeEpisodes(html,url);return{meta:{id:args.id,type:'series',name:title,poster:parsePoster(html)||undefined,description:'YanHH3D • Hoạt hình 3D',videos:eps.map(e=>({id:args.id+':1:'+e.episode+':'+encodeURIComponent(e.url),title:'Tập '+e.episode,season:1,episode:e.episode}))},cacheMaxAge:10}}catch(e){console.error('[meta]',e.message,url);return{meta:null}}});
function episodeUrlFromId(id){const s=String(id),marker=':1:',p=s.indexOf(marker);if(p<0)return null;const rest=s.slice(p+marker.length),parts=rest.split(':');if(parts.length>1){try{return decodeURIComponent(parts.slice(1).join(':'))}catch(_){} }return null}
function extractIframes(html,base){const out=[],re=/<iframe\b[^>]*>/gi;let m;while((m=re.exec(html||''))){const u=abs(attr(m[0],'src')||attr(m[0],'data-src'),base);if(u&&!out.includes(u)&&!/youtube|facebook\.com|doubleclick|analytics/i.test(u))out.push(u)}return out}
function mediaUrls(html,base){const text=decode(String(html||'')),out=[],re=/(?:https?:)?\/\/[^\s"'<>]+\.(?:m3u8|mp4)(?:\?[^\s"'<>]*)?/gi;let m;while((m=re.exec(text))){const u=abs(m[0],base);if(u)out.push(u)}const srcRe=/<(?:source|video)\b[^>]*>/gi;while((m=srcRe.exec(text))){const s=attr(m[0],'src')||attr(m[0],'data-src');if(s&&/\.(?:m3u8|mp4)(?:\?|$)/i.test(s)){const u=abs(s,base);if(u)out.push(u)}}return[...new Set(out)]}
function streamObject(url,title,referer){
  const request={Referer:referer||BASE+'/',Origin:(()=>{try{return new URL(referer||BASE).origin}catch(_){return BASE}})(),'User-Agent':UA};
  return {name:'YanHH3D',title,url,quality:/4k|2160/i.test(url)?'4K':/1080/i.test(url)?'1080p':/720/i.test(url)?'720p':'HD',behaviorHints:{notWebReady:true,proxyHeaders:{request}},filename:/\.mp4(?:\?|$)/i.test(url)?'yanhh3d-video.mp4':'yanhh3d-video.m3u8'};
}
builder.defineStreamHandler(async args=>{if(args.type!=='series'||!String(args.id).startsWith('yanhh3d:'))return{streams:[]};const epUrl=episodeUrlFromId(args.id);if(!epUrl)return{streams:[]};try{const epHtml=await get(epUrl,detailUrl(args.id)),streams=[];for(const frame of extractIframes(epHtml,epUrl).slice(0,10)){if(/\.(?:m3u8|mp4)(?:\?|$)/i.test(frame))streams.push(streamObject(frame,'YanHH3D • HD',epUrl));else{try{for(const u of mediaUrls(await get(frame,epUrl),frame))streams.push(streamObject(u,'YanHH3D • '+(/1080/i.test(u)?'1080p':'HD'),frame))}catch(e){console.log('[player]',e.message)}}}for(const u of mediaUrls(epHtml,epUrl))streams.push(streamObject(u,'YanHH3D • '+(/1080/i.test(u)?'1080p':'HD'),epUrl));const seen=new Set();return{streams:streams.filter(s=>s.url&&!seen.has(s.url)&&seen.add(s.url)),cacheMaxAge:2}}catch(e){console.error('[stream]',e.message,epUrl);return{streams:[]}}});
module.exports=builder.getInterface();
