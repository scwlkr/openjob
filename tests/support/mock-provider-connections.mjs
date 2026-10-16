// Invented Gmail wire fixtures only. This module never uses global fetch or production credentials.
import { createProviderConnectionReader } from '../../server/providers/provider-connections.ts';

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const WHEN = String(Date.parse('2026-10-17T09:00:00.000Z'));
const encode = text => Buffer.from(text, 'utf8').toString('base64url');

export async function createMockProviderConnectionHarness({ owners, isOwnerActive, now = Date.now }) {
  const records = new Map(); const secretRows = new Map(); const accountIds = {};
  const counters = { credentialLookups: 0, requests: 0 };
  for (const [name, ownerId] of Object.entries(owners)) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ownerId));
    const key = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 24);
    const accountId = `mock_gmail_${key}`; const credentialRef = `fixture_ref_${key}`;
    const connection = { ownerId, accountId, subject: `fixture_subject_${key}`,
      address: `mock.${key}@example.invalid`, label: `Mock Gmail protocol · ${name[0].toUpperCase() + name.slice(1)}`,
      credentialRef, scopes: [SCOPE], state: 'approved', expiresAt: now() + 86400000,
      revision: '1', mode: 'mock' };
    records.set(accountId, connection); accountIds[name] = accountId;
    secretRows.set(credentialRef, { connection, name, accessToken: `mock_access_${key}` });
    if (name === 'alex') {
      const consentId = `${accountId}_consent`;
      records.set(consentId, { ...connection, accountId: consentId, label: 'Mock Gmail protocol · consent required', subject: `fixture_consent_${key}`, address: `consent.${key}@example.invalid`, credentialRef: `fixture_consent_ref_${key}`, state: 'needs_consent' });
      accountIds.consent = consentId;
    }
  }
  const store = {
    async listForOwner(ownerId) { return [...records.values()].filter(row => row.ownerId === ownerId).map(row => structuredClone(row)); },
    async getForOwner(ownerId, accountId) { const row = records.get(accountId); return row?.ownerId === ownerId ? structuredClone(row) : null; },
  };
  const broker = {
    async resolve(ref, context) {
      counters.credentialLookups++;
      const row = secretRows.get(ref);
      if (!row || ['ownerId', 'accountId', 'subject'].some(key => row.connection[key] !== context[key])) return null;
      return { accessToken: row.accessToken, subject: row.connection.subject, scopes: [SCOPE], expiresAt: now() + 60000 };
    },
  };
  const fetchImplementation = async (input, init) => {
    const url = new URL(input);
    if (url.origin !== 'https://gmail.googleapis.com' || !url.pathname.startsWith('/gmail/v1/users/me/') || init.method !== 'GET' || init.redirect !== 'error' || init.body !== undefined) throw new Error('Invalid mock protocol request');
    const authorization = new Headers(init.headers).get('authorization');
    const fixture = [...secretRows.values()].find(row => authorization === `Bearer ${row.accessToken}`);
    if (!fixture) return Response.json({ error: { message: 'Mock authorization unavailable' } }, { status: 401 });
    counters.requests++;
    const path = url.pathname.slice('/gmail/v1/users/me/'.length);
    if (path === 'profile') return Response.json({ emailAddress: fixture.connection.address });
    if (path === 'labels') return Response.json({ labels: [{ id: 'INBOX', name: 'Inbox' }, { id: 'UNREAD', name: 'Unread' }, { id: 'Label_1', name: 'Planning' }] });
    if (path === 'messages') {
      const token = url.searchParams.get('pageToken');
      if (token !== null && token !== 'mock-page-2') throw new Error('Unknown mock page');
      const ids = token ? ['mock_msg_3'] : ['mock_msg_1', 'mock_msg_2'];
      return Response.json({ messages: ids.map(id => ({ id, threadId: 'mock_thread_launch' })), ...(!token ? { nextPageToken: 'mock-page-2' } : {}) });
    }
    const id = path.match(/^messages\/(mock_msg_[123])$/)?.[1];
    if (!id) throw new Error('Unknown mock read');
    const index = Number(id.at(-1));
    return Response.json({ id, threadId: 'mock_thread_launch', labelIds: ['INBOX', 'UNREAD', 'Label_1'], internalDate: WHEN,
      payload: { mimeType: 'multipart/alternative', headers: [{ name: 'Subject', value: ['Protocol fixture: prepare the launch', 'Protocol fixture: review the plan', 'Protocol fixture: follow up'][index - 1] }, { name: 'From', value: 'Mia <sender@example.invalid>' }, { name: 'To', value: fixture.connection.address }],
        parts: [{ mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset=UTF-8' }], body: { data: encode(`Invented message read through the Gmail wire mapper for ${fixture.name}. No live mailbox was contacted. Café 日本語.`) } }, { mimeType: 'text/html', body: { data: encode('<b>This HTML is never rendered.</b>') } }] } });
  };
  const reader = createProviderConnectionReader({ store, broker, isOwnerActive, executionMode: 'mock', fetchImplementation, now });
  const controls = {
    revoke(accountId) { const row = records.get(accountId); if (!row) return false; row.state = 'revoked'; row.revision = String(Number(row.revision) + 1); return true; },
  };
  return { reader, store, broker, controls, counters, accountIds };
}
