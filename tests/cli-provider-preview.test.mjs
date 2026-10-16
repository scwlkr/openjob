import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createV1ProviderPreviewApi } from '../server/v1-provider-preview.ts';
import { createFirebaseIdTokenVerifier } from '../server/firebase-id-token.ts';
import { createTestFirebaseAuthority } from './support/firebase-id-tokens.mjs';
import { createOpenApiResponseValidator } from './support/openapi-response.mjs';
import { createMockProviderConnectionHarness } from './support/mock-provider-connections.mjs';

async function harness(t, { mockConnections = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'openjob-provider-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const credential = join(directory, 'human-credential'); await writeFile(credential, 'fixture-a', { mode: 0o600 });
  const now = '2026-07-15T12:00:00.000Z'; const authority = await createTestFirebaseAuthority({ now });
  const tokens = { a: await authority.issue({ uid: 'firebase_a' }), b: await authority.issue({ uid: 'firebase_b' }) };
  const verifyIdToken = createFirebaseIdTokenVerifier({ projectId: 'openjob-dev', now: () => Date.parse(now), fetchImplementation: authority.fetch });
  const mock = mockConnections ? await createMockProviderConnectionHarness({ owners: { alex: 'user_a', sam: 'user_b' }, isOwnerActive: async () => true }) : undefined;
  let connectionError;
  const connections = mock ? { listAccounts: owner => mock.reader.listAccounts(owner), async listMessages(input) { if (connectionError) throw Object.assign(new Error('private upstream token detail'), { code: connectionError }); return mock.reader.listMessages(input); } } : undefined;
  const api = createV1ProviderPreviewApi({ verifyIdToken, connections, users: { async resolve(identity) { return { userId: identity.uid === 'firebase_a' ? 'user_a' : 'user_b', username: null }; } } });
  const validate = await createOpenApiResponseValidator(); const calls = [], failures = [];
  const server = createServer(async (req, res) => {
    try {
      let body = ''; for await (const chunk of req) body += chunk;
      calls.push({ path: req.url, method: req.method, headers: req.headers });
      if (req.url === '/firebase/token?key=fixture') {
        const account = new URLSearchParams(body).get('refresh_token') === 'fixture-b' ? 'b' : 'a';
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id_token: tokens[account], refresh_token: `fixture-${account}` })); return;
      }
      const response = await api.fetch(new Request(`http://fixture.invalid${req.url}`, { method: req.method, headers: req.headers }));
      await validate(response.clone(), '/api/v1/workspace/provider-preview', 'get');
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
    } catch (error) { failures.push(error); res.writeHead(500); res.end('Fixture response failed'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const run = args => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['cli/openjob.mjs', 'workspace', 'providers', ...args], { env: { ...process.env, NODE_ENV: 'test', OPENJOB_API_URL: base + '/api/v1', OPENJOB_TEST_AUTH_URL: base, OPENJOB_TEST_FIREBASE_API_KEY: 'fixture', OPENJOB_TEST_GOOGLE_CLIENT_ID: 'fixture.apps.googleusercontent.com', OPENJOB_TEST_CREDENTIAL_FILE: credential }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; }); child.on('error', reject); child.on('close', status => resolve({ status, stdout, stderr }));
  });
  return { directory, calls, failures, run, mock, faultConnection(code) { connectionError = code; }, async owner(account) { await writeFile(credential, `fixture-${account}`, { mode: 0o600 }); } };
}

test('existing human CLI reads the shared synthetic adapter with scoped account selection and pagination', async t => {
  const f = await harness(t);
  const ok = async args => { const result = await f.run(['--format', 'json', ...args]); assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout).data; };
  const initial = await ok([]);
  assert.equal(initial.mode, 'synthetic'); assert.equal(initial.messages.length, 2); assert.ok(initial.nextCursor);
  assert.equal(initial.connectors.length, 3);
  assert.deepEqual(Object.keys(initial.connectors[0]).sort(), ['adapter', 'consent', 'implementedOperations', 'liveExecutionEnabled', 'message', 'provider', 'status', 'unsupportedOperations']);
  assert.equal(initial.connectors[0].adapter, 'gmail-rest-read'); assert.equal(initial.connectors[0].status, 'not_connected');
  assert.equal(initial.connectors[0].consent, 'required'); assert.equal(initial.connectors[0].liveExecutionEnabled, false);
  assert.deepEqual(initial.connectors[0].implementedOperations, ['mail.read', 'mail.labels']);
  assert.match(initial.connectors[0].message, /no live account is connected/i);
  assert.match(initial.connectors[0].message, /runtime execution remains disabled/i);
  assert.match(initial.connectors[0].message, /explicit consent/i);
  assert.equal(initial.accounts.every(account => !account.capabilities.send.available && !account.capabilities.calendarWrite.available), true);
  const next = await ok(['--account', initial.selectedAccountId, '--cursor', initial.nextCursor]);
  assert.equal(next.messages.length, 1); assert.equal(next.nextCursor, null);
  assert.equal(next.messages.some(message => initial.messages.some(previous => previous.id === message.id)), false);
  const secondAccount = initial.accounts.filter(account => account.provider === 'gmail')[1];
  const second = await ok(['--account', secondAccount.id]);
  assert.equal(initial.messages[0].upstreamId, second.messages[0].upstreamId);
  assert.notEqual(initial.messages[0].id, second.messages[0].id);
  assert.equal(initial.messages[0].upstreamThreadId, second.messages[0].upstreamThreadId);
  assert.notEqual(initial.messages[0].threadId, second.messages[0].threadId);
  for (const blocked of initial.accounts.filter(account => account.status !== 'ready')) {
    const data = await ok(['--account', blocked.id]); assert.equal(data.selectedAccountId, blocked.id); assert.deepEqual(data.messages, []); assert.deepEqual(data.events, []);
  }
  const output = join(f.directory, 'providers.json');
  const filed = await f.run(['--format', 'json', '--out', output]); assert.equal(filed.status, 0, filed.stderr); assert.equal(filed.stdout, '');
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')).data, initial);
  await f.owner('b');
  const foreign = await f.run(['--account', initial.selectedAccountId, '--format', 'json']);
  assert.notEqual(foreign.status, 0); assert.match(foreign.stderr, /forbidden/); assert.equal(foreign.stdout, ''); assert.equal(foreign.stderr.includes(initial.selectedAccountId), false);
  const b = await ok([]); assert.notEqual(b.selectedAccountId, initial.selectedAccountId);
  assert.deepEqual(b.connectors, initial.connectors, 'public adapter catalog does not disclose owner identity or credentials');
  assert.equal(f.calls.filter(call => call.path.startsWith('/api/')).every(call => call.method === 'GET' && !call.headers['x-openjob-fixture-owner'] && !call.headers['x-openjob-fixture-agent']), true);
  assert.deepEqual(f.failures, []);
});

test('provider CLI rejects agent credentials and invalid query options before authentication', async t => {
  const f = await harness(t);
  for (const args of [
    ['--agent-token-file', '/absent'], ['--account', ''], ['--account', '../private'],
    ['--account', 'x'.repeat(129)], ['--cursor', 'x'.repeat(4097)], ['--cursor', 'private\nvalue'],
    ['--cursor', 'a', '--cursor', 'b'], ['--group', 'grp_fixture'], ['--input', '-'],
    ['--source', 'mock'], ['--live', 'true'], ['--token', 'private'],
  ]) { const result = await f.run(args); assert.equal(result.status, 2, result.stderr); assert.equal(result.stdout, ''); }
  assert.deepEqual(f.calls, []);
});

test('existing CLI selects owned mock protocol accounts with broker denial, revocation and generic upstream errors', async t => {
  const f = await harness(t, { mockConnections: true });
  const ok = async args => { const result = await f.run(['--format', 'json', ...args]); assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout).data; };
  const first = await ok(['--account', f.mock.accountIds.alex]);
  assert.equal(first.mode, 'mock'); assert.equal(first.messages.length, 2); assert.match(first.messages[0].body, /Gmail wire mapper for alex/);
  const next = await ok(['--account', f.mock.accountIds.alex, '--cursor', first.nextCursor]);
  assert.equal(next.messages.length, 1); assert.equal(next.nextCursor, null); assert.equal(next.syncCursor, null);
  assert.equal(first.connectors[0].liveExecutionEnabled, false);
  const serialized = JSON.stringify([first, next]);
  for (const field of ['credentialRef', 'revision', 'scopes', 'accessToken', 'broker']) assert.equal(serialized.includes(`"${field}":`), false, field);
  for (const secret of ['fixture_ref_', 'mock_access_']) assert.equal(serialized.includes(secret), false);
  const counters = { ...f.mock.counters };
  const consent = await ok(['--account', f.mock.accountIds.consent]);
  assert.equal(consent.accounts.find(account => account.id === f.mock.accountIds.consent).status, 'needs_consent'); assert.deepEqual(consent.messages, []);
  assert.deepEqual(f.mock.counters, counters);
  await f.owner('b'); const foreign = await f.run(['--account', f.mock.accountIds.alex, '--format', 'json']);
  assert.notEqual(foreign.status, 0); assert.match(foreign.stderr, /forbidden/); assert.equal(foreign.stdout, '');
  assert.deepEqual(f.mock.counters, counters);
  await f.owner('a'); f.faultConnection('authentication_required');
  const authCount = f.calls.filter(call => call.path.startsWith('/firebase/')).length;
  const upstream = await f.run(['--account', f.mock.accountIds.alex, '--format', 'json']);
  assert.notEqual(upstream.status, 0); assert.match(upstream.stderr, /provider_unavailable/); assert.equal(upstream.stderr.includes('private'), false);
  assert.equal(f.calls.filter(call => call.path.startsWith('/firebase/')).length, authCount + 1, 'upstream authentication failure does not replay human credential refresh');
  f.faultConnection(undefined); f.mock.controls.revoke(f.mock.accountIds.alex);
  const revoked = await ok(['--account', f.mock.accountIds.alex]);
  assert.equal(revoked.accounts.find(account => account.id === f.mock.accountIds.alex).status, 'revoked'); assert.deepEqual(revoked.messages, []);
  assert.deepEqual(f.mock.counters, counters); assert.deepEqual(f.failures, []);
});

test('existing CLI reads Outlook Graph mock pages and denies foreign/revoked accounts without credential leakage', async t => {
  const f = await harness(t, { mockConnections: true });
  const ok = async args => { const result = await f.run(['--format', 'json', ...args]); assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout).data; };
  const first = await ok(['--account', f.mock.accountIds.outlookAlex]);
  assert.equal(first.messages.length, 2); assert.equal(first.messages[0].subject, 'Outlook fixture: prepare the launch'); assert.match(first.messages[0].body, /Outlook Graph wire mapper for alex/);
  const next = await ok(['--account', f.mock.accountIds.outlookAlex, '--cursor', first.nextCursor]); assert.equal(next.messages.length, 1); assert.equal(next.nextCursor, null); assert.equal(next.syncCursor, null);
  assert.deepEqual(first.connectors.map(row => [row.provider, row.adapter]), [['gmail', 'gmail-rest-read'], ['outlook', 'outlook-graph-read'], ['imap', 'imap-inbox-read']]);
  for (const secret of ['fixture_outlook_ref_', 'mock_outlook_access_', '"accessToken"', '"credentialRef"', '"scopes"', '"revision"']) assert.equal(JSON.stringify([first, next]).includes(secret), false);
  const before = { ...f.mock.counters };
  const consent = await ok(['--account', f.mock.accountIds.outlookConsent]); assert.deepEqual(consent.messages, []); assert.deepEqual(f.mock.counters, before);
  await f.owner('b'); const denied = await f.run(['--account', f.mock.accountIds.outlookAlex, '--format', 'json']); assert.notEqual(denied.status, 0); assert.match(denied.stderr, /forbidden/); assert.equal(denied.stdout, ''); assert.deepEqual(f.mock.counters, before);
  await f.owner('a'); f.mock.controls.revoke(f.mock.accountIds.outlookAlex); const revoked = await ok(['--account', f.mock.accountIds.outlookAlex]); assert.deepEqual(revoked.messages, []); assert.deepEqual(f.mock.counters, before); assert.deepEqual(f.failures, []);
});

test('existing CLI reads IMAP mock raw-byte pages and denies foreign/revoked accounts without private configuration', async t => {
  const f = await harness(t, { mockConnections: true });
  const ok = async args => { const result = await f.run(['--format', 'json', ...args]); assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout).data; };
  const first = await ok(['--account', f.mock.accountIds.imapAlex]);
  assert.equal(first.messages.length, 2); assert.equal(first.messages[0].subject, 'IMAP fixture: prepare the launch'); assert.match(first.messages[0].body, /IMAP wire mapper for alex/);
  const next = await ok(['--account', f.mock.accountIds.imapAlex, '--cursor', first.nextCursor]); assert.equal(next.messages.length, 1); assert.equal(next.nextCursor, null); assert.equal(next.syncCursor, null);
  assert.deepEqual(first.connectors.map(row => [row.provider, row.adapter]), [['gmail', 'gmail-rest-read'], ['outlook', 'outlook-graph-read'], ['imap', 'imap-inbox-read']]);
  for (const secret of ['fixture_imap_ref_', 'mock_imap_session_', 'fixture_server_', 'fixture_imap_user_', '"serverId"', '"username"', '"accessToken"', '"credentialRef"', '"scopes"', '"revision"']) assert.equal(JSON.stringify([first, next]).includes(secret), false, secret);
  const before = { ...f.mock.counters };
  const consent = await ok(['--account', f.mock.accountIds.imapConsent]); assert.deepEqual(consent.messages, []); assert.deepEqual(f.mock.counters, before);
  await f.owner('b'); const denied = await f.run(['--account', f.mock.accountIds.imapAlex, '--format', 'json']); assert.notEqual(denied.status, 0); assert.match(denied.stderr, /forbidden/); assert.equal(denied.stdout, ''); assert.deepEqual(f.mock.counters, before);
  await f.owner('a'); f.mock.controls.revoke(f.mock.accountIds.imapAlex); const revoked = await ok(['--account', f.mock.accountIds.imapAlex]); assert.deepEqual(revoked.messages, []); assert.deepEqual(f.mock.counters, before); assert.deepEqual(f.failures, []);
});
