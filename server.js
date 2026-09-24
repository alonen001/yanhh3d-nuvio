#!/usr/bin/env node
const express = require('express');
const { getRouter } = require('stremio-addon-sdk');
const addonInterface = require('./addon');
const proxyHandler = require('./api/proxy');
const legacyHandler = require('./api/legacy');

const app = express();
const HH3D_RESOLVER = 'https://hh3d-stream-resolver.tao2tk.workers.dev';

app.use('/api/proxy', proxyHandler);
app.use('/proxy', proxyHandler);
app.use('/api/legacy', legacyHandler);
app.get(/^\/catalog\/series\/hh3d-recent(?:\/(.*?))?\.json$/, (req, res) => {
  const params = new URLSearchParams(req.params[0] || '');
  const query = new URLSearchParams();
  if (params.get('search')) query.set('search', params.get('search'));
  if (params.get('skip')) query.set('skip', params.get('skip'));
  res.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.redirect(307, HH3D_RESOLVER + '/catalog' + (query.size ? '?' + query : ''));
});
app.get(/^\/meta\/series\/hh3d(?::|%3a)([^/]+)\.json$/i, (req, res) => {
  res.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.redirect(307, HH3D_RESOLVER + '/meta?slug=' + encodeURIComponent(req.params[0]));
});
app.use(getRouter(addonInterface));

if (require.main === module) {
  const port = Number(process.env.PORT || 7000);
  app.listen(port, () => {
    console.log('YanHH3D Stremio addon listening on port ' + port);
  });
}

module.exports = app;
