const ALLOWED_HOSTS = [
  'yanhh3d.pw',
  'fbcdn.cloud',
  'odycdn.com',
  'player.odycdn.com'
];
const UA = 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36';

function allowed(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    return ALLOWED_HOSTS.some(x => h === x || h.endsWith('.' + x));
  } catch (_) { return false; }
}

function proxyUrl(url) {
  return '/proxy?u=' + encodeURIComponent(url);
}

module.exports = async (req, res) => {
  try {
    const target = String(req.query?.u || '');
    if (!target || !allowed(target)) return res.status(400).send('Bad stream URL');

    const range = req.headers?.range;
    const headers = {
      'User-Agent': UA,
      'Referer': 'https://yanhh3d.pw/',
      'Origin': 'https://yanhh3d.pw',
      'Accept': '*/*'
    };
    if (range) headers.Range = range;

    const r = await fetch(target, { headers });
    if (!r.ok && r.status !== 206) return res.status(r.status).send('Upstream HTTP ' + r.status);

    const type = (r.headers.get('content-type') || '').toLowerCase();

    // HLS: rewrite every playlist URL, including EXT-X-KEY/EXT-X-MAP URIs.
    if (type.includes('mpegurl') || /\.m3u8(?:$|\?)/i.test(target)) {
      let text = await r.text();
      const base = new URL(target);
      text = text.split(/\r?\n/).map(line => {
        const s = line.trim();
        if (!s) return line;
        if (s.startsWith('#')) {
          return line.replace(/URI="([^"]+)"/gi, (_, u) => {
            try { return 'URI="' + proxyUrl(new URL(u, base).href) + '"'; }
            catch (_) { return _; }
          });
        }
        try { return proxyUrl(new URL(s, base).href); }
        catch (_) { return line; }
      }).join('\n');

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(200).send(text);
    }

    // MP4: preserve byte ranges. Without this many mobile players show a
    // source but never start playback because they probe the file with Range.
    const buf = Buffer.from(await r.arrayBuffer());
    const contentLength = r.headers.get('content-length');
    const contentRange = r.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', type || 'video/mp4');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(r.status === 206 ? 206 : 200).send(buf);
  } catch (e) {
    console.error('[proxy]', e.message);
    return res.status(502).send('Proxy error: ' + e.message);
  }
};
