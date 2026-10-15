import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFirestoreAgentGrantStore } from '../db/agent-grants.ts';
import { createFirestoreTaskStore } from '../db/v1-tasks.ts';
import { createV1AgentGrantsApi } from '../server/v1-agent-grants.ts';
import { createV1TasksApi } from '../server/v1-tasks.ts';
import { createFakeFirestore, createPrivateKey } from './support/fake-firestore.mjs';
import { createOpenApiResponseValidator } from './support/openapi-response.mjs';

const NOW = Date.parse('2026-10-15T12:00:00.000Z');
const ROOT = 'projects/openjob-dev/databases/(default)/documents/';
const OWNER = 'user_fixture';
const GROUP = 'grp_fixture';
const collection = `/api/v1/groups/${GROUP}/tasks`;

async function fixture() {
  const firestore = createFakeFirestore();
  let clock = NOW;
  let next = 0;
  let beforeCommit;
  const seed = (path, values) => firestore.documents.set(ROOT + path, {
    name: ROOT + path, updateTime: new Date(clock + ++next).toISOString(),
    fields: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { stringValue: value }])),
  });
  seed(`v1UserDirectory/${OWNER}`, { userId: OWNER });
  seed('v1UserDirectory/user_other', { userId: 'user_other' });
  seed(`v1Groups/${GROUP}`, { groupId: GROUP });
  seed(`v1Groups/${GROUP}/members/${OWNER}`, { userId: OWNER, membershipId: 'membership_original' });
  for (const id of ['one', 'two']) {
    seed(`v1Groups/${GROUP}/tasks/task_${id}`, { taskId: `task_${id}`, groupId: GROUP, text: `Isolated ${id}`, assigneeState: 'unassigned', state: 'open' });
    firestore.documents.get(ROOT + `v1Groups/${GROUP}/tasks/task_${id}`).fields.createdAt = { timestampValue: new Date(NOW).toISOString() };
  }
  const fetchImplementation = async (input, init = {}) => {
    if (String(input).endsWith('/documents:commit') && beforeCommit) { const hook = beforeCommit; beforeCommit = undefined; hook(); }
    return firestore.fetch(input, init);
  };
  const config = { projectId: 'openjob-dev', clientEmail: 'fixture@example.invalid', privateKey: await createPrivateKey() };
  const grants = createFirestoreAgentGrantStore(config, fetchImplementation, { now: () => clock });
  const tasks = createFirestoreTaskStore(config, fetchImplementation);
  const users = {
    async resolve(identity) { return { userId: identity.uid, username: 'fixture', deletionPending: Boolean(firestore.documents.get(ROOT + `v1UserDirectory/${identity.uid}`)?.fields.deletionState) }; },
    async getByUsername() { throw new Error('Agent must not resolve human mutation targets.'); },
  };
  const verifyIdToken = async request => {
    const auth = request.headers.get('authorization');
    return auth === 'Bearer fixture-human' ? { uid: OWNER } : auth === 'Bearer fixture-other' ? { uid: 'user_other' } : null;
  };
  const admin = createV1AgentGrantsApi({ grants, users, verifyIdToken, now: () => clock,
    agentId: () => `agt_${String(++next).padStart(32, '0')}`, secret: () => 'A'.repeat(43) });
  let beforeList;
  const taskApi = createV1TasksApi({ agents: grants, users, verifyIdToken, tasks: { ...tasks,
    async list(...args) { const result = await tasks.list(...args); await beforeList?.(); return result; },
  } });
  const request = (path, { token = 'fixture-human', method = 'GET', body, headers = {} } = {}) => {
    const req = new Request('http://fixture.invalid' + path, { method, headers: { authorization: `Bearer ${token}`, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return (path.startsWith('/api/v1/agent-grants') ? admin : taskApi).fetch(req);
  };
  const issue = async (body = { groupId: GROUP, name: 'Fixture planner' }) => request('/api/v1/agent-grants', { method: 'POST', body });
  return { firestore, grants, tasks, taskApi, admin, request, issue, seed, clock: value => { clock = value; }, beforeList: hook => { beforeList = hook; }, beforeCommit: hook => { beforeCommit = hook; } };
}

test('owner issues a hash-only, one-Group read grant; shared Task reads preserve pagination and deny mutations', async () => {
  const f = await fixture();
  const validate = await createOpenApiResponseValidator();
  const issued = await f.issue();
  assert.equal(issued.status, 201);
  await validate(issued.clone(), '/api/v1/agent-grants', 'post');
  const { agent, token } = (await issued.json()).data;
  assert.equal(issued.headers.get('cache-control'), 'no-store');
  assert.equal(Date.parse(agent.expiresAt) - Date.parse(agent.createdAt), 86400000);
  const persisted = f.firestore.documents.get(ROOT + `v1AgentGrants/${agent.agentId}`);
  assert.equal(JSON.stringify(persisted).includes(token), false);
  assert.match(persisted.fields.tokenHash.stringValue, /^[a-f0-9]{64}$/);
  assert.equal('membershipId' in agent, false);
  const commits = f.firestore.commitAttempts();
  const first = await f.request(collection + '?limit=1', { token });
  assert.equal(first.status, 200);
  const page = await first.json();
  assert.equal(page.data.length, 1);
  assert.ok(page.nextCursor);
  const second = await f.request(collection + '?limit=1&cursor=' + page.nextCursor, { token });
  assert.notEqual((await second.json()).data[0].taskId, page.data[0].taskId);
  const item = await f.request(collection + '/task_one', { token });
  assert.equal(item.status, 200);
  assert.equal(item.headers.get('cache-control'), 'no-store');
  assert.equal((await f.request(collection, { token, headers: { 'if-none-match': first.headers.get('etag') } })).status, 200); // different page options
  const etag = (await f.request(collection, { token })).headers.get('etag');
  assert.equal((await f.request(collection, { token, headers: { 'if-none-match': etag } })).status, 304);
  for (const [method, path] of [['POST', collection], ['PATCH', collection + '/task_one'], ['DELETE', collection + '/task_one'], ['PUT', collection + '/task_one/state'], ['GET', collection + '/task_one/state'], ['GET', '/api/v1/groups/grp_secret/tasks'], ['GET', '/api/v1/groups/grp_missing/tasks']]) {
    const response = await f.request(path, { token, method });
    assert.equal(response.status, 403, method + ' ' + path);
    assert.equal((await response.json()).error.code, 'agent_access_denied');
  }
  assert.equal((await f.request('/api/v1/agent-grants', { token })).status, 401);
  assert.equal((await f.request('/api/v1/agent-grants', { token, method: 'POST', body: { groupId: GROUP, name: 'Escalate' } })).status, 401);
  assert.equal(f.firestore.commitAttempts(), commits, 'delegated reads and denials perform no writes');
  const listing = await f.request('/api/v1/agent-grants');
  await validate(listing.clone(), '/api/v1/agent-grants', 'get');
  assert.equal(JSON.stringify(await listing.json()).includes(token), false);
  assert.deepEqual((await (await f.request('/api/v1/agent-grants', { token: 'fixture-other' })).json()).data, []);
  assert.equal((await f.request(`/api/v1/agent-grants/${agent.agentId}`, { method: 'DELETE', token: 'fixture-other' })).status, 404);
  assert.equal((await f.request(collection, { token: token.slice(0, -1) + 'B' })).status, 403);
  assert.equal((await f.issue({ groupId: 'grp_secret', name: 'No access' })).status, 404);
  assert.equal((await f.issue({ groupId: GROUP, name: 'No write', scope: 'tasks:write' })).status, 400);
});

test('revocation, expiry, membership generation and deletion block agent reads, including in-flight data and 304', async () => {
  for (const change of ['revoke', 'expiry', 'leave', 'rejoin', 'pending', 'deleted', 'hidden', 'missing-generation']) {
    const f = await fixture();
    const { agent, token } = (await (await f.issue()).json()).data;
    const etag = (await f.request(collection, { token })).headers.get('etag');
    const invalidate = async () => {
      if (change === 'revoke') await f.grants.revoke(OWNER, agent.agentId);
      if (change === 'expiry') f.clock(NOW + 86400000);
      if (change === 'leave') f.firestore.documents.delete(ROOT + `v1Groups/${GROUP}/members/${OWNER}`);
      if (change === 'rejoin') f.seed(`v1Groups/${GROUP}/members/${OWNER}`, { membershipId: 'membership_rejoined' });
      if (change === 'missing-generation') f.seed(`v1Groups/${GROUP}/members/${OWNER}`, { userId: OWNER });
      if (change === 'pending') f.seed(`v1UserDirectory/${OWNER}`, { userId: OWNER, deletionState: 'pending' });
      if (change === 'deleted') f.firestore.documents.delete(ROOT + `v1UserDirectory/${OWNER}`);
      if (change === 'hidden') f.seed(`v1Groups/${GROUP}`, { groupId: GROUP, deletionCleanupUserId: OWNER });
    };
    f.beforeList(invalidate);
    assert.equal((await f.request(collection, { token })).status, 403, change + ' in-flight data');
    assert.equal((await f.request(collection, { token, headers: { 'if-none-match': etag } })).status, 403, change + ' conditional read');
    assert.equal((await f.request(collection + '/task_one', { token })).status, 403, change + ' item');
  }
  // Revoke precisely after state resolution but before the conditional-response authorization check.
  const f = await fixture();
  const { agent, token } = (await (await f.issue()).json()).data;
  const etag = (await f.request(collection, { token })).headers.get('etag');
  const api = createV1TasksApi({ agents: f.grants, tasks: { ...f.tasks, async readState(...args) { const result = await f.tasks.readState(...args); await f.grants.revoke(OWNER, agent.agentId); return result; } }, users: {}, verifyIdToken: () => { throw new Error('No human fallback'); } });
  assert.equal((await api.fetch(new Request('http://fixture.invalid' + collection, { headers: { authorization: `Bearer ${token}`, 'if-none-match': etag } }))).status, 403);
});

test('grant creation fences concurrent membership/account changes and account cleanup is batched and retryable', async () => {
  for (const change of ['member', 'owner']) {
    const f = await fixture();
    f.beforeCommit(() => f.seed(change === 'member' ? `v1Groups/${GROUP}/members/${OWNER}` : `v1UserDirectory/${OWNER}`, change === 'member' ? { membershipId: 'replacement' } : { userId: OWNER, deletionState: 'pending' }));
    assert.equal((await f.issue()).status, 500);
    assert.equal([...f.firestore.documents.keys()].filter(k => k.includes('/v1AgentGrants/')).length, 0);
  }
  const f = await fixture();
  const { agent } = (await (await f.issue()).json()).data;
  const original = f.firestore.documents.get(ROOT + `v1AgentGrants/${agent.agentId}`);
  for (let index = 1; index <= 205; index++) {
    const id = `agt_${index.toString(16).padStart(32, '0')}`;
    const document = structuredClone(original); document.name = ROOT + `v1AgentGrants/${id}`; document.fields.agentId.stringValue = id;
    f.firestore.documents.set(document.name, document);
  }
  f.seed('v1AgentGrants/other-owner', { ownerUserId: 'user_other' });
  assert.equal(await f.grants.removeAllForUser(OWNER), 205);
  assert.equal(await f.grants.removeAllForUser(OWNER), 0);
  assert.ok(f.firestore.documents.has(ROOT + 'v1AgentGrants/other-owner'));
});

test('actual CLI task list/show use the explicit agent token file with no human refresh or identity fallback', async t => {
  const f = await fixture();
  const { agent, token } = (await (await f.issue()).json()).data;
  const directory = await mkdtemp(join(tmpdir(), 'openjob-agent-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'agent-token');
  await writeFile(file, token + '\n', { mode: 0o600 });
  const paths = [];
  const server = createServer(async (req, res) => {
    paths.push(req.url);
    const response = await f.taskApi.fetch(new Request(`http://fixture.invalid${req.url}`, { headers: req.headers }));
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const run = args => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['cli/openjob.mjs', ...args], { env: { ...process.env, NODE_ENV: 'test', OPENJOB_API_URL: base + '/api/v1', OPENJOB_TEST_AUTH_URL: base, OPENJOB_TEST_FIREBASE_API_KEY: 'fixture', OPENJOB_TEST_GOOGLE_CLIENT_ID: 'fixture.apps.googleusercontent.com', OPENJOB_CREDENTIAL_FILE: join(directory, 'absent') }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', c => stdout += c); child.stderr.on('data', c => stderr += c); child.on('error', reject); child.on('close', status => resolve({ status, stdout, stderr }));
  });
  const options = ['--group', GROUP, '--agent-token-file', file, '--format', 'json'];
  const listed = await run(['task', 'list', ...options]);
  assert.equal(listed.status, 0, listed.stderr); assert.equal(JSON.parse(listed.stdout).data.length, 2);
  const shown = await run(['task', 'show', 'task_one', ...options]);
  assert.equal(shown.status, 0, shown.stderr); assert.equal(JSON.parse(shown.stdout).data.taskId, 'task_one');
  await f.grants.revoke(OWNER, agent.agentId);
  const denied = await run(['task', 'list', ...options]);
  assert.notEqual(denied.status, 0); assert.match(denied.stderr, /agent_access_denied/);
  assert.equal((await run(['task', 'list', '--agent-token-file', file])).status, 2);
  assert.equal((await run(['task', 'delete', 'task_one', ...options])).status, 2);
  assert.ok(paths.every(path => path.startsWith(collection)), JSON.stringify(paths));
  assert.equal((listed.stdout + shown.stdout + denied.stderr).includes(token), false);
});

test('actual owner CLI lists and confirms revocation through the shared API without broadening agent access', async t => {
  const f = await fixture();
  const { agent, token } = (await (await f.issue()).json()).data;
  const directory = await mkdtemp(join(tmpdir(), 'openjob-owner-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const credential = join(directory, 'human-credential');
  await writeFile(credential, 'fixture-refresh', { mode: 0o600 });
  let humanToken = 'fixture-human';
  let failDelete = false;
  const calls = [];
  const server = createServer(async (req, res) => {
    calls.push({ method: req.method, path: req.url });
    if (req.url === '/firebase/token?key=fixture') {
      for await (const chunk of req) { void chunk; }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id_token: humanToken, refresh_token: 'fixture-refresh' }));
      return;
    }
    if (failDelete && req.method === 'DELETE') {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'internal_error', message: 'Fixture failure.', requestId: 'req_fixture' } }));
      return;
    }
    const response = await f.admin.fetch(new Request(`http://fixture.invalid${req.url}`, { method: req.method, headers: req.headers }));
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const run = args => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['cli/openjob.mjs', ...args], { env: { ...process.env, NODE_ENV: 'test', OPENJOB_API_URL: base + '/api/v1', OPENJOB_TEST_AUTH_URL: base, OPENJOB_TEST_FIREBASE_API_KEY: 'fixture', OPENJOB_TEST_GOOGLE_CLIENT_ID: 'fixture.apps.googleusercontent.com', OPENJOB_TEST_CREDENTIAL_FILE: credential }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', c => stdout += c); child.stderr.on('data', c => stderr += c); child.on('error', reject); child.on('close', status => resolve({ status, stdout, stderr }));
  });
  const outputs = [];
  const json = await run(['agent', 'list', '--format', 'json']); outputs.push(json);
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout).data, [agent]);
  const table = await run(['agent', 'list']); outputs.push(table);
  assert.equal(table.status, 0, table.stderr);
  for (const value of ['AGENT_ID', 'GROUP_ID', 'SCOPE', 'EXPIRES_AT', agent.agentId, agent.name, agent.groupId, agent.scope, agent.expiresAt]) assert.ok(table.stdout.includes(value), value);
  const jsonl = await run(['agent', 'list', '--format', 'jsonl']); outputs.push(jsonl);
  assert.equal(jsonl.status, 0, jsonl.stderr); assert.deepEqual(JSON.parse(jsonl.stdout), agent);
  const output = join(directory, 'grants.json');
  const fileResult = await run(['agent', 'list', '--format', 'json', '--out', output]); outputs.push(fileResult);
  assert.equal(fileResult.status, 0, fileResult.stderr); assert.equal(fileResult.stdout, '');
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')).data, [agent]);
  assert.equal((await stat(output)).mode & 0o777, 0o600);
  const callCount = calls.length;
  for (const args of [
    ['agent', 'revoke', agent.agentId], ['agent', 'revoke', 'agt_invalid', '--yes'],
    ['agent', 'revoke', '../me', '--yes'], ['agent', 'list', '--agent-token-file', '/absent'],
    ['agent', 'revoke', agent.agentId, '--yes', '--agent-token-file', '/absent'],
    ['agent', 'list', '--group', GROUP], ['agent', 'revoke', agent.agentId, '--yes', '--out', output],
  ]) {
    const result = await run(args); outputs.push(result);
    assert.equal(result.status, 2, JSON.stringify(args) + result.stderr);
  }
  assert.equal(calls.length, callCount, 'invalid or unconfirmed commands do not authenticate or mutate');
  humanToken = 'fixture-other';
  const foreignList = await run(['agent', 'list', '--format', 'json']); outputs.push(foreignList);
  assert.deepEqual(JSON.parse(foreignList.stdout).data, []);
  const foreignRevoke = await run(['agent', 'revoke', agent.agentId, '--yes']); outputs.push(foreignRevoke);
  assert.notEqual(foreignRevoke.status, 0); assert.match(foreignRevoke.stderr, /not_found/); assert.equal(foreignRevoke.stdout, '');
  assert.equal((await f.request(collection, { token })).status, 200);
  humanToken = 'fixture-human'; failDelete = true;
  const deleteCount = calls.filter(c => c.method === 'DELETE').length;
  const failed = await run(['agent', 'revoke', agent.agentId, '--yes']); outputs.push(failed);
  assert.notEqual(failed.status, 0); assert.equal(failed.stdout, '');
  assert.equal(calls.filter(c => c.method === 'DELETE').length, deleteCount + 1, 'failed mutation is not retried');
  assert.equal((await f.request(collection, { token })).status, 200);
  failDelete = false;
  const revoked = await run(['agent', 'revoke', agent.agentId, '--yes', '--format', 'json']); outputs.push(revoked);
  assert.equal(revoked.status, 0, revoked.stderr); assert.deepEqual(JSON.parse(revoked.stdout).data, { agentId: agent.agentId, revoked: true });
  assert.equal((await f.request(collection, { token })).status, 403);
  const repeated = await run(['agent', 'revoke', agent.agentId, '--yes']); outputs.push(repeated);
  assert.notEqual(repeated.status, 0); assert.match(repeated.stderr, /not_found/); assert.equal(repeated.stdout, '');
  const empty = await run(['agent', 'list', '--format', 'json']); outputs.push(empty);
  assert.deepEqual(JSON.parse(empty.stdout).data, []);
  for (const secret of [token, 'fixture-refresh', 'fixture-human', 'fixture-other', 'tokenHash', 'membershipId']) assert.equal(JSON.stringify(outputs).includes(secret), false, secret);
});
