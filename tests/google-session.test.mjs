import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createPortableRuntime } from '../server/portable-runtime.ts';
import { createGoogleMailSession, SESSION_READ_SCOPE } from '../server/connections/google-session.ts';
import { createConnectionsApi } from '../server/connections/api.ts';
import { googleSessionConfiguration } from '../deployment/google-session-config.mjs';
import { onboardingFixture } from './support/onboarding-app-fixture.mjs';

const external = globalThis.fetch;
before(() => { globalThis.fetch = async () => { throw new Error('Live network forbidden in session fixture.'); }; });
after(() => { globalThis.fetch = external; });
const ORIGIN = 'http://127.0.0.1:5192', CLIENT = 'invented_client.apps.googleusercontent.com', ACCESS = 'invented_session_access';
async function fixture() {
  const f = await onboardingFixture({ projectId: 'openjob-nonprod' }), hooks = {}, calls = [];
  let clock = Date.now();
  const configuration = { origin: ORIGIN, ownerUserId: f.owner, firebaseUid: 'alex', address: 'alex@example.invalid', clientId: CLIENT };
  const googleTransport = async (input, init) => {
    assert.equal(String(input), 'https://oauth2.googleapis.com/tokeninfo'); assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error'); assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${ACCESS}`);
    calls.push('tokeninfo'); await hooks.verify?.();
    return Response.json({ aud: CLIENT, sub: 'alex-provider-subject', email: configuration.address, email_verified: true, scope: `openid email profile ${SESSION_READ_SCOPE}`, expires_in: 3600, ...hooks.info });
  };
  const mailTransport = async (input, init) => {
    const url = new URL(input); assert.equal(url.origin, 'https://gmail.googleapis.com'); assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
    calls.push(url.pathname); await hooks.mail?.();
    if (url.pathname.endsWith('/profile')) return Response.json({ emailAddress: configuration.address });
    if (url.pathname.endsWith('/labels')) return Response.json({ labels: [{ id: 'INBOX', name: 'Inbox' }] });
    if (url.pathname.endsWith('/messages')) { assert.equal(url.searchParams.get('maxResults'), '10'); return Response.json({ messages: [{ id: 'm1', threadId: 't1' }] }); }
    return Response.json({ id: 'm1', threadId: 't1', labelIds: ['INBOX'], internalDate: String(clock), payload: { mimeType: 'text/plain', headers: [{ name: 'Subject', value: 'Invented session message' }], body: { data: Buffer.from('Invented body').toString('base64url') } } });
  };
  const flow = createGoogleMailSession({ configuration, googleTransport, mailTransport, now: () => clock });
  const api = createConnectionsApi({ users: f.users, verifyIdToken: f.verifyIdToken, googleSession: flow });
  const request = (path, { method = 'POST', body = {}, id, token = f.sessions.alex.token, origin = ORIGIN, target = api, urlOrigin = ORIGIN } = {}) => target.fetch(new Request(urlOrigin + '/api/v1/connections/session' + path, { method, headers: { authorization: `Bearer ${token}`, ...(origin === undefined ? {} : { origin }), ...(id ? { 'x-openjob-mail-session': id } : {}), 'content-type': 'application/json' }, ...(['GET', 'DELETE'].includes(method) ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }));
  const call = async (path, options) => { const r = await request(path, options); assert.equal(r.status, 200, await r.clone().text()); const text = await r.text(); assert.equal(text.includes(ACCESS), false); return JSON.parse(text).data; };
  const begin = () => call('/begin');
  const connect = id => call('/connect', { id, body: { accessToken: ACCESS } });
  return { ...f, configuration, googleTransport, mailTransport, flow, api, request, call, begin, connect, hooks, calls, advance: ms => { clock += ms; } };
}

test('signed local API connects short-lived token, reads bounded invented Mail, disconnects and never persists token', async () => {
  const f = await fixture(), before = JSON.stringify(f.db.exportState());
  assert.equal((await f.call('/status')).mode, 'google-session');
  const start = await f.begin(), connected = await f.connect(start.sessionId);
  assert.ok(connected.expiresAt <= Date.now() + 600000);
  assert.equal((await f.call('/mail', { id: start.sessionId })).page.messages[0].body, 'Invented body');
  assert.equal(f.calls.filter(x => x === 'tokeninfo').length, 1); assert.equal(f.calls.length, 5);
  await f.call('', { method: 'DELETE', id: start.sessionId });
  assert.equal((await f.request('/mail', { id: start.sessionId })).status, 409);
  assert.equal(JSON.stringify(f.db.exportState()), before);
});

test('default disabled, exact loopback origin, foreign user, agents and unsafe operations deny before provider calls', async () => {
  const f = await fixture(), disabled = createConnectionsApi({ users: f.users, verifyIdToken: f.verifyIdToken });
  assert.equal((await f.request('/status', { target: disabled })).status, 503);
  for (const options of [{ token: f.sessions.sam.token }, { token: 'oj_agent_synthetic' }, { origin: 'null' }, { origin: '' }, { origin: 'https://foreign.invalid' }, { urlOrigin: 'http://localhost:5192', origin: 'http://localhost:5192' }]) assert.notEqual((await f.request('/status', options)).status, 200);
  const start = await f.begin();
  for (const path of ['/send', '/refresh', '/calendar', '/modify']) assert.notEqual((await f.request(path, { id: start.sessionId })).status, 200);
  assert.equal((await f.request('/connect', { id: start.sessionId, body: { accessToken: ACCESS, refreshToken: 'invented' } })).status, 400);
  assert.equal(f.calls.length, 0);
});

test('provider subject, audience, mailbox, verification, expiry and widened scopes cannot connect', async () => {
  const f = await fixture();
  for (const info of [{ sub: 'foreign' }, { aud: 'foreign' }, { azp: 'foreign' }, { email: 'sam@example.invalid' }, { email_verified: false }, { expires_in: -1 }, { scope: 'openid email' }, { scope: `${SESSION_READ_SCOPE} https://www.googleapis.com/auth/gmail.send` }, { scope: `${SESSION_READ_SCOPE} https://www.googleapis.com/auth/calendar.readonly` }]) {
    f.hooks.info = info; const start = await f.begin();
    const r = await f.request('/connect', { id: start.sessionId, body: { accessToken: ACCESS } }); assert.equal(r.status, 409); assert.equal((await r.text()).includes(ACCESS), false);
    assert.equal((await f.request('/mail', { id: start.sessionId })).status, 409);
  }
  assert.equal(f.calls.every(x => x === 'tokeninfo'), true);
});

test('disconnect and replacement fence in-flight validation; read results are suppressed after disconnect or expiry', async () => {
  const f = await fixture(); let release, entered;
  let reached = new Promise(resolve => { entered = resolve; });
  f.hooks.verify = async () => { entered(); await new Promise(resolve => { release = resolve; }); };
  let start = await f.begin(); const pending = f.request('/connect', { id: start.sessionId, body: { accessToken: ACCESS } }); await reached;
  await f.call('', { method: 'DELETE', id: start.sessionId }); release(); assert.equal((await pending).status, 409);
  f.hooks.verify = undefined; start = await f.begin(); await f.connect(start.sessionId);
  reached = new Promise(resolve => { entered = resolve; });
  f.hooks.mail = async () => { entered(); await new Promise(resolve => { release = resolve; }); };
  const read = f.request('/mail', { id: start.sessionId }); await reached; await f.call('', { method: 'DELETE', id: start.sessionId }); release(); assert.equal((await read).status, 409);
  f.hooks.mail = undefined; start = await f.begin(); await f.connect(start.sessionId); f.advance(600001);
  assert.equal((await f.request('/mail', { id: start.sessionId })).status, 409);
  f.advance(-600001); start = await f.begin(); await f.connect(start.sessionId);
  f.hooks.mail = async () => { f.advance(600001); };
  const expiredDuringRead = await f.request('/mail', { id: start.sessionId });
  assert.equal(expiredDuringRead.status, 409); assert.equal((await expiredDuringRead.text()).includes('Invented body'), false);
});

test('portable composition is opt-in nonproduction; process reconstruction loses the Mail lease', async () => {
  const f = await fixture(), options = { googleSession: f.configuration, googleTransport: f.googleTransport, mailTransport: f.mailTransport, databaseTransport: f.db.fetch, identityTransport: f.identityTransport };
  const create = () => createPortableRuntime({ ...f.config, apiKey: 'fixture' }, options);
  assert.throws(() => createPortableRuntime({ ...f.config, projectId: 'openjob-dev' }, options));
  assert.throws(() => createPortableRuntime(f.config, { ...options, googleTransport: undefined }));
  const runtime = create(), start = await f.call('/begin', { target: runtime }); await f.call('/connect', { target: runtime, id: start.sessionId, body: { accessToken: ACCESS } });
  assert.equal((await f.request('/mail', { target: create(), id: start.sessionId })).status, 409);
});

test('nonsecret session configuration defaults off, accepts exact loopback and rejects persistent/production settings', () => {
  assert.equal(googleSessionConfiguration({}), undefined);
  const env = { OPENJOB_GOOGLE_SESSION_MODE: 'configured', FIREBASE_PROJECT_ID: 'openjob-nonprod', OPENJOB_PUBLIC_ORIGIN: ORIGIN, OPENJOB_GOOGLE_OWNER_USER_ID: 'user_' + 'a'.repeat(32), OPENJOB_GOOGLE_OWNER_FIREBASE_UID: 'alex', OPENJOB_GOOGLE_MAILBOX: 'alex@example.invalid', OPENJOB_GOOGLE_CLIENT_ID: CLIENT };
  assert.equal(googleSessionConfiguration(env).origin, ORIGIN);
  for (const override of [{ FIREBASE_PROJECT_ID: 'openjob-dev' }, { OPENJOB_GOOGLE_CONNECTIONS_MODE: 'configured' }, { OPENJOB_PUBLIC_ORIGIN: 'http://0.0.0.0:5192' }, { OPENJOB_PUBLIC_ORIGIN: 'https://public.invalid' }, { OPENJOB_PUBLIC_ORIGIN: ORIGIN + '/path' }]) assert.throws(() => googleSessionConfiguration({ ...env, ...override }));
});
