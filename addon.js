const { addonBuilder } = require('stremio-addon-sdk');

const BASE = 'https://yanhh3d.pw';
const UA = 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36';
const TIMEOUT = 20000;

const CATALOGS = {
  home: { id: 'yanhh3d-home', name: 'YanHH3D • Mới cập nhật', path: '/' },
  new: { id: 'yanhh3d-new', name: 'YanHH3D • Phim đang cập nhật', path: '/phim-dang-cap-nhat/' },
  single: { id: 'yanhh3d-single', name: 'YanHH3D • Phim lẻ', path: '/phim-le/' },
  series: { id: 'yanhh3d-series', name: 'YanHH3D • Phim bộ', path: '/phim-bo/' },
  popular: { id: 'yanhh3d-popular', name: 'YanHH3D • Đánh giá cao', path: '/phim-danh-gia-cao/' }
};

const manifest = {
  id: 'community.yanhh3d',
  version: '1.2.0',
  name: 'YanHH3D',
  description: 'Hoạt hình 3D Trung Quốc từ YanHH3D',
  logo: BASE + '/favicon.ico',
  resources: [
    'catalog',
    { name: 'meta', types: ['series'], idPrefixes: ['yanhh3d:'] },
    { name: 'stream', types: ['series'], idPrefixes: ['yanhh3d:'] }
  ],
  types: ['series'],
  catalogs: Object.values(CATALOGS).map(c => ({
    type: 'series', id: c.id, name: c.name,
    extra: [
      { name: 'search', isRequired: false },
      { name: 'skip', isRequired: false }
    ]
  })),
  behaviorHints: { configurable: false }
};

const builder = new addonBuilder(manifest);

function decode(s) {
  return String(s || '')
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003d/gi, '=')
    .replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
function clean(s) {
  return decode(String(s || '').replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}
function abs(url, base = BASE) { try { return url ? new URL(decode(url), base).href : null; } catch (_) { return null; } }
function slugify(s) {
  return clean(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
async function get(url, referer = BASE + '/') {
  const c = new AbortController(); const timer = setTimeout(() => c.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: c.signal, headers: {
      'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'Referer': referer || BASE + '/'
    }});
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(timer); }
}
function attr(tag, name) {
  const re = new RegExp(name + "\\s*=\\s*[\\\"']([^\\\"']+)", 'i');
  const m = String(tag || '').match(re); return m ? decode(m[1]) : null;
}
function anchors(html) {
  const out = []; const re = /<a\b([^>]*?)>([\s\S]*?)<\/a>/gi; let m;
  while ((m = re.exec(html || ''))) {
    const href = abs(attr(m[1], 'href')); const text = clean(m[2]);
    if (href) out.push({ href, text, tag: m[1], block: m[0] });
  } return out;
}
function posterFromBlock(block) {
  const m = String(block || '').match(/<img\b[^>]*>/i);
  return m ? abs(attr(m[0], 'data-src') || attr(m[0], 'src')) : null;
}
function extractCards(html) {
  const out = [], seen = new Set();
  for (const a of anchors(html)) {
    const href = a.href.replace(/\/$/, '');
    if (!/yanhh3d\.pw\//i.test(href) || /\/sever\d+\//i.test(href) || /\/xem\//i.test(href) || /\/tap-\d+/i.test(href)) continue;
    const path = new URL(href).pathname;
    if (path === '/' || path.length < 2 || seen.has(href)) continue;
    const title = a.text || clean(a.block.match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1]);
    if (!title || title.length < 2) continue;
    seen.add(href);
    out.push({ url: href, title, poster: posterFromBlock(a.block) });
  }
  return out;
}
function extractSearch(html) {
  let body = html; try { const j = JSON.parse(html); body = j.data || j.html || html; } catch (_) {}
  return extractCards(body);
}
function detailUrl(id) { return BASE + '/' + String(id).replace(/^yanhh3d:/, '').replace(/[^a-z0-9-]/gi, ''); }
function parsePoster(html) {
  const og = html.match(/<meta\b[^>]*property=["']og:image["'][^>]*>/i);
  if (og) return abs(attr(og[0], 'content'));
  const m = html.match(/<img\b[^>]*>/i); return m ? abs(attr(m[0], 'data-src') || attr(m[0], 'src')) : null;
}
function parseTitle(html, fallback) {
  const og = html.match(/<meta\b[^>]*property=["']og:title["'][^>]*>/i);
  if (og) return clean(attr(og[0], 'content')).replace(/\s*[-|]\s*YanHH3D.*$/i, '').trim();
  const h = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i); return clean(h ? h[1] : fallback);
}

// Collect every episode link on the detail page, including all servers and old episodes.
function parseEpisodes(html) {
  const map = new Map();
  for (const a of anchors(html)) {
    const m = a.href.match(/\/sever(\d+)\/([^/]+)\/tap-(\d+)(?:\/?|\?)/i);
    if (!m) continue;
    const ep = Number(m[3]); if (!Number.isFinite(ep)) continue;
    const key = ep + '|' + a.href;
    if (!map.has(key)) map.set(key, { episode: ep, url: a.href, server: Number(m[1]) });
  }
  const all = [...map.values()].sort((a,b) => a.episode - b.episode || a.server - b.server);
  // Prefer one URL per episode in the UI, but keep the first real server URL found.
  const byEp = new Map();
  for (const e of all) if (!byEp.has(e.episode)) byEp.set(e.episode, e);
  return [...byEp.values()].sort((a,b) => a.episode - b.episode);
}

async function catalogItems(path, search) {
  if (search) return extractSearch(await get(BASE + '/ajax/search/suggest?ajaxSearch=1&keysearch=' + encodeURIComponent(search)));
  return extractCards(await get(BASE + path));
}

builder.defineCatalogHandler(async args => {
  const cfg = Object.values(CATALOGS).find(c => c.id === args.id);
  if (!cfg || args.type !== 'series') return { metas: [] };
  try {
    const q = args.extra?.search ? String(args.extra.search).trim() : '';
    let items = await catalogItems(cfg.path, q);
    const skip = Number(args.extra?.skip) || 0;
    items = items.slice(skip, skip + 100);
    return { metas: items.map(x => ({
      id: 'yanhh3d:' + slugify((new URL(x.url).pathname.match(/\/([^/]+)\/?$/) || [])[1] || x.title),
      type: 'series', name: clean(x.title), poster: x.poster || undefined, posterShape: 'poster'
    })), cacheMaxAge: q ? 30 : 90 };
  } catch (e) { console.error('[catalog]', args.id, e.message); return { metas: [] }; }
});

builder.defineMetaHandler(async args => {
  if (args.type !== 'series' || !String(args.id).startsWith('yanhh3d:')) return { meta: null };
  const url = detailUrl(args.id);
  try {
    const html = await get(url);
    const title = parseTitle(html, String(args.id).replace(/^yanhh3d:/, '').replace(/-/g, ' '));
    const eps = parseEpisodes(html);
    const videos = eps.map(e => ({
      id: args.id + ':1:' + e.episode + ':' + encodeURIComponent(e.url),
      title: 'Tập ' + e.episode,
      season: 1, episode: e.episode
    }));
    return { meta: {
      id: args.id, type: 'series', name: title, poster: parsePoster(html) || undefined,
      description: 'YanHH3D • Hoạt hình 3D', videos
    }, cacheMaxAge: 60 };
  } catch (e) { console.error('[meta]', e.message, url); return { meta: null }; }
});

function episodeUrlFromId(id) {
  const s = String(id), marker = ':1:', p = s.indexOf(marker);
  if (p < 0) return null;
  const rest = s.slice(p + marker.length), parts = rest.split(':');
  if (parts.length > 1) { try { return decodeURIComponent(parts.slice(1).join(':')); } catch (_) {} }
  return null;
}
function extractIframes(html, base) {
  const out = [], re = /<iframe\b[^>]*>/gi; let m;
  while ((m = re.exec(html || ''))) {
    const u = abs(attr(m[0], 'src') || attr(m[0], 'data-src'), base);
    if (u && !out.includes(u) && !/youtube|facebook\.com|doubleclick|analytics/i.test(u)) out.push(u);
  } return out;
}
function mediaUrls(html, base) {
  const text = decode(String(html || '')), out = [];
  const re = /(?:https?:)?\/\/[^\s"'<>]+\.(?:m3u8|mp4)(?:\?[^\s"'<>]*)?/gi; let m;
  while ((m = re.exec(text))) { const u = abs(m[0], base); if (u) out.push(u); }
  const srcRe = /<(?:source|video)\b[^>]*>/gi;
  while ((m = srcRe.exec(text))) { const s = attr(m[0], 'src') || attr(m[0], 'data-src'); if (s && /\.(?:m3u8|mp4)(?:\?|$)/i.test(s)) { const u=abs(s,base); if(u) out.push(u); } }
  return [...new Set(out)];
}
function streamObject(url, title, referer) {
  const headers = { Referer: referer || BASE + '/', 'User-Agent': UA };
  return {
    name: 'YanHH3D', title, url,
    quality: /4k|2160/i.test(url) ? '4K' : /1080/i.test(url) ? '1080p' : /720/i.test(url) ? '720p' : 'HD',
    // Stremio uses proxyHeaders for streams that need Referer/User-Agent.
    behaviorHints: { notWebReady: false, proxyHeaders: { request: headers } },
    headers
  };
}

builder.defineStreamHandler(async args => {
  if (args.type !== 'series' || !String(args.id).startsWith('yanhh3d:')) return { streams: [] };
  const epUrl = episodeUrlFromId(args.id); if (!epUrl) return { streams: [] };
  try {
    const epHtml = await get(epUrl, detailUrl(args.id));
    const streams = [];
    for (const frame of extractIframes(epHtml, epUrl).slice(0, 10)) {
      if (/\.(?:m3u8|mp4)(?:\?|$)/i.test(frame)) streams.push(streamObject(frame, 'YanHH3D • HD', epUrl));
      else { try { for (const u of mediaUrls(await get(frame, epUrl), frame)) streams.push(streamObject(u, 'YanHH3D • ' + (/1080/i.test(u) ? '1080p' : 'HD'), frame)); } catch(e) { console.log('[player]',e.message); } }
    }
    for (const u of mediaUrls(epHtml, epUrl)) streams.push(streamObject(u, 'YanHH3D • ' + (/1080/i.test(u) ? '1080p' : 'HD'), epUrl));
    const seen = new Set();
    return { streams: streams.filter(s => s.url && !seen.has(s.url) && seen.add(s.url)), cacheMaxAge: 5 };
  } catch (e) { console.error('[stream]', e.message, epUrl); return { streams: [] }; }
});

module.exports = builder.getInterface();
