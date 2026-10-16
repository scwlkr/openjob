import test from 'node:test';
import assert from 'node:assert/strict';
import { createV1ProviderPreviewApi, createV1ProviderPreviewHandler } from '../server/v1-provider-preview.ts';
import { createProviderPreview } from '../shared/provider-preview.ts';
import { createFirebaseIdTokenVerifier } from '../server/firebase-id-token.ts';
import { createTestFirebaseAuthority } from './support/firebase-id-tokens.mjs';
import { createOpenApiResponseValidator } from './support/openapi-response.mjs';
import { InactiveUserError } from '../db/user-history.ts';

const now = '2026-07-15T12:00:00.000Z';
const authorityPromise = createTestFirebaseAuthority({ now });
async function fixture() {
  const authority = await authorityPromise;
  const verifier = createFirebaseIdTokenVerifier({ projectId: 'openjob-dev', now: () => Date.parse(now), fetchImplementation: authority.fetch });
  const tokens = { a: await authority.issue({ uid: 'firebase_a' }), b: await authority.issue({ uid: 'firebase_b' }), rogue: await authority.issue({ uid: 'firebase_a', signer: 'rogue' }) };
  const users = new Map([['firebase_a', { userId: 'user_a', username: 'alex' }], ['firebase_b', { userId: 'user_b', username: 'sam' }]]);
  const hooks = {}, calls = []; let verifies = 0;
  const api = createV1ProviderPreviewApi({
    users: { async resolve(identity) { return users.get(identity.uid) ?? null; } },
    async verifyIdToken(request) { verifies++; return verifier(request); },
    async preview(ownerId, input) { calls.push({ ownerId, input }); const result = await createProviderPreview({ ownerId, ...input }); await hooks.afterRead?.(); return result; },
    requestId: () => 'req_provider_fixture',
  });
  const request = (query = '', { token = 'a', headers = {}, method = 'GET' } = {}) => api.fetch(new Request(`https://openjob.example.invalid/api/v1/workspace/provider-preview${query ? '?' + query : ''}`, { method, headers: { authorization: `Bearer ${tokens[token] ?? token}`, ...headers } }));
  return { request, calls, users, hooks, get verifies() { return verifies; } };
}

test('signed provider preview uses account-qualified owner references, cursor isolation and explicit synthetic capabilities', async () => {
  const f = await fixture(); const validate = await createOpenApiResponseValidator();
  const response = await f.request('', { headers: { 'x-openjob-fixture-owner': 'user_b', 'x-openjob-fixture-agent': 'ignored' } });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  await validate(response.clone(), '/api/v1/workspace/provider-preview', 'get');
  const preview = (await response.json()).data;
  assert.equal(preview.mode, 'synthetic'); assert.equal(f.calls[0].ownerId, 'user_a');
  assert.equal(preview.accounts.filter(account => account.provider === 'gmail').length, 2);
  assert.equal(preview.accounts.every(account => account.mode === 'synthetic' && !account.capabilities.send.available && !account.capabilities.draft.available && !account.capabilities.calendarWrite.available), true);
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
});

test('provider preview rejects opaque agents, forged authentication and malformed query before adapter reads', async () => {
  const f = await fixture();
  assert.equal((await f.request('', { token: 'rogue' })).status, 401);
  const checked = f.verifies;
  for (const token of ['oj_personal_user_a.agt_' + 'a'.repeat(32) + '.' + 'A'.repeat(43), 'oj_agent_agt_' + 'a'.repeat(32) + '.' + 'A'.repeat(43), 'oj_unknown']) {
    const response = await f.request('', { headers: { authorization: `bEaReR   ${token}` } });
    assert.equal(response.status, 401); assert.equal(f.verifies, checked);
  }
  for (const query of ['accountId=', 'cursor=', 'accountId=a&accountId=b', 'cursor=x&cursor=y', 'ownerId=user_b', 'accountId=../private', 'cursor=' + 'x'.repeat(513), 'cursor=%0Aprivate']) {
    const response = await f.request(query); assert.equal(response.status, 400);
    const body = await response.json(); assert.equal(body.error.requestId, 'req_provider_fixture'); assert.equal(JSON.stringify(body).includes('private'), false);
  }
  assert.equal((await f.request('', { headers: { origin: 'https://attacker.example.invalid' } })).status, 403);
  assert.equal((await f.request('', { method: 'POST' })).status, 404);
  assert.equal(f.calls.length, 0);
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
  for (const [error, status, code] of [[new InactiveUserError('user_a'), 410, 'account_deletion_pending'], [Object.assign(new Error('private'), { code: 'RESOURCE_EXHAUSTED' }), 429, 'rate_limited'], [Object.assign(new Error('private'), { code: 'provider_unavailable' }), 409, 'provider_unavailable'], [new Error('private'), 500, 'internal_error']]) {
    const f = await fixture(); f.hooks.afterRead = () => { throw error; };
    const response = await f.request(); assert.equal(response.status, status); await validate(response.clone(), '/api/v1/workspace/provider-preview', 'get');
    const body = await response.json(); assert.equal(body.error.code, code); assert.equal(JSON.stringify(body).includes('private'), false);
  }
  const handler = createV1ProviderPreviewHandler(() => { throw new Error('private'); }, () => 'req_init');
  const response = await handler(new Request('https://openjob.example.invalid/api/v1/workspace/provider-preview'));
  assert.equal(response.status, 500); assert.equal((await response.json()).error.requestId, 'req_init');
});
