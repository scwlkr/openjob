import { validSlot } from '../src/personal-workspace/controls';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NativePersonalWorkspace } from '../src/personal-workspace/NativePersonalWorkspace';
import { OpenJobThemeProvider } from '../src/theme';
import type { NativePersonalWorkspaceController, WorkspaceView, PersonalAgentGrant } from '../src/personal-workspace-contracts';

const empty = (owner: string): WorkspaceView => ({ accounts: [], messages: [], tasks: [], calendars: [{ id: 'personal', ownerId: owner, name: 'Personal', color: '#123456' }], events: [], drafts: [], sent: [], agents: [], activity: [] });
const grant: PersonalAgentGrant = { id: 'agt_example', ownerUserId: 'alex', name: 'Planning assistant', scopes: ['tasks:read'], resourceIds: ['tasks:personal'], createdAt: '2026-10-16T00:00:00Z', expiresAt: '2026-10-17T00:00:00Z', revoked: false };
function fixture() {
  const state: Record<string, WorkspaceView> = { alex: empty('alex'), sam: empty('sam') };
  let grants = [grant];
  const controller: NativePersonalWorkspaceController = {
    readPersonalWorkspace: jest.fn(async owner => structuredClone(state[owner]!)),
    listPersonalAgents: jest.fn(async owner => owner === 'alex' ? [...grants] : []),
    revokePersonalAgent: jest.fn(async (_owner, id) => { grants = grants.map(item => item.id === id ? { ...item, revoked: true } : item); }),
    commandPersonalWorkspace: jest.fn(async (owner, input) => {
      const view = state[owner]!;
      switch (input.type) {
        case 'mail.examples.add':
          view.accounts = [{ id: 'example', ownerId: owner, provider: 'gmail', label: 'Invented Personal', address: 'personal@example.invalid', mode: 'fixture' }];
          view.messages = [{ id: 'message', accountId: 'example', subject: 'Launch checklist', from: 'author@example.invalid', to: 'personal@example.invalid', body: 'Invented source body', read: false, receivedAt: '2026-10-16T00:00:00Z' }]; break;
        case 'calendar.create': view.events.push({ id: 'manual', calendarId: input.calendarId, title: input.title, start: input.start, end: input.end }); break;
        case 'calendar.update': Object.assign(view.events.find(item => item.id === input.eventId)!, { title: input.title, start: input.start, end: input.end }); break;
        case 'calendar.delete': view.events = view.events.filter(item => item.id !== input.eventId); break;
        case 'mail.read': view.messages[0]!.read = input.read; break;
        case 'task.create': view.tasks.push({ id: 'task', ownerId: owner, title: input.title, completed: false, ...(input.messageId ? { sourceMessageId: input.messageId, sourceAccountId: 'example' } : {}) }); break;
        case 'task.notes': { const task = view.tasks.find(item => item.id === input.taskId)!; if (input.notes.trim()) task.notes = input.notes; else delete task.notes; break; }
        case 'task.update': view.tasks[0]!.title = input.title; break;
        case 'task.complete': view.tasks[0]!.completed = input.completed; break;
        case 'task.schedule': view.tasks[0]!.scheduledSlot = { start: input.start, end: input.end }; view.tasks[0]!.calendarEventId = 'block'; view.events = [{ id: 'block', calendarId: input.calendarId, taskId: 'task', title: view.tasks[0]!.title, start: input.start, end: input.end }]; break;
        case 'task.unschedule': delete view.tasks[0]!.scheduledSlot; delete view.tasks[0]!.calendarEventId; view.events = []; break;
        case 'task.delete': view.tasks = []; view.events = []; break;
        case 'mail.draft': view.drafts = [{ id: 'draft', accountId: 'example', messageId: input.messageId, subject: 'Re: Launch checklist', to: 'author@example.invalid', body: input.body, status: 'draft' }]; break;
        case 'mail.draft.update': Object.assign(view.drafts[0]!, { to: input.to, subject: input.subject, body: input.body }); break;
        case 'mail.compose': view.drafts = [{ ...input, id: 'draft', status: 'draft' }]; break;
        case 'mail.simulate-send': { const draft = view.drafts[0]!; view.sent.push({ ...draft, id: 'sent', from: 'personal@example.invalid', to: draft.to!, subject: draft.subject!, sentAt: '2026-10-16T01:00:00Z', mode: 'fixture' }); view.drafts = []; break; }
      }
    }),
  };
  return { controller, state };
}
const props = (controller: NativePersonalWorkspaceController, ownerUserId = 'alex') => ({ controller, ownerUserId, sessionReady: true, onRestoreSession: jest.fn(), onSessionRevoked: jest.fn() });
function ui(input: ReturnType<typeof props>) { return <OpenJobThemeProvider preference="light" setPreference={() => undefined}><NativePersonalWorkspace {...input} /></OpenJobThemeProvider>; }
async function press(name: string) { await fireEvent.press(await screen.findByRole('button', { name })); }
async function settled() { await waitFor(() => expect(screen.queryByText('Working online…')).toBeNull()); }

it('connects invented mail, private task/calendar, preserved reply, simulated sent and effective grant revocation', async () => {
  const { controller, state } = fixture();
  await render(ui(props(controller))); await settled();
  await press('Add invented examples'); await settled(); await press('Read Launch checklist');
  await press('Mark message read'); await settled(); expect(state.alex!.messages[0]!.read).toBe(true);
  await fireEvent.changeText(screen.getByLabelText('Reply body'), 'Keep this unsaved reply');
  await press('Create private task from mail'); await settled(); await press('Tasks');
  await press('Schedule Launch checklist'); await press('Save task schedule'); await settled();
  await press('Complete Launch checklist'); await settled(); expect(state.alex!.tasks[0]!.completed).toBe(true);
  await press('Calendar'); await press('Open linked task Launch checklist');
  await press('Open source mail for Launch checklist');
  expect(screen.getByLabelText('Reply body')).toHaveDisplayValue('Keep this unsaved reply');
  await press('Save reply draft'); await settled(); await press('Drafts');
  await press('Edit draft Re: Launch checklist'); await fireEvent.changeText(screen.getByLabelText('Draft body'), 'Edited saved reply');
  await press('Save composed draft'); await settled(); await press('Simulate send Re: Launch checklist'); await settled(); await press('Simulated Sent');
  expect(screen.getByText('Edited saved reply')).toBeTruthy(); expect(state.alex!.drafts).toHaveLength(0);
  await press('Agents'); await press('Revoke Planning assistant'); await press('Confirm revoke agent'); await settled();
  expect(screen.getByText(/Revoked/)).toBeTruthy();
  expect(controller.commandPersonalWorkspace).toHaveBeenCalledWith('alex', { type: 'task.create', title: 'Launch checklist', messageId: 'message' });
  expect(controller.commandPersonalWorkspace).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'mail.send' }));
});

it('does not expose provisional data and clears owner edits while ignoring deferred old-owner results', async () => {
  const { controller } = fixture(); let release!: (view: WorkspaceView) => void;
  jest.mocked(controller.readPersonalWorkspace).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const input = props(controller); const tree = await render(ui({ ...input, sessionReady: false }));
  expect(controller.readPersonalWorkspace).not.toHaveBeenCalled(); await press('Restore session'); expect(input.onRestoreSession).toHaveBeenCalledTimes(1);
  await tree.rerender(ui(input)); await waitFor(() => expect(controller.readPersonalWorkspace).toHaveBeenCalledWith('alex'));
  await tree.rerender(ui({ ...input, ownerUserId: 'sam' })); await settled();
  const old = empty('alex'); old.messages = [{ id: 'private', accountId: 'private', subject: 'Old owner private message', from: '', to: '', body: '', receivedAt: '', read: false }];
  await act(async () => release(old)); expect(screen.queryByText(/Old owner private/)).toBeNull();
  await press('Add invented examples'); await settled(); await press('Read Launch checklist'); await fireEvent.changeText(screen.getByLabelText('Reply body'), 'Sam unsaved');
  await tree.rerender(ui(input)); await settled(); expect(screen.queryByDisplayValue('Sam unsaved')).toBeNull();
});

it('clears current-owner data on 410 but ignores a stale mutation failure after identity swap', async () => {
  const { controller } = fixture(); const input = props(controller); const tree = await render(ui(input)); await settled();
  let rejectOld!: (error: Error) => void;
  jest.mocked(controller.commandPersonalWorkspace).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }));
  await press('Add invented examples');
  await tree.rerender(ui({ ...input, ownerUserId: 'sam' })); await settled();
  await act(async () => rejectOld(Object.assign(new Error('private error'), { status: 401 })));
  expect(input.onSessionRevoked).not.toHaveBeenCalled(); expect(screen.queryByText('private error')).toBeNull();
  jest.mocked(controller.readPersonalWorkspace).mockRejectedValueOnce(Object.assign(new Error('private deleted'), { status: 410 }));
  await press('Refresh workspace'); await screen.findByText('Session access ended'); expect(input.onSessionRevoked).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Invented Mail')).toBeNull(); expect(screen.queryByText('private deleted')).toBeNull();
});


it('edits and deletes tasks and calendar blocks, validates UTC scheduling, and composes only local drafts', async () => {
  const { controller, state } = fixture(); await render(ui(props(controller))); await settled();
  await press('Add invented examples'); await settled();
  await fireEvent.changeText(screen.getByLabelText('Search invented mail'), 'unmatched'); expect(screen.queryByRole('button', { name: 'Read Launch checklist' })).toBeNull();
  await fireEvent.changeText(screen.getByLabelText('Search invented mail'), 'LAUNCH'); await press('Read Launch checklist');
  await press('Compose invented draft'); await fireEvent.changeText(screen.getByLabelText('Draft recipient'), 'recipient@example.com');
  await fireEvent.changeText(screen.getByLabelText('Draft subject'), 'Local composition'); await fireEvent.changeText(screen.getByLabelText('Draft body'), 'Invented composition body');
  await press('Tasks'); await fireEvent.changeText(screen.getByLabelText('New task'), 'Manual task'); await press('Add task'); await settled();
  await press('Edit Manual task'); await fireEvent.changeText(screen.getByLabelText('Task title'), 'Edited task'); await press('Save task title'); await settled();
  await press('Schedule Edited task'); await fireEvent.changeText(screen.getByLabelText('Task end UTC ISO'), 'invalid'); await press('Save task schedule');
  expect(screen.getByText('Use valid UTC ISO times with the end after the start.')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Task start UTC ISO'), '2026-10-16T14:00:00Z'); await fireEvent.changeText(screen.getByLabelText('Task end UTC ISO'), '2026-10-16T14:30:00Z');
  await press('Save task schedule'); await settled(); await press('Unschedule Edited task'); await settled(); expect(state.alex!.events).toHaveLength(0);
  await press('Delete Edited task'); await press('Cancel confirmation'); expect(state.alex!.tasks).toHaveLength(1); await press('Delete Edited task'); await press('Confirm delete task'); await settled();
  await press('Calendar'); await fireEvent.changeText(screen.getByLabelText('Calendar block title'), 'Focus block'); await press('Save calendar block'); await settled();
  await press('Edit block Focus block'); await fireEvent.changeText(screen.getByLabelText('Calendar block title'), 'Edited block'); await press('Save calendar block'); await settled();
  await press('Delete block Edited block'); await press('Confirm delete block'); await settled(); expect(state.alex!.events).toHaveLength(0);
  await press('Mail'); expect(screen.getByLabelText('Draft body')).toHaveDisplayValue('Invented composition body'); await press('Save composed draft'); await settled();
  expect(state.alex!.drafts[0]!.to).toBe('recipient@example.com');
});


it.each([
  ['2028-02-29T09:00:00Z', '2028-02-29T10:00:00Z'],
  ['2026-10-16T09:00:00.1Z', '2026-10-16T09:00:00.250Z'],
  ['2026-10-16T09:00:00.123456Z', '2026-10-16T09:01:00Z'],
])('accepts real UTC slots %s to %s', (start, end) => expect(validSlot(start, end)).toBe(true));

it.each([
  '2026-02-30T09:00:00Z', '2026-02-29T09:00:00Z', '2026-04-31T09:00:00Z',
  '2026-13-01T09:00:00Z', '2026-10-16T24:00:00Z', '2026-10-16T09:60:00Z',
  '2026-10-16T09:00:60Z', '2026-10-16T09:00Z', '2026-10-16T09:00:00.Z',
  '2026-10-16 09:00:00Z', '2026-10-16T09:00:00+00:00', '2026-10-16T09:00:00Z trailing',
])('rejects invalid UTC text in either endpoint: %s', value => {
  expect(validSlot(value, '2029-01-01T00:00:00Z')).toBe(false);
  expect(validSlot('2020-01-01T00:00:00Z', value)).toBe(false);
});

it('requires strictly increasing UTC slots', () => {
  expect(validSlot('2026-10-16T09:00:00Z', '2026-10-16T09:00:00.000Z')).toBe(false);
  expect(validSlot('2026-10-16T10:00:00Z', '2026-10-16T09:00:00Z')).toBe(false);
});


it('opens exact Mail-linked Tasks and keeps notes through module navigation, failed saves and replacement review', async () => {
  const { controller, state } = fixture(); const input = props(controller); const tree = await render(ui(input)); await settled();
  await press('Add invented examples'); await settled(); await press('Read Launch checklist');
  await fireEvent.changeText(screen.getByLabelText('Reply body'), 'Unfinished source reply');
  await press('Create private task from mail'); await settled();
  state.alex!.tasks.push({ ...state.alex!.tasks[0]!, id: 'second', title: 'Second linked work', completed: true });
  await press('Refresh workspace'); await settled();
  await press('Open linked task Launch checklist');
  await press('Edit notes for Launch checklist');
  await fireEvent.changeText(screen.getByLabelText('Task notes'), '  Owner planning context 📝\n<em>plain text</em>');
  await press('Calendar'); await press('Tasks');
  expect(screen.getByLabelText('Task notes')).toHaveDisplayValue('  Owner planning context 📝\n<em>plain text</em>');
  await press('Edit notes for Second linked work'); await press('Cancel confirmation');
  expect(screen.getByLabelText('Task notes')).toHaveDisplayValue('  Owner planning context 📝\n<em>plain text</em>');
  jest.mocked(controller.commandPersonalWorkspace).mockRejectedValueOnce(new Error('Invented offline transport'));
  await press('Save task notes'); await settled();
  expect(screen.getByLabelText('Task notes')).toHaveDisplayValue('  Owner planning context 📝\n<em>plain text</em>');
  await press('Save task notes'); await settled();
  expect(state.alex!.tasks[0]!.notes).toBe('  Owner planning context 📝\n<em>plain text</em>');
  await press('Schedule Launch checklist'); await press('Save task schedule'); await settled();
  await press('Calendar'); await press('Open linked task Launch checklist'); await press('Open source mail for Launch checklist');
  expect(screen.getByLabelText('Reply body')).toHaveDisplayValue('Unfinished source reply');
  await press('Open linked task Second linked work · completed');
  expect(screen.getByText('Second linked work · opened linked task')).toBeTruthy();
  await press('Edit notes for Launch checklist'); await fireEvent.changeText(screen.getByLabelText('Task notes'), ''); await press('Save task notes'); await settled();
  expect(state.alex!.tasks[0]!.notes).toBeUndefined();
  await press('Edit notes for Launch checklist'); await fireEvent.changeText(screen.getByLabelText('Task notes'), 'Unfinished private note');
  await press('Edit notes for Second linked work'); await press('Discard unfinished notes and open Task');
  expect(screen.getByLabelText('Task notes')).toHaveDisplayValue('');
  await fireEvent.changeText(screen.getByLabelText('Task notes'), 'Old owner private input');
  await tree.rerender(ui(props(controller, 'sam'))); await settled();
  expect(screen.queryByDisplayValue('Old owner private input')).toBeNull();
});
