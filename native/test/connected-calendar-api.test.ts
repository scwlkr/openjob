import { createNativeConnectedWorkspaceApi } from '../src/connected-workspaces-api';
import * as protocol from '../../shared/calendar-client';
const owner = `user_${'a'.repeat(32)}`, workspace = `wsp_${'b'.repeat(32)}`, account = 'calendar_fixture', calendar = `${account}:calendar:alex%40example.invalid`, event = `${calendar}:event:oj${'d'.repeat(64)}`, operation = `cop_${'e'.repeat(64)}`;
const now = '2026-10-21T10:00:00.000Z', expires = '2026-10-21T10:01:00.000Z', window = { start: now, end: '2026-10-22T10:00:00.000Z' };
const input = { action: 'calendar.create' as const, taskId: 'task', requestId: '11111111-1111-4111-8111-111111111111', accountId: account, calendarId: calendar, title: 'Reviewed Task 🗓️', span: { start: { kind: 'timed' as const, at: '2026-10-21T14:00:12.345Z', timeZone: 'America/Chicago' }, end: { kind: 'timed' as const, at: '2026-10-21T14:30:45.678Z', timeZone: 'America/Chicago' } } };
const queued = { id: operation, workspaceId: workspace, taskId: 'task', action: input.action, requestId: input.requestId, calendarId: calendar, eventId: event, state: 'queued', createdAt: now, updatedAt: now, dispatchBefore: '2026-10-21T10:15:00.000Z', receiptExpiresAt: '2026-10-28T10:00:00.000Z', mode: 'fixture', receiptExpired: false, receipt: null };
const json = (data: unknown, extra = {}) => new Response(JSON.stringify({ data, ...extra }), { status: 200 });

test('native Calendar shares Hermes-safe validation and strictly scopes reads, history and empty POSTs', async () => {
  const responses = [json([{ accountId: account, connectionId: 'fixture', label: 'Alex 🗓️', available: true }]), json({ calendars: [{ id: calendar, accountId: account, upstreamId: 'alex@example.invalid', name: 'Work', timeZone: 'America/Chicago', access: 'owner' }], nextCursor: null, observedAt: now, expiresAt: expires }), json({ calendarId: calendar, ...window, busy: [], observedAt: now, expiresAt: expires }), json([queued], { nextCursor: 'next' }), json(queued), json(queued), json([])];
  const transport = jest.fn(async () => responses.shift()!), api = createNativeConnectedWorkspaceApi({ apiBaseUrl: 'http://127.0.0.1:5215/api/v1', fetchImplementation: transport });
  expect((await api.calendarAccounts('fixture', owner, workspace))[0]?.label).toBe('Alex 🗓️');
  expect((await api.calendars('fixture', owner, workspace, account)).calendars[0]?.name).toBe('Work');
  expect((await api.calendarAvailability('fixture', owner, workspace, account, calendar, window)).busy).toEqual([]);
  expect((await api.calendarHistory('fixture', owner, workspace, 'task')).nextCursor).toBe('next');
  await api.queueCalendar('fixture', owner, workspace, input); await api.runCalendar('fixture', owner, workspace, operation); await api.reviewCalendar('fixture', owner, workspace, 'task');
  const calls = transport.mock.calls as unknown as [string, RequestInit][];
  expect(calls[2]?.[0]).toContain('calendarId=calendar_fixture%3Acalendar%3Aalex%2540example.invalid');
  expect(calls[4]?.[1].body).toBe(JSON.stringify(input));
  for (const index of [5, 6]) expect(calls[index]?.[1]).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error' });
  expect(calls[5]?.[1].body).toBeUndefined(); expect(calls[6]?.[1].body).toBeUndefined();
  expect(() => protocol.calendarAccounts([{ accountId: account, connectionId: 'fixture', label: '\ud800', available: true }])).toThrow();
  expect(() => protocol.calendarAccounts([{ accountId: account, connectionId: 'fixture', label: '\udc00', available: true }])).toThrow();
});
test('native rejects wrong operation/Task/window, hidden provider data and extra envelopes without retry', async () => {
  for (const response of [json({ ...queued, workspaceId: `wsp_${'c'.repeat(32)}` }), json({ ...queued, requestId: '22222222-2222-4222-8222-222222222222' }), json({ ...queued, secret: 'invented hidden field' })]) {
    const transport = jest.fn(async () => response), api = createNativeConnectedWorkspaceApi({ apiBaseUrl: 'http://fixture.invalid/api/v1', fetchImplementation: transport });
    await expect(api.queueCalendar('fixture', owner, workspace, input)).rejects.toMatchObject({ code: 'invalid_response' }); expect(transport).toHaveBeenCalledTimes(1);
  }
  const api = createNativeConnectedWorkspaceApi({ apiBaseUrl: 'http://fixture.invalid/api/v1', fetchImplementation: jest.fn(async () => json([{ ...queued, taskId: 'other' }], { nextCursor: null })) });
  await expect(api.calendarHistory('fixture', owner, workspace, 'task')).rejects.toMatchObject({ code: 'invalid_response' });
});
test('Calendar observation cancellation reaches fetch and a late response is rejected', async () => {
  const abort = new AbortController(); let release!: (value: Response) => void;
  const transport = jest.fn((_url, options) => { expect(options?.signal).toBe(abort.signal); return new Promise<Response>(resolve => { release = resolve; }); });
  const api = createNativeConnectedWorkspaceApi({ apiBaseUrl: 'http://fixture.invalid/api/v1', fetchImplementation: transport });
  const pending = api.calendarAccounts('fixture', owner, workspace, abort.signal); abort.abort(); release(json([]));
  await expect(pending).rejects.toThrow(); expect(transport).toHaveBeenCalledTimes(1);
});
