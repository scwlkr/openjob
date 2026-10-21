import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ConnectedWorkspaces } from '../src/connected-workspaces/ConnectedWorkspaces';
import { OpenJobThemeProvider } from '../src/theme';
import type { ConnectedReplyDraft, NativeConnectedWorkspaceController, OwnedWorkspaceSnapshot, ReplyPreparation, ReplySaveInput } from '../src/connected-workspaces-contracts';
import { applyTaskCalendarCommand } from '../../shared/task-calendar-sync';
import { mailReadFreshness } from '../../shared/connected-mail-freshness';
import { AppState, type AppStateStatus } from 'react-native';
import { addNetworkStateListener, type NetworkState } from 'expo-network';
jest.mock('expo-network', () => ({ addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })), getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })) }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => '11111111-1111-4111-8111-111111111111') }));
beforeEach(() => { AppState.currentState = 'active'; });

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
    mail: jest.fn(async () => { current(); const { body, ...metadata } = message; void body; return { workspaceId: id, mode: 'google-fixture' as const, freshness: mailReadFreshness(Date.now(), Date.now() + 3600000), page: { messages: [metadata], folders: [], events: [], calendars: [], nextCursor: null, syncCursor: null } }; }),
    message: jest.fn(async () => { current(); return { workspaceId: id, mode: 'google-fixture' as const, message }; }),
    createMailTask: jest.fn(async (_owner, _id, _connection, input) => { current(); const taskId = input.requestId ? `additional_${input.requestId}` : 'task', created = !snapshot.work.tasks.some(task => task.id === taskId); if (created) snapshot.work.tasks.push({ id: taskId, ownerId: owner, title: input.title, completed: false }); return { workspaceId: id, taskId, created }; }),
    source: jest.fn(async () => { current(); return { workspaceId: id, taskId: 'task', mode: 'google-fixture' as const, address: plan.from, message }; }),
    reply: jest.fn(async () => { current(); return structuredClone(prepare()); }),
    saveReply: jest.fn(async (_owner, _id, _task, input: ReplySaveInput) => { current(); if (input.expectedRevision !== (draft?.revision ?? 0)) throw Object.assign(new Error(), { status: 409, code: 'conflict' }); draft = { storageKind: 'openjob', body: input.body, mode: input.mode, plan: input.mode === 'reply' ? plan : prepare().plans.replyAll, revision: input.expectedRevision + 1, updatedAt: '2026-10-20T10:00:00Z' }; return { workspaceId: id, taskId: 'task', draft: structuredClone(draft) }; }),
  };
  return { controller, disconnect() { connected = false; }, get snapshot() { return snapshot; }, setNotes(notes: string) { snapshot.work.tasks[0]!.notes = notes; }, get draft() { return draft; } };
}
const ui = (controller: NativeConnectedWorkspaceController) => <OpenJobThemeProvider preference="light" setPreference={() => undefined}><ConnectedWorkspaces key={owner} controller={controller} owner={owner} active sessionReady onAccessEnded={jest.fn()} /></OpenJobThemeProvider>;
async function press(name: string) { await fireEvent.press(await screen.findByRole('button', { name })); }
async function open(f: ReturnType<typeof fixture>) { const root = await render(ui(f.controller)); await press('Open Workspace Work'); await screen.findByText('Work Today'); return root; }
async function create(f: ReturnType<typeof fixture>) { const root = await open(f); await press('Workspace Mail'); await press(`Read Mail ${plan.from}`); await fireEvent.changeText(await screen.findByLabelText('Connected Task title'), 'Reviewed proposal'); await press('Create or find Task from Proposal'); await press('Open linked Task Reviewed proposal'); await screen.findByText('Reviewed proposal · opened linked task'); return root; }

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
test('native browsing stays metadata-only until explicit body read; close and module switches discard bodies but keep authored titles', async () => {
  const f = fixture(); await open(f); await press('Workspace Mail'); await press(`Read Mail ${plan.from}`);
  await screen.findByLabelText('Connected Task title'); expect(screen.queryByText('Invented provider source body')).toBeNull(); expect(f.controller.message).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByLabelText('Connected Task title'), 'Keep this authored title');
  await press('Read message Proposal'); await screen.findByText('Invented provider source body');
  await press('Close message Proposal'); expect(screen.queryByText('Invented provider source body')).toBeNull();
  await press('Workspace Calendar'); await press('Workspace Mail'); await press(`Read Mail ${plan.from}`);
  expect(await screen.findByLabelText('Connected Task title')).toHaveDisplayValue('Keep this authored title'); expect(screen.queryByText('Invented provider source body')).toBeNull(); expect(f.controller.message).toHaveBeenCalledTimes(1);
});
test('background drops metadata and late body, stops reads beyond expiry, and keeps reviewed work for explicit recovery', async () => {
  const f = fixture(), listeners = new Set<(state: AppStateStatus) => void>();
  const originalListener = jest.isMockFunction(AppState.addEventListener) ? jest.mocked(AppState.addEventListener).getMockImplementation() : undefined;
  const state = jest.spyOn(AppState, 'addEventListener').mockImplementation((event, listener) => { if (event === 'change') listeners.add(listener); return { remove: () => listeners.delete(listener) } as ReturnType<typeof AppState.addEventListener>; });
  jest.useFakeTimers({ doNotFake: ['queueMicrotask'] }); let root: Awaited<ReturnType<typeof open>> | undefined;
  try {
    root = await open(f); await press('Workspace Mail'); await press(`Read Mail ${plan.from}`); await screen.findByLabelText('Connected Task title');
    await fireEvent.changeText(screen.getByLabelText('Connected Task title'), 'Authored before background');
    const full = await f.controller.source(owner, id, 'task'); let release!: (value: { workspaceId: string; mode: 'google-fixture'; message: typeof full.message }) => void;
    jest.spyOn(f.controller, 'message').mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    await press('Read message Proposal');
    await act(async () => { AppState.currentState = 'background'; listeners.forEach(listener => listener('background')); });
    expect(screen.queryByRole('header', { name: 'Proposal' })).toBeNull();
    await act(async () => release({ workspaceId: id, mode: 'google-fixture', message: full.message })); expect(screen.queryByText(full.message.body)).toBeNull();
    const reads = jest.mocked(f.controller.mail).mock.calls.length;
    await act(async () => { jest.advanceTimersByTime(301000); });
    expect(f.controller.mail).toHaveBeenCalledTimes(reads);
    await act(async () => { AppState.currentState = 'active'; listeners.forEach(listener => listener('active')); });
    expect(screen.queryByRole('header', { name: 'Proposal' })).toBeNull(); expect(screen.getByLabelText('Connected Task title')).toHaveDisplayValue('Authored before background');
    await press('Refresh Mail'); await screen.findByRole('header', { name: 'Proposal' }); expect(screen.queryByText(full.message.body)).toBeNull();
  } finally { await root?.unmount(); jest.useRealTimers(); state.mockRestore(); if (originalListener) jest.mocked(AppState.addEventListener).mockImplementation(originalListener); }
});
test('an uncertain additional Task keeps its exact input and UUID across module switches and access refresh', async () => {
  const f = fixture(); await create(f); await press('Workspace Mail'); await press(`Read Mail ${plan.from}`);
  await fireEvent.changeText(await screen.findByLabelText('Connected Task title'), 'Additional reviewed Task');
  let reject!: (error: Error) => void;
  const apply = jest.mocked(f.controller.createMailTask).getMockImplementation()!;
  jest.spyOn(f.controller, 'createMailTask').mockImplementationOnce(async (...args) => { await apply(...args); return new Promise((_, fail) => { reject = fail; }); });
  await press('Create another Task from Proposal'); await press('Workspace Calendar');
  await act(async () => reject(new Error('Response lost')));
  await press('Workspace Mail'); await press(`Read Mail ${plan.from}`); await screen.findByText(/Task result is uncertain/);
  expect(screen.getByLabelText('Connected Task title')).toHaveDisplayValue('Additional reviewed Task'); expect(screen.getByLabelText('Connected Task title')).toBeDisabled(); expect(screen.getByRole('button', { name: 'Search Mail' })).toBeDisabled();
  const calls = jest.mocked(f.controller.createMailTask).mock.calls, frozen = calls.at(-1)![3]; expect(frozen.requestId).toBe('11111111-1111-4111-8111-111111111111');
  await press('Refresh Mail'); await screen.findByRole('header', { name: 'Proposal' }); await press('Retry same Task request Additional reviewed Task');
  await screen.findByRole('button', { name: 'Create another Task from Proposal' });
  expect(jest.mocked(f.controller.createMailTask).mock.calls.at(-1)![3]).toEqual(frozen);
  expect(f.snapshot.work.tasks.filter(task => task.title === 'Additional reviewed Task')).toHaveLength(1);
});
test('stopping an uncertain request requires confirmation, preserves authored work and the previous receipt, and unlocks browsing after source loss', async () => {
  const f = fixture(); const root = await create(f); await press('Workspace Mail'); await press(`Read Mail ${plan.from}`);
  await fireEvent.changeText(await screen.findByLabelText('Connected Task title'), 'Additional title to keep');
  jest.spyOn(f.controller, 'createMailTask').mockRejectedValueOnce(Object.assign(new Error(), { code: 'message_unavailable' }));
  await press('Create another Task from Proposal'); await screen.findByText(/Task result is uncertain/);
  const original = await f.controller.mail(owner, id, connection);
  jest.spyOn(f.controller, 'mail').mockResolvedValue({ ...original, page: { ...original.page, messages: [] } });
  await press('Refresh Mail'); await screen.findByText('This page has no messages.');
  expect(screen.getByRole('button', { name: 'Search Mail' })).toBeDisabled();
  await press('Stop retrying Task request'); await screen.findByText(/A Task may already exist/);
  expect(screen.queryByRole('button', { name: 'Retry same Task request Additional title to keep' })).toBeNull();
  await press('Keep Task request for retry'); expect(screen.getByRole('button', { name: 'Search Mail' })).toBeDisabled();
  await press('Stop retrying Task request'); await press('Confirm stop retrying Task request');
  expect(screen.queryByText(/Task result is uncertain/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Search Mail' })).toBeEnabled();
  expect(screen.getByLabelText('Connected Task title')).toHaveDisplayValue('Additional title to keep'); expect(screen.getByLabelText('Connected Task title')).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Open linked Task Reviewed proposal' })).toBeTruthy();
  expect(f.controller.createMailTask).toHaveBeenCalledTimes(2); expect(f.snapshot.work.tasks).toHaveLength(1);
  await root.unmount();
});
test('Pause rejects an already queued automatic callback, while re-enabling permits the next bounded refresh', async () => {
  const f = fixture(); jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
  const schedule = globalThis.setTimeout; let queued: (() => void) | undefined;
  const timeout = jest.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay, ...args) => { if (delay === 60000 && typeof callback === 'function') queued = callback as () => void; return schedule(callback, delay, ...args); });
  let root: Awaited<ReturnType<typeof open>> | undefined;
  try {
    root = await open(f); await press('Workspace Mail'); await press(`Read Mail ${plan.from}`); await screen.findByRole('header', { name: 'Proposal' });
    expect(queued).toBeDefined(); const reads = jest.mocked(f.controller.mail).mock.calls.length;
    await press('Pause Mail auto refresh'); await act(async () => { queued!(); });
    expect(f.controller.mail).toHaveBeenCalledTimes(reads);
    await press('Enable Mail auto refresh'); await act(async () => { jest.advanceTimersByTime(60000); });
    expect(f.controller.mail).toHaveBeenCalledTimes(reads + 1); expect(f.controller.message).not.toHaveBeenCalled();
  } finally { await root?.unmount(); timeout.mockRestore(); jest.useRealTimers(); }
});
test('offline hides Mail immediately, drops a late body and requires explicit recovery after reconnect', async () => {
  const f = fixture(), listeners = new Set<(state: NetworkState) => void>();
  const original = jest.mocked(addNetworkStateListener).getMockImplementation()!;
  jest.mocked(addNetworkStateListener).mockImplementation(listener => { listeners.add(listener); return { remove: () => listeners.delete(listener) }; });
  jest.useFakeTimers({ doNotFake: ['queueMicrotask'] }); let root: Awaited<ReturnType<typeof open>> | undefined;
  try {
    root = await open(f); await press('Workspace Mail'); await press(`Read Mail ${plan.from}`); await screen.findByLabelText('Connected Task title');
    await fireEvent.changeText(screen.getByLabelText('Connected Task title'), 'Keep offline title');
    const full = await f.controller.source(owner, id, 'task'); let release!: (value: { workspaceId: string; mode: 'google-fixture'; message: typeof full.message }) => void;
    jest.spyOn(f.controller, 'message').mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    await press('Read message Proposal');
    await act(async () => { listeners.forEach(listener => listener({ isConnected: false, isInternetReachable: false })); });
    await screen.findByText(/Mail is offline/); expect(screen.queryByRole('header', { name: 'Proposal' })).toBeNull();
    await act(async () => release({ workspaceId: id, mode: 'google-fixture', message: full.message })); expect(screen.queryByText(full.message.body)).toBeNull();
    const reads = jest.mocked(f.controller.mail).mock.calls.length;
    await act(async () => { jest.advanceTimersByTime(120000); }); expect(f.controller.mail).toHaveBeenCalledTimes(reads);
    expect(screen.getByRole('button', { name: 'Refresh Mail' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'First Mail page' })).toBeDisabled();
    await act(async () => { listeners.forEach(listener => listener({ isConnected: true, isInternetReachable: true })); });
    expect(f.controller.mail).toHaveBeenCalledTimes(reads); expect(screen.getByLabelText('Connected Task title')).toHaveDisplayValue('Keep offline title');
    await press('Refresh Mail'); await screen.findByRole('header', { name: 'Proposal' }); expect(screen.queryByText(full.message.body)).toBeNull();
  } finally { await root?.unmount(); jest.mocked(addNetworkStateListener).mockImplementation(original); jest.useRealTimers(); }
});
test('folder/search/cursor controls retain applied query and recover honestly from bad search or removed folders', async () => {
  const f = fixture(), original = await f.controller.mail(owner, id, connection); let missingFolder = false;
  const reviewId = `${account}:folder:Label_review`;
  const folders = [{ id: `${account}:folder:INBOX`, accountId: account, upstreamId: 'INBOX', name: 'Inbox' }, { id: reviewId, accountId: account, upstreamId: 'Label_review', name: 'Review' }];
  const first = original.page.messages[0]!, second = { ...first, id: `${account}:message:m2`, upstreamId: 'm2', upstreamThreadId: 't2', threadId: `${account}:thread:t2`, subject: 'Proposal follow-up' };
  jest.spyOn(f.controller, 'mail').mockImplementation(async (_owner, _id, _connection, query = {}) => {
    if (query.search === 'reject') throw Object.assign(new Error(), { code: 'search_rejected' });
    if (missingFolder && query.folderId === reviewId) throw Object.assign(new Error(), { code: 'folder_unavailable' });
    const later = query.cursor === 'next' || query.folderId === reviewId;
    return { ...original, freshness: mailReadFreshness(Date.now(), Date.now() + 3600000), page: { ...original.page, folders, messages: query.search === 'subject:missing' ? [] : [later ? second : first], nextCursor: later ? null : 'next' } };
  });
  await open(f); await press('Workspace Mail'); await press(`Read Mail ${plan.from}`); await screen.findByRole('header', { name: 'Proposal' });
  const before = jest.mocked(f.controller.mail).mock.calls.length;
  await fireEvent.changeText(screen.getByLabelText('Search Gmail'), 'subject:proposal'); expect(f.controller.mail).toHaveBeenCalledTimes(before);
  await press('Search Mail'); await screen.findByText('Applied search: subject:proposal'); await press('Next Mail page'); await screen.findByText('Mail page 2');
  expect(jest.mocked(f.controller.mail).mock.calls.at(-1)![3]).toEqual({ cursor: 'next', folderId: undefined, search: 'subject:proposal' });
  await press('First Mail page'); await screen.findByText('Mail page 1'); await press('Mail folder: All Mail'); await press('Folder Review'); await screen.findByRole('header', { name: 'Proposal follow-up' });
  expect(jest.mocked(f.controller.mail).mock.calls.at(-1)![3]).toEqual({ cursor: undefined, folderId: reviewId, search: 'subject:proposal' });
  missingFolder = true; await press('Refresh Mail'); await screen.findByText(/This folder is unavailable/); expect(screen.queryByRole('header', { name: 'Proposal follow-up' })).toBeNull();
  await press('Read All Mail'); await screen.findByRole('header', { name: 'Proposal' }); expect(jest.mocked(f.controller.mail).mock.calls.at(-1)![3]?.search).toBe('subject:proposal');
  await fireEvent.changeText(screen.getByLabelText('Connected Task title'), 'Keep authored Task through failure'); await fireEvent.changeText(screen.getByLabelText('Search Gmail'), 'reject'); await press('Search Mail'); await screen.findByText(/Search unavailable/);
  expect(screen.queryByRole('header', { name: 'Proposal' })).toBeNull(); expect(screen.getByLabelText('Connected Task title')).toHaveDisplayValue('Keep authored Task through failure');
  await press('Clear Mail search'); await screen.findByRole('header', { name: 'Proposal' });
  await fireEvent.changeText(screen.getByLabelText('Search Gmail'), 'subject:missing'); await press('Search Mail'); await screen.findByText('This page has no messages.'); expect(screen.queryByRole('header', { name: 'Proposal' })).toBeNull();
});
test('foreground stale/expired observations hide provider details and require explicit refresh, retaining authored titles', async () => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask'] }); const f = fixture(); let root: Awaited<ReturnType<typeof open>> | undefined;
  try {
    root = await open(f); await press('Workspace Mail'); await press(`Read Mail ${plan.from}`); await screen.findByLabelText('Connected Task title');
    await press('Pause Mail auto refresh'); await fireEvent.changeText(screen.getByLabelText('Connected Task title'), 'Retained past expiry');
    await act(async () => { jest.advanceTimersByTime(61000); }); await screen.findByText(/These details may be out of date/);
    const reads = jest.mocked(f.controller.mail).mock.calls.length;
    await act(async () => { jest.advanceTimersByTime(241000); }); await screen.findByText(/This Mail view expired/);
    expect(screen.queryByRole('header', { name: 'Proposal' })).toBeNull(); expect(screen.getByLabelText('Connected Task title')).toHaveDisplayValue('Retained past expiry'); expect(f.controller.mail).toHaveBeenCalledTimes(reads);
    await press('Refresh Mail'); await screen.findByRole('header', { name: 'Proposal' });
  } finally { await root?.unmount(); jest.useRealTimers(); }
});
