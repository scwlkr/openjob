import { useCallback, useRef, useState } from 'react';
import type { CalendarOperationView, CalendarPlanInput, PlanningDetachInput, PlanningDetachReceipt, RemotePlanningLink } from '../../shared/remote-planning';
import type { WorkspaceTask } from '../../shared/workspace-contracts';
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
type Entries = { editors: Record<string, ProviderEditor>; intents: Record<string, ProviderIntent>; detaches: Record<string, PlanningDetachInput>; receipts: Record<string, PlanningDetachReceipt> };
/** Authored fields and immutable requests outlive the disposable provider reader. */
export function useProviderPlanningDrafts() {
  const [taskId, selectTask] = useState(''), [entries, setEntries] = useState<Entries>({ editors: {}, intents: {}, detaches: {}, receipts: {} });
  const current = useRef(entries);
  const put = useCallback(<K extends keyof Entries>(kind: K, task: string, value: Entries[K][string] | undefined) => {
    const rows = { ...current.current[kind] }; if (value === undefined) delete rows[task]; else Object.assign(rows, { [task]: value });
    current.current = { ...current.current, [kind]: rows }; setEntries(current.current);
  }, []);
  return { taskId, selectTask, ...entries, put, intent: (id: string) => current.current.intents[id] };
}
export type ProviderPlanningDrafts = ReturnType<typeof useProviderPlanningDrafts>;
