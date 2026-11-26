import assert from 'node:assert/strict';
import addresses from 'email-addresses';
import { createGmailReplyAdapter, GMAIL_SEND_SCOPE, GmailReplyError } from '../../server/providers/gmail-reply-adapter.ts';
import { operationHash, validateFrozenReply } from '../../shared/reply-operation.ts';

const TOKEN = 'invented_gmail_send_access';
export function fixtureGmailState(value = { attempts: [] }) {
  assert.deepEqual(Object.keys(value), ['attempts']); assert.ok(Array.isArray(value.attempts) && value.attempts.length <= 100);
  const seen = new Set();
  for (const row of value.attempts) {
    assert.deepEqual(Object.keys(row).sort(), ['mimeHash', 'receiptId', 'threadId']);
    assert.match(row.receiptId, /^sim_[a-f0-9]{32}$/); assert.match(row.mimeHash, /^[a-f0-9]{64}$/); assert.match(row.threadId, /^[A-Za-z0-9_-]{1,128}$/);
    assert.ok(!seen.has(row.receiptId)); seen.add(row.receiptId);
  }
  return structuredClone(value);
}
export function decodeFixtureGmailMessage(raw) {
  assert.equal(typeof raw, 'string'); assert.ok(raw.length <= 174764); assert.match(raw, /^[A-Za-z0-9_-]+$/);
  const mime = Buffer.from(raw, 'base64url').toString('utf8'); assert.equal(Buffer.from(mime).toString('base64url'), raw);
  const [head, body, ...extra] = mime.split('\r\n\r\n'); assert.equal(extra.length, 0); assert.ok(head && body);
  const headers = new Map();
  for (const line of head.replace(/\r\n[ \t]+/g, ' ').split('\r\n')) {
    const split = line.indexOf(':'); assert.ok(split > 0); const name = line.slice(0, split).toLowerCase(); assert.ok(!headers.has(name)); headers.set(name, line.slice(split + 1).trim());
  }
  assert.equal(headers.get('content-type'), 'text/plain; charset=UTF-8'); assert.equal(headers.get('content-transfer-encoding'), 'base64');
  for (const name of ['from', 'to', 'cc']) {
    if (!headers.has(name) && name === 'cc') continue;
    const parsed = addresses.parseAddressList({ input: headers.get(name), strict: true }); assert.ok(parsed?.length);
    assert.ok(parsed.every(row => row.type === 'mailbox' && row.domain.toLowerCase().endsWith('.invalid')));
  }
  assert.ok(!headers.has('bcc') && !headers.has('reply-to'));
  const subject = headers.get('subject').replace(/=\?UTF-8\?B\?([^?]+)\?=(?:\s+(?==\?UTF-8\?B\?))?/gi, (_, text) => Buffer.from(text, 'base64').toString('utf8'));
  return { headers: Object.fromEntries(headers), subject, body: Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8'), mime };
}
/** Fake provider and invented send credential are inseparable here; no network fallback. */
export function createFixtureGmailReplyDispatch({ binding, state = { attempts: [] }, persist = async () => {}, afterAccept = async () => {} }) {
  assert.ok(binding.address.endsWith('.invalid')); const ledger = fixtureGmailState(state), observed = [];
  let tail = Promise.resolve();
  const transport = async (input, init) => {
    assert.equal(String(input), 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send?fields=id,threadId');
    assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer ' + TOKEN);
    const request = JSON.parse(init.body); assert.deepEqual(Object.keys(request).sort(), ['raw', 'threadId']);
    assert.match(request.threadId, /^[A-Za-z0-9_-]{1,128}$/); const decoded = decodeFixtureGmailMessage(request.raw);
    assert.equal(decoded.headers.from.toLowerCase(), binding.address.toLowerCase());
    // Persist acceptance/count before a lost response can make the runner uncertain.
    const result = tail.then(async () => {
      assert.ok(ledger.attempts.length < 100);
      const receiptId = 'sim_' + crypto.randomUUID().replaceAll('-', ''), row = { receiptId, threadId: request.threadId, mimeHash: await operationHash(request) };
      ledger.attempts.push(row); await persist(fixtureGmailState(ledger)); observed.push({ ...decoded, threadId: request.threadId, receiptId });
      await afterAccept(structuredClone(row));
      return Response.json({ id: receiptId, threadId: request.threadId });
    });
    tail = result.catch(() => {}); return result;
  };
  const adapter = createGmailReplyAdapter({ bindings: [binding], approveExecution: () => true,
    resolveCredential: async () => ({ accessToken: TOKEN, subject: binding.subject, scopes: [GMAIL_SEND_SCOPE], expiresAt: Date.now() + 60_000 }), fetchImplementation: transport });
  return {
    observed, state: () => fixtureGmailState(ledger),
    async dispatch(value, signal) {
      const payload = validateFrozenReply(value);
      try {
        const result = await adapter.send({ action: 'mail.send', ownerId: payload.ownerUserId, workspaceId: payload.workspaceId, accountId: payload.source.accountId, providerSubject: payload.providerSubject, threadId: payload.source.threadId, draft: payload.draft }, signal);
        if (result.kind === 'rejected') return { kind: 'rejected' };
        // This ID was generated exclusively by this fake provider; never wrap a live receipt.
        assert.ok(ledger.attempts.some(row => row.receiptId === result.messageId && row.threadId === result.threadId));
        return { kind: 'confirmed', receiptId: result.messageId };
      } catch (error) {
        if (error instanceof GmailReplyError && error.code !== 'dispatch_unknown') return { kind: 'rejected' };
        throw error;
      }
    },
  };
}
