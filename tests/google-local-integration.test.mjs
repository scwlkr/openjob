import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { privateGoogleStoreFixture } from './support/private-google-store.mjs';
import { createFirestorePersonalWorkspaceStore } from '../db/personal-workspace.ts';
import { createPortableRuntime } from '../server/portable-runtime.ts';
import { BINDING, ACCESS, REFRESH } from './support/google-oauth-transport.mjs';

// One-shot local composition proof; never opens a browser or a real Google endpoint.
test('loopback opt-in portable runtime + existing CLI complete Google lifecycle using encrypted fake Firestore', { timeout: 30_000 }, async t => {
  const network = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('External network forbidden in local Google proof'); };
  t.after(() => { globalThis.fetch = network; });
  const f = await privateGoogleStoreFixture(), directory = await mkdtemp(join(tmpdir(), 'openjob-google-local-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // Start like a new pilot: no independent homes, but retained Personal work.
  for (const path of [...f.db.documents.keys()]) if (path.includes('/v1OwnedWorkspaceCatalogs/') || path.includes('/v1OwnedWorkspaces/')) f.db.documents.delete(path);
  const personal = createFirestorePersonalWorkspaceStore(f.config, f.db.fetch);
  await personal.command(f.owner, { type: 'task.create', title: 'Retained synthetic task' });
  const personalPath = f.client.documentName(`v1PersonalWorkspaces/${f.owner}`);
  const retainedBefore = structuredClone(f.db.documents.get(personalPath));
  const contextPath = f.client.documentName(`v1PersonalWorkspaceContexts/${f.owner}`);
  let home;
  const credential = join(directory, 'invented-cli-refresh');
  await writeFile(credential, 'invented-refresh', { mode: 0o600 });
  let application;
  function reconstruct() {
    application = createPortableRuntime({ ...f.config, apiKey: 'fixture' }, {
      databaseTransport: f.db.fetch, identityTransport: f.identityTransport,
      googleTransport: f.protocol.transport, mailTransport: f.flowOptions.mailTransport,
      evidenceMode: 'google-fixture', google: { executionMode: 'configured',
        key: f.options.key, keyId: f.options.keyId, ownerUserId: f.owner,
        firebaseUid: 'alex', address: BINDING.address,
        clientId: f.flowOptions.google.clientId, clientSecret: f.flowOptions.google.clientSecret,
        callbackUri: f.flowOptions.google.callbackUri,
      },
    });
  }
  reconstruct();
  const failures = [], paths = [], outputs = [];
  const server = createServer(async (req, res) => {
    try {
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 8192) throw new Error('Request too large'); }
      if (req.url === '/firebase/token?key=fixture') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id_token: f.sessions.alex.token, refresh_token: 'invented-refresh' })); return; }
      paths.push(req.url);
      const request = new Request(`http://127.0.0.1:${server.address().port}` + req.url, { method: req.method, headers: req.headers, ...(!['GET', 'HEAD'].includes(req.method) ? { body } : {}) });
      const response = await application.fetch(request);
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
    } catch (error) { failures.push(error); res.writeHead(500); res.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path = '', input, token = f.sessions.alex.token) {
    return network(base + '/api/v1/connections' + path, { method: input ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, ...(input ? { 'content-type': 'application/json' } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) });
  }
  async function cli(args, input) {
    const file = join(directory, 'input.json'); if (input) await writeFile(file, JSON.stringify(input), { mode: 0o600 });
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['cli/openjob.mjs', 'connections', ...args, '--format', 'json', ...(input ? ['--input', file] : [])], { env: { ...process.env, NODE_ENV: 'test', OPENJOB_NO_UPDATE_CHECK: '1', OPENJOB_API_URL: base + '/api/v1', OPENJOB_TEST_AUTH_URL: base, OPENJOB_TEST_FIREBASE_API_KEY: 'fixture', OPENJOB_TEST_GOOGLE_CLIENT_ID: 'fixture.apps.googleusercontent.com', OPENJOB_TEST_CREDENTIAL_FILE: credential }, timeout: 15_000, killSignal: 'SIGTERM', stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; }); child.on('error', reject); child.on('close', status => resolve({ status, stdout, stderr }));
    });
    assert.equal(result.status, 0, 'CLI or loopback handler failed'); outputs.push(result.stdout, result.stderr); return JSON.parse(result.stdout).data;
  }
  async function begin() {
    const started = await cli(['begin'], { address: BINDING.address, workspaceId: home });
    const url = new URL(started.authorizationUrl); assert.equal(url.origin, 'https://accounts.google.com');
    f.protocol.hooks.claims = { nonce: url.searchParams.get('nonce') };
    return { ...started, state: url.searchParams.get('state') };
  }
  async function complete(started) {
    const response = await request('/google/callback', { state: started.state, code: 'invented-local-code', callbackUri: f.flowOptions.google.callbackUri });
    assert.equal(response.status, 200); assert.equal((await response.json()).data.status, 'connected');
  }
  const empty = await cli(['list']); assert.equal(empty.mode, 'google-fixture'); assert.deepEqual(empty.homes, []);
  assert.equal(f.db.documents.has(contextPath), false); // Catalog reads never map.
  const mapPersonal = token => network(base + '/api/v1/workspaces/personal-context', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' });
  assert.equal((await mapPersonal(f.sessions.sam.token)).status, 403);
  const mapped = await mapPersonal(f.sessions.alex.token); assert.equal(mapped.status, 200);
  const prepared = (await mapped.json()).data; home = prepared.workspace.workspaceId;
  assert.equal(prepared.work.tasks[0].title, 'Retained synthetic task');
  const repeated = await mapPersonal(f.sessions.alex.token); assert.equal((await repeated.json()).data.workspace.workspaceId, home);
  assert.deepEqual(f.db.documents.get(personalPath), retainedBefore);
  assert.equal((await cli(['list'])).homes[0].workspaceId, home);
  const started = await begin(); await complete(started);
  const pendingReplay = await request('/google/callback', { state: started.state, code: 'invented-local-code', callbackUri: f.flowOptions.google.callbackUri });
  assert.equal(pendingReplay.status, 409);
  const snapshot = f.db.exportState(), serialized = JSON.stringify(snapshot);
  for (const secret of [ACCESS, REFRESH, (await f.store.read(f.owner))[0].credentialRef]) assert.equal(serialized.includes(secret), false);
  // Export/restore actual encrypted backing state, then reconstruct client/store/flow.
  // This is fake database restart proof, not live disk/database durability.
  f.db.restoreState(structuredClone(snapshot));
  reconstruct();
  assert.equal((await cli(['list'])).bindings[0].status, 'connected');
  await cli(['action', started.connectionId], { action: 'refresh' });
  const mail = await cli(['mail', started.connectionId]);
  assert.equal(mail.mode, 'google-fixture'); assert.equal(mail.workspaceId, home); assert.equal(mail.page.messages[0].body, 'Invented connected message.');
  const task = await cli(['task', started.connectionId], { messageId: 'm1', title: 'Review this connected message' });
  assert.equal(task.workspaceId, home); assert.equal(task.created, true);
  assert.deepEqual(await cli(['task', started.connectionId], { messageId: 'm1', title: 'Do not overwrite authored work' }), { ...task, created: false });
  assert.equal((await cli(['source', home, task.taskId])).message.body, 'Invented connected message.');
  const scoped = await personal.createAgent(f.owner, { name: 'Task reader', scopes: ['tasks:read'], resourceIds: ['tasks:personal'] });
  const agentView = await personal.snapshotForAgent(scoped.token);
  assert.ok(agentView.tasks.some(item => item.id === task.taskId));
  assert.doesNotMatch(JSON.stringify(agentView), /mailSources|connectionId|sourceMessage|Invented connected message/);
  await personal.revokeAgent(f.owner, scoped.agent.id);
  await assert.rejects(personal.snapshotForAgent(scoped.token), error => error.code === 'authentication_required');
  const workRequest = (path = '', input) => network(base + '/api/v1/workspaces/' + home + path, { method: input ? 'POST' : 'GET', headers: { authorization: `Bearer ${f.sessions.alex.token}`, ...(input ? { 'content-type': 'application/json' } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) });
  const schedule = await workRequest('/commands', { type: 'task.schedule', taskId: task.taskId, calendarId: prepared.workspace.calendarId, start: '2026-10-21T14:00:00Z', end: '2026-10-21T14:30:00Z' });
  assert.equal(schedule.status, 200);
  assert.equal((await workRequest('/commands', { type: 'task.complete', taskId: task.taskId, completed: true })).status, 200);
  const reply = await cli(['reply', home, task.taskId]);
  assert.equal(reply.plans.reply.to[0], 'replies@example.invalid'); assert.equal(reply.plans.reply.from, BINDING.address);
  const replyInput = { mode: 'reply-all', body: 'Completed and reviewed through the existing CLI.', expectedRevision: 0, reviewToken: reply.reviewToken };
  const replySaved = await cli(['reply-save', home, task.taskId], replyInput); assert.equal(replySaved.draft.revision, 1);
  assert.deepEqual(await cli(['reply-save', home, task.taskId], replyInput), replySaved);
  reconstruct();
  const saved = (await (await workRequest()).json()).data;
  assert.equal(saved.work.tasks.find(item => item.id === task.taskId).completed, true);
  assert.equal(saved.work.events[0].taskId, task.taskId);
  assert.doesNotMatch(JSON.stringify(saved), /connectionId|mailSources|Invented connected message/);
  assert.equal((await cli(['source', home, task.taskId])).message.body, 'Invented connected message.');
  assert.deepEqual((await cli(['reply', home, task.taskId])).draft, replySaved.draft);
  const syncBefore = await personal.readTaskCalendarSync(f.owner);
  assert.doesNotMatch(JSON.stringify(syncBefore), /Completed and reviewed|replies@example|connectedReplies/);
  const draftReader = await personal.createAgent(f.owner, { name: 'Task reader after draft', scopes: ['tasks:read'], resourceIds: ['tasks:personal'] });
  assert.doesNotMatch(JSON.stringify(await personal.snapshotForAgent(draftReader.token)), /Completed and reviewed|replies@example|connectedReplies/);
  await personal.revokeAgent(f.owner, draftReader.agent.id);
  assert.equal((await request(`/${started.connectionId}/mail`, undefined, f.sessions.sam.token)).status, 403);
  assert.equal((await request('', undefined, 'oj_agent_synthetic')).status, 401);
  assert.equal((await request(`/${started.connectionId}`, { action: 'send' })).status, 409);
  await cli(['action', started.connectionId], { action: 'disconnect' });
  assert.equal((await request(`/${started.connectionId}/mail`)).status, 409);
  assert.equal((await request(`/task-sources/${home}/${task.taskId}`)).status, 409);
  assert.equal((await request(`/task-sources/${home}/${task.taskId}/reply`)).status, 409);
  assert.equal((await request(`/task-sources/${home}/${task.taskId}/reply`, replyInput)).status, 409);
  const again = await begin(); assert.equal(again.connectionId, started.connectionId); await complete(again);
  assert.equal((await cli(['list'])).bindings[0].workspaceId, home);
  assert.deepEqual((await cli(['reply', home, task.taskId])).draft, replySaved.draft);
  await cli(['action', again.connectionId], { action: 'disconnect' });
  const sync = await personal.readTaskCalendarSync(f.owner);
  sync.projection.tasks = sync.projection.tasks.filter(item => item.id !== task.taskId);
  sync.projection.events = sync.projection.events.filter(item => item.taskId !== task.taskId);
  await personal.syncTaskCalendar(f.owner, { operationId: crypto.randomUUID(), baseRevision: sync.revision, expiresAt: new Date(Date.now() + 60000).toISOString(), projection: sync.projection });
  assert.deepEqual(JSON.parse(f.db.documents.get(personalPath).fields.mailSourcesJson.stringValue), []);
  assert.equal(JSON.parse(f.db.documents.get(personalPath).fields.connectedRepliesJson.stringValue)[0].draft.body, replyInput.body);
  assert.equal((await request(`/task-sources/${home}/${task.taskId}`)).status, 404);
  for (const secret of [ACCESS, REFRESH]) assert.equal(outputs.join('').includes(secret), false);
  assert.equal(failures.length, 0); assert.ok(paths.every(path => path.startsWith('/api/v1/connections') || path.startsWith('/api/v1/workspaces/')));
});
