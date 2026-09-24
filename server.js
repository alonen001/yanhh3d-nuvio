#!/usr/bin/env node
const express = require('express');
const { getRouter } = require('stremio-addon-sdk');
const addonInterface = require('./addon');
const proxyHandler = require('./api/proxy');
const legacyHandler = require('./api/legacy');

const app = express();

app.use('/api/proxy', proxyHandler);
app.use('/proxy', proxyHandler);
app.use('/api/legacy', legacyHandler);
app.use(getRouter(addonInterface));

if (require.main === module) {
  const port = Number(process.env.PORT || 7000);
  app.listen(port, () => {
    console.log('YanHH3D Stremio addon listening on port ' + port);
  });
}

module.exports = app;
