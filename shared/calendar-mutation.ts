import { calendarFail, calendarRecord, calendarText, remoteCalendarId, validateCalendarSpan, type CalendarSpan } from './provider-calendar.ts';
import { operationHash, taskIdentifier } from './reply-operation.ts';

export const CALENDAR_OPERATION_ID = /^cop_[a-f0-9]{64}$/;
export type ManagedCalendarOrigin = { operationId: string; marker: string };
type MutationBase = {
  version: 1; ownerId: string; workspaceId: string; taskId: string;
  accountId: string; connectionId: string; subject: string; bindingRevision: string;
  calendarId: string; upstreamEventId: string; origin: ManagedCalendarOrigin;
};
export type FrozenCalendarMutation = MutationBase & (
  { action: 'calendar.create'; title: string; span: CalendarSpan } |
  { action: 'calendar.update'; title: string; span: CalendarSpan; etag: string } |
  { action: 'calendar.delete'; etag: string }
);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export function calendarEtag(value: unknown): string {
  const tag = calendarText(value, 256); if (!/^"[\x21\x23-\x7e]+"$/.test(tag)) calendarFail(); return tag;
}
export function validateManagedCalendarOrigin(value: unknown): ManagedCalendarOrigin {
  if (!calendarRecord(value) || Object.keys(value).sort().join(',') !== 'marker,operationId' || typeof value.operationId !== 'string' || !CALENDAR_OPERATION_ID.test(value.operationId) || !hash(value.marker)) calendarFail();
  return { operationId: value.operationId, marker: value.marker };
}
/** Only the durable server authority constructs this private frozen payload. */
export function validateFrozenCalendarMutation(value: unknown): FrozenCalendarMutation {
  if (!calendarRecord(value) || value.version !== 1 || typeof value.ownerId !== 'string' || !/^user_[a-f0-9]{32}$/.test(value.ownerId) || typeof value.workspaceId !== 'string' || !/^wsp_[a-f0-9]{32}$/.test(value.workspaceId) || !taskIdentifier(value.taskId) || ![value.accountId, value.connectionId].every(id) || !calendarText(value.subject, 256) || !calendarText(value.bindingRevision, 128) || typeof value.calendarId !== 'string' || typeof value.upstreamEventId !== 'string' || !/^oj[a-f0-9]{64}$/.test(value.upstreamEventId)) calendarFail();
  const target = remoteCalendarId(value.calendarId, value.accountId as string); if (target === 'primary') calendarFail();
  const origin = validateManagedCalendarOrigin(value.origin);
  const base = ['version', 'ownerId', 'workspaceId', 'taskId', 'accountId', 'connectionId', 'subject', 'bindingRevision', 'calendarId', 'upstreamEventId', 'origin'];
  const content = value.action === 'calendar.delete' ? [] : ['title', 'span'];
  const revision = value.action === 'calendar.create' ? [] : ['etag'];
  if (!['calendar.create', 'calendar.update', 'calendar.delete'].includes(String(value.action)) || Object.keys(value).sort().join(',') !== [...base, 'action', ...content, ...revision].sort().join(',')) calendarFail();
  if (value.action !== 'calendar.create') calendarEtag(value.etag);
  if (value.action !== 'calendar.delete') {
    if (!calendarText(value.title, 500).trim()) calendarFail();
    const span = validateCalendarSpan(value.span);
    // First managed-block slice is timed. All-day reads remain faithfully typed.
    if (span.start.kind !== 'timed' || span.end.kind !== 'timed') calendarFail();
    return { ...structuredClone(value), origin, span } as FrozenCalendarMutation;
  }
  return structuredClone(value) as FrozenCalendarMutation;
}
export async function managedCalendarEventId(owner: string, workspace: string, task: string, origin: ManagedCalendarOrigin) {
  validateManagedCalendarOrigin(origin); return 'oj' + await operationHash([owner, workspace, task, origin.operationId]);
}
export function managedCalendarProperties(value: FrozenCalendarMutation) {
  return { openjobPlanning: value.origin.operationId, openjobMarker: value.origin.marker };
}
