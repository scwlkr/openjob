import { createFirestoreRestClient, FirestoreRequestError, type FirebaseConfig, type FirestoreDocument } from './firestore-rest.ts';
import { activeUserFenceWrite, activeUserHistoryWrite } from './user-history.ts';
import { workspaceOwnerFences } from './workspace-owner-fence.ts';
import { OPERATION_ID, OPERATION_INTENT_MS, OPERATION_LEASE_MS, OPERATION_RECEIPT_MS, operationFail, operationHash, operationIdentity, operationView, taskIdentifier, validateFrozenReply, validateOperationInput, validateOperationJob, validateStoredOperation, type FrozenReplyPayload, type OperationJob, type OperationOutcome, type StoredOperation } from '../shared/reply-operation.ts';
type IndexEntry = { id: string; workspaceId: string; taskId: string };
/** Fixture-only composition. Immutable payload, redacted Operation and leased Job are separate records. */
export function createReplyOperationRepository(config: FirebaseConfig, transport: typeof fetch, { now = Date.now }: { now?: () => number } = {}) {
  const db = createFirestoreRestClient(config, transport);
  const path = (kind: 'Operations' | 'OutboundPayloads' | 'IntegrationJobs', id: string) => { if (!OPERATION_ID.test(id)) operationFail(); return `v1Fixture${kind}/${id}`; };
  const indexPath = (owner: string) => { if (!/^user_[a-f0-9]{32}$/.test(owner)) operationFail(); return `v1FixtureOperationIndexes/${owner}`; };
  const retryable = (error: unknown) => error instanceof FirestoreRequestError && ['ABORTED', 'ALREADY_EXISTS', 'FAILED_PRECONDITION', 'NOT_FOUND'].includes(error.code ?? '');
  async function read(name: string, transaction?: string) {
    const response = await db.request(name + (transaction ? `?transaction=${encodeURIComponent(transaction)}` : ''), {}, { allowNotFound: true }); if (response.status === 404) return null;
    const doc = await response.json() as FirestoreDocument;
    if (doc.name !== db.documentName(name) || !doc.updateTime) operationFail('invalid_state'); return doc;
  }
  const write = (name: string, field: string, value: unknown, previous: FirestoreDocument | null) => ({ update: { name: db.documentName(name), fields: { [field]: { stringValue: JSON.stringify(value) } } }, currentDocument: previous ? { updateTime: previous.updateTime } : { exists: false } });
  const verify = (doc: FirestoreDocument) => ({ verify: doc.name, currentDocument: { updateTime: doc.updateTime } });
  async function commit(writes: unknown[]) { await db.request(':commit', { method: 'POST', body: JSON.stringify({ writes }) }); }
  function json(doc: FirestoreDocument, field: string): unknown {
    if (Object.keys(doc.fields ?? {}).join(',') !== field || typeof doc.fields?.[field]?.stringValue !== 'string') operationFail('invalid_state');
    try { return JSON.parse(doc.fields![field].stringValue!); } catch { return operationFail('invalid_state'); }
  }
  async function pair(id: string) {
    // A snapshot prevents a concurrent atomic state transition from producing a torn pair.
    const started = await db.request(':beginTransaction', { method: 'POST', body: JSON.stringify({ options: { readOnly: {} } }) });
    const { transaction } = await started.json() as { transaction: string };
    if (typeof transaction !== 'string' || !transaction) operationFail('invalid_state');
    try {
    const opDoc = await read(path('Operations', id), transaction); if (!opDoc) operationFail('forbidden');
    const op = validateStoredOperation(json(opDoc, 'operationJson'));
    if (op.id !== id || id !== `op_${await operationHash([op.ownerUserId, op.workspaceId, op.action, op.requestId])}`) operationFail('invalid_state');
    const jobDoc = await read(path('IntegrationJobs', id), transaction); if (!jobDoc) operationFail('invalid_state');
    return { op, opDoc, job: validateOperationJob(json(jobDoc, 'jobJson'), op), jobDoc };
    } finally { await db.request(':rollback', { method: 'POST', body: JSON.stringify({ transaction }) }); }
  }
  const scope = (op: StoredOperation, owner: string, workspaceId: string) => { if (op.ownerUserId !== owner || op.workspaceId !== workspaceId) operationFail('forbidden'); };
  async function authorized(owner: string, workspaceId: string) { const user = await activeUserFenceWrite(db, owner), workspace = await workspaceOwnerFences(db, owner, workspaceId); return [user, ...workspace]; }
  async function payload(op: StoredOperation) {
    const doc = await read(path('OutboundPayloads', op.id)); if (!doc) operationFail('invalid_state');
    const value = validateFrozenReply(json(doc, 'payloadJson'));
    const input = { action: op.action, taskId: op.taskId, requestId: op.requestId, draftRevision: op.draftRevision, reviewToken: value.reviewToken };
    if (value.ownerUserId !== op.ownerUserId || value.workspaceId !== op.workspaceId || value.taskId !== op.taskId || value.draft.revision !== op.draftRevision || await operationHash(value) !== op.payloadHash || (await operationIdentity(op.ownerUserId, op.workspaceId, input)).requestHash !== op.requestHash) operationFail('invalid_state');
    return { value, doc };
  }
  async function finish(id: string, claimId: string, state: 'confirmed' | 'rejected' | 'unknown', outcome: OperationOutcome, receiptId?: string) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await pair(id); if (!['queued', 'executing'].includes(current.op.state)) return current.op;
      if (current.job.claimId !== claimId) return current.op;
      if (current.op.state === 'queued' && state !== 'rejected') operationFail('conflict');
      const expiredExecution = current.op.state === 'executing' && Date.parse(current.job.leaseExpiresAt!) <= now();
      const next = validateStoredOperation({ ...current.op, state: expiredExecution ? 'unknown' : state, outcome: expiredExecution ? 'dispatch_unknown' : outcome, ...(receiptId && !expiredExecution ? { receiptId } : {}), updatedAt: new Date(now()).toISOString() });
      const job = validateOperationJob({ operationId: id, state: 'finished', attemptCount: current.job.attemptCount, nextAttemptAt: current.job.nextAttemptAt }, next);
      try {
        // Recording an already-dispatched outcome must survive subsequent revocation.
        // Disclosure is still fenced by get/list and the signed API's final admission check.
        await commit([write(path('Operations', id), 'operationJson', next, current.opDoc), write(path('IntegrationJobs', id), 'jobJson', job, current.jobDoc)]); return next;
      } catch (error) {
        const observed = await pair(id); if (!['queued', 'executing'].includes(observed.op.state)) return observed.op;
        if (!retryable(error)) throw error;
      }
    }
    return operationFail('conflict');
  }
  function entries(doc: FirestoreDocument | null): IndexEntry[] {
    if (!doc) return [];
    const value = json(doc, 'indexJson');
    if (!Array.isArray(value) || value.length > 100 || new Set(value.map(row => row?.id)).size !== value.length || value.some(row => !row || Object.keys(row).sort().join(',') !== 'id,taskId,workspaceId' || !OPERATION_ID.test(row.id) || !/^wsp_[a-f0-9]{32}$/.test(row.workspaceId) || !taskIdentifier(row.taskId))) operationFail('invalid_state');
    return value;
  }
  return {
    async existing(owner: string, workspaceId: string, raw: unknown) {
      const input = validateOperationInput(raw), key = await operationIdentity(owner, workspaceId, input);
      await authorized(owner, workspaceId); const doc = await read(path('Operations', key.id)); if (!doc) return undefined;
      const current = await pair(key.id); scope(current.op, owner, workspaceId);
      if (current.op.requestHash !== key.requestHash) operationFail('conflict');
      await payload(current.op); await authorized(owner, workspaceId); return operationView(current.op, now());
    },
    async enqueue(owner: string, workspaceId: string, raw: unknown, frozen: FrozenReplyPayload, current: () => Promise<void>) {
      const input = validateOperationInput(raw), value = validateFrozenReply(frozen), key = await operationIdentity(owner, workspaceId, input);
      if (value.ownerUserId !== owner || value.workspaceId !== workspaceId || value.taskId !== input.taskId || value.draft.revision !== input.draftRevision || value.reviewToken !== input.reviewToken) operationFail();
      const hash = await operationHash(value), created = now(), createdAt = new Date(created).toISOString();
      const op = validateStoredOperation({ id: key.id, ownerUserId: owner, workspaceId, taskId: input.taskId, action: input.action, requestId: input.requestId, requestHash: key.requestHash, payloadHash: hash, draftRevision: input.draftRevision, state: 'queued', createdAt, updatedAt: createdAt, dispatchBefore: new Date(created + OPERATION_INTENT_MS).toISOString(), receiptExpiresAt: new Date(created + OPERATION_RECEIPT_MS).toISOString() });
      const job: OperationJob = { operationId: key.id, state: 'queued', attemptCount: 0, nextAttemptAt: createdAt };
      for (let attempt = 0; attempt < 3; attempt++) {
        const fences = await authorized(owner, workspaceId), indexDoc = await read(indexPath(owner)), index = entries(indexDoc);
        const previous = await read(path('Operations', key.id));
        if (previous) { const existing = await pair(key.id); if (existing.op.requestHash !== key.requestHash || existing.op.payloadHash !== hash) operationFail('conflict'); await payload(existing.op); return operationView(existing.op, now()); }
        if (index.length >= 100) operationFail('workspace_capacity');
        await current();
        try {
          await commit([await activeUserHistoryWrite(db, owner), ...fences.slice(1), write(path('Operations', key.id), 'operationJson', op, null), write(path('OutboundPayloads', key.id), 'payloadJson', value, null), write(path('IntegrationJobs', key.id), 'jobJson', job, null), write(indexPath(owner), 'indexJson', [...index, { id: key.id, workspaceId, taskId: input.taskId }], indexDoc)]);
          await authorized(owner, workspaceId); return operationView(op, now());
        } catch (error) {
          if (!retryable(error)) throw error;
        }
      }
      return operationFail('conflict');
    },
    async get(owner: string, workspaceId: string, id: string) {
      await authorized(owner, workspaceId); let current = await pair(id); scope(current.op, owner, workspaceId);
      if (current.op.state === 'executing' && Date.parse(current.job.leaseExpiresAt!) <= now()) { await finish(id, current.job.claimId!, 'unknown', 'dispatch_unknown'); current = await pair(id); }
      await authorized(owner, workspaceId); return operationView(current.op, now());
    },
    async list(owner: string, workspaceId: string, taskId?: string, cursor?: string) {
      await authorized(owner, workspaceId); if (taskId !== undefined && !taskIdentifier(taskId)) operationFail();
      const index = entries(await read(indexPath(owner))).filter(row => row.workspaceId === workspaceId && (taskId === undefined || row.taskId === taskId)).reverse(); let offset = 0;
      if (cursor !== undefined) {
        try { const value = JSON.parse(atob(cursor.replaceAll('-', '+').replaceAll('_', '/'))); if (!Array.isArray(value) || value.length !== 5 || value[0] !== 1 || value[1] !== owner || value[2] !== workspaceId || value[3] !== (taskId ?? '')) operationFail('invalid_cursor'); offset = index.findIndex(row => row.id === value[4]) + 1; if (!offset) operationFail('invalid_cursor'); } catch { operationFail('invalid_cursor'); }
      }
      const items = []; for (const row of index.slice(offset, offset + 50)) items.push(await this.get(owner, workspaceId, row.id));
      const last = items.at(-1); const nextCursor = offset + items.length < index.length && last ? btoa(JSON.stringify([1, owner, workspaceId, taskId ?? '', last.id])).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '') : null;
      await authorized(owner, workspaceId); return { items, nextCursor };
    },
    async claim(owner: string, workspaceId: string, id: string) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const fences = await authorized(owner, workspaceId), current = await pair(id); scope(current.op, owner, workspaceId);
        if (current.op.state === 'executing' && Date.parse(current.job.leaseExpiresAt!) <= now()) { await finish(id, current.job.claimId!, 'unknown', 'dispatch_unknown'); return null; }
        if (current.op.state !== 'queued' || Date.parse(current.job.nextAttemptAt) > now() || current.job.leaseExpiresAt && Date.parse(current.job.leaseExpiresAt) > now()) return null;
        const claimId = crypto.randomUUID().replaceAll('-', ''), job = { ...current.job, claimId, leaseExpiresAt: new Date(now() + OPERATION_LEASE_MS).toISOString() };
        try { await commit([...fences, verify(current.opDoc), write(path('IntegrationJobs', id), 'jobJson', job, current.jobDoc)]); return claimId; } catch (error) { if (!retryable(error)) throw error; }
      }
      return null;
    },
    async begin(owner: string, workspaceId: string, id: string, claimId: string, currentAuthority: (value: FrozenReplyPayload) => Promise<void>) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const fences = await authorized(owner, workspaceId), current = await pair(id); scope(current.op, owner, workspaceId);
        if (current.op.state !== 'queued' || current.job.claimId !== claimId || Date.parse(current.job.leaseExpiresAt!) <= now()) return null;
        if (Date.parse(current.op.dispatchBefore) <= now()) { await finish(id, claimId, 'rejected', 'intent_expired'); return null; }
        let frozen; try { frozen = await payload(current.op); } catch { await finish(id, claimId, 'rejected', 'payload_invalid'); return null; }
        try { await currentAuthority(frozen.value); } catch { await finish(id, claimId, 'rejected', 'authority_changed'); return null; }
        if (Date.parse(current.job.leaseExpiresAt!) <= now()) return null;
        if (Date.parse(current.op.dispatchBefore) <= now()) { await finish(id, claimId, 'rejected', 'intent_expired'); return null; }
        const op = validateStoredOperation({ ...current.op, state: 'executing', updatedAt: new Date(now()).toISOString() }), job = validateOperationJob({ ...current.job, state: 'executing', attemptCount: 1 }, op);
        try { await commit([...fences, verify(frozen.doc), write(path('Operations', id), 'operationJson', op, current.opDoc), write(path('IntegrationJobs', id), 'jobJson', job, current.jobDoc)]); return frozen.value; } catch (error) { if (!retryable(error)) throw error; }
      }
      return null;
    },
    async dispatchReady(owner: string, workspaceId: string, id: string, claimId: string) {
      await authorized(owner, workspaceId); const current = await pair(id); scope(current.op, owner, workspaceId);
      if (current.op.state !== 'executing' || current.job.claimId !== claimId) return false;
      if (Date.parse(current.job.leaseExpiresAt!) <= now() || Date.parse(current.op.dispatchBefore) <= now()) { await finish(id, claimId, 'unknown', 'dispatch_unknown'); return false; }
      return true;
    },
    finish,
  };
}
export type ReplyOperationRepository = ReturnType<typeof createReplyOperationRepository>;
