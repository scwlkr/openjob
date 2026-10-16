import type { WorkspaceView } from "../../shared/workspace-contracts";

export type CalendarTaskSource = { taskId: string; eventId: string; calendarId: string };

/** Resolve only the complete relationship present in the caller's scoped view. */
export function linkedTask(view: WorkspaceView, source: CalendarTaskSource) {
  const event = view.events.find(item => item.id === source.eventId && item.calendarId === source.calendarId && item.taskId === source.taskId);
  const task = view.tasks.find(item => item.id === source.taskId && item.calendarEventId === source.eventId);
  const calendar = view.calendars.find(item => item.id === source.calendarId);
  return event && task && calendar?.ownerId === task.ownerId && task.scheduledSlot?.start === event.start && task.scheduledSlot.end === event.end ? task : undefined;
}
