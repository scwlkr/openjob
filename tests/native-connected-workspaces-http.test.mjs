import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import ts from 'typescript';
import { googleFlowFixture } from './support/google-connection-flow.mjs';
import { createFirestorePersonalWorkspaceStore } from '../db/personal-workspace.ts';
import { createPersonalWorkspaceContextStore } from '../db/personal-workspace-context.ts';
import { createWorkspaceContextStore } from '../server/workspace-context-store.ts';
import { createWorkspacePilotApplication } from '../server/workspace-pilot-application.ts';
import { BINDING } from './support/google-oauth-transport.mjs';

test('native connected client/coordinator use actual authenticated HTTP Workspace and Google contracts for both homes', { timeout: 30_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'openjob-native-connected-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const entry = join(directory, 'entry.ts');
  await writeFile(entry, `export {createNativeConnectedWorkspaceApi} from ${JSON.stringify(resolve('native/src/connected-workspaces-api.ts'))};\nexport {NativeAuthCoordinator} from ${JSON.stringify(resolve('native/src/auth/coordinator.ts'))};\n`);
  await build({ configFile: false, logLevel: 'silent', oxc: false, plugins: [{ name: 'native-source', transform(code, id) { if (id.endsWith('.ts')) return ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText; } }], build: { ssr: entry, outDir: directory, emptyOutDir: false, minify: false, rolldownOptions: { tsconfig: false, output: { entryFileNames: 'native.mjs' } } } });
  const { createNativeConnectedWorkspaceApi, NativeAuthCoordinator } = await import(pathToFileURL(join(directory, 'native.mjs')).href);
  for (const retained of [false, true]) await t.test(retained ? 'retained Personal home' : 'independent Owned home', async t => {
    const f = await googleFlowFixture(), personal = createFirestorePersonalWorkspaceStore(f.config, f.db.fetch), contexts = createPersonalWorkspaceContextStore(f.config, f.db.fetch), store = createWorkspaceContextStore({ owned: f.owned, personal, contexts });
    f.reconstruct({ homes: store });
    const app = createWorkspacePilotApplication({ store, users: f.users, verifyIdToken: f.verifyIdToken, admission: { userId: f.owner, provider: 'google', firebaseUid: 'alex' } });
    for (const name of ['alex', 'sam']) { const identity = await f.verifyIdToken(new Request('https://fixture.invalid', { headers: { authorization: `Bearer ${f.sessions[name].token}` } })); await f.users.claimUsername(identity, `native${name}`); }
    const failures = [];
    const server = createServer(async (incoming, outgoing) => {
      try {
        const request = new Request(`http://${incoming.headers.host}${incoming.url}`, { method: incoming.method, headers: incoming.headers, ...(incoming.method === 'POST' ? { body: incoming, duplex: 'half' } : {}) });
        let response;
        if (incoming.url === '/api/v1/me') { const identity = await f.verifyIdToken(request), user = identity && await f.users.resolve(identity); response = Response.json(user ? { data: { ...user, usernameRequired: !user.username } } : { error: { code: 'authentication_required' } }, { status: user ? 200 : 401 }); }
        else response = await (incoming.url.startsWith('/api/v1/workspaces') ? app : f.googleApi).fetch(request);
        outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
      } catch (error) { failures.push(error); outgoing.writeHead(500); outgoing.end('{}'); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const base = `http://127.0.0.1:${server.address().port}/api/v1`, api = createNativeConnectedWorkspaceApi({ apiBaseUrl: base });
    let who = 'alex', stored = null, pause, release;
    const delayed = { ...api, source: async (...args) => { const result = await api.source(...args); if (pause) { pause(); await new Promise(resolve => { release = resolve; }); } return result; }, message: async (...args) => { const result = await api.message(...args); if (pause) { pause(); await new Promise(resolve => { release = resolve; }); } return result; } };
    const noop = async () => undefined;
    const coordinator = new NativeAuthCoordinator({ connectedWorkspaces: delayed,
      readPersonalWorkspace: noop, commandPersonalWorkspace: noop, listPersonalAgents: async () => [], revokePersonalAgent: noop,
      signInWithProvider: async provider => ({ provider, idToken: 'invented-proof' }), exchangeProviderCredential: async () => ({ provider: 'google', idToken: f.sessions[who].token, refreshToken: 'invented-refresh', expiresAt: Date.now() + 3600000 }),
      getMe: async token => { const response = await fetch(base + '/me', { headers: { authorization: `Bearer ${token}` } }); return (await response.json()).data; }, listSignInMethods: async () => ['google'], now: Date.now,
      loadCleanupPending: async () => false, loadDeletionReceipt: async () => null, loadStoredSession: async () => stored, saveStoredSession: async value => { stored = value; }, clearStoredSession: async () => { stored = null; },
      clearProviderSession: noop, purgeLocalDomainCache: noop, markCleanupPending: noop, clearCleanupPending: noop, clearDeletionReceipt: noop, loadLocalTaskListCache: async () => null,
    });
    assert.equal((await coordinator.signIn('google')).kind, 'signed-in');
    const controller = coordinator.getPersonalWorkspaceController().connected;
    assert.equal(JSON.stringify(controller).includes('token'), false);
    let home = f.home;
    if (retained) home = (await controller.personal(f.owner)).workspace.workspaceId;
    assert.ok((await controller.list(f.owner)).some(item => item.workspaceId === home));
    const begin = await f.call('', { address: BINDING.address, workspaceId: home }), url = new URL(begin.authorizationUrl);
    f.protocol.hooks.claims = { nonce: url.searchParams.get('nonce') }; await f.complete({ ...begin, state: url.searchParams.get('state') });
    const catalog = await controller.connections(f.owner); assert.equal(catalog.mode, 'google-fixture');
    const traffic = []; f.hooks.mail = url => traffic.push(url);
    f.hooks.response = url => {
      if (url.pathname.endsWith('/messages')) return Response.json(url.searchParams.get('q') === 'subject:missing' ? { messages: [] } : url.searchParams.get('pageToken') ? { messages: [{ id: 'm2', threadId: 't2' }] } : { messages: [{ id: 'm1', threadId: 't1' }], nextPageToken: 'native-next' });
      if (url.pathname.endsWith('/messages/m2')) return Response.json({ id: 'm2', threadId: 't2', internalDate: String(Date.now()), labelIds: ['INBOX'], payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'colleague@example.invalid' }, { name: 'To', value: BINDING.address }, { name: 'Subject', value: 'Proposal follow-up' }], body: { data: Buffer.from('Invented follow-up body.').toString('base64url') } } });
    };
    const inbox = `${(await f.repository.read(f.owner))[0].accountId}:folder:INBOX`, query = { folderId: inbox, search: 'subject:proposal' };
    const mail = await controller.mail(f.owner, home, begin.connectionId, query); assert.equal(Object.hasOwn(mail.page.messages[0], 'body'), false); assert.ok(mail.freshness.observedAt); assert.ok(mail.page.nextCursor);
    assert.equal(traffic.some(url => url.searchParams.get('format') === 'full'), false);
    const next = await controller.mail(f.owner, home, begin.connectionId, { ...query, cursor: mail.page.nextCursor }); assert.equal(next.page.messages[0].upstreamId, 'm2'); assert.equal(Object.hasOwn(next.page.messages[0], 'body'), false);
    assert.ok(traffic.some(url => url.searchParams.get('pageToken') === 'native-next' && url.searchParams.get('q') === query.search && url.searchParams.get('labelIds') === 'INBOX'));
    await assert.rejects(controller.mail(f.owner, home, begin.connectionId, { ...query, search: 'subject:changed', cursor: mail.page.nextCursor }), error => error.code === 'invalid_cursor');
    assert.equal((await controller.mail(f.owner, home, begin.connectionId, { search: 'subject:missing' })).page.messages.length, 0);
    assert.equal((await controller.message(f.owner, home, begin.connectionId, 'm1')).message.body, 'Invented connected message.');
    assert.equal(traffic.filter(url => url.searchParams.get('format') === 'full').length, 1); f.hooks.mail = undefined; f.hooks.response = undefined;
    const task = await controller.createMailTask(f.owner, home, begin.connectionId, { messageId: 'm1', title: 'Native reviewed proposal' });
    assert.equal(task.workspaceId, home); assert.equal(task.created, true);
    assert.deepEqual(await controller.createMailTask(f.owner, home, begin.connectionId, { messageId: 'm1', title: 'Must not overwrite' }), { ...task, created: false });
    await controller.command(f.owner, home, { type: 'task.notes', taskId: task.taskId, notes: 'Native notes', expectedNotes: '' });
    await assert.rejects(controller.command(f.owner, home, { type: 'task.notes', taskId: task.taskId, notes: 'Stale overwrite', expectedNotes: '' }), error => error.code === 'conflict');
    const work = await controller.read(f.owner, home);
    await controller.command(f.owner, home, { type: 'task.schedule', taskId: task.taskId, calendarId: work.workspace.calendarId, start: '2026-10-21T14:00:00Z', end: '2026-10-21T14:30:00Z' });
    await controller.command(f.owner, home, { type: 'task.complete', taskId: task.taskId, completed: true });
    assert.equal((await controller.source(f.owner, home, task.taskId)).message.body, 'Invented connected message.');
    const reply = await controller.reply(f.owner, home, task.taskId);
    assert.deepEqual(reply.plans.reply.to, ['replies@example.invalid']); assert.equal(reply.plans.reply.from, BINDING.address);
    const input = { mode: 'reply-all', body: 'Native work reviewed and completed.', expectedRevision: 0, reviewToken: reply.reviewToken };
    const saved = await controller.saveReply(f.owner, home, task.taskId, input); assert.equal(saved.draft.revision, 1);
    assert.deepEqual((await controller.reply(f.owner, home, task.taskId)).draft, saved.draft);
    assert.deepEqual(await controller.saveReply(f.owner, home, task.taskId, input), saved);
    await assert.rejects(controller.saveReply(f.owner, home, task.taskId, { ...input, body: 'Different stale text' }), error => error.code === 'conflict');
    assert.doesNotMatch(JSON.stringify(await controller.read(f.owner, home)), /connectedReplies|replies@example|Native work reviewed|Invented connected message/);
    // Upstream Gmail authentication failure is Mail reconnect, not OpenJob logout.
    // The native shell revokes its OpenJob session on HTTP401, so preserve409 here.
    f.hooks.response = () => Response.json({ error: { errors: [{ reason: 'authError' }], message: 'SECRET_PROVIDER_BODY' } }, { status: 401 });
    for (const operation of [
      () => controller.mail(f.owner, home, begin.connectionId),
      () => controller.message(f.owner, home, begin.connectionId, 'm1'),
      () => controller.source(f.owner, home, task.taskId),
      () => controller.reply(f.owner, home, task.taskId),
      () => controller.saveReply(f.owner, home, task.taskId, { ...input, expectedRevision: 1, body: 'Must not save during reconnect' }),
    ]) await assert.rejects(operation(), error => error.status === 409 && error.code === 'reconnect_required' && !JSON.stringify(error).includes('SECRET_PROVIDER_BODY'));
    assert.equal((await controller.read(f.owner, home)).work.tasks.find(item => item.id === task.taskId).completed, true);
    f.hooks.response = undefined;
    assert.deepEqual((await controller.reply(f.owner, home, task.taskId)).draft, saved.draft);
    for (const operation of ['source', 'message']) {
      const readStarted = new Promise(resolve => { pause = resolve; }); const reading = operation === 'source' ? controller.source(f.owner, home, task.taskId) : controller.message(f.owner, home, begin.connectionId, 'm1'); await readStarted;
      await coordinator.signOut(); who = 'sam'; await coordinator.signIn('google'); release();
      await assert.rejects(reading, error => error.code === 'revoked');
      await assert.rejects(controller.saveReply(f.owner, home, task.taskId, input), error => error.code === 'revoked');
      await assert.rejects(controller.read(f.sessions.sam.user.userId, home), error => error.status === 403);
      await coordinator.signOut(); who = 'alex'; await coordinator.signIn('google'); pause = null;
    }
    await f.flow.act(f.owner, begin.connectionId, 'disconnect');
    await assert.rejects(controller.source(f.owner, home, task.taskId), error => error.code === 'reconnect_required');
    await assert.rejects(controller.saveReply(f.owner, home, task.taskId, input), error => error.code === 'reconnect_required');
    const kept = await controller.read(f.owner, home); assert.equal(kept.work.tasks.find(item => item.id === task.taskId).completed, true); assert.equal(kept.work.events[0].taskId, task.taskId);
    assert.equal(JSON.stringify(f.db.exportState()).includes('Invented connected message.'), false); assert.equal(failures.length, 0);
  });
});
