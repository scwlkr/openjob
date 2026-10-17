import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serviceConfiguration } from './service-config.mjs';
import { createPortableRuntime } from '../server/portable-runtime.ts';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  if (!['--port', '--host'].includes(key) || !value || args.has(key)) throw new Error('Use openjob server [--port PORT] [--host 127.0.0.1|0.0.0.0].');
  args.set(key, value);
}
const port = Number(args.get('--port') ?? 5192);
const host = args.get('--host') ?? '127.0.0.1';
if (!Number.isInteger(port) || port < 1 || port > 65535 || !['127.0.0.1', '0.0.0.0'].includes(host)) throw new Error('Invalid service host/port.');
const origin = new URL(process.env.OPENJOB_PUBLIC_ORIGIN ?? `http://127.0.0.1:${port}`);
if (origin.href !== origin.origin + '/' || !['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) throw new Error('OPENJOB_PUBLIC_ORIGIN must be one http(s) origin.');
if (origin.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(origin.hostname)) throw new Error('Non-loopback service origins require HTTPS.');
const config = await serviceConfiguration(process.env);
const web = await realpath(fileURLToPath(new URL('../service-web/', import.meta.url)));
let runtime;
const json = (response, status, data) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(data)); };
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
const server = createServer(async (incoming, outgoing) => {
  if (incoming.headers.host !== origin.host || (incoming.headers.origin && incoming.headers.origin !== origin.origin)) { outgoing.writeHead(403).end(); return; }
  try {
    const url = new URL(incoming.url, origin);
    if (url.pathname.startsWith('/__test')) { outgoing.writeHead(404).end(); return; }
    if (url.pathname === '/healthz' && incoming.method === 'GET') { json(outgoing, config.missing.length ? 503 : 200, { mode: 'service', configured: !config.missing.length, missing: config.missing, providers: 'unconfigured', realSending: false }); return; }
    if (url.pathname === '/runtime-config' && incoming.method === 'GET') {
      json(outgoing, 200, { firebase: config.firebase, appleServiceId: config.appleServiceId }); return;
    }
    if (url.pathname.startsWith('/api/')) {
      if (config.missing.length) { json(outgoing, 503, { error: { code: 'service_configuration_required', missing: config.missing } }); return; }
      const chunks = []; let length = 0;
      for await (const chunk of incoming) { length += chunk.length; if (length > 2 * 1024 * 1024) { json(outgoing, 413, { error: { code: 'request_too_large' } }); return; } chunks.push(chunk); }
      runtime ??= createPortableRuntime(config.server);
      const body = Buffer.concat(chunks);
      const request = new Request(url, { method: incoming.method, headers: incoming.headers, ...(!['GET', 'HEAD'].includes(incoming.method) ? { body } : {}) });
      const response = await runtime.fetch(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer())); return;
    }
    if (!['GET', 'HEAD'].includes(incoming.method)) { outgoing.writeHead(405).end(); return; }
    const path = ['/', '/workspace', '/workspace/', '/workspaces', '/workspaces/', '/home', '/home/', '/connections', '/connections/', '/connections/google/callback', '/account'].includes(url.pathname) ? '/index.html' : decodeURIComponent(url.pathname);
    const file = await realpath(resolve(web, '.' + path));
    if (!file.startsWith(web + sep)) { outgoing.writeHead(404).end(); return; }
    const content = await readFile(file);
    outgoing.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' }); outgoing.end(incoming.method === 'HEAD' ? undefined : content);
  } catch (error) { json(outgoing, error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 500, { error: { code: 'service_request_failed' } }); }
});
server.listen(port, host, () => console.log(`OpenJob service: ${origin.origin}/workspace · ${config.missing.length ? 'configuration required' : 'Firebase configured'} · provider connections/sending unconfigured`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.closeAllConnections(); server.close(); });
