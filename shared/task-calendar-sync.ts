import type { WorkspaceCalendar, WorkspaceCommand, WorkspaceEvent, WorkspaceTask, WorkspaceView } from './workspace-contracts';
export type TaskCalendarTask = Omit<WorkspaceTask, 'sourceMessageId' | 'sourceAccountId'>;
export type TaskCalendarProjection = { tasks: TaskCalendarTask[]; calendars: WorkspaceCalendar[]; events: WorkspaceEvent[] };
export type TaskCalendarSyncSnapshot = { revision: string; projection: TaskCalendarProjection };
export type TaskCalendarSyncInput = { operationId: string; baseRevision: string; expiresAt: string; projection: TaskCalendarProjection };
export type TaskCalendarSyncAck = { operationId: string; revision: string };
export type TaskCalendarCommand = Extract<WorkspaceCommand, { type: `task.${string}` | `calendar.${string}` }>;
export const TASK_CALENDAR_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const TASK_CALENDAR_REVISION = /^tc1_[a-f0-9]{64}$/;
export const TASK_CALENDAR_MAX_AGE_MS = 86400000;
export function taskCalendarFail(code = 'invalid_input'): never { throw Object.assign(new Error(code === 'conflict' ? 'Tasks or Calendar changed; review current saved state.' : 'Invalid Tasks and Calendar sync data.'), { code }); }
type Row = Record<string, unknown>;
function row(value: unknown, allowed: string[], required = allowed): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return taskCalendarFail();
  const item = value as Row;
  if (Object.keys(item).some(key => !allowed.includes(key)) || required.some(key => !Object.prototype.hasOwnProperty.call(item, key))) taskCalendarFail(); return item;
}
const text = (value: unknown, max = 500): value is string => typeof value === 'string' && !!value.trim() && value.length <= max;
export const taskCalendarDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export const isOfflineTaskCalendarId = (value: unknown): value is string => typeof value === 'string' && value.startsWith('offline_') && TASK_CALENDAR_UUID.test(value.slice(8));
function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
export function validateTaskCalendarProjection(owner: string, value: unknown): TaskCalendarProjection {
  if (typeof owner !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(owner)) taskCalendarFail();
  const top = row(value, ['tasks', 'calendars', 'events']);
  if (![top.tasks, top.calendars, top.events].every(items => Array.isArray(items) && items.length <= 1000) || JSON.stringify(value).length > 300000) taskCalendarFail();
  const state = value as TaskCalendarProjection; const ids = new Set<string>();
  const unique = (id: unknown) => { if (!text(id, 128) || ids.has(id)) taskCalendarFail(); ids.add(id); };
  if (!state.calendars.length) taskCalendarFail();
  for (const value of state.calendars) { const calendar = row(value, ['id', 'ownerId', 'name', 'color']); unique(calendar.id); if (calendar.ownerId !== owner || !text(calendar.name) || typeof calendar.color !== 'string' || !/^#[a-f0-9]{6}$/i.test(calendar.color)) taskCalendarFail(); }
  for (const value of state.tasks) {
    const task = row(value, ['id', 'ownerId', 'title', 'completed', 'scheduledSlot', 'calendarEventId'], ['id', 'ownerId', 'title', 'completed']); unique(task.id);
    if (task.ownerId !== owner || !text(task.title) || typeof task.completed !== 'boolean' || (task.scheduledSlot === undefined) !== (task.calendarEventId === undefined)) taskCalendarFail();
    if (task.scheduledSlot !== undefined) { const slot = row(task.scheduledSlot, ['start', 'end']); if (!taskCalendarDate(slot.start) || !taskCalendarDate(slot.end) || slot.start >= slot.end || !text(task.calendarEventId, 128)) taskCalendarFail(); }
  }
  for (const value of state.events) {
    const event = row(value, ['id', 'calendarId', 'title', 'start', 'end', 'taskId'], ['id', 'calendarId', 'title', 'start', 'end']); unique(event.id);
    if (!state.calendars.some(calendar => calendar.id === event.calendarId) || !text(event.title) || !taskCalendarDate(event.start) || !taskCalendarDate(event.end) || event.start >= event.end) taskCalendarFail();
    if (event.taskId !== undefined && !state.tasks.some(task => task.id === event.taskId && task.calendarEventId === event.id && task.scheduledSlot?.start === event.start && task.scheduledSlot?.end === event.end)) taskCalendarFail();
  }
  for (const task of state.tasks) if (task.calendarEventId !== undefined && !state.events.some(event => event.id === task.calendarEventId && event.taskId === task.id)) taskCalendarFail();
  return copy(state);
}
export function projectTaskCalendar(owner: string, view: WorkspaceView): TaskCalendarProjection {
  return validateTaskCalendarProjection(owner, { tasks: view.tasks.map(({ id, ownerId, title, completed, scheduledSlot, calendarEventId }) => ({ id, ownerId, title, completed, ...(scheduledSlot ? { scheduledSlot } : {}), ...(calendarEventId ? { calendarEventId } : {}) })), calendars: view.calendars.map(({ id, ownerId, name, color }) => ({ id, ownerId, name, color })), events: view.events });
}
export function validateTaskCalendarSyncInput(owner: string, input: unknown): TaskCalendarSyncInput {
  const item = row(input, ['operationId', 'baseRevision', 'expiresAt', 'projection']);
  if (typeof item.operationId !== 'string' || !TASK_CALENDAR_UUID.test(item.operationId) || typeof item.baseRevision !== 'string' || !TASK_CALENDAR_REVISION.test(item.baseRevision) || !taskCalendarDate(item.expiresAt)) taskCalendarFail();
  return { operationId: item.operationId, baseRevision: item.baseRevision, expiresAt: item.expiresAt, projection: validateTaskCalendarProjection(owner, item.projection) };
}
export function applyTaskCalendarCommand(projection: TaskCalendarProjection, input: TaskCalendarCommand, owner: string, newId: () => string): TaskCalendarProjection {
  const state = validateTaskCalendarProjection(owner, projection);
  const fields: Record<string, string[]> = { 'task.create': ['title'], 'task.update': ['taskId', 'title'], 'task.complete': ['taskId', 'completed'], 'task.delete': ['taskId'], 'task.unschedule': ['taskId'], 'task.schedule': ['taskId', 'calendarId', 'start', 'end'], 'calendar.create': ['calendarId', 'title', 'start', 'end'], 'calendar.update': ['eventId', 'title', 'start', 'end'], 'calendar.delete': ['eventId'] };
  if (!input || typeof input !== 'object' || !Object.prototype.hasOwnProperty.call(fields, input.type)) taskCalendarFail();
  const required = fields[input.type]!; const command = row(copy(input), ['type', ...required]);
  for (const key of required) if (key === 'completed' ? typeof command[key] !== 'boolean' : !text(command[key])) taskCalendarFail();
  if (typeof command.title === 'string') command.title = command.title.trim();
  const id = () => { const value = newId(); if (!isOfflineTaskCalendarId(value) || [...state.tasks, ...state.events, ...state.calendars].some(item => item.id === value)) taskCalendarFail(); return value; };
  const task = () => { const found = state.tasks.find(item => item.id === command.taskId); if (!found) taskCalendarFail('forbidden'); return found; };
  const calendar = () => { if (!state.calendars.some(item => item.id === command.calendarId)) taskCalendarFail('forbidden'); };
  const event = () => { const found = state.events.find(item => item.id === command.eventId); if (!found) taskCalendarFail('forbidden'); return found; };
  const times = () => { for (const key of ['start', 'end']) { const value = command[key]; if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) taskCalendarFail(); if (new Date(value.slice(0, 10) + "T00:00:00Z").toISOString().slice(0, 10) !== value.slice(0, 10)) taskCalendarFail(); command[key] = new Date(value).toISOString(); } if ((command.start as string) >= (command.end as string)) taskCalendarFail(); };
  switch (input.type) {
    case 'task.create': state.tasks.push({ id: id(), ownerId: owner, title: command.title as string, completed: false }); break;
    case 'task.update': { const found = task(); found.title = command.title as string; const linked = state.events.find(event => event.id === found.calendarEventId); if (linked) linked.title = found.title; break; }
    case 'task.complete': task().completed = command.completed as boolean; break;
    case 'task.delete': case 'task.unschedule': { const found = task(); state.events = state.events.filter(event => event.id !== found.calendarEventId); delete found.calendarEventId; delete found.scheduledSlot; if (input.type === 'task.delete') state.tasks = state.tasks.filter(item => item.id !== found.id); break; }
    case 'task.schedule': { times(); calendar(); const found = task(); let linked = state.events.find(event => event.id === found.calendarEventId); if (!linked) { linked = { id: id(), calendarId: command.calendarId as string, title: found.title, start: command.start as string, end: command.end as string, taskId: found.id }; state.events.push(linked); } Object.assign(linked, { calendarId: command.calendarId, start: command.start, end: command.end }); found.calendarEventId = linked.id; found.scheduledSlot = { start: linked.start, end: linked.end }; break; }
    case 'calendar.create': times(); calendar(); state.events.push({ id: id(), calendarId: command.calendarId as string, title: command.title as string, start: command.start as string, end: command.end as string }); break;
    case 'calendar.update': { times(); const found = event(); Object.assign(found, { title: command.title, start: command.start, end: command.end }); if (found.taskId) { const linked = state.tasks.find(task => task.id === found.taskId)!; linked.scheduledSlot = { start: found.start, end: found.end }; } break; }
    case 'calendar.delete': { const found = event(); if (found.taskId) { const linked = state.tasks.find(task => task.id === found.taskId)!; delete linked.calendarEventId; delete linked.scheduledSlot; } state.events = state.events.filter(event => event.id !== found.id); break; }
  }
  return validateTaskCalendarProjection(owner, state);
}
