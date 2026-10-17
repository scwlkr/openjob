import { workspaceFail } from './owned-workspaces.ts';

/** Compare exact authored text inside the authoritative repository CAS callback. */
export function assertTaskNotesBase(tasks: readonly { id: string; notes?: string }[], input: unknown, expectedNotes: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) workspaceFail();
  const command = input as { type?: unknown; taskId?: unknown };
  if (command.type !== 'task.notes' || typeof command.taskId !== 'string' || typeof expectedNotes !== 'string' || [...expectedNotes].length > 20000) workspaceFail();
  const task = tasks.find(item => item.id === command.taskId);
  if (!task) workspaceFail('forbidden');
  if ((task.notes ?? '') !== expectedNotes) workspaceFail('conflict');
}
