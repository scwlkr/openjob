'use client';
import { useCallback, useRef, useState } from 'react';
import type { MailTaskResult } from '../../shared/mail-task-source';
export type MailTaskTarget = { connectionId: string; workspaceId: string; messageId: string };
export type MailTaskDraft = MailTaskTarget & { title: string; phase: 'edited' | 'submitting' | 'uncertain' | 'confirmed'; additional?: { requestId: string; title: string }; receipt?: MailTaskResult; error?: string };
const taskTarget = ({ connectionId, workspaceId, messageId }: MailTaskTarget): MailTaskTarget => ({ connectionId, workspaceId, messageId });
export const mailTaskDraftKey = (target: MailTaskTarget) => `${target.connectionId}:${target.workspaceId}:${target.messageId}`;
export type ConnectedMailDrafts = { entries: Record<string, MailTaskDraft>; edit(target: MailTaskTarget, title: string): void; submit(target: MailTaskTarget, title: string, another?: boolean): Promise<void>; pendingFor(connectionId: string, workspaceId: string): boolean; forget(target: MailTaskTarget): void };
/** Owner-session memory only. Provider summaries, bodies and untouched subject defaults never enter this ledger. */
export function useConnectedMailDrafts(request: (path?: string, input?: object) => Promise<unknown>): ConnectedMailDrafts {
  const [entries, setEntries] = useState<Record<string, MailTaskDraft>>({});
  const current = useRef(entries);
  const put = useCallback((key: string, value: MailTaskDraft) => { current.current = { ...current.current, [key]: value }; setEntries(current.current); }, []);
  const edit = useCallback((input: MailTaskTarget, title: string) => {
    const target = taskTarget(input), key = mailTaskDraftKey(target), before = current.current[key];
    if (before?.phase === 'submitting' || before?.additional) return;
    put(key, { ...target, ...before, title, phase: before?.phase ?? 'edited' });
  }, [put]);
  const submit = useCallback(async (input: MailTaskTarget, title: string, another = false) => {
    const target = taskTarget(input), key = mailTaskDraftKey(target), before = current.current[key];
    if (before?.phase === 'submitting' || !title.trim()) return;
    const additional = before?.additional ?? (another ? { requestId: crypto.randomUUID(), title } : undefined);
    const intent: MailTaskDraft = { ...target, title: additional?.title ?? title, phase: 'submitting', ...(before?.receipt ? { receipt: before.receipt } : {}), ...(additional ? { additional } : {}) };
    put(key, intent);
    try {
      const result = await request(`/${target.connectionId}/tasks`, { messageId: target.messageId, title: intent.title, ...(additional ? { requestId: additional.requestId } : {}) }) as MailTaskResult;
      if (result.workspaceId !== target.workspaceId || typeof result.taskId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(result.taskId) || typeof result.created !== 'boolean') throw new Error();
      put(key, { ...target, title: intent.title, phase: 'confirmed', receipt: result });
    } catch (error) {
      const code = (error as { code?: string })?.code;
      put(key, { ...intent, phase: 'uncertain', error: code === 'message_unavailable' || code === 'source_unavailable' ? 'The source message is unavailable. A Task may already exist; check this Workspace. Retry keeps the same request.' : 'Task could not be confirmed. Your reviewed title and request are kept. Check Mail access, then retry the same request.' });
    }
  }, [put, request]);
  const pendingFor = useCallback((connectionId: string, workspaceId: string) => Object.values(current.current).some(row => row.connectionId === connectionId && row.workspaceId === workspaceId && (row.phase === 'submitting' || row.phase === 'uncertain')), []);
  const forget = useCallback((input: MailTaskTarget) => {
    const target = taskTarget(input), key = mailTaskDraftKey(target), row = current.current[key];
    if (!row || row.phase !== 'uncertain') return;
    put(key, { ...target, title: row.title, phase: row.receipt ? 'confirmed' : 'edited', ...(row.receipt ? { receipt: row.receipt } : {}) });
  }, [put]);
  return { entries, edit, submit, pendingFor, forget };
}
