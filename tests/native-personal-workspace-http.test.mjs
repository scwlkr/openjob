import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { createFakeFirestore, createPrivateKey } from './support/fake-firestore.mjs';
import { createTestFirebaseAuthority } from './support/firebase-id-tokens.mjs';
import { createFirebaseIdTokenVerifier } from '../server/firebase-id-token.ts';
import { createFirestoreUserStore } from '../db/users.ts';
import { createFirestorePersonalWorkspaceStore } from '../db/personal-workspace.ts';
import { createV1PersonalWorkspaceApi } from '../server/v1-personal-workspace.ts';
import { createV1PersonalAgentGrantsApi } from '../server/v1-personal-agent-grants.ts';

// Exercise native source against real HTTP/JWT/API/store composition; only the
// identity authority and Firestore transport are invented. No native bridge proof.
test('native personal client and auth controller complete the private HTTP workflow', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'openjob-native-http-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const entry = join(directory, 'entry.ts');
  await writeFile(entry, `export {createNativePersonalWorkspaceApi} from ${JSON.stringify(resolve('native/src/personal-workspace-api.ts'))};\nexport {NativeAuthCoordinator} from ${JSON.stringify(resolve('native/src/auth/coordinator.ts'))};\n`);
  await build({ configFile: false, logLevel: 'silent', build: { ssr: entry, outDir: directory, emptyOutDir: false, minify: false, rollupOptions: { output: { entryFileNames: 'native-runtime.mjs' } } } });
  const { createNativePersonalWorkspaceApi, NativeAuthCoordinator } = await import(pathToFileURL(join(directory, 'native-runtime.mjs')).href);
  const now = new Date().toISOString();
  const authority = await createTestFirebaseAuthority({ now });
  const verifyIdToken = createFirebaseIdTokenVerifier({ projectId: 'openjob-dev', fetchImplementation: authority.fetch, now: () => Date.parse(now) });
  const db = createFakeFirestore();
  const config = { projectId: 'openjob-dev', clientEmail: 'native-http@example.invalid', privateKey: await createPrivateKey() };
  const users = createFirestoreUserStore(config, db.fetch);
  const sessions = {};
  for (const name of ['alex', 'sam']) {
    const token = await authority.issue({ uid: `native_http_${name}` });
    const identity = await verifyIdToken(new Request('https://native.example.invalid', { headers: { authorization: `Bearer ${token}` } }));
    const created = await users.create(identity); await users.claimUsername(identity, `native${name}`);
    sessions[name] = { token, owner: created.user.userId };
  }
  const workspace = createFirestorePersonalWorkspaceStore(config, db.fetch);
  const api = createV1PersonalWorkspaceApi({ users, verifyIdToken, workspace });
  const grants = createV1PersonalAgentGrantsApi({ users, verifyIdToken, workspace });
  let commandRequests = 0;
  const server = createServer(async (incoming, outgoing) => {
    try {
      const request = new Request(`http://${incoming.headers.host}${incoming.url}`, { method: incoming.method, headers: incoming.headers, ...(incoming.method === 'POST' ? { body: incoming, duplex: 'half' } : {}) });
      let response;
      if (new URL(request.url).pathname === '/api/v1/me') {
        const identity = await verifyIdToken(request); const user = identity && await users.resolve(identity);
        response = Response.json(user ? { data: { ...user, usernameRequired: !user.username } } : { error: { code: 'authentication_required' } }, { status: user ? 200 : 401 });
      } else {
        if (incoming.url === '/api/v1/workspace/commands') commandRequests++;
        response = await (incoming.url.startsWith('/api/v1/workspace/agent-grants') ? grants : api).fetch(request);
      }
      outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch { outgoing.writeHead(500); outgoing.end('{}'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const native = createNativePersonalWorkspaceApi({ apiBaseUrl: base });
  let who = 'alex'; let stored = null;
  const noop = async () => undefined;
  const coordinator = new NativeAuthCoordinator({
    ...native,
    signInWithProvider: async provider => ({ provider, idToken: 'invented-provider-proof' }),
    exchangeProviderCredential: async () => ({ provider: 'google', idToken: sessions[who].token, refreshToken: 'invented-refresh', expiresAt: Date.parse(now) + 3600000 }),
    getMe: async token => { const response = await fetch(`${base}/me`, { headers: { authorization: `Bearer ${token}` } }); assert.equal(response.status, 200); return (await response.json()).data; },
    listSignInMethods: async () => ['google'], now: () => Date.parse(now), loadCleanupPending: async () => false, loadDeletionReceipt: async () => null,
    loadStoredSession: async () => stored, saveStoredSession: async session => { stored = session; }, clearStoredSession: async () => { stored = null; },
    clearProviderSession: noop, purgeLocalDomainCache: noop, markCleanupPending: noop, clearCleanupPending: noop, clearDeletionReceipt: noop,
  });
  assert.equal((await coordinator.signIn('google')).kind, 'signed-in');
  const controller = coordinator.getPersonalWorkspaceController(); const owner = sessions.alex.owner;
  assert.deepEqual(Object.keys(controller).sort(), ['commandPersonalWorkspace', 'listPersonalAgents', 'readPersonalWorkspace', 'revokePersonalAgent']);
  const command = input => controller.commandPersonalWorkspace(owner, input);
  await command({ type: 'mail.examples.add' });
  let view = await controller.readPersonalWorkspace(owner); assert.equal(view.accounts.length, 3); assert.equal(view.messages.length, 6);
  await command({ type: 'task.create', title: 'Native connected work', messageId: 'example-message-3' });
  const task = (await controller.readPersonalWorkspace(owner)).tasks[0];
  await command({ type: 'task.schedule', taskId: task.id, calendarId: 'personal', start: '2027-06-02T10:00:00Z', end: '2027-06-02T10:30:00Z' });
  await command({ type: 'task.complete', taskId: task.id, completed: true });
  await command({ type: 'mail.draft', messageId: 'example-message-3', body: 'Native invented reply' });
  view = await controller.readPersonalWorkspace(owner);
  assert.equal(view.tasks[0].completed, true); assert.equal(view.events[0].taskId, task.id);
  const draft = view.drafts[0]; assert.equal(draft.accountId, 'mail:example-gmail-work');
  const before = db.commitAttempts(); const requests = commandRequests;
  await assert.rejects(command({ type: 'mail.send', draftId: draft.id }), error => error.status === 403 && error.code === 'sending_disabled');
  assert.equal(commandRequests, requests + 1, 'failed mutation is never replayed'); assert.equal(db.commitAttempts(), before);
  await command({ type: 'mail.simulate-send', draftId: draft.id });
  assert.equal((await controller.readPersonalWorkspace(owner)).sent[0].mode, 'fixture');
  const issued = await fetch(`${base}/workspace/agent-grants`, { method: 'POST', headers: { authorization: `Bearer ${sessions.alex.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Native reviewed agent', scopes: ['mail:read'], resourceIds: ['mail:example-gmail-work'] }) });
  assert.equal(issued.status, 201); const { agent, token: agentToken } = (await issued.json()).data;
  assert.equal((await controller.listPersonalAgents(owner))[0].id, agent.id);
  await controller.revokePersonalAgent(owner, agent.id);
  assert.equal((await controller.listPersonalAgents(owner))[0].revoked, true);
  assert.equal((await fetch(`${base}/workspace/snapshot`, { headers: { authorization: `Bearer ${agentToken}` } })).status, 401);
  await coordinator.signOut(); who = 'sam'; await coordinator.signIn('google');
  const afterSwitch = commandRequests;
  await assert.rejects(command({ type: 'task.create', title: 'Old UI must not write as Sam' }), error => error.code === 'revoked');
  assert.equal(commandRequests, afterSwitch);
  assert.equal((await controller.readPersonalWorkspace(sessions.sam.owner)).tasks.length, 0);
  await assert.rejects(controller.commandPersonalWorkspace(sessions.sam.owner, { type: 'task.complete', taskId: task.id, completed: false }), error => error.status === 403);
  assert.equal((await native.readPersonalWorkspace(sessions.alex.token, owner)).tasks[0].completed, true);
});
