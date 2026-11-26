import assert from 'node:assert/strict';
import { createGoogleCalendarAdapter, GOOGLE_CALENDAR_SCOPES } from '../../server/providers/google-calendar-adapter.ts';
import { operationHash } from '../../shared/reply-operation.ts';

const TOKEN = 'invented_calendar_access';
export function fixtureCalendarState(value = { events: [], attempts: [] }) {
  assert.deepEqual(Object.keys(value).sort(), ['attempts', 'events']);
  assert.ok(Array.isArray(value.events) && value.events.length <= 100 && Array.isArray(value.attempts) && value.attempts.length <= 100);
  assert.equal(new Set(value.events.map(event => event.id)).size, value.events.length);
  for (const event of value.events) { assert.match(event.id, /^oj[a-f0-9]{64}$/); if (event.status === 'cancelled') { assert.deepEqual(Object.keys(event).sort(), ['id', 'status']); continue; } assert.equal(event.eventType, 'default'); assert.equal(event.status, 'confirmed'); assert.equal(event.transparency, 'opaque'); assert.equal(event.attendees, undefined); assert.ok(event.start.dateTime && event.end.dateTime); assert.equal(event.reminders.useDefault, false); assert.match(event.extendedProperties.private.openjobPlanning, /^cop_[a-f0-9]{64}$/); assert.match(event.extendedProperties.private.openjobMarker, /^[a-f0-9]{64}$/); }
  for (const row of value.attempts) { assert.deepEqual(Object.keys(row).sort(), ['eventId', 'method', 'payloadHash']); assert.match(row.eventId, /^oj[a-f0-9]{64}$/); assert.ok(['POST', 'PATCH', 'DELETE'].includes(row.method)); assert.match(row.payloadHash, /^[a-f0-9]{64}$/); }
  return structuredClone(value);
}
/** The fixed invented credential and fake HTTP transport are inseparable. Never fetch. */
export function createFixtureGoogleCalendar({ binding, state, persist = async () => {}, active = async () => true, now = Date.now, beforeRead = async () => {}, afterAccept = async () => {} }) {
  assert.equal(binding.calendarIds.length, 1); assert.ok(binding.calendarIds[0].endsWith('@example.invalid'));
  const ledger = fixtureCalendarState(state), calls = []; let tail = Promise.resolve();
  const calendar = { id: binding.calendarIds[0], summary: 'Invented Google Planning', timeZone: 'America/Chicago', accessRole: 'owner' };
  const credential = { accessToken: TOKEN, subject: binding.subject, scopes: Object.values(GOOGLE_CALENDAR_SCOPES), expiresAt: now() + 86_400_000 };
  const transport = async (input, init) => {
    const url = new URL(input), headers = new Headers(init.headers), method = init.method; calls.push({ method, path: url.pathname });
    assert.equal(url.origin, 'https://www.googleapis.com'); assert.equal(headers.get('authorization'), 'Bearer ' + TOKEN); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
    if (method === 'GET') await beforeRead(url);
    if (url.pathname === '/calendar/v3/users/me/calendarList') return Response.json({ items: [calendar] });
    if (url.pathname === '/calendar/v3/users/me/calendarList/' + encodeURIComponent(calendar.id)) return Response.json(calendar);
    if (url.pathname === '/calendar/v3/freeBusy') {
      const body = JSON.parse(init.body); assert.deepEqual(body.items, [{ id: calendar.id }]);
      const busy = ledger.events.filter(row => row.status !== 'cancelled' && Date.parse(row.start.dateTime) < Date.parse(body.timeMax) && Date.parse(row.end.dateTime) > Date.parse(body.timeMin)).map(row => ({ start: row.start.dateTime, end: row.end.dateTime }));
      return Response.json({ timeMin: body.timeMin, timeMax: body.timeMax, calendars: { [calendar.id]: { busy } } });
    }
    const collection = '/calendar/v3/calendars/' + encodeURIComponent(calendar.id) + '/events';
    assert.ok(url.pathname === collection || url.pathname.startsWith(collection + '/'));
    const eventId = url.pathname === collection ? null : decodeURIComponent(url.pathname.slice(collection.length + 1));
    if (method === 'GET') {
      if (eventId) { const event = ledger.events.find(row => row.id === eventId); return Response.json(event ?? {}, { status: event ? 200 : 404 }); }
      return Response.json({ accessRole: 'owner', items: ledger.events.filter(row => row.status !== 'cancelled' && Date.parse(row.start.dateTime) < Date.parse(url.searchParams.get('timeMax')) && Date.parse(row.end.dateTime) > Date.parse(url.searchParams.get('timeMin'))).slice(0, 50) });
    }
    assert.equal(url.searchParams.get('sendUpdates'), 'none'); assert.ok(ledger.attempts.length < 100);
    const result = tail.then(async () => {
      const body = init.body ? JSON.parse(init.body) : null, id = eventId ?? body.id, current = ledger.events.find(row => row.id === id);
      assert.match(id, /^oj[a-f0-9]{64}$/);
      if (method === 'POST' && current) return Response.json({}, { status: 409 });
      if (method !== 'POST' && !current) return Response.json({}, { status: 404 });
      if (method !== 'POST' && headers.get('if-match') !== current.etag) return Response.json({}, { status: 412 });
      const row = { method, eventId: id, payloadHash: await operationHash({ method, eventId: id, body, etag: headers.get('if-match') }) };
      ledger.attempts.push(row);
      const replacement = method === 'DELETE' ? { id, status: 'cancelled' } : { ...current, ...body, status: 'confirmed', etag: '"fixture_' + ledger.attempts.length + '"' };
      ledger.events = [...ledger.events.filter(event => event.id !== id), replacement];
      await persist(fixtureCalendarState(ledger)); await afterAccept(structuredClone(row));
      return method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json(replacement);
    }); tail = result.catch(() => {}); return result;
  };
  const adapter = createGoogleCalendarAdapter({ bindings: [binding], transport, approveExecution: async () => active(), resolveCredential: async () => credential, now });
  return {
    adapter, calls, state: () => fixtureCalendarState(ledger),
    async accounts(owner, workspace) { if (owner !== binding.ownerId || workspace !== binding.workspaceId) return []; return [{ accountId: binding.accountId, connectionId: binding.connectionId, label: 'Invented Google account', available: await active() }]; },
    async binding(owner, workspace, account) { assert.equal(owner, binding.ownerId); assert.equal(workspace, binding.workspaceId); assert.equal(account, binding.accountId); assert.equal(await active(), true); return structuredClone(binding); },
    async currentAuthority(payload) {
      assert.equal(await active(), true);
      for (const [key, value] of Object.entries({ ownerId: binding.ownerId, workspaceId: binding.workspaceId, accountId: binding.accountId, connectionId: binding.connectionId, subject: binding.subject, bindingRevision: binding.revision })) assert.equal(payload[key], value);
      assert.equal(payload.calendarId, binding.accountId + ':calendar:' + encodeURIComponent(calendar.id));
    },
  };
}
