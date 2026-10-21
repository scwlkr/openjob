import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import ts from 'typescript';
import { workspaceAgentFixture } from './support/owned-workspace-agents.mjs';

test('native owner client reviews/revokes actual HTTP grants; independent access, saved work and session fences hold', { timeout: 30_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'openjob-native-agents-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const entry = join(directory, 'entry.ts');
  await writeFile(entry, `export {createNativeConnectedWorkspaceApi} from ${JSON.stringify(resolve('native/src/connected-workspaces-api.ts'))};\nexport {NativeAuthCoordinator} from ${JSON.stringify(resolve('native/src/auth/coordinator.ts'))};\n`);
  await build({ configFile: false, logLevel: 'silent', oxc: false, plugins: [{ name: 'native-source', transform(code, id) { if (id.endsWith('.ts')) return ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText; } }], build: { ssr: entry, outDir: directory, emptyOutDir: false, minify: false, rolldownOptions: { tsconfig: false, output: { entryFileNames: 'native.mjs' } } } });
  const { createNativeConnectedWorkspaceApi, NativeAuthCoordinator } = await import(pathToFileURL(join(directory, 'native.mjs')).href);
  const f = await workspaceAgentFixture(), failures = [], traffic = [];
  for (const name of ['alex', 'sam']) {
    const identity = await f.verifyIdToken(new Request('https://fixture.invalid', { headers: { authorization: `Bearer ${f.sessions[name].token}` } }));
    await f.users.claimUsername(identity, `agentnative${name}`);
  }
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks = []; for await (const chunk of incoming) chunks.push(chunk); const body = Buffer.concat(chunks);
      const request = new Request(`http://${incoming.headers.host}${incoming.url}`, { method: incoming.method, headers: incoming.headers, ...(body.length ? { body } : {}) });
      traffic.push({ method: incoming.method, path: incoming.url });
      let response;
      if (incoming.url === '/api/v1/me') { const identity = await f.verifyIdToken(request), user = identity && await f.users.resolve(identity); response = Response.json(user ? { data: { ...user, usernameRequired: !user.username } } : { error: { code: 'authentication_required' } }, { status: user ? 200 : 401 }); }
      else response = await f.api.fetch(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) { failures.push(error); outgoing.writeHead(500); outgoing.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`, api = createNativeConnectedWorkspaceApi({ apiBaseUrl: base });
  let who = 'alex', stored = null, pause, release;
  const delay = async result => { if (pause) { pause(); await new Promise(resolve => { release = resolve; }); } return result; };
  const delayed = { ...api, agentGrants: async (...args) => delay(await api.agentGrants(...args)), revokeAgent: async (...args) => delay(await api.revokeAgent(...args)) };
  const noop = async () => undefined;
  const coordinator = new NativeAuthCoordinator({ connectedWorkspaces: delayed, readPersonalWorkspace: noop, commandPersonalWorkspace: noop, listPersonalAgents: async () => [], revokePersonalAgent: noop,
    signInWithProvider: async provider => ({ provider, idToken: 'invented-proof' }), exchangeProviderCredential: async () => ({ provider: 'google', idToken: f.sessions[who].token, refreshToken: 'invented-refresh', expiresAt: Date.now() + 3600000 }),
    getMe: async token => (await (await fetch(base + '/me', { headers: { authorization: `Bearer ${token}` } })).json()).data, listSignInMethods: async () => ['google'], now: Date.now,
    loadCleanupPending: async () => false, loadDeletionReceipt: async () => null, loadStoredSession: async () => stored, saveStoredSession: async value => { stored = value; }, clearStoredSession: async () => { stored = null; },
    clearProviderSession: noop, purgeLocalDomainCache: noop, markCleanupPending: noop, clearCleanupPending: noop, clearDeletionReceipt: noop, loadLocalTaskListCache: async () => null,
  });
  assert.equal((await coordinator.signIn('google')).kind, 'signed-in'); const controller = coordinator.getPersonalWorkspaceController().connected;
  const workspace = (await controller.read(f.owner, f.home)).workspace;
  assert.deepEqual(await controller.agentGrants(f.owner, workspace), { agents: [], actions: [] });
  const other = await controller.create(f.owner, 'Independent B');
  const a = await f.store.createAgent(f.owner, f.home, { name: 'Native A helper', scopes: ['tasks:read', 'tasks:write'], resourceIds: [workspace.taskSpaceId] });
  const b = await f.store.createAgent(f.owner, other.workspace.workspaceId, { name: 'Independent B helper', scopes: ['tasks:read'], resourceIds: [other.workspace.taskSpaceId] });
  const request = (path, token, input, method = input === undefined ? 'GET' : 'POST') => fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, ...(input === undefined ? {} : { 'content-type': 'application/json' }) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  const created = await request(`/workspaces/${f.home}/commands`, a.token, { type: 'task.create', title: 'Keep agent-authored native work' }); assert.equal(created.status, 200);
  const receipt = (await created.json()).data;
  const listed = await controller.agentGrants(f.owner, workspace); assert.equal(listed.agents[0].id, a.agent.id); assert.equal(listed.actions[0].itemId, receipt.itemId); assert.equal(listed.actions[0].operation, 'task.create');
  assert.equal(JSON.stringify(listed).includes(a.token), false); assert.doesNotMatch(JSON.stringify(listed), /tokenHash|Keep agent-authored/);
  assert.equal((await request(`/workspaces/${f.home}/agent-grants`, a.token)).status, 403);
  assert.equal((await request(`/workspaces/${f.home}/agent-grants/${a.agent.id}`, a.token, undefined, 'DELETE')).status, 403);
  assert.equal((await request(`/workspaces/${f.home}/agent-grants`, f.sessions.sam.token)).status, 403);
  const before = await controller.read(f.owner, f.home);
  const deleteBefore = traffic.filter(row => row.method === 'DELETE').length;
  assert.deepEqual(await controller.revokeAgent(f.owner, f.home, a.agent.id), { id: a.agent.id, revoked: true });
  assert.equal(traffic.filter(row => row.method === 'DELETE').length, deleteBefore + 1);
  assert.equal((await request(`/workspaces/${f.home}`, a.token)).status, 401);
  assert.equal((await request(`/workspaces/${other.workspace.workspaceId}`, b.token)).status, 200);
  assert.deepEqual(await controller.read(f.owner, f.home), before);
  assert.equal((await controller.agentGrants(f.owner, workspace)).agents[0].revoked, true);
  const retained = await controller.personal(f.owner);
  await assert.rejects(controller.agentGrants(f.owner, retained.workspace), error => error.status === 403);
  for (const method of ['agentGrants', 'revokeAgent']) {
    const started = new Promise(resolve => { pause = resolve; });
    const pending = method === 'agentGrants' ? controller.agentGrants(f.owner, workspace) : controller.revokeAgent(f.owner, f.home, a.agent.id); await started;
    await coordinator.signOut(); who = 'sam'; await coordinator.signIn('google'); release();
    await assert.rejects(pending, error => error.code === 'revoked');
    await assert.rejects(controller.revokeAgent(f.owner, f.home, a.agent.id), error => error.code === 'revoked');
    await coordinator.signOut(); who = 'alex'; await coordinator.signIn('google'); pause = null;
  }
  assert.equal((await request(`/workspaces/${other.workspace.workspaceId}`, b.token)).status, 200);
  await controller.revokeAgent(f.owner, other.workspace.workspaceId, b.agent.id);
  assert.equal(failures.length, 0);
});
