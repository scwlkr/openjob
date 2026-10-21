import { useCallback, useEffect, useRef, useState } from 'react';
import { randomUUID } from 'expo-crypto';
import type { MailTaskInput, NativeConnectedWorkspaceController } from '../connected-workspaces-contracts';
import type { MailTaskResult } from '../../../shared/mail-task-source';

export type NativeMailIntent = { connectionId: string; messageId: string; title: string; phase: 'edited' | 'submitting' | 'uncertain' | 'confirmed'; input?: MailTaskInput; receipt?: MailTaskResult; receiptTitle?: string };
export const nativeMailIntentKey = (connection: string, message: string) => `${connection}:${message}`;
/** Only authored work enters this Workspace/session ledger. No provider summaries or bodies. */
export function useNativeMailIntents(controller: NativeConnectedWorkspaceController, owner: string, workspaceId: string, onAccessEnded: (error: unknown) => void) {
  const [entries, setEntries] = useState<Record<string, NativeMailIntent>>({});
  const current = useRef(entries), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const put = useCallback((key: string, intent: NativeMailIntent) => { if (alive.current) { current.current = { ...current.current, [key]: intent }; setEntries(current.current); } }, []);
  const edit = useCallback((connectionId: string, messageId: string, title: string) => {
    const key = nativeMailIntentKey(connectionId, messageId), before = current.current[key];
    if (before?.phase === 'submitting' || before?.phase === 'uncertain') return;
    put(key, { ...before, connectionId, messageId, title, phase: before?.phase ?? 'edited' });
  }, [put]);
  const submit = useCallback(async (connectionId: string, messageId: string, title: string, another = false) => {
    const key = nativeMailIntentKey(connectionId, messageId), before = current.current[key];
    if (before?.phase === 'submitting' || !title.trim() || before?.phase === 'confirmed' && !another) return;
    const input = before?.phase === 'uncertain' ? before.input! : { messageId, title, ...(another ? { requestId: randomUUID() } : {}) };
    const intent: NativeMailIntent = { connectionId, messageId, title: input.title, input, phase: 'submitting', ...(before?.receipt ? { receipt: before.receipt, receiptTitle: before.receiptTitle ?? before.title } : {}) };
    put(key, intent);
    try {
      const receipt = await controller.createMailTask(owner, workspaceId, connectionId, { ...input });
      if (receipt.workspaceId !== workspaceId || !/^[A-Za-z0-9_-]{1,128}$/.test(receipt.taskId) || typeof receipt.created !== 'boolean') throw new Error('Invalid Task receipt.');
      put(key, { connectionId, messageId, title: input.title, phase: 'confirmed', receipt, receiptTitle: input.title });
    } catch (error) { put(key, { ...intent, phase: 'uncertain' }); if (alive.current) onAccessEnded(error); }
  }, [controller, owner, workspaceId, onAccessEnded, put]);
  const pendingFor = useCallback((connectionId: string) => Object.values(current.current).some(row => row.connectionId === connectionId && ['submitting', 'uncertain'].includes(row.phase)), []);
  const forget = useCallback((connectionId: string, messageId: string) => {
    const key = nativeMailIntentKey(connectionId, messageId), before = current.current[key];
    if (before?.phase !== 'uncertain') return;
    const { input, ...retained } = before; void input;
    put(key, { ...retained, phase: before.receipt ? 'confirmed' : 'edited' });
  }, [put]);
  return { entries, edit, submit, pendingFor, forget };
}
export type NativeMailIntents = ReturnType<typeof useNativeMailIntents>;
