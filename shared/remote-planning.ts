import { calendarFail, calendarRecord, calendarText, remoteCalendarId, remoteCalendarEventRef, validateCalendarSpan, type CalendarSpan } from './provider-calendar.ts';
import { CALENDAR_OPERATION_ID, calendarEtag, validateFrozenCalendarMutation, type FrozenCalendarMutation } from './calendar-mutation.ts';
import { operationHash, taskIdentifier, OPERATION_INTENT_MS, OPERATION_RECEIPT_MS, type OperationState } from './reply-operation.ts';
import type { TaskCalendarProjection } from './task-calendar-sync.ts';

type Content = { title: string; span: CalendarSpan };
export type CalendarPlanInput = { taskId: string; requestId: string } & (
  { action: 'calendar.create'; accountId: string; calendarId: string } & Content |
  { action: 'calendar.update'; etag: string } & Content |
  { action: 'calendar.delete'; etag: string }
);
export type CalendarBlockReceipt = Content & { eventId: string; etag: string };
export type CalendarOperationReceipt = { block: CalendarBlockReceipt } | { deleted: true };
export type CalendarPlanOutcome = 'provider_accepted' | 'provider_rejected' | 'provider_conflict' | 'unsupported_event' | 'authority_changed' | 'payload_invalid' | 'intent_expired' | 'dispatch_unknown';
export type StoredCalendarOperation = {
  id: string; ownerUserId: string; workspaceId: string; taskId: string; action: FrozenCalendarMutation['action']; requestId: string;
  requestHash: string; payloadHash: string; calendarId: string; eventId: string;
  state: OperationState; createdAt: string; updatedAt: string; dispatchBefore: string; receiptExpiresAt: string;
  outcome?: CalendarPlanOutcome; receipt?: CalendarOperationReceipt;
};
export type CalendarOperationView = Omit<StoredCalendarOperation, 'ownerUserId' | 'requestHash' | 'payloadHash' | 'receipt'> & { mode: 'fixture'; receiptExpired: boolean; receipt: { eventId: string; etag: string } | { deleted: true } | null };
export type StoredRemotePlanningLink = {
  taskId: string; operationId: string; payload: FrozenCalendarMutation;
  state: 'reserved' | 'linked' | 'unknown' | 'review_required'; confirmed: CalendarBlockReceipt | null;
};
export type RemotePlanningLink = { targetKind: 'provider'; taskId: string; calendarId: string; eventId: string; operationId: string; state: StoredRemotePlanningLink['state']; confirmed: CalendarBlockReceipt | null };
const keys = (value: object, expected: string[]) => Object.keys(value).sort().join(',') === [...expected].sort().join(',');
const iso = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function calendarPlanInput(value: unknown): CalendarPlanInput {
  if (!calendarRecord(value) || !taskIdentifier(value.taskId) || typeof value.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.requestId)) calendarFail();
  const base = ['action', 'taskId', 'requestId'];
  if (value.action === 'calendar.create') {
    if (!keys(value, [...base, 'accountId', 'calendarId', 'title', 'span']) || typeof value.accountId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.accountId) || typeof value.calendarId !== 'string' || remoteCalendarId(value.calendarId, value.accountId) === 'primary') calendarFail();
  } else if (value.action === 'calendar.update' || value.action === 'calendar.delete') {
    if (!keys(value, [...base, 'etag', ...(value.action === 'calendar.update' ? ['title', 'span'] : [])])) calendarFail(); calendarEtag(value.etag);
  } else calendarFail();
  if (value.action !== 'calendar.delete') {
    const span = validateCalendarSpan(value.span); if (!calendarText(value.title, 500).trim() || span.start.kind !== 'timed' || span.end.kind !== 'timed') calendarFail();
    const content = { title: value.title as string, span };
    return value.action === 'calendar.create' ? { action: value.action, taskId: value.taskId, requestId: value.requestId, accountId: value.accountId as string, calendarId: value.calendarId as string, ...content } : { action: 'calendar.update', taskId: value.taskId, requestId: value.requestId, etag: value.etag as string, ...content };
  }
  return { action: 'calendar.delete', taskId: value.taskId, requestId: value.requestId, etag: value.etag as string };
}
export async function calendarPlanIdentity(owner: string, workspace: string, input: CalendarPlanInput) {
  return { id: 'cop_' + await operationHash([owner, workspace, input.action, input.requestId]), requestHash: await operationHash(input) };
}
function block(value: unknown): CalendarBlockReceipt {
  if (!calendarRecord(value) || !keys(value, ['eventId', 'etag', 'title', 'span']) || !calendarText(value.eventId, 8192) || !calendarText(value.title, 500).trim()) calendarFail('invalid_state');
  const span = validateCalendarSpan(value.span); if (span.start.kind !== 'timed' || span.end.kind !== 'timed') calendarFail('invalid_state');
  return { eventId: value.eventId as string, etag: calendarEtag(value.etag), title: value.title as string, span };
}
export function calendarOperationReceipt(value: unknown): CalendarOperationReceipt {
  if (!calendarRecord(value)) calendarFail('invalid_state');
  if (keys(value, ['deleted']) && value.deleted === true) return { deleted: true };
  if (keys(value, ['block'])) return { block: block(value.block) };
  return calendarFail('invalid_state');
}
export function storedCalendarOperation(value: unknown): StoredCalendarOperation {
  if (!calendarRecord(value) || !keys(value, ['id', 'ownerUserId', 'workspaceId', 'taskId', 'action', 'requestId', 'requestHash', 'payloadHash', 'calendarId', 'eventId', 'state', 'createdAt', 'updatedAt', 'dispatchBefore', 'receiptExpiresAt', ...(value.outcome === undefined ? [] : ['outcome']), ...(value.receipt === undefined ? [] : ['receipt'])]) || typeof value.id !== 'string' || !CALENDAR_OPERATION_ID.test(value.id) || typeof value.ownerUserId !== 'string' || !/^user_[a-f0-9]{32}$/.test(value.ownerUserId) || typeof value.workspaceId !== 'string' || !/^wsp_[a-f0-9]{32}$/.test(value.workspaceId) || !taskIdentifier(value.taskId) || !['calendar.create', 'calendar.update', 'calendar.delete'].includes(String(value.action)) || typeof value.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.requestId) || !digest(value.requestHash) || !digest(value.payloadHash) || !calendarText(value.calendarId, 4096) || typeof value.eventId !== 'string' || !value.eventId.startsWith(value.calendarId + ':event:oj') || !['queued', 'executing', 'confirmed', 'rejected', 'unknown'].includes(String(value.state)) || ![value.createdAt, value.updatedAt, value.dispatchBefore, value.receiptExpiresAt].every(iso)) calendarFail('invalid_state');
  if (Date.parse(value.dispatchBefore as string) - Date.parse(value.createdAt as string) !== OPERATION_INTENT_MS || Date.parse(value.receiptExpiresAt as string) - Date.parse(value.createdAt as string) !== OPERATION_RECEIPT_MS || Date.parse(value.updatedAt as string) < Date.parse(value.createdAt as string)) calendarFail('invalid_state');
  const terminal = ['confirmed', 'rejected', 'unknown'].includes(String(value.state));
  if (terminal !== (value.outcome !== undefined) || (value.state === 'confirmed') !== (value.receipt !== undefined) || value.state === 'confirmed' && value.outcome !== 'provider_accepted' || value.state === 'unknown' && value.outcome !== 'dispatch_unknown' || value.state === 'rejected' && !['provider_rejected', 'provider_conflict', 'unsupported_event', 'authority_changed', 'payload_invalid', 'intent_expired'].includes(String(value.outcome))) calendarFail('invalid_state');
  if (value.receipt !== undefined) { const receipt = calendarOperationReceipt(value.receipt); if ((value.action === 'calendar.delete') !== ('deleted' in receipt) || 'block' in receipt && receipt.block.eventId !== value.eventId) calendarFail('invalid_state'); }
  return structuredClone(value) as StoredCalendarOperation;
}
export function calendarOperationView(op: StoredCalendarOperation, now: number): CalendarOperationView {
  const { ownerUserId: _, requestHash: __, payloadHash: ___, receipt, ...rest } = op; void _; void __; void ___;
  return { ...structuredClone(rest), mode: 'fixture', receiptExpired: Date.parse(op.receiptExpiresAt) <= now, receipt: receipt ? 'block' in receipt ? { eventId: receipt.block.eventId, etag: receipt.block.etag } : { deleted: true } : null };
}
export function parseRemotePlanningLinks(encoded?: string): StoredRemotePlanningLink[] {
  if (encoded === undefined) return [];
  let value: unknown; try { value = JSON.parse(encoded); } catch { return calendarFail('invalid_state'); }
  if (!Array.isArray(value) || value.length > 500) calendarFail('invalid_state');
  const rows = value.map(row => {
    if (!calendarRecord(row) || !keys(row, ['taskId', 'operationId', 'payload', 'state', 'confirmed']) || !taskIdentifier(row.taskId) || typeof row.operationId !== 'string' || !CALENDAR_OPERATION_ID.test(row.operationId) || !['reserved', 'linked', 'unknown', 'review_required'].includes(String(row.state))) calendarFail('invalid_state');
    const payload = validateFrozenCalendarMutation(row.payload), confirmed = row.confirmed === null ? null : block(row.confirmed);
    if (payload.taskId !== row.taskId || confirmed && confirmed.eventId !== remoteCalendarEventRef(payload.calendarId, payload.upstreamEventId) || row.state === 'linked' && !confirmed) calendarFail('invalid_state');
    return { taskId: row.taskId, operationId: row.operationId, payload, state: row.state, confirmed } as StoredRemotePlanningLink;
  });
  if (new Set(rows.map(row => row.taskId)).size !== rows.length) calendarFail('invalid_state'); return rows;
}
export function remotePlanningView(row: StoredRemotePlanningLink): RemotePlanningLink {
  return { targetKind: 'provider', taskId: row.taskId, operationId: row.operationId, state: row.state, calendarId: row.payload.calendarId, eventId: remoteCalendarEventRef(row.payload.calendarId, row.payload.upstreamEventId), confirmed: structuredClone(row.confirmed) };
}
/** All local and offline writes preserve the one active local OR remote link rule. */
export function assertRemotePlanningProjection(links: StoredRemotePlanningLink[], projection: TaskCalendarProjection) {
  for (const row of links) { const task = projection.tasks.find(task => task.id === row.taskId); if (!task || task.calendarEventId || task.scheduledSlot) calendarFail('remote_plan_active'); }
}
export function assertRemotePlanningCommand(links: StoredRemotePlanningLink[], command: unknown) {
  if (calendarRecord(command) && ['task.schedule', 'task.schedule-available', 'task.unschedule', 'task.delete'].includes(String(command.type)) && links.some(row => row.taskId === command.taskId)) calendarFail('remote_plan_active');
}
