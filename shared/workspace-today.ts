import type { WorkspaceView } from './workspace-contracts';

/** Presentation only: the caller supplies its already-authorized private view. */
export function personalToday(view: WorkspaceView, now: Date) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const overlaps = (slot: { start: string; end: string }) => Date.parse(slot.start) < end.getTime() && Date.parse(slot.end) > start.getTime();
  const open = view.tasks.filter(task => !task.completed);
  const calendars = new Set(view.calendars.map(calendar => calendar.id));
  return {
    start, end,
    planned: open.filter(task => task.scheduledSlot && overlaps(task.scheduledSlot)).sort((a, b) => a.scheduledSlot!.start.localeCompare(b.scheduledSlot!.start)),
    unplanned: open.filter(task => !task.scheduledSlot),
    events: view.events.filter(event => calendars.has(event.calendarId) && overlaps(event)).sort((a, b) => a.start.localeCompare(b.start)),
  };
}
