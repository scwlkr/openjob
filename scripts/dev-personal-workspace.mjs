// Credential-free built demo of the actual personal workspace component.
// The synthetic API is local and temporary; this never starts a deployment.
import { createServer, request as proxyRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, extname, sep } from 'node:path';
import { build } from 'vite';

const args = process.argv.slice(2);
const port = args.length ? Number(args[1]) : 5191;
if (args.length && (args.length !== 2 || args[0] !== '--port') || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Use [--port 1-65535].');
const directory = await mkdtemp(join(tmpdir(), 'openjob-personal-demo-'));
let api, server, stopping = false;
async function stop(code = 0) {
  if (stopping) return; stopping = true;
  server?.closeAllConnections(); server?.close(); api?.kill('SIGTERM');
  await rm(directory, { recursive: true, force: true }); process.exitCode = code;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void stop(); });
try {
  console.log('Building isolated personal-workspace demo from this checkout. No credentials or provider setup.');
  await build({ configFile: resolve('tests/browser/personal-workspace-vite.config.ts'), build: { outDir: directory, emptyOutDir: false }, logLevel: 'warn' });
  api = spawn(process.execPath, ['scripts/personal-workspace-test-server.mjs', '--test-only', '--port', '0'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  api.on('exit', code => { if (!stopping) void stop(code || 1); });
  const apiPort = await new Promise((accept, reject) => {
    const timer = setTimeout(() => reject(new Error('Synthetic API did not become ready.')), 15000);
    api.once('message', message => { clearTimeout(timer); if (message?.type === 'openjob-personal-fixture-ready') accept(message.port); else reject(new Error('Unexpected API startup response.')); });
    api.once('error', error => { clearTimeout(timer); reject(error); });
    api.once('exit', () => { clearTimeout(timer); reject(new Error('Synthetic API exited during startup.')); });
  });
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json' };
  server = createServer(async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url, `http://127.0.0.1:${port}`);
      if (url.pathname.startsWith('/api/v1/') || url.pathname.startsWith('/__test/')) {
        const proxy = proxyRequest({ hostname: '127.0.0.1', port: apiPort, path: url.pathname + url.search, method: incoming.method, headers: incoming.headers }, response => { outgoing.writeHead(response.statusCode, response.headers); response.pipe(outgoing); });
        proxy.on('error', () => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end(); }); incoming.pipe(proxy); return;
      }
      if (incoming.method !== 'GET' && incoming.method !== 'HEAD') { outgoing.writeHead(405); outgoing.end(); return; }
      const pathname = ['/', '/workspace', '/workspace/'].includes(url.pathname) ? '/index.html' : decodeURIComponent(url.pathname);
      const file = resolve(directory, '.' + pathname);
      if (!file.startsWith(directory + sep)) { outgoing.writeHead(404); outgoing.end(); return; }
      const content = await readFile(file);
      outgoing.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream', 'cache-control': pathname === '/index.html' || pathname === '/notification-service-worker.js' ? 'no-cache' : 'public,max-age=31536000,immutable', 'x-content-type-options': 'nosniff' });
      outgoing.end(incoming.method === 'HEAD' ? undefined : content);
    } catch { outgoing.writeHead(404); outgoing.end('Not found'); }
  });
  server.on('error', error => { process.stderr.write(`${error.message}\n`); void stop(1); });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Personal workspace demo: http://127.0.0.1:${port}/workspace`);
    console.log('Synthetic Alex/Sam identities; API state lasts only for this process. Browser storage stays local to this origin.');
    console.log('Loopback only: this is not a hosted preview. No saved workspace fixture file is changed.');
    process.send?.({ type: 'openjob-personal-demo-ready', port });
  });
} catch (error) { process.stderr.write(`${error.message}\n`); await stop(1); }
