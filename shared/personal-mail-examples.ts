import type { WorkspaceAccount, WorkspaceMessage, WorkspaceState } from './workspace-contracts.ts';

export const PERSONAL_MAIL_RESOURCES = Object.freeze(['mail:example-gmail-personal', 'mail:example-gmail-work', 'mail:example-outlook'] as const);
export const PERSONAL_MAIL_ACCOUNTS: readonly Omit<WorkspaceAccount, 'ownerId'>[] = Object.freeze([
  { id: PERSONAL_MAIL_RESOURCES[0], provider: 'gmail', label: 'Personal Gmail example', address: 'alex.personal@example.invalid', mode: 'fixture' },
  { id: PERSONAL_MAIL_RESOURCES[1], provider: 'gmail', label: 'Work Gmail example', address: 'alex.work@example.invalid', mode: 'fixture' },
  { id: PERSONAL_MAIL_RESOURCES[2], provider: 'outlook', label: 'Outlook example', address: 'alex.outlook@example.invalid', mode: 'fixture' },
].map(account => Object.freeze(account)) as Omit<WorkspaceAccount, 'ownerId'>[]);
const subjects = ['Launch checklist for Friday', 'Weekend trail plan', 'Design review notes', 'Quarterly planning agenda', 'Community garden rota', 'Workshop materials'];
const bodies = ['Please review the invented launch checklist before Friday. The accessibility pass is ready.', 'Shall we meet at the imaginary trailhead on Saturday morning?', 'Here are the fictional review notes. Please confirm the revised navigation.', 'Please prepare three priorities for our example planning session.', 'Can you take the fictional watering slot next Tuesday?', 'The invented workshop handouts are ready for your review.'];
export const PERSONAL_MAIL_MESSAGES: readonly WorkspaceMessage[] = Object.freeze(subjects.map((subject, index) => Object.freeze({
  id: `example-message-${index + 1}`, accountId: PERSONAL_MAIL_RESOURCES[Math.floor(index / 2)], subject,
  from: `colleague${index + 1}@example.invalid`, to: PERSONAL_MAIL_ACCOUNTS[Math.floor(index / 2)].address,
  body: bodies[index], receivedAt: `2026-10-${String(17 - index).padStart(2, '0')}T09:00:00.000Z`, read: false,
})));
export type PersonalMailExamplesResult = { mode: 'fixture'; added: boolean; accountIds: string[]; messageIds: string[] };
export function addPersonalMailExamples(ownerId: string, state: WorkspaceState): PersonalMailExamplesResult {
  const added = state.accounts.length === 0;
  if (added) { state.accounts = PERSONAL_MAIL_ACCOUNTS.map(account => ({ ...account, ownerId })); state.messages = PERSONAL_MAIL_MESSAGES.map(message => ({ ...message })); }
  return { mode: 'fixture', added, accountIds: PERSONAL_MAIL_ACCOUNTS.map(account => account.id), messageIds: PERSONAL_MAIL_MESSAGES.map(message => message.id) };
}
