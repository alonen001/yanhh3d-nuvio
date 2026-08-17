/* YanHH3D provider for Nuvio
 * Source: https://yanhh3d.pw/
 * Finds the YanHH3D title from TMDB id, resolves the episode page,
 * then extracts the site's embedded player URL.
 */

const BASE = 'https://yanhh3d.pw';
const UA = 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36';

function clean(s) {
  return (s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(s) {
  return clean(s).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function abs(url) {
  if (!url) return null;
  if (url.indexOf('//') === 0) return 'https:' + url;
  if (url.indexOf('http://') === 0 || url.indexOf('https://') === 0) return url;
  return BASE + (url.charAt(0) === '/' ? url : '/' + url);
}

function getAttr(tag, name) {
  const re = new RegExp(name + '\\s*=\\s*["\\\']([^"\\\']+)', 'i');
  const m = tag.match(re);
  return m ? m[1] : null;
}

function fetchText(url) {
  return fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8'
    }
  }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
    return r.text();
  });
}

function tmdbTitle(tmdbId, mediaType) {
  const kind = mediaType === 'movie' ? 'movie' : 'tv';
  return fetchText('https://www.themoviedb.org/' + kind + '/' + encodeURIComponent(tmdbId))
    .then(function (html) {
      let m = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i);
      if (!m) m = html.match(/<title[^>]*>([^<]+)/i);
      if (!m) throw new Error('TMDB title not found');
      return clean(m[1]).replace(/\s*[|·-]\s*TMDB.*$/i, '').trim();
    });
}

function searchYan(title) {
  return fetchText(BASE + '/ajax/search/suggest?ajaxSearch=1&keysearch=' + encodeURIComponent(title))
    .then(function (html) {
      let body = html;
      try {
        const j = JSON.parse(html);
        body = j.data || j.html || '';
      } catch (_) {}

      const out = [];
      const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = re.exec(body))) {
        const href = abs(m[1]);
        const text = clean(m[2]);
        if (href && /yanhh3d\.pw/i.test(href) && text && !out.some(function (x) { return x.url === href; })) {
          out.push({ url: href, text: text });
        }
      }
      return out;
    });
}

function findDetail(title, results) {
  const wanted = slugify(title);
  let best = null;
  let score = -1;
  results.forEach(function (x) {
    const s = slugify(x.text + ' ' + x.url);
    let n = 0;
    wanted.split('-').forEach(function (p) {
      if (p && s.indexOf(p) >= 0) n++;
    });
    if (s.indexOf(wanted) >= 0) n += 100;
    if (n > score) { score = n; best = x.url; }
  });
  return best;
}

function episodeLinks(detailHtml, episode) {
  const out = [];
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  const ep = String(episode);
  while ((m = re.exec(detailHtml))) {
    const href = abs(m[1]);
    const text = clean(m[2]);
    if (!href) continue;
    if (/\/(?:sever|server)\d+\//i.test(href) && (new RegExp('(?:tap|episode)[-_\\s]*' + ep + '(?:\\D|$)', 'i').test(href) || new RegExp('\\b' + ep + '\\b').test(text))) {
      if (!out.includes(href)) out.push(href);
    }
  }
  return out;
}

function iframeUrls(html) {
  const out = [];
  const re = /<iframe\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const src = getAttr(m[0], 'src');
    if (src) {
      const u = abs(src);
      if (!out.includes(u)) out.push(u);
    }
  }
  return out;
}

function streamFromPlayer(playerUrl, quality) {
  return {
    name: 'YanHH3D',
    title: 'YanHH3D ' + quality,
    url: playerUrl,
    quality: quality,
    headers: {
      'Referer': BASE + '/'
    }
  };
}

function getStreams(tmdbId, mediaType, season, episode) {
  if (episode == null) return Promise.resolve([]);

  return tmdbTitle(tmdbId, mediaType)
    .then(function (title) {
      console.log('[YanHH3D] TMDB ' + tmdbId + ' -> ' + title);
      return searchYan(title).then(function (results) {
        const detail = findDetail(title, results);
        if (!detail) throw new Error('YanHH3D title not found: ' + title);
        return fetchText(detail).then(function (detailHtml) {
          const eps = episodeLinks(detailHtml, episode);
          if (!eps.length) {
            // Common fallback used by YanHH3D URLs: /sever2/<slug>/tap-<n>
            const slug = (detail.match(/\/([^/]+)\/?$/) || [])[1];
            if (slug) {
              eps.push(BASE + '/sever2/' + slug + '/tap-' + episode);
            }
          }
          return eps;
        });
      });
    })
    .then(function (eps) {
      let chain = Promise.resolve([]);
      eps.slice(0, 3).forEach(function (epUrl, idx) {
        chain = chain.then(function (all) {
          return fetchText(epUrl).then(function (html) {
            const players = iframeUrls(html);
            players.forEach(function (p) {
              // Do not expose ad/analytics iframes as playable streams.
              if (/fbcdn\.cloud|player|stream|video/i.test(p)) {
                all.push(streamFromPlayer(p, idx === 0 ? '1080p' : 'HD'));
              }
            });
            return all;
          }).catch(function () { return all; });
        });
      });
      return chain;
    })
    .then(function (streams) {
      const seen = {};
      return streams.filter(function (s) {
        if (seen[s.url]) return false;
        seen[s.url] = true;
        return true;
      });
    })
    .catch(function (e) {
      console.error('[YanHH3D] ' + e.message);
      return [];
    });
}

module.exports = { getStreams: getStreams };
