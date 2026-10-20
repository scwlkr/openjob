import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ConnectedWorkspaces } from '../src/connected-workspaces/ConnectedWorkspaces';
import { OpenJobThemeProvider } from '../src/theme';
import type { ConnectedReplyDraft, NativeConnectedWorkspaceController, OwnedWorkspaceSnapshot, ReplyPreparation, ReplySaveInput } from '../src/connected-workspaces-contracts';
import { applyTaskCalendarCommand } from '../../shared/task-calendar-sync';

const owner = `user_${'a'.repeat(32)}`, id = `wsp_${'b'.repeat(32)}`, connection = `con_${'c'.repeat(32)}`, account = `gmail_${'d'.repeat(32)}`;
const plan = { from: 'alex@example.invalid', to: ['replies@example.invalid'], cc: [], subject: 'Re: Proposal', inReplyTo: '<parent@example.invalid>', references: ['<parent@example.invalid>'] };
function fixture(subject = 'Proposal') {
  let connected = true;
  let snapshot: OwnedWorkspaceSnapshot = { workspace: { workspaceId: id, ownerUserId: owner, taskSpaceId: `tsp_${'b'.repeat(32)}`, calendarId: `cal_${'b'.repeat(32)}`, name: 'Work', createdAt: '2026-10-20T00:00:00Z' }, work: { tasks: [], events: [], calendars: [{ id: `cal_${'b'.repeat(32)}`, ownerId: owner, name: 'Planning', color: '#2454dc' }] } };
  let draft: ConnectedReplyDraft | null = null;
  let nextId = 1;
  const message = { id: `${account}:message:m1`, accountId: account, upstreamId: 'm1', upstreamThreadId: 't1', threadId: `${account}:thread:t1`, folderIds: [], from: 'colleague@example.invalid', to: plan.from, subject, body: 'Invented provider source body', read: true, receivedAt: '2026-10-20T09:00:00Z' };
  const current = () => { if (!connected) throw Object.assign(new Error('Disconnected'), { status: 409, code: 'reconnect_required' }); };
  const prepare = (): ReplyPreparation => ({ workspaceId: id, taskId: 'task', storageKind: 'openjob', plans: { reply: plan, replyAll: { ...plan, to: [...plan.to, 'teammate@example.invalid'], cc: ['observer@example.invalid'] } }, reviewToken: 'e'.repeat(64), draft });
  const controller: NativeConnectedWorkspaceController = {
    list: jest.fn(async () => [structuredClone(snapshot.workspace)]), create: jest.fn(async () => structuredClone(snapshot)), personal: jest.fn(async () => structuredClone(snapshot)), read: jest.fn(async () => structuredClone(snapshot)),
    command: jest.fn(async (_owner, _id, value) => { const { expectedNotes, ...input } = value; if (input.type === 'task.notes' && (snapshot.work.tasks.find(task => task.id === input.taskId)?.notes || '') !== expectedNotes) throw Object.assign(new Error(), { status: 409, code: 'conflict' }); snapshot = { ...snapshot, work: applyTaskCalendarCommand(snapshot.work, input, owner, () => `offline_00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`) }; return structuredClone(snapshot); }),
    connections: jest.fn(async () => ({ mode: 'google-fixture' as const, mailAvailable: true, homes: [{ workspaceId: id, name: 'Work' }], bindings: [{ id: connection, workspaceId: id, address: plan.from, status: connected ? 'connected' as const : 'disconnected' as const, expired: false }] })),
    mail: jest.fn(async () => { current(); return { workspaceId: id, mode: 'google-fixture' as const, page: { messages: [message], folders: [], events: [], calendars: [], nextCursor: null, syncCursor: null } }; }),
    createMailTask: jest.fn(async (_owner, _id, _connection, input) => { current(); const created = !snapshot.work.tasks.length; if (created) snapshot.work.tasks.push({ id: 'task', ownerId: owner, title: input.title, completed: false }); return { workspaceId: id, taskId: 'task', created }; }),
    source: jest.fn(async () => { current(); return { workspaceId: id, taskId: 'task', mode: 'google-fixture' as const, address: plan.from, message }; }),
    reply: jest.fn(async () => { current(); return structuredClone(prepare()); }),
    saveReply: jest.fn(async (_owner, _id, _task, input: ReplySaveInput) => { current(); if (input.expectedRevision !== (draft?.revision ?? 0)) throw Object.assign(new Error(), { status: 409, code: 'conflict' }); draft = { storageKind: 'openjob', body: input.body, mode: input.mode, plan: input.mode === 'reply' ? plan : prepare().plans.replyAll, revision: input.expectedRevision + 1, updatedAt: '2026-10-20T10:00:00Z' }; return { workspaceId: id, taskId: 'task', draft: structuredClone(draft) }; }),
  };
  return { controller, disconnect() { connected = false; }, get snapshot() { return snapshot; }, setNotes(notes: string) { snapshot.work.tasks[0]!.notes = notes; }, get draft() { return draft; } };
}
const ui = (controller: NativeConnectedWorkspaceController) => <OpenJobThemeProvider preference="light" setPreference={() => undefined}><ConnectedWorkspaces key={owner} controller={controller} owner={owner} active sessionReady onAccessEnded={jest.fn()} /></OpenJobThemeProvider>;
async function press(name: string) { await fireEvent.press(await screen.findByRole('button', { name })); }
async function open(f: ReturnType<typeof fixture>) { const root = await render(ui(f.controller)); await press('Open Workspace Work'); await screen.findByText('Work Today'); return root; }
async function create(f: ReturnType<typeof fixture>) { const root = await open(f); await press('Workspace Mail'); await press(`Read Mail ${plan.from}`); await fireEvent.changeText(await screen.findByLabelText('Connected Task title'), 'Reviewed proposal'); await press('Create or find Task from Proposal'); await screen.findByText('Reviewed proposal · opened linked task'); return root; }

test('native connected Mail -> reviewed Task -> Calendar -> complete -> source -> authored reply with navigation/save/reload', async () => {
  const f = fixture(); const root = await create(f);
  await press('Schedule Reviewed proposal'); await press('Save task schedule'); await waitFor(() => expect(f.snapshot.work.events).toHaveLength(1));
  await press('Complete Reviewed proposal'); await waitFor(() => expect(f.snapshot.work.tasks[0]?.completed).toBe(true));
  await press('Open connected source Mail'); await screen.findByText('Invented provider source body'); await press('Prepare reply draft'); await press('Reply all');
  await fireEvent.changeText(await screen.findByLabelText('Your connected reply'), 'Reviewed, planned and completed.');
  await press('Workspace Calendar'); await press('Open linked task Reviewed proposal'); await press('Open connected source Mail');
  expect(await screen.findByLabelText('Your connected reply')).toHaveDisplayValue('Reviewed, planned and completed.');
  await press('Refresh reply and saved version'); await press('Save OpenJob draft'); await screen.findByText('OpenJob draft saved. Nothing sent.');
  expect(f.draft).toMatchObject({ body: 'Reviewed, planned and completed.', mode: 'reply-all', plan: { from: plan.from, to: [...plan.to, 'teammate@example.invalid'], cc: ['observer@example.invalid'] } });
  expect(JSON.stringify(f.snapshot)).not.toMatch(/Invented provider|replies@example|Reviewed, planned/);
  await root.unmount(); await render(ui(f.controller)); await press('Open Workspace Work'); await press('Workspace Tasks'); await press('Open connected source Mail'); await press('Prepare reply draft');
  expect(await screen.findByLabelText('Your connected reply')).toHaveDisplayValue('Reviewed, planned and completed.');
  f.disconnect(); await press('Refresh reply and saved version'); await screen.findByText(/Connected source unavailable/);
  expect(screen.queryByText('Invented provider source body')).toBeNull(); expect(f.snapshot.work.tasks[0]?.completed).toBe(true); expect(f.snapshot.work.events).toHaveLength(1); expect(f.draft?.body).toBe('Reviewed, planned and completed.');
});
test('original notes base and unfinished reply deletion are guarded, with explicit discard retaining saved work', async () => {
  const f = fixture(); await create(f);
  await press('Edit notes for Reviewed proposal'); await fireEvent.changeText(screen.getByLabelText('Task notes'), 'My unsaved notes');
  f.setNotes('Newer saved notes'); await press('Refresh Workspace work'); await screen.findByText('Newer saved notes');
  expect(screen.getByLabelText('Task notes')).toHaveDisplayValue('My unsaved notes'); expect(screen.getByRole('button', { name: 'Save task notes' })).toBeDisabled();
  await press('Discard note edits'); await press('Edit notes for Reviewed proposal'); await fireEvent.changeText(screen.getByLabelText('Task notes'), 'Reviewed newer notes'); await press('Save task notes');
  await waitFor(() => expect(f.controller.command).toHaveBeenCalledWith(owner, id, { type: 'task.notes', taskId: 'task', notes: 'Reviewed newer notes', expectedNotes: 'Newer saved notes' }));
  await press('Open connected source Mail'); await press('Prepare reply draft'); await fireEvent.changeText(await screen.findByLabelText('Your connected reply'), 'Keep this unfinished reply');
  await press('Delete Reviewed proposal'); await press('Confirm delete task'); await screen.findByText(/Save or explicitly discard/);
  expect(f.snapshot.work.tasks).toHaveLength(1); expect(screen.getByLabelText('Your connected reply')).toHaveDisplayValue('Keep this unfinished reply');
  await press('Discard unsaved reply edits'); expect(screen.queryByLabelText('Your connected reply')).toBeNull(); expect(f.snapshot.work.tasks).toHaveLength(1);
});
test('long source subjects get a bounded suggestion without changing the message, and unavailable data never loads examples', async () => {
  const f = fixture('x'.repeat(700)); await open(f); await press('Workspace Mail'); await press(`Read Mail ${plan.from}`);
  expect(await screen.findByLabelText('Connected Task title')).toHaveDisplayValue('x'.repeat(500));
  expect(screen.getByRole('header', { name: 'x'.repeat(700) })).toBeTruthy();
  const unavailable = { ...f.controller, list: jest.fn(async () => { throw Object.assign(new Error(), { status: 503, code: 'not_configured' }); }) };
  await render(ui(unavailable)); await screen.findByText(/Connected Workspaces unavailable/);
  expect(screen.queryByText('Invented provider source body')).toBeNull(); expect(screen.queryByRole('button', { name: 'Add invented examples' })).toBeNull();
});
