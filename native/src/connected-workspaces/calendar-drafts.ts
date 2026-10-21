import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProviderEditor, ProviderIntent } from '../../../shared/provider-planning-editor';
import type { PlanningDetachInput, PlanningDetachReceipt } from '../../../shared/remote-planning';
type Entries = { editors: Record<string, ProviderEditor>; intents: Record<string, ProviderIntent>; detaches: Record<string, PlanningDetachInput>; receipts: Record<string, PlanningDetachReceipt> };
export function useNativeCalendarDrafts() {
  const [taskId, selectTask] = useState(''), [entries, setEntries] = useState<Entries>({ editors: {}, intents: {}, detaches: {}, receipts: {} });
  const current = useRef(entries), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const put = useCallback(<K extends keyof Entries>(kind: K, task: string, value: Entries[K][string] | undefined) => {
    if (!alive.current) return;
    const rows = { ...current.current[kind] }; if (value === undefined) delete rows[task]; else Object.assign(rows, { [task]: value });
    current.current = { ...current.current, [kind]: rows }; setEntries(current.current);
  }, []);
  return { taskId, selectTask, ...entries, put, intent: (id: string) => current.current.intents[id], detach: (id: string) => current.current.detaches[id] };
}
export type NativeCalendarDrafts = ReturnType<typeof useNativeCalendarDrafts>;
