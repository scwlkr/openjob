import { replyOperationFixture } from './reply-operations.mjs';
import { createFixtureGoogleCalendar } from './google-calendar-transport.mjs';
import { createCalendarPlanningRepository } from '../../db/calendar-planning.ts';
import { createFixtureCalendarPlanning } from '../../server/calendar-planning.ts';
export const calendarPlanningSpan = { start: { kind: 'timed', at: '2026-11-01T06:30:00.000Z', timeZone: 'America/Chicago' }, end: { kind: 'timed', at: '2026-11-01T07:30:00.000Z', timeZone: 'America/Chicago' } };
export async function calendarPlanningFixture(options = {}) {
  const f = await replyOperationFixture(); let time = Date.now(), allowed = true, state;
  const row = f.envelopes.get(f.owner)[0], binding = { ownerId: f.owner, workspaceId: f.home, accountId: row.accountId, connectionId: row.id, subject: row.subject, revision: row.attemptId, calendarIds: ['planning@example.invalid'] };
  const repo = (transport = f.db.fetch) => createCalendarPlanningRepository(f.config, transport, { now: () => time });
  const protocol = () => createFixtureGoogleCalendar({ binding, state, persist: async value => { state = value; }, active: async () => allowed && f.envelopes.get(f.owner)[0]?.status === 'connected', now: () => time, ...options });
  let provider = protocol(); const service = (repository = repo(), extra = {}) => createFixtureCalendarPlanning({ repository, ...provider, now: () => time, ...extra });
  const input = { action: 'calendar.create', taskId: f.task.taskId, requestId: crypto.randomUUID(), accountId: binding.accountId, calendarId: binding.accountId + ':calendar:' + encodeURIComponent(binding.calendarIds[0]), title: 'Finish the review', span: calendarPlanningSpan };
  return { ...f, binding, repo, service, input, state: () => state, provider: () => provider, editProvider(apply) { state = provider.state(); apply(state); provider = protocol(); }, restart() { const saved = f.db.exportState(); f.db.restoreState(saved); provider = protocol(); }, advance(ms) { time += ms; }, revoke() { allowed = false; } };
}
