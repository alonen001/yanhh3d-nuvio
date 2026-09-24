const { addonBuilder } = require('stremio-addon-sdk');
const crypto = require('crypto');
const BASE='https://yanhh3d.men', ADDON='https://yanhh3d-nuvio-lovat.vercel.app';
const ANIME_BASE='https://animehay13.site', ANIME_BACKUP='https://animehay14.site';
const HH3D_BASE='https://hoathinh3d.de', HH3D_DISCOVERY='https://bit.ly/hh3d';
const VSMOV_BASE='https://vsmov.com';
const YAN_DISCOVERY='https://bit.ly/yanhh3d', ANIME_DISCOVERY=['https://animehay.tv','https://ahay.in'], DOMAIN_CACHE_MS=6*60*60*1000;
let ACTIVE_YAN_BASE=BASE, ACTIVE_ANIME_BASE=ANIME_BASE, ACTIVE_HH3D_BASE=HH3D_BASE;
let yanDomainCache={time:Date.now(),roots:[BASE,'https://yanhh3d.pw']}, animeDomainCache={time:Date.now(),roots:[ANIME_BASE,ANIME_BACKUP]}, hh3dDomainCache={time:Date.now(),roots:[HH3D_BASE]};
let yanDiscoveryPromise=null, animeDiscoveryPromise=null, hh3dDiscoveryPromise=null;
const animeMatchCache=new Map(), hh3dMatchCache=new Map(), yanTitleCache=new Map();
const UA='Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36', TIMEOUT=20000;
const CATALOGS={recent:{id:'yanhh3d-recent',name:'Mới cập nhật',path:'/moi-cap-nhat'},ongoing:{id:'yanhh3d-ongoing',name:'Phim bộ • Đang chiếu',path:'/dang-chieu'},movies:{id:'yanhh3d-movies',name:'Phim lẻ • OVA',path:'/phim-le'},fourk:{id:'yanhh3d-4k',name:'Phim 4K',path:'/hoat-hinh-4k'},completed:{id:'yanhh3d-completed',name:'Đã hoàn thành',path:'/hoan-thanh'}};
const ANIME_CATALOGS={latest:{id:'animehay-latest',name:'Anime Nhật • Mới cập nhật',path:'/the-loai/anime-1.html'}};
const VSMOV_CATALOGS={
  western:{id:'vsmov-western',name:'Phim Âu Mỹ • Mới cập nhật',country:'au-my',sourceType:'single',type:'movie'},
  korea:{id:'vsmov-korea',name:'Phim Hàn Quốc',country:'han-quoc',sourceType:'series',type:'series'},
  china:{id:'vsmov-china',name:'Phim Trung Quốc • Người đóng',country:'trung-quoc',sourceType:'series',type:'series'}
};
const catalogManifest=[
  ...Object.values(CATALOGS).map(c=>({type:'series',id:c.id,name:c.name,extra:[{name:'search',isRequired:false},{name:'skip',isRequired:false}]})),
  ...Object.values(ANIME_CATALOGS).map(c=>({type:'series',id:c.id,name:c.name,extra:[{name:'search',isRequired:false},{name:'skip',isRequired:false}]})),
  ...Object.values(VSMOV_CATALOGS).map(c=>({type:c.type,id:c.id,name:c.name,extra:[{name:'skip',isRequired:false}]}))
];
const manifest={id:'community.yanhhh3d.direct',version:'3.4.0',name:'YanHH3D + Anime + Phim',description:'YanHH3D, AnimeHay, HH3D và danh mục phim theo quốc gia',logo:BASE+'/favicon.ico',resources:['catalog',{name:'meta',types:['series'],idPrefixes:['yanhh3d:','animehay:']},{name:'stream',types:['series'],idPrefixes:['yanhh3d:','animehay:']}],types:['series','movie'],catalogs:catalogManifest,behaviorHints:{configurable:false}};
const builder=new addonBuilder(manifest);
function decode(s){return String(s||'').replace(/\\\//g,'/').replace(/\\u0026/gi,'&').replace(/\\u003d/gi,'=').replace(/&amp;/g,'&').replace(/&#39;|&apos;/gi,"'").replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>')}
function clean(s){return decode(String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim()}
function abs(u,b=ACTIVE_YAN_BASE){if(!u)return null;try{return new URL(decode(u),b).href}catch(_){return null}}
function slugify(s){return clean(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')}
async function fetchPage(url,ref=ACTIVE_YAN_BASE+'/',timeout=TIMEOUT){const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(url,{signal:c.signal,redirect:'follow',headers:{'User-Agent':UA,'Accept':'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8','Referer':ref,'Cache-Control':'no-cache'}});if(!r.ok)throw Error('HTTP '+r.status);return{text:await r.text(),url:r.url}}finally{clearTimeout(t)}}
async function get(url,ref=ACTIVE_YAN_BASE+'/',timeout=TIMEOUT){return(await fetchPage(url,ref,timeout)).text}
function uniqueOrigins(values){const out=[];for(const value of values){try{const origin=new URL(value).origin;if(/^https?:\/\//i.test(origin)&&!out.includes(origin))out.push(origin)}catch(_){}}return out}
function isYanPage(h){return /YanHH3D/i.test(h)&&/(?:moi-cap-nhat|film-poster|Hoạt Hình Trung Quốc)/i.test(h)}
function isAnimePage(h){return /AnimeHay/i.test(h)&&/(?:thong-tin-phim|the-loai\/anime|Mới cập nhật)/i.test(h)}
function isHh3dPage(h){return /(?:HoatHinh3D|HH3D|Hoạt Hình Trung Quốc)/i.test(h)&&/(?:halim-thumb|halim_cfg|halim-list-server)/i.test(h)}
async function yanRoots(force=false){
  if(!force&&yanDomainCache&&Date.now()-yanDomainCache.time<DOMAIN_CACHE_MS)return yanDomainCache.roots;
  if(yanDiscoveryPromise)return yanDiscoveryPromise;
  const task=(async()=>{
    const redirected=[];
    try{const page=await fetchPage(YAN_DISCOVERY,YAN_DISCOVERY,12000);if(isYanPage(page.text))redirected.push(new URL(page.url).origin)}catch(_){}
    const probes=uniqueOrigins([...redirected,ACTIVE_YAN_BASE,BASE,'https://yanhh3d.pw']);
    const checked=await Promise.allSettled(probes.map(async root=>{const page=await fetchPage(root+'/',root+'/',12000);if(!isYanPage(page.text))throw Error('Not YanHH3D');return new URL(page.url).origin}));
    const live=checked.flatMap(x=>x.status==='fulfilled'?[x.value]:[]),roots=uniqueOrigins([...redirected,...live,ACTIVE_YAN_BASE,BASE,'https://yanhh3d.pw']);
    if(live.length)ACTIVE_YAN_BASE=live[0];
    yanDomainCache={time:Date.now(),roots};
    return roots;
  })();
  yanDiscoveryPromise=task;
  try{return await task}finally{if(yanDiscoveryPromise===task)yanDiscoveryPromise=null}
}
async function yanGet(pathOrUrl,ref,timeout=TIMEOUT){let last;for(const force of [false,true]){const roots=await yanRoots(force);for(const root of roots){try{const input=new URL(pathOrUrl,root),url=/^yanhh3d\./i.test(input.hostname)?root+input.pathname+input.search:input.href,page=await fetchPage(url,ref||root+'/',timeout);if(!isYanPage(page.text)&&!/(?:btn3dsv|\/tap-\d+)/i.test(page.text))throw Error('Not YanHH3D');ACTIVE_YAN_BASE=new URL(page.url).origin;return page.text}catch(e){last=e}}}throw last||Error('YanHH3D unavailable')}
async function animeRoots(force=false){
  if(!force&&animeDomainCache&&Date.now()-animeDomainCache.time<DOMAIN_CACHE_MS)return animeDomainCache.roots;
  if(animeDiscoveryPromise)return animeDiscoveryPromise;
  const task=(async()=>{
    const guides=await Promise.allSettled(ANIME_DISCOVERY.map(url=>fetchPage(url,url,12000))),found=[];
    for(const result of guides){if(result.status!=='fulfilled')continue;for(const match of result.value.text.matchAll(/https?:\/\/animehay\d+\.site/gi))found.push(match[0]);for(const match of result.value.text.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi))if(/animehay\d+\.site/i.test(match[1]))found.push(match[1])}
    const roots=uniqueOrigins([...found,ACTIVE_ANIME_BASE,ANIME_BASE,ANIME_BACKUP]);
    animeDomainCache={time:Date.now(),roots};
    return roots;
  })();
  animeDiscoveryPromise=task;
  try{return await task}finally{if(animeDiscoveryPromise===task)animeDiscoveryPromise=null}
}
async function hh3dRoots(force=false){
  if(!force&&hh3dDomainCache&&Date.now()-hh3dDomainCache.time<DOMAIN_CACHE_MS)return hh3dDomainCache.roots;
  if(hh3dDiscoveryPromise)return hh3dDiscoveryPromise;
  const task=(async()=>{
    const redirected=[];
    try{const page=await fetchPage(HH3D_DISCOVERY,HH3D_DISCOVERY,12000);if(isHh3dPage(page.text))redirected.push(new URL(page.url).origin)}catch(_){}
    const probes=uniqueOrigins([...redirected,ACTIVE_HH3D_BASE,HH3D_BASE]);
    const checked=await Promise.allSettled(probes.map(async root=>{const page=await fetchPage(root+'/',root+'/',12000);if(!isHh3dPage(page.text))throw Error('Not HH3D');return new URL(page.url).origin}));
    const live=checked.flatMap(x=>x.status==='fulfilled'?[x.value]:[]),roots=uniqueOrigins([...redirected,...live,ACTIVE_HH3D_BASE,HH3D_BASE]);
    if(live.length)ACTIVE_HH3D_BASE=live[0];
    hh3dDomainCache={time:Date.now(),roots};
    return roots;
  })();
  hh3dDiscoveryPromise=task;
  try{return await task}finally{if(hh3dDiscoveryPromise===task)hh3dDiscoveryPromise=null}
}
async function hh3dGet(pathOrUrl,ref,timeout=30000){let last;for(const force of [false,true]){for(const root of await hh3dRoots(force)){try{const input=new URL(pathOrUrl,root),url=/^(?:www\.)?hoathinh3d\./i.test(input.hostname)?root+input.pathname+input.search:input.href,page=await fetchPage(url,ref||root+'/',timeout);if(!isHh3dPage(page.text))throw Error('Not HH3D');ACTIVE_HH3D_BASE=new URL(page.url).origin;return page.text}catch(e){last=e}}}throw last||Error('HH3D unavailable')}
function attr(tag,n){const m=String(tag||'').match(new RegExp(n+'\\s*=\\s*[\"\']([^\"\']+)[\"\']','i'));return m?decode(m[1]):null}
function anchors(h){const o=[],r=/<a\b([^>]*?)>([\s\S]*?)<\/a>/gi;let m;while((m=r.exec(h||''))){const href=abs(attr(m[1],'href')),text=clean(m[2]);if(href)o.push({href,text,tag:m[1],index:m.index})}return o}
function imageFromTag(tag){if(!tag)return null;return abs(attr(tag,'data-src')||attr(tag,'data-original')||attr(tag,'data-lazy-src')||attr(tag,'src')||attr(tag,'data-image'))}
function posterNear(h,index,limit=3500){const before=String(h).slice(Math.max(0,index-limit),Math.min(String(h).length,index+limit));const imgs=[...before.matchAll(/<img\b[^>]*>/gi)];for(let i=imgs.length-1;i>=0;i--){const u=imageFromTag(imgs[i][0]);if(u&&!/logo|avatar|favicon|lazy/i.test(u))return u}return null}
function detailLink(u){try{const x=new URL(u),p=x.pathname.split('/').filter(Boolean);return /^yanhh3d\./i.test(x.hostname)&&p.length===1&&!/^(?:moi-cap-nhat|dang-chieu|phim-le|hoat-hinh|hoan-thanh|search)$/i.test(p[0])}catch(_){return false}}
function cards(h){const out=[],seen=new Set(),r=/<img\b[^>]*\bclass=["'][^"']*\bfilm-poster-img\b[^"']*["'][^>]*>/gi;let m;while((m=r.exec(h||''))){const poster=imageFromTag(m[0]),tail=String(h).slice(r.lastIndex,r.lastIndex+1600),a=tail.match(/<a\b(?=[^>]*\bclass=["'][^"']*\bfilm-poster-ahref\b)[^>]*>/i);if(!a)continue;const u=abs(attr(a[0],'href'))?.replace(/\/$/,'');if(!u||!detailLink(u)||seen.has(u))continue;const title=clean(attr(a[0],'title')||attr(m[0],'alt'));if(!title)continue;seen.add(u);out.push({url:u,title,poster})}return out}
function searchItems(h){let b=h;try{const j=JSON.parse(h);b=j.data||j.html||h}catch(_){}const found=cards(b);if(found.length)return found;const o=[],s=new Set();for(const a of anchors(b)){const u=a.href.replace(/\/$/,'');if(!detailLink(u)||!a.text||s.has(u))continue;s.add(u);o.push({url:u,title:clean(a.text),poster:posterNear(b,a.index,900)})}return o}
function movieKey(url){try{return new URL(url).pathname.replace(/^\/+|\/+$/g,'').replace(/\/tap-\d+\.html$/i,'').split('/').map(encodeURIComponent).join('~')}catch(_){return ''}}
function detailUrl(id){const key=String(id).replace(/^yanhh3d:/,'');return ACTIVE_YAN_BASE+'/'+key.split('~').map(x=>{try{return decodeURIComponent(x)}catch(_){return x}}).join('/')}
function parsePoster(h){for(const re of [/<meta\b[^>]*property=["']og:image["'][^>]*>/i,/<meta\b[^>]*name=["']twitter:image["'][^>]*>/i]){const m=h.match(re);if(m){const u=attr(m[0],'content');if(u)return abs(u)}}const imgs=[...String(h).matchAll(/<img\b[^>]*>/gi)];for(const m of imgs){const u=imageFromTag(m[0]);if(u&&!/logo|avatar|favicon/i.test(u))return u}return null}
function parseTitle(h,f){const m=h.match(/<meta\b[^>]*property=["']og:title["'][^>]*>/i);if(m)return clean(attr(m[0],'content')).replace(/\s+(?:Thuyết Minh|Vietsub).*$/i,'').replace(/\s*[-|]\s*YanHH3D.*$/i,'').trim();const x=h.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);return clean(x?x[1]:f).replace(/\s+(?:Thuyết Minh|Vietsub).*$/i,'').trim()}
function parseDescription(h,title){const body=String(h||'').match(/<div\b[^>]*class=["'][^"']*\bfilm-description\b[^"']*["'][^>]*>[\s\S]*?<div\b[^>]*class=["'][^"']*\btext\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i),full=clean(body?.[1]);if(full)return full;for(const re of [/<meta\b[^>]*name=["']description["'][^>]*>/i,/<meta\b[^>]*property=["']og:description["'][^>]*>/i]){const m=String(h||'').match(re);if(!m)continue;let value=clean(attr(m[0],'content'));if(value){value=value.replace(new RegExp('^Xem phim\\s+'+String(title||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:\\s+(?:Thuyết Minh|Vietsub))?\\s*:\\s*','i'),'');return value}}return'YanHH3D • Hoạt hình 3D'}
function episodes(h){const m=new Map();for(const a of anchors(h)){const x=a.href.match(/\/tap-(\d+)(?:\.html)?(?:[?#]|$)/i);if(x&&!m.has(+x[1]))m.set(+x[1],{episode:+x[1],url:a.href})}return [...m.values()].sort((a,b)=>a.episode-b.episode)}
function maxEp(h){const n=[...String(h||'').matchAll(/\/tap-(\d+)/gi)].map(x=>+x[1]);return n.length?Math.max(...n):0}
async function allEpisodes(h,u){const initial=episodes(h);if(!initial.length||initial.length>10)return initial;try{const latest=initial.at(-1),page=await yanGet(latest.url,u,65000),full=episodes(page),merged=new Map(initial.map(x=>[x.episode,x]));for(const item of full)merged.set(item.episode,item);return[...merged.values()].sort((a,b)=>a.episode-b.episode)}catch(_){return initial}}
async function items(path,q,skip=0){if(q)return cards(await yanGet('/?s='+encodeURIComponent(q)));const first=Math.floor(skip/90)*3+1,pages=await Promise.allSettled([first,first+1,first+2].map(page=>yanGet(path+(page>1?'?page='+page:''))));const out=[],seen=new Set();for(const result of pages){if(result.status!=='fulfilled')continue;for(const item of cards(result.value)){if(!seen.has(item.url)){seen.add(item.url);out.push(item)}}}return out}
function animeAbs(u,b=ACTIVE_ANIME_BASE){return abs(u,b)}
async function animeGet(path,ref){let last;for(const force of [false,true]){for(const root of await animeRoots(force)){try{const input=new URL(path,root),url=/^animehay\d+\.site$/i.test(input.hostname)?root+input.pathname+input.search:input.href,page=await fetchPage(url,ref||root+'/',45000);if(!isAnimePage(page.text)&&!/(?:aim-ep-btn|M3U8_URL|"AHS")/i.test(page.text))throw Error('Not AnimeHay');ACTIVE_ANIME_BASE=new URL(page.url).origin;return page.text}catch(e){last=e}}}throw last||Error('AnimeHay unavailable')}
function animeCards(h){const out=[],seen=new Set(),r=/<div\b[^>]*class=["'][^"']*\bmc\b[^"']*["'][^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/a>\s*<\/div>/gi;let m;while((m=r.exec(h||''))){const a=m[0].match(/<a\b(?=[^>]*class=["'][^"']*\bmc__link\b)[^>]*>/i),img=m[0].match(/<img\b[^>]*>/i);if(!a)continue;const url=animeAbs(attr(a[0],'href')),key=animeKey(url);if(!url||!key||seen.has(key))continue;const title=clean(attr(a[0],'title')||attr(img?.[0],'alt')).replace(/^Phim\s+/i,'').replace(/,+$/,'').trim();if(!title)continue;seen.add(key);out.push({url,key,title,poster:animeAbs(imageFromTag(img?.[0]),url)})}return out}
function animeKey(url){try{const m=new URL(url).pathname.match(/\/thong-tin-phim\/([^/]+)\.html$/i);return m?m[1]:''}catch(_){return''}}
function animeDetailUrl(id){return ACTIVE_ANIME_BASE+'/thong-tin-phim/'+String(id).replace(/^animehay:/,'')+'.html'}
function animePage(path,page){if(page<=1)return path;return path+'/trang-'+page+'.html?cate_id=1'}
async function animeItems(path,q,skip=0){if(q)return animeCards(await animeGet('/tim-kiem/?keyword='+encodeURIComponent(q)));const first=Math.floor(skip/40)+1,pages=await Promise.allSettled([first,first+1].map(page=>animeGet(animePage(path,page))));const out=[],seen=new Set();for(const result of pages){if(result.status!=='fulfilled')continue;for(const item of animeCards(result.value)){if(!seen.has(item.key)){seen.add(item.key);out.push(item)}}}return out}
function matchTitle(s){return slugify(s).replace(/(?:^|-)(?:3d|2d|vietsub|thuyet-minh)(?=-|$)/g,'').replace(/-+/g,'-').replace(/^-|-$/g,'')}
function titleScore(a,b){const x=matchTitle(a),y=matchTitle(b);if(!x||!y)return 0;if(x===y)return 1;const ax=new Set(x.split('-')),by=new Set(y.split('-')),same=[...ax].filter(v=>by.has(v)).length,union=new Set([...ax,...by]).size;return same/Math.max(1,union)}
function animeEpisodeLinks(h){const out=[];for(const m of String(h||'').matchAll(/<a\b(?=[^>]*class=["'][^"']*\baim-ep-btn\b)[^>]*>/gi)){const url=animeAbs(attr(m[0],'href')),n=+(attr(m[0],'title')||'').match(/(\d+)/)?.[1];if(url&&n)out.push({episode:n,url})}return out}
async function findAnimeMatch(metaId,title){const cached=animeMatchCache.get(metaId);if(cached&&Date.now()-cached.time<DOMAIN_CACHE_MS)return cached.item;const simplified=clean(title).replace(/\b(?:3D|2D|Thuyết Minh|Vietsub)\b/gi,' ').replace(/\s+/g,' ').trim(),queries=[title];if(simplified&&simplified!==title)queries.push(simplified);const results=await Promise.allSettled(queries.map(q=>animeGet('/tim-kiem/?keyword='+encodeURIComponent(q)))),candidates=[],seen=new Set();for(const result of results){if(result.status!=='fulfilled')continue;for(const item of animeCards(result.value)){if(!seen.has(item.key)){seen.add(item.key);candidates.push(item)}}}candidates.sort((a,b)=>titleScore(title,b.title)-titleScore(title,a.title));const best=candidates[0],item=best&&titleScore(title,best.title)>=0.65?best:null;animeMatchCache.set(metaId,{time:Date.now(),item});return item}
async function animeAlternates(metaId,ep){const cachedTitle=yanTitleCache.get(metaId),detail=detailUrl(metaId),title=cachedTitle&&Date.now()-cachedTitle.time<DOMAIN_CACHE_MS?cachedTitle.title:parseTitle(await yanGet(detail),metaId.replace(/^yanhh3d:/,'').replace(/-/g,' '));yanTitleCache.set(metaId,{time:Date.now(),title});const match=await findAnimeMatch(metaId,title);if(!match)return[];const animeHtml=await animeGet(match.url),episode=animeEpisodeLinks(animeHtml).find(x=>x.episode===+ep);if(!episode)return[];return(await animeStreams(episode.url)).map(stream=>({...stream,name:'AnimeHay Direct',title:'AnimeHay • nguồn trực tiếp dự phòng'}))}
function hh3dCards(h){const out=[],seen=new Set();for(const m of String(h||'').matchAll(/<article\b[^>]*\bpost-(\d+)[^>]*>[\s\S]*?<\/article>/gi)){const article=m[0],a=article.match(/<a\b(?=[^>]*class=["'][^"']*\bhalim-thumb\b)[^>]*>/i);if(!a)continue;const url=abs(attr(a[0],'href'),ACTIVE_HH3D_BASE),title=clean(attr(a[0],'title')),latest=+(clean((article.match(/<span\b[^>]*class=["'][^"']*\bepisode\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)||[])[1]).match(/(?:Tập|Tap)\s*(\d+)/i)||[])[1]||0;if(!url||!title||seen.has(url))continue;seen.add(url);out.push({url,title,postId:m[1],latest})}return out}
async function findHh3dMatch(metaId,title){const cached=hh3dMatchCache.get(metaId);if(cached&&Date.now()-cached.time<DOMAIN_CACHE_MS)return cached.item;const simplified=clean(title).replace(/\b(?:3D|2D|Thuyết Minh|Vietsub)\b/gi,' ').replace(/\s+/g,' ').trim(),queries=[title];if(simplified&&simplified!==title)queries.push(simplified);const results=await Promise.allSettled(queries.map(q=>hh3dGet('/?s='+encodeURIComponent(q)))),candidates=[],seen=new Set();for(const result of results){if(result.status!=='fulfilled')continue;for(const item of hh3dCards(result.value)){if(!seen.has(item.url)){seen.add(item.url);candidates.push(item)}}}candidates.sort((a,b)=>titleScore(title,b.title)-titleScore(title,a.title));const best=candidates[0],item=best&&titleScore(title,best.title)>=0.65?best:null;hh3dMatchCache.set(metaId,{time:Date.now(),item});return item}
function cookieHeader(headers){const values=typeof headers.getSetCookie==='function'?headers.getSetCookie():[headers.get('set-cookie')||''];return values.flatMap(value=>String(value).split(/,(?=\s*[^;,=]+=[^;,]+)/)).map(value=>value.split(';',1)[0].trim()).filter(Boolean).join('; ')}
async function hh3dPlayer(postId,ep,ref){
  const root=new URL(ref).origin,client=crypto.randomBytes(24).toString('hex'),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try{
    const headers={'User-Agent':UA,'Accept':'text/html,*/*;q=0.8','Referer':ref,'X-Requested-With':'XMLHttpRequest','X-Halim-Client':client};
    const playerUrl=new URL('/wp-content/themes/halimmovies/player.php',root);playerUrl.search=new URLSearchParams({episode_slug:'tap-'+ep,server_id:'1',subsv_id:'',post_id:String(postId)}).toString();
    const player=await fetch(playerUrl,{signal:controller.signal,headers,redirect:'follow'});if(!player.ok)throw Error('HH3D player HTTP '+player.status);
    const encrypted=JSON.parse(await player.text());if(!encrypted._encrypted||!encrypted.kid||!encrypted.iv||!encrypted.payload)throw Error(encrypted.message||'HH3D player payload invalid');
    const cookies=cookieHeader(player.headers),keyResponse=await fetch(new URL('/wp-json/halim/v1/player-key',root),{signal:controller.signal,method:'POST',headers:{...headers,'Content-Type':'application/json',...(cookies?{Cookie:cookies}:{})},body:JSON.stringify({key_id:encrypted.kid})});
    if(!keyResponse.ok)throw Error('HH3D key HTTP '+keyResponse.status);const keyData=await keyResponse.json();if(!keyData.success||!keyData.key)throw Error(keyData.message||'HH3D key invalid');
    const key=Buffer.from(keyData.key,'base64url'),iv=Buffer.from(encrypted.iv,'base64url'),payload=Buffer.from(encrypted.payload,'base64url'),decipher=crypto.createDecipheriv('aes-'+key.length*8+'-gcm',key,iv);decipher.setAuthTag(payload.subarray(-16));
    const data=JSON.parse(Buffer.concat([decipher.update(payload.subarray(0,-16)),decipher.final()]).toString('utf8'));if(!data.status||data.type!=='hls'||!/^https:\/\//i.test(data.file||''))throw Error(data.message||'HH3D HLS unavailable');return data;
  }finally{clearTimeout(timer)}
}
async function hh3dAlternates(metaId,ep){const cachedTitle=yanTitleCache.get(metaId),detail=detailUrl(metaId),title=cachedTitle&&Date.now()-cachedTitle.time<DOMAIN_CACHE_MS?cachedTitle.title:parseTitle(await yanGet(detail),metaId.replace(/^yanhh3d:/,'').replace(/-/g,' '));yanTitleCache.set(metaId,{time:Date.now(),title});const match=await findHh3dMatch(metaId,title);if(!match||match.latest&&+ep>match.latest)return[];let postId=match.postId;if(!postId){const page=await hh3dGet(match.url);postId=(page.match(/\bpostid-(\d+)/i)||page.match(/\bdata-post-id=["'](\d+)/i)||[])[1]}if(!postId)return[];const data=await hh3dPlayer(postId,ep,match.url);return[{name:'HH3D Direct',title:'HH3D • '+clean(data.label||'1080')+' • Vietsub',url:data.file,quality:/4K/i.test(data.label||'')?'4K':'1080p',behaviorHints:{notWebReady:true,proxyHeaders:{request:{'User-Agent':UA,'Referer':ACTIVE_HH3D_BASE+'/'}}}}]}
async function vsmovPage(c,page){const url=VSMOV_BASE+'/api/quoc-gia/'+c.country+'?limit=50&page='+page+'&type='+c.sourceType;const data=JSON.parse(await get(url,VSMOV_BASE+'/',45000));return Array.isArray(data.items)?data.items:[]}
function vsmovMeta(item,c){const id=String(item?.imdb?.id||'').trim();if(!/^tt\d+$/.test(id))return null;const actualType=item?.tmdb?.type==='movie'?'movie':'series';if(actualType!==c.type)return null;return{id,type:c.type,name:clean(item.name||item.origin_name),poster:abs(item.poster_url,VSMOV_BASE)||undefined,background:abs(item.thumb_url,VSMOV_BASE)||undefined,posterShape:'poster',releaseInfo:item.year?String(item.year):undefined}}
async function vsmovItems(c,skip=0){const safeSkip=Math.max(0,Math.min(+skip||0,350)),pageCount=Math.min(8,Math.ceil((safeSkip+50)/50)+1),pages=await Promise.allSettled(Array.from({length:pageCount},(_,i)=>vsmovPage(c,i+1))),out=[],seen=new Set();for(const result of pages){if(result.status!=='fulfilled')continue;for(const item of result.value){const meta=vsmovMeta(item,c);if(meta&&!seen.has(meta.id)){seen.add(meta.id);out.push(meta)}}}return out.slice(safeSkip,safeSkip+50)}
builder.defineCatalogHandler(async a=>{
  const c=Object.values(CATALOGS).find(x=>x.id===a.id);
  if(c){try{const skip=+a.extra?.skip||0,x=await items(c.path,a.extra?.search?.trim(),skip);return{metas:x.slice(0,100).map(v=>({id:'yanhh3d:'+movieKey(v.url),type:'series',name:clean(v.title),poster:v.poster||undefined,posterShape:'poster'}))}}catch(e){console.error('[catalog]',e.message);return{metas:[]}}}
  const ac=Object.values(ANIME_CATALOGS).find(x=>x.id===a.id);
  if(ac){try{const x=await animeItems(ac.path,a.extra?.search?.trim(),+a.extra?.skip||0);return{metas:x.slice(0,80).map(v=>({id:'animehay:'+v.key,type:'series',name:v.title,poster:v.poster||undefined,posterShape:'poster'}))}}catch(e){console.error('[anime-catalog]',e.message);return{metas:[]}}}
  const vc=Object.values(VSMOV_CATALOGS).find(x=>x.id===a.id&&x.type===a.type);
  if(!vc)return{metas:[]};
  try{return{metas:await vsmovItems(vc,+a.extra?.skip||0),cacheMaxAge:21600}}catch(e){console.error('[vsmov-catalog]',e.message);return{metas:[],cacheMaxAge:0}}
});
builder.defineMetaHandler(async a=>{
  if(String(a.id).startsWith('animehay:')){try{const u=animeDetailUrl(a.id),h=await animeGet(u),titleTag=h.match(/<h1\b[^>]*class=["'][^"']*\baim-hero__title\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i),name=clean(titleTag?.[1]||a.id.replace(/^animehay:/,'').replace(/-/g,' ')).replace(/,+$/,'').trim(),descTag=h.match(/<div\b[^>]*id=["']aim-desc-content["'][^>]*>([\s\S]*?)<\/div>/i),poster=animeAbs((h.match(/<meta\b[^>]*property=["']og:image["'][^>]*>/i)||[])[0]&&attr(h.match(/<meta\b[^>]*property=["']og:image["'][^>]*>/i)[0],'content')),eps=[];for(const m of h.matchAll(/<a\b(?=[^>]*class=["'][^"']*\baim-ep-btn\b)[^>]*>/gi)){const url=animeAbs(attr(m[0],'href')),n=+(attr(m[0],'title')||'').match(/(\d+)/)?.[1];if(url&&n)eps.push({episode:n,url})}eps.sort((x,y)=>x.episode-y.episode);const videos=eps.map(x=>({id:a.id+':1:'+x.episode+':'+encodeURIComponent(x.url),title:'Tập '+x.episode,season:Math.floor((x.episode-1)/50)+1,episode:(x.episode-1)%50+1}));return{meta:{id:a.id,type:'series',name,poster:poster||undefined,background:poster||undefined,description:clean(descTag?.[1])||'Anime Nhật Bản • AnimeHay',videos}}}catch(e){console.error('[anime-meta]',e.message);return{meta:null}}}
  if(!String(a.id).startsWith('yanhh3d:'))return{meta:null};
  const u=detailUrl(a.id);
  try{
    const h=await yanGet(u),e=await allEpisodes(h,u),name=parseTitle(h,a.id.replace(/^yanhh3d:/,'').replace(/-/g,' '));
    const videos=e.map(x=>{
      const season=Math.floor((x.episode-1)/50)+1,episode=(x.episode-1)%50+1;
      return{id:a.id+':1:'+x.episode+':'+encodeURIComponent(x.url),title:'Tập '+x.episode,season,episode};
    });
    yanTitleCache.set(a.id,{time:Date.now(),title:name});
    return{meta:{id:a.id,type:'series',name,poster:parsePoster(h)||undefined,background:parsePoster(h)||undefined,description:parseDescription(h,name),videos}};
  }catch(e){console.error('[meta]',e.message);return{meta:null}}
});
function epUrl(id){const p=String(id).indexOf(':1:');if(p<0)return null;const r=String(id).slice(p+3),i=r.indexOf(':');if(i<0)return null;try{return decodeURIComponent(r.slice(i+1))}catch(_){return null}}
function iframes(h,b){const o=[],r=/<iframe\b[^>]*>/gi;let m;while((m=r.exec(h||''))){const u=abs(attr(m[0],'src')||attr(m[0],'data-src'),b);if(u&&!o.includes(u)&&!/youtube|facebook\.com|doubleclick|analytics/i.test(u))o.push(u)}return o}
function media(h,b){const o=[],r=/(?:https?:)?\/\/[^\s"'<>]+\.(?:m3u8|mp4)(?:\?[^\s"'<>]*)?/gi;let m;while((m=r.exec(decode(h||'')))){const u=abs(m[0],b);if(u)o.push(u)}return [...new Set(o)]}
function labeledSources(h,edition){const out=[];for(const m of String(h||'').matchAll(/<a\b(?=[^>]*\bbtn3dsv\b)[^>]*>[\s\S]*?<\/a>/gi)){const url=abs(attr(m[0],'data-src')),label=clean(m[0]);try{const host=new URL(url).hostname;if((host==='rptcdn.site'||host.endsWith('.rptcdn.site'))&&/\.m3u8(?:[?#]|$)/i.test(url))out.push({url,label:label||'HD',edition})}catch(_){}}return out}
async function editionSources(slug,ep,edition){const suffix=(edition==='Thuyết minh'?'':'sever2/')+slug+'/tap-'+ep,h=await yanGet('/'+suffix,null,65000),found=labeledSources(h,edition);if(!found.length)throw Error('No '+edition+' links');return found}
async function sourcesForSlug(slug,ep){const results=await Promise.allSettled([editionSources(slug,ep,'Thuyết minh'),editionSources(slug,ep,'Vietsub')]),out=results.flatMap(x=>x.status==='fulfilled'?x.value:[]);if(!out.length)throw Error('No direct streams for '+slug);return out}
async function resolveLegacySlug(slug){const h=await yanGet('/?s='+encodeURIComponent(slug.replace(/-/g,' ')),null,45000),wanted=new Set(slug.split('-')),candidates=[];for(const a of anchors(h)){try{const u=new URL(a.href),parts=u.pathname.split('/').filter(Boolean);if(!/^yanhh3d\./i.test(u.hostname)||parts.length!==1)continue;const candidate=parts[0],label=slugify(attr(a.tag,'title')||a.text||candidate),tokens=new Set((label+'-'+candidate).split('-')),matches=[...wanted].filter(x=>tokens.has(x)).length,score=matches/Math.max(1,wanted.size);if(score>=0.5)candidates.push({slug:candidate,score})}catch(_){}}candidates.sort((a,b)=>b.score-a.score);return candidates[0]?.slug||null}
async function legacyStreams(id,ep){const metaId=String(id).split(':1:')[0],slug=detailUrl(metaId).split('/').filter(Boolean).at(-1),resolvedAttempt=(async()=>{const resolved=await resolveLegacySlug(slug);if(!resolved||resolved===slug)throw Error('No alternate legacy slug');console.log('[direct-stream] resolved slug',{slug,resolved});return sourcesForSlug(resolved,ep)})(),sources=await Promise.any([sourcesForSlug(slug,ep),resolvedAttempt]);sources.sort((a,b)=>(/4K/i.test(b.label)?2:1)-(/4K/i.test(a.label)?2:1)||a.edition.localeCompare(b.edition));return sources.map((source,i)=>({name:'YanHH3D Direct',title:source.label.replace(/-$/,' dự phòng')+' • '+source.edition,url:ADDON+'/api/legacy?url='+encodeURIComponent(source.url),quality:/4K/i.test(source.label)?'4K':'1080p',behaviorHints:{notWebReady:true}}))}
async function animeStreams(url){const page=await animeGet(url),server=(page.match(/["']AHS["']\s*:\s*["']([^"']+)["']/i)||[])[1];if(!server)throw Error('No AnimeHay AHS server');const embed=await get(server,url,45000),m3u8=(embed.match(/\bM3U8_URL\s*=\s*["']([^"']+)["']/i)||[])[1];if(!m3u8)throw Error('No AnimeHay HLS URL');return[{name:'AnimeHay',title:'AnimeHay • tự động tới 1080p',url:decode(m3u8),quality:'1080p',behaviorHints:{notWebReady:true,proxyHeaders:{request:{Referer:server}}}}]}
function within(promise,ms,label){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' timed out')),ms)})]).finally(()=>clearTimeout(timer))}
builder.defineStreamHandler(async a=>{const u=epUrl(a.id);if(!u)return{streams:[]};if(String(a.id).startsWith('animehay:')){try{return{streams:await animeStreams(u),cacheMaxAge:3600}}catch(e){console.error('[anime-stream]',e.message);return{streams:[],cacheMaxAge:0}}}const ep=(u.match(/\/tap-(\d+)/i)||[])[1];if(!ep)return{streams:[]};const metaId=String(a.id).split(':1:')[0],results=await Promise.allSettled([within(legacyStreams(a.id,ep),32000,'YanHH3D'),within(animeAlternates(metaId,ep),32000,'AnimeHay'),within(hh3dAlternates(metaId,ep),32000,'HH3D')]),yan=results[0].status==='fulfilled'?results[0].value:[],anime=results[1].status==='fulfilled'?results[1].value:[],hh3d=results[2].status==='fulfilled'?results[2].value:[];if(results[0].status==='rejected')console.error('[direct-stream]',results[0].reason?.message);if(results[1].status==='rejected')console.error('[anime-alternate]',results[1].reason?.message);if(results[2].status==='rejected')console.error('[hh3d-alternate]',results[2].reason?.message);return{streams:[...yan,...anime,...hh3d],cacheMaxAge:0}});
module.exports=builder.getInterface();
