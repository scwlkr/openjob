import type { NativeOfflineWorkspaceRecord } from './offline-workspace-contracts';
import { validateTaskCalendarProjection } from '../../shared/task-calendar-sync';
export function validateOfflineWorkspaceRecord(value: unknown, owner: string): NativeOfflineWorkspaceRecord {
  const invalid = (): never => { throw new Error('Invalid offline workspace record.'); };
  const object = (input: unknown): input is Record<string, unknown> => !!input && typeof input === 'object' && !Array.isArray(input);
  if (!object(value)) return invalid();
  if (Object.keys(value).some(key => !['ownerUserId', 'revision', 'projection', 'pending'].includes(key)) || value.ownerUserId !== owner || !/^[A-Za-z0-9_-]{1,128}$/.test(owner) || typeof value.revision !== 'string' || !/^tc1_[a-f0-9]{64}$/.test(value.revision)) return invalid();
  const projection = validateTaskCalendarProjection(owner, value.projection);
  const record: NativeOfflineWorkspaceRecord = { ownerUserId: owner, revision: value.revision, projection };
  if (value.pending !== undefined) {
    const pending = value.pending;
    if (!object(pending)) return invalid();
    if (Object.keys(pending).sort().join(',') !== 'attempted,baseRevision,expiresAt,operationId,projection' || typeof pending.baseRevision !== 'string' || !/^tc1_[a-f0-9]{64}$/.test(pending.baseRevision) || typeof pending.operationId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(pending.operationId) || typeof pending.attempted !== 'boolean' || typeof pending.expiresAt !== 'string' || !Number.isFinite(Date.parse(pending.expiresAt)) || new Date(pending.expiresAt).toISOString() !== pending.expiresAt) return invalid();
    record.pending = { baseRevision: pending.baseRevision, operationId: pending.operationId, expiresAt: pending.expiresAt, attempted: pending.attempted, projection: validateTaskCalendarProjection(owner, pending.projection) };
  }
  return record;
}
