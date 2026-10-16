// Isolated browser integration server. It never accepts production credentials or contacts Google.
import { createServer } from 'node:http';
import { createFirestorePersonalWorkspaceStore } from '../db/personal-workspace.ts';
import { createFirestoreUserStore } from '../db/users.ts';
import { createV1PersonalWorkspaceApi } from '../server/v1-personal-workspace.ts';
import { createV1PersonalAgentGrantsApi } from '../server/v1-personal-agent-grants.ts';
import { createV1ProviderPreviewApi } from '../server/v1-provider-preview.ts';
import { createFirebaseIdTokenVerifier } from '../server/firebase-id-token.ts';
import { createPrivateKey } from '../tests/support/fake-firestore.mjs';
import { createTestFirebaseAuthority } from '../tests/support/firebase-id-tokens.mjs';
import { openPersonalWorkspaceState } from './personal-workspace-state.mjs';
import { createMockProviderConnectionHarness } from '../tests/support/mock-provider-connections.mjs';

if (!process.argv.includes('--test-only')) throw new Error('This isolated synthetic server requires --test-only.');
const portIndex = process.argv.indexOf('--port');
const port = portIndex < 0 ? 4181 : Number(process.argv[portIndex + 1]);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Use an explicit loopback port from 0 to 65535.');
const now = new Date().toISOString();
const authority = await createTestFirebaseAuthority({ now });
const stateIndex = process.argv.indexOf('--state-file');
if (stateIndex >= 0 && !process.argv[stateIndex + 1]) throw new Error('Use --state-file PATH.');
const localState = await openPersonalWorkspaceState(stateIndex >= 0 ? process.argv[stateIndex + 1] : undefined);
const firestore = localState.firestore;
const config = { projectId: 'openjob-dev', clientEmail: 'browser-fixture@example.invalid', privateKey: await createPrivateKey() };
const users = createFirestoreUserStore(config, firestore.fetch);
const verifyIdToken = createFirebaseIdTokenVerifier({ projectId: config.projectId, fetchImplementation: authority.fetch, now: () => Date.parse(now) });
const workspace = createFirestorePersonalWorkspaceStore(config, firestore.fetch);
const api = createV1PersonalWorkspaceApi({ workspace, users, verifyIdToken });
const grantsApi = createV1PersonalAgentGrantsApi({ workspace, users, verifyIdToken });
const sessions = new Map();
for (const owner of ['alex', 'sam']) {
  const token = await authority.issue({ uid: `personal_browser_${owner}` });
  const identity = await verifyIdToken(new Request('http://127.0.0.1', { headers: { authorization: `Bearer ${token}` } }));
  const result = await users.create(identity);
  sessions.set(owner, { token, userId: result.user.userId });
}
const providerHarness = await createMockProviderConnectionHarness({
  owners: Object.fromEntries([...sessions].map(([name, session]) => [name, session.userId])),
  isOwnerActive: async ownerId => { const user = await users.getById(ownerId); return !!user && !user.deletionPending; },
});
const providerPreviewApi = createV1ProviderPreviewApi({ users, verifyIdToken, connections: providerHarness.reader });
await localState.persist();
const server = createServer(async (incoming, outgoing) => {
  // Packaged mode accepts only its parent proxy; direct/rebound browser requests fail.
  if (process.env.OPENJOB_LOCAL_API_TOKEN && incoming.headers['x-openjob-local-api'] !== process.env.OPENJOB_LOCAL_API_TOKEN) { outgoing.writeHead(403).end(); return; }
  try {
    const url = new URL(incoming.url, `http://${incoming.headers.host || '127.0.0.1:4181'}`);
    const owner = url.pathname.match(/^\/__test\/session\/(alex|sam)$/)?.[1];
    if (owner && incoming.method === 'GET') {
      outgoing.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      outgoing.end(JSON.stringify(sessions.get(owner))); return;
    }
    if (url.pathname === '/__test/provider-counters' && incoming.method === 'GET') {
      outgoing.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      outgoing.end(JSON.stringify(providerHarness.counters)); return;
    }
    const revoke = url.pathname.match(/^\/__test\/provider-connections\/(mock_(?:gmail|outlook|imap)_[a-f0-9]{24}(?:_consent)?)\/revoke$/)?.[1];
    if (revoke && incoming.method === 'POST' && incoming.headers['x-openjob-test-control'] === 'mock-provider') {
      outgoing.writeHead(providerHarness.controls.revoke(revoke) ? 204 : 404, { 'cache-control': 'no-store' }); outgoing.end(); return;
    }
    const resetImap = url.pathname.match(/^\/__test\/provider-connections\/(mock_imap_[a-f0-9]{24})\/reset-uidvalidity$/)?.[1];
    if (resetImap && incoming.method === 'POST' && incoming.headers['x-openjob-test-control'] === 'mock-provider') {
      outgoing.writeHead(providerHarness.controls.resetImap(resetImap) ? 204 : 404, { 'cache-control': 'no-store' }); outgoing.end(); return;
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(',') : value);
    const request = new Request(url, { method: incoming.method, headers, ...(incoming.method === 'POST' ? { body: incoming, duplex: 'half' } : {}) });
    if (url.pathname === '/api/v1/me' && incoming.method === 'GET') {
      const identity = await verifyIdToken(request); const user = identity && await users.resolve(identity);
      outgoing.writeHead(user ? 200 : 401, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      outgoing.end(JSON.stringify(user ? { data: { ...user, usernameRequired: !user.username, groups: [] } } : { error: { code: 'authentication_required' } })); return;
    }
    const response = await localState.execute(() => (url.pathname === '/api/v1/workspace/provider-preview' ? providerPreviewApi : url.pathname.startsWith('/api/v1/workspace/agent-grants') ? grantsApi : api).fetch(request), incoming.method === 'POST');
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.writeHead(500, { 'content-type': 'application/json' }); outgoing.end('{"error":{"code":"test_server_failure"}}');
  }
});
server.listen(port, '127.0.0.1', () => {
  const actualPort = server.address().port;
  if (localState.filePath) console.log(`Local prototype state: ${localState.filePath}`);
  console.log(`Synthetic signed identity + fake Firestore API: http://127.0.0.1:${actualPort}`);
  process.send?.({ type: 'openjob-personal-fixture-ready', port: actualPort });
});
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (stopping) return; stopping = true;
  server.close(() => { void localState.close().then(() => process.exit(0)); });
});
server.once('error', () => { void localState.close().finally(() => process.exit(1)); });
