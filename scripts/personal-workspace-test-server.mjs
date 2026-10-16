// Isolated browser integration server. It never accepts production credentials or contacts Google.
import { createServer } from 'node:http';
import { createFirestorePersonalWorkspaceStore } from '../db/personal-workspace.ts';
import { createFirestoreUserStore } from '../db/users.ts';
import { createV1PersonalWorkspaceApi } from '../server/v1-personal-workspace.ts';
import { createV1PersonalAgentGrantsApi } from '../server/v1-personal-agent-grants.ts';
import { createV1ProviderPreviewApi } from '../server/v1-provider-preview.ts';
import { createFirebaseIdTokenVerifier } from '../server/firebase-id-token.ts';
import { createFakeFirestore, createPrivateKey } from '../tests/support/fake-firestore.mjs';
import { createTestFirebaseAuthority } from '../tests/support/firebase-id-tokens.mjs';

if (!process.argv.includes('--test-only')) throw new Error('This isolated synthetic server requires --test-only.');
const now = new Date().toISOString();
const authority = await createTestFirebaseAuthority({ now });
const firestore = createFakeFirestore();
const config = { projectId: 'openjob-dev', clientEmail: 'browser-fixture@example.invalid', privateKey: await createPrivateKey() };
const users = createFirestoreUserStore(config, firestore.fetch);
const verifyIdToken = createFirebaseIdTokenVerifier({ projectId: config.projectId, fetchImplementation: authority.fetch, now: () => Date.parse(now) });
const workspace = createFirestorePersonalWorkspaceStore(config, firestore.fetch);
const api = createV1PersonalWorkspaceApi({ workspace, users, verifyIdToken });
const grantsApi = createV1PersonalAgentGrantsApi({ workspace, users, verifyIdToken });
const providerPreviewApi = createV1ProviderPreviewApi({ users, verifyIdToken });
const sessions = new Map();
for (const owner of ['alex', 'sam']) {
  const token = await authority.issue({ uid: `personal_browser_${owner}` });
  const identity = await verifyIdToken(new Request('http://127.0.0.1', { headers: { authorization: `Bearer ${token}` } }));
  const result = await users.create(identity);
  sessions.set(owner, { token, userId: result.user.userId });
}
const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, `http://${incoming.headers.host || '127.0.0.1:4181'}`);
    const owner = url.pathname.match(/^\/__test\/session\/(alex|sam)$/)?.[1];
    if (owner && incoming.method === 'GET') {
      outgoing.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      outgoing.end(JSON.stringify(sessions.get(owner))); return;
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(',') : value);
    const request = new Request(url, { method: incoming.method, headers, ...(incoming.method === 'POST' ? { body: incoming, duplex: 'half' } : {}) });
    const response = await (url.pathname === '/api/v1/workspace/provider-preview' ? providerPreviewApi : url.pathname.startsWith('/api/v1/workspace/agent-grants') ? grantsApi : api).fetch(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.writeHead(500, { 'content-type': 'application/json' }); outgoing.end('{"error":{"code":"test_server_failure"}}');
  }
});
server.listen(4181, '127.0.0.1', () => console.log('Synthetic signed identity + fake Firestore API: http://127.0.0.1:4181'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
