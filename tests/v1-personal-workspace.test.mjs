import test from 'node:test';
import assert from 'node:assert/strict';
import { createV1PersonalWorkspaceApi, createV1PersonalWorkspaceHandler } from '../server/v1-personal-workspace.ts';
import { createFirebaseIdTokenVerifier } from '../server/firebase-id-token.ts';
import { createTestFirebaseAuthority } from './support/firebase-id-tokens.mjs';
import { createEmptyPersonalWorkspace, applyPersonalWorkspaceCommand } from '../shared/personal-workspace.ts';
import { InactiveUserError } from '../db/user-history.ts';

const NOW = '2026-07-15T12:00:00.000Z';
const authorityPromise = createTestFirebaseAuthority({ now: NOW });
async function fixture() {
  const authority = await authorityPromise;
  const verifier = createFirebaseIdTokenVerifier({ projectId: 'openjob-dev', now: () => Date.parse(NOW), fetchImplementation: authority.fetch });
  const tokens = { a: await authority.issue({ uid: 'firebase_a' }), b: await authority.issue({ uid: 'firebase_b' }), rogue: await authority.issue({ uid: 'firebase_a', signer: 'rogue' }) };
  const users = new Map([['firebase_a', { userId: 'usr_a', username: 'alex' }], ['firebase_b', { userId: 'usr_b', username: 'sam' }]]);
  const persisted = new Map();
  const calls = [];
  const hooks = {};
  let verifications = 0;
  const workspace = {
    async snapshot(owner) {
      calls.push(['snapshot', owner]);
      const result = persisted.has(owner) ? JSON.parse(persisted.get(owner)) : createEmptyPersonalWorkspace(owner);
      await hooks.snapshot?.();
      return result;
    },
    async command(owner, input) {
      calls.push(['command', owner]);
      const state = persisted.has(owner) ? JSON.parse(persisted.get(owner)) : createEmptyPersonalWorkspace(owner);
      const next = applyPersonalWorkspaceCommand(owner, state, input);
      persisted.set(owner, JSON.stringify(next.state));
      await hooks.command?.();
      return next.result;
    },
    async removeAllForUser(owner) { return Number(persisted.delete(owner)); },
  };
  const options = { workspace, users: { async resolve(identity) { return users.get(identity.uid) ?? null; } }, async verifyIdToken(request) { verifications++; return verifier(request); }, requestId: () => 'req_personal_test' };
  let api = createV1PersonalWorkspaceApi(options);
  const request = (command, { token = 'a', headers = {}, body, method, path } = {}) => api.fetch(new Request(`https://openjob.example.invalid/api/v1/workspace/${path ?? (command || body !== undefined ? 'commands' : 'snapshot')}`, {
    method: method ?? (command || body !== undefined ? 'POST' : 'GET'),
    headers: { authorization: `Bearer ${tokens[token] ?? token}`, 'content-type': 'application/json', ...headers },
    ...(command || body !== undefined ? { body: body ?? JSON.stringify(command) } : {}),
  }));
  return { users, persisted, calls, hooks, request, get verifications() { return verifications; }, reload() { api = createV1PersonalWorkspaceApi(options); } };
}

test('signed human identities own personal Task/Calendar commands and reload their isolated state', async () => {
  const f = await fixture();
  const call = async (command, options) => {
    const response = await f.request(command, options);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return (await response.json()).data;
  };
  const initial = await call();
  assert.deepEqual(initial.messages, []);
  assert.equal(initial.calendars[0].id, 'personal');
  const task = await call({ type: 'task.create', title: 'Signed personal task' }, { headers: { 'x-openjob-fixture-owner': 'usr_b', 'x-openjob-fixture-agent': 'fixture_attacker' } });
  assert.equal(task.ownerId, 'usr_a');
  const scheduled = await call({ type: 'task.schedule', taskId: task.id, calendarId: 'personal', start: '2026-07-15T15:00:00Z', end: '2026-07-15T15:30:00Z' });
  await call({ type: 'task.update', taskId: task.id, title: 'Edited signed task' });
  await call({ type: 'task.complete', taskId: task.id, completed: true });
  const aState = await call();
  assert.equal(aState.tasks[0].completed, true);
  assert.equal(aState.events.find(event => event.id === scheduled.calendarEventId).title, 'Edited signed task');
  for (const command of [
    { type: 'task.update', taskId: task.id, title: 'Foreign title' },
    { type: 'task.complete', taskId: task.id, completed: false },
    { type: 'task.unschedule', taskId: task.id },
    { type: 'task.delete', taskId: task.id },
    { type: 'calendar.delete', eventId: scheduled.calendarEventId },
  ]) {
    const response = await f.request(command, { token: 'b', headers: { 'x-openjob-fixture-owner': 'usr_a' } });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.requestId, 'req_personal_test');
  }
  assert.deepEqual((await call(undefined, { token: 'b' })).tasks, []);
  f.reload();
  assert.deepEqual(await call(), aState);
  assert.ok(f.calls.filter(([method]) => method === 'command').every(([, owner]) => ['usr_a', 'usr_b'].includes(owner)));
});

test('personal API rejects forged auth, agent credentials and invalid or provider commands before storage', async () => {
  const f = await fixture();
  assert.equal((await f.request(undefined, { token: 'rogue' })).status, 401);
  assert.equal((await f.request(undefined, { headers: { authorization: '', 'x-openjob-fixture-owner': 'usr_a' } })).status, 401);
  const checked = f.verifications;
  assert.equal((await f.request(undefined, { token: 'oj_agent_agt_' + 'a'.repeat(32) + '.' + 'b'.repeat(43) })).status, 401);
  assert.equal((await f.request(undefined, { headers: { authorization: 'bEaReR   oj_agent_agt_' + 'a'.repeat(32) + '.' + 'b'.repeat(43) } })).status, 401);
  assert.equal(f.verifications, checked, 'group-agent bearer is explicitly rejected without human authentication fallback');
  for (const [body, status, headers] of [
    ['{', 400],
    [new Uint8Array([0xff, 0xfe]), 400],
    ['x'.repeat(32769), 413],
    ['{}', 415, { 'content-type': 'text/plain' }],
    [JSON.stringify({ type: 'task.create', title: 'No impersonation', ownerId: 'usr_b' }), 400],
    [JSON.stringify({ type: 'task.create' }), 400],
    [JSON.stringify({ type: 'task.create', title: 'No source mailbox', messageId: 'alex_msg_launch' }), 400],
    [JSON.stringify({ type: 'mail.compose', accountId: 'x', to: 'x@example.invalid', subject: 'No mail', body: 'No provider calls' }), 403],
    [JSON.stringify({ type: 'mail.send', draftId: 'fixture' }), 403],
    [JSON.stringify({ type: 'agent.grant', name: 'No agents', scopes: ['tasks:write'], resourceIds: ['tasks:personal'] }), 403],
  ]) {
    const response = await f.request(undefined, { body, headers });
    assert.equal(response.status, status, await response.clone().text());
    assert.equal((await response.json()).error.requestId, 'req_personal_test');
  }
  assert.equal((await f.request({ type: 'task.create', title: 'Cross-origin blocked' }, { headers: { origin: 'https://attacker.example.invalid' } })).status, 403);
  assert.equal((await f.request(undefined, { method: 'DELETE' })).status, 404);
  assert.equal(f.calls.length, 0, 'invalid/auth-denied requests never call the workspace store');
});

test('personal API fences responses after async storage when the User disappears, changes or begins deletion', async () => {
  for (const mode of ['snapshot', 'command']) {
    for (const next of [null, { userId: 'usr_a', username: 'alex', deletionPending: true }, { userId: 'usr_changed', username: 'alex' }]) {
      const f = await fixture();
      f.hooks[mode] = () => { if (next) f.users.set('firebase_a', next); else f.users.delete('firebase_a'); };
      const response = await f.request(mode === 'command' ? { type: 'task.create', title: 'Race fixture' } : undefined);
      assert.equal(response.status, 410);
      const body = await response.json();
      assert.equal(body.error.code, 'account_deletion_pending');
      assert.equal('data' in body, false);
    }
  }
  const f = await fixture();
  f.users.set('firebase_a', { userId: 'usr_a', username: 'alex', deletionPending: true });
  assert.equal((await f.request()).status, 410);
  assert.equal(f.calls.length, 0);
  f.users.delete('firebase_a');
  assert.equal((await f.request()).status, 409);
});

test('personal API preserves standard inactive/rate-limit and generic internal errors', async () => {
  for (const [error, status, code] of [
    [new InactiveUserError('usr_a'), 410, 'account_deletion_pending'],
    [Object.assign(new Error('private limiter detail'), { code: 'RESOURCE_EXHAUSTED' }), 429, 'rate_limited'],
    [Object.assign(new Error('private storage detail'), { code: 'workspace_capacity' }), 413, 'workspace_capacity'],
    [Object.assign(new Error('private CAS detail'), { code: 'conflict' }), 409, 'conflict'],
    [new Error('private backend detail'), 500, 'internal_error'],
  ]) {
    const f = await fixture(); f.hooks.snapshot = () => { throw error; };
    const response = await f.request();
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.error.code, code);
    assert.equal(JSON.stringify(body).includes('private'), false);
  }
  const handler = createV1PersonalWorkspaceHandler(() => { throw new Error('private initialization detail'); }, () => 'req_startup');
  const response = await handler(new Request('https://openjob.example.invalid/api/v1/workspace/snapshot'));
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error.requestId, 'req_startup');
});
