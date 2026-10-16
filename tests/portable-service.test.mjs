import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { serviceConfiguration } from '../deployment/service-config.mjs';

async function service(extra = {}) {
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(r => reservation.close(r));
  const env = { ...process.env, OPENJOB_NO_UPDATE_CHECK: '1' };
  for (const key of Object.keys(env)) if (key.startsWith('FIREBASE_') || key === 'OPENJOB_PUBLIC_ORIGIN' || key === 'APPLE_SIGN_IN_SERVICE_ID') delete env[key];
  const child = spawn(process.execPath, [resolve('dist/npm/openjob.mjs'), 'server', '--port', String(port)], { env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit'); let output = '';
  child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  const deadline = Date.now() + 10000;
  while (!output.includes('OpenJob service:')) {
    if (child.exitCode !== null || Date.now() > deadline) { child.kill('SIGTERM'); throw new Error(`Portable service did not start: ${output}`); }
    await new Promise(r => setTimeout(r, 25));
  }
  return { port, origin: `http://127.0.0.1:${port}`, async stop() { child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 3000); await exited; clearTimeout(timer); } };
}

test('missing service configuration is explicit, real assets load, and fixture sessions never exist', async () => {
  const app = await service();
  try {
    const health = await fetch(app.origin + '/healthz'); assert.equal(health.status, 503);
    assert.equal((await health.json()).configured, false);
    const html = await (await fetch(app.origin + '/workspace')).text();
    const assets = [...html.matchAll(/(?:src|href)="([^"\s]+\.(?:js|css))"/g)].map(m => m[1]);
    assert.ok(assets.length >= 2);
    for (const asset of assets) assert.equal((await fetch(app.origin + asset)).status, 200);
    assert.equal((await fetch(app.origin + '/__test/session/alex')).status, 404);
    assert.equal((await fetch(app.origin + '/api/v1/workspace/snapshot')).status, 503);
    assert.equal((await fetch(app.origin + '/package.json')).status, 404);
    assert.equal((await fetch(app.origin + '/healthz', { headers: { origin: 'https://foreign.example' } })).status, 403);
    const publicConfig = await (await fetch(app.origin + '/runtime-config')).json();
    assert.deepEqual(Object.keys(publicConfig).sort(), ['appleServiceId', 'firebase']);
  } finally { await app.stop(); }
});

test('configured service rejects anonymous and fixture-header identities without substituting a demo user', async () => {
  const app = await service({ FIREBASE_PROJECT_ID: 'portable-test', FIREBASE_API_KEY: 'public-test-value', FIREBASE_APP_ID: 'public-test-app', FIREBASE_AUTH_DOMAIN: 'example.invalid', FIREBASE_CLIENT_EMAIL: 'synthetic@example.invalid', FIREBASE_PRIVATE_KEY: 'not-a-real-private-key' });
  try {
    assert.equal((await fetch(app.origin + '/healthz')).status, 200);
    for (const path of ['/api/v1/me', '/api/v1/workspace/snapshot']) assert.equal((await fetch(app.origin + path, { headers: { 'x-openjob-fixture-owner': 'alex' } })).status, 401);
    const publicConfig = JSON.stringify(await (await fetch(app.origin + '/runtime-config')).json());
    assert.equal(publicConfig.includes('not-a-real-private-key'), false);
    assert.equal(publicConfig.includes('synthetic@example.invalid'), false);
    assert.equal((await fetch(app.origin + '/__test/session/alex')).status, 404);
  } finally { await app.stop(); }
});

test('configuration reports an unreadable key file by field name without leaking its path', async () => {
  const config = await serviceConfiguration({ FIREBASE_PRIVATE_KEY_FILE: '/missing/portable-test-key' });
  assert.ok(config.missing.includes('FIREBASE_PRIVATE_KEY_FILE (unreadable)'));
  assert.equal(JSON.stringify(config.missing).includes('/missing'), false);
});

test('container health probe preserves public Host while connecting to loopback', async () => {
  const config = { OPENJOB_PUBLIC_ORIGIN: 'https://portable.example.invalid', FIREBASE_PROJECT_ID: 'portable-test', FIREBASE_API_KEY: 'public-test-value', FIREBASE_APP_ID: 'public-test-app', FIREBASE_AUTH_DOMAIN: 'example.invalid', FIREBASE_CLIENT_EMAIL: 'synthetic@example.invalid', FIREBASE_PRIVATE_KEY: 'not-a-real-private-key' };
  const app = await service(config);
  try {
    assert.equal((await fetch(app.origin + '/healthz')).status, 403);
    const probe = spawnSync(process.execPath, ['deployment/healthcheck.mjs', String(app.port)], { env: { ...process.env, OPENJOB_PUBLIC_ORIGIN: config.OPENJOB_PUBLIC_ORIGIN }, timeout: 4000 });
    assert.equal(probe.status, 0);
  } finally { await app.stop(); }
});
