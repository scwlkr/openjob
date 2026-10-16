import { createServer, request as proxyRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, resolve, sep } from 'node:path';
import { automaticUpdateNotice } from './updates.mjs';

export async function runApp(args, pkg) {
  const options = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (!['--port', '--state-file'].includes(args[i]) || !args[i + 1] || options.has(args[i])) throw new Error('Use openjob app [--port 1-65535] [--state-file PATH].');
    options.set(args[i], args[i + 1]);
  }
  const port = Number(options.get('--port') ?? 5191);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Use a loopback port from 1 to 65535.');
  const stateFile = options.has('--state-file') ? resolve(options.get('--state-file')) : null;
  const root = fileURLToPath(new URL('../app/', import.meta.url));
  try { await readFile(resolve(root, 'web/index.html')); } catch { throw new Error('Packaged app assets are missing. From a source checkout use npm run app:pack, then install its tarball.'); }
  const apiToken = randomBytes(32).toString('hex');
  const api = spawn(process.execPath, [resolve(root, 'api/server.mjs'), '--test-only', '--port', '0', ...(stateFile ? ['--state-file', stateFile] : [])], { env: { ...process.env, OPENJOB_LOCAL_API_TOKEN: apiToken }, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  let server, interval, stopping = false;
  const stop = () => {
    if (stopping) return; stopping = true;
    clearInterval(interval); server?.closeAllConnections(); server?.close(); api.kill('SIGTERM');
  };
  const signal = () => stop();
  process.once('SIGINT', signal); process.once('SIGTERM', signal);
  api.once('exit', code => { if (!stopping) { process.exitCode = code || 1; stop(); } });
  try {
    const apiPort = await new Promise((accept, reject) => {
      const timer = setTimeout(() => reject(new Error('Local synthetic API startup timed out.')), 15000);
      api.once('message', message => { clearTimeout(timer); message?.type === 'openjob-personal-fixture-ready' ? accept(message.port) : reject(new Error('Invalid API startup response.')); });
      api.once('error', error => { clearTimeout(timer); reject(error); });
      api.once('exit', () => { clearTimeout(timer); reject(new Error('Local API exited.')); });
    });
    const web = await realpath(resolve(root, 'web'));
    if (stopping) return;
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
    server = createServer(async (incoming, outgoing) => {
      // Synthetic identities are deliberately loopback-only, including browser Host/Origin checks.
      const host = `127.0.0.1:${port}`;
      if (incoming.headers.host !== host && incoming.headers.host !== `localhost:${port}`) { outgoing.writeHead(403).end(); return; }
      if (incoming.headers.origin && ![`http://${host}`, `http://localhost:${port}`].includes(incoming.headers.origin)) { outgoing.writeHead(403).end(); return; }
      try {
        const url = new URL(incoming.url, `http://${host}`);
        if (url.pathname.startsWith('/api/v1/') || url.pathname.startsWith('/__test/')) {
          const proxy = proxyRequest({ hostname: '127.0.0.1', port: apiPort, path: url.pathname + url.search, method: incoming.method, headers: { ...incoming.headers, 'x-openjob-local-api': apiToken } }, response => { outgoing.writeHead(response.statusCode, response.headers); response.pipe(outgoing); });
          proxy.on('error', () => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end(); }); incoming.pipe(proxy); return;
        }
        if (!['GET', 'HEAD'].includes(incoming.method)) { outgoing.writeHead(405).end(); return; }
        const pathname = ['/', '/workspace', '/workspace/'].includes(url.pathname) ? '/index.html' : decodeURIComponent(url.pathname);
        const file = await realpath(resolve(web, '.' + pathname));
        if (!file.startsWith(web + sep)) { outgoing.writeHead(404).end(); return; }
        const content = await readFile(file);
        outgoing.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
        outgoing.end(incoming.method === 'HEAD' ? undefined : content);
      } catch { outgoing.writeHead(404).end('Not found'); }
    });
    server.once('error', error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; stop(); });
    server.listen(port, '127.0.0.1', () => {
      if (stopping) { server.closeAllConnections(); server.close(); return; }
      console.log(`OpenJob ${pkg.version} (@${pkg.openjobDistribution?.channel ?? 'latest'}): http://127.0.0.1:${port}/workspace`);
      console.log(`Local prototype: synthetic Alex/Sam identities and invented providers. ${stateFile ? 'Workspace saved to ' + stateFile : 'Temporary API state'}. Real sending is disabled. Stop with Ctrl+C.`);
      process.send?.({ type: 'openjob-app-ready', port });
      void automaticUpdateNotice(pkg);
      interval = setInterval(() => { void automaticUpdateNotice(pkg); }, 6 * 60 * 60 * 1000); interval.unref();
    });
  } catch (error) { const cancelled = stopping; stop(); if (!cancelled) throw error; }
}
