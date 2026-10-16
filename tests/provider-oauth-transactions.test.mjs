import assert from 'node:assert/strict';
import test from 'node:test';
import { createMockProviderOAuthTransactions } from '../server/providers/provider-oauth-transactions.ts';
import { MOCK_OAUTH_SCOPES } from '../server/providers/provider-oauth-types.ts';
const NOW = Date.parse('2026-10-17T00:00:00Z');
const row = (hash = 'a'.repeat(43)) => ({ stateHash: hash, ownerId: 'user_alex', accountId: 'gmail_new', expectedSubject: 'google_sub', label: 'Mock transaction', callbackUri: 'https://openjob.example.invalid/mock/callback', clientId: 'mock_client', scopes: [...MOCK_OAUTH_SCOPES], nonce: 'n'.repeat(43), verifier: 'v'.repeat(43), createdAt: NOW, expiresAt: NOW + 600000, mode: 'mock' });

test('atomic mock consumption does not burn foreign state and detaches stored input', async () => {
  const store = createMockProviderOAuthTransactions({ now: () => NOW }); const input = row(); await store.create(input); input.label = 'External edit'; input.scopes.length = 0;
  assert.equal(await store.consumeForOwner('user_sam', input.stateHash), null);
  const results = await Promise.all([store.consumeForOwner('user_alex', input.stateHash), store.consumeForOwner('user_alex', input.stateHash)]);
  assert.equal(results.filter(Boolean).length, 1); assert.equal(results.find(Boolean).label, 'Mock transaction'); assert.deepEqual(results.find(Boolean).scopes, [...MOCK_OAUTH_SCOPES]);
  assert.equal(await store.consumeForOwner('user_alex', input.stateHash), null);
});

test('mock transaction capacity is bounded and expired rows are pruned before new starts', async () => {
  let now = NOW; const store = createMockProviderOAuthTransactions({ now: () => now });
  for (let index = 0; index < 1000; index++) await store.create(row(index.toString(36).padStart(43, '_')));
  await assert.rejects(store.create(row('b'.repeat(43))), error => error.code === 'transaction_capacity');
  now = NOW + 600000;
  await store.create({ ...row('b'.repeat(43)), createdAt: now, expiresAt: now + 600000 });
  assert.equal(await store.consumeForOwner('user_alex', 'a'.repeat(43)), null);
  assert.ok(await store.consumeForOwner('user_alex', 'b'.repeat(43)));
  await assert.rejects(store.create(row()), error => error.code === 'invalid_transaction');
});
