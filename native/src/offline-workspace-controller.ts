import { applyTaskCalendarCommand, validateTaskCalendarProjection } from '../../shared/task-calendar-sync';
import type { TaskCalendarCommand } from '../../shared/task-calendar-sync';
import { validateOfflineWorkspaceRecord } from './offline-workspace-record';
import type { NativeOfflineWorkspaceCache, NativeOfflineWorkspaceController, NativeOfflineWorkspaceRecord, NativeOfflineWorkspaceState, TaskCalendarSyncSnapshot, TaskCalendarSyncInput, TaskCalendarSyncAck } from './offline-workspace-contracts';

type Options = {
  cache: NativeOfflineWorkspaceCache; capture(owner: string): () => void;
  read(owner: string): Promise<TaskCalendarSyncSnapshot>;
  write(owner: string, input: TaskCalendarSyncInput): Promise<TaskCalendarSyncAck>;
  randomUUID(): string; now?: () => number;
};
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const code = (error: unknown) => error && typeof error === 'object' && 'code' in error ? String(error.code) : 'offline';
const authDenied = (error: unknown) => ['authentication_required', 'account_deletion_pending', 'revoked', 'sign_in_method_unrecognized'].includes(code(error)) || !!error && typeof error === 'object' && 'status' in error && [401, 410].includes(Number(error.status));
/** No native runtime dependencies: storage, identities, clocks, UUIDs and HTTP are injected. */
export function createNativeOfflineWorkspaceController({ cache, capture, read, write, randomUUID, now = Date.now }: Options): NativeOfflineWorkspaceController {
  let tail = Promise.resolve();
  const reviews = new Map<string, { snapshot: TaskCalendarSyncSnapshot; guard: () => void }>();
  async function serial(owner: string, action: (guard: () => void) => Promise<NativeOfflineWorkspaceState>) {
    const guard = capture(owner); guard();
    const previous = tail; let release!: () => void; tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { guard(); const result = await action(guard); guard(); return clone(result); } finally { release(); }
  }
  function review(owner: string) {
    const current = reviews.get(owner);
    if (current) { try { current.guard(); return current.snapshot; } catch { reviews.delete(owner); } }
    return undefined;
  }
  function state(owner: string, record: NativeOfflineWorkspaceRecord | null, error?: string): NativeOfflineWorkspaceState {
    if (!record) return { status: 'empty', pendingCount: 0, ...(error ? { error } : {}) };
    const currentServer = review(owner);
    return { projection: record.pending?.projection ?? record.projection, revision: record.revision, pendingCount: record.pending ? 1 : 0,
      status: record.pending ? currentServer ? 'conflict' : 'pending' : 'synced',
      ...(currentServer && record.pending ? { currentServer } : {}), ...(error ? { error } : {}) };
  }
  async function load(owner: string, guard: () => void) { guard(); const record = await cache.load(owner, guard); guard(); return record ? validateOfflineWorkspaceRecord(record, owner) : null; }
  async function save(record: NativeOfflineWorkspaceRecord, guard: () => void) { guard(); await cache.save(record, guard); guard(); }
  async function remote(owner: string, guard: () => void) { guard(); const value = await read(owner); guard(); return { revision: value.revision, projection: validateTaskCalendarProjection(owner, value.projection) }; }
  async function publish(owner: string, record: NativeOfflineWorkspaceRecord, guard: () => void): Promise<NativeOfflineWorkspaceState> {
    if (!record.pending) return state(owner, record);
    if (review(owner)) return state(owner, record, 'review_required');
    if (Date.parse(record.pending.expiresAt) <= now() && !record.pending.attempted) {
      const current = await remote(owner, guard); reviews.set(owner, { snapshot: current, guard }); return state(owner, record, 'expired');
    }
    const attempted = { ...record, pending: { ...record.pending, attempted: true } };
    await save(attempted, guard);
    const { attempted: omitted, ...input } = attempted.pending; void omitted;
    try {
      guard(); const ack = await write(owner, clone(input)); guard();
      if (ack.operationId !== input.operationId || !/^tc1_[a-f0-9]{64}$/.test(ack.revision)) throw Object.assign(new Error('Invalid sync acknowledgment.'), { code: 'invalid_response' });
      // A replayed acknowledgment can be historical. Read the current server state before clearing the durable batch.
      const current = await remote(owner, guard);
      if (current.revision !== ack.revision) {
        reviews.set(owner, { snapshot: current, guard }); return state(owner, attempted, 'conflict');
      }
      const confirmed = { ownerUserId: owner, ...current };
      await save(confirmed, guard); reviews.delete(owner); return state(owner, confirmed);
    } catch (error) {
      guard();
      if (authDenied(error)) throw error;
      if (code(error) === 'conflict' || code(error) === 'sync_expired') {
        try { const current = await remote(owner, guard); reviews.set(owner, { snapshot: current, guard }); } catch (error) { guard(); if (authDenied(error)) throw error; }
        return state(owner, attempted, 'conflict');
      }
      if (error && typeof error === 'object' && 'status' in error && [400, 403, 413].includes(Number(error.status)) && ['invalid_input', 'invalid_request', 'forbidden', 'workspace_capacity', 'body_too_large'].includes(code(error))) {
        const rejected = { ...attempted, pending: { ...attempted.pending, attempted: false } };
        await save(rejected, guard); return state(owner, rejected, code(error));
      }
      return state(owner, attempted, code(error) === 'invalid_response' ? 'invalid_response' : 'offline');
    }
  }
  return Object.freeze({
    load: owner => serial(owner, async guard => state(owner, await load(owner, guard))),
    refresh: owner => serial(owner, async guard => {
      const record = await load(owner, guard);
      try {
        const current = await remote(owner, guard);
        if (record?.pending) {
          if (current.revision !== record.pending.baseRevision || Date.parse(record.pending.expiresAt) <= now()) reviews.set(owner, { snapshot: current, guard });
          return state(owner, record);
        }
        const updated = { ownerUserId: owner, ...current }; await save(updated, guard); reviews.delete(owner); return state(owner, updated);
      } catch (error) { guard(); if (authDenied(error)) throw error; return state(owner, record, 'offline'); }
    }),
    edit: (owner, input) => serial(owner, async guard => {
      const record = await load(owner, guard);
      if (!record) return state(owner, record, 'refresh_required');
      if (record.pending?.attempted) return state(owner, record, 'retry_sync_before_edit');
      if (!/^(task|calendar)\./.test(input.type)) return state(owner, record, 'invalid_input');
      const projection = applyTaskCalendarCommand(record.pending?.projection ?? record.projection, input as TaskCalendarCommand, owner, () => `offline_${randomUUID()}`);
      const pending = record.pending ? { ...record.pending, projection } : { baseRevision: record.revision, operationId: randomUUID(), expiresAt: new Date(now() + 86400000).toISOString(), projection, attempted: false };
      const updated = { ...record, pending };
      try { await save(updated, guard); return state(owner, updated); } catch { guard(); return state(owner, record, 'storage'); }
    }),
    sync: owner => serial(owner, async guard => {
      const record = await load(owner, guard); if (!record) return state(owner, record, 'refresh_required');
      return publish(owner, record, guard);
    }),
    resolve: (owner, choice) => serial(owner, async guard => {
      const record = await load(owner, guard); if (!record?.pending) return state(owner, record);
      const reviewed = review(owner);
      const current = await remote(owner, guard);
      if (choice === 'server') {
        const updated = { ownerUserId: owner, ...current }; await save(updated, guard); reviews.delete(owner); return state(owner, updated);
      }
      if (choice !== 'local' || !reviewed || reviewed.revision !== current.revision) { reviews.set(owner, { snapshot: current, guard }); return state(owner, record, 'review_required'); }
      const pending = { baseRevision: current.revision, operationId: randomUUID(), expiresAt: new Date(now() + 86400000).toISOString(), projection: record.pending.projection, attempted: false };
      const updated = { ...record, revision: current.revision, pending }; await save(updated, guard); reviews.delete(owner);
      return publish(owner, updated, guard);
    }),
  });
}
