import test from 'node:test';
import assert from 'node:assert/strict';
import { onboardingFixture } from './support/onboarding-app-fixture.mjs';
import { createConnectionOnboardingStore } from '../db/connection-onboarding.ts';
import { createPersonalApplication } from '../server/personal-application.ts';
import { createFirestorePersonalWorkspaceStore } from '../db/personal-workspace.ts';
test('Connections first-account consent, cancellation, Mail and same-home reconnect use real mock OAuth/broker', async () => {
  const f = await onboardingFixture();
  let catalog = await f.call(); assert.equal(catalog.mode, 'simulated'); assert.equal(catalog.bindings.length, 0);
  const begin = () => f.call('', { choiceId: 'invented_gmail', workspaceId: f.home });
  let { connectionId: id } = await begin();
  assert.equal((await f.call()).bindings[0].status, 'consent_required');
  assert.equal(f.consent.counts.exchange, 0);
  await f.call('/' + id, { action: 'cancel' }); assert.equal((await f.call()).bindings[0].status, 'cancelled');
  assert.equal((await f.request('/' + id, { action: 'approve' })).status, 409);
  assert.equal((await begin()).connectionId, id);
  await f.call('/' + id, { action: 'approve' }); catalog = await f.call();
  assert.equal(catalog.bindings[0].address, 'alex@example.invalid'); assert.equal(catalog.bindings[0].workspaceId, f.home);
  assert.equal((await f.call('/' + id + '/mail')).page.messages[0].subject, 'Plan the invented first account');
  assert.ok(f.consent.counts.reads > 0); assert.equal(f.consent.counts.exchange, 1);
  assert.equal(/handoff|subject|credentialRef|accessToken|attemptId|accountId/.test(JSON.stringify(catalog)), false);
  // Application metadata survives repository reconstruction; ephemeral fixture credentials don't.
  const reopened = createConnectionOnboardingStore(f.config, f.db.fetch); assert.equal((await reopened.read(f.owner))[0].status, 'connected');
  f.consent.forget(); assert.equal((await f.request('/' + id + '/mail')).status, 409);
  assert.equal((await f.call()).bindings[0].status, 'reconnect_required');
  const otherHome = (await f.owned.create(f.owner, 'Family')).workspace.workspaceId;
  assert.equal((await f.request('', { choiceId: 'invented_gmail', workspaceId: otherHome })).status, 403);
  assert.equal((await begin()).connectionId, id); await f.call('/' + id, { action: 'approve' });
  f.consent.failCleanup(true); await f.call('/' + id, { action: 'disconnect' });
  assert.equal((await f.call()).bindings[0].status, 'cleanup_pending');
  assert.equal((await f.request('/' + id + '/mail')).status, 409);
  f.consent.failCleanup(false); await f.call('/' + id, { action: 'retry-cleanup' });
  assert.equal((await f.call()).bindings[0].status, 'disconnected');
});
test('foreign homes/IDs, agents, widened scope and unset normal runtime never gain a connection', async () => {
  const f = await onboardingFixture(); const { connectionId } = await f.call('', { choiceId: 'invented_gmail', workspaceId: f.home });
  for (const name of ['sam', 'oj_personal_fake']) {
    assert.ok([401, 403].includes((await f.request('/' + connectionId, { action: 'approve' }, name)).status));
    assert.ok([401, 403].includes((await f.request('/' + connectionId + '/mail', undefined, name)).status));
  }
  assert.equal((await f.request('', { choiceId: 'invented_gmail', workspaceId: f.home }, 'sam')).status, 403);
  assert.equal((await f.request('/' + connectionId, { action: 'approve', workspaceId: 'retarget' })).status, 400);
  for (const action of ['send', 'grant', 'calendar.write']) assert.equal((await f.request('/' + connectionId, { action })).status, 400);
  for (const choiceId of ['outlook', 'imap']) assert.equal((await f.request('', { choiceId, workspaceId: f.home })).status, 400);
  const normal = createPersonalApplication({ users: f.users, verifyIdToken: f.verifyIdToken, workspace: createFirestorePersonalWorkspaceStore(f.config, f.db.fetch) }).connectionsApi;
  const before = f.db.documents.size; assert.equal((await f.request('', undefined, 'alex', normal)).status, 503); assert.equal(f.db.documents.size, before);
  assert.equal(f.consent.counts.exchange, 0);
});
test('cancel wins an in-flight approval and prevents subsequent Mail delivery', async () => {
  const f = await onboardingFixture(); let release, started;
  const ready = new Promise(r => { started = r; }), pause = new Promise(r => { release = r; });
  const finish = f.consent.adapter.finish;
  f.consent.adapter.finish = async (...args) => { started(); await pause; return finish(...args); };
  const { connectionId: id } = await f.call('', { choiceId: 'invented_gmail', workspaceId: f.home });
  const pending = f.request('/' + id, { action: 'approve' }); await ready;
  await f.call('/' + id, { action: 'cancel' }); release();
  assert.equal((await pending).status, 409); assert.equal((await f.call()).bindings[0].status, 'cancelled');
  assert.equal((await f.request('/' + id + '/mail')).status, 409); assert.equal(f.consent.counts.exchange, 0);
});
test('disconnect suppresses an already-read Mail response and CAS admits one first consent', async () => {
  const f = await onboardingFixture(); f.db.synchronizeNextCommits(2);
  const begin = () => f.request('', { choiceId: 'invented_gmail', workspaceId: f.home });
  const race = await Promise.all([begin(), begin()]); assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);
  const { connectionId: id } = (await race.find(r => r.status === 200).json()).data;
  await f.call('/' + id, { action: 'approve' });
  let entered, release; const ready = new Promise(r => { entered = r; }), paused = new Promise(r => { release = r; });
  const read = f.consent.adapter.read;
  f.consent.adapter.read = async (...args) => { const page = await read(...args); entered(); await paused; return page; };
  const pending = f.request('/' + id + '/mail'); await ready;
  await f.call('/' + id, { action: 'disconnect' }); release();
  const response = await pending; assert.equal(response.status, 409); assert.equal((await response.text()).includes('Invented Mail body'), false);
});
