'use strict';
// Isolated Japanese-anime provider registry.
// Deliberately not wired into addon.js until catalog, metadata, and playback
// are validated. The existing YanHH3D production handlers remain untouched.
const PROVIDERS = Object.freeze({
  animehay: Object.freeze({
    id: 'animehay',
    name: 'AnimeHay',
    // Domains change frequently. Configure only a verified domain.
    baseUrl: process.env.ANIMEHAY_BASE_URL || null
  }),
  animevietsub: Object.freeze({
    id: 'animevietsub',
    name: 'AnimeVietsub',
    baseUrl: process.env.ANIMEVIETSUB_BASE_URL || null
  })
});
const ANIME_CATALOGS = Object.freeze([
  { id: 'anime-jp-recent', name: 'Anime Nhật • Mới cập nhật' },
  { id: 'anime-jp-series', name: 'Anime Nhật • Phim bộ' },
  { id: 'anime-jp-movies', name: 'Anime Nhật • Movie' },
  { id: 'anime-jp-completed', name: 'Anime Nhật • Hoàn thành' }
]);
function animeId(provider, slug) {
  if (!PROVIDERS[provider] || !/^[a-z0-9][a-z0-9-]*$/i.test(slug)) throw new Error('Invalid anime identifier');
  return 'animejp:' + provider + ':' + slug;
}
function parseAnimeId(id) {
  const match = /^animejp:(animehay|animevietsub):([a-z0-9][a-z0-9-]*)$/i.exec(String(id));
  return match ? { provider: match[1].toLowerCase(), slug: match[2] } : null;
}
module.exports = { PROVIDERS, ANIME_CATALOGS, animeId, parseAnimeId };
