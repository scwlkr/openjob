import test from 'node:test';
import assert from 'node:assert/strict';
import { createGmailReplyAdapter, GMAIL_SEND_SCOPE } from '../server/providers/gmail-reply-adapter.ts';
import { decodeFixtureGmailMessage } from './support/gmail-reply-transport.mjs';

const binding = { ownerId: 'owner_alex', workspaceId: 'workspace_a', accountId: 'gmail_a', subject: 'google_alex', address: 'alex@example.invalid' };
const draft = { storageKind: 'openjob', mode: 'reply-all', revision: 1, updatedAt: '2026-10-21T04:00:00.000Z', body: 'Résumé complete. 🧑🏽‍💻\n\nNext step: café.\n',
  plan: { from: binding.address, to: ['"Reply, Desk"@example.invalid', 'teammate@example.invalid'], cc: ['observer@example.invalid'], subject: 'Re: ' + 'Résumé 🧑🏽‍💻 '.repeat(12), inReplyTo: '<proposal@example.invalid>', references: ['<root@example.invalid>', '<proposal@example.invalid>'] } };
function harness(overrides = {}) {
  const posts = [], credentials = [], approvals = [];
  const credential = { accessToken: 'invented_send_token', subject: binding.subject, scopes: [GMAIL_SEND_SCOPE], expiresAt: Date.now() + 60_000 };
  const adapter = createGmailReplyAdapter({ bindings: [binding], approveExecution: async (...args) => { approvals.push(args); return true; }, resolveCredential: async selected => { credentials.push(selected); return credential; }, fetchImplementation: async (url, init) => { posts.push({ url, init }); return Response.json({ id: 'provider_message_1', threadId: 'thread_1', extra: 'must stay private' }); }, ...overrides });
  const input = { action: 'mail.send', ownerId: binding.ownerId, workspaceId: binding.workspaceId, accountId: binding.accountId, providerSubject: binding.subject, threadId: 'thread_1', draft: structuredClone(draft) };
  return { adapter, input, posts, credentials, approvals, credential, send: () => adapter.send(input, new AbortController().signal) };
}
test('Gmail protocol serializes reviewed Unicode text, recipients and thread; returns only accepted receipt', async () => {
  const h = harness(), result = await h.send();
  assert.deepEqual(result, { kind: 'accepted', provider: 'gmail', messageId: 'provider_message_1', threadId: 'thread_1' });
  assert.equal(h.posts.length, 1); const { url, init } = h.posts[0];
  assert.equal(url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send?fields=id,threadId'); assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
  assert.equal(new Headers(init.headers).get('authorization'), 'Bearer invented_send_token');
  const json = JSON.parse(init.body); assert.equal(json.threadId, h.input.threadId);
  const decoded = decodeFixtureGmailMessage(json.raw);
  assert.equal(decoded.headers.from, draft.plan.from); assert.equal(decoded.headers.to, draft.plan.to.join(', ')); assert.equal(decoded.headers.cc, draft.plan.cc.join(', '));
  assert.equal(decoded.headers['in-reply-to'], draft.plan.inReplyTo); assert.equal(decoded.headers.references, draft.plan.references.join(' '));
  assert.equal(decoded.subject, draft.plan.subject); assert.equal(decoded.body, draft.body.replaceAll('\n', '\r\n'));
  assert.equal(decoded.headers.date, 'Wed, 21 Oct 2026 04:00:00 GMT');
  assert.ok(decoded.mime.split('\r\n').every(line => line.length <= 998));
  assert.ok(decoded.mime.match(/=\?UTF-8\?B\?[^?]+\?=/g).every(word => word.length <= 75));
  assert.ok(decoded.mime.split('\r\n').filter(line => line.includes('=?UTF-8?B?')).every(line => line.length <= 76));
  assert.doesNotMatch(JSON.stringify(result), /extra|private|example.invalid|token/);
});
test('execution is closed by default and requires exact owned binding, send scope and verified subject/From', async () => {
  const closed = harness({ approveExecution: undefined }); await assert.rejects(closed.send, e => e.code === 'execution_disabled'); assert.equal(closed.credentials.length, 0); assert.equal(closed.posts.length, 0);
  for (const change of [{ ownerId: 'other' }, { workspaceId: 'other' }, { accountId: 'other' }, { providerSubject: 'other' }, { action: 'reply.simulate' }, { unexpected: true }]) {
    const h = harness(); Object.assign(h.input, change); await assert.rejects(h.send); assert.equal(h.posts.length, 0); assert.equal(h.credentials.length, 0);
  }
  for (const update of [c => { c.scopes = ['https://www.googleapis.com/auth/gmail.readonly']; }, c => { c.subject = 'other'; }, c => { c.expiresAt = 0; }]) {
    const h = harness(); update(h.credential); await assert.rejects(h.send); assert.equal(h.posts.length, 0);
  }
  const alias = harness(); alias.input.draft.plan.from = 'alias@example.invalid'; await assert.rejects(alias.send, e => e.code === 'forbidden'); assert.equal(alias.credentials.length, 0);
  assert.throws(() => createGmailReplyAdapter({ bindings: [binding], resolveCredential: async () => null }), e => e.code === 'invalid_input');
});
test('header injection, missing/noncanonical threading, unsupported addresses and ill-formed text cause zero POSTs', async () => {
  const changes = [d => { d.plan.subject = 'x\r\nBcc: outsider@example.invalid'; }, d => { d.plan.to = ['a@example.invalid, b@example.invalid']; }, d => { d.plan.cc = [d.plan.to[0]]; }, d => { delete d.plan.inReplyTo; }, d => { d.plan.references = []; }, d => { d.plan.references = ['<other@example.invalid>']; }, d => { d.plan.inReplyTo = '<a b@example.invalid>'; d.plan.references = [d.plan.inReplyTo]; }, d => { d.plan.to = ['世界@example.invalid']; }, d => { d.body = '\ud800'; }, d => { d.plan.subject = '\ud800'; }, d => { d.plan.from = 42; }];
  for (const change of changes) { const h = harness(); change(h.input.draft); await assert.rejects(h.send, e => e.code === 'invalid_input'); assert.equal(h.posts.length, 0); }
});
test('abort or revoked approval after slow credential lookup prevents a late POST; caller edits cannot change frozen bytes', async () => {
  let release, started; const ready = new Promise(resolve => { started = resolve; });
  const h = harness({ resolveCredential: async () => { started(); return new Promise(resolve => { release = resolve; }); } }), controller = new AbortController();
  const running = h.adapter.send(h.input, controller.signal); await ready; controller.abort(); release(h.credential);
  await assert.rejects(running, e => e.code === 'dispatch_unknown'); assert.equal(h.posts.length, 0);
  let checks = 0; const revoked = harness({ approveExecution: () => ++checks === 1 }); await assert.rejects(revoked.send, e => e.code === 'execution_disabled'); assert.equal(revoked.posts.length, 0);
  const frozen = harness({ approveExecution: async () => { frozen.input.draft.body = 'Edited after calling'; return true; } }); await frozen.send();
  assert.equal(decodeFixtureGmailMessage(JSON.parse(frozen.posts[0].init.body).raw).body, draft.body.replaceAll('\n', '\r\n'));
});
test('only known HTTP rejection is definite; lost/malformed/wrong-thread/oversized/timeout results remain unknown with one POST', async () => {
  for (const response of [new Response(null, { status: 403 }), new Response(null, { status: 429 })]) {
    let posts = 0; const h = harness({ fetchImplementation: async () => { posts++; return response; } }); assert.deepEqual(await h.send(), { kind: 'rejected' }); assert.equal(posts, 1);
  }
  for (const handler of [async () => { throw new Error('private provider failure'); }, async () => Response.json({ id: 'one', threadId: 'wrong' }), async () => new Response('broken', { headers: { 'content-type': 'application/json' } }), async () => Response.json({ id: 'one', threadId: 'thread_1', huge: 'x'.repeat(5000) }), async () => new Response(null, { status: 503 }), async () => new Response(null, { status: 302 }), async () => new Promise(() => {})]) {
    let posts = 0; const h = harness({ timeoutMs: 10, fetchImplementation: async (...args) => { posts++; return handler(...args); } });
    await assert.rejects(h.send, e => e.code === 'dispatch_unknown' && !e.message.includes('private')); assert.equal(posts, 1);
  }
});
