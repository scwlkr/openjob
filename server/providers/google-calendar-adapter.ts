import { calendarFail, calendarRecord, calendarText, calendarInstant, validateCalendarWindow, remoteCalendarId, calendarObserved, type CalendarWindow, type CalendarAvailability, type RemoteCalendarPage, type RemoteEventPage } from '../../shared/provider-calendar.ts';
import { googleCalendarHttp } from './google-calendar-http.ts';
import { mapGoogleCalendar, mapGoogleCalendarEvent, managedGoogleCalendarEvent } from './google-calendar-wire.ts';
import { validateFrozenCalendarMutation, managedCalendarEventId, managedCalendarProperties, type FrozenCalendarMutation } from '../../shared/calendar-mutation.ts';
import type { CalendarPoint, RemoteCalendarEvent } from '../../shared/provider-calendar.ts';

const ROOT = 'https://www.googleapis.com/auth/';
export const GOOGLE_CALENDAR_SCOPES = { list: ROOT + 'calendar.calendarlist.readonly', read: ROOT + 'calendar.events.readonly', availability: ROOT + 'calendar.events.freebusy', write: ROOT + 'calendar.events' } as const;
export type CalendarBinding = { ownerId: string; workspaceId: string; connectionId: string; accountId: string; subject: string; revision: string; calendarIds: string[] };
export type CalendarCredential = { accessToken: string; subject: string; scopes: string[]; expiresAt: number };
export type CalendarOperation = 'list' | 'read' | 'availability' | 'write';
export type CalendarSelection = { ownerId: string; workspaceId: string; accountId: string };
export type CalendarAdapterOptions = {
  bindings: CalendarBinding[]; resolveCredential(binding: CalendarBinding): Promise<CalendarCredential | null>;
  approveExecution?(binding: CalendarBinding, operation: CalendarOperation, upstreamCalendarId: string | null): boolean | Promise<boolean>;
  transport: typeof fetch; now?: () => number;
};
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const token = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._~+\/-]{1,8192}={0,2}$/.test(value);
const nextToken = (value: unknown) => value === undefined ? undefined : calendarText(value, 2048) || calendarFail('malformed_response');
function items(value: unknown): unknown[] { if (value === undefined) return []; if (!Array.isArray(value) || value.length > 50) calendarFail('malformed_response'); return value; }
type Cursor = { version: 1; owner: string; workspace: string; account: string; revision: string; operation: 'list' | 'read'; calendar: string | null; window: CalendarWindow | null; zone: string | null; token: string };
export type CalendarMutationResult = { kind: 'confirmed'; event: RemoteCalendarEvent } | { kind: 'confirmed'; deleted: true } | { kind: 'rejected'; reason: 'conflict' | 'authority' | 'unsupported' | 'provider' } | { kind: 'unknown' };
const wirePoint = (point: CalendarPoint) => point.kind === 'timed' ? { dateTime: point.at, timeZone: point.timeZone } : { date: point.date };
function encode(value: Cursor) { const encoded = 'gc1.' + btoa(Array.from(new TextEncoder().encode(JSON.stringify(value)), byte => String.fromCharCode(byte)).join('')).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''); if (encoded.length > 8192) calendarFail('malformed_response'); return encoded; }
function page(value: string | undefined, context: Omit<Cursor, 'version' | 'token'>) {
  if (value === undefined) return undefined;
  try {
    if (typeof value !== 'string' || value.length > 8192 || !/^gc1\.[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(value.slice(4).replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0)))) as Cursor;
    if (!calendarRecord(decoded) || decoded.version !== 1 || encode(decoded) !== value || JSON.stringify(Object.fromEntries(Object.entries(decoded).filter(([key]) => !['version', 'token'].includes(key)))) !== JSON.stringify(context) || !nextToken(decoded.token)) throw new Error();
    return decoded.token;
  } catch { return calendarFail('invalid_cursor'); }
}
/** No default transport/credential/approval. All read results recheck current authority. */
export function createGoogleCalendarAdapter(options: CalendarAdapterOptions) {
  const { transport, resolveCredential, approveExecution = () => false, now = Date.now } = options;
  if (!Array.isArray(options.bindings) || options.bindings.length > 100 || typeof transport !== 'function' || typeof resolveCredential !== 'function' || typeof approveExecution !== 'function') calendarFail();
  const bindings = structuredClone(options.bindings), seen = new Set<string>();
  for (const b of bindings) {
    const key = `${b.ownerId}:${b.workspaceId}:${b.accountId}`;
    if (![b.ownerId, b.workspaceId, b.accountId, b.connectionId].every(id) || !calendarText(b.subject, 256) || !calendarText(b.revision, 128) || !Array.isArray(b.calendarIds) || b.calendarIds.length > 100 || b.calendarIds.some(value => !calendarText(value, 1024) || value === 'primary') || new Set(b.calendarIds).size !== b.calendarIds.length || seen.has(key)) calendarFail();
    seen.add(key);
  }
  function select(input: CalendarSelection) {
    if (!calendarRecord(input) || ![input.ownerId, input.workspaceId, input.accountId].every(id)) calendarFail();
    const binding = bindings.find(b => b.ownerId === input.ownerId && b.workspaceId === input.workspaceId && b.accountId === input.accountId);
    if (!binding) calendarFail('forbidden'); return binding;
  }
  async function client(binding: CalendarBinding, operation: CalendarOperation, calendar: string | null, signal: AbortSignal, startedAt: number) {
    if (calendar !== null && !binding.calendarIds.includes(calendar)) calendarFail('forbidden');
    const active = () => { if (signal.aborted) calendarFail('calendar_unavailable'); };
    const approved = async () => { active(); let allowed = false; try { allowed = await approveExecution(structuredClone(binding), operation, calendar); } catch { calendarFail('execution_disabled'); } active(); if (allowed !== true) calendarFail('execution_disabled'); };
    await approved();
    let credential: CalendarCredential | null; try { credential = structuredClone(await resolveCredential(structuredClone(binding))); } catch { return calendarFail('reconnect_required'); }
    const consent = () => {
      active(); if (!credential || credential.subject !== binding.subject || !token(credential.accessToken) || !Number.isFinite(credential.expiresAt) || credential.expiresAt <= now()) calendarFail('reconnect_required');
      const accepted = [GOOGLE_CALENDAR_SCOPES[operation], ROOT + 'calendar', ...(operation !== 'write' ? [ROOT + 'calendar.readonly'] : []), ...(operation === 'availability' ? [ROOT + 'calendar.freebusy'] : []), ...(operation === 'read' ? [GOOGLE_CALENDAR_SCOPES.write] : []), ...(operation === 'list' ? [ROOT + 'calendar.calendarlist'] : [])];
      if (!Array.isArray(credential.scopes) || credential.scopes.length > 100 || !credential.scopes.some(scope => accepted.includes(scope))) calendarFail('consent_required');
      if (['read', 'write'].includes(operation) && !credential.scopes.some(scope => [GOOGLE_CALENDAR_SCOPES.list, ROOT + 'calendar.calendarlist', ROOT + 'calendar.readonly', ROOT + 'calendar'].includes(scope))) calendarFail('consent_required');
    };
    consent();
    return {
      async call(path: string, query = new URLSearchParams(), body?: object) {
        await approved(); consent();
        const value = await googleCalendarHttp({ path, query, ...(body === undefined ? {} : { method: 'POST', body }), token: credential!.accessToken, transport, signal });
        await approved(); consent(); if (!value) calendarFail('malformed_response'); return value;
      },
      async check() { await approved(); consent(); },
      async mutate(path: string, method: 'POST' | 'PATCH' | 'DELETE', body: object | undefined, etag: string | undefined, beforeMutation: (() => Promise<void>) | undefined, onDispatch: () => void) {
        await approved(); consent();
        await beforeMutation?.(); consent(); onDispatch();
        // Caller persists executing first. Never repeat this call after uncertainty.
        return googleCalendarHttp({ path, method, ...(body ? { body } : {}), ...(etag ? { etag } : {}), query: new URLSearchParams({ sendUpdates: 'none' }), token: credential!.accessToken, transport, signal, write: true });
      },
      observed: () => { const observation = calendarObserved(startedAt, credential!.expiresAt); if (Date.parse(observation.expiresAt) <= now()) calendarFail('observation_expired'); return observation; },
    };
  }
  function context(binding: CalendarBinding, operation: 'list' | 'read', calendar: string | null = null, window: CalendarWindow | null = null, zone: string | null = null): Omit<Cursor, 'version' | 'token'> {
    return { owner: binding.ownerId, workspace: binding.workspaceId, account: binding.accountId, revision: binding.revision, operation, calendar, window, zone };
  }
  async function calendar(c: Awaited<ReturnType<typeof client>>, binding: CalendarBinding, upstreamId: string) {
    const value = mapGoogleCalendar(await c.call('users/me/calendarList/' + encodeURIComponent(upstreamId)), binding.accountId);
    if (value.upstreamId !== upstreamId) calendarFail('calendar_unavailable'); return value;
  }
  async function mutationSelection(raw: FrozenCalendarMutation) {
    const frozen = validateFrozenCalendarMutation(raw), binding = select(frozen), target = remoteCalendarId(frozen.calendarId, binding.accountId);
    if (frozen.connectionId !== binding.connectionId || frozen.subject !== binding.subject || frozen.bindingRevision !== binding.revision || frozen.upstreamEventId !== await managedCalendarEventId(frozen.ownerId, frozen.workspaceId, frozen.taskId, frozen.origin)) calendarFail('forbidden');
    return { frozen, binding, target };
  }
  return {
    async list(input: CalendarSelection & { cursor?: string }, signal: AbortSignal): Promise<RemoteCalendarPage> {
      const startedAt = now(), binding = select(input), scope = context(binding, 'list'), previous = page(input.cursor, scope), c = await client(binding, 'list', null, signal, startedAt);
      const query = new URLSearchParams({ maxResults: '50', showDeleted: 'false', showHidden: 'false', fields: 'items(id,summary,summaryOverride,timeZone,accessRole,deleted),nextPageToken' }); if (previous) query.set('pageToken', previous);
      const result = await c.call('users/me/calendarList', query), rows = items(result.items);
      if (rows.some(row => !calendarRecord(row) || typeof row.id !== 'string')) calendarFail('malformed_response');
      const calendars = rows.filter(row => calendarRecord(row) && binding.calendarIds.includes(String(row.id))).map(row => mapGoogleCalendar(row, binding.accountId));
      if (new Set(calendars.map(row => row.id)).size !== calendars.length) calendarFail('malformed_response');
      const next = nextToken(result.nextPageToken); if (next === previous && next !== undefined) calendarFail('malformed_response'); await c.check();
      return { calendars, nextCursor: next === undefined ? null : encode({ version: 1, ...scope, token: next }), ...c.observed() };
    },
    async events(input: CalendarSelection & { calendarId: string; window: CalendarWindow; cursor?: string }, signal: AbortSignal): Promise<RemoteEventPage> {
      const startedAt = now(), binding = select(input), target = remoteCalendarId(input.calendarId, binding.accountId), window = validateCalendarWindow(input.window), scope = context(binding, 'read', target, window, 'UTC'), previous = page(input.cursor, scope);
      const c = await client(binding, 'read', target, signal, startedAt), selected = await calendar(c, binding, target);
      if (selected.access === 'busy') calendarFail('details_forbidden');
      const query = new URLSearchParams({ timeMin: window.start, timeMax: window.end, singleEvents: 'true', orderBy: 'startTime', showDeleted: 'false', timeZone: 'UTC', maxResults: '50', fields: 'accessRole,items(id,etag,status,summary,start,end,endTimeUnspecified,transparency,recurringEventId,originalStartTime,recurrence,attendees(responseStatus),attendeesOmitted),nextPageToken' }); if (previous) query.set('pageToken', previous);
      const result = await c.call('calendars/' + encodeURIComponent(target) + '/events', query);
      // The collection role is newer than CalendarList.get and must admit details too.
      if (!['reader', 'writer', 'writerWithoutPrivateAccess', 'owner'].includes(String(result.accessRole))) calendarFail('details_forbidden');
      selected.access = mapGoogleCalendar({ id: target, summary: selected.name, timeZone: selected.timeZone, accessRole: result.accessRole }, binding.accountId).access;
      const events = items(result.items).filter(row => !(calendarRecord(row) && row.status === 'cancelled')).map(row => mapGoogleCalendarEvent(row, selected));
      if (new Set(events.map(row => row.id)).size !== events.length) calendarFail('malformed_response');
      const next = nextToken(result.nextPageToken); if (next === previous && next !== undefined) calendarFail('malformed_response'); await c.check();
      return { calendar: selected, events, nextCursor: next === undefined ? null : encode({ version: 1, ...scope, token: next }), ...c.observed() };
    },
    async availability(input: CalendarSelection & { calendarId: string; window: CalendarWindow }, signal: AbortSignal): Promise<CalendarAvailability> {
      const startedAt = now(), binding = select(input), target = remoteCalendarId(input.calendarId, binding.accountId), window = validateCalendarWindow(input.window), c = await client(binding, 'availability', target, signal, startedAt);
      const result = await c.call('freeBusy', new URLSearchParams(), { timeMin: window.start, timeMax: window.end, items: [{ id: target }], calendarExpansionMax: 1, groupExpansionMax: 0 });
      if (calendarInstant(result.timeMin) !== window.start || calendarInstant(result.timeMax) !== window.end) calendarFail('calendar_unavailable');
      if (!calendarRecord(result.calendars) || Object.keys(result.calendars).length !== 1 || !calendarRecord(result.calendars[target])) calendarFail('calendar_unavailable');
      const row = result.calendars[target]; if (row.errors !== undefined && (!Array.isArray(row.errors) || row.errors.length) || !Array.isArray(row.busy) || row.busy.length > 1000) calendarFail('calendar_unavailable');
      const busy = row.busy.flatMap(value => { if (!calendarRecord(value)) calendarFail('malformed_response'); const from = calendarInstant(value.start), to = calendarInstant(value.end); if (Date.parse(from) >= Date.parse(to)) calendarFail('malformed_response'); const start = new Date(Math.max(Date.parse(from), Date.parse(window.start))).toISOString(), end = new Date(Math.min(Date.parse(to), Date.parse(window.end))).toISOString(); return Date.parse(start) < Date.parse(end) ? [{ start, end }] : []; });
      await c.check(); return { calendarId: input.calendarId, ...window, busy, ...c.observed() };
    },
    async execute(raw: FrozenCalendarMutation, signal: AbortSignal, beforeMutation?: () => Promise<void>): Promise<CalendarMutationResult> {
      let attempted = false;
      try {
        const { frozen, binding, target } = await mutationSelection(raw);
        const c = await client(binding, 'write', target, signal, now()), selected = await calendar(c, binding, target);
        if (!['owner', 'writer'].includes(selected.access)) calendarFail('forbidden');
        const collection = 'calendars/' + encodeURIComponent(target) + '/events', eventPath = collection + '/' + encodeURIComponent(frozen.upstreamEventId);
        if (frozen.action !== 'calendar.create') {
          const current = managedGoogleCalendarEvent(await c.call(eventPath), selected, frozen);
          if (current.etag !== frozen.etag) calendarFail('provider_conflict');
        }
        let body: object | undefined;
        if (frozen.action !== 'calendar.delete') body = { summary: frozen.title, start: wirePoint(frozen.span.start), end: wirePoint(frozen.span.end), ...(frozen.action === 'calendar.create' ? { id: frozen.upstreamEventId, eventType: 'default', transparency: 'opaque', reminders: { useDefault: false }, extendedProperties: { private: managedCalendarProperties(frozen) } } : {}) };
        await c.check();
        const response = await c.mutate(frozen.action === 'calendar.create' ? collection : eventPath, frozen.action === 'calendar.create' ? 'POST' : frozen.action === 'calendar.update' ? 'PATCH' : 'DELETE', body, frozen.action === 'calendar.create' ? undefined : frozen.etag, beforeMutation, () => { attempted = true; });
        if (frozen.action === 'calendar.delete') { if (response !== null) calendarFail('dispatch_unknown'); return { kind: 'confirmed', deleted: true }; }
        const event = managedGoogleCalendarEvent(response, selected, frozen);
        if (event.title !== frozen.title || JSON.stringify(event.span) !== JSON.stringify(frozen.span)) calendarFail('dispatch_unknown');
        return { kind: 'confirmed', event };
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
        if (code === 'provider_conflict') return { kind: 'rejected', reason: 'conflict' };
        if (code === 'provider_forbidden' || code === 'provider_rejected') return { kind: 'rejected', reason: 'provider' };
        if (!attempted) return { kind: 'rejected', reason: code === 'unsupported_event' ? 'unsupported' : 'authority' };
        return { kind: 'unknown' };
      }
    },
    async inspect(raw: FrozenCalendarMutation, signal: AbortSignal) {
      const startedAt = now(), { frozen, binding, target } = await mutationSelection(raw), c = await client(binding, 'read', target, signal, startedAt), selected = await calendar(c, binding, target);
      if (selected.access === 'busy') calendarFail('details_forbidden');
      const response = await c.call('calendars/' + encodeURIComponent(target) + '/events/' + encodeURIComponent(frozen.upstreamEventId));
      // A 404 never becomes "deleted"; access loss and missing resources are ambiguous.
      if (response.id === frozen.upstreamEventId && response.status === 'cancelled') { await c.check(); return { deleted: true as const, ...c.observed() }; }
      const event = managedGoogleCalendarEvent(response, selected, frozen); await c.check(); return { event, ...c.observed() };
    },
  };
}
