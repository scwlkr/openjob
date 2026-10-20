import type { OwnedWorkspaceStore } from '../db/owned-workspaces.ts';
import type { PersonalWorkspaceContextStore } from '../db/personal-workspace-context.ts';
import type { PersonalWorkspaceStore } from '../shared/personal-workspace.ts';
import { projectTaskCalendar, applyTaskCalendarCommand, type TaskCalendarCommand } from '../shared/task-calendar-sync.ts';
import { validateOwnedSnapshot, workspaceFail, type OwnedWorkspace } from '../shared/owned-workspaces.ts';
import type { MailTaskReference } from '../shared/mail-task-source.ts';

// D06 is still Proposed. Existing Google/Apple bindings carry no adopted independent-control evidence.
export const workspaceIdentityEligibility = () => ({ state: 'policy_pending' as const, realOnboardingEnabled: false as const, reason: 'independent_anchor_policy_not_adopted' as const });

/** Context adapter only: existing Personal store stays authoritative for retained work. */
export function createWorkspaceContextStore({ owned, personal, contexts }: { owned: OwnedWorkspaceStore; personal: PersonalWorkspaceStore; contexts: PersonalWorkspaceContextStore }) {
  async function snapshot(owner: string, workspace: OwnedWorkspace) {
    const work = projectTaskCalendar(owner, await personal.snapshot(owner));
    // Current Personal domain has one canonical calendar. Unknown retained shapes fail without data changes.
    if (work.calendars.length !== 1 || work.calendars[0].id !== 'personal') workspaceFail('invalid_state');
    return validateOwnedSnapshot({ workspace, work: { ...work, calendars: work.calendars.map(calendar => ({ ...calendar, id: workspace.calendarId })), events: work.events.map(event => ({ ...event, calendarId: event.calendarId === 'personal' ? workspace.calendarId : event.calendarId })) } });
  }
  return {
    async list(owner: string) { const items = await owned.list(owner); const context = await contexts.find(owner); return context ? [context, ...items] : items; },
    create: owned.create,
    async createMailTask(owner: string, title: string, source: MailTaskReference, current: () => Promise<void>) {
      const context = await contexts.find(owner);
      if (context?.workspaceId !== source.workspaceId) return owned.createMailTask(owner, title, source, current);
      if (!personal.createMailTask) workspaceFail('unavailable');
      return personal.createMailTask(owner, title, source, current);
    },
    async mailTaskSource(owner: string, workspaceId: string, taskId: string) {
      const context = await contexts.find(owner);
      if (context?.workspaceId !== workspaceId) return owned.mailTaskSource(owner, workspaceId, taskId);
      if (!personal.mailTaskSource) workspaceFail('unavailable');
      return personal.mailTaskSource(owner, workspaceId, taskId);
    },
    async personalContext(owner: string) {
      // Validate/read current shape before creating the reference; no data/grant/sign-in mutation.
      const work = projectTaskCalendar(owner, await personal.snapshot(owner));
      if (work.calendars.length !== 1 || work.calendars[0].id !== 'personal') workspaceFail('invalid_state');
      return snapshot(owner, await contexts.ensure(owner));
    },
    async snapshot(owner: string, id: string) { const context = await contexts.find(owner); return context?.workspaceId === id ? snapshot(owner, context) : owned.snapshot(owner, id); },
    async saveTaskNotes(owner: string, id: string, input: unknown, expectedNotes: unknown) {
      const context = await contexts.find(owner);
      if (context?.workspaceId !== id) return owned.saveTaskNotes(owner, id, input, expectedNotes);
      if (!personal.saveTaskNotes) workspaceFail('unavailable');
      const current = await snapshot(owner, context);
      applyTaskCalendarCommand(current.work, input as TaskCalendarCommand, owner, () => `offline_${crypto.randomUUID()}`);
      await personal.saveTaskNotes(owner, input, expectedNotes);
      return snapshot(owner, context);
    },
    async command(owner: string, id: string, input: unknown) {
      const context = await contexts.find(owner); if (context?.workspaceId !== id) return owned.command(owner, id, input);
      const current = await snapshot(owner, context);
      const available = !!input && typeof input === 'object' && (input as { type?: string }).type === 'task.schedule-available';
      const normalized = available ? { ...input as object, type: 'task.schedule' } : input;
      // Same bounded Task/Calendar command parser: rejects Mail, source refs, grants and foreign IDs.
      applyTaskCalendarCommand(current.work, normalized as TaskCalendarCommand, owner, () => `offline_${crypto.randomUUID()}`);
      const command = { ...input as TaskCalendarCommand };
      if ('calendarId' in command) { if (command.calendarId !== context.calendarId) workspaceFail('forbidden'); command.calendarId = 'personal'; }
      await personal.command(owner, command);
      return snapshot(owner, context);
    },
  };
}
