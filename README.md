# YanHH3D Stremio Addon

Stremio-compatible addon for `https://yanhh3d.pw/`.

## Features

- YanHH3D catalog
- Catalog search through YanHH3D's own search endpoint
- Series metadata and episode list
- Stream extraction from YanHH3D episode pages
- Node 18+ / Vercel-ready

## Deploy

This addon needs a Node/serverless host. GitHub Pages alone is not enough because the catalog/meta/stream resources are dynamic.

Recommended quick deployment: import this repository into Vercel. The serverless entrypoint is `api/index.js` and `vercel.json` is already included.

After deployment, the Stremio manifest URL is:

`https://YOUR-VERCEL-DOMAIN/manifest.json`

Then in Nuvio/Stremio: Addons -> Add Addon -> paste that manifest URL.

## Important

The root `manifest.json` is intentionally a normal Stremio addon manifest object. The old Nuvio-plugin array manifest was replaced because Nuvio's Addon screen expects the Stremio addon protocol.
