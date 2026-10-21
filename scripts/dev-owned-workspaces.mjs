import { createConnectionsApi } from '../server/connections/api.ts';
import { createConnectionsApplication } from '../server/connections/application.ts';
import { createConnectionOnboardingStore } from '../db/connection-onboarding.ts';
import { createConsentFixture, fixtureChoices } from '../tests/support/connection-onboarding-fixture.mjs';
// Local-only fixture composition of real owner-Workspace repository/API/UI; no deployed route.
import { createServer as createViteServer } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile, writeFile, rename, open, mkdir, unlink, mkdtemp } from 'node:fs/promises';
import { lstatSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFakeFirestore, createPrivateKey } from '../tests/support/fake-firestore.mjs';
import { createTestFirebaseAuthority } from '../tests/support/firebase-id-tokens.mjs';
import { createFirebaseIdTokenVerifier } from '../server/firebase-id-token.ts';
import { createFirestoreUserStore } from '../db/users.ts';
import { createOwnedWorkspaceStore } from '../db/owned-workspaces.ts';
import { createV1PersonalWorkspaceApi } from '../server/v1-personal-workspace.ts';
import { createFirestorePersonalWorkspaceStore } from '../db/personal-workspace.ts';
import { createPersonalWorkspaceContextStore } from '../db/personal-workspace-context.ts';
import { createWorkspaceContextStore } from '../server/workspace-context-store.ts';
import { createWorkspacePilotRuntime } from '../server/workspace-pilot-runtime.ts';
import { webFirebaseConfigFor } from '../config/web-firebase-config.mjs';
import nativeIdentities from '../config/native-identities.json' with { type: 'json' };
import { createOwnedWorkspacesApi } from '../server/owned-workspaces-api.ts';
import { createGoogleConnectionsFlow } from '../server/connections/google-flow.ts';
import { googleRows } from '../server/connections/google-state.ts';
import { createReplyOperationRepository } from '../db/reply-operations.ts';
import { createFixtureReplyOperations } from '../server/reply-operations.ts';
import { createFixtureGmailReplyDispatch, fixtureGmailState } from '../tests/support/gmail-reply-transport.mjs';
import { createFixtureGoogleCalendar, fixtureCalendarState } from '../tests/support/google-calendar-transport.mjs';
import { createCalendarPlanningRepository } from '../db/calendar-planning.ts';
import { createFixtureCalendarPlanning } from '../server/calendar-planning.ts';
import { fixture as googleProtocolFixture, CLIENT, BINDING, ACCESS, REFRESH } from '../tests/support/google-oauth-transport.mjs';
const options = new Map(); const args = process.argv.slice(2);
while (args.length) { const key = args.shift(); if (key === '--google-fixture' && !options.has(key)) { options.set(key, true); continue; } if (!['--port', '--state-file'].includes(key) || options.has(key) || !args.length) throw new Error('Use [--port N] [--state-file PATH] [--google-fixture].'); options.set(key, args.shift()); }
const port = Number(options.get('--port') ?? 5202); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port.');
const statePath = resolve(options.get('--state-file') ?? join(await mkdtemp(join(tmpdir(), 'openjob-owned-')), 'state.json'));
await mkdir(dirname(statePath), { recursive: true });
const lockPath = statePath + '.lock', lock = await open(lockPath, 'wx', 0o600); await lock.writeFile(String(process.pid));
const lockIdentity = await lock.stat();
// Vite may exit directly on a termination signal; release only this launcher's lock.
process.once('exit', () => { try { const current = lstatSync(lockPath); if (current.ino === lockIdentity.ino && current.dev === lockIdentity.dev) unlinkSync(lockPath); } catch {} });
let server, queue = Promise.resolve(), stopping = false;
async function close() { if (stopping) return; stopping = true; await queue.catch(() => {}); await server?.close(); await lock.close(); await unlink(lockPath).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void close().then(() => process.exit(0)); });
try {
  const db = createFakeFirestore();
  const envelopes = new Map(); let gmailProtocol = fixtureGmailState(), calendarProtocol = fixtureCalendarState();
  try {
    const raw = await readFile(statePath); if (raw.length > 32 * 1024 * 1024) throw new Error('Oversized fixture.');
    const value = JSON.parse(raw.toString('utf8'));
    if (value.fixtureGmailProtocol !== undefined) { if (!options.has('--google-fixture')) throw new Error('Restart this invented Google fixture with --google-fixture.'); gmailProtocol = fixtureGmailState(value.fixtureGmailProtocol); }
    if (value.fixtureGoogleCalendar !== undefined) { if (!options.has('--google-fixture')) throw new Error('Restart this invented Google fixture with --google-fixture.'); calendarProtocol = fixtureCalendarState(value.fixtureGoogleCalendar); }
    if (value.kind !== 'openjob-owned-workspace-fixture' || value.version !== 1 || !Number.isSafeInteger(value.state?.revision) || !Array.isArray(value.state.documents) || value.state.documents.length > 500 || value.state.documents.some(row => !Array.isArray(row) || row.length !== 2 || !/^projects\/openjob-dev\/databases\/\(default\)\/documents\/(v1UserDirectory|v1SignInMethods|v1UserSignInMethods|v1OwnedWorkspaceCatalogs|v1OwnedWorkspaces|v1PersonalWorkspaceContexts|v1PersonalWorkspaces|v1ConnectionOnboarding|v1FixtureOperations|v1FixtureOutboundPayloads|v1FixtureIntegrationJobs|v1FixtureOperationIndexes|v1FixtureCalendarOperations|v1FixtureCalendarOutboundPayloads|v1FixtureCalendarIntegrationJobs|v1FixtureCalendarOperationIndexes)\//.test(row[0]) || row[1]?.name !== row[0])) throw new Error('Invalid fixture; preserve original.');
    if (value.fixtureGoogleCalendar === undefined && value.state.documents.some(([name]) => name.includes('/v1FixtureCalendar'))) throw new Error('Missing invented Calendar ledger; preserve original.');
    if (value.fixtureGoogleRows !== undefined) {
      if (!options.has('--google-fixture') || !Array.isArray(value.fixtureGoogleRows) || value.fixtureGoogleRows.length > 1) throw new Error('Restart this invented Google fixture with --google-fixture.');
      for (const [owner, rows] of value.fixtureGoogleRows) {
        const validated = googleRows(rows, owner);
        // Only the protocol fixture's fixed invented credentials may reach this local test file.
        if (!/^user_[a-f0-9]{32}$/.test(owner) || validated.length > 1 || validated.some(row => row.address !== BINDING.address || row.subject !== BINDING.subject || row.pending || row.operation || row.grant && (row.grant.refreshToken !== REFRESH || row.grant.entry.credential.accessToken !== ACCESS || row.grant.entry.credential.subject !== BINDING.subject))) throw new Error('Invalid invented Google fixture; preserve original.');
        envelopes.set(owner, validated);
      }
    }
    db.restoreState(value.state);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  async function persist() { const raw = JSON.stringify({ kind: 'openjob-owned-workspace-fixture', version: 1, state: db.exportState(), ...(options.has('--google-fixture') ? { fixtureGoogleRows: [...envelopes], fixtureGmailProtocol: gmailProtocol, fixtureGoogleCalendar: calendarProtocol } : {}) }); if (Buffer.byteLength(raw) > 32 * 1024 * 1024) throw new Error('Fixture capacity.'); const temporary = statePath + `.tmp-${process.pid}`; await writeFile(temporary, raw, { mode: 0o600, flag: 'wx' }); await rename(temporary, statePath); }
  // Persist every operation commit before acknowledging it to the runner, including executing.
  const durableFixtureTransport = async (input, init) => { const response = await db.fetch(input, init); if (String(input).endsWith('/documents:commit') && response.ok) await persist(); return response; };
  const now = new Date().toISOString(), authority = await createTestFirebaseAuthority({ now });
  const verifyIdToken = createFirebaseIdTokenVerifier({ projectId: 'openjob-dev', fetchImplementation: authority.fetch, now: () => Date.parse(now) });
  const config = { projectId: 'openjob-dev', clientEmail: 'workspace-fixture@example.invalid', privateKey: await createPrivateKey() };
  const users = createFirestoreUserStore(config, db.fetch), owned = createOwnedWorkspaceStore(config, db.fetch), personal = createFirestorePersonalWorkspaceStore(config, db.fetch), contexts = createPersonalWorkspaceContextStore(config, db.fetch), store = createWorkspaceContextStore({ owned, personal, contexts }), sessions = new Map();
  for (const name of ['alex', 'sam']) { const token = await authority.issue({ uid: `owned_fixture_${name}` }); const identity = await verifyIdToken(new Request('http://fixture.invalid', { headers: { authorization: `Bearer ${token}` } })); const { user } = await users.create(identity); sessions.set(name, { token, userId: user.userId }); const items = await store.list(user.userId); for (const item of items) await store.snapshot(user.userId, item.workspaceId); }
  await persist(); const api = createOwnedWorkspacesApi({ store, users, verifyIdToken });
  const consentFixture = createConsentFixture({ config, isOwnerActive: async owner => { await store.list(owner); return true; } });
  const onboarding = createConnectionsApplication({ store: createConnectionOnboardingStore(config, db.fetch), homes: store, consent: consentFixture.adapter, choices: fixtureChoices });
  let google, gmailReplyDispatch, fixtureCalendar;
  if (options.has('--google-fixture')) {
    const protocol = googleProtocolFixture(), owner = sessions.get('alex').userId;
    const home = await store.personalContext(owner);
    google = createGoogleConnectionsFlow({ executionMode: 'configured', evidenceMode: 'google-fixture', homes: store,
      isOwnerActive: async current => current === owner && (await store.list(current)).length > 0,
      repository: { async read(current) { return structuredClone(envelopes.get(current) ?? []); }, async change(current, apply) { const next = apply(structuredClone(envelopes.get(current) ?? [])); envelopes.set(current, structuredClone(next)); return structuredClone(next); } },
      google: { clientId: CLIENT, clientSecret: 'invented_client_secret', callbackUri: 'https://fixture.invalid/connections/google/callback', transport: protocol.transport },
      mailTransport: async input => { const url = new URL(input), path = url.pathname;
        if (path.endsWith('/profile')) return Response.json({ emailAddress: BINDING.address });
        if (path.endsWith('/labels')) return Response.json({ labels: [{ id: 'INBOX', name: 'Inbox' }, { id: 'Label_review', name: 'Review' }, { id: 'SPAM', name: 'Spam' }, { id: 'TRASH', name: 'Trash' }] });
        if (path.endsWith('/messages')) {
          const token = url.searchParams.get('pageToken'), label = url.searchParams.get('labelIds'), search = url.searchParams.get('q');
          if (search && !['subject:proposal', 'subject:follow-up', 'subject:missing'].includes(search)) return new Response(null, { status: 400 });
          if (search === 'subject:missing') return Response.json({ messages: [] });
          if (search === 'subject:follow-up' && label !== 'SPAM' && label !== 'TRASH') return Response.json({ messages: [{ id: 'm2', threadId: 't2' }] });
          if (label === 'SPAM' || label === 'TRASH') return Response.json({ messages: [] });
          if (label === 'Label_review') return Response.json({ messages: [{ id: 'm2', threadId: 't2' }] });
          if (token !== null && token !== 'invented-next-page') return new Response(null, { status: 400 });
          return Response.json(token ? { messages: [{ id: 'm2', threadId: 't2' }] } : { messages: [{ id: 'm1', threadId: 't1' }], nextPageToken: 'invented-next-page' });
        }
        const second = path.endsWith('/messages/m2');
        if (!path.endsWith('/messages/m1') && !second) return new Response(null, { status: 404 });
        return Response.json({ id: second ? 'm2' : 'm1', threadId: second ? 't2' : 't1', internalDate: String(Date.now()), labelIds: second ? ['INBOX', 'Label_review'] : ['INBOX'], payload: { mimeType: 'text/plain', headers: [{ name: 'Subject', value: second ? 'Review the follow-up proposal' : 'Review the connected-work proposal' }, { name: 'From', value: 'Colleague <colleague@example.invalid>' }, { name: 'Reply-To', value: '"Reply Desk, Inc." <replies@example.invalid>' }, { name: 'To', value: `${BINDING.address}, teammate@example.invalid` }, { name: 'Cc', value: 'observer@example.invalid' }, { name: 'Message-ID', value: second ? '<follow-up@example.invalid>' : '<proposal@example.invalid>' }, { name: 'References', value: '<root@example.invalid>' }], body: { data: Buffer.from(second ? 'Invented second-page message. Review this follow-up in its own source-linked Task.' : 'Invented connected message. Review this work, plan it in your OpenJob Calendar, then return to its source.').toString('base64url') } } });
      } });
    if (!envelopes.has(owner)) {
    const started = await google.begin(owner, BINDING.address, home.workspace.workspaceId), url = new URL(started.authorizationUrl);
    protocol.hooks.claims = { nonce: url.searchParams.get('nonce') };
    await google.callback(owner, { state: url.searchParams.get('state'), code: 'invented_fixture_code', callbackUri: 'https://fixture.invalid/connections/google/callback' });
    }
    await persist();
    const [connection] = envelopes.get(owner) ?? [];
    if (!connection) throw new Error('Invented Google connection unavailable.');
    gmailReplyDispatch = createFixtureGmailReplyDispatch({ binding: { ownerId: owner, workspaceId: home.workspace.workspaceId, accountId: connection.accountId, subject: BINDING.subject, address: BINDING.address }, state: gmailProtocol,
      persist: async value => { gmailProtocol = value; await persist(); } }).dispatch;
    const binding = { ownerId: owner, workspaceId: home.workspace.workspaceId, accountId: connection.accountId, connectionId: connection.id, subject: BINDING.subject, revision: connection.attemptId, calendarIds: ['planning@example.invalid'] };
    const calendar = createFixtureGoogleCalendar({ binding, state: calendarProtocol, persist: async value => { calendarProtocol = value; await persist(); }, active: async () => {
      const row = (envelopes.get(owner) ?? []).find(item => item.id === binding.connectionId);
      return !!row && row.status === 'connected' && !row.operation && !row.pending && !!row.grant && row.workspaceId === binding.workspaceId && row.accountId === binding.accountId && row.subject === binding.subject && row.attemptId === binding.revision;
    } });
    fixtureCalendar = createFixtureCalendarPlanning({ repository: createCalendarPlanningRepository(config, durableFixtureTransport), ...calendar });
  }
  const fixtureOperations = google ? createFixtureReplyOperations({ repository: createReplyOperationRepository(config, durableFixtureTransport), authority: google.fixtureReplyAuthority(), dispatch: gmailReplyDispatch }) : undefined;
  const pilot = createWorkspacePilotRuntime({ config, personal, users, verifyIdToken, fixtureOperations, fixtureCalendar, transport: db.fetch, admission: { userId: sessions.get('alex').userId, provider: 'google', firebaseUid: 'owned_fixture_alex' } });
  const connectionsApi = createConnectionsApi({ onboarding: google ? undefined : onboarding, google, users, verifyIdToken });
  const personalApi = createV1PersonalWorkspaceApi({ workspace: personal, users, verifyIdToken });
  const plugin = { name: 'owned-workspaces-fixture', configureServer(vite) { vite.middlewares.use((incoming, outgoing, next) => {
    if (!incoming.url?.startsWith('/api/v1/connections') && !incoming.url?.startsWith('/api/owned-workspaces') && !incoming.url?.startsWith('/api/v1/workspaces') && !incoming.url?.startsWith('/api/v1/workspace/') && !incoming.url?.startsWith('/__fixture/session/')) return next();
    const run = async () => {
      try {
        const url = new URL(incoming.url, `http://127.0.0.1:${port}`);
        if (url.pathname.startsWith('/__fixture/session/')) { const session = sessions.get(url.pathname.slice('/__fixture/session/'.length)); outgoing.writeHead(session ? 200 : 404, { 'content-type': 'application/json', 'cache-control': 'no-store' }); outgoing.end(JSON.stringify(session ?? {})); return; }
        const chunks = []; let length = 0; for await (const chunk of incoming) { length += chunk.length; if (length > 250000) { outgoing.writeHead(413); outgoing.end(); return; } chunks.push(chunk); }
        const request = new Request(url, { method: incoming.method, headers: incoming.headers, ...(!['GET', 'HEAD'].includes(incoming.method) ? { body: Buffer.concat(chunks) } : {}) });
        const response = await (url.pathname.startsWith('/api/v1/connections') ? connectionsApi : url.pathname.startsWith('/api/v1/workspaces') ? pilot : url.pathname.startsWith('/api/v1/workspace/') ? personalApi : api).fetch(request);
        if (['POST', 'DELETE'].includes(incoming.method) && (response.ok || url.pathname.startsWith('/api/v1/connections'))) await persist();
        outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
      } catch { outgoing.writeHead(500, { 'content-type': 'application/json' }); outgoing.end(JSON.stringify({ error: { code: 'fixture_unavailable' } })); }
    };
    queue = queue.then(run, run);
  }); } };
  server = await createViteServer({ configFile: false, cacheDir: statePath + '.vite-cache', root: resolve('tests/browser/owned-workspaces-fixture'), publicDir: resolve('public'), plugins: [react(), plugin], resolve: { alias: { 'next/link': resolve('tests/browser/personal-workspace-fixture/link.tsx') } }, define: { __OPENJOB_FIREBASE_CONFIG__: JSON.stringify(webFirebaseConfigFor('preview')), __OPENJOB_APPLE_SERVICE_ID__: JSON.stringify(nativeIdentities.apple.signInServices.nonproduction.serviceId), __OPENJOB_QA_PASSWORD_AUTH__: 'null' }, server: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'warn' });
  await server.listen(); console.log(`Owned Workspace fixture: http://127.0.0.1:${port}/\nSynthetic Alex/Sam; no real sign-in, providers or access changes.\nSaved local fixture (not encrypted): ${statePath}`);
} catch (error) { await close(); throw error; }
