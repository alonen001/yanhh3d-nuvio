/* YanHH3D Nuvio provider
 * Runs inside Nuvio/Hermes. Promise-based only.
 */

const BASE = 'https://yanhh3d.pw';
const UA = 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36';

function clean(s) {
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeUrl(s) {
  return String(s || '')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003d/gi, '=')
    .replace(/&quot;/g, '"')
    .trim();
}

function slugify(s) {
  return clean(s).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function abs(url, base) {
  if (!url) return null;
  var u = decodeUrl(url);
  try { return new URL(u, base || BASE).href; } catch (_) { return null; }
}

function attr(tag, name) {
  var re = new RegExp(name + '\\s*=\\s*["\\\']([^"\\\']+)', 'i');
  var m = String(tag || '').match(re);
  return m ? decodeUrl(m[1]) : null;
}

function fetchText(url, referer) {
  return fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'Referer': referer || BASE + '/'
    }
  }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
    return r.text();
  });
}

function anchors(html) {
  var out = [];
  var re = /<a\b([^>]*?)>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = re.exec(html || ''))) {
    var href = abs(attr(m[1], 'href'));
    var text = clean(m[2]);
    if (href) out.push({ url: href, text: text, tag: m[1] });
  }
  return out;
}

function metaContent(html, key) {
  var re1 = new RegExp('<meta\\b[^>]*(?:property|name)=["\\\']' + key + '["\\\'][^>]*>', 'i');
  var re2 = new RegExp('<meta\\b[^>]*content=["\\\']([^"\\\']+)["\\\'][^>]*(?:property|name)=["\\\']' + key + '["\\\'][^>]*>', 'i');
  var m = String(html || '').match(re1);
  if (m) return attr(m[0], 'content');
  m = String(html || '').match(re2);
  return m ? m[1] : null;
}

function tmdbTitle(tmdbId, mediaType) {
  var kind = mediaType === 'movie' ? 'movie' : 'tv';
  var url = 'https://www.themoviedb.org/' + kind + '/' + encodeURIComponent(tmdbId);
  return fetchText(url).then(function (html) {
    var title = metaContent(html, 'og:title');
    if (!title) {
      var m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      title = m ? clean(m[1]) : '';
    }
    title = clean(title).replace(/\s*[|·-]\s*TMDB.*$/i, '').trim();
    if (!title) throw new Error('TMDB title not found for ' + tmdbId);
    return title;
  });
}

function searchYan(title) {
  var url = BASE + '/ajax/search/suggest?ajaxSearch=1&keysearch=' + encodeURIComponent(title);
  return fetchText(url).then(function (html) {
    var body = html;
    try {
      var j = JSON.parse(html);
      body = j.data || j.html || html;
    } catch (_) {}

    var out = [];
    anchors(body).forEach(function (a) {
      if (!/yanhh3d\.pw/i.test(a.url)) return;
      if (/\/(?:sever|server)\d+\//i.test(a.url) || /\/xem\//i.test(a.url)) return;
      if (!a.text || a.text.length < 2) return;
      if (!out.some(function (x) { return x.url === a.url; })) out.push(a);
    });
    return out;
  });
}

function scoreResult(title, item) {
  var wanted = slugify(title);
  var got = slugify(item.text + ' ' + item.url);
  if (got.indexOf(wanted) >= 0) return 10000;
  var parts = wanted.split('-');
  var score = 0;
  parts.forEach(function (p) { if (p && got.indexOf(p) >= 0) score += 1; });
  return score;
}

function findDetail(title, results) {
  var best = null;
  var score = 0;
  results.forEach(function (x) {
    var s = scoreResult(title, x);
    if (s > score) { score = s; best = x.url; }
  });
  return best;
}

function episodeLinks(detailHtml, episode, detailUrl) {
  var out = [];
  var ep = String(episode);
  anchors(detailHtml).forEach(function (a) {
    if (!/(?:sever|server)\d+\//i.test(a.url)) return;
    var hit = new RegExp('(?:tap|episode)[-_\\s]*' + ep + '(?:\\D|$)', 'i').test(a.url) ||
      new RegExp('(?:^|\\D)' + ep + '(?:\\D|$)').test(a.text);
    if (hit && !out.includes(a.url)) out.push(a.url);
  });

  if (!out.length) {
    var m = String(detailUrl || '').match(/\/([^/]+)\/?$/);
    var slug = m ? m[1] : null;
    if (slug) {
      for (var s = 1; s <= 5; s++) {
        out.push(BASE + '/sever' + s + '/' + slug + '/tap-' + ep);
      }
    }
  }
  return out;
}

function extractIframes(html, base) {
  var out = [];
  var re = /<iframe\b[^>]*>/gi;
  var m;
  while ((m = re.exec(html || ''))) {
    var src = abs(attr(m[0], 'src') || attr(m[0], 'data-src'), base);
    if (src && !out.includes(src)) out.push(src);
  }
  return out;
}

function extractMedia(html, base) {
  var out = [];
  var text = String(html || '');

  // Direct URLs in HTML/JS, including JSON-escaped URLs.
  var re = /(?:https?:)?(?:\\\/\\\/|\/\/)[^\s"'<>\\]+\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?/gi;
  var m;
  while ((m = re.exec(text))) {
    var u = abs(m[0], base);
    if (u && !out.includes(u)) out.push(u);
  }

  // HTML video/source tags.
  var srcRe = /<(?:source|video)\b[^>]*>/gi;
  while ((m = srcRe.exec(text))) {
    var src = attr(m[0], 'src') || attr(m[0], 'data-src');
    if (src && /\.(?:m3u8|mp4)(?:\?|$)/i.test(src)) {
      var v = abs(src, base);
      if (v && !out.includes(v)) out.push(v);
    }
  }

  return out;
}

function makeStream(url, quality, referer) {
  return {
    name: 'YanHH3D',
    title: 'YanHH3D ' + quality,
    url: url,
    quality: quality,
    headers: {
      'Referer': referer || BASE + '/',
      'User-Agent': UA
    }
  };
}

function getStreams(tmdbId, mediaType, season, episode) {
  if (episode == null || episode === undefined) return Promise.resolve([]);

  console.log('[YanHH3D] request', tmdbId, mediaType, season, episode);

  return tmdbTitle(tmdbId, mediaType)
    .then(function (title) {
      console.log('[YanHH3D] TMDB title:', title);
      return searchYan(title).then(function (results) {
        var detail = findDetail(title, results);
        if (!detail) throw new Error('Title not found on YanHH3D: ' + title);
        console.log('[YanHH3D] detail:', detail);
        return fetchText(detail).then(function (detailHtml) {
          return { detail: detail, eps: episodeLinks(detailHtml, episode, detail) };
        });
      });
    })
    .then(function (info) {
      var candidates = info.eps.slice(0, 5);
      var all = [];

      var chain = Promise.resolve();
      candidates.forEach(function (epUrl) {
        chain = chain.then(function () {
          return fetchText(epUrl, info.detail).then(function (html) {
            var media = extractMedia(html, epUrl);
            media.forEach(function (u) {
              var q = /2160|4k/i.test(u) ? '4K' : /1080/i.test(u) ? '1080p' : /720/i.test(u) ? '720p' : 'HD';
              all.push(makeStream(u, q, epUrl));
            });

            var frames = extractIframes(html, epUrl);
            var frameChain = Promise.resolve();
            frames.slice(0, 6).forEach(function (frame) {
              frameChain = frameChain.then(function () {
                // The site can put the actual .m3u8 directly in iframe src.
                if (/\.(?:m3u8|mp4)(?:\?|$)/i.test(frame)) {
                  all.push(makeStream(frame, /1080/i.test(frame) ? '1080p' : 'HD', epUrl));
                  return null;
                }
                return fetchText(frame, epUrl).then(function (playerHtml) {
                  extractMedia(playerHtml, frame).forEach(function (u) {
                    var q = /2160|4k/i.test(u) ? '4K' : /1080/i.test(u) ? '1080p' : /720/i.test(u) ? '720p' : 'HD';
                    all.push(makeStream(u, q, frame));
                  });
                }).catch(function () {});
              });
            });
            return frameChain;
          }).catch(function (e) {
            console.log('[YanHH3D] episode candidate failed:', epUrl, e.message);
          });
        });
      });

      return chain.then(function () {
        var seen = {};
        return all.filter(function (s) {
          if (!s.url || seen[s.url]) return false;
          seen[s.url] = true;
          return true;
        });
      });
    })
    .catch(function (e) {
      console.error('[YanHH3D] ' + e.message);
      return [];
    });
}

module.exports = { getStreams: getStreams };
