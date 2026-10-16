import { createNativeOfflineWorkspaceController } from '../src/offline-workspace-controller';
import type { NativeOfflineWorkspaceCache, NativeOfflineWorkspaceRecord, TaskCalendarSyncInput, TaskCalendarSyncSnapshot } from '../src/offline-workspace-contracts';
const owner = 'user_alex';
const revision = (value: string) => `tc1_${value.repeat(64)}`;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function fixture() {
  let stored: NativeOfflineWorkspaceRecord | null = null, epoch = 0, confirmed = true, activeOwner = owner, id = 0, failSave = false, lost = false;
  let server: TaskCalendarSyncSnapshot = { revision: revision('a'), projection: { tasks: [], calendars: [{ id: 'personal', ownerId: owner, name: 'Personal', color: '#2454dc' }], events: [] } };
  const receipts = new Map<string, { operationId: string; revision: string }>();
  const cache: NativeOfflineWorkspaceCache = {
    async load(expected, guard = () => undefined) { guard(); return stored?.ownerUserId === expected ? clone(stored) : null; },
    async save(value, guard = () => undefined) { guard(); if (failSave) throw new Error('Storage unavailable.'); stored = clone(value); guard(); },
    async purge() { stored = null; },
  };
  const read = jest.fn(async () => { if (!confirmed) throw Object.assign(new Error('Not confirmed.'), { code: 'revoked' }); return clone(server); });
  const write = jest.fn(async (_owner: string, input: TaskCalendarSyncInput) => {
    if (!confirmed) throw Object.assign(new Error('Not confirmed.'), { code: 'revoked' });
    const replay = receipts.get(input.operationId); if (replay) return replay;
    if (input.baseRevision !== server.revision) throw Object.assign(new Error('Conflict.'), { code: 'conflict' });
    server = { revision: revision('b'), projection: clone(input.projection) }; const ack = { operationId: input.operationId, revision: server.revision }; receipts.set(input.operationId, ack);
    if (lost) { lost = false; throw Object.assign(new Error('Lost response.'), { code: 'offline' }); } return ack;
  });
  const construct = () => createNativeOfflineWorkspaceController({ cache, read, write, now: () => Date.parse('2026-10-17T00:00:00.000Z'), randomUUID: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`, capture(expected) { const captured = epoch; const guard = () => { if (expected !== activeOwner || epoch !== captured) throw Object.assign(new Error('Stale owner.'), { code: 'revoked' }); }; guard(); return guard; } });
  return { cache, read, write, construct, controller: construct(), stored: () => stored, setFailSave(value: boolean) { failSave = value; }, loseResponse() { lost = true; }, provisional() { confirmed = false; }, changeOwner() { epoch++; activeOwner = 'user_sam'; }, replaceServer(value: TaskCalendarSyncSnapshot) { server = clone(value); }, server: () => clone(server) };
}
test('offline projection and stable pending operation survive restart; failed save never reports a new pending edit', async () => {
  const f = fixture(); await f.controller.refresh(owner);
  const pending = await f.controller.edit(owner, { type: 'task.create', title: 'Durable task' });
  expect(pending).toMatchObject({ status: 'pending', pendingCount: 1 }); expect(f.stored()?.pending?.operationId).toMatch(/^00000000/);
  expect((await f.construct().load(owner)).projection?.tasks[0]?.title).toBe('Durable task');
  const before = clone(f.stored()); f.setFailSave(true);
  const failed = await f.controller.edit(owner, { type: 'task.create', title: 'Must not appear' });
  expect(failed.error).toBe('storage'); expect(failed.projection?.tasks).toHaveLength(1); expect(f.stored()).toEqual(before);
  expect((await f.controller.edit(owner, { type: 'mail.examples.add' })).error).toBe('invalid_input');
});
test('lost response retries the exact operation and preserves local work when its acknowledgment is historical', async () => {
  const f = fixture(); await f.controller.refresh(owner); await f.controller.edit(owner, { type: 'task.create', title: 'Local task' }); f.loseResponse();
  expect(await f.controller.sync(owner)).toMatchObject({ status: 'pending', error: 'offline' });
  const submitted = clone(f.write.mock.calls[0]![1]); const restarted = f.construct();
  expect((await restarted.edit(owner, { type: 'task.create', title: 'Blocked until retry' })).error).toBe('retry_sync_before_edit');
  f.replaceServer({ ...f.server(), revision: revision('c'), projection: { ...f.server().projection, tasks: [...f.server().projection.tasks, { id: 'server_task', ownerId: owner, title: 'Later server edit', completed: false }] } });
  const conflicted = await restarted.sync(owner); expect(conflicted).toMatchObject({ status: 'conflict', error: 'conflict', currentServer: { revision: revision('c') } });
  expect(conflicted.projection?.tasks).toHaveLength(1); expect(conflicted.currentServer?.projection.tasks).toHaveLength(2);
  expect(f.write.mock.calls[1]![1]).toEqual(submitted); expect(f.stored()?.pending).toMatchObject({ ...submitted, attempted: true });
  expect((await restarted.resolve(owner, 'server')).projection?.tasks).toHaveLength(2); expect(f.stored()?.pending).toBeUndefined();
});
test('a server edit between a successful acknowledgment and its follow-up read requires explicit local resolution', async () => {
  const f = fixture(); await f.controller.refresh(owner); await f.controller.edit(owner, { type: 'task.create', title: 'Local choice' });
  const original = f.write.getMockImplementation()!;
  f.write.mockImplementationOnce(async (...args) => {
    const ack = await original(...args);
    f.replaceServer({ ...f.server(), revision: revision('c'), projection: { ...f.server().projection, tasks: [{ id: 'server_task', ownerId: owner, title: 'New server choice', completed: false }] } });
    return ack;
  });
  const conflicted = await f.controller.sync(owner);
  expect(conflicted).toMatchObject({ status: 'conflict', currentServer: { revision: revision('c') } });
  expect(conflicted.projection?.tasks[0]?.title).toBe('Local choice'); expect(conflicted.currentServer?.projection.tasks[0]?.title).toBe('New server choice');
  const previousId = f.stored()!.pending!.operationId;
  expect((await f.controller.resolve(owner, 'local')).status).toBe('synced');
  expect(f.write.mock.calls[1]![1]).toMatchObject({ baseRevision: revision('c') }); expect(f.write.mock.calls[1]![1].operationId).not.toBe(previousId);
  expect(f.server().projection.tasks[0]?.title).toBe('Local choice');
});
test('refresh preserves pending work; local conflict resolution requires the exact latest reviewed revision', async () => {
  const f = fixture(); await f.controller.refresh(owner); await f.controller.edit(owner, { type: 'task.create', title: 'Local choice' });
  f.replaceServer({ ...f.server(), revision: revision('c') });
  expect(await f.controller.refresh(owner)).toMatchObject({ status: 'conflict', currentServer: { revision: revision('c') } });
  f.replaceServer({ ...f.server(), revision: revision('d') });
  const stale = await f.controller.resolve(owner, 'local'); expect(stale).toMatchObject({ status: 'conflict', error: 'review_required', currentServer: { revision: revision('d') } }); expect(f.write).not.toHaveBeenCalled();
  expect((await f.controller.resolve(owner, 'local')).status).toBe('synced'); expect(f.write.mock.calls[0]![1].baseRevision).toBe(revision('d'));
  await f.controller.edit(owner, { type: 'task.create', title: 'Discard this local edit' });
  const server = f.server(); f.replaceServer({ ...server, revision: revision('e') }); await f.controller.refresh(owner);
  expect((await f.controller.resolve(owner, 'server')).projection).toEqual(server.projection); expect(f.stored()?.pending).toBeUndefined();
});
test('edits queued during a submitted batch survive the acknowledgment as a new durable batch', async () => {
  const f = fixture(); await f.controller.refresh(owner); await f.controller.edit(owner, { type: 'task.create', title: 'First' });
  const started = deferred<void>(), release = deferred<void>(); const original = f.write.getMockImplementation()!;
  f.write.mockImplementationOnce(async (...args) => { started.resolve(); await release.promise; return original(...args); });
  const sending = f.controller.sync(owner); await started.promise;
  const editing = f.controller.edit(owner, { type: 'task.create', title: 'Queued newer edit' });
  release.resolve(); expect((await sending).status).toBe('synced');
  const result = await editing; expect(result.status).toBe('pending'); expect(result.projection?.tasks).toHaveLength(2); expect(f.stored()?.pending?.baseRevision).toBe(revision('b'));
});
test('provisional local editing is allowed, while confirmed remote session and owner epoch fences remain mandatory', async () => {
  const f = fixture(); await f.controller.refresh(owner); f.provisional();
  expect((await f.controller.load(owner)).status).toBe('synced'); expect((await f.controller.edit(owner, { type: 'task.create', title: 'Offline provisional' })).status).toBe('pending');
  await expect(f.controller.refresh(owner)).rejects.toMatchObject({ code: 'revoked' }); await expect(f.controller.sync(owner)).rejects.toMatchObject({ code: 'revoked' });
  f.changeOwner(); await expect(f.controller.load(owner)).rejects.toMatchObject({ code: 'revoked' });
});
test('authentication/deletion failures during refresh, write and post-ack read are never swallowed as offline', async () => {
  for (const stage of ['refresh', 'write', 'post-ack']) {
    const f = fixture(); await f.controller.refresh(owner); await f.controller.edit(owner, { type: 'task.create', title: 'Protected pending' });
    const denied = Object.assign(new Error('Authentication denied.'), { code: 'account_deletion_pending', status: 410 });
    if (stage === 'write') f.write.mockRejectedValueOnce(denied); else f.read.mockRejectedValueOnce(denied);
    await expect(stage === 'refresh' ? f.controller.refresh(owner) : f.controller.sync(owner)).rejects.toBe(denied);
    expect(f.stored()?.pending).toBeDefined();
  }
});
test('definitively rejected capacity writes preserve the proposal and permit corrective local edits', async () => {
  const f = fixture(); await f.controller.refresh(owner); await f.controller.edit(owner, { type: 'task.create', title: 'Preserved proposal' });
  f.write.mockRejectedValueOnce(Object.assign(new Error('Capacity.'), { status: 413, code: 'workspace_capacity' }));
  expect(await f.controller.sync(owner)).toMatchObject({ status: 'pending', error: 'workspace_capacity' });
  expect(f.stored()?.pending?.attempted).toBe(false);
  const taskId = f.stored()!.pending!.projection.tasks[0]!.id;
  const corrected = await f.controller.edit(owner, { type: 'task.delete', taskId }); expect(corrected.status).toBe('pending'); expect(corrected.projection?.tasks).toHaveLength(0);
});
