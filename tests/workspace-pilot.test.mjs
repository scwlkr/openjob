import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeFirestore, createPrivateKey } from './support/fake-firestore.mjs';
import { createTestFirebaseAuthority } from './support/firebase-id-tokens.mjs';
import { createFirestoreUserStore } from '../db/users.ts';
import { createFirestorePersonalWorkspaceStore } from '../db/personal-workspace.ts';
import { createFirebaseIdTokenVerifier } from '../server/firebase-id-token.ts';
import { createPortableRuntime } from '../server/portable-runtime.ts';
import { createWorkspacePilotRuntime } from '../server/workspace-pilot-runtime.ts';
async function fixture() {
  const db = createFakeFirestore(), now = new Date().toISOString();
  const config = { projectId: 'openjob-dev', clientEmail: 'pilot@example.invalid', privateKey: await createPrivateKey() };
  const authority = await createTestFirebaseAuthority({ now });
  const verifyIdToken = createFirebaseIdTokenVerifier({ projectId: config.projectId, fetchImplementation: authority.fetch, now: () => Date.parse(now) });
  const users = createFirestoreUserStore(config, db.fetch), personal = createFirestorePersonalWorkspaceStore(config, db.fetch), sessions = {};
  for (const name of ['alex', 'sam', 'apple']) {
    const token = await authority.issue({ uid: `pilot_${name}`, ...(name === 'apple' ? { claims: { firebase: { sign_in_provider: 'apple.com' } } } : {}) });
    const identity = await verifyIdToken(new Request('https://pilot.invalid', { headers: { authorization: `Bearer ${token}` } }));
    sessions[name] = { token, identity };
    if (name !== 'apple') sessions[name].user = (await users.create(identity)).user;
  }
  assert.equal((await users.link(sessions.alex.identity, sessions.apple.identity, sessions.alex.user.userId)).kind, 'linked');
  assert.equal((await users.resolve(sessions.apple.identity)).userId, sessions.alex.user.userId);
  const admission = { userId: sessions.alex.user.userId, provider: 'google', firebaseUid: 'pilot_alex' };
  const compose = (selection, overrides = {}) => createWorkspacePilotRuntime({ config, personal, users, verifyIdToken, transport: db.fetch, admission: selection, ...overrides });
  const api = compose(admission);
  const request = (path = '', input, name = 'alex', application = api) => application.fetch(new Request(`https://pilot.invalid/api/v1/workspaces${path}`, { method: input === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${sessions[name]?.token ?? name}`, ...(input === undefined ? {} : { 'content-type': 'application/json' }) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) }));
  const call = async (...args) => { const response = await request(...args); assert.equal(response.status, 200, await response.clone().text()); return (await response.json()).data; };
  return { db, config, personal, users, sessions, admission, compose, request, call, api, authority };
}
test('normal shared runtime admits only exact existing binding and composes real Task/Calendar and retained Personal authority', async () => {
  const f = await fixture(), owner = f.sessions.alex.user.userId;
  const signIns = () => [...f.db.documents].filter(([path]) => path.includes('/v1SignInMethods/') || path.includes('/v1UserSignInMethods/'));
  const bindings = structuredClone(signIns());
  assert.deepEqual(await f.call('/session'), { ownerUserId: owner, assurance: 'limited_owner_pilot', employerIsolation: false });
  const retainedTask = await f.personal.command(owner, { type: 'task.create', title: 'Keep Personal' });
  const retained = await f.call('/personal-context', {}), work = await f.call('', { name: 'Work' });
  assert.equal(retained.work.tasks[0].id, retainedTask.id); assert.equal(work.work.tasks.length, 0);
  assert.notEqual(retained.workspace.workspaceId, work.workspace.workspaceId);
  const commands = `/${work.workspace.workspaceId}/commands`;
  let snapshot = await f.call(commands, { type: 'task.create', title: 'Normal pilot task' }); const taskId = snapshot.work.tasks[0].id;
  await f.call(commands, { type: 'task.notes', taskId, notes: 'Synthetic composition proof' });
  snapshot = await f.call(commands, { type: 'task.schedule', taskId, calendarId: work.workspace.calendarId, start: '2026-10-18T14:00:00Z', end: '2026-10-18T14:30:00Z' });
  assert.equal(snapshot.work.events[0].taskId, taskId);
  snapshot = await f.call(commands, { type: 'task.complete', taskId, completed: true }); assert.equal(snapshot.work.tasks[0].completed, true);
  assert.equal(snapshot.work.tasks[0].notes, 'Synthetic composition proof');
  await f.call(`/${retained.workspace.workspaceId}/commands`, { type: 'task.notes', taskId: retainedTask.id, notes: 'Same Personal authority' });
  assert.equal((await f.personal.snapshot(owner)).tasks[0].notes, 'Same Personal authority');
  assert.deepEqual(signIns(), bindings);
  for (const name of ['sam', 'apple']) assert.equal((await f.request(`/${work.workspace.workspaceId}`, undefined, name)).status, 403);
  assert.equal((await f.request(commands, { type: 'task.complete', taskId: retainedTask.id, completed: true })).status, 403);
  for (const input of [{ type: 'mail.send', draftId: 'x' }, { type: 'agent.grant' }]) assert.equal((await f.request(commands, input)).status, 400);
  for (const input of [{ admitted: true }, { ownerUserId: owner }]) assert.equal((await f.request('/personal-context', input)).status, 400);
  assert.equal((await f.request('/session?admitted=true')).status, 400);
  assert.equal((await f.request('/session', undefined, 'oj_fake_agent')).status, 401);
  const rogue = await f.authority.issue({ uid: 'pilot_alex', signer: 'rogue' }); assert.equal((await f.request('/session', undefined, rogue)).status, 401);
});
test('unset or invalid admission never touches Workspace storage; selection is copied and no unknown User is created', async () => {
  const f = await fixture(); const before = structuredClone(f.db.exportState());
  for (const admission of [undefined, { ...f.admission, clientClaim: true }, { ...f.admission, userId: 'untrusted' }]) {
    let storageCalls = 0;
    const api = f.compose(admission, { transport: async () => { storageCalls++; throw new Error('Workspace storage must stay untouched'); } });
    assert.equal((await f.request('', { name: 'Must not create' }, 'alex', api)).status, 503); assert.equal(storageCalls, 0);
  }
  const selection = { ...f.admission }, api = f.compose(selection); selection.firebaseUid = 'pilot_sam'; selection.userId = f.sessions.sam.user.userId;
  assert.equal((await f.request('/session', undefined, 'sam', api)).status, 403); assert.equal((await f.request('/session', undefined, 'alex', api)).status, 200);
  const unknown = await f.authority.issue({ uid: 'never_registered' }); assert.equal((await f.request('/session', undefined, unknown)).status, 410);
  assert.deepEqual(f.db.exportState(), before);
});
test('binding resolution is rechecked after body reading and before mutation, and again before response disclosure', async () => {
  const f = await fixture(); let live = true, calls = 0, release;
  const reading = new Promise(resolve => { release = resolve; });
  const api = f.compose(f.admission, { users: { resolve: async identity => { const user = live ? await f.users.resolve(identity) : null; if (++calls === 2) release(); return user; } } });
  const before = structuredClone(f.db.exportState());
  const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"name":')); }, async pull(controller) { await reading; live = false; controller.enqueue(new TextEncoder().encode('"Denied"}')); controller.close(); } });
  const response = await api.fetch(new Request('https://pilot.invalid/api/v1/workspaces', { method: 'POST', headers: { authorization: `Bearer ${f.sessions.alex.token}`, 'content-type': 'application/json' }, body, duplex: 'half' }));
  assert.equal(response.status, 410); assert.deepEqual(f.db.exportState(), before);
  let resolutions = 0;
  const revoked = f.compose(f.admission, { users: { resolve: async identity => ++resolutions < 3 ? f.users.resolve(identity) : null } });
  assert.equal((await f.request('', undefined, 'alex', revoked)).status, 410);
  const directory = [...f.db.documents.values()].find(doc => doc.name.endsWith(`/v1UserDirectory/${f.admission.userId}`)); directory.fields.deletionState = { stringValue: 'pending' };
  assert.equal((await f.request('/session')).status, 410);
});

test('actual portable router stays unconfigured for a verified existing User without creating Workspace records', async () => {
  const f = await fixture(), savedFetch = globalThis.fetch, before = structuredClone(f.db.exportState()); let workspaceCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('www.googleapis.com/service_accounts/')) return f.authority.fetch(input, init);
    if (url.includes('v1OwnedWorkspace') || url.includes('v1PersonalWorkspaceContext')) workspaceCalls++;
    return f.db.fetch(input, init);
  };
  try {
    const runtime = createPortableRuntime({ ...f.config, apiKey: 'synthetic-public-key' });
    const response = await f.request('/session', undefined, 'alex', runtime);
    assert.equal(response.status, 503); assert.equal((await response.json()).error.code, 'workspace_pilot_unconfigured');
    assert.equal(workspaceCalls, 0); assert.deepEqual(f.db.exportState(), before);
  } finally { globalThis.fetch = savedFetch; }
});
