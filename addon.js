const { addonBuilder } = require('stremio-addon-sdk');

const BASE = 'https://yanhh3d.pw';
const UA = 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36';
const TIMEOUT = 15000;

const manifest = {
  id: 'community.yanhh3d',
  version: '1.0.1',
  name: 'YanHH3D',
  description: 'YanHH3D Vietnamese animation catalog and streams',
  logo: BASE + '/favicon.ico',
  resources: [
    'catalog',
    { name: 'meta', types: ['series'], idPrefixes: ['yanhh3d:'] },
    { name: 'stream', types: ['series'], idPrefixes: ['yanhh3d:'] }
  ],
  types: ['series'],
  catalogs: [
    {
      type: 'series',
      id: 'yanhh3d',
      name: 'YanHH3D',
      extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }]
    }
  ],
  behaviorHints: { configurable: false }
};

const builder = new addonBuilder(manifest);

function decode(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function clean(s) {
  return decode(String(s || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}

function abs(url, base = BASE) {
  if (!url) return null;
  try { return new URL(url, base).href; } catch (_) { return null; }
}

function slugify(s) {
  return clean(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function get(url) {
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), TIMEOUT);
  try {
    const r = await fetch(url, {
      signal: c.signal,
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8', 'Referer': BASE + '/' }
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(timer); }
}

function attr(tag, name) {
  const re = new RegExp(name + "\\s*=\\s*[\"']([^\"']+)[\"']", "i");
  const m = String(tag).match(re);
  return m ? decode(m[1]) : null;
}

function anchors(html) {
  const out = [];
  const re = /<a\b([^>]*?)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = abs(attr(m[1], 'href'));
    const text = clean(m[2]);
    if (href) out.push({ href, text, tag: m[1] });
  }
  return out;
}

function posterFromBlock(block) {
  const m = block.match(/<img\b[^>]*>/i);
  return m ? abs(attr(m[0], 'src') || attr(m[0], 'data-src')) : null;
}

function extractCards(html) {
  const seen = new Set();
  const out = [];
  const re = /<(?:div|article|li)\b[^>]*>[\s\S]{0,5000}?<\/\s*(?:div|article|li)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const block = m[0];
    const links = anchors(block).filter(x => /yanhh3d\.pw/i.test(x.href));
    for (const a of links) {
      const href = a.href.replace(/\/$/, '');
      if (!/yanhh3d\.pw\/(?!sever\d+\/).*[^/]/i.test(href)) continue;
      if (/\/sever\d+\//i.test(href) || /\/xem\//i.test(href)) continue;
      const title = a.text || clean((block.match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i) || [])[1]);
      if (!title || title.length < 2 || seen.has(href)) continue;
      seen.add(href);
      out.push({ url: href, title, poster: posterFromBlock(block) });
    }
  }
  return out;
}

function extractSearch(html) {
  let body = html;
  try { const j = JSON.parse(html); body = j.data || j.html || ''; } catch (_) {}
  const out = [];
  const seen = new Set();
  for (const a of anchors(body)) {
    if (!/yanhh3d\.pw/i.test(a.href) || /\/sever\d+\//i.test(a.href) || /\/xem\//i.test(a.href)) continue;
    const title = a.text;
    if (!title || title.length < 2 || seen.has(a.href)) continue;
    seen.add(a.href);
    out.push({ url: a.href.replace(/\/$/, ''), title, poster: posterFromBlock(a.tag + body.slice(Math.max(0, body.indexOf(a.href) - 500), body.indexOf(a.href) + 1500)) });
  }
  return out;
}

function detailUrlForId(id) {
  const slug = String(id).replace(/^yanhh3d:/, '').replace(/[^a-z0-9-]/gi, '');
  return BASE + '/' + slug;
}

function parseEpisodeLinks(html, detailUrl) {
  const out = [];
  const seen = new Set();
  for (const a of anchors(html)) {
    if (!/yanhh3d\.pw\/sever\d+\//i.test(a.href)) continue;
    const m = a.href.match(/\/sever\d+\/([^/]+)\/tap-(\d+)/i);
    if (!m) continue;
    const ep = Number(m[2]);
    if (!Number.isFinite(ep) || seen.has(a.href)) continue;
    seen.add(a.href);
    out.push({ episode: ep, url: a.href });
  }
  out.sort((a, b) => a.episode - b.episode);

  // Fallback for pages where only some episode buttons are rendered.
  if (!out.length) {
    const slug = (detailUrl.match(/\/([^/]+)\/?$/) || [])[1];
    if (slug) {
      for (let n = 1; n <= 5; n++) out.push({ episode: n, url: BASE + '/sever2/' + slug + '/tap-' + n });
    }
  }
  return out;
}

function parsePoster(html) {
  const og = html.match(/<meta\b[^>]*property=["']og:image["'][^>]*>/i);
  if (og) return abs(attr(og[0], 'content'));
  const img = html.match(/<img\b[^>]*(?:class=["'][^"']*(?:film|cover|poster)[^"']*["'])?[^>]*>/i);
  return img ? abs(attr(img[0], 'src') || attr(img[0], 'data-src')) : null;
}

function parseTitle(html, fallback) {
  const og = html.match(/<meta\b[^>]*property=["']og:title["'][^>]*>/i);
  if (og) return clean(attr(og[0], 'content')).replace(/\s*[-|]\s*YanHH3D.*$/i, '').trim();
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  return clean(h1 ? h1[1] : fallback);
}

async function searchSite(q) {
  const html = await get(BASE + '/ajax/search/suggest?ajaxSearch=1&keysearch=' + encodeURIComponent(q));
  return extractSearch(html);
}

async function homeSite() {
  return extractCards(await get(BASE + '/'));
}

builder.defineCatalogHandler(async args => {
  if (args.type !== 'series' || args.id !== 'yanhh3d') return { metas: [] };
  try {
    const q = args.extra && args.extra.search ? String(args.extra.search).trim() : '';
    let items = q ? await searchSite(q) : await homeSite();
    const skip = Number(args.extra && args.extra.skip) || 0;
    items = items.slice(skip, skip + 100);
    return {
      metas: items.map(x => ({
        id: 'yanhh3d:' + slugify((x.url.match(/\/([^/]+)\/?$/) || [])[1] || x.title),
        type: 'series',
        name: clean(x.title),
        poster: x.poster || undefined,
        posterShape: 'poster'
      })),
      cacheMaxAge: q ? 60 : 300
    };
  } catch (e) {
    console.error('[YanHH3D catalog]', e.message);
    return { metas: [] };
  }
});

builder.defineMetaHandler(async args => {
  if (args.type !== 'series' || !String(args.id).startsWith('yanhh3d:')) return { meta: null };
  const url = detailUrlForId(args.id);
  try {
    const html = await get(url);
    const title = parseTitle(html, String(args.id).replace(/^yanhh3d:/, '').replace(/-/g, ' '));
    const episodes = parseEpisodeLinks(html, url);
    const videos = episodes.map(x => ({
      id: args.id + ':1:' + x.episode,
      title: 'Tập ' + x.episode,
      season: 1,
      episode: x.episode
    }));
    return {
      meta: {
        id: args.id,
        type: 'series',
        name: title,
        poster: parsePoster(html) || undefined,
        description: clean((html.match(/<meta\b[^>]*name=["']description["'][^>]*>/i) || [])[0] || ''),
        videos
      },
      cacheMaxAge: 120
    };
  } catch (e) {
    console.error('[YanHH3D meta]', e.message, url);
    return { meta: null };
  }
});

function episodeUrlFromId(id) {
  const m = String(id).match(/^yanhh3d:([^:]+):1:(\d+)$/);
  if (!m) return null;
  return BASE + '/sever2/' + m[1] + '/tap-' + m[2];
}

function extractIframes(html) {
  const out = [];
  const re = /<iframe\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const src = attr(m[0], 'src');
    if (src) {
      const u = abs(src);
      if (u && !out.includes(u) && !/youtube|facebook\.com|doubleclick|ads|analytics/i.test(u)) out.push(u);
    }
  }
  return out;
}

function mediaUrls(html, base) {
  const out = [];
  const re = /(?:https?:)?\/\/[^\s"'<>\\]+\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?/gi;
  let m;
  while ((m = re.exec(html))) out.push(abs(m[0], base));
  const srcRe = /<(?:source|video)\b[^>]*>/gi;
  while ((m = srcRe.exec(html))) {
    const s = attr(m[0], 'src');
    if (s && /\.(?:m3u8|mp4)(?:\?|$)/i.test(s)) out.push(abs(s, base));
  }
  return [...new Set(out.filter(Boolean))];
}

builder.defineStreamHandler(async args => {
  if (args.type !== 'series' || !String(args.id).startsWith('yanhh3d:')) return { streams: [] };
  const epUrl = episodeUrlFromId(args.id);
  if (!epUrl) return { streams: [] };
  try {
    const epHtml = await get(epUrl);
    const iframes = extractIframes(epHtml);
    const streams = [];
    for (const frame of iframes.slice(0, 5)) {
      if (/\.(m3u8|mp4)(?:\?|$)/i.test(frame)) {
        streams.push({ name: 'YanHH3D', title: 'YanHH3D', url: frame, behaviorHints: { notWebReady: false }, headers: { Referer: epUrl } });
        continue;
      }
      try {
        const playerHtml = await get(frame);
        const media = mediaUrls(playerHtml, frame);
        for (const u of media) streams.push({
          name: 'YanHH3D',
          title: /4k|2160/i.test(u) ? 'YanHH3D 4K' : /1080/i.test(u) ? 'YanHH3D 1080p' : 'YanHH3D',
          url: u,
          headers: { Referer: frame }
        });
      } catch (_) {}
    }
    const unique = [];
    const seen = new Set();
    for (const s of streams) if (!seen.has(s.url)) { seen.add(s.url); unique.push(s); }
    return { streams: unique, cacheMaxAge: 30 };
  } catch (e) {
    console.error('[YanHH3D stream]', e.message, epUrl);
    return { streams: [] };
  }
});

module.exports = builder.getInterface();
