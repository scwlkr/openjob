import type { CalendarOperationView, CalendarPlanInput, RemotePlanningLink } from './remote-planning';
import type { WorkspaceTask } from './workspace-contracts';
export type ProviderEditor = { title: string; start: string; end: string; baseEtag: string | null; dirty: boolean };
export type ProviderIntent = { input: CalendarPlanInput; calendarId: string; eventId?: string; operation?: CalendarOperationView; rejected?: boolean; reviewedRemoval?: string };
export function canStartProviderIntent(intent: ProviderIntent | undefined, link?: RemotePlanningLink) {
  return !!intent && (intent.rejected || !!intent.operation && ['confirmed', 'rejected'].includes(intent.operation.state) || intent.operation?.state === 'unknown' && (link?.state === 'linked' && link.operationId === intent.operation.id || intent.reviewedRemoval === intent.operation.id));
}
const day = () => new Date().toISOString().slice(0, 10);
export const providerUtc = (value: string) => new Date(value + 'Z').toISOString();
export function initialProviderEditor(task: WorkspaceTask, link?: RemotePlanningLink): ProviderEditor {
  const block = link?.confirmed;
  return { title: block?.title ?? task.title, start: block?.span.start.kind === 'timed' ? block.span.start.at.slice(0, -1) : day() + 'T14:00', end: block?.span.end.kind === 'timed' ? block.span.end.at.slice(0, -1) : day() + 'T14:30', baseEtag: block?.etag ?? null, dirty: false };
}
