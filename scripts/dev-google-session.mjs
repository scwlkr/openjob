import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import base from '../deployment/web-vite.config.ts';
import { webFirebaseConfigFor } from '../config/web-firebase-config.mjs';
import identities from '../config/native-identities.json' with { type: 'json' };
import { createGoogleSelfSession } from '../server/connections/google-self-session.ts';

// Deliberately does not import portable runtime/config or any credential loader.
const firebase = webFirebaseConfigFor('preview'), port = 5202, origin = `http://127.0.0.1:${port}`;
const address = process.env.OPENJOB_GOOGLE_MAILBOX;
if (!address || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error('Set the explicitly approved alternate mailbox in OPENJOB_GOOGLE_MAILBOX.');
const runtime = createGoogleSelfSession({ configuration: { ...firebase, address, origin, clientId: identities.environments.preview.firebase.googleWebClientId }, identityTransport: fetch, googleTransport: fetch, mailTransport: fetch });
const send = (response, code, data) => { response.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(data)); };
const middleware = { name: 'local-self-authenticated-gmail', configureServer(vite) { vite.middlewares.use((incoming, outgoing, next) => {
  if (incoming.headers.host !== `127.0.0.1:${port}` || incoming.headers.origin && incoming.headers.origin !== origin) { outgoing.writeHead(403).end(); return; }
  if (incoming.url === '/healthz') { send(outgoing, 200, { mode: 'local_mail_session', configured: true, project: firebase.projectId, realSending: false }); return; }
  if (incoming.url === '/runtime-config') { send(outgoing, 200, { firebase, appleServiceId: '' }); return; }
  if (!incoming.url?.startsWith('/api/')) return next();
  void (async () => {
    try {
      const chunks = []; let size = 0;
      for await (const chunk of incoming) { size += chunk.length; if (size > 16384) { outgoing.writeHead(413).end(); return; } chunks.push(chunk); }
      const request = new Request(origin + incoming.url, { method: incoming.method, headers: incoming.headers, ...(!['GET', 'HEAD'].includes(incoming.method) ? { body: Buffer.concat(chunks) } : {}) });
      const response = await runtime.fetch(request); outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch { send(outgoing, 500, { error: { code: 'local_mail_unavailable' } }); }
  })();
}); } };
const server = await createServer({ ...base, configFile: false, define: { __OPENJOB_FIREBASE_CONFIG__: JSON.stringify(firebase), __OPENJOB_APPLE_SERVICE_ID__: JSON.stringify(''), __OPENJOB_QA_PASSWORD_AUTH__: 'null' }, cacheDir: await mkdtemp(join(tmpdir(), 'openjob-self-mail-')), plugins: [...base.plugins, middleware], server: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'error' });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void server.close(); });
await server.listen();
console.log(`OpenJob local Gmail session: ${origin}/mail-session · no database/operator credential · sending disabled`);
