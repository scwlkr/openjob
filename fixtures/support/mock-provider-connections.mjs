// Invented Gmail, Outlook Graph and IMAP wire fixtures only. This module never uses global fetch or production credentials.
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
    const outlookId = `mock_outlook_${key}`;
    const outlook = { ...connection, provider: 'outlook', accountId: outlookId, label: `Mock Outlook protocol · ${name[0].toUpperCase() + name.slice(1)}`, address: `outlook.${key}@example.invalid`, credentialRef: `fixture_outlook_ref_${key}`, scopes: ['Mail.Read', 'User.Read'] };
    records.set(outlookId, outlook); accountIds[`outlook${name[0].toUpperCase() + name.slice(1)}`] = outlookId;
    secretRows.set(outlook.credentialRef, { connection: outlook, name, accessToken: `mock_outlook_access_${key}` });
    const imapId = `mock_imap_${key}`;
    const imap = { ...connection, provider: 'imap', accountId: imapId, subject: `imap_subject_${key}`, label: `Mock IMAP protocol · ${name[0].toUpperCase() + name.slice(1)}`, address: `imap.${key}@example.invalid`, credentialRef: `fixture_imap_ref_${key}`, scopes: ['imap.read'], imap: { serverId: `fixture_server_${key}`, username: `fixture_imap_user_${key}`, mailbox: 'INBOX' } };
    records.set(imapId, imap); accountIds[`imap${name[0].toUpperCase() + name.slice(1)}`] = imapId;
    secretRows.set(imap.credentialRef, { connection: imap, name, accessToken: `mock_imap_session_${key}` });
    if (name === 'alex') {
      const consentId = `${imapId}_consent`;
      records.set(consentId, { ...imap, accountId: consentId, subject: `imap_consent_${key}`, imap: { ...imap.imap, username: `fixture_imap_consent_${key}` }, credentialRef: `fixture_imap_consent_ref_${key}`, label: 'Mock IMAP protocol · consent required', state: 'needs_consent' });
      accountIds.imapConsent = consentId;
    }
    if (name === 'alex') {
      const consentId = `${outlookId}_consent`;
      records.set(consentId, { ...outlook, accountId: consentId, subject: `fixture_outlook_consent_${key}`, credentialRef: `fixture_outlook_consent_ref_${key}`, label: 'Mock Outlook protocol · consent required', state: 'needs_consent' });
      accountIds.outlookConsent = consentId;
    }
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
      if (!row || JSON.stringify(row.connection.imap ?? null) !== JSON.stringify(context.imap ?? null) || (row.connection.provider ?? 'gmail') !== (context.provider ?? 'gmail') || ['ownerId', 'accountId', 'subject', 'revision'].some(key => row.connection[key] !== context[key])) return null;
      return { accessToken: row.accessToken, subject: row.connection.subject, scopes: [...row.connection.scopes], expiresAt: now() + 60000 };
    },
  };
  const fetchImplementation = async (input, init) => {
    const url = new URL(input);
    if (init.method !== 'GET' || init.redirect !== 'error' || init.body !== undefined) throw new Error('Invalid mock protocol request');
    const authorization = new Headers(init.headers).get('authorization');
    const fixture = [...secretRows.values()].find(row => authorization === `Bearer ${row.accessToken}`);
    if (!fixture) return Response.json({ error: { message: 'Mock authorization unavailable' } }, { status: 401 });
    if (fixture.connection.provider === 'outlook') {
      if (url.origin !== 'https://graph.microsoft.com' || !url.pathname.startsWith('/v1.0/me')) throw new Error('Invalid mock Graph request');
      const prefer = new Headers(init.headers).get('prefer');
      if (!prefer?.includes('IdType="ImmutableId"') || !prefer.includes('outlook.body-content-type="text"')) throw new Error('Missing mock Graph read preferences');
      counters.requests++;
      const path = decodeURIComponent(url.pathname.slice('/v1.0/me'.length));
      if (!path) return Response.json({ id: fixture.connection.subject, mail: fixture.connection.address, userPrincipalName: fixture.connection.address });
      if (path === '/messages') {
        const token = url.searchParams.get('$skiptoken'); if (token !== null && token !== 'mock-graph-page-2') throw new Error('Unknown mock Graph page');
        return Response.json({ value: (token ? [3] : [1, 2]).map(index => ({ id: `AAMkMessage${index}==` })), ...(!token ? { '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/messages?$top=10&$select=id&$skiptoken=mock-graph-page-2' } : {}) });
      }
      if (path === '/mailFolders/AAMkInbox==') return Response.json({ id: 'AAMkInbox==', displayName: 'Inbox' });
      const index = Number(path.match(/^\/messages\/AAMkMessage([123])==$/)?.[1]); if (!index) throw new Error('Unknown mock Graph read');
      return Response.json({ id: `AAMkMessage${index}==`, conversationId: 'AAQkThread==', parentFolderId: 'AAMkInbox==', subject: ['Outlook fixture: prepare the launch', 'Outlook fixture: review the plan', 'Outlook fixture: follow up'][index - 1], from: { emailAddress: { name: 'Mia', address: 'sender@example.invalid' } }, toRecipients: [{ emailAddress: { address: fixture.connection.address } }], body: { contentType: 'text', content: `Invented message read through the Outlook Graph wire mapper for ${fixture.name}. No live mailbox was contacted. Café 日本語.` }, receivedDateTime: '2026-10-17T09:00:00.000Z', isRead: false });
    }
    if (url.origin !== 'https://gmail.googleapis.com' || !url.pathname.startsWith('/gmail/v1/users/me/')) throw new Error('Invalid mock Gmail request');
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
  const uidValidity = new Map();
  const imapSessionFactory = async (binding, credential) => {
    const fixture = [...secretRows.values()].find(row => row.connection.provider === 'imap' && row.accessToken === credential.accessToken && row.connection.accountId === binding.accountId && row.connection.ownerId === binding.ownerId && row.connection.subject === binding.subject && JSON.stringify(row.connection.imap) === JSON.stringify(binding.imap));
    if (!fixture) throw new Error('Invalid mock IMAP session binding');
    let closed = false;
    return { binding: structuredClone(binding), close() { closed = true; }, async exchange(command) {
      if (closed) throw new Error('Mock IMAP session closed');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(command); const tag = /^A[0-9]{3}/.exec(text)?.[0];
      if (!tag) throw new Error('Invalid mock IMAP command');
      counters.requests++;
      if (text === `${tag} EXAMINE INBOX\r\n`) return Buffer.from(`* FLAGS (\\Seen)\r\n* 3 EXISTS\r\n* OK [UIDVALIDITY ${uidValidity.get(binding.accountId) ?? 17}] UIDs valid\r\n${tag} OK [READ-ONLY] EXAMINE completed\r\n`);
      if (text === `${tag} UID SEARCH ALL\r\n`) return Buffer.from(`* SEARCH 1 2 3\r\n${tag} OK SEARCH completed\r\n`);
      const uid = /^A[0-9]{3} UID FETCH ([123]) \(UID FLAGS INTERNALDATE BODY\.PEEK\[\]\)\r\n$/.exec(text)?.[1];
      if (!uid) throw new Error('Unknown mock IMAP read');
      const subject = ['IMAP fixture: prepare the launch', 'IMAP fixture: review the plan', 'IMAP fixture: follow up'][Number(uid) - 1];
      const body = `Invented message read through the IMAP wire mapper for ${fixture.name}. No live mailbox was contacted. Café 日本語.`;
      const raw = Buffer.from([`Subject: ${subject}`, 'From: Mia <sender@example.invalid>', `To: ${fixture.connection.address}`, 'Date: Sat, 17 Oct 2026 09:00:00 +0000', `Message-ID: <imap-${uid}@example.invalid>`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 8bit', '', body, ''].join('\r\n'));
      return Buffer.concat([Buffer.from(`* ${uid} FETCH (UID ${uid} FLAGS () INTERNALDATE "17-Oct-2026 09:00:00 +0000" BODY[] {${raw.length}}\r\n`), raw, Buffer.from(`)\r\n${tag} OK FETCH completed\r\n`)]);
    } };
  };
  const reader = createProviderConnectionReader({ store, broker, isOwnerActive, executionMode: 'mock', fetchImplementation, imapSessionFactory, imapPageSize: 2, now });
  const controls = {
    resetImap(accountId) { if (records.get(accountId)?.provider !== 'imap') return false; uidValidity.set(accountId, (uidValidity.get(accountId) ?? 17) + 1); return true; },
    revoke(accountId) { const row = records.get(accountId); if (!row) return false; row.state = 'revoked'; row.revision = String(Number(row.revision) + 1); return true; },
  };
  return { reader, store, broker, controls, counters, accountIds };
}
