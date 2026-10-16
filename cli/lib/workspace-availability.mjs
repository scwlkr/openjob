// Shared by the installed CLI and TypeScript app/domain via its typed facade.
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail('invalid_input', 'Use valid ISO timestamps with an explicit time zone.');
  if (new Date(value.slice(0, 10) + 'T00:00:00Z').toISOString().slice(0, 10) !== value.slice(0, 10)) fail('invalid_input', 'Invalid calendar date.');
  return Date.parse(value);
}
function windowTimes(start, end) {
  const from = instant(start), to = instant(end);
  if (to <= from || to - from > 7 * 86400000) fail('invalid_input', 'Choose a positive time window of at most seven days.');
  return [from, to];
}
function ownerEvents(view, taskId) {
  if (!view || !Array.isArray(view.tasks) || !Array.isArray(view.calendars) || !Array.isArray(view.events) || view.events.length > 10000) fail('invalid_input', 'A bounded complete workspace snapshot is required.');
  const task = view.tasks.find(item => item.id === taskId);
  if (!task || task.completed) fail('forbidden', 'Choose an available open Task.');
  const calendars = new Set(view.calendars.filter(item => item.ownerId === task.ownerId).map(item => item.id));
  if (!calendars.size) fail('forbidden', 'Saved calendars are unavailable.');
  const ownBlock = event => event.id === task.calendarEventId && event.taskId === task.id && event.start === task.scheduledSlot?.start && event.end === task.scheduledSlot?.end;
  return view.events.filter(event => calendars.has(event.calendarId) && !ownBlock(event)).map(event => {
    const start = instant(event.start), end = instant(event.end);
    if (end <= start) fail('invalid_input', 'Invalid saved time block.');
    return { start, end };
  });
}
export function assertTaskSlotAvailable(view, { taskId, start, end }) {
  const [from, to] = windowTimes(start, end);
  const events = ownerEvents(view, taskId);
  if (events.some(event => event.start < to && event.end > from)) fail('schedule_conflict', 'This time overlaps a saved Calendar block. Refresh and find another slot.');
}
export function findAvailableTaskSlots(view, { taskId, start, end, durationMinutes }) {
  const [from, to] = windowTimes(start, end);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 480) fail('invalid_input', 'Duration must be a whole number from 5 to 480 minutes.');
  const duration = durationMinutes * 60000;
  const events = ownerEvents(view, taskId).filter(event => event.start < to && event.end > from).sort((a, b) => a.start - b.start);
  const slots = []; let cursor = from;
  function gap(until) {
    while (slots.length < 12 && cursor + duration <= until) {
      slots.push({ start: new Date(cursor).toISOString(), end: new Date(cursor + duration).toISOString() }); cursor += duration;
    }
  }
  for (const event of events) { gap(Math.min(event.start, to)); cursor = Math.max(cursor, event.end); if (cursor >= to || slots.length === 12) break; }
  if (cursor < to) gap(to);
  return slots;
}
