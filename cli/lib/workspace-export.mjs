/** Versioned Personal data file. Explicit projection, never a Mail archive or restore format. */
export const WORKSPACE_EXPORT_MAX_BYTES = 1024 * 1024;
const sections = ['tasks', 'calendar', 'drafts'];
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
function fail(code = 'invalid_response') { throw Object.assign(new Error('The Personal export is invalid or exceeds its limits.'), { code }); }
function exact(value, required, optional = []) {
  if (!record(value) || required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => ![...required, ...optional].includes(key))) fail();
}
function text(value, max = 500, empty = false) {
  if (typeof value !== 'string' || (!empty && !value.trim()) || [...value].length > max) fail();
}
function id(value) { text(value, 128); if (!/^[A-Za-z0-9:_-]+$/.test(value)) fail(); }
function timestamp(value) { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail(); }
function interval(value) { exact(value, ['start', 'end']); timestamp(value.start); timestamp(value.end); if (value.start >= value.end) fail(); }
export function normalizeExportSections(value) {
  if (!Array.isArray(value) || !value.length || value.length > sections.length || new Set(value).size !== value.length || value.some(item => !sections.includes(item))) fail('invalid_input');
  return sections.filter(item => value.includes(item));
}
export function validateWorkspaceExport(value) {
  exact(value, ['format', 'version', 'exportedAt', 'context', 'sections', 'tasks', 'calendars', 'events', 'drafts']);
  if (value.format !== 'openjob-personal-export' || value.version !== 1) fail();
  timestamp(value.exportedAt); exact(value.context, ['kind', 'ownerUserId']);
  if (value.context.kind !== 'personal' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.context.ownerUserId)) fail();
  const selected = normalizeExportSections(value.sections);
  if (JSON.stringify(selected) !== JSON.stringify(value.sections)) fail();
  const owner = value.context.ownerUserId, ids = new Set();
  const unique = value => { id(value); if (ids.has(value)) fail(); ids.add(value); };
  for (const key of ['tasks', 'calendars', 'events', 'drafts']) {
    if (!Array.isArray(value[key]) || value[key].length > 1000) fail();
    if (!selected.includes(key === 'calendars' || key === 'events' ? 'calendar' : key) && value[key].length) fail();
  }
  for (const task of value.tasks) {
    exact(task, ['id', 'ownerId', 'title', 'completed'], ['notes', 'scheduledSlot', 'calendarEventId']);
    unique(task.id); if (task.ownerId !== owner || typeof task.completed !== 'boolean') fail(); text(task.title);
    if (task.notes !== undefined) text(task.notes, 20000, true);
    if (task.scheduledSlot !== undefined) interval(task.scheduledSlot);
    if (task.calendarEventId !== undefined) id(task.calendarEventId);
  }
  for (const calendar of value.calendars) {
    exact(calendar, ['id', 'ownerId', 'name', 'color']); unique(calendar.id); text(calendar.name);
    if (calendar.ownerId !== owner || !/^#[0-9a-f]{6}$/i.test(calendar.color)) fail();
  }
  for (const event of value.events) {
    exact(event, ['id', 'calendarId', 'title', 'start', 'end'], ['taskId']); unique(event.id); text(event.title);
    interval({ start: event.start, end: event.end });
    if (!value.calendars.some(calendar => calendar.id === event.calendarId)) fail();
    if (event.taskId !== undefined && !value.tasks.some(task => task.id === event.taskId && task.calendarEventId === event.id && task.scheduledSlot?.start === event.start && task.scheduledSlot.end === event.end)) fail();
  }
  for (const task of value.tasks) if (task.calendarEventId !== undefined && !value.events.some(event => event.id === task.calendarEventId && event.taskId === task.id)) fail();
  for (const draft of value.drafts) {
    exact(draft, ['id', 'accountId', 'body', 'status', 'mode'], ['to', 'subject']); unique(draft.id); id(draft.accountId); text(draft.body, 20000, true);
    if (draft.to !== undefined) text(draft.to);
    if (draft.subject !== undefined) text(draft.subject);
    if (draft.status !== 'draft' || draft.mode !== 'fixture') fail();
  }
  if (new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n').length > WORKSPACE_EXPORT_MAX_BYTES) fail('workspace_capacity');
  return value;
}
export function createWorkspaceExport(owner, view, selection, now = new Date()) {
  const selected = normalizeExportSections(selection);
  if (!record(view) || !/^[A-Za-z0-9_-]{1,128}$/.test(owner)) fail('invalid_state');
  const tasks = [], calendars = [], events = [], drafts = [];
  const includeTasks = selected.includes('tasks'), includeCalendar = selected.includes('calendar');
  // Authoritative Personal store supplies one validated owner snapshot. Fail closed on foreign data.
  if (includeTasks) for (const task of view.tasks) {
    if (task.ownerId !== owner) fail('forbidden');
    tasks.push({ id: task.id, ownerId: owner, title: task.title, completed: task.completed,
      ...(task.notes !== undefined ? { notes: task.notes } : {}),
      ...(task.scheduledSlot ? { scheduledSlot: { start: task.scheduledSlot.start, end: task.scheduledSlot.end } } : {}),
      ...(includeCalendar && task.calendarEventId ? { calendarEventId: task.calendarEventId } : {}) });
  }
  if (includeCalendar) {
    for (const calendar of view.calendars) {
      if (calendar.ownerId !== owner) fail('forbidden');
      calendars.push({ id: calendar.id, ownerId: owner, name: calendar.name, color: calendar.color });
    }
    for (const event of view.events) events.push({ id: event.id, calendarId: event.calendarId, title: event.title, start: event.start, end: event.end,
      ...(includeTasks && event.taskId ? { taskId: event.taskId } : {}) });
  }
  if (selected.includes('drafts')) for (const draft of view.drafts) {
    const account = view.accounts.find(account => account.id === draft.accountId);
    if (!account || account.ownerId !== owner || account.mode !== 'fixture') fail('forbidden');
    drafts.push({ id: draft.id, accountId: draft.accountId, body: draft.body, status: draft.status, mode: 'fixture',
      ...(draft.to !== undefined ? { to: draft.to } : {}), ...(draft.subject !== undefined ? { subject: draft.subject } : {}) });
  }
  return validateWorkspaceExport({ format: 'openjob-personal-export', version: 1, exportedAt: now.toISOString(), context: { kind: 'personal', ownerUserId: owner }, sections: selected, tasks, calendars, events, drafts });
}
