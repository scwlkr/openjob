import { createNativePersonalWorkspaceApi } from '../src/personal-workspace-api';
import { OpenJobApiError, ProviderSignInError } from '../src/auth/coordinator';
const owner = 'user_alex';
const empty = () => ({ accounts: [], messages: [], drafts: [], sent: [], agents: [], tasks: [], events: [], activity: [], calendars: [{ id: 'personal', ownerId: owner, name: 'Personal', color: '#2454dc' }] });
const json = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status });
const grant = () => ({ id: `agt_${'a'.repeat(32)}`, ownerUserId: owner, name: 'Planner', scopes: ['tasks:read'], resourceIds: ['tasks:personal'], createdAt: '2026-10-17T00:00:00.000Z', expiresAt: '2026-10-18T00:00:00.000Z', revoked: false });
const base = 'https://service.example.invalid/api/v1';
test('task-calendar sync API validates sanitized projection and exact operation acknowledgments', async () => {
  const revision = `tc1_${'a'.repeat(64)}`; const projection = { tasks: [], calendars: empty().calendars, events: [] };
  const operationId = '00000000-0000-4000-8000-000000000001';
  const input = { operationId, baseRevision: revision, expiresAt: '2026-10-18T00:00:00.000Z', projection };
  const fetcher = jest.fn().mockResolvedValueOnce(json({ revision, projection })).mockResolvedValueOnce(json({ operationId, revision }));
  const api = createNativePersonalWorkspaceApi({ apiBaseUrl: base, fetchImplementation: fetcher });
  await expect(api.readTaskCalendarSync!('private-token', owner)).resolves.toEqual({ revision, projection });
  await expect(api.syncTaskCalendar!('private-token', owner, input)).resolves.toEqual({ operationId, revision });
  expect(fetcher.mock.calls[0]![0]).toBe(`${base}/workspace/task-calendar-sync`); expect(fetcher.mock.calls[1]![1].body).toBe(JSON.stringify(input));
  const wrong = createNativePersonalWorkspaceApi({ apiBaseUrl: base, fetchImplementation: jest.fn(async () => json({ operationId: 'other', revision })) });
  await expect(wrong.syncTaskCalendar!('fixture', owner, input)).rejects.toMatchObject({ code: 'invalid_response' });
  const privateData = createNativePersonalWorkspaceApi({ apiBaseUrl: base, fetchImplementation: jest.fn(async () => json({ revision, projection: { ...projection, messages: ['private'] } })) });
  await expect(privateData.readTaskCalendarSync!('fixture', owner)).rejects.toMatchObject({ code: 'invalid_response' });
  const audit = { ...empty(), activity: [{ id: 'audit_sync', ownerId: owner, actor: 'You', action: 'task-calendar.sync', createdAt: '2026-10-17T00:00:00.000Z' }] };
  const afterSync = createNativePersonalWorkspaceApi({ apiBaseUrl: base, fetchImplementation: jest.fn(async () => json(audit)) });
  await expect(afterSync.readPersonalWorkspace('fixture', owner)).resolves.toEqual(audit);
});
test('uses bearer and existing endpoints, validates reads and discards command result', async () => {
  const fetcher = jest.fn().mockResolvedValueOnce(json(empty())).mockResolvedValueOnce(json({ id: 'created' })).mockResolvedValueOnce(json([grant()])).mockResolvedValueOnce(new Response(null, { status: 204 }));
  const api = createNativePersonalWorkspaceApi({ apiBaseUrl: base + '/', fetchImplementation: fetcher });
  await expect(api.readPersonalWorkspace('private-token', owner)).resolves.toEqual(empty());
  await expect(api.commandPersonalWorkspace('private-token', { type: 'task.create', title: 'Plan' })).resolves.toBeUndefined();
  await expect(api.listPersonalAgents('private-token', owner)).resolves.toEqual([grant()]); await api.revokePersonalAgent('private-token', grant().id);
  expect(fetcher.mock.calls.map(call => call[0])).toEqual(['snapshot', 'commands', 'agent-grants', `agent-grants/${grant().id}`].map(path => `${base}/workspace/${path}`));
  for (const [, init] of fetcher.mock.calls) { expect(init.headers.authorization).toBe('Bearer private-token'); expect(init.cache).toBe('no-store'); expect(init.redirect).toBe('error'); }
  expect(fetcher.mock.calls[1]![1].body).toBe(JSON.stringify({ type: 'task.create', title: 'Plan' }));
});
test('rejects foreign, malformed, unknown and inconsistent snapshot shapes', async () => {
  const bad = [null, { ...empty(), secret: 'raw' }, { ...empty(), agents: [grant()] }, { ...empty(), calendars: [{ ...empty().calendars[0], ownerId: 'other' }] }, { ...empty(), tasks: [{ id: 't', ownerId: owner, title: 'Plan', completed: false, sourceMessageId: 'foreign' }] }, { ...empty(), events: [{ id: 'e', calendarId: 'foreign', title: 'Bad', start: '2026-10-17T10:00:00.000Z', end: '2026-10-17T11:00:00.000Z' }] }, { ...empty(), accounts: [{ id: 'raw-provider', mode: 'provider' }] }, { ...empty(), tasks: [{ id: 't', ownerId: owner, title: 'x'.repeat(501), completed: false }] }];
  for (const value of bad) { const fetcher = jest.fn(async () => json(value)); const api = createNativePersonalWorkspaceApi({ apiBaseUrl: base, fetchImplementation: fetcher }); await expect(api.readPersonalWorkspace('fixture', owner)).rejects.toMatchObject({ status: 502, code: 'invalid_response' }); expect(fetcher).toHaveBeenCalledTimes(1); }
});
test('validates public grants without hashes, foreign owners, duplicate ids or broad scopes', async () => {
  for (const value of [[{ ...grant(), tokenHash: 'private' }], [{ ...grant(), ownerUserId: 'other' }], [grant(), grant()], [{ ...grant(), scopes: ['mail:send'] }], [{ ...grant(), expiresAt: '2099-01-01' }]]) { const api = createNativePersonalWorkspaceApi({ apiBaseUrl: base, fetchImplementation: jest.fn(async () => json(value)) }); await expect(api.listPersonalAgents('fixture', owner)).rejects.toMatchObject({ code: 'invalid_response' }); }
});
test('sanitizes server/transport content and retains status/code without retries', async () => {
  for (const status of [401, 403, 409, 410, 429, 503]) { const fetcher = jest.fn(async () => new Response(JSON.stringify({ error: { code: 'forbidden', message: 'private-provider-content' } }), { status })); const api = createNativePersonalWorkspaceApi({ apiBaseUrl: base, fetchImplementation: fetcher }); try { await api.readPersonalWorkspace('fixture', owner); throw new Error('Expected rejection'); } catch (error) { expect(error).toMatchObject({ status, code: 'forbidden' }); expect(String(error)).not.toContain('private-provider-content'); } expect(fetcher).toHaveBeenCalledTimes(1); }
  for (const response of [new Response('not JSON'), new Response('x'.repeat(2_000_001))]) { const api = createNativePersonalWorkspaceApi({ apiBaseUrl: base, fetchImplementation: jest.fn(async () => response) }); await expect(api.readPersonalWorkspace('fixture', owner)).rejects.toBeInstanceOf(OpenJobApiError); }
  const fetcher = jest.fn(async () => { throw new Error('secret transport'); }); const api = createNativePersonalWorkspaceApi({ apiBaseUrl: base, fetchImplementation: fetcher }); await expect(api.readPersonalWorkspace('fixture', owner)).rejects.toBeInstanceOf(ProviderSignInError); expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(api.revokePersonalAgent('fixture', '../bad')).rejects.toMatchObject({ code: 'invalid_input' }); expect(fetcher).toHaveBeenCalledTimes(1);
});
test('validates full private joins and rejects cross-mailbox drafts and dangling task links', async () => {
  const ids = ['mail:example-gmail-personal', 'mail:example-gmail-work', 'mail:example-outlook'];
  const accounts = ids.map((id, index) => ({ id, ownerId: owner, provider: index === 2 ? 'outlook' : 'gmail', label: 'Example', address: `alex${index}@example.invalid`, mode: 'fixture' }));
  const messages = Array.from({ length: 6 }, (_, index) => ({ id: `example-message-${index + 1}`, accountId: ids[Math.floor(index / 2)], from: 'colleague@example.invalid', to: accounts[Math.floor(index / 2)]!.address, subject: 'Invented', body: 'Invented example', receivedAt: '2026-10-17T09:00:00.000Z', read: false }));
  const slot = { start: '2026-10-17T10:00:00.000Z', end: '2026-10-17T11:00:00.000Z' };
  const draft = { id: 'draft_one', accountId: ids[0], messageId: 'example-message-1', to: 'colleague@example.invalid', subject: 'Re: Invented', body: 'Saved reply', status: 'draft' };
  const complete = { ...empty(), accounts, messages, tasks: [{ id: 'task_one', ownerId: owner, title: 'Follow up', completed: false, sourceMessageId: 'example-message-1', sourceAccountId: ids[0], scheduledSlot: slot, calendarEventId: 'event_one' }], events: [{ id: 'event_one', calendarId: 'personal', title: 'Follow up', taskId: 'task_one', ...slot }], drafts: [draft], sent: [{ id: 'sent_one', accountId: ids[0], from: accounts[0]!.address, to: draft.to, subject: draft.subject, body: draft.body, sentAt: slot.start, mode: 'fixture' }], activity: [{ id: 'activity_one', ownerId: owner, actor: 'You', action: 'mail.draft', createdAt: slot.start }] };
  const api = (data: unknown) => createNativePersonalWorkspaceApi({ apiBaseUrl: base, fetchImplementation: jest.fn(async () => json(data)) });
  await expect(api(complete).readPersonalWorkspace('fixture', owner)).resolves.toEqual(complete);
  for (const data of [{ ...complete, drafts: [{ ...draft, messageId: 'example-message-3' }] }, { ...complete, events: [{ ...complete.events[0], taskId: 'missing' }] }, { ...complete, sent: [{ ...complete.sent[0], mode: 'provider' }] }, { ...complete, activity: [{ ...complete.activity[0], actor: 'Secret identity' }] }, { ...complete, messages: [...messages, messages[0]] }]) await expect(api(data).readPersonalWorkspace('fixture', owner)).rejects.toMatchObject({ code: 'invalid_response' });
});
