import test from 'node:test';
import assert from 'node:assert/strict';
import { createV1PersonalAgentGrantsApi, createV1PersonalAgentGrantsHandler } from '../server/v1-personal-agent-grants.ts';
import { createFirebaseIdTokenVerifier } from '../server/firebase-id-token.ts';
import { createTestFirebaseAuthority } from './support/firebase-id-tokens.mjs';
import { InactiveUserError } from '../db/user-history.ts';

const NOW = '2026-07-15T12:00:00.000Z';
const authorityPromise = createTestFirebaseAuthority({ now: NOW });
const input = { name: 'Planning helper', scopes: ['tasks:read', 'calendar:read'], resourceIds: ['tasks:personal', 'calendar:personal'] };
async function fixture() {
  const authority = await authorityPromise;
  const verifier = createFirebaseIdTokenVerifier({ projectId: 'openjob-dev', now: () => Date.parse(NOW), fetchImplementation: authority.fetch });
  const tokens = { a: await authority.issue({ uid: 'firebase_a' }), b: await authority.issue({ uid: 'firebase_b' }), unknown: await authority.issue({ uid: 'firebase_unknown' }), rogue: await authority.issue({ uid: 'firebase_a', signer: 'rogue' }) };
  const users = new Map([['firebase_a', { userId: 'usr_a', username: 'alex' }], ['firebase_b', { userId: 'usr_b', username: 'sam' }]]);
  const grants = new Map();
  const calls = [];
  const hooks = {};
  let serial = 0;
  let verifications = 0;
  const workspace = {
    async createAgent(owner, value) {
      calls.push(['create', owner]);
      const id = `agt_${(++serial).toString(16).padStart(32, '0')}`;
      const agent = { ...structuredClone(value), id, ownerUserId: owner, createdAt: NOW, expiresAt: '2026-07-16T12:00:00.000Z', revoked: false, tokenHash: 'private-hash-must-not-leak' };
      grants.set(id, agent);
      await hooks.create?.();
      return { agent, token: `oj_personal_${owner}.${id}.${'b'.repeat(43)}` };
    },
    async listAgents(owner) { calls.push(['list', owner]); await hooks.list?.(); return [...grants.values()].filter((agent) => agent.ownerUserId === owner); },
    async revokeAgent(owner, id) { calls.push(['revoke', owner, id]); const grant = grants.get(id); if (!grant || grant.ownerUserId !== owner) return false; grant.revoked = true; await hooks.revoke?.(); return true; },
  };
  const api = createV1PersonalAgentGrantsApi({ workspace, users: { async resolve(identity) { return users.get(identity.uid) || null; } }, async verifyIdToken(request) { verifications++; return verifier(request); }, requestId: () => 'req_personal_agent' });
  const request = ({ method = 'GET', id, token = 'a', body, headers = {} } = {}) => api.fetch(new Request(`https://openjob.example.invalid/api/v1/workspace/agent-grants${id ? `/${id}` : ''}`, {
    method, headers: { authorization: `Bearer ${tokens[token] || token}`, 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body) }),
  }));
  return { request, users, grants, calls, hooks, get verifications() { return verifications; } };
}

test('signed human grant management isolates owners and returns the secret only at creation', async () => {
  const f = await fixture();
  const created = await f.request({ method: 'POST', body: input, headers: { 'x-openjob-fixture-owner': 'usr_b' } });
  assert.equal(created.status, 201);
  assert.equal(created.headers.get('cache-control'), 'no-store');
  const issued = (await created.json()).data;
  assert.equal(issued.agent.ownerUserId, 'usr_a');
  assert.match(issued.token, /^oj_personal_usr_a\./);
  assert.equal('tokenHash' in issued.agent, false);
  assert.equal((await f.request({ method: 'DELETE', id: issued.agent.id, token: 'b' })).status, 404);
  assert.deepEqual((await (await f.request({ token: 'b' })).json()).data, []);
  const listed = await f.request();
  const listedText = await listed.text();
  assert.equal(listed.status, 200);
  assert.equal(listedText.includes(issued.token), false);
  assert.equal(listedText.includes('tokenHash'), false);
  assert.equal(listedText.includes('private-hash'), false);
  assert.deepEqual(JSON.parse(listedText).data, [issued.agent]);
  const revoked = await f.request({ method: 'DELETE', id: issued.agent.id });
  assert.equal(revoked.status, 204);
  assert.equal(await revoked.text(), '');
  assert.equal(revoked.headers.get('cache-control'), 'no-store');
  assert.equal((await (await f.request()).json()).data[0].revoked, true);
});

test('grant administration rejects forged, absent, personal-agent and group-agent authentication', async () => {
  const f = await fixture();
  assert.equal((await f.request({ token: 'rogue' })).status, 401);
  assert.equal((await f.request({ headers: { authorization: '', 'x-openjob-fixture-owner': 'usr_a' } })).status, 401);
  const checked = f.verifications;
  for (const token of [`oj_agent_agt_${'a'.repeat(32)}.${'b'.repeat(43)}`, `oj_personal_usr_a.agt_${'a'.repeat(32)}.${'b'.repeat(43)}`]) assert.equal((await f.request({ method: 'POST', body: input, token })).status, 401);
  assert.equal(f.verifications, checked);
  assert.equal((await f.request({ token: 'unknown' })).status, 409);
  assert.equal((await f.request({ headers: { origin: 'https://attacker.example.invalid' } })).status, 403);
  assert.deepEqual(f.calls, []);
});

test('grant JSON validation bounds streamed body, names, scopes and resources before storage', async () => {
  const f = await fixture();
  const invalid = [
    ['{', 400], [new Uint8Array([0xff]), 400], ['x'.repeat(32769), 413],
    [input, 415, { 'content-type': 'text/plain' }],
    [{ ...input, ownerUserId: 'usr_b' }, 400], [{ ...input, name: 'x'.repeat(81) }, 400], [{ ...input, name: 'bad\nname' }, 400],
    [{ ...input, scopes: [] }, 400], [{ ...input, scopes: ['mail:read'] }, 400], [{ ...input, scopes: ['tasks:read', 'tasks:read'] }, 400],
    [{ ...input, resourceIds: [] }, 400], [{ ...input, resourceIds: ['foreign_calendar'] }, 400], [{ ...input, resourceIds: ['tasks:personal', 'tasks:personal'] }, 400],
  ];
  for (const [body, status, headers] of invalid) {
    const response = await f.request({ method: 'POST', body, headers });
    assert.equal(response.status, status, await response.clone().text());
    assert.equal((await response.json()).error.requestId, 'req_personal_agent');
  }
  assert.equal((await f.request({ method: 'DELETE', id: 'not-a-grant' })).status, 404);
  assert.deepEqual(f.calls, []);
});

test('pending deletion and deletion races suppress grant data and one-time credentials', async () => {
  const f = await fixture();
  f.users.get('firebase_a').deletionPending = true;
  assert.equal((await f.request({ method: 'POST', body: input })).status, 410);
  assert.deepEqual(f.calls, []);
  f.users.get('firebase_a').deletionPending = false;
  f.hooks.create = () => { f.users.get('firebase_a').deletionPending = true; };
  const raced = await f.request({ method: 'POST', body: input });
  assert.equal(raced.status, 410);
  assert.equal((await raced.text()).includes('oj_personal_'), false);
  f.users.get('firebase_a').deletionPending = false;
  f.hooks.list = () => { throw new InactiveUserError(); };
  assert.equal((await f.request()).status, 410);
  const handler = createV1PersonalAgentGrantsHandler(() => { throw new Error('private setup detail'); }, () => 'req_safe');
  const failed = await handler(new Request('https://openjob.example.invalid'));
  assert.equal(failed.status, 500);
  assert.equal((await failed.text()).includes('private setup detail'), false);
});
