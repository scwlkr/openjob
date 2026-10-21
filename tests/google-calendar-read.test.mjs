import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleCalendarAdapter, GOOGLE_CALENDAR_SCOPES } from '../server/providers/google-calendar-adapter.ts';
import { remoteCalendarRef, remoteCalendarEventRef, calendarDate, calendarInstant } from '../shared/provider-calendar.ts';

const binding = { ownerId: 'owner_alex', workspaceId: 'workspace_a', connectionId: 'connection_a', accountId: 'google_a', subject: 'google_alex', revision: 'revision_1', calendarIds: ['planning@example.invalid', 'busy@example.invalid'] };
const selection = { ownerId: binding.ownerId, workspaceId: binding.workspaceId, accountId: binding.accountId };
const window = { start: '2026-11-01T00:00:00.000Z', end: '2026-11-04T00:00:00.000Z' };
const cal = (id = binding.calendarIds[0], accessRole = 'owner') => ({ id, summary: 'Planning', timeZone: 'America/Chicago', accessRole });
const event = (id, start, end, extra = {}) => ({ id, etag: '"revision_1"', status: 'confirmed', summary: 'Invented event', start, end, ...extra });
function harness(overrides = {}) {
  const calls = [], hooks = {}, credential = { accessToken: 'invented_calendar_token', subject: binding.subject, scopes: Object.values(GOOGLE_CALENDAR_SCOPES), expiresAt: Date.now() + 60_000 };
  const adapter = createGoogleCalendarAdapter({ bindings: [binding], approveExecution: () => true, resolveCredential: async () => credential, transport: async (input, init) => {
    const url = new URL(input); calls.push({ url, init }); assert.equal(url.origin, 'https://www.googleapis.com'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
    if (hooks.response) { const value = await hooks.response(url, init); if (value) return value; }
    if (url.pathname.endsWith('/calendarList')) return Response.json({ items: [cal(), cal(binding.calendarIds[1], 'freeBusyReader'), cal('foreign@example.invalid')], ...(url.searchParams.has('pageToken') ? {} : { nextPageToken: 'page_two' }) });
    if (url.pathname.endsWith('/freeBusy')) { const body = JSON.parse(init.body); return Response.json({ timeMin: body.timeMin, timeMax: body.timeMax, calendars: { [body.items[0].id]: { busy: [{ start: '2026-11-01T08:00:00Z', end: '2026-11-01T09:00:00Z' }], privateTitle: 'Must never escape' } } }); }
    if (url.pathname.includes('/calendarList/')) return Response.json(cal(decodeURIComponent(url.pathname.split('/').at(-1)), url.pathname.includes('busy%40') ? 'freeBusyReader' : 'owner'));
    assert.equal(url.searchParams.get('singleEvents'), 'true'); assert.equal(url.searchParams.get('orderBy'), 'startTime'); assert.equal(url.searchParams.get('timeZone'), 'UTC'); assert.equal(url.searchParams.has('syncToken'), false);
    return Response.json({ accessRole: 'owner', items: [
      event('all_day', { date: '2026-11-01' }, { date: '2026-11-03' }),
      event('dst_instance', { dateTime: '2026-11-01T01:30:00-05:00', timeZone: 'America/Chicago' }, { dateTime: '2026-11-01T01:30:00-06:00', timeZone: 'America/Chicago' }, { recurringEventId: 'series_1', originalStartTime: { dateTime: '2026-11-01T00:30:00-05:00', timeZone: 'America/Chicago' } }),
      { id: 'cancelled', status: 'cancelled' },
    ] });
  }, ...overrides });
  return { adapter, calls, hooks, credential, list: input => adapter.list({ ...selection, ...input }, new AbortController().signal), events: input => adapter.events({ ...selection, calendarId: remoteCalendarRef(binding.accountId, binding.calendarIds[0]), window, ...input }, new AbortController().signal), availability: input => adapter.availability({ ...selection, calendarId: remoteCalendarRef(binding.accountId, binding.calendarIds[1]), window, ...input }, new AbortController().signal) };
}
test('owned resource-filtered Calendar pages are fresh, qualified and cursor-bound before HTTP', async () => {
  const h = harness(), first = await h.list(); assert.equal(first.calendars.length, 2); assert.ok(first.nextCursor); assert.equal(first.calendars[1].access, 'busy');
  assert.ok(Date.parse(first.expiresAt) > Date.parse(first.observedAt)); assert.ok(Date.parse(first.expiresAt) <= h.credential.expiresAt);
  const second = await h.list({ cursor: first.nextCursor }); assert.equal(second.nextCursor, null);
  const before = h.calls.length; await assert.rejects(() => h.list({ cursor: first.nextCursor, accountId: 'other' })); assert.equal(h.calls.length, before);
  await assert.rejects(() => h.events({ cursor: first.nextCursor }), e => e.code === 'invalid_cursor'); assert.equal(h.calls.length, before);
  assert.notEqual(remoteCalendarEventRef(first.calendars[0].id, 'same'), remoteCalendarEventRef(first.calendars[1].id, 'same'));
});
test('observations age from request start, including slow provider and authority checks', async () => {
  let clock = Date.now(); const startedAt = clock, h = harness({ now: () => clock }); h.credential.expiresAt = clock + 300_000;
  h.hooks.response = async url => { if (url.pathname.endsWith('/freeBusy')) clock += 59_000; };
  const observation = await h.availability(); assert.equal(observation.observedAt, new Date(startedAt).toISOString()); assert.equal(Date.parse(observation.expiresAt), startedAt + 60_000);
  h.hooks.response = async url => { if (url.pathname.endsWith('/freeBusy')) clock += 61_000; };
  await assert.rejects(h.availability, e => e.code === 'observation_expired');
  let checks = 0; const slow = harness({ now: () => clock, approveExecution: () => { if (++checks === 4) clock += 61_000; return true; } }); slow.credential.expiresAt = clock + 300_000;
  await assert.rejects(slow.availability, e => e.code === 'observation_expired');
});
test('unspecified end stays unknown and collection access downgrade suppresses event details', async () => {
  const h = harness(); h.hooks.response = async url => url.pathname.endsWith('/events') ? Response.json({ accessRole: 'reader', items: [event('unknown_end', { dateTime: '2026-11-01T08:00:00Z' }, { dateTime: '2026-11-01T09:00:00Z' }, { endTimeUnspecified: true })] }) : null;
  const page = await h.events(); assert.equal(page.calendar.access, 'reader'); assert.equal(page.events[0].span.end, null); assert.equal(page.events[0].span.start.at, '2026-11-01T08:00:00.000Z');
  assert.match(h.calls.at(-1).url.searchParams.get('fields'), /accessRole/); assert.match(h.calls.at(-1).url.searchParams.get('fields'), /endTimeUnspecified/);
  for (const accessRole of ['freeBusyReader', 'none', undefined]) {
    h.hooks.response = async url => url.pathname.endsWith('/events') ? Response.json({ accessRole, items: [event('private_id', { date: '2026-11-01' }, { date: '2026-11-02' })] }) : null;
    await assert.rejects(h.events, e => e.code === 'details_forbidden');
  }
});
test('all-day exclusive dates and DST/moved recurrence instants remain distinct; cancellations have no ordinary fields', async () => {
  const h = harness(), result = await h.events(); assert.equal(result.events.length, 2);
  assert.deepEqual(result.events[0].span.start, { kind: 'all-day', date: '2026-11-01', timeZone: 'America/Chicago' }); assert.equal(result.events[0].span.end.date, '2026-11-03');
  const recurring = result.events[1]; assert.equal(recurring.span.start.at, '2026-11-01T06:30:00.000Z'); assert.equal(recurring.span.end.at, '2026-11-01T07:30:00.000Z'); assert.equal(recurring.occurrence.seriesId, 'series_1'); assert.equal(recurring.occurrence.originalStart.at, '2026-11-01T05:30:00.000Z');
  assert.throws(() => calendarDate('2026-02-30')); assert.throws(() => calendarInstant('2026-02-30T12:00:00Z'));
});
test('busy-only Calendar never fetches event details; FreeBusy discloses only intervals and rejects missing/errors', async () => {
  const h = harness(); await assert.rejects(() => h.events({ calendarId: remoteCalendarRef(binding.accountId, binding.calendarIds[1]) }), e => e.code === 'details_forbidden'); assert.equal(h.calls.filter(row => row.url.pathname.endsWith('/events')).length, 0);
  const availability = await h.availability(); assert.equal(availability.busy.length, 1); assert.doesNotMatch(JSON.stringify(availability), /privateTitle|Must never|summary|attendees|eventId/);
  const request = JSON.parse(h.calls.at(-1).init.body); assert.deepEqual(request.items, [{ id: binding.calendarIds[1] }]); assert.equal(request.groupExpansionMax, 0);
  for (const calendars of [{}, { [binding.calendarIds[1]]: { errors: [{ reason: 'internalError' }], busy: [] } }]) {
    h.hooks.response = async url => url.pathname.endsWith('/freeBusy') ? Response.json({ timeMin: window.start, timeMax: window.end, calendars }) : null;
    await assert.rejects(h.availability);
  }
});
test('execution defaults closed; wrong account, readonly Mail scope, expired/revoked authority and abort yield no Calendar data', async () => {
  const closed = harness({ approveExecution: undefined }); await assert.rejects(closed.list, e => e.code === 'execution_disabled'); assert.equal(closed.calls.length, 0);
  const denied = harness(); await assert.rejects(() => denied.events({ workspaceId: 'other' })); assert.equal(denied.calls.length, 0);
  denied.credential.scopes = ['https://www.googleapis.com/auth/gmail.readonly']; await assert.rejects(denied.list, e => e.code === 'consent_required'); assert.equal(denied.calls.length, 0);
  denied.credential.scopes = [GOOGLE_CALENDAR_SCOPES.write]; await assert.rejects(denied.availability, e => e.code === 'consent_required'); assert.equal(denied.calls.length, 0);
  denied.credential.scopes = Object.values(GOOGLE_CALENDAR_SCOPES); denied.credential.expiresAt = 0; await assert.rejects(denied.events, e => e.code === 'reconnect_required'); assert.equal(denied.calls.length, 0);
  let allowed = true; const revoked = harness({ approveExecution: () => allowed }); revoked.hooks.response = async () => { allowed = false; return Response.json({ items: [] }); }; await assert.rejects(revoked.list, e => e.code === 'execution_disabled'); assert.equal(revoked.calls.length, 1);
  const aborted = harness(), controller = new AbortController(); controller.abort(); await assert.rejects(() => aborted.adapter.list(selection, controller.signal)); assert.equal(aborted.calls.length, 0);
});
