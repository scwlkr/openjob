import { createNativeConnectedWorkspaceApi } from '../src/connected-workspaces-api';
import { mailReadFreshness } from '../../shared/connected-mail-freshness';

const owner = `user_${'a'.repeat(32)}`, workspaceId = `wsp_${'b'.repeat(32)}`, connection = `con_${'c'.repeat(32)}`, account = `gmail_${'d'.repeat(32)}`, base = 'https://fixture.example.invalid/api/v1';
const summary = { id: `${account}:message:m1`, accountId: account, upstreamId: 'm1', upstreamThreadId: 't1', threadId: `${account}:thread:t1`, folderIds: [`${account}:folder:INBOX`], from: 'colleague@example.invalid', to: 'alex@example.invalid', subject: 'Proposal', read: true, receivedAt: '2026-10-20T00:00:00.000Z' };
const page = () => ({ mode: 'google-fixture', workspaceId, freshness: mailReadFreshness(Date.now(), Date.now() + 3600000), page: { messages: [summary], folders: [{ id: `${account}:folder:INBOX`, accountId: account, upstreamId: 'INBOX', name: 'Inbox' }], calendars: [], events: [], nextCursor: 'opaque-next', syncCursor: null } });
const json = (data: unknown) => new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } });
test('native Mail uses metadata query with exact filters/cursor, then a separate explicitly selected body route', async () => {
  const fetcher = jest.fn().mockResolvedValueOnce(json(page())).mockResolvedValueOnce(json({ mode: 'google-fixture', workspaceId, message: { ...summary, body: 'Invented body' } }));
  const api = createNativeConnectedWorkspaceApi({ apiBaseUrl: base, fetchImplementation: fetcher });
  const value = await api.mail('fixture-token', owner, workspaceId, connection, { cursor: 'opaque-prior', folderId: `${account}:folder:INBOX`, search: ' subject:proposal ' });
  expect(Object.hasOwn(value.page.messages[0]!, 'body')).toBe(false); expect(fetcher).toHaveBeenCalledTimes(1);
  const url = new URL(fetcher.mock.calls[0]![0]); expect(url.pathname).toBe(`/api/v1/connections/${connection}/mail`); expect(Object.fromEntries(url.searchParams)).toEqual({ view: 'metadata', cursor: 'opaque-prior', folderId: `${account}:folder:INBOX`, search: 'subject:proposal' });
  expect((await api.message('fixture-token', owner, workspaceId, connection, 'm1')).message.body).toBe('Invented body');
  expect(fetcher.mock.calls[1]![0]).toBe(`${base}/connections/${connection}/mail/m1`);
  for (const [, init] of fetcher.mock.calls) { expect(init.headers.authorization).toBe('Bearer fixture-token'); expect(init.cache).toBe('no-store'); expect(init.redirect).toBe('error'); }
});
test('native metadata rejects bodies/snippets, foreign home/accounts, malformed IDs/freshness and unexpected fields', async () => {
  const bad = [
    { ...page(), workspaceId: `wsp_${'e'.repeat(32)}` }, { ...page(), extra: 'private' },
    { ...page(), freshness: { observedAt: '2026-10-20T00:00:00.000Z', staleAt: '2026-10-20T00:01:00.000Z', expiresAt: '2026-10-20T00:06:00.000Z' } },
    ...[{ body: 'private' }, { snippet: 'private' }, { id: 'm1' }, { threadId: 'foreign' }, { secret: 'private' }].map(fields => ({ ...page(), page: { ...page().page, messages: [{ ...summary, ...fields }] } })),
    { ...page(), page: { ...page().page, folders: [{ id: 'foreign', accountId: account, upstreamId: 'INBOX', name: 'Inbox' }] } },
  ];
  for (const data of bad) {
    const api = createNativeConnectedWorkspaceApi({ apiBaseUrl: base, fetchImplementation: jest.fn(async () => json(data)) });
    await expect(api.mail('fixture', owner, workspaceId, connection)).rejects.toMatchObject({ status: 502, code: 'invalid_response' });
  }
  const wrongBody = createNativeConnectedWorkspaceApi({ apiBaseUrl: base, fetchImplementation: jest.fn(async () => json({ workspaceId, mode: 'google-fixture', message: { ...summary, id: `${account}:message:m2`, upstreamId: 'm2', body: 'wrong message' } })) });
  await expect(wrongBody.message('fixture', owner, workspaceId, connection, 'm1')).rejects.toMatchObject({ code: 'invalid_response' });
});
test('invalid query is rejected before transport; public Mail recovery codes stay redacted without retry', async () => {
  const fetcher = jest.fn(); const api = createNativeConnectedWorkspaceApi({ apiBaseUrl: base, fetchImplementation: fetcher });
  for (const query of [{ search: 'x'.repeat(513) }, { folderId: 'foreign' }, { cursor: 'x'.repeat(4097) }, { search: 'line\nbreak' }, { view: 'full' }]) await expect(api.mail('fixture', owner, workspaceId, connection, query as never)).rejects.toMatchObject({ status: 400, code: 'invalid_input' });
  expect(fetcher).not.toHaveBeenCalled();
  for (const code of ['invalid_cursor', 'folder_unavailable', 'search_rejected', 'message_unavailable', 'reconnect_required']) {
    const transport = jest.fn(async () => new Response(JSON.stringify({ error: { code, message: 'PRIVATE_PROVIDER_DETAILS' } }), { status: 409 }));
    const client = createNativeConnectedWorkspaceApi({ apiBaseUrl: base, fetchImplementation: transport });
    try { await client.mail('fixture', owner, workspaceId, connection); throw new Error('Expected denial'); }
    catch (error) { expect(error).toMatchObject({ status: 409, code }); expect(String(error)).not.toContain('PRIVATE_PROVIDER_DETAILS'); }
    expect(transport).toHaveBeenCalledTimes(1);
  }
});
