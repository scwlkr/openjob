import { calendarFail, calendarRecord, calendarText, calendarTimeZone, calendarInstant, calendarDate, validateCalendarSpan, remoteCalendarRef, remoteCalendarEventRef, type CalendarPoint, type RemoteCalendar, type RemoteCalendarEvent } from '../../shared/provider-calendar.ts';
import { managedCalendarProperties, type FrozenCalendarMutation } from '../../shared/calendar-mutation.ts';

function object(value: unknown): Record<string, unknown> { if (!calendarRecord(value)) calendarFail('malformed_response'); return value; }
function required(value: unknown, limit = 1024) { const result = calendarText(value, limit); if (!result) calendarFail('malformed_response'); return result; }
function point(value: unknown, defaultZone: string): CalendarPoint {
  const raw = object(value), timeZone = calendarTimeZone(raw.timeZone ?? defaultZone);
  if (raw.date !== undefined && raw.dateTime === undefined) return { kind: 'all-day', date: calendarDate(raw.date), timeZone };
  if (raw.dateTime !== undefined && raw.date === undefined) return { kind: 'timed', at: calendarInstant(raw.dateTime), timeZone };
  return calendarFail('malformed_response');
}
export function mapGoogleCalendar(value: unknown, accountId: string): RemoteCalendar {
  const raw = object(value), upstreamId = required(raw.id), timeZone = calendarTimeZone(raw.timeZone);
  const roles: Record<string, RemoteCalendar['access']> = { freeBusyReader: 'busy', reader: 'reader', writer: 'writer', writerWithoutPrivateAccess: 'writer-limited', owner: 'owner' };
  const access = typeof raw.accessRole === 'string' && Object.hasOwn(roles, raw.accessRole) ? roles[raw.accessRole] : undefined;
  if (!access || raw.deleted === true) calendarFail('calendar_unavailable');
  return { id: remoteCalendarRef(accountId, upstreamId), accountId, upstreamId, name: required(raw.summaryOverride ?? raw.summary, 500), timeZone, access };
}
export function mapGoogleCalendarEvent(value: unknown, calendar: RemoteCalendar): RemoteCalendarEvent {
  const raw = object(value), upstreamId = required(raw.id), etag = required(raw.etag, 256);
  if (raw.status === 'cancelled' || !['confirmed', 'tentative'].includes(String(raw.status)) || !/^(?:W\/)?"[\x21\x23-\x7e]+"$/.test(etag)) calendarFail('malformed_response');
  if (raw.endTimeUnspecified !== undefined && typeof raw.endTimeUnspecified !== 'boolean') calendarFail('malformed_response');
  const span = raw.endTimeUnspecified === true ? { start: point(raw.start, calendar.timeZone), end: null } : validateCalendarSpan({ start: point(raw.start, calendar.timeZone), end: point(raw.end, calendar.timeZone) });
  let occurrence: RemoteCalendarEvent['occurrence'] = null;
  if ((raw.recurringEventId === undefined) !== (raw.originalStartTime === undefined)) calendarFail('malformed_response');
  if (raw.recurringEventId !== undefined) occurrence = { seriesId: required(raw.recurringEventId), originalStart: point(raw.originalStartTime, calendar.timeZone) };
  // singleEvents reads must return occurrences; a series body must not masquerade as one block.
  if (raw.recurrence !== undefined || raw.attendeesOmitted !== undefined && typeof raw.attendeesOmitted !== 'boolean' || raw.attendees !== undefined && (!Array.isArray(raw.attendees) || raw.attendees.length > 1000) || raw.transparency !== undefined && !['opaque', 'transparent'].includes(String(raw.transparency))) calendarFail('malformed_response');
  return { id: remoteCalendarEventRef(calendar.id, upstreamId), accountId: calendar.accountId, calendarId: calendar.id, upstreamId, etag,
    title: raw.summary === undefined ? '(Title unavailable)' : calendarText(raw.summary, 4096), span, transparency: raw.transparency === 'transparent' ? 'transparent' : 'opaque', occurrence,
    hasAttendees: raw.attendeesOmitted === true || Array.isArray(raw.attendees) && raw.attendees.length > 0 };
}

/** A current full GET, not a reduced list DTO, proves the narrow managed shape. */
export function managedGoogleCalendarEvent(value: unknown, calendar: RemoteCalendar, frozen: FrozenCalendarMutation): RemoteCalendarEvent {
  const raw = object(value), event = mapGoogleCalendarEvent(value, calendar);
  const properties = calendarRecord(raw.extendedProperties) && calendarRecord(raw.extendedProperties.private) ? raw.extendedProperties.private : {};
  if (event.upstreamId !== frozen.upstreamEventId || event.occurrence || event.hasAttendees || !event.span.end || event.span.start.kind !== 'timed' || event.span.end.kind !== 'timed' || raw.status !== 'confirmed' || raw.eventType !== undefined && raw.eventType !== 'default' || raw.locked === true || raw.privateCopy === true || raw.endTimeUnspecified === true || event.transparency !== 'opaque') calendarFail('unsupported_event');
  for (const [key, expected] of Object.entries(managedCalendarProperties(frozen))) if (properties[key] !== expected) calendarFail('unsupported_event');
  for (const field of ['recurrence', 'conferenceData', 'hangoutLink', 'attachments', 'birthdayProperties', 'focusTimeProperties', 'outOfOfficeProperties', 'workingLocationProperties', 'source']) if (raw[field] !== undefined) calendarFail('unsupported_event');
  for (const field of ['description', 'location']) if (raw[field] !== undefined && raw[field] !== '') calendarFail('unsupported_event');
  if (!calendarRecord(raw.reminders) || raw.reminders.useDefault !== false || raw.reminders.overrides !== undefined && (!Array.isArray(raw.reminders.overrides) || raw.reminders.overrides.length !== 0)) calendarFail('unsupported_event');
  return event;
}
