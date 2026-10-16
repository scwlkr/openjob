import assert from 'node:assert/strict';
import test from 'node:test';
import { createGmailReadAdapter, describeGmailReadAdapter } from '../server/providers/gmail-read-adapter.ts';
const NOW = Date.parse('2026-10-17T00:00:00Z');
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const TOKEN = 'invented-upstream-access-token';
const BINDING = { ownerId: 'user_fixture', accountId: 'gmail_primary', subject: 'google_subject_fixture', address: 'alex@example.invalid', label: 'Gmail fixture' };
const encode = text => Buffer.from(text, 'utf8').toString('base64url');
const matchCode = code => error => error.code === code && !error.message.includes(TOKEN) && !error.message.includes('SECRET_PROVIDER_BODY');
function message(id = 'abc123') {
  return { id, threadId: 'thread1', labelIds: ['INBOX', 'UNREAD'], internalDate: String(NOW), payload: { mimeType: 'multipart/mixed', headers: [{ name: 'Subject', value: 'Invented launch' }, { name: 'From', value: 'Mia <mia@example.invalid>' }, { name: 'To', value: BINDING.address }], parts: [
    { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset=UTF-8' }], body: { data: encode('Hello café 日本語') } }, { mimeType: 'text/html', body: { data: encode('<script>never render</script>') } }] },
    { mimeType: 'text/plain', filename: 'private.txt', body: { attachmentId: 'attachment1', data: encode('attachment must not load') } },
  ] } };
}
function fixture(overrides = {}) {
  const calls = []; let resolved = 0;
  const baseWire = url => {
    if (url.pathname.endsWith('/profile')) return { emailAddress: BINDING.address, historyId: 'not-used' };
    if (url.pathname.endsWith('/labels')) return { labels: [{ id: 'INBOX', name: 'Inbox' }, { id: 'UNREAD', name: 'Unread' }] };
    if (url.pathname.endsWith('/messages')) return { messages: [{ id: 'abc123', threadId: 'thread1' }], ...(url.searchParams.has('pageToken') ? {} : { nextPageToken: 'next_page+/=' }) };
    if (url.pathname.endsWith('/messages/abc123')) return message();
    throw new Error('Unexpected synthetic request');
  };
  const fetcher = async (input, init = {}) => {
    const url = new URL(input); calls.push({ url, init });
    const result = await (overrides.wire ?? baseWire)(url, init, baseWire);
    return result instanceof Response ? result : Response.json(result);
  };
  const adapter = createGmailReadAdapter({ bindings: overrides.bindings ?? [BINDING], resolveCredential: async binding => { resolved++; return overrides.credential === null ? null : { accessToken: TOKEN, subject: binding.subject, scopes: [SCOPE], expiresAt: NOW + 60000, ...overrides.credential }; }, approveExecution: overrides.approveExecution ?? (() => true), fetchImplementation: fetcher, now: overrides.now ?? (() => NOW), timeoutMs: overrides.timeoutMs ?? 100 });
  return { adapter, calls, resolved: () => resolved };
}
const read = adapter => adapter.listMessages({ ownerId: BINDING.ownerId, accountId: BINDING.accountId });

test('closed-by-default gate and static catalog perform no credential lookup or HTTP', async () => {
  let credentials = 0; let fetches = 0;
  const adapter = createGmailReadAdapter({ bindings: [BINDING], resolveCredential: async () => { credentials++; throw new Error('Must not resolve'); }, fetchImplementation: async () => { fetches++; throw new Error('Must not fetch'); } });
  const accounts = await adapter.listAccounts(BINDING.ownerId); assert.equal(accounts[0].status, 'not_connected'); assert.equal(accounts[0].sync.asOf, null);
  await assert.rejects(read(adapter), matchCode('execution_disabled'));
  await assert.rejects(adapter.readChanges({ ownerId: BINDING.ownerId, accountId: BINDING.accountId, syncCursor: 'anything' }), matchCode('unsupported_operation'));
  assert.equal(credentials, 0); assert.equal(fetches, 0);
  const catalog = describeGmailReadAdapter(); assert.equal(catalog[0].liveExecutionEnabled, false); assert.equal(catalog[0].consent, 'required'); assert.ok(catalog[0].unsupportedOperations.includes('sync.history'));
  assert.equal(JSON.stringify(catalog).includes(TOKEN), false); catalog[0].implementedOperations.push('mail.send'); assert.equal(describeGmailReadAdapter()[0].implementedOperations.includes('mail.send'), false);
});

test('approved synthetic HTTP maps Gmail profile, labels, nested UTF8 plaintext and bound page token', async () => {
  const f = fixture(); const first = await read(f.adapter);
  assert.equal(first.messages.length, 1); assert.equal(first.messages[0].body, 'Hello café 日本語');
  assert.equal(first.messages[0].subject, 'Invented launch'); assert.equal(first.messages[0].receivedAt, '2026-10-17T00:00:00.000Z'); assert.equal(first.messages[0].read, false);
  assert.equal(first.messages[0].id, 'gmail_primary:message:abc123'); assert.equal(first.messages[0].threadId, 'gmail_primary:thread:thread1'); assert.equal(first.folders[0].id, 'gmail_primary:folder:INBOX');
  assert.deepEqual(first.calendars, []); assert.deepEqual(first.events, []); assert.equal(first.syncCursor, null);
  const second = await f.adapter.listMessages({ ownerId: BINDING.ownerId, accountId: BINDING.accountId, cursor: first.nextCursor }); assert.equal(second.nextCursor, null);
  assert.equal(f.calls.find(call => call.url.searchParams.has('pageToken')).url.searchParams.get('pageToken'), 'next_page+/=');
  for (const { url, init } of f.calls) { assert.equal(url.origin, 'https://gmail.googleapis.com'); assert.ok(url.pathname.startsWith('/gmail/v1/users/me/')); assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store'); assert.equal(init.headers.authorization, `Bearer ${TOKEN}`); assert.equal(init.body, undefined); }
  assert.equal(f.calls.filter(call => call.url.pathname.includes('attachments')).length, 0);
  assert.equal(JSON.stringify(first).includes(TOKEN), false); assert.equal(JSON.stringify(first).includes('not-used'), false);
});

test('owner, subject, address, readonly consent and expiry deny before unrelated mailbox content', async () => {
  const f = fixture(); await assert.rejects(f.adapter.listMessages({ ownerId: 'user_other', accountId: BINDING.accountId }), matchCode('forbidden')); assert.equal(f.calls.length, 0); assert.equal(f.resolved(), 0);
  for (const credential of [null, { subject: 'other_subject' }, { expiresAt: NOW }, { accessToken: 'bad\ntoken' }]) { const denied = fixture({ credential }); await assert.rejects(read(denied.adapter), matchCode('authentication_required')); assert.equal(denied.calls.length, 0); }
  const noConsent = fixture({ credential: { scopes: ['https://www.googleapis.com/auth/gmail.metadata'] } }); await assert.rejects(read(noConsent.adapter), matchCode('consent_required')); assert.equal(noConsent.calls.length, 0);
  const foreignProfile = fixture({ wire: () => ({ emailAddress: 'someone-else@example.invalid' }) }); await assert.rejects(read(foreignProfile.adapter), matchCode('authentication_required')); assert.equal(foreignProfile.calls.length, 1);
  const bindings = [BINDING]; const detached = fixture({ bindings }); bindings[0] = { ...BINDING, ownerId: 'user_other' }; assert.equal((await read(detached.adapter)).messages.length, 1);
});

test('page cursors reject foreign owner/account/subject, operation mode and malformed input before HTTP', async () => {
  const f = fixture(); const page = await read(f.adapter); const before = f.calls.length;
  for (const cursor of ['', 'pv1.fake', page.nextCursor + '=', 'x'.repeat(4097)]) await assert.rejects(f.adapter.listMessages({ ownerId: BINDING.ownerId, accountId: BINDING.accountId, cursor }), matchCode('invalid_cursor'));
  assert.equal(f.calls.length, before);
  for (const binding of [{ ...BINDING, ownerId: 'user_other' }, { ...BINDING, accountId: 'gmail_secondary' }, { ...BINDING, subject: 'new_subject' }]) {
    const other = fixture({ bindings: [binding] }); await assert.rejects(other.adapter.listMessages({ ownerId: binding.ownerId, accountId: binding.accountId, cursor: page.nextCursor }), matchCode('invalid_cursor')); assert.equal(other.calls.length, 0);
  }
});

test('typed provider failures expose no raw response or token and never retry', async () => {
  for (const [status, reason, code] of [[401, 'authError', 'authentication_required'], [403, 'insufficientPermissions', 'consent_required'], [403, 'rateLimitExceeded', 'rate_limited'], [403, 'domainPolicy', 'provider_forbidden'], [429, 'anything', 'rate_limited'], [503, 'backendError', 'provider_error']]) {
    const f = fixture({ wire: () => Response.json({ error: { message: `SECRET_PROVIDER_BODY ${TOKEN}`, errors: [{ reason }] } }, { status }) });
    await assert.rejects(read(f.adapter), matchCode(code)); assert.equal(f.calls.length, 1);
  }
  const network = fixture({ wire: () => { throw new Error(`SECRET_PROVIDER_BODY ${TOKEN}`); } }); await assert.rejects(read(network.adapter), matchCode('network_error')); assert.equal(network.calls.length, 1);
  const redirect = fixture({ wire: () => new Response(null, { status: 302, headers: { location: 'https://evil.example.invalid' } }) }); await assert.rejects(read(redirect.adapter), matchCode('network_error')); assert.equal(redirect.calls.length, 1);
  const hanging = fixture({ wire: () => new Promise(() => {}), timeoutMs: 5 }); await assert.rejects(read(hanging.adapter), matchCode('timeout')); assert.equal(hanging.calls.length, 1);
});

test('duplicate, malformed and foreign response identities fail closed', async () => {
  const badWires = [
    (url, base) => url.pathname.endsWith('/messages/abc123') ? { ...message(), id: 'foreign' } : base(url),
    (url, base) => url.pathname.endsWith('/messages/abc123') ? { ...message(), threadId: 'foreign' } : base(url),
    (url, base) => url.pathname.endsWith('/messages') ? { messages: [{ id: 'abc123', threadId: 'thread1' }, { id: 'abc123', threadId: 'thread1' }] } : base(url),
    (url, base) => url.pathname.endsWith('/messages') ? { messages: [{ id: '../profile', threadId: 'thread1' }] } : base(url),
    (url, base) => url.pathname.endsWith('/labels') ? { labels: [{ id: 'INBOX', name: 'Inbox' }, { id: 'INBOX', name: 'Duplicate' }] } : base(url),
    (url, base) => url.pathname.endsWith('/messages/abc123') ? { ...message(), labelIds: ['UNKNOWN'] } : base(url),
    (url, base) => url.pathname.endsWith('/messages/abc123') ? { ...message(), internalDate: 'not-a-date' } : base(url),
    (url, base) => url.pathname.endsWith('/messages/abc123') ? { ...message(), internalDate: '999999999999999' } : base(url),
  ];
  for (const wire of badWires) { const f = fixture({ wire: (url, _init, base) => wire(url, base) }); await assert.rejects(read(f.adapter), matchCode('malformed_response')); }
});

test('bounded JSON, MIME depth, invalid UTF8/base64 and unsupported charsets fail safely; HTML is never rendered', async () => {
  const tooLarge = fixture({ wire: () => new Response('x'.repeat(262145), { headers: { 'content-type': 'application/json' } }) }); await assert.rejects(read(tooLarge.adapter), matchCode('malformed_response'));
  const oversizedHeader = fixture({ wire: () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '999999' } }) }); await assert.rejects(read(oversizedHeader.adapter), matchCode('malformed_response'));
  for (const [payload, code] of [
    [{ mimeType: 'text/plain', body: { data: '_w' } }, 'malformed_response'],
    [{ mimeType: 'text/plain', body: { data: '%bad' } }, 'malformed_response'],
    [{ mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset=iso-8859-1' }], body: { data: encode('abc') } }, 'unsupported_operation'],
  ]) {
    const f = fixture({ wire: (url, _init, base) => url.pathname.endsWith('/messages/abc123') ? { ...message(), payload } : base(url) }); await assert.rejects(read(f.adapter), matchCode(code));
  }
  let deep = { mimeType: 'text/plain', body: { data: encode('deep') } }; for (let n = 0; n < 12; n++) deep = { mimeType: 'multipart/mixed', parts: [deep] };
  const depth = fixture({ wire: (url, _init, base) => url.pathname.endsWith('/messages/abc123') ? { ...message(), payload: deep } : base(url) }); await assert.rejects(read(depth.adapter), matchCode('malformed_response'));
  const html = fixture({ wire: (url, _init, base) => url.pathname.endsWith('/messages/abc123') ? { ...message(), payload: { mimeType: 'text/html', body: { data: encode('<script>SECRET_PROVIDER_BODY</script>') } } } : base(url) });
  const result = await read(html.adapter); assert.match(result.messages[0].body, /Plain-text content unavailable/); assert.equal(result.messages[0].body.includes('<script>'), false);
  const attachment = fixture({ wire: (url, _init, base) => url.pathname.endsWith('/messages/abc123') ? { ...message(), payload: { mimeType: 'text/plain', body: { attachmentId: 'attachment_1' } } } : base(url) });
  assert.match((await read(attachment.adapter)).messages[0].body, /Plain-text content unavailable/);
  const empty = fixture({ wire: (url, _init, base) => url.pathname.endsWith('/messages/abc123') ? { ...message(), payload: { mimeType: 'text/plain', body: { data: '' } } } : base(url) });
  assert.equal((await read(empty.adapter)).messages[0].body, '');
});

test('execution approval and credential expiry are rechecked across asynchronous reads', async () => {
  let approved = true; const denied = fixture({ approveExecution: () => approved, wire: (url, _init, base) => { const result = base(url); if (url.pathname.endsWith('/profile')) approved = false; return result; } });
  await assert.rejects(read(denied.adapter), matchCode('execution_disabled')); assert.equal(denied.calls.length, 1);
  let now = NOW; const expired = fixture({ now: () => now, wire: (url, _init, base) => { const result = base(url); if (url.pathname.endsWith('/profile')) now = NOW + 60000; return result; } });
  await assert.rejects(read(expired.adapter), matchCode('authentication_required')); assert.equal(expired.calls.length, 1);
});

test('UTF8 opaque page tokens roundtrip canonically and repeated provider page tokens fail closed', async () => {
  const nextPage = '次のページ/é_+';
  const f = fixture({ wire: (url, _init, base) => url.pathname.endsWith('/messages') ? { messages: [], ...(url.searchParams.has('pageToken') ? {} : { nextPageToken: nextPage }) } : base(url) });
  const first = await read(f.adapter);
  const second = await f.adapter.listMessages({ ownerId: BINDING.ownerId, accountId: BINDING.accountId, cursor: first.nextCursor });
  assert.equal(second.nextCursor, null); assert.equal(f.calls.find(call => call.url.searchParams.has('pageToken')).url.searchParams.get('pageToken'), nextPage);
  const loop = fixture({ wire: (url, _init, base) => url.pathname.endsWith('/messages') ? { messages: [], nextPageToken: 'same-token' } : base(url) });
  const initial = await read(loop.adapter);
  await assert.rejects(loop.adapter.listMessages({ ownerId: BINDING.ownerId, accountId: BINDING.accountId, cursor: initial.nextCursor }), matchCode('malformed_response'));
});

test('resolved credential metadata is detached before asynchronous provider reads', async () => {
  const credential = { accessToken: TOKEN, subject: BINDING.subject, scopes: [SCOPE], expiresAt: NOW + 60000 };
  const tokens = [];
  const adapter = createGmailReadAdapter({ bindings: [BINDING], resolveCredential: async () => credential, approveExecution: () => true, now: () => NOW, fetchImplementation: async (input, init) => {
    tokens.push(init.headers.authorization); const url = new URL(input);
    if (url.pathname.endsWith('/profile')) { credential.accessToken = 'foreign-token'; credential.subject = 'foreign-subject'; credential.scopes.length = 0; return Response.json({ emailAddress: BINDING.address }); }
    if (url.pathname.endsWith('/labels')) return Response.json({ labels: [] });
    return Response.json({ messages: [] });
  } });
  assert.deepEqual((await read(adapter)).messages, []);
  assert.deepEqual(tokens, [`Bearer ${TOKEN}`, `Bearer ${TOKEN}`, `Bearer ${TOKEN}`]);
});

test('maximum accepted Unicode cursor fields emit a usable bounded owner/account cursor', async () => {
  const binding = { ...BINDING, ownerId: 'u'.repeat(128), accountId: 'a'.repeat(128), subject: '界'.repeat(256) };
  const upstreamPage = '頁'.repeat(256);
  const f = fixture({ bindings: [binding], wire: (url, _init, base) => url.pathname.endsWith('/messages') ? { messages: [], ...(url.searchParams.has('pageToken') ? {} : { nextPageToken: upstreamPage }) } : base(url) });
  const first = await f.adapter.listMessages({ ownerId: binding.ownerId, accountId: binding.accountId });
  assert.ok(first.nextCursor.length > 512); assert.ok(first.nextCursor.length <= 4096);
  const second = await f.adapter.listMessages({ ownerId: binding.ownerId, accountId: binding.accountId, cursor: first.nextCursor });
  assert.equal(second.nextCursor, null);
  assert.equal(f.calls.find(call => call.url.searchParams.has('pageToken')).url.searchParams.get('pageToken'), upstreamPage);
});
