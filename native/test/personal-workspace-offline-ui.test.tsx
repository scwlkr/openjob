import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NativePersonalWorkspace } from '../src/personal-workspace/NativePersonalWorkspace';
import { OpenJobThemeProvider } from '../src/theme';
import type { NativePersonalWorkspaceController, WorkspaceView } from '../src/personal-workspace-contracts';
type Offline = NonNullable<NativePersonalWorkspaceController['offline']>;
type State = Awaited<ReturnType<Offline['load']>>;
const projection = (owner: string) => ({ tasks: [], calendars: [{ id: 'personal', ownerId: owner, name: 'Personal', color: '#123456' }], events: [] });
const empty = (owner: string): WorkspaceView => ({ ...projection(owner), accounts: [], messages: [], drafts: [], sent: [], agents: [], activity: [] });
function fixture() {
  const key = (owner: string) => `isolated-ui-fixture:${owner}`;
  const load = async (owner: string): Promise<State> => {
    const saved = await AsyncStorage.getItem(key(owner));
    return saved ? JSON.parse(saved) : { projection: projection(owner), revision: 'initial', status: 'synced', pendingCount: 0 };
  };
  const save = async (owner: string, state: State) => { await AsyncStorage.setItem(key(owner), JSON.stringify(state)); return structuredClone(state); };
  const offline: Offline = {
    load: jest.fn(load), refresh: jest.fn(load),
    edit: jest.fn(async (owner, input) => {
      const state = await load(owner); const current = state.projection!;
      switch (input.type) {
        case 'task.create': current.tasks.push({ id: 'task', ownerId: owner, title: input.title, completed: false }); break;
        case 'task.notes': if (input.notes.trim()) current.tasks[0]!.notes = input.notes; else delete current.tasks[0]!.notes; break;
        case 'task.update': current.tasks[0]!.title = input.title; break;
        case 'task.complete': current.tasks[0]!.completed = input.completed; break;
        case 'task.schedule': current.tasks[0]!.scheduledSlot = { start: input.start, end: input.end }; current.tasks[0]!.calendarEventId = 'block'; current.events = [{ id: 'block', calendarId: input.calendarId, taskId: 'task', title: current.tasks[0]!.title, start: input.start, end: input.end }]; break;
      }
      return save(owner, { ...state, status: 'pending', pendingCount: state.pendingCount + 1 });
    }),
    sync: jest.fn(async owner => save(owner, { ...await load(owner), status: 'synced', pendingCount: 0 })),
    resolve: jest.fn(async (owner, strategy) => { const state = await load(owner); return save(owner, { projection: strategy === 'server' ? state.currentServer!.projection : state.projection, revision: 'resolved', status: 'synced', pendingCount: 0 }); }),
  };
  const controller: NativePersonalWorkspaceController = { offline, readPersonalWorkspace: jest.fn(async owner => empty(owner)), commandPersonalWorkspace: jest.fn(async () => undefined), listPersonalAgents: jest.fn(async () => []), revokePersonalAgent: jest.fn(async () => undefined) };
  return { controller, offline, load, save };
}
const properties = (controller: NativePersonalWorkspaceController, ownerUserId = 'alex', sessionReady = false) => ({ controller, ownerUserId, sessionReady, onRestoreSession: jest.fn(), onSessionRevoked: jest.fn() });
function ui(props: ReturnType<typeof properties>) { return <OpenJobThemeProvider preference="light" setPreference={() => undefined}><NativePersonalWorkspace {...props} /></OpenJobThemeProvider>; }
async function press(name: string) { await fireEvent.press(await screen.findByRole('button', { name })); }
beforeEach(async () => { await AsyncStorage.clear(); });

it('saves provisional Tasks/Calendar on device across a restart, then explicitly syncs after reconnect', async () => {
  const { controller, offline, load } = fixture(); const input = properties(controller); let tree = await render(ui(input));
  await screen.findByText('Personal Tasks');
  expect(screen.getByRole('button', { name: 'Online Mail and linked work' })).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText('New task'), 'Saved offline task'); await press('Add task');
  await screen.findByText('Pending · saved on device'); await press('Schedule Saved offline task'); await press('Save task schedule');
  await waitFor(() => expect(screen.getByText('2 pending changes')).toBeTruthy()); await press('Calendar'); await press('Open linked task Saved offline task');
  expect(screen.queryByRole('button', { name: /Open source mail/ })).toBeNull();
  await tree.unmount(); tree = await render(ui(input)); await screen.findByRole('button', { name: 'Complete Saved offline task' });
  await press('Complete Saved offline task'); await screen.findByText('3 pending changes');
  expect(controller.readPersonalWorkspace).not.toHaveBeenCalled(); expect(offline.sync).not.toHaveBeenCalled();
  const stored = JSON.stringify(await load('alex')); expect(stored).not.toMatch(/messages|drafts|sourceMessageId|token|accounts/);
  await tree.rerender(ui({ ...input, sessionReady: true })); await screen.findByRole('button', { name: 'Sync saved changes' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Sync saved changes' })).toBeEnabled()); await press('Sync saved changes');
  await screen.findByText('Synced at last check'); expect(offline.sync).toHaveBeenCalledWith('alex');
});

it('reviews both conflict versions and requires explicit discard or replacement confirmation', async () => {
  const { controller, offline, save } = fixture();
  await save('alex', { status: 'conflict', pendingCount: 1, revision: 'base', projection: { ...projection('alex'), tasks: [{ id: 'local', ownerId: 'alex', title: 'Local plan', completed: false }] }, currentServer: { revision: 'changed', projection: { ...projection('alex'), tasks: [{ id: 'server', ownerId: 'alex', title: 'New server-only work', completed: false }], events: [{ id: 'new-event', calendarId: 'personal', title: 'Server-only block', start: '2026-10-16T15:00:00Z', end: '2026-10-16T16:00:00Z' }] } } });
  await render(ui(properties(controller, 'alex', true))); await screen.findByText('Review local and server work');
  expect(screen.getByText(/New server-only work/)).toBeTruthy(); expect(screen.getByText(/Server-only block.*2026-10-16T15:00:00Z/)).toBeTruthy();
  await press('Apply reviewed local version'); expect(screen.getByText(/This can remove newer server tasks/)).toBeTruthy(); expect(offline.resolve).not.toHaveBeenCalled();
  await press('Cancel confirmation'); await press('Use server version'); await press('Confirm discard local changes');
  await screen.findByText('Synced at last check'); expect(offline.resolve).toHaveBeenCalledWith('alex', 'server');
  expect(screen.getByRole('button', { name: 'Complete New server-only work' })).toBeTruthy();
});

it('freezes edits during sync, retains returned newer pending work, and ignores a stale owner load', async () => {
  const { controller, offline, save } = fixture(); await save('alex', { status: 'pending', pendingCount: 1, projection: { ...projection('alex'), tasks: [{ id: 'task', ownerId: 'alex', title: 'Local pending', completed: false }] } });
  let completeSync!: (state: State) => void;
  jest.mocked(offline.sync).mockImplementationOnce(() => new Promise(resolve => { completeSync = resolve; }));
  const input = properties(controller, 'alex', true); const tree = await render(ui(input)); await screen.findByRole('button', { name: 'Complete Local pending' }); await fireEvent.changeText(screen.getByLabelText('New task'), 'Unsaved during sync'); await press('Sync saved changes');
  expect(screen.getByText('Syncing saved changes…')).toBeTruthy(); expect(screen.getByLabelText('New task')).toHaveDisplayValue('Unsaved during sync');
  expect(screen.getByRole('button', { name: 'Complete Local pending' })).toBeDisabled();
  await act(async () => completeSync({ status: 'pending', pendingCount: 1, projection: { ...projection('alex'), tasks: [{ id: 'newer', ownerId: 'alex', title: 'Newer saved work', completed: false }] } }));
  await screen.findByRole('button', { name: 'Complete Newer saved work' }); expect(screen.getByLabelText('New task')).toHaveDisplayValue('Unsaved during sync'); expect(screen.getByText('1 pending changes')).toBeTruthy();
  let oldLoad!: (state: State) => void;
  jest.mocked(offline.load).mockImplementationOnce(() => new Promise(resolve => { oldLoad = resolve; }));
  await tree.rerender(ui({ ...input, sessionReady: false })); await waitFor(() => expect(offline.load).toHaveBeenCalledTimes(2));
  await tree.rerender(ui({ ...input, ownerUserId: 'sam', sessionReady: false })); await screen.findByText('No personal tasks yet.');
  await act(async () => oldLoad({ status: 'pending', pendingCount: 1, projection: { ...projection('alex'), tasks: [{ id: 'private', ownerId: 'alex', title: 'Alex private deferred', completed: false }] } }));
  expect(screen.queryByText(/Alex private deferred/)).toBeNull(); expect(input.onSessionRevoked).not.toHaveBeenCalled();
});

it('requires another explicit review if resolution returns a newer server revision', async () => {
  const { controller, offline, save } = fixture();
  const local = { ...projection('alex'), tasks: [{ id: 'local', ownerId: 'alex', title: 'Reviewed local plan', completed: false }] };
  const conflict: State = { status: 'conflict', pendingCount: 1, revision: 'base', projection: local, currentServer: { revision: 'first', projection: projection('alex') } };
  await save('alex', conflict);
  jest.mocked(offline.resolve).mockImplementationOnce(async () => save('alex', { ...conflict, currentServer: { revision: 'newer', projection: { ...projection('alex'), tasks: [{ id: 'new', ownerId: 'alex', title: 'Just added server work', completed: false }] } } }));
  await render(ui(properties(controller, 'alex', true))); await screen.findByText('Review local and server work');
  await press('Apply reviewed local version'); await press('Confirm apply reviewed local changes');
  await screen.findByText(/Just added server work/); expect(screen.queryByRole('button', { name: 'Confirm apply reviewed local changes' })).toBeNull();
  expect(offline.resolve).toHaveBeenCalledTimes(1);
  await press('Apply reviewed local version'); await press('Confirm apply reviewed local changes'); await screen.findByText('Synced at last check');
  expect(offline.resolve).toHaveBeenLastCalledWith('alex', 'local'); expect(offline.resolve).toHaveBeenCalledTimes(2);
});

it('preserves complete online Mail-to-linked-Task navigation while returning safely to pending saved work', async () => {
  const { controller, offline, save, load } = fixture(); const online = empty('alex');
  jest.mocked(controller.readPersonalWorkspace).mockImplementation(async () => structuredClone(online));
  jest.mocked(controller.commandPersonalWorkspace).mockImplementation(async (_owner, input) => {
    if (input.type === 'mail.examples.add') {
      online.accounts = [{ id: 'invented', ownerId: 'alex', provider: 'gmail', label: 'Invented', address: 'example@example.invalid', mode: 'fixture' }];
      online.messages = [{ id: 'source', accountId: 'invented', subject: 'Online source plan', from: 'author@example.invalid', to: 'example@example.invalid', body: 'Online invented body', read: false, receivedAt: '2026-10-16T00:00:00Z' }];
    }
    if (input.type === 'task.create') online.tasks.push({ id: 'online-task', ownerId: 'alex', title: input.title, completed: false, sourceMessageId: input.messageId, sourceAccountId: 'invented' });
  });
  await save('alex', { status: 'pending', pendingCount: 1, revision: 'base', projection: { ...projection('alex'), tasks: [{ id: 'pending', ownerId: 'alex', title: 'Unsynced local priority', completed: false }] } });
  jest.mocked(offline.refresh).mockImplementation(async owner => {
    const local = await load(owner);
    const clean = { tasks: online.tasks.map(({ id, ownerId, title, completed }) => ({ id, ownerId, title, completed })), calendars: online.calendars, events: online.events };
    return save(owner, { ...local, status: 'conflict', currentServer: { revision: 'new-online-work', projection: clean } });
  });
  await render(ui(properties(controller, 'alex', true))); await screen.findByRole('button', { name: 'Complete Unsynced local priority' });
  await press('Online Mail and linked work'); await screen.findByRole('button', { name: 'Add invented examples' });
  await press('Add invented examples'); await screen.findByRole('button', { name: 'Read Online source plan' }); await press('Read Online source plan'); await press('Create private task from mail');
  await screen.findByText('Saved online. No real mail was sent.'); await press('Tasks'); await press('Open source mail for Online source plan'); expect(screen.getByText('Online invented body')).toBeTruthy();
  await press('Back to saved Tasks and Calendar'); await screen.findByText('Conflict · review required');
  expect(screen.getByRole('button', { name: 'Complete Unsynced local priority' })).toBeTruthy(); expect(screen.queryByRole('button', { name: 'Open source mail for Online source plan' })).toBeNull();
  expect(JSON.stringify(await load('alex'))).not.toMatch(/sourceMessageId|sourceAccountId|Online invented body|messages|accounts/);
});

it('keeps editor input when persistence returns an error instead of claiming the new edit was saved', async () => {
  const { controller, offline, load } = fixture();
  jest.mocked(offline.edit).mockImplementationOnce(async owner => ({ ...await load(owner), error: 'storage' }));
  await render(ui(properties(controller))); await screen.findByText('Personal Tasks');
  await fireEvent.changeText(screen.getByLabelText('New task'), 'Do not lose this title'); await press('Add task');
  await screen.findByText('This change could not be saved on this device. Your editor input has been kept.');
  expect(screen.getByLabelText('New task')).toHaveDisplayValue('Do not lose this title'); expect(screen.queryByRole('button', { name: 'Complete Do not lose this title' })).toBeNull();
  expect(screen.queryByText('Pending · saved on device')).toBeNull();
  await press('Add task'); await screen.findByRole('button', { name: 'Complete Do not lose this title' }); expect(screen.getByLabelText('New task')).toHaveDisplayValue('');
});

it('explains definitive sync errors and discards pending work only after explicit confirmation using the latest server', async () => {
  const { controller, offline, save, load } = fixture();
  const pending: State = { status: 'pending', pendingCount: 1, revision: 'base', error: 'workspace_capacity', projection: { ...projection('alex'), tasks: [{ id: 'local', ownerId: 'alex', title: 'Local pending work', completed: false }] } };
  await save('alex', pending);
  const server = { ...projection('alex'), tasks: [{ id: 'server', ownerId: 'alex', title: 'Latest server work', completed: false }] };
  jest.mocked(offline.resolve).mockImplementationOnce(async owner => save(owner, { status: 'synced', pendingCount: 0, revision: 'fresh-server', projection: server }));
  await render(ui(properties(controller, 'alex', true)));
  await screen.findByText('Server capacity was reached. Saved work is kept on this device. Reduce pending work or wait for capacity before syncing.');
  await press('Discard pending changes'); expect(screen.getByText(/Pending local work will be lost. Server work will not be overwritten./)).toBeTruthy();
  await press('Cancel confirmation'); expect(offline.resolve).not.toHaveBeenCalled(); expect((await load('alex')).pendingCount).toBe(1);
  await press('Discard pending changes'); await press('Confirm discard local changes'); await screen.findByRole('button', { name: 'Complete Latest server work' });
  expect(offline.resolve).toHaveBeenCalledWith('alex', 'server'); expect(offline.sync).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Complete Local pending work' })).toBeNull(); expect((await load('alex')).pendingCount).toBe(0);
});


it('edits notes in saved Tasks, keeps failed input and reopens saved notes after restart without Mail data', async () => {
  const { controller, offline, load } = fixture(); const input = properties(controller); let tree = await render(ui(input));
  await screen.findByText('Personal Tasks');
  await fireEvent.changeText(screen.getByLabelText('New task'), 'Offline planning'); await press('Add task');
  await screen.findByRole('button', { name: 'Edit notes for Offline planning' }); await press('Edit notes for Offline planning');
  await fireEvent.changeText(screen.getByLabelText('Task notes'), 'Keep local notes');
  await press('Calendar'); await press('Tasks');
  expect(screen.getByLabelText('Task notes')).toHaveDisplayValue('Keep local notes');
  jest.mocked(offline.edit).mockRejectedValueOnce(new Error('Invented storage failure'));
  await press('Save task notes'); await screen.findByText(/Request could not be completed/);
  expect(screen.getByLabelText('Task notes')).toHaveDisplayValue('Keep local notes');
  await press('Save task notes'); await screen.findByText('2 pending changes');
  await tree.unmount(); tree = await render(ui(input)); await screen.findByText('Keep local notes');
  await press('Edit notes for Offline planning'); expect(screen.getByLabelText('Task notes')).toHaveDisplayValue('Keep local notes');
  await fireEvent.changeText(screen.getByLabelText('Task notes'), ''); await press('Save task notes'); await screen.findByText('3 pending changes');
  expect((await load('alex')).projection!.tasks[0]!.notes).toBeUndefined();
  expect(JSON.stringify(await load('alex'))).not.toMatch(/messages|sourceMessageId|accounts|token/);
});
