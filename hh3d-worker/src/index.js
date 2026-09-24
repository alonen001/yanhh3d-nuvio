const DISCOVERY_URL = 'https://bit.ly/hh3d';
const FALLBACK_ORIGIN = 'https://hoathinh3d.de';
const ORIGIN_TTL_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30_000;
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36';
const PROXIED_SEGMENT_HOSTS = new Set(['m.ckjdsib32rkjvsd.xyz']);

let originCache = { value: FALLBACK_ORIGIN, expiresAt: Date.now() + 10 * 60 * 1000 };

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
    Referer: `${origin}/`,
    'Cache-Control': 'no-cache',
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
    const origin = await discoverOrigin(force);
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
  const detailUrl = `${origin}/${slug}/`;
  try {
    const head = await timedFetch(detailUrl, {
      method: 'HEAD',
      headers: siteHeaders(origin),
    });
    if (head.ok) {
      const id = postIdFromHeaders(head.headers);
      if (id) return id;
    }
  } catch (_) {}

  for (const url of [`${origin}/${slug}/embed/`, detailUrl]) {
    const response = await timedFetch(url, { headers: siteHeaders(origin) });
    if (!response.ok) continue;
    const id = postIdFromHeaders(response.headers) || postIdFromHtml(await response.text());
    if (id) return id;
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
  const clientId = randomClientId();
  const playerUrl = new URL('/wp-content/themes/halimmovies/player.php', origin);
  playerUrl.searchParams.set('episode_slug', `tap-${episode}`);
  playerUrl.searchParams.set('server_id', '1');
  playerUrl.searchParams.set('subsv_id', '');
  playerUrl.searchParams.set('post_id', postId);

  const playerResponse = await timedFetch(playerUrl, {
    headers: siteHeaders(origin, {
      'X-Requested-With': 'XMLHttpRequest',
      'X-Halim-Client': clientId,
      Referer: `${origin}/${slug}/tap-${episode}/`,
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
      Referer: `${origin}/${slug}/tap-${episode}/`,
    }),
    body: JSON.stringify({ key_id: encrypted.kid }),
  });
  if (!keyResponse.ok) throw new Error(`HH3D key HTTP ${keyResponse.status}`);
  const keyData = await keyResponse.json();
  if (!keyData?.success || !keyData.key) throw new Error('HH3D không cấp khóa giải mã');
  return decryptPlayerPayload(encrypted, keyData.key);
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

function playableMediaUrl(value, playlistUrl, resolverOrigin) {
  const absolute = new URL(value, playlistUrl);
  if (resolverOrigin && PROXIED_SEGMENT_HOSTS.has(absolute.hostname)) {
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
  if (url.protocol !== 'https:' || !PROXIED_SEGMENT_HOSTS.has(url.hostname)) {
    throw new Error('Segment host is not allowed');
  }
  if (!/^\/f2_[a-z0-9]+_\d+\/\d+\.png$/i.test(url.pathname)) {
    throw new Error('Invalid segment path');
  }
  return url;
}

async function proxySegment(request, origin) {
  const target = validateSegmentUrl(new URL(request.url).searchParams.get('url'));
  const headers = {
    'User-Agent': UA,
    Referer: `${origin}/`,
    Accept: '*/*',
  };
  const range = request.headers.get('range');
  if (range) headers.Range = range;
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
  });
  return new Response(body, { status: 200, headers: responseHeaders });
}

export async function resolvePlaylist(slugValue, episodeValue, resolverOrigin = '') {
  const slug = validateSlug(slugValue);
  const episode = validateEpisode(episodeValue);
  let lastError;
  for (const force of [false, true]) {
    const origin = await discoverOrigin(force);
    try {
      const postId = await findPostId(origin, slug);
      const player = await getPlayerData(origin, slug, episode, postId);
      if (!player?.status || player.type !== 'hls' || !allowedPlaylistUrl(player.file)) {
        throw new Error('HH3D không trả về playlist HLS hợp lệ');
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
  throw lastError || new Error('Không lấy được nguồn HH3D');
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return json({ ok: true, service: 'hh3d-stream-resolver', origin: await discoverOrigin() }, 200, {
        'Cache-Control': 'no-store',
      });
    }
    if (url.pathname === '/catalog' && request.method === 'GET') {
      try {
        const search = String(url.searchParams.get('search') || '').trim().slice(0, 120);
        const skip = Math.max(0, Number.parseInt(url.searchParams.get('skip') || '0', 10) || 0);
        const items = await catalogData(search, skip);
        const metas = items.map(item => ({ id: `hh3d:${item.slug}`, type: 'series', name: item.title,
          poster: item.poster || undefined, posterShape: 'poster' }));
        return json({ items, metas, cacheMaxAge: 3600 }, 200, {
          'Cache-Control': search ? 'public, max-age=900' : 'public, max-age=3600',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return json({ error: message, items: [] }, 502, { 'Cache-Control': 'no-store' });
      }
    }
    if (url.pathname === '/meta' && request.method === 'GET') {
      try {
        const data = await metaData(url.searchParams.get('slug'));
        const id = `hh3d:${data.slug}`;
        const videos = data.episodes.map(episode => ({ id: `${id}:1:${episode}`, title: `Tập ${episode}`,
          season: Math.floor((episode - 1) / 50) + 1, episode: (episode - 1) % 50 + 1 }));
        return json({ ...data, meta: { id, type: 'series', name: data.title, poster: data.poster || undefined,
          background: data.poster || undefined, description: data.description, videos } }, 200, {
          'Cache-Control': 'public, max-age=3600',
        });
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
    if (url.pathname !== '/resolve' || request.method !== 'GET') {
      return json({ error: 'Not found' }, 404);
    }
    try {
      const result = await resolvePlaylist(url.searchParams.get('slug'), url.searchParams.get('ep'), url.origin);
      return new Response(result.playlist, {
        status: 200,
        headers: corsHeaders({
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-store',
          'X-HH3D-Origin': result.origin,
          'X-HH3D-Quality': result.label,
        }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = /Invalid/.test(message) ? 400 : /không tìm thấy/i.test(message) ? 404 : 502;
      return json({ error: message }, status, { 'Cache-Control': 'no-store' });
    }
  },
};
