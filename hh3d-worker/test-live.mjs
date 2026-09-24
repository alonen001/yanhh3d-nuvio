import worker from './src/index.js';

const request = new Request('https://local.test/resolve?slug=tien-nghich&ep=159');
const started = Date.now();
const response = await worker.fetch(request);
const body = await response.text();

console.log(JSON.stringify({
  status: response.status,
  contentType: response.headers.get('content-type'),
  quality: response.headers.get('x-hh3d-quality'),
  origin: response.headers.get('x-hh3d-origin'),
  bytes: Buffer.byteLength(body),
  startsWithM3U: body.startsWith('#EXTM3U'),
  elapsedMs: Date.now() - started,
  error: response.ok ? undefined : body,
}, null, 2));

if (!response.ok || !body.startsWith('#EXTM3U')) process.exitCode = 1;
