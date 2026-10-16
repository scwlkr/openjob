import { isOfflineTaskCalendarId, projectTaskCalendar, TASK_CALENDAR_MAX_AGE_MS, TASK_CALENDAR_REVISION, TASK_CALENDAR_UUID, taskCalendarDate, taskCalendarFail, type TaskCalendarProjection, type TaskCalendarSyncInput } from '../shared/task-calendar-sync.ts';
import type { WorkspaceState } from '../shared/workspace-contracts.ts';
export type TaskCalendarReceipt = { ownerId: string; operationId: string; payloadHash: string; expiresAt: string; retainUntil: string; revision: string };
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${[...value].sort((a, b) => String(a.id ?? '').localeCompare(String(b.id ?? ''))).map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
async function hash(value: unknown) { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value))); return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''); }
export async function taskCalendarRevision(owner: string, projection: TaskCalendarProjection) { return `tc1_${await hash({ owner, projection })}`; }
export async function taskCalendarPayloadHash(owner: string, input: TaskCalendarSyncInput) { return hash({ owner, ...input }); }
export function parseTaskCalendarReceipts(owner: string, encoded?: string): TaskCalendarReceipt[] {
  if (encoded === undefined) return []; let value: unknown; try { value = JSON.parse(encoded); } catch { taskCalendarFail('invalid_state'); }
  if (!Array.isArray(value) || value.length > 100) taskCalendarFail('invalid_state');
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Object.keys(item).sort().join(',') !== 'expiresAt,operationId,ownerId,payloadHash,retainUntil,revision' || item.ownerId !== owner || typeof item.operationId !== 'string' || typeof item.payloadHash !== 'string' || typeof item.revision !== 'string' || !TASK_CALENDAR_UUID.test(item.operationId) || seen.has(item.operationId) || !/^[a-f0-9]{64}$/.test(item.payloadHash) || !TASK_CALENDAR_REVISION.test(item.revision) || !taskCalendarDate(item.expiresAt) || !taskCalendarDate(item.retainUntil) || Date.parse(item.retainUntil) - Date.parse(item.expiresAt) !== TASK_CALENDAR_MAX_AGE_MS) taskCalendarFail('invalid_state');
    seen.add(item.operationId);
  }
  return value as TaskCalendarReceipt[];
}
export function mergeTaskCalendar(owner: string, state: WorkspaceState, projection: TaskCalendarProjection): WorkspaceState {
  const current = projectTaskCalendar(owner, state);
  if (canonical(current.calendars) !== canonical(projection.calendars)) taskCalendarFail('forbidden');
  const privateIds = new Set([...state.accounts, ...state.messages, ...state.drafts, ...state.sent, ...state.activity].map(item => item.id));
  if ([...projection.tasks, ...projection.events].some(item => privateIds.has(item.id))) taskCalendarFail();
  for (const task of projection.tasks) if (!state.tasks.some(existing => existing.id === task.id) && !isOfflineTaskCalendarId(task.id)) taskCalendarFail();
  for (const event of projection.events) if (!state.events.some(existing => existing.id === event.id) && !isOfflineTaskCalendarId(event.id)) taskCalendarFail();
  const tasks = projection.tasks.map(task => { const prior = state.tasks.find(existing => existing.id === task.id); return { ...task, ...(prior?.sourceMessageId ? { sourceMessageId: prior.sourceMessageId, sourceAccountId: prior.sourceAccountId } : {}) }; });
  return { ...state, tasks, calendars: projection.calendars, events: projection.events };
}
