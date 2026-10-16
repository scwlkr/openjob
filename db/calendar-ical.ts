import { projectTaskCalendar } from "../shared/task-calendar-sync.ts";
import { parseCalendarIcal, calendarIcalImportId, calendarIcalOpaqueUid, calendarIcalRevision, type CalendarIcalImportResult } from '../shared/calendar-ical.ts';
import type { WorkspaceState } from '../shared/workspace-contracts.ts';
import type { PersonalAgentGrant } from '../shared/personal-workspace-contracts.ts';
function fail(code: string): never { throw Object.assign(new Error(code === 'calendar_import_conflict' ? 'An imported calendar UID has changed. Review the calendar before importing.' : code === 'conflict' ? 'The calendar changed after preview. Preview it again.' : 'The calendar import is unavailable or invalid.'), { code }); }
export function isCalendarIcalImport(input: unknown): input is { type: 'calendar.import'; calendarId: string; ical: string; expectedRevision: string } { return !!input && typeof input === 'object' && 'type' in input && input.type === 'calendar.import'; }
export async function applyCalendarIcalImport(owner: string, state: WorkspaceState, input: unknown, grant?: PersonalAgentGrant, now = Date.now()): Promise<{ result: CalendarIcalImportResult; state?: WorkspaceState; skip?: boolean }> {
  if (!isCalendarIcalImport(input) || Object.keys(input).sort().join(',') !== 'calendarId,expectedRevision,ical,type' || typeof input.calendarId !== 'string' || !input.calendarId || input.calendarId.length > 128 || typeof input.expectedRevision !== 'string' || !/^ci1_[a-f0-9]{64}$/.test(input.expectedRevision)) fail('invalid_input');
  const calendar = state.calendars.find(item => item.id === input.calendarId && item.ownerId === owner); if (!calendar) fail('forbidden');
  const resource = calendar.id === 'personal' ? 'calendar:personal' : calendar.id;
  if (grant && (grant.ownerUserId !== owner || grant.revoked || !grant.resourceIds.includes(resource as typeof grant.resourceIds[number]) || !grant.scopes.includes('calendar:read') || !grant.scopes.includes('calendar:write'))) fail('forbidden');
  const parsed = parseCalendarIcal(input.ical);
  const existing = state.events.filter(event => event.calendarId === calendar.id);
  const exportedUids = new Map(await Promise.all(existing.map(async event => [await calendarIcalOpaqueUid(owner, calendar.id, event.id), event] as const)));
  const added: WorkspaceState['events'] = []; let skipped = 0;
  const allIds = new Set(Object.values(state).flatMap(items => items.map(item => item.id)));
  for (const event of parsed) {
    const id = await calendarIcalImportId(owner, calendar.id, event.uid);
    const prior = exportedUids.get(event.uid) ?? existing.find(item => item.id === id);
    if (prior) {
      if (prior.title !== event.title || prior.start !== event.start || prior.end !== event.end) fail('calendar_import_conflict');
      skipped++; continue;
    }
    if (allIds.has(id)) fail('invalid_input'); allIds.add(id);
    added.push({ id, calendarId: calendar.id, title: event.title, start: event.start, end: event.end });
  }
  const revision = await calendarIcalRevision(state, calendar.id);
  if (!added.length) return { result: { calendarId: calendar.id, imported: 0, skipped, revision }, skip: true };
  if (revision !== input.expectedRevision) fail('conflict');
  const next: WorkspaceState = { ...state, events: [...state.events, ...added], activity: [...state.activity, { id: crypto.randomUUID(), ownerId: owner, actor: grant ? `Agent ${grant.id}` : 'You', action: 'calendar.import', createdAt: new Date(now).toISOString() }] };
  // Imported blocks must remain readable by the existing offline projection.
  try { projectTaskCalendar(owner, next); } catch { fail('workspace_capacity'); }
  return { result: { calendarId: calendar.id, imported: added.length, skipped, revision: await calendarIcalRevision(next, calendar.id) }, state: next };
}
