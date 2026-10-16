import test from 'node:test';
import assert from 'node:assert/strict';
import { createV1ProviderPreviewApi, createV1ProviderPreviewHandler } from '../server/v1-provider-preview.ts';
import { createProviderPreview } from '../shared/provider-preview.ts';
import { createFirebaseIdTokenVerifier } from '../server/firebase-id-token.ts';
import { createTestFirebaseAuthority } from './support/firebase-id-tokens.mjs';
import { createOpenApiResponseValidator } from './support/openapi-response.mjs';
import { InactiveUserError } from '../db/user-history.ts';
import { createMockProviderConnectionHarness } from './support/mock-provider-connections.mjs';

const now = '2026-07-15T12:00:00.000Z';
const authorityPromise = createTestFirebaseAuthority({ now });
async function fixture() {
  const authority = await authorityPromise;
  const verifier = createFirebaseIdTokenVerifier({ projectId: 'openjob-dev', now: () => Date.parse(now), fetchImplementation: authority.fetch });
  const tokens = { a: await authority.issue({ uid: 'firebase_a' }), b: await authority.issue({ uid: 'firebase_b' }), rogue: await authority.issue({ uid: 'firebase_a', signer: 'rogue' }) };
  const users = new Map([['firebase_a', { userId: 'user_a', username: 'alex' }], ['firebase_b', { userId: 'user_b', username: 'sam' }]]);
  const hooks = {}, calls = []; let verifies = 0;
  const options = {
    users: { async resolve(identity) { return users.get(identity.uid) ?? null; } },
    async verifyIdToken(request) { verifies++; return verifier(request); },
    async preview(ownerId, input) { calls.push({ ownerId, input }); const result = hooks.read ? await hooks.read(ownerId, input) : await createProviderPreview({ ownerId, ...input }); await hooks.afterRead?.(); return result; },
    requestId: () => 'req_provider_fixture',
  };
  let api = createV1ProviderPreviewApi(options);
  const request = (query = '', { token = 'a', headers = {}, method = 'GET' } = {}) => api.fetch(new Request(`https://openjob.example.invalid/api/v1/workspace/provider-preview${query ? '?' + query : ''}`, { method, headers: { authorization: `Bearer ${tokens[token] ?? token}`, ...headers } }));
  return { request, calls, users, hooks, connect(connections) { api = createV1ProviderPreviewApi({ ...options, preview: undefined, connections }); }, get verifies() { return verifies; } };
}

test('signed provider preview uses account-qualified owner references, cursor isolation and explicit synthetic capabilities', async () => {
  const f = await fixture(); const validate = await createOpenApiResponseValidator();
  const response = await f.request('', { headers: { 'x-openjob-fixture-owner': 'user_b', 'x-openjob-fixture-agent': 'ignored' } });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  await validate(response.clone(), '/api/v1/workspace/provider-preview', 'get');
  const preview = (await response.json()).data;
  assert.equal(preview.mode, 'synthetic'); assert.equal(f.calls[0].ownerId, 'user_a');
  assert.equal(preview.connectors.length, 2);
  const connector = preview.connectors[0];
  assert.deepEqual(Object.keys(connector).sort(), ['adapter', 'consent', 'implementedOperations', 'liveExecutionEnabled', 'message', 'provider', 'status', 'unsupportedOperations']);
  assert.equal(connector.adapter, 'gmail-rest-read'); assert.equal(connector.provider, 'gmail');
  assert.equal(connector.status, 'not_connected'); assert.equal(connector.consent, 'required'); assert.equal(connector.liveExecutionEnabled, false);
  assert.deepEqual(connector.implementedOperations, ['mail.read', 'mail.labels']);
  assert.deepEqual(connector.unsupportedOperations, ['calendar.read', 'calendar.write', 'mail.draft', 'mail.send', 'sync.history', 'reconnect']);
  assert.match(connector.message, /no live account is connected/i);
  assert.match(connector.message, /runtime execution remains disabled/i);
  assert.match(connector.message, /explicit consent/i);
  assert.equal(preview.accounts.filter(account => account.provider === 'gmail').length, 2);
  assert.equal(preview.accounts.every(account => account.mode === 'synthetic' && !account.capabilities.send.available && !account.capabilities.draft.available && !account.capabilities.calendarWrite.available), true);
  assert.equal(preview.accounts.some(account => account.id === connector.adapter), false, 'unconnected adapter catalog entries are never selectable accounts');
  assert.equal(preview.messages.every(message => message.accountId === preview.selectedAccountId), true);
  assert.ok(preview.nextCursor);
  const nextResponse = await f.request(new URLSearchParams({ accountId: preview.selectedAccountId, cursor: preview.nextCursor }).toString());
  assert.equal(nextResponse.status, 200); await validate(nextResponse.clone(), '/api/v1/workspace/provider-preview', 'get');
  const next = (await nextResponse.json()).data;
  assert.equal(next.nextCursor, null); assert.equal(next.messages.some(message => preview.messages.some(previous => previous.id === message.id)), false);
  const other = (await (await f.request('', { token: 'b' })).json()).data;
  assert.equal(other.accounts.some(account => preview.accounts.some(previous => previous.id === account.id)), false);
  assert.equal((await f.request(new URLSearchParams({ accountId: preview.selectedAccountId }).toString(), { token: 'b' })).status, 403);
  assert.equal((await f.request(new URLSearchParams({ accountId: other.selectedAccountId, cursor: preview.nextCursor }).toString(), { token: 'b' })).status, 400);
  const secondAccount = preview.accounts.filter(account => account.provider === 'gmail')[1];
  assert.equal((await f.request(new URLSearchParams({ accountId: secondAccount.id, cursor: preview.nextCursor }).toString())).status, 400);
  for (const blocked of preview.accounts.filter(account => account.status !== 'ready')) {
    const result = await f.request(new URLSearchParams({ accountId: blocked.id }).toString());
    assert.equal(result.status, 200); await validate(result.clone(), '/api/v1/workspace/provider-preview', 'get');
    const data = (await result.json()).data;
    assert.deepEqual(data.messages, []); assert.deepEqual(data.events, []); assert.equal(data.nextCursor, null);
  }
  assert.equal((await f.request(new URLSearchParams({ accountId: connector.adapter }).toString())).status, 403);
});

test('provider preview rejects opaque agents, forged authentication and malformed query before adapter reads', async () => {
  const f = await fixture();
  assert.equal((await f.request('', { token: 'rogue' })).status, 401);
  const checked = f.verifies;
  for (const token of ['oj_personal_user_a.agt_' + 'a'.repeat(32) + '.' + 'A'.repeat(43), 'oj_agent_agt_' + 'a'.repeat(32) + '.' + 'A'.repeat(43), 'oj_unknown']) {
    const response = await f.request('', { headers: { authorization: `bEaReR   ${token}` } });
    assert.equal(response.status, 401); assert.equal(f.verifies, checked);
  }
  for (const query of ['accountId=', 'cursor=', 'accountId=a&accountId=b', 'cursor=x&cursor=y', 'ownerId=user_b', 'source=mock', 'live=true', 'token=private', 'credentialRef=private', 'accountId=../private', 'cursor=' + 'x'.repeat(4097), 'cursor=%0Aprivate']) {
    const response = await f.request(query); assert.equal(response.status, 400);
    const body = await response.json(); assert.equal(body.error.requestId, 'req_provider_fixture'); assert.equal(JSON.stringify(body).includes('private'), false);
  }
  assert.equal((await f.request('', { headers: { origin: 'https://attacker.example.invalid' } })).status, 403);
  assert.equal((await f.request('', { method: 'POST' })).status, 404);
  assert.equal(f.calls.length, 0);
});

test('provider API accepts adapter cursors up to 4096 bytes while rejecting longer query values before adapter dispatch', async () => {
  const f = await fixture();
  const snapshot = await createProviderPreview({ ownerId: 'user_a' });
  f.hooks.read = async (ownerId, input) => { assert.equal(ownerId, 'user_a'); assert.equal(input.cursor, 'x'.repeat(4096)); return snapshot; };
  assert.equal((await f.request('cursor=' + 'x'.repeat(4096))).status, 200);
  assert.equal(f.calls.length, 1);
  assert.equal((await f.request('cursor=' + 'x'.repeat(4097))).status, 400);
  assert.equal(f.calls.length, 1, 'oversized cursor never reaches the adapter');
  delete f.hooks.read;
  assert.equal((await f.request('cursor=' + 'x'.repeat(513))).status, 400, 'synthetic adapter still validates its own canonical cursor format and bound');
});

test('human provider API reads owned mock Gmail connections through the broker and hides private connection metadata', async () => {
  const f = await fixture();
  const mock = await createMockProviderConnectionHarness({ owners: { alex: 'user_a', sam: 'user_b' }, isOwnerActive: async owner => [...f.users.values()].some(user => user.userId === owner && !user.deletionPending) });
  f.connect(mock.reader);
  const validate = await createOpenApiResponseValidator();
  const request = accountId => f.request(new URLSearchParams({ accountId }).toString());
  const response = await request(mock.accountIds.alex); assert.equal(response.status, 200); await validate(response.clone(), '/api/v1/workspace/provider-preview', 'get');
  const data = (await response.json()).data;
  assert.equal(data.mode, 'mock'); assert.equal(data.selectedAccountId, mock.accountIds.alex);
  assert.equal(data.accounts.find(account => account.id === mock.accountIds.alex).mode, 'mock');
  assert.equal(data.accounts.some(account => account.id === mock.accountIds.sam), false);
  assert.equal(data.messages.length, 2); assert.match(data.messages[0].body, /Gmail wire mapper for alex/);
  assert.equal(data.syncCursor, null); assert.deepEqual(data.calendars, []); assert.deepEqual(data.events, []);
  assert.equal(data.connectors[0].liveExecutionEnabled, false);
  const serialized = JSON.stringify(data);
  for (const field of ['credentialRef', 'scopes', 'revision', 'accessToken', 'broker']) assert.equal(serialized.includes(`"${field}":`), false, field);
  for (const secret of ['mock_access_', 'fixture_ref_']) assert.equal(serialized.includes(secret), false);
  assert.ok(mock.counters.credentialLookups > 0); assert.ok(mock.counters.requests > 0);
  const before = { ...mock.counters };
  assert.equal((await f.request(new URLSearchParams({ accountId: mock.accountIds.alex }).toString(), { token: 'b' })).status, 403);
  assert.deepEqual(mock.counters, before, 'foreign selection cannot resolve provider credentials or fetch');
  const consentResponse = await request(mock.accountIds.consent); assert.equal(consentResponse.status, 200);
  const consent = (await consentResponse.json()).data;
  assert.equal(consent.accounts.find(account => account.id === mock.accountIds.consent).status, 'needs_consent'); assert.deepEqual(consent.messages, []);
  assert.deepEqual(mock.counters, before, 'missing consent stops before broker lookup');
  mock.controls.revoke(mock.accountIds.alex);
  const revokedResponse = await request(mock.accountIds.alex); assert.equal(revokedResponse.status, 200); await validate(revokedResponse.clone(), '/api/v1/workspace/provider-preview', 'get');
  const revoked = (await revokedResponse.json()).data;
  assert.equal(revoked.accounts.find(account => account.id === mock.accountIds.alex).status, 'revoked'); assert.deepEqual(revoked.messages, []);
  assert.deepEqual(mock.counters, before, 'revoked connection stops before broker lookup');
});

test('provider preview fences async reads after User removal, identity change or deletion', async () => {
  for (const next of [null, { userId: 'user_a', username: 'alex', deletionPending: true }, { userId: 'user_changed', username: 'alex' }]) {
    const f = await fixture(); f.hooks.afterRead = () => { if (next) f.users.set('firebase_a', next); else f.users.delete('firebase_a'); };
    const response = await f.request(); assert.equal(response.status, 410); assert.equal('data' in await response.json(), false);
  }
  const f = await fixture(); f.users.set('firebase_a', { userId: 'user_a', username: 'alex', deletionPending: true });
  assert.equal((await f.request()).status, 410); assert.equal(f.calls.length, 0);
  f.users.delete('firebase_a'); assert.equal((await f.request()).status, 409);
});

test('provider preview preserves generic standard failures and initialization errors', async () => {
  const validate = await createOpenApiResponseValidator();
  for (const [error, status, code] of [[new InactiveUserError('user_a'), 410, 'account_deletion_pending'], [Object.assign(new Error('private'), { code: 'RESOURCE_EXHAUSTED' }), 429, 'rate_limited'], [Object.assign(new Error('private'), { code: 'rate_limited' }), 429, 'rate_limited'], [Object.assign(new Error('private'), { code: 'provider_unavailable' }), 409, 'provider_unavailable'], ...['authentication_required', 'consent_required', 'execution_disabled', 'connection_changed', 'provider_forbidden', 'provider_error', 'network_error', 'timeout', 'malformed_response'].map(code => [Object.assign(new Error('private token and broker detail'), { code }), 409, 'provider_unavailable']), [new Error('private'), 500, 'internal_error']]) {
    const f = await fixture(); f.hooks.afterRead = () => { throw error; };
    const response = await f.request(); assert.equal(response.status, status); await validate(response.clone(), '/api/v1/workspace/provider-preview', 'get');
    const body = await response.json(); assert.equal(body.error.code, code); assert.equal(JSON.stringify(body).includes('private'), false);
  }
  const handler = createV1ProviderPreviewHandler(() => { throw new Error('private'); }, () => 'req_init');
  const response = await handler(new Request('https://openjob.example.invalid/api/v1/workspace/provider-preview'));
  assert.equal(response.status, 500); assert.equal((await response.json()).error.requestId, 'req_init');
});

test('human Outlook preview maps injected Graph pages with owner/provider cursor isolation and no secret leakage', async () => {
  const f = await fixture(); const mock = await createMockProviderConnectionHarness({ owners: { alex: 'user_a', sam: 'user_b' }, isOwnerActive: async owner => [...f.users.values()].some(user => user.userId === owner && !user.deletionPending) }); f.connect(mock.reader);
  const validate = await createOpenApiResponseValidator();
  const call = async (accountId, cursor) => { const response = await f.request(new URLSearchParams({ accountId, ...(cursor ? { cursor } : {}) }).toString()); await validate(response.clone(), '/api/v1/workspace/provider-preview', 'get'); return response; };
  const response = await call(mock.accountIds.outlookAlex); assert.equal(response.status, 200, await response.clone().text()); const first = (await response.json()).data;
  assert.equal(first.mode, 'mock'); assert.equal(first.accounts.find(account => account.id === mock.accountIds.outlookAlex).provider, 'outlook'); assert.equal(first.accounts.some(account => account.id === mock.accountIds.outlookSam), false);
  assert.equal(first.messages.length, 2); assert.equal(first.messages[0].upstreamId, 'AAMkMessage1=='); assert.equal(first.messages[0].subject, 'Outlook fixture: prepare the launch'); assert.match(first.messages[0].body, /Outlook Graph wire mapper for alex/); assert.equal(first.folders[0].name, 'Inbox'); assert.equal(first.syncCursor, null);
  const next = await call(mock.accountIds.outlookAlex, first.nextCursor); assert.equal(next.status, 200); const page = (await next.json()).data; assert.equal(page.messages.length, 1); assert.equal(page.nextCursor, null);
  assert.deepEqual(first.connectors.map(row => [row.provider, row.adapter, row.liveExecutionEnabled]), [['gmail', 'gmail-rest-read', false], ['outlook', 'outlook-graph-read', false]]);
  for (const privateValue of ['fixture_outlook_ref_', 'mock_outlook_access_', 'credentialRef', 'accessToken', 'revision', 'scopes']) assert.equal(JSON.stringify(first).includes(privateValue), false);
  assert.equal((await call(mock.accountIds.alex, first.nextCursor)).status, 400);
  const before = { ...mock.counters }; assert.equal((await f.request(new URLSearchParams({ accountId: mock.accountIds.outlookAlex }).toString(), { token: 'b' })).status, 403); assert.deepEqual(mock.counters, before);
  const consent = await call(mock.accountIds.outlookConsent); assert.equal(consent.status, 200); assert.deepEqual((await consent.json()).data.messages, []); assert.deepEqual(mock.counters, before);
  mock.controls.revoke(mock.accountIds.outlookAlex); const revoked = await call(mock.accountIds.outlookAlex); assert.equal(revoked.status, 200); assert.deepEqual((await revoked.json()).data.messages, []); assert.deepEqual(mock.counters, before);
});
