import { useCallback, useRef, useState } from 'react';
import type { PlanningDetachInput, PlanningDetachReceipt } from '../../shared/remote-planning';
import { type ProviderEditor, type ProviderIntent } from '../../shared/provider-planning-editor.ts';
export { canStartProviderIntent, providerUtc, initialProviderEditor } from '../../shared/provider-planning-editor.ts';
export type { ProviderEditor, ProviderIntent } from '../../shared/provider-planning-editor.ts';
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
