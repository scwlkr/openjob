import { randomUUID } from 'expo-crypto';
import { useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { addNetworkStateListener, type NetworkState } from 'expo-network';
import { ProviderCalendar } from '../src/connected-workspaces/ProviderCalendar';
import { useNativeCalendarDrafts } from '../src/connected-workspaces/calendar-drafts';
import { Action } from '../src/personal-workspace/controls';
import { OpenJobThemeProvider } from '../src/theme';
import type { NativeConnectedWorkspaceController } from '../src/connected-workspaces-contracts';
import type { WorkspaceView } from '../src/personal-workspace-contracts';
import type { CalendarPlanInput, CalendarOperationView, RemotePlanningLink, PlanningDetachReceipt } from '../../shared/remote-planning';
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => '11111111-1111-4111-8111-111111111111') }));
const owner = `user_${'a'.repeat(32)}`, workspace = `wsp_${'b'.repeat(32)}`, account = 'fixture_calendar', calendar = `${account}:calendar:alex%40example.invalid`, event = `${calendar}:event:oj${'d'.repeat(64)}`;
function fixture() {
  let links: RemotePlanningLink[] = [], operations: CalendarOperationView[] = [], savedInput: CalendarPlanInput | undefined, effects = 0, detachReceipt: PlanningDetachReceipt | undefined;
  let loseQueue = false, loseDetach = false;
  const observation = () => ({ observedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() });
  const remoteCalendar = { id: calendar, accountId: account, upstreamId: 'alex@example.invalid', name: 'Work Calendar', timeZone: 'America/Chicago', access: 'owner' as const };
  const methods: Pick<NativeConnectedWorkspaceController, 'calendarAccounts' | 'calendars' | 'calendarEvents' | 'calendarAvailability' | 'planning' | 'calendarHistory' | 'queueCalendar' | 'runCalendar' | 'readCalendarOperation' | 'reviewCalendar' | 'calendarReviewReceipt' | 'detachCalendar' | 'calendarDetachReceipt'> = {
    calendarAccounts: jest.fn(async () => [{ accountId: account, connectionId: 'fixture', label: 'Alex Calendar', available: true }]),
    calendars: jest.fn(async () => ({ calendars: [remoteCalendar], nextCursor: null, ...observation() })),
    calendarEvents: jest.fn(async () => ({ calendar: remoteCalendar, events: [], nextCursor: null, ...observation() })),
    calendarAvailability: jest.fn(async (_owner, _workspace, _account, _calendar, window) => ({ calendarId: calendar, ...window, busy: [], ...observation() })),
    planning: jest.fn(async () => structuredClone(links)),
    calendarHistory: jest.fn(async () => ({ items: structuredClone(operations), nextCursor: null })),
    queueCalendar: jest.fn(async (_owner, _workspace, input) => {
      const existing = operations.find(row => row.requestId === input.requestId && row.action === input.action); if (existing) return structuredClone(existing);
      savedInput = structuredClone(input); const now = new Date().toISOString();
      const operation: CalendarOperationView = { id: `cop_${String(operations.length + 1).repeat(64)}`, workspaceId: workspace, taskId: input.taskId, action: input.action, requestId: input.requestId, calendarId: calendar, eventId: event, state: 'queued', mode: 'fixture', receiptExpired: false, createdAt: now, updatedAt: now, dispatchBefore: new Date(Date.now() + 900000).toISOString(), receiptExpiresAt: new Date(Date.now() + 604800000).toISOString(), receipt: null };
      operations = [operation, ...operations]; links = [{ targetKind: 'provider', taskId: input.taskId, calendarId: calendar, eventId: event, operationId: operation.id, state: 'reserved', confirmed: links[0]?.confirmed ?? null }];
      if (loseQueue) { loseQueue = false; throw new Error('Lost queue acknowledgement'); } return structuredClone(operation);
    }),
    runCalendar: jest.fn(async (_owner, _workspace, id) => {
      const op = operations.find(row => row.id === id)!; effects++; op.state = 'confirmed'; op.outcome = 'provider_accepted'; op.receipt = savedInput?.action === 'calendar.delete' ? { deleted: true } : { eventId: event, etag: `"v${effects}"` };
      if (savedInput?.action === 'calendar.delete') links = [];
      else if (savedInput && links[0]) links[0] = { ...links[0], state: 'linked', confirmed: { eventId: event, etag: `"v${effects}"`, title: savedInput.title, span: savedInput.span } };
      return structuredClone(op);
    }),
    readCalendarOperation: jest.fn(async (_owner, _workspace, id) => structuredClone(operations.find(row => row.id === id)!)),
    reviewCalendar: jest.fn(async () => structuredClone(links)),
    calendarReviewReceipt: jest.fn(async (_owner, _workspace, task, operation, eventId) => ({ taskId: task, operationId: operation, eventId, reviewedAt: new Date().toISOString(), relationship: 'removed' as const })),
    detachCalendar: jest.fn(async (_owner, _workspace, task, input) => { detachReceipt = { taskId: task, operationId: input.operationId, eventId: input.eventId, etag: input.etag, detachedAt: new Date().toISOString(), detached: true, providerEventLeft: true }; links = []; if (loseDetach) { loseDetach = false; throw new Error('Lost detach acknowledgement'); } return detachReceipt; }),
    calendarDetachReceipt: jest.fn(async () => structuredClone(detachReceipt!)),
  };
  return { controller: methods as NativeConnectedWorkspaceController, loseQueue() { loseQueue = true; }, loseDetach() { loseDetach = true; }, get effects() { return effects; }, get input() { return savedInput; }, get links() { return links; } };
}
const view = { tasks: [{ id: 'task', ownerId: owner, title: 'Reviewed Mail Task', completed: false }], calendars: [], events: [], accounts: [], messages: [], drafts: [], sent: [], agents: [], activity: [] } as WorkspaceView;
function Harness({ controller }: { controller: NativeConnectedWorkspaceController }) {
  const drafts = useNativeCalendarDrafts(), [links, setLinks] = useState<RemotePlanningLink[]>(), [visible, setVisible] = useState(true);
  return <OpenJobThemeProvider preference="light" setPreference={() => undefined}><Action label="Switch module" onPress={() => setVisible(v => !v)} />{visible && <ProviderCalendar controller={controller} owner={owner} workspaceId={workspace} view={view} links={links} drafts={drafts} onPlanning={setLinks} onAccessEnded={() => undefined} onTask={() => setVisible(false)} />}</OpenJobThemeProvider>;
}
async function press(name: string) { await fireEvent.press(await screen.findByRole('button', { name })); }
async function open(f: ReturnType<typeof fixture>) { AppState.currentState = 'active'; const root = await render(<Harness controller={f.controller} />); await screen.findByRole('button', { name: 'Provider Calendar Work Calendar' }); await press('Plan Task Reviewed Mail Task'); await screen.findByLabelText('Provider block start UTC'); return root; }

test('native provider plan keeps precise fields through navigation, queues without effects, runs explicitly and recovers detach', async () => {
  const f = fixture(); await open(f);
  await fireEvent.changeText(screen.getByLabelText('Provider block start UTC'), '2026-10-21T14:00:12.345'); await fireEvent.changeText(screen.getByLabelText('Provider block end UTC'), '2026-10-21T14:30:45.678');
  await press('Switch module'); await press('Switch module'); await screen.findByRole('button', { name: 'Provider Calendar Work Calendar' });
  expect(screen.getByLabelText('Provider block start UTC')).toHaveDisplayValue('2026-10-21T14:00:12.345');
  await press('Queue provider plan'); await screen.findByText(/Intent accepted/); expect(f.effects).toBe(0); expect(f.input).toMatchObject({ span: { start: { at: '2026-10-21T14:00:12.345Z' }, end: { at: '2026-10-21T14:30:45.678Z' } } });
  await press('Run Calendar fixture operation'); await screen.findByText('Calendar simulation confirmed. No real provider changed.'); expect(f.effects).toBe(1);
  f.loseDetach(); await press('Detach Task; leave provider event'); await press('Confirm detach leaving provider event'); await screen.findByText('Detachment acknowledgement unverified.');
  await press('Switch module'); await press('Switch module'); await screen.findByRole('button', { name: 'Provider Calendar Work Calendar' });
  await press('Inspect Calendar detach receipt'); await screen.findByText('Saved detach receipt confirmed. Provider event left untouched.'); expect(f.effects).toBe(1); expect(f.links).toHaveLength(0);
});
test('lost queue acknowledgement retains its UUID and exact input despite editing and module switches', async () => {
  const f = fixture(); await open(f); f.loseQueue(); await press('Queue provider plan'); await screen.findByText(/Acknowledgement unverified/);
  const original = structuredClone(f.input); await fireEvent.changeText(screen.getByLabelText('Provider block start UTC'), '2026-10-21T18:00');
  // Make history temporarily unavailable to exercise the explicit exact retry path.
  jest.spyOn(f.controller, 'calendarHistory').mockRejectedValue(new Error('History offline'));
  await press('Switch module'); await press('Switch module'); await screen.findByRole('button', { name: 'Provider Calendar Work Calendar' });
  await press('Retry exact reviewed Calendar intent'); await waitFor(() => expect(f.controller.queueCalendar).toHaveBeenCalledTimes(2));
  expect(jest.mocked(f.controller.queueCalendar).mock.calls[1]?.[2]).toEqual(original); expect(f.effects).toBe(0);
  expect(screen.queryByRole('button', { name: 'Retry exact reviewed Calendar intent' })).toBeNull(); expect(await screen.findByText(/Operation queued/)).toBeTruthy();
});
test('background aborts late observations, hides availability and preserves authored fields without replay', async () => {
  const f = fixture(), listeners = new Set<(state: AppStateStatus) => void>();
  const originalLifecycle = jest.mocked(AppState.addEventListener).getMockImplementation?.();
  const lifecycle = jest.spyOn(AppState, 'addEventListener').mockImplementation((_name, listener) => { listeners.add(listener); return { remove: () => listeners.delete(listener) }; });
  try {
    await open(f); await fireEvent.changeText(screen.getByLabelText('Provider block start UTC'), '2026-10-21T14:00:12.345');
    let release!: (value: Awaited<ReturnType<typeof f.controller.calendarAvailability>>) => void; let signal: AbortSignal | undefined;
    jest.spyOn(f.controller, 'calendarAvailability').mockImplementationOnce((_owner, _workspace, _account, _calendar, _window, abort) => { signal = abort; return new Promise(resolve => { release = resolve; }); });
    await press('Check provider Calendar'); await act(async () => { AppState.currentState = 'background'; listeners.forEach(fn => fn('background')); }); expect(signal?.aborted).toBe(true);
    await act(async () => { release({ calendarId: calendar, start: '2026-10-21T00:00:00.000Z', end: '2026-10-22T00:00:00.000Z', busy: [], observedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() }); });
    expect(screen.queryByText(/No busy intervals reported/)).toBeNull(); expect(screen.getByLabelText('Provider block start UTC')).toHaveDisplayValue('2026-10-21T14:00:12.345');
    await act(async () => { AppState.currentState = 'active'; listeners.forEach(fn => fn('active')); });
    expect(f.controller.queueCalendar).not.toHaveBeenCalled(); expect(f.controller.runCalendar).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Queue provider plan' })).toBeDisabled();
    await press('Refresh provider status'); await screen.findByRole('button', { name: 'Provider Calendar Work Calendar' });
  } finally { lifecycle.mockRestore(); if (originalLifecycle) jest.mocked(AppState.addEventListener).mockImplementation(originalLifecycle); }
});
test('offline transition clears provider observations and returning online does not execute an intent', async () => {
  const listeners = new Set<(state: NetworkState) => void>();
  jest.mocked(addNetworkStateListener).mockImplementation(listener => { listeners.add(listener); return { remove: () => listeners.delete(listener) }; });
  const f = fixture(); try {
    await open(f); await press('Queue provider plan'); await screen.findByText(/Intent accepted/);
    await act(async () => { listeners.forEach(fn => fn({ isConnected: false, isInternetReachable: false } as NetworkState)); }); expect(screen.getByRole('button', { name: 'Refresh provider status' })).toBeDisabled();
    await act(async () => { listeners.forEach(fn => fn({ isConnected: true, isInternetReachable: true } as NetworkState)); });
    expect(f.controller.runCalendar).not.toHaveBeenCalled(); expect(f.controller.queueCalendar).toHaveBeenCalledTimes(1); expect(await screen.findByText(/Operation queued/)).toBeTruthy();
  } finally { jest.mocked(addNetworkStateListener).mockImplementation(() => ({ remove: () => undefined })); }
});

test('a delayed old queue acknowledgement cannot overwrite a newer frozen request', async () => {
  const f = fixture(), originalQueue = f.controller.queueCalendar;
  let release!: (operation: CalendarOperationView) => void, accepted!: CalendarOperationView;
  jest.spyOn(f.controller, 'queueCalendar').mockImplementationOnce(async (...args) => { accepted = await originalQueue(...args); return new Promise(resolve => { release = resolve; }); });
  await open(f); await press('Queue provider plan'); await waitFor(() => expect(f.input).toBeDefined());
  await press('Switch module'); await press('Switch module'); await screen.findByRole('button', { name: 'Provider Calendar Work Calendar' });
  await screen.findByText(/Operation queued/); await press('Run Calendar fixture operation'); await screen.findByText('Calendar simulation confirmed. No real provider changed.');
  await press('Start a new reviewed Calendar intent'); jest.mocked(randomUUID).mockReturnValueOnce('22222222-2222-4222-8222-222222222222');
  await fireEvent.changeText(screen.getByLabelText('Provider block title'), 'Second reviewed title'); await press('Queue reviewed provider update'); await screen.findByText('Request 22222222-2222-4222-8222-222222222222');
  await act(async () => release(accepted));
  expect(screen.getByText('Request 22222222-2222-4222-8222-222222222222')).toBeTruthy(); expect(screen.queryByText('Request 11111111-1111-4111-8111-111111111111')).toBeNull();
  expect(f.input).toMatchObject({ action: 'calendar.update', title: 'Second reviewed title' }); expect(f.effects).toBe(1);
});
test('a provider confirmation locks Task and Calendar selection until cancelled', async () => {
  const f = fixture(); await open(f); await press('Queue provider plan'); await screen.findByText(/Intent accepted/); await press('Run Calendar fixture operation'); await screen.findByText('Calendar simulation confirmed. No real provider changed.');
  await press('Detach Task; leave provider event');
  expect(screen.getByRole('button', { name: 'Plan Task Reviewed Mail Task' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Provider Calendar Work Calendar' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Confirm detach leaving provider event' })).not.toBeDisabled();
  await press('Cancel confirmation'); expect(f.controller.detachCalendar).not.toHaveBeenCalled();
});
