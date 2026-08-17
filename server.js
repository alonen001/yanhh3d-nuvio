#!/usr/bin/env node
const { serveHTTP } = require('stremio-addon-sdk');
const addonInterface = require('./addon');

const port = Number(process.env.PORT || 7000);
serveHTTP(addonInterface, { port, cacheMaxAge: 60 });
console.log('YanHH3D Stremio addon listening on port ' + port);
