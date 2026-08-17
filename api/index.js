const { getRouter } = require('stremio-addon-sdk');
const addonInterface = require('../addon');

const router = getRouter(addonInterface);

// Stream proxy for HLS/MP4 sources that reject direct playback from Stremio/Nuvio.
// Usage: /api/proxy?url=<encoded-source-url>&ref=<encoded-referer>
module.exports = async (req, res) => {
  const path = req.url || '';
  if (!path.startsWith('/api/proxy')) return router(req, res);

  try {
    const parsed = new URL(path, 'https://yanhh3d-nuvio-lovat.vercel.app');
    const target = parsed.searchParams.get('url');
    const referer = parsed.searchParams.get('ref') || 'https://yanhh3d.pw/';
    if (!target) return res.status(400).send('Missing url');

    const u = new URL(target);
    // Keep this proxy limited to media hosts discovered by the addon.
    const allowed = /\.(?:m3u8|mp4)(?:$|\?)/i.test(u.pathname) || /m3u8|mp4/i.test(u.href);
    if (!allowed) return res.status(403).send('Not a media URL');

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36',
      'Referer': referer,
      'Origin': (() => { try { return new URL(referer).origin; } catch (_) { return 'https://yanhh3d.pw'; } })()
    };

    const upstream = await fetch(u.href, { headers });
    if (!upstream.ok) return res.status(upstream.status).send('Upstream HTTP ' + upstream.status);

    const type = upstream.headers.get('content-type') || '';
    const body = await upstream.text();

    // Rewrite HLS playlists so every segment/key is fetched through this proxy too.
    if (/mpegurl|\.m3u8/i.test(type) || /#EXTM3U/i.test(body)) {
      const base = new URL(u.href);
      const proxy = (x) => '/api/proxy?url=' + encodeURIComponent(new URL(x, base).href) + '&ref=' + encodeURIComponent(referer);
      const lines = body.split(/\r?\n/).map(line => {
        const t = line.trim();
        if (!t || t.startsWith('#')) {
          return t.replace(/URI="([^"]+)"/gi, (_, x) => 'URI="' + proxy(x) + '"');
        }
        return proxy(t);
      });
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(lines.join('\n'));
    }

    res.setHeader('Content-Type', type || 'video/mp4');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(Buffer.from(body, 'binary'));
  } catch (e) {
    console.error('[proxy]', e.message);
    return res.status(502).send('Proxy error: ' + e.message);
  }
};
