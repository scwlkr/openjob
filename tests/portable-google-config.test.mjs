import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { googleServiceConfiguration } from '../deployment/google-config.mjs';
import { createPortableRuntime } from '../server/portable-runtime.ts';
import { privateGoogleStoreFixture } from './support/private-google-store.mjs';
import { BINDING, CLIENT } from './support/google-oauth-transport.mjs';
const owner = 'user_' + 'a'.repeat(32);
const environment = { OPENJOB_GOOGLE_CONNECTIONS_MODE: 'configured', OPENJOB_PUBLIC_ORIGIN: 'https://chosen-host.example.invalid', OPENJOB_GOOGLE_CLIENT_ID: CLIENT, OPENJOB_GOOGLE_KEY_ID: 'synthetic-v1', OPENJOB_GOOGLE_OWNER_USER_ID: owner, OPENJOB_GOOGLE_OWNER_FIREBASE_UID: 'alex', OPENJOB_GOOGLE_MAILBOX: BINDING.address, OPENJOB_GOOGLE_CLIENT_SECRET_FILE: '/synthetic/client-secret', OPENJOB_GOOGLE_KEY_FILE: '/synthetic/key' };
const secret = 'invented-client-secret';
const readSecret = async path => path === '/synthetic/client-secret' ? secret : Buffer.alloc(32, 7).toString('base64');

test('Google config disabled default reads no file; explicit invalid config never falls back or leaks secret errors', async () => {
  let reads = 0; const deny = async () => { reads++; throw new Error(secret); };
  assert.equal(await googleServiceConfiguration({}, deny), undefined);
  assert.equal(await googleServiceConfiguration({ ...environment, OPENJOB_GOOGLE_CONNECTIONS_MODE: 'disabled' }, deny), undefined); assert.equal(reads, 0);
  for (const overrides of [{ OPENJOB_GOOGLE_CONNECTIONS_MODE: 'automatic' }, { OPENJOB_PUBLIC_ORIGIN: 'http://127.0.0.1:5192' }, { OPENJOB_PUBLIC_ORIGIN: 'https://chosen-host.example.invalid/path' }, { OPENJOB_GOOGLE_OWNER_USER_ID: '' }, { OPENJOB_GOOGLE_OWNER_FIREBASE_UID: '' }, { OPENJOB_GOOGLE_MAILBOX: '' }, { OPENJOB_GOOGLE_KEY_FILE: 'relative' }]) {
    await assert.rejects(googleServiceConfiguration({ ...environment, ...overrides }, deny), error => error.message === 'Google connection configuration invalid.');
  }
  assert.equal(reads, 0);
  await assert.rejects(googleServiceConfiguration(environment, deny), error => !error.message.includes(secret));
});

test('explicit synthetic secret-file loader derives fixed callback and imports nonextractable key; malformed key fails closed', async () => {
  const config = await googleServiceConfiguration(environment, readSecret);
  assert.equal(config.key.extractable, false); assert.equal(config.key.algorithm.name, 'AES-GCM'); assert.equal(config.key.algorithm.length, 256);
  assert.equal(config.callbackUri, environment.OPENJOB_PUBLIC_ORIGIN + '/connections/google/callback');
  assert.equal(config.ownerUserId, owner); assert.equal(config.address, BINDING.address);
  await assert.rejects(googleServiceConfiguration(environment, async path => path.endsWith('key') ? 'invalid' : secret), error => error.message === 'Google connection configuration invalid.');
});

test('portable roots stay provider-unconfigured by default; opt-in pins exact User, Google binding and mailbox', async () => {
  const f = await privateGoogleStoreFixture();
  const input = { ...f.config, apiKey: 'fixture' }, options = { databaseTransport: f.db.fetch, identityTransport: f.identityTransport };
  const request = (token, body) => new Request('https://fixture.invalid/api/v1/connections', { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await createPortableRuntime(input, options).fetch(request(f.sessions.alex.token))).status, 503);
  const google = await googleServiceConfiguration({ ...environment, OPENJOB_GOOGLE_OWNER_USER_ID: f.owner }, readSecret);
  assert.throws(() => createPortableRuntime(input, { ...options, google }), /Explicit Google transports/);
  const configured = { ...options, google, googleTransport: f.protocol.transport, mailTransport: f.flowOptions.mailTransport, evidenceMode: 'google-fixture' };
  const runtime = createPortableRuntime(input, configured);
  assert.equal((await runtime.fetch(request(f.sessions.alex.token))).status, 200);
  assert.equal((await runtime.fetch(request(f.sessions.sam.token))).status, 403);
  assert.equal((await runtime.fetch(request(f.sessions.alex.token, { address: 'other@example.invalid', workspaceId: f.home }))).status, 403);
  const mismatched = createPortableRuntime(input, { ...configured, google: { ...google, firebaseUid: 'different-binding' } });
  assert.equal((await mismatched.fetch(request(f.sessions.alex.token))).status, 403);
  assert.equal(f.protocol.calls.length, 0); assert.equal(f.db.documents.has(f.location), false);
  google.ownerUserId = f.sessions.sam.user.userId; google.firebaseUid = 'sam'; google.address = 'other@example.invalid';
  assert.equal((await runtime.fetch(request(f.sessions.alex.token))).status, 200);
  assert.equal((await runtime.fetch(request(f.sessions.sam.token))).status, 403);
  assert.equal(typeof runtime.privateGoogleCleanup.removeForDeletion, 'function');
});


test('actual secret-file reader accepts only bounded synthetic regular files and redacts missing-file paths', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'openjob-google-config-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const secretFile = join(directory, 'client-secret'), keyFile = join(directory, 'key');
  await writeFile(secretFile, secret, { mode: 0o600 }); await writeFile(keyFile, Buffer.alloc(32, 7).toString('base64'), { mode: 0o600 });
  const env = { ...environment, OPENJOB_GOOGLE_CLIENT_SECRET_FILE: secretFile, OPENJOB_GOOGLE_KEY_FILE: keyFile };
  assert.equal((await googleServiceConfiguration(env)).key.extractable, false);
  await writeFile(secretFile, 'x'.repeat(4097));
  await assert.rejects(googleServiceConfiguration(env), error => error.message === 'Google connection configuration invalid.');
  await assert.rejects(googleServiceConfiguration({ ...env, OPENJOB_GOOGLE_KEY_FILE: join(directory, 'missing') }), error => !error.message.includes(directory));
});
