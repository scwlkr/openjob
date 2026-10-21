import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleCalendarAdapter, GOOGLE_CALENDAR_SCOPES } from '../server/providers/google-calendar-adapter.ts';
import { managedCalendarEventId, managedCalendarProperties } from '../shared/calendar-mutation.ts';
import { remoteCalendarRef } from '../shared/provider-calendar.ts';

const binding = { ownerId: 'user_' + 'a'.repeat(32), workspaceId: 'wsp_' + 'b'.repeat(32), connectionId: 'connection_a', accountId: 'google_a', subject: 'google_alex', revision: 'revision_1', calendarIds: ['planning@example.invalid'] };
const span = { start: { kind: 'timed', at: '2026-11-01T06:30:00.000Z', timeZone: 'America/Chicago' }, end: { kind: 'timed', at: '2026-11-01T07:30:00.000Z', timeZone: 'America/Chicago' } };
async function frozen() {
  const origin = { operationId: 'cop_' + 'c'.repeat(64), marker: 'd'.repeat(64) }, taskId = 'offline_' + crypto.randomUUID();
  return { version: 1, ownerId: binding.ownerId, workspaceId: binding.workspaceId, taskId, accountId: binding.accountId, connectionId: binding.connectionId, subject: binding.subject, bindingRevision: binding.revision, calendarId: remoteCalendarRef(binding.accountId, binding.calendarIds[0]), upstreamEventId: await managedCalendarEventId(binding.ownerId, binding.workspaceId, taskId, origin), origin, action: 'calendar.create', title: 'Invented planning block', span };
}
function harness(options = {}) {
  const calls = [], hooks = {}, credential = { accessToken: 'invented_calendar_write', subject: binding.subject, scopes: Object.values(GOOGLE_CALENDAR_SCOPES), expiresAt: Date.now() + 300_000 };
  let stored = null, revision = 0, allowed = true;
  const adapter = createGoogleCalendarAdapter({ bindings: [binding], approveExecution: () => allowed, resolveCredential: async () => credential, transport: async (input, init) => {
    const url = new URL(input), method = init.method; calls.push({ url, ...init });
    assert.equal(url.origin, 'https://www.googleapis.com'); assert.equal(init.redirect, 'error');
    if (hooks.before) { const response = await hooks.before(url, init); if (response) return response; }
    if (url.pathname.includes('/calendarList/')) return Response.json({ id: binding.calendarIds[0], summary: 'Planning', timeZone: 'America/Chicago', accessRole: 'owner' });
    if (method === 'GET') return stored ? Response.json(stored) : Response.json({}, { status: 404 });
    assert.equal(url.searchParams.get('sendUpdates'), 'none');
    if (method !== 'POST' && init.headers['if-match'] !== stored?.etag) return Response.json({}, { status: 412 });
    if (method === 'DELETE') stored = null;
    else { const body = JSON.parse(init.body); if (method === 'POST' && stored) return Response.json({}, { status: 409 }); stored = { ...stored, ...body, status: 'confirmed', etag: '"version_' + ++revision + '"' }; }
    if (hooks.after) { const response = await hooks.after(url, init); if (response) return response; }
    return method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json(stored);
  }, ...options });
  return { adapter, calls, hooks, credential, get stored() { return stored; }, edit: fields => { stored = { ...stored, ...fields }; }, revoke: () => { allowed = false; }, execute: payload => adapter.execute(payload, new AbortController().signal), writes: () => calls.filter(call => call.method !== 'GET') };
}
test('managed create → ETag update → explicit delete uses one stable event and no attendee/meeting/reminder input', async () => {
  const h = harness(), create = await frozen(), first = await h.execute(create); assert.equal(first.kind, 'confirmed'); assert.equal(first.event.upstreamId, create.upstreamEventId);
  const request = JSON.parse(h.writes()[0].body); assert.deepEqual(request.extendedProperties.private, managedCalendarProperties(create)); assert.deepEqual(request.reminders, { useDefault: false });
  assert.equal(request.attendees, undefined); assert.equal(request.conferenceData, undefined); assert.equal(request.description, undefined); assert.equal(request.location, undefined);
  const update = { ...create, action: 'calendar.update', etag: first.event.etag, title: 'Reviewed new title', span: { ...span, end: { ...span.end, at: '2026-11-01T08:00:00.000Z' } } };
  const second = await h.execute(update); assert.equal(second.kind, 'confirmed'); assert.equal(second.event.title, update.title); assert.equal(h.writes()[1].method, 'PATCH'); assert.equal(h.writes()[1].headers['if-match'], first.event.etag);
  assert.deepEqual(Object.keys(JSON.parse(h.writes()[1].body)).sort(), ['end', 'start', 'summary']);
  const { title: _, span: __, ...identity } = create; void _; void __;
  const deleted = await h.execute({ ...identity, action: 'calendar.delete', etag: second.event.etag }); assert.deepEqual(deleted, { kind: 'confirmed', deleted: true }); assert.equal(h.stored, null); assert.equal(h.writes().length, 3);
});
test('provider edits conflict without rebasing, including a race after the full preflight GET', async () => {
  const h = harness(), create = await frozen(), first = await h.execute(create), update = { ...create, action: 'calendar.update', etag: first.event.etag, title: 'New' };
  h.edit({ etag: '"external_edit"' }); assert.deepEqual(await h.execute(update), { kind: 'rejected', reason: 'conflict' }); assert.equal(h.writes().length, 1);
  h.edit({ etag: first.event.etag }); h.hooks.before = async (_, init) => init.method === 'PATCH' ? Response.json({}, { status: 412 }) : null;
  assert.deepEqual(await h.execute(update), { kind: 'rejected', reason: 'conflict' }); assert.equal(h.writes().length, 2); assert.equal(h.stored.summary, create.title);
});
test('foreign ownership, binding, send-only consent, disabled execution and derived-ID mismatch cause no provider write', async () => {
  const h = harness(), create = await frozen();
  for (const patch of [{ ownerId: 'user_' + 'e'.repeat(32) }, { connectionId: 'other' }, { bindingRevision: 'revision_2' }, { subject: 'other' }, { upstreamEventId: 'oj' + 'e'.repeat(64) }, { calendarId: remoteCalendarRef(binding.accountId, 'other@example.invalid') }]) assert.equal((await h.execute({ ...create, ...patch })).kind, 'rejected');
  assert.equal(h.writes().length, 0); h.credential.scopes = ['https://www.googleapis.com/auth/gmail.send']; assert.equal((await h.execute(create)).kind, 'rejected'); assert.equal(h.writes().length, 0);
  const disabled = harness({ approveExecution: undefined }); assert.equal((await disabled.execute(create)).kind, 'rejected'); assert.equal(disabled.calls.length, 0);
});
test('recurrences, attendees, omitted attendees, rich features, unknown ends and unmanaged events cannot be edited or deleted', async () => {
  const h = harness(), create = await frozen(), first = await h.execute(create), original = structuredClone(h.stored);
  const { title: _, span: __, ...identity } = create; void _; void __;
  for (const patch of [{ start: { date: '2026-11-01' }, end: { date: '2026-11-02' } }, { recurrence: ['RRULE:FREQ=DAILY'] }, { recurringEventId: 'series', originalStartTime: original.start }, { attendees: [{ email: 'invented@example.invalid' }] }, { attendeesOmitted: true }, { conferenceData: {} }, { attachments: [] }, { description: 'External notes' }, { endTimeUnspecified: true }, { extendedProperties: { private: {} } }, { reminders: { useDefault: true } }, { eventType: 'outOfOffice' }]) {
    h.edit({ ...original, ...patch });
    assert.equal((await h.execute({ ...create, action: 'calendar.update', etag: first.event.etag })).kind, 'rejected');
    assert.equal((await h.execute({ ...identity, action: 'calendar.delete', etag: first.event.etag })).kind, 'rejected');
    // Reset the fake resource including any newly inserted optional fields.
    for (const key of Object.keys(patch)) if (!(key in original)) h.edit({ [key]: undefined });
  }
  assert.equal(h.writes().length, 1);
});
test('accepted but lost/malformed response is unknown; duplicate insert conflicts and is never relabeled confirmed', async () => {
  for (const after of [async () => { throw new Error('Lost after acceptance'); }, async () => new Response('bad', { headers: { 'content-type': 'application/json' } })]) {
    const h = harness(), create = await frozen(); h.hooks.after = after; assert.deepEqual(await h.execute(create), { kind: 'unknown' }); assert.ok(h.stored); assert.equal(h.writes().length, 1);
    delete h.hooks.after; assert.deepEqual(await h.execute(create), { kind: 'rejected', reason: 'conflict' }); assert.equal(h.writes().length, 2);
  }
});
