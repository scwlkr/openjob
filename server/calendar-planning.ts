import type { CalendarPlanningRepository } from '../db/calendar-planning.ts';
import { calendarFail, remoteCalendarId, remoteCalendarEventRef } from '../shared/provider-calendar.ts';
import { managedCalendarEventId, validateFrozenCalendarMutation, type FrozenCalendarMutation } from '../shared/calendar-mutation.ts';
import { calendarPlanIdentity, calendarPlanInput, calendarOperationReceipt, type CalendarOperationView, type CalendarOperationReceipt } from '../shared/remote-planning.ts';
import { createGoogleCalendarAdapter, type CalendarBinding } from './providers/google-calendar-adapter.ts';
import { createDurableOperationRunner } from './durable-operations.ts';
import { operationHash } from '../shared/reply-operation.ts';

type Adapter = ReturnType<typeof createGoogleCalendarAdapter>;
/** Only the invented Calendar fixture composes this service. No real consent/storage path. */
export function createFixtureCalendarPlanning({ repository, adapter, binding, currentAuthority, timeoutMs = 5000, now = Date.now }: {
  repository: CalendarPlanningRepository; adapter: Adapter;
  binding(owner: string, workspace: string, account: string): Promise<CalendarBinding>;
  currentAuthority(payload: FrozenCalendarMutation): Promise<void>; timeoutMs?: number; now?: () => number;
}) {
  const run = createDurableOperationRunner<FrozenCalendarMutation, CalendarOperationView, CalendarOperationReceipt>({ repository, current: currentAuthority, dispatch: (payload, signal, beforeEffect) => adapter.execute(payload, signal, beforeEffect), timeoutMs,
    settle(result) {
      if (result && typeof result === 'object' && 'kind' in result) {
        if (result.kind === 'confirmed') {
          if ('deleted' in result && result.deleted === true && Object.keys(result).sort().join(',') === 'deleted,kind') return { state: 'confirmed', outcome: 'provider_accepted', receipt: { deleted: true } };
          if ('event' in result && result.event && typeof result.event === 'object') {
            const event = result.event as { id: string; etag: string; title: string; span: unknown };
            return { state: 'confirmed', outcome: 'provider_accepted', receipt: calendarOperationReceipt({ block: { eventId: event.id, etag: event.etag, title: event.title, span: event.span } }) };
          }
        }
        if (result.kind === 'rejected' && 'reason' in result && ['conflict', 'authority', 'unsupported', 'provider'].includes(String(result.reason))) return { state: 'rejected', outcome: result.reason === 'conflict' ? 'provider_conflict' : result.reason === 'unsupported' ? 'unsupported_event' : result.reason === 'authority' ? 'authority_changed' : 'provider_rejected' };
      }
      return { state: 'unknown', outcome: 'dispatch_unknown' };
    },
  });
  async function read<T extends { expiresAt: string }>(owner: string, workspace: string, signal: AbortSignal, action: () => Promise<T>) {
    await repository.assertOwned(owner, workspace); const value = await action(); await repository.assertOwned(owner, workspace);
    if (signal.aborted) calendarFail('calendar_unavailable'); if (Date.parse(value.expiresAt) <= now()) calendarFail('observation_expired'); return value;
  }
  return {
    get: repository.get.bind(repository), list: repository.list.bind(repository), planning: repository.planning.bind(repository), run,
    calendars: (input: Parameters<Adapter['list']>[0], signal: AbortSignal) => read(input.ownerId, input.workspaceId, signal, () => adapter.list(input, signal)),
    events: (input: Parameters<Adapter['events']>[0], signal: AbortSignal) => read(input.ownerId, input.workspaceId, signal, () => adapter.events(input, signal)),
    availability: (input: Parameters<Adapter['availability']>[0], signal: AbortSignal) => read(input.ownerId, input.workspaceId, signal, () => adapter.availability(input, signal)),
    async enqueue(owner: string, workspace: string, raw: unknown) {
      const input = calendarPlanInput(raw), existing = await repository.existing(owner, workspace, input); if (existing) return existing;
      let payload: FrozenCalendarMutation;
      if (input.action === 'calendar.create') {
        const selected = await binding(owner, workspace, input.accountId), origin = { operationId: (await calendarPlanIdentity(owner, workspace, input)).id, marker: await operationHash([owner, workspace, input, selected.connectionId, selected.revision]) };
        if (selected.ownerId !== owner || selected.workspaceId !== workspace || selected.accountId !== input.accountId || !selected.calendarIds.includes(remoteCalendarId(input.calendarId, input.accountId))) calendarFail('forbidden');
        payload = validateFrozenCalendarMutation({ version: 1, ownerId: owner, workspaceId: workspace, taskId: input.taskId, accountId: selected.accountId, connectionId: selected.connectionId, subject: selected.subject, bindingRevision: selected.revision, calendarId: input.calendarId, upstreamEventId: await managedCalendarEventId(owner, workspace, input.taskId, origin), origin, action: input.action, title: input.title, span: input.span });
      } else {
        const link = await repository.selectedLink(owner, workspace, input.taskId);
        if (!link || link.state !== 'linked' || !link.confirmed || link.confirmed.etag !== input.etag) calendarFail('review_required');
        const { action: _, title: __, span: ___, etag: ____, ...identity } = link.payload as FrozenCalendarMutation & { title?: string; span?: unknown; etag?: string }; void _; void __; void ___; void ____;
        payload = validateFrozenCalendarMutation({ ...identity, action: input.action, etag: input.etag, ...(input.action === 'calendar.update' ? { title: input.title, span: input.span } : {}) });
      }
      await currentAuthority(payload);
      return repository.enqueue(owner, workspace, input, payload, () => currentAuthority(payload));
    },
    async review(owner: string, workspace: string, task: string, signal: AbortSignal) {
      const link = await repository.selectedLink(owner, workspace, task); if (!link) calendarFail('not_found');
      const operation = await repository.get(owner, workspace, link.operationId); if (['queued', 'executing'].includes(operation.state)) calendarFail('conflict');
      await currentAuthority(link.payload); const observed = await adapter.inspect(link.payload, signal);
      const receipt = 'deleted' in observed ? { deleted: true as const } : calendarOperationReceipt({ block: { eventId: remoteCalendarEventRef(link.payload.calendarId, link.payload.upstreamEventId), etag: observed.event.etag, title: observed.event.title, span: observed.event.span } });
      // Persist a current read as the link's reviewed truth; the original operation stays immutable.
      return repository.review(owner, workspace, task, link.operationId, receipt, () => currentAuthority(link.payload));
    },
  };
}
export type FixtureCalendarPlanning = ReturnType<typeof createFixtureCalendarPlanning>;
