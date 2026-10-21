/** Provider-owned Calendar records stay outside the offline Task/block projection. */
export type CalendarPoint = { kind: 'timed'; at: string; timeZone: string } | { kind: 'all-day'; date: string; timeZone: string };
export type CalendarSpan = { start: CalendarPoint; end: CalendarPoint };
export type RemoteCalendar = { id: string; accountId: string; upstreamId: string; name: string; timeZone: string; access: 'busy' | 'reader' | 'writer' | 'writer-limited' | 'owner' };
export type RemoteCalendarEvent = {
  id: string; accountId: string; calendarId: string; upstreamId: string; etag: string; title: string;
  span: CalendarSpan | { start: CalendarPoint; end: null }; transparency: 'opaque' | 'transparent';
  occurrence: { seriesId: string; originalStart: CalendarPoint } | null;
  hasAttendees: boolean;
};
export type CalendarWindow = { start: string; end: string };
export type CalendarObservation = { observedAt: string; expiresAt: string };
export type CalendarAvailability = CalendarWindow & CalendarObservation & { calendarId: string; busy: { start: string; end: string }[] };
export type RemoteCalendarPage = CalendarObservation & { calendars: RemoteCalendar[]; nextCursor: string | null };
export type RemoteEventPage = CalendarObservation & { calendar: RemoteCalendar; events: RemoteCalendarEvent[]; nextCursor: string | null };

export function calendarFail(code = 'invalid_input'): never { throw Object.assign(new Error('Provider Calendar unavailable.'), { code }); }
export const calendarRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function calendarText(value: unknown, limit = 512): string {
  if (typeof value !== 'string' || value.length > limit || !value.isWellFormed() || /[\u0000-\u001f\u007f]/.test(value)) calendarFail();
  return value;
}
export function calendarTimeZone(value: unknown): string {
  const zone = calendarText(value, 128); if (!zone) calendarFail();
  try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(0); } catch { calendarFail(); }
  return zone;
}
export function calendarInstant(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) calendarFail();
  calendarDate(value.slice(0, 10));
  if (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) calendarFail();
  return new Date(value).toISOString();
}
export function calendarDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(value) || !Number.isFinite(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) calendarFail();
  return value;
}
export function validateCalendarWindow(value: CalendarWindow): CalendarWindow {
  if (!calendarRecord(value) || Object.keys(value).sort().join(',') !== 'end,start') calendarFail();
  const start = calendarInstant(value.start), end = calendarInstant(value.end), length = Date.parse(end) - Date.parse(start);
  if (length <= 0 || length > 31 * 86_400_000) calendarFail();
  return { start, end };
}
export function validateCalendarPoint(value: unknown): CalendarPoint {
  if (!calendarRecord(value)) calendarFail();
  const timeZone = calendarTimeZone(value.timeZone);
  if (value.kind === 'timed' && Object.keys(value).sort().join(',') === 'at,kind,timeZone') return { kind: 'timed', at: calendarInstant(value.at), timeZone };
  if (value.kind === 'all-day' && Object.keys(value).sort().join(',') === 'date,kind,timeZone') return { kind: 'all-day', date: calendarDate(value.date), timeZone };
  return calendarFail();
}
export function validateCalendarSpan(value: unknown): CalendarSpan {
  if (!calendarRecord(value) || Object.keys(value).sort().join(',') !== 'end,start') calendarFail();
  const start = validateCalendarPoint(value.start), end = validateCalendarPoint(value.end);
  if (start.kind !== end.kind || (start.kind === 'timed' && end.kind === 'timed' ? Date.parse(start.at) >= Date.parse(end.at) : start.kind === 'all-day' && end.kind === 'all-day' ? start.date >= end.date : true)) calendarFail();
  return { start, end };
}
const refPart = (value: string, max: number) => { if (!calendarText(value, max)) calendarFail(); return encodeURIComponent(value); };
export function remoteCalendarRef(accountId: string, upstreamId: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(accountId)) calendarFail();
  return `${accountId}:calendar:${refPart(upstreamId, 1024)}`;
}
export function remoteCalendarId(reference: string, accountId: string) {
  if (typeof reference !== 'string' || !reference.startsWith(`${accountId}:calendar:`)) calendarFail();
  let id: string; try { id = decodeURIComponent(reference.slice(`${accountId}:calendar:`.length)); } catch { return calendarFail(); }
  if (remoteCalendarRef(accountId, id) !== reference) calendarFail(); return id;
}
export function remoteCalendarEventRef(calendarId: string, eventId: string) { return `${calendarId}:event:${refPart(eventId, 1024)}`; }
export function remoteCalendarEventId(reference: string, calendarId: string) {
  if (typeof reference !== 'string' || !reference.startsWith(`${calendarId}:event:`)) calendarFail();
  let id: string; try { id = decodeURIComponent(reference.slice(`${calendarId}:event:`.length)); } catch { return calendarFail(); }
  if (remoteCalendarEventRef(calendarId, id) !== reference) calendarFail(); return id;
}
export function calendarObserved(now: number, credentialExpiresAt = now + 60_000): CalendarObservation {
  if (!Number.isFinite(now) || !Number.isFinite(credentialExpiresAt) || credentialExpiresAt <= now) calendarFail('reconnect_required');
  return { observedAt: new Date(now).toISOString(), expiresAt: new Date(Math.min(now + 60_000, credentialExpiresAt)).toISOString() };
}
