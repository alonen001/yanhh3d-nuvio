const DISCOVERY_URL = 'https://bit.ly/hh3d';
const FALLBACK_ORIGIN = 'https://hoathinh3d.pw';
const ORIGIN_MIRRORS = ['https://hoathinh3d.pw', 'https://hoathinh3d.de', 'https://hoathinh3d.you'];
const BUILD_VERSION = '2026-11-17-hhtq1';
const HHTQ_ORIGIN = 'https://hhhtq.team';
const ORIGIN_TTL_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30_000;
const INITIAL_SEGMENTS_TO_PREWARM = 4;
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36';
const PROXIED_SEGMENT_HOSTS = new Set(['m.ckjdsib32rkjvsd.xyz']);
const EMBED_SEGMENT_HOST = /^scontent-[a-z0-9-]+\.xx\.cdnfb\.net$/i;
const YAN_PLAYER_HOSTS = new Set(['rptcdn.site', 'streamrpt.xyz', 'streamrpt1.site']);
const YAN_SITE_ORIGIN = 'https://yanhh3d.chat';
const YAN_SEGMENT_HOSTS = new Set(['m.defifa.com']);
const YAN_TIKTOK_SEGMENT_HOST = /^p\d{1,3}-ad-site-sign-sg\.tiktokcdn\.com$/i;

let originCache = { value: FALLBACK_ORIGIN, expiresAt: Date.now() + 10 * 60 * 1000 };
const postIdCache = new Map();
const segmentInflight = new Map();

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range',
    ...extra,
  };
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders({ 'Content-Type': 'application/json; charset=utf-8', ...headers }),
  });
}

async function cachedResponse(request) {
  if (typeof caches === 'undefined') return null;
  return caches.default.match(request);
}

async function storeResponse(request, response) {
  if (typeof caches !== 'undefined') await caches.default.put(request, response.clone());
  return response;
}

async function timedFetch(url, init = {}, timeout = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), timeout);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: init.redirect || 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

function siteHeaders(origin, extra = {}) {
  return {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
    'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    Referer: `${origin}/`,
    'Cache-Control': 'no-cache',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    ...extra,
  };
}

function decodeHtml(value) {
  return String(value || '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function cleanHtml(value) {
  return decodeHtml(String(value || '').replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function attribute(tag, name) {
  const match = String(tag || '').match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match ? decodeHtml(match[1]) : null;
}

function absoluteUrl(value, origin) {
  if (!value) return null;
  try { return new URL(decodeHtml(value), origin).href; } catch (_) { return null; }
}

async function fetchSitePath(path, timeout = REQUEST_TIMEOUT_MS) {
  let lastError;
  for (const force of [false, true]) {
    for (const origin of await originCandidates(force)) {
      try {
        const response = await timedFetch(new URL(path, origin), { headers: siteHeaders(origin) }, timeout);
        if (!response.ok) throw new Error(`HH3D page HTTP ${response.status}`);
        const html = await response.text();
        if (!/(?:halim-item|halim-episode|info-hero)/i.test(html)) throw new Error('HH3D page không hợp lệ');
        const finalOrigin = new URL(response.url).origin;
        originCache = { value: finalOrigin, expiresAt: Date.now() + ORIGIN_TTL_MS };
        return { html, origin: finalOrigin };
      } catch (error) {
        lastError = error;
        originCache.expiresAt = 0;
      }
    }
  }
  throw lastError || new Error('Không tải được trang HH3D');
}

function parseCatalogCards(html, origin) {
  const items = [], seen = new Set();
  for (const match of String(html || '').matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/gi)) {
    const anchor = match[0].match(/<a\b(?=[^>]*class=["'][^"']*\bhalim-thumb\b)[^>]*>/i);
    const image = match[0].match(/<img\b[^>]*>/i);
    if (!anchor) continue;
    const url = absoluteUrl(attribute(anchor[0], 'href'), origin);
    let slug = '';
    try {
      const parts = new URL(url).pathname.split('/').filter(Boolean);
      if (parts.length === 1 && !/^(?:page|category|tag|search)$/i.test(parts[0])) slug = parts[0];
    } catch (_) {}
    if (!slug || seen.has(slug)) continue;
    const title = cleanHtml(attribute(anchor[0], 'title') || attribute(image?.[0], 'alt'));
    if (!title) continue;
    const poster = absoluteUrl(attribute(image?.[0], 'data-src') || attribute(image?.[0], 'data-original')
      || attribute(image?.[0], 'data-lazy-src') || attribute(image?.[0], 'src'), origin);
    seen.add(slug);
    items.push({ slug, title, poster });
  }
  return items;
}

async function catalogData(search, skip) {
  const page = Math.floor(Math.max(0, skip) / 40) + 1;
  const paths = search ? [`/?s=${encodeURIComponent(search)}`]
    : [page === 1 ? '/' : `/page/${page}/`, `/page/${page + 1}/`];
  const results = await Promise.allSettled(paths.map(path => fetchSitePath(path, 25_000)));
  const items = [], seen = new Set();
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const item of parseCatalogCards(result.value.html, result.value.origin)) {
      if (seen.has(item.slug)) continue;
      seen.add(item.slug);
      items.push(item);
    }
  }
  if (!items.length && results.every(result => result.status === 'rejected')) {
    throw results.find(result => result.status === 'rejected')?.reason || new Error('Không tải được danh mục HH3D');
  }
  return items;
}

function metaDescription(html) {
  for (const pattern of [/<meta\b[^>]*name=["']description["'][^>]*>/i, /<meta\b[^>]*property=["']og:description["'][^>]*>/i]) {
    const value = cleanHtml(attribute(String(html || '').match(pattern)?.[0], 'content'));
    if (value) return value;
  }
  return 'HH3D • Hoạt hình 3D';
}

async function metaData(slugValue) {
  const slug = validateSlug(slugValue);
  const { html, origin } = await fetchSitePath(`/${slug}/`, 30_000);
  const titleTag = html.match(/<h1\b[^>]*class=["'][^"']*\binfo-hero__title\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i);
  const posterBlock = html.match(/<div\b[^>]*class=["'][^"']*\binfo-hero__poster\b[^"']*["'][^>]*>[\s\S]*?<\/div>/i)?.[0];
  const image = posterBlock?.match(/<img\b[^>]*>/i)?.[0];
  const poster = absoluteUrl(attribute(image, 'data-accent-src') || attribute(image, 'src'), origin);
  const episodes = new Set();
  for (const match of html.matchAll(/\/tap-(\d+)(?:-sv\d+)?\.html/gi)) episodes.add(Number(match[1]));
  for (const match of html.matchAll(/data-episode-slug=["']tap-(\d+)["']/gi)) episodes.add(Number(match[1]));
  return { slug, title: cleanHtml(titleTag?.[1]) || slug.replace(/-/g, ' '), poster,
    description: metaDescription(html), episodes: [...episodes].filter(Boolean).sort((a, b) => a - b) };
}

async function discoverOrigin(force = false) {
  if (!force && Date.now() < originCache.expiresAt) return originCache.value;
  try {
    const response = await timedFetch(DISCOVERY_URL, {
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
    }, 15_000);
    const origin = new URL(response.url).origin;
    if (/^https:\/\//i.test(origin)) {
      originCache = { value: origin, expiresAt: Date.now() + ORIGIN_TTL_MS };
      return origin;
    }
  } catch (_) {
    // The fallback is intentionally kept when the short-link service is unavailable.
  }
  originCache = { value: FALLBACK_ORIGIN, expiresAt: Date.now() + 10 * 60 * 1000 };
  return FALLBACK_ORIGIN;
}

async function originCandidates(force = false) {
  const discovered = await discoverOrigin(force);
  const candidates = [discovered];
  for (const mirror of ORIGIN_MIRRORS) {
    if (!candidates.includes(mirror)) candidates.push(mirror);
  }
  return candidates;
}

function validateSlug(value) {
  const slug = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,159}$/.test(slug)) throw new Error('Invalid slug');
  return slug;
}

function validateEpisode(value) {
  const episode = Number(value);
  if (!Number.isInteger(episode) || episode < 1 || episode > 100_000) throw new Error('Invalid episode');
  return episode;
}

function validateHhtqId(value) {
  const id = String(value || '').trim();
  if (!/^\d{1,6}$/.test(id)) throw new Error('Invalid HHTQ id');
  return id;
}

function hhtqHeaders(referer) {
  return {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    Referer: referer || `${HHTQ_ORIGIN}/`,
    'Cache-Control': 'no-cache',
  };
}

async function fetchHhtqPage(path, timeout = REQUEST_TIMEOUT_MS) {
  const response = await timedFetch(new URL(path, HHTQ_ORIGIN), { headers: hhtqHeaders() }, timeout);
  if (!response.ok) throw new Error(`HHTQ page HTTP ${response.status}`);
  return response.text();
}

function parseHhtqCatalog(html) {
  // Only the "Mới Cập Nhật" module: slice from its heading to the next module heading.
  let section = String(html || '');
  const start = section.indexOf('Mới Cập Nhật');
  if (start >= 0) {
    const next = section.indexOf('module-title', start + 12);
    section = next > start ? section.slice(start, next) : section.slice(start);
  }
  const items = [], seen = new Set();
  for (const match of section.matchAll(/<a\b[^>]*href=["']\/xem\/(\d+)-sv\d+-ep\d+\/["'][^>]*title=["']([^"']+)["'][^>]*>/gi)) {
    const id = match[1];
    if (seen.has(id)) continue;
    const after = section.slice(match.index, match.index + 1200);
    const poster = after.match(/<img\b[^>]*data-src=["']([^"']+)["']/i)?.[1]
      || after.match(/<img\b[^>]*src=["']([^"']+)["']/i)?.[1];
    const title = cleanHtml(match[2]);
    if (!title) continue;
    seen.add(id);
    items.push({ id, title, poster: poster ? decodeHtml(poster) : null });
  }
  return items;
}

async function hhtqCatalogData(skip) {
  const html = await fetchHhtqPage('/', 25_000);
  const items = parseHhtqCatalog(html);
  if (!items.length) throw new Error('Không tải được danh mục HHTQ');
  const from = Math.max(0, skip || 0);
  return items.slice(from, from + 80);
}

function hhtqSeriesTitle(html, fallback) {
  const h1 = String(html || '').match(/<h1\b[^>]*class=["'][^"']*page-title[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*title=["']([^"']+)["']/i);
  if (h1?.[1]) return cleanHtml(h1[1]);
  const og = String(html || '').match(/<meta\b[^>]*property=["']og:title["'][^>]*>/i);
  const ogTitle = cleanHtml(attribute(og?.[0], 'content') || '');
  const stripped = ogTitle.replace(/^Tập\s+\d+\s+/i, '').replace(/\s+Server\s+\d+.*$/i, '').trim();
  return stripped || fallback;
}

async function hhtqMetaData(idValue) {
  const id = validateHhtqId(idValue);
  const html = await fetchHhtqPage(`/xem/${id}-sv1-ep1/`, 30_000);
  const posterTag = String(html || '').match(/<meta\b[^>]*property=["']og:image["'][^>]*>/i);
  const poster = absoluteUrl(attribute(posterTag?.[0], 'content'), HHTQ_ORIGIN);
  const episodes = new Set();
  for (const match of html.matchAll(new RegExp(`/xem/${id}-sv\\d+-ep(\\d+)/`, 'g'))) episodes.add(Number(match[1]));
  const description = metaDescription(html);
  return { id, title: hhtqSeriesTitle(html, `HHTQ ${id}`), poster,
    description: description === 'HH3D • Hoạt hình 3D' ? 'HHTQ • Hoạt hình Trung Quốc' : description,
    episodes: [...episodes].filter(Boolean).sort((a, b) => a - b) };
}

function hhtqPlayerUrl(html) {
  const match = String(html || '').match(/player_aaaa\s*=\s*(\{[\s\S]*?\})\s*<\/script>/i)
    || String(html || '').match(/player_aaaa\s*=\s*(\{[^<]*\})/i);
  if (!match) return null;
  try {
    const data = JSON.parse(match[1].replace(/\\\//g, '/'));
    return typeof data.url === 'string' ? data.url.trim() : null;
  } catch (_) { return null; }
}

function okruEmbedId(url) {
  const match = String(url || '').match(/ok\.ru\/videoembed\/(\d+)/i);
  return match?.[1] || null;
}

function okruHlsUrl(embedHtml) {
  const decoded = decodeHtml(String(embedHtml || ''));
  const match = decoded.match(/"ondemandHls"\s*:\s*"([^"]+)"/i);
  if (!match) return null;
  return match[1].replace(/\\\//g, '/');
}

function pickHhtqVariant(masterPlaylist, masterUrl) {
  const variants = [];
  const lines = String(masterPlaylist || '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const info = lines[index].match(/#EXT-X-STREAM-INF:[^\n]*BANDWIDTH=(\d+)/i);
    if (!info) continue;
    const uri = (lines[index + 1] || '').trim();
    if (!uri || uri.startsWith('#')) continue;
    variants.push({ bandwidth: Number(info[1]), uri });
  }
  if (!variants.length) return null;
  variants.sort((a, b) => b.bandwidth - a.bandwidth);
  return new URL(variants[0].uri, masterUrl).href;
}

function rewriteHhtqPlaylist(text, playlistUrl, resolverOrigin = '') {
  const prefix = resolverOrigin ? `${resolverOrigin}/hhtq/segment?url=` : '/hhtq/segment?url=';
  return String(text).split(/\r?\n/).map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith('#')) {
      return line.replace(/URI="([^"]+)"/g, (_, value) => `URI="${prefix}${encodeURIComponent(new URL(value, playlistUrl).href)}"`);
    }
    return `${prefix}${encodeURIComponent(new URL(trimmed, playlistUrl).href)}`;
  }).join('\n');
}

async function fetchHhtqPlaylist(url, referer) {
  const response = await timedFetch(url, {
    headers: { 'User-Agent': UA, Referer: referer, Accept: 'application/vnd.apple.mpegurl,*/*' },
  }, 30_000);
  if (!response.ok) throw new Error(`HHTQ playlist HTTP ${response.status}`);
  const text = await response.text();
  if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('HHTQ playlist is not HLS');
  return text;
}

async function resolveHhtqVariant(masterUrl, referer, resolverOrigin) {
  const master = await fetchHhtqPlaylist(masterUrl, referer);
  const variantUrl = pickHhtqVariant(master, masterUrl);
  if (!variantUrl) throw new Error('HHTQ không có chất lượng phát');
  let playlist = await fetchHhtqPlaylist(variantUrl, referer);
  // A variant entry can itself be another master playlist; descend once.
  if (/#EXT-X-STREAM-INF/i.test(playlist)) {
    const nested = pickHhtqVariant(playlist, variantUrl);
    if (!nested) throw new Error('HHTQ không có chất lượng phát');
    playlist = await fetchHhtqPlaylist(nested, referer);
    return rewriteHhtqPlaylist(playlist, nested, resolverOrigin);
  }
  return rewriteHhtqPlaylist(playlist, variantUrl, resolverOrigin);
}

async function resolveOkruPlaylist(id, episode, resolverOrigin) {
  const episodePage = await fetchHhtqPage(`/xem/${id}-sv3-ep${episode}/`, 25_000);
  const playerUrl = hhtqPlayerUrl(episodePage);
  const embedId = okruEmbedId(playerUrl);
  if (!embedId) throw new Error('HHTQ server 3 không có link phát');
  const embedResponse = await timedFetch(`https://ok.ru/videoembed/${embedId}`, {
    headers: { 'User-Agent': UA, Referer: `${HHTQ_ORIGIN}/xem/${id}-sv3-ep${episode}/`, Accept: 'text/html,*/*' },
  }, 25_000);
  if (!embedResponse.ok) throw new Error(`HHTQ embed HTTP ${embedResponse.status}`);
  const hlsUrl = okruHlsUrl(await embedResponse.text());
  if (!hlsUrl) throw new Error('HHTQ không tìm thấy link phát');
  const playlist = await resolveHhtqVariant(hlsUrl, 'https://ok.ru/', resolverOrigin);
  return { playlist, label: '1080' };
}

async function resolveDailymotionPlaylist(id, episode, resolverOrigin) {
  const episodePage = await fetchHhtqPage(`/xem/${id}-sv1-ep${episode}/`, 25_000);
  const playerUrl = hhtqPlayerUrl(episodePage);
  const videoId = (String(playerUrl || '').match(/[?&]video=([A-Za-z0-9]+)/i) || [])[1];
  if (!videoId) throw new Error('HHTQ server 1 không có link phát');
  const metaResponse = await timedFetch(`https://www.dailymotion.com/player/metadata/video/${videoId}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json, */*' },
  }, 25_000);
  if (!metaResponse.ok) throw new Error(`HHTQ Dailymotion HTTP ${metaResponse.status}`);
  const meta = await metaResponse.json();
  const masterUrl = meta?.qualities?.auto?.[0]?.url;
  if (!masterUrl) throw new Error('HHTQ Dailymotion không có link phát');
  const playlist = await resolveHhtqVariant(masterUrl, 'https://geo.dailymotion.com/', resolverOrigin);
  return { playlist, label: '1080' };
}

export async function resolveHhtqPlaylist(idValue, episodeValue, resolverOrigin = '') {
  const id = validateHhtqId(idValue);
  const episode = validateEpisode(episodeValue);
  let lastError;
  for (const attempt of [resolveOkruPlaylist, resolveDailymotionPlaylist]) {
    try {
      const result = await attempt(id, episode, resolverOrigin);
      return { ...result, origin: HHTQ_ORIGIN };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Không lấy được nguồn HHTQ');
}

function validateHhtqSegmentUrl(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:' || url.pathname.length > 600) throw new Error('HHTQ segment host is not allowed');
  const host = url.hostname.toLowerCase();
  const isOkcdn = /^vd\d+\.okcdn\.ru$/i.test(host) && url.pathname.startsWith('/expires/');
  const isDailymotion = host === 'cdndirector.dailymotion.com' || host.endsWith('.dailymotion.com')
    || host.endsWith('.dmcdn.net') || host === 'vod-progressive.akamaized.net';
  if (!isOkcdn && !isDailymotion) throw new Error('HHTQ segment host is not allowed');
  if (!/\.(ts|m3u8|mp4)([?#]|$)/i.test(url.pathname) && !url.pathname.endsWith('.ts')) {
    throw new Error('Invalid HHTQ segment path');
  }
  return url;
}

async function proxyHhtqSegment(request) {
  const cacheKey = new Request(request.url, { method: 'GET' });
  const cached = await cachedResponse(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set('X-HHTQ-Segment-Cache', 'HIT');
    return new Response(cached.body, { status: cached.status, headers });
  }
  const target = validateHhtqSegmentUrl(new URL(request.url).searchParams.get('url'));
  const isOkcdn = /\.okcdn\.ru$/i.test(target.hostname);
  const response = await timedFetch(target, {
    headers: {
      'User-Agent': UA,
      Referer: isOkcdn ? 'https://ok.ru/' : 'https://geo.dailymotion.com/',
      Accept: '*/*',
    },
  });
  if (!response.ok) throw new Error(`HHTQ segment HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  const buffer = new Uint8Array(await response.arrayBuffer());
  const head = new TextDecoder().decode(buffer.slice(0, 16));
  if (head.startsWith('#EXTM3U') || /mpegurl/i.test(contentType)) {
    // Nested playlist: rewrite its entries through this proxy and return it.
    const rewritten = rewriteHhtqPlaylist(new TextDecoder().decode(buffer), target.href, new URL(request.url).origin);
    return new Response(rewritten, { status: 200, headers: corsHeaders({
      'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store',
    }) });
  }
  let transportOffset = -1;
  const scanLimit = Math.min(buffer.length - 376, 4096);
  for (let index = 0; index < scanLimit; index += 1) {
    if (buffer[index] === 0x47 && buffer[index + 188] === 0x47 && buffer[index + 376] === 0x47) {
      transportOffset = index;
      break;
    }
  }
  if (transportOffset < 0) throw new Error('HHTQ segment is not MPEG-TS');
  const body = buffer.slice(transportOffset);
  return storeResponse(cacheKey, new Response(body, { status: 200, headers: corsHeaders({
    'Content-Type': 'video/mp2t',
    'Cache-Control': 'public, max-age=86400',
    'Content-Length': String(body.byteLength),
    'X-HHTQ-Segment-Cache': 'MISS',
  }) }));
}

function postIdFromHeaders(headers) {
  const link = headers.get('link') || '';
  return link.match(/\/wp-json\/wp\/v2\/posts\/(\d+)/i)?.[1]
    || link.match(/[?&]p=(\d+)/i)?.[1]
    || null;
}

function postIdFromHtml(html) {
  return String(html || '').match(/\bpostid-(\d+)\b/i)?.[1]
    || String(html || '').match(/\bpost_id["']?\s*[:=]\s*["']?(\d+)/i)?.[1]
    || String(html || '').match(/\/wp-json\/wp\/v2\/posts\/(\d+)/i)?.[1]
    || null;
}

async function findPostId(origin, slug) {
  const cached = postIdCache.get(slug);
  if (cached) return cached;
  const detailUrl = `${origin}/${slug}/`;
  for (const url of [detailUrl, `${origin}/${slug}/embed/`]) {
    const response = await timedFetch(url, { headers: siteHeaders(origin) });
    if (!response.ok) continue;
    const id = postIdFromHeaders(response.headers) || postIdFromHtml(await response.text());
    if (id) {
      postIdCache.set(slug, id);
      return id;
    }
  }
  throw new Error(`Không tìm thấy mã phim HH3D cho ${slug}`);
}

function randomClientId() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
}

function splitSetCookie(value) {
  if (!value) return [];
  return value.split(/,(?=\s*[^;,=\s]+\s*=)/g).map(item => item.trim()).filter(Boolean);
}

function cookieHeader(headers) {
  const setCookies = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : splitSetCookie(headers.get('set-cookie'));
  return setCookies
    .map(item => item.split(';', 1)[0])
    .filter(item => item.includes('='))
    .join('; ');
}

function base64UrlBytes(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function decryptPlayerPayload(encrypted, keyText) {
  const key = await crypto.subtle.importKey(
    'raw',
    base64UrlBytes(keyText),
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlBytes(encrypted.iv), tagLength: 128 },
    key,
    base64UrlBytes(encrypted.payload),
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

async function getPlayerData(origin, slug, episode, postId) {
  // VIP 1 (server 1) currently returns "data not found" and does not play
  // even in a real browser; VIP 2 plays there. Try server 1 first (current
  // behaviour), then fall back to server 2. Referer uses the site's current
  // episode URL format (/xem-phim-{slug}/tap-{ep}-sv{N}.html) — the old
  // /{slug}/tap-{ep}/ URL is now a 404 page.
  let lastError;
  for (const serverId of [1, 2]) {
    const clientId = randomClientId();
    const referer = `${origin}/xem-phim-${slug}/tap-${episode}-sv${serverId}.html`;
    try {
      const playerUrl = new URL('/wp-content/themes/halimmovies/player.php', origin);
      playerUrl.searchParams.set('episode_slug', `tap-${episode}`);
      playerUrl.searchParams.set('server_id', String(serverId));
      playerUrl.searchParams.set('subsv_id', '');
      playerUrl.searchParams.set('post_id', postId);

      const playerResponse = await timedFetch(playerUrl, {
        headers: siteHeaders(origin, {
          'X-Requested-With': 'XMLHttpRequest',
          'X-Halim-Client': clientId,
          Referer: referer,
        }),
      });
      if (!playerResponse.ok) throw new Error(`HH3D player HTTP ${playerResponse.status}`);
      const encrypted = await playerResponse.json();
      if (!encrypted?._encrypted || !encrypted.kid || !encrypted.iv || !encrypted.payload) {
        throw new Error('HH3D player trả dữ liệu không hợp lệ');
      }

      const cookies = cookieHeader(playerResponse.headers);
      const keyResponse = await timedFetch(new URL('/wp-json/halim/v1/player-key', origin), {
        method: 'POST',
        headers: siteHeaders(origin, {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-Halim-Client': clientId,
          Cookie: cookies,
          Origin: origin,
          Referer: referer,
        }),
        body: JSON.stringify({ key_id: encrypted.kid }),
      });
      if (!keyResponse.ok) throw new Error(`HH3D key HTTP ${keyResponse.status}`);
      const keyData = await keyResponse.json();
      if (!keyData?.success || !keyData.key) throw new Error('HH3D không cấp khóa giải mã');
      return decryptPlayerPayload(encrypted, keyData.key);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('HH3D player không khả dụng');
}

function allowedPlaylistUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (
      url.hostname === 'scontent.ibytedance.net'
      || url.hostname.endsWith('.ibytedance.net')
      || url.hostname.endsWith('.bytecdn.cn')
    );
  } catch (_) {
    return false;
  }
}

function validateEmbedUrl(value) {
  const url = new URL(String(value || ''));
  const legacyEmbedPath = /^\/p\/f2_[a-z0-9]+_[a-z0-9._-]{1,160}\/embed$/i.test(url.pathname);
  const uuidEmbedPath = /^\/p\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.[a-z0-9]{3,12}\/embed$/i
    .test(url.pathname);
  if (!allowedPlaylistUrl(url.href)
    || (!legacyEmbedPath && !uuidEmbedPath)) {
    throw new Error('HH3D embed URL is not allowed');
  }
  return url;
}

function decodeEmbedConfig(payload, mask) {
  const encrypted = base64UrlBytes(payload);
  const key = base64UrlBytes([...String(mask || '')].reverse().join(''));
  if (!encrypted.length || !key.length) throw new Error('HH3D embed data is invalid');
  const plain = new Uint8Array(encrypted.length);
  for (let index = 0; index < encrypted.length; index += 1) {
    plain[index] = encrypted[index] ^ key[index % key.length];
  }
  try {
    return JSON.parse(new TextDecoder().decode(plain));
  } catch (_) {
    throw new Error('HH3D embed config is invalid');
  }
}

function validateEmbedStreamUrl(value, embedUrl) {
  const url = new URL(String(value || ''), embedUrl);
  const basePath = embedUrl.pathname.replace(/\/embed$/, '');
  if (url.protocol !== 'https:' || url.origin !== embedUrl.origin
    || url.pathname !== `${basePath}/stream`
    || !/^[a-f0-9]{12,64}\.\d{8,12}$/i.test(url.searchParams.get('t') || '')) {
    throw new Error('HH3D embed stream URL is not allowed');
  }
  return url;
}

async function resolveEmbedPlaylist(value, origin, resolverOrigin) {
  const embedUrl = validateEmbedUrl(value);
  const embedResponse = await timedFetch(embedUrl, {
    headers: { 'User-Agent': UA, Referer: `${origin}/`, Accept: 'text/html,*/*' },
  });
  if (!embedResponse.ok) throw new Error(`HH3D embed HTTP ${embedResponse.status}`);
  const html = await embedResponse.text();
  const playerTag = html.match(/<div\b(?=[^>]*\bid=["']player["'])[^>]*>/i)?.[0];
  const payload = attribute(playerTag, 'data-p');
  const mask = attribute(playerTag, 'data-m');
  if (!payload || !mask) throw new Error('HH3D embed data not found');
  const config = decodeEmbedConfig(payload, mask);
  const streamUrl = validateEmbedStreamUrl(config?.s, embedUrl);
  const playlistResponse = await timedFetch(streamUrl, {
    headers: {
      'User-Agent': UA,
      Referer: embedUrl.href,
      Origin: embedUrl.origin,
      Accept: 'application/vnd.apple.mpegurl,*/*',
    },
  });
  if (!playlistResponse.ok) throw new Error(`HH3D embed playlist HTTP ${playlistResponse.status}`);
  const playlist = absolutizePlaylist(await playlistResponse.text(), streamUrl, resolverOrigin);
  if (!playlist.trimStart().startsWith('#EXTM3U')) throw new Error('HH3D embed data is not HLS');
  return playlist;
}

function isProxiedSegmentHost(hostname) {
  return PROXIED_SEGMENT_HOSTS.has(hostname) || EMBED_SEGMENT_HOST.test(hostname);
}

function playableMediaUrl(value, playlistUrl, resolverOrigin) {
  const absolute = new URL(value, playlistUrl);
  if (resolverOrigin && isProxiedSegmentHost(absolute.hostname)) {
    return `${resolverOrigin}/segment?url=${encodeURIComponent(absolute.href)}`;
  }
  return absolute.href;
}

function absolutizePlaylist(text, playlistUrl, resolverOrigin = '') {
  return String(text).split(/\r?\n/).map(line => {
    if (!line || line.startsWith('#')) {
      return line.replace(/URI="([^"]+)"/g, (_, value) => `URI="${playableMediaUrl(value, playlistUrl, resolverOrigin)}"`);
    }
    return playableMediaUrl(line, playlistUrl, resolverOrigin);
  }).join('\n');
}

function validateSegmentUrl(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:' || !isProxiedSegmentHost(url.hostname)) {
    throw new Error('Segment host is not allowed');
  }
  const oldPath = /^\/f2_[a-z0-9_-]{1,160}_\d{1,12}\/[a-z0-9_-]{1,160}\.png$/i.test(url.pathname);
  const embedPath = EMBED_SEGMENT_HOST.test(url.hostname)
    && (/^\/f2_[a-z0-9._-]{1,200}\/[a-z0-9_-]{1,160}\.png$/i.test(url.pathname)
      || /^\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/[a-z0-9_-]{1,160}\.png$/i
        .test(url.pathname));
  if (url.pathname.length > 400 || (!oldPath && !embedPath)) {
    throw new Error('Invalid segment path');
  }
  return url;
}

async function proxySegment(request, origin) {
  const cacheKey = new Request(request.url, { method: 'GET' });
  const cached = await cachedResponse(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set('X-HH3D-Segment-Cache', 'HIT');
    return new Response(cached.body, { status: cached.status, headers });
  }
  const inflightKey = cacheKey.url;
  let pending = segmentInflight.get(inflightKey);
  if (!pending) {
    pending = (async () => {
      const target = validateSegmentUrl(new URL(request.url).searchParams.get('url'));
      const headers = {
        'User-Agent': UA,
        Referer: EMBED_SEGMENT_HOST.test(target.hostname) ? 'https://scontent.ibytedance.net/' : `${origin}/`,
        Accept: '*/*',
      };
      if (EMBED_SEGMENT_HOST.test(target.hostname)) headers.Origin = 'https://scontent.ibytedance.net';
      const response = await timedFetch(target, { headers });
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok || /text\/html/i.test(contentType)) {
        throw new Error(`HH3D segment HTTP ${response.status}`);
      }
      const source = new Uint8Array(await response.arrayBuffer());
      let transportOffset = -1;
      const scanLimit = Math.min(source.length - 376, 4096);
      for (let index = 0; index < scanLimit; index += 1) {
        if (source[index] === 0x47 && source[index + 188] === 0x47 && source[index + 376] === 0x47) {
          transportOffset = index;
          break;
        }
      }
      if (transportOffset < 0) throw new Error('HH3D segment is not MPEG-TS');
      const body = source.slice(transportOffset);
      const responseHeaders = corsHeaders({
        'Content-Type': 'video/mp2t',
        'Cache-Control': 'public, max-age=86400',
        'Content-Length': String(body.byteLength),
        'X-HH3D-Segment-Cache': 'MISS',
      });
      return storeResponse(cacheKey, new Response(body, { status: 200, headers: responseHeaders }));
    })();
    segmentInflight.set(inflightKey, pending);
    pending.finally(() => {
      if (segmentInflight.get(inflightKey) === pending) segmentInflight.delete(inflightKey);
    }).catch(() => {});
  }
  return (await pending).clone();
}

function initialSegmentUrls(playlist, resolverOrigin) {
  const prefix = `${resolverOrigin}/segment?`;
  return String(playlist).split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith(prefix))
    .slice(0, INITIAL_SEGMENTS_TO_PREWARM);
}

async function prewarmInitialSegments(playlist, resolverOrigin, origin) {
  const urls = initialSegmentUrls(playlist, resolverOrigin);
  await Promise.allSettled(urls.map(url => proxySegment(new Request(url), origin)));
}

function validateYanPlayerUrl(value) {
  const url = new URL(String(value || ''));
  const host = url.hostname.toLowerCase();
  const allowedHost = [...YAN_PLAYER_HOSTS].some(domain => host === domain || host.endsWith(`.${domain}`));
  if (url.protocol !== 'https:' || !allowedHost) {
    throw new Error('YanHH3D player host is not allowed');
  }
  if (!/^\/o2\/v\/t2\/f2\/m\d{1,6}\/[a-f0-9-]{36}\.m3u8$/i.test(url.pathname)) {
    throw new Error('Invalid YanHH3D player path');
  }
  return url;
}

function validateYanPlaylistUrl(value, playerUrl) {
  const url = new URL(String(value || ''));
  if (url.origin !== playerUrl.origin || url.pathname !== `${playerUrl.pathname}/stream-plain`
    || !/^[a-f0-9]+\.\d+$/i.test(url.searchParams.get('t') || '')) {
    throw new Error('Invalid YanHH3D playlist URL');
  }
  return url;
}

function validateYanSegmentUrl(value) {
  const url = new URL(String(value || ''));
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:') {
    throw new Error('YanHH3D segment host is not allowed');
  }

  const isDefifaSegment = YAN_SEGMENT_HOSTS.has(host)
    && /^\/file\/[a-f0-9-]{36}\/[a-z0-9_-]{1,200}\.png$/i.test(url.pathname);
  const isTikTokSegment = YAN_TIKTOK_SEGMENT_HOST.test(host)
    && /^\/ad-site-i18n-sg\/[a-z0-9]+~tplv-d5opwmad15-ttam-origin\.image$/i.test(url.pathname)
    && /^\d{8,12}$/.test(url.searchParams.get('x-expires') || '')
    && (url.searchParams.get('x-signature') || '').length >= 20;

  if (url.pathname.length > 500 || (!isDefifaSegment && !isTikTokSegment)) {
    throw new Error('Invalid YanHH3D segment path');
  }
  return url;
}

async function resolveYanPlaylist(value, resolverOrigin) {
  const playerUrl = validateYanPlayerUrl(value);
  const playerResponse = await timedFetch(playerUrl, {
    headers: siteHeaders(YAN_SITE_ORIGIN),
  });
  if (!playerResponse.ok) throw new Error(`YanHH3D player HTTP ${playerResponse.status}`);
  const html = await playerResponse.text();
  const encoded = html.match(/\bdata-obf=["']([^"']+)["']/i)?.[1];
  if (!encoded) throw new Error('YanHH3D player data not found');
  let player;
  try { player = JSON.parse(atob(encoded)); } catch (_) { throw new Error('YanHH3D player data is invalid'); }
  const playlistUrl = validateYanPlaylistUrl(player?.pU, playerUrl);
  const playlistResponse = await timedFetch(playlistUrl, {
    headers: { 'User-Agent': UA, Referer: playerUrl.href, Origin: playerUrl.origin, Accept: '*/*' },
  });
  if (!playlistResponse.ok) throw new Error(`YanHH3D playlist HTTP ${playlistResponse.status}`);
  const playlist = (await playlistResponse.text()).split(/\r?\n/).map(line => {
    const value = line.trim();
    if (!value || value.startsWith('#')) return line;
    const segment = validateYanSegmentUrl(value);
    return `${resolverOrigin}/yan/segment?url=${encodeURIComponent(segment.href)}`;
  }).join('\n');
  if (!playlist.trimStart().startsWith('#EXTM3U')) throw new Error('YanHH3D playlist is not HLS');
  return playlist;
}

async function proxyYanSegment(request) {
  const target = validateYanSegmentUrl(new URL(request.url).searchParams.get('url'));
  const headers = { 'User-Agent': UA, Referer: `${YAN_SITE_ORIGIN}/`, Accept: '*/*' };
  const response = await timedFetch(target, { headers });
  if (!response.ok) throw new Error(`YanHH3D segment HTTP ${response.status}`);
  const source = new Uint8Array(await response.arrayBuffer());
  let transportOffset = -1;
  const scanLimit = Math.min(source.length - 376, 4096);
  for (let index = 0; index < scanLimit; index += 1) {
    if (source[index] === 0x47 && source[index + 188] === 0x47 && source[index + 376] === 0x47) {
      transportOffset = index;
      break;
    }
  }
  if (transportOffset < 0) throw new Error('YanHH3D segment is not MPEG-TS');
  const body = source.slice(transportOffset);
  return new Response(body, { status: 200, headers: corsHeaders({
    'Content-Type': 'video/mp2t',
    'Cache-Control': 'public, max-age=86400',
    'Content-Length': String(body.byteLength),
  }) });
}

export async function resolvePlaylist(slugValue, episodeValue, resolverOrigin = '') {
  const slug = validateSlug(slugValue);
  const episode = validateEpisode(episodeValue);
  let lastError;
  for (const force of [false, true]) {
    for (const origin of await originCandidates(force)) {
      try {
        const postId = await findPostId(origin, slug);
        const player = await getPlayerData(origin, slug, episode, postId);
        if (!player?.status) throw new Error('HH3D player không khả dụng');
        if (player.type === 'embed' && player.embed_url) {
          const playlist = await resolveEmbedPlaylist(player.embed_url, origin, resolverOrigin);
          return { playlist, origin, label: player.label || '1080', skipTime: player.skip_time || 0 };
        }
        if (player.type !== 'hls' || !allowedPlaylistUrl(player.file)) {
          throw new Error('HH3D không trả về nguồn phát hợp lệ');
        }
        const playlistResponse = await timedFetch(player.file, {
          headers: { 'User-Agent': UA, Referer: `${origin}/`, Accept: '*/*' },
        });
        if (!playlistResponse.ok) throw new Error(`HH3D playlist HTTP ${playlistResponse.status}`);
        const playlist = absolutizePlaylist(await playlistResponse.text(), player.file, resolverOrigin);
        if (!playlist.trimStart().startsWith('#EXTM3U')) throw new Error('Dữ liệu nhận được không phải HLS');
        return { playlist, origin, label: player.label || '1080', skipTime: player.skip_time || 0 };
      } catch (error) {
        lastError = error;
        originCache.expiresAt = 0;
      }
    }
  }
  throw lastError || new Error('Không lấy được nguồn HH3D');
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return json({ ok: true, service: 'hh3d-stream-resolver', version: BUILD_VERSION,
        origin: await discoverOrigin() }, 200, {
        'Cache-Control': 'no-store',
      });
    }
    if (url.pathname === '/catalog' && request.method === 'GET') {
      try {
        const cached = await cachedResponse(request);
        if (cached) return cached;
        const search = String(url.searchParams.get('search') || '').trim().slice(0, 120);
        const skip = Math.max(0, Number.parseInt(url.searchParams.get('skip') || '0', 10) || 0);
        const items = await catalogData(search, skip);
        const metas = items.map(item => ({ id: `hh3d:${item.slug}`, type: 'series', name: item.title,
          poster: item.poster || undefined, posterShape: 'poster' }));
        return storeResponse(request, json({ items, metas, cacheMaxAge: 3600 }, 200, {
          'Cache-Control': search ? 'public, max-age=900' : 'public, max-age=3600',
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return json({ error: message, items: [] }, 502, { 'Cache-Control': 'no-store' });
      }
    }
    if (url.pathname === '/meta' && request.method === 'GET') {
      try {
        const cached = await cachedResponse(request);
        if (cached) return cached;
        const data = await metaData(url.searchParams.get('slug'));
        const id = `hh3d:${data.slug}`;
        const videos = data.episodes.map(episode => ({ id: `${id}:1:${episode}`, title: `Tập ${episode}`,
          season: Math.floor((episode - 1) / 50) + 1, episode: (episode - 1) % 50 + 1 }));
        return storeResponse(request, json({ ...data, meta: { id, type: 'series', name: data.title, poster: data.poster || undefined,
          background: data.poster || undefined, description: data.description, videos } }, 200, {
          'Cache-Control': 'public, max-age=3600',
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return json({ error: message }, /Invalid/.test(message) ? 400 : 502, { 'Cache-Control': 'no-store' });
      }
    }
    if (request.method === 'HEAD' && url.pathname === '/resolve') {
      try {
        validateSlug(url.searchParams.get('slug'));
        validateEpisode(url.searchParams.get('ep'));
        return new Response(null, {
          status: 200,
          headers: corsHeaders({
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Cache-Control': 'no-store',
          }),
        });
      } catch (error) {
        return new Response(null, { status: 400, headers: corsHeaders({ 'Cache-Control': 'no-store' }) });
      }
    }
    if (request.method === 'HEAD' && url.pathname === '/segment') {
      try {
        validateSegmentUrl(url.searchParams.get('url'));
        return new Response(null, {
          status: 200,
          headers: corsHeaders({
            'Content-Type': 'video/mp2t',
            'Cache-Control': 'public, max-age=86400',
          }),
        });
      } catch (error) {
        return new Response(null, { status: 400, headers: corsHeaders({ 'Cache-Control': 'no-store' }) });
      }
    }
    if (url.pathname === '/segment' && request.method === 'GET') {
      try {
        return await proxySegment(request, await discoverOrigin());
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return json({ error: message }, /not allowed|Invalid/i.test(message) ? 400 : 502, {
          'Cache-Control': 'no-store',
        });
      }
    }
    if (url.pathname === '/yan/resolve' && request.method === 'GET') {
      try {
        const playlist = await resolveYanPlaylist(url.searchParams.get('url'), url.origin);
        return new Response(playlist, { status: 200, headers: corsHeaders({
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-store',
        }) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return json({ error: message }, /not allowed|Invalid/i.test(message) ? 400 : 502, {
          'Cache-Control': 'no-store',
        });
      }
    }
    if (url.pathname === '/yan/segment' && request.method === 'GET') {
      try {
        return await proxyYanSegment(request);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return json({ error: message }, /not allowed|Invalid/i.test(message) ? 400 : 502, {
          'Cache-Control': 'no-store',
        });
      }
    }
    if (url.pathname === '/hhtq/catalog' && request.method === 'GET') {
      try {
        const cached = await cachedResponse(request);
        if (cached) return cached;
        const skip = Math.max(0, Number.parseInt(url.searchParams.get('skip') || '0', 10) || 0);
        const items = await hhtqCatalogData(skip);
        const metas = items.map(item => ({ id: `hhtq:${item.id}`, type: 'series', name: item.title,
          poster: item.poster || undefined, posterShape: 'poster' }));
        return storeResponse(request, json({ items, metas, cacheMaxAge: 3600 }, 200, {
          'Cache-Control': 'public, max-age=3600',
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return json({ error: message, items: [] }, 502, { 'Cache-Control': 'no-store' });
      }
    }
    if (url.pathname === '/hhtq/meta' && request.method === 'GET') {
      try {
        const cached = await cachedResponse(request);
        if (cached) return cached;
        const data = await hhtqMetaData(url.searchParams.get('id'));
        const id = `hhtq:${data.id}`;
        const videos = data.episodes.map(episode => ({ id: `${id}:1:${episode}`, title: `Tập ${episode}`,
          season: Math.floor((episode - 1) / 50) + 1, episode: (episode - 1) % 50 + 1 }));
        return storeResponse(request, json({ ...data, meta: { id, type: 'series', name: data.title, poster: data.poster || undefined,
          background: data.poster || undefined, description: data.description, videos } }, 200, {
          'Cache-Control': 'public, max-age=3600',
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return json({ error: message }, /Invalid/.test(message) ? 400 : 502, { 'Cache-Control': 'no-store' });
      }
    }
    if (request.method === 'HEAD' && url.pathname === '/hhtq/resolve') {
      try {
        validateHhtqId(url.searchParams.get('id'));
        validateEpisode(url.searchParams.get('ep'));
        return new Response(null, {
          status: 200,
          headers: corsHeaders({
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Cache-Control': 'no-store',
          }),
        });
      } catch (error) {
        return new Response(null, { status: 400, headers: corsHeaders({ 'Cache-Control': 'no-store' }) });
      }
    }
    if (request.method === 'HEAD' && url.pathname === '/hhtq/segment') {
      try {
        validateHhtqSegmentUrl(url.searchParams.get('url'));
        return new Response(null, {
          status: 200,
          headers: corsHeaders({
            'Content-Type': 'video/mp2t',
            'Cache-Control': 'public, max-age=86400',
          }),
        });
      } catch (error) {
        return new Response(null, { status: 400, headers: corsHeaders({ 'Cache-Control': 'no-store' }) });
      }
    }
    if (url.pathname === '/hhtq/segment' && request.method === 'GET') {
      try {
        return await proxyHhtqSegment(request);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return json({ error: message }, /not allowed|Invalid/i.test(message) ? 400 : 502, {
          'Cache-Control': 'no-store',
        });
      }
    }
    if (url.pathname === '/hhtq/resolve' && request.method === 'GET') {
      try {
        const result = await resolveHhtqPlaylist(url.searchParams.get('id'), url.searchParams.get('ep'), url.origin);
        return new Response(result.playlist, {
          status: 200,
          headers: corsHeaders({
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Cache-Control': 'no-store',
            'X-HHTQ-Origin': result.origin,
            'X-HHTQ-Quality': result.label,
            'X-HHTQ-Version': BUILD_VERSION,
          }),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = /Invalid/.test(message) ? 400 : 502;
        return json({ error: message }, status, { 'Cache-Control': 'no-store' });
      }
    }
    if (url.pathname !== '/resolve' || request.method !== 'GET') {
      return json({ error: 'Not found' }, 404);
    }
    try {
      const result = await resolvePlaylist(url.searchParams.get('slug'), url.searchParams.get('ep'), url.origin);
      if (ctx?.waitUntil) {
        ctx.waitUntil(prewarmInitialSegments(result.playlist, url.origin, result.origin));
      }
      return new Response(result.playlist, {
        status: 200,
        headers: corsHeaders({
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-store',
          'X-HH3D-Origin': result.origin,
          'X-HH3D-Quality': result.label,
          'X-HH3D-Version': BUILD_VERSION,
        }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = /Invalid/.test(message) ? 400 : /không tìm thấy/i.test(message) ? 404 : 502;
      return json({ error: message }, status, { 'Cache-Control': 'no-store' });
    }
  },
};
