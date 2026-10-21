import { createFirestoreRestClient, FirestoreRequestError, type FirebaseConfig, type FirestoreDocument } from './firestore-rest.ts';
import { activeUserFenceWrite, activeUserHistoryWrite } from './user-history.ts';
import { workspaceOwnerFences } from './workspace-owner-fence.ts';
import { OPERATION_INTENT_MS, OPERATION_LEASE_MS, OPERATION_RECEIPT_MS, operationFail, operationHash, taskIdentifier, type OperationJob, type OperationState } from '../shared/reply-operation.ts';

export type DurableOperationRecord = { id: string; ownerUserId: string; workspaceId: string; taskId: string; action: string; requestId: string; requestHash: string; payloadHash: string; state: OperationState; createdAt: string; updatedAt: string; dispatchBefore: string; receiptExpiresAt: string };
export type DurableOperationInput = { action: string; taskId: string; requestId: string };
type Db = ReturnType<typeof createFirestoreRestClient>;
export type AtomicWrite = { update?: { name: string; fields: FirestoreDocument['fields'] }; verify?: string; currentDocument: { updateTime?: string; exists?: boolean } };
export type DurableOperationCodec<I extends DurableOperationInput, P, O extends DurableOperationRecord, V extends { id: string }, R> = {
  namespace: string; idPattern: RegExp; idPrefix: string;
  input(value: unknown): I; payload(value: unknown): P; record(value: unknown): O; job(value: unknown, operation: O): OperationJob;
  identity(owner: string, workspace: string, input: I): Promise<{ id: string; requestHash: string }>;
  assertPayload(owner: string, workspace: string, input: I, payload: P): void | Promise<void>;
  verifyPayload(operation: O, payload: P): Promise<void>;
  initial(base: DurableOperationRecord, input: I, payload: P): O;
  finished(operation: O, state: 'confirmed' | 'rejected' | 'unknown', outcome: string, at: string, receipt?: R): O;
  view(operation: O, now: number): V;
  enqueueWrites?(db: Db, operation: O, payload: P): Promise<AtomicWrite[]>;
  finishWrites?(db: Db, operation: O, previous: O, receipt?: R): Promise<AtomicWrite[]>;
};
type IndexEntry = { id: string; workspaceId: string; taskId: string };
/** Shared CAS/lease engine. Action codecs retain separate payloads, receipts and namespaces. */
export function createDurableOperationRepository<I extends DurableOperationInput, P, O extends DurableOperationRecord, V extends { id: string }, R>(config: FirebaseConfig, transport: typeof fetch, codec: DurableOperationCodec<I, P, O, V, R>, { now = Date.now }: { now?: () => number } = {}) {
  const db = createFirestoreRestClient(config, transport);
  const path = (kind: 'Operations' | 'OutboundPayloads' | 'IntegrationJobs', id: string) => { if (!codec.idPattern.test(id)) operationFail(); return `${codec.namespace}${kind}/${id}`; };
  const indexPath = (owner: string) => { if (!/^user_[a-f0-9]{32}$/.test(owner)) operationFail(); return `${codec.namespace}OperationIndexes/${owner}`; };
  const retryable = (error: unknown) => error instanceof FirestoreRequestError && ['ABORTED', 'ALREADY_EXISTS', 'FAILED_PRECONDITION', 'NOT_FOUND'].includes(error.code ?? '');
  async function read(name: string, transaction?: string) {
    const response = await db.request(name + (transaction ? `?transaction=${encodeURIComponent(transaction)}` : ''), {}, { allowNotFound: true }); if (response.status === 404) return null;
    const doc = await response.json() as FirestoreDocument;
    if (doc.name !== db.documentName(name) || !doc.updateTime) operationFail('invalid_state'); return doc;
  }
  const write = (name: string, field: string, value: unknown, previous: FirestoreDocument | null) => ({ update: { name: db.documentName(name), fields: { [field]: { stringValue: JSON.stringify(value) } } }, currentDocument: previous ? { updateTime: previous.updateTime } : { exists: false } });
  const verify = (doc: FirestoreDocument) => ({ verify: doc.name, currentDocument: { updateTime: doc.updateTime } });
  function combineWorkspaceFences(fences: AtomicWrite[], additions: AtomicWrite[]) {
    const retained = fences.filter(fence => {
      const update = additions.find(item => item.update?.name === fence.verify);
      if (!update) return true;
      if (JSON.stringify(update.currentDocument) !== JSON.stringify(fence.currentDocument)) operationFail('conflict');
      return false;
    });
    return [...retained, ...additions];
  }
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
    const op = codec.record(json(opDoc, 'operationJson'));
    if (op.id !== id || id !== `${codec.idPrefix}${await operationHash([op.ownerUserId, op.workspaceId, op.action, op.requestId])}`) operationFail('invalid_state');
    const jobDoc = await read(path('IntegrationJobs', id), transaction); if (!jobDoc) operationFail('invalid_state');
    return { op, opDoc, job: codec.job(json(jobDoc, 'jobJson'), op), jobDoc };
    } finally { await db.request(':rollback', { method: 'POST', body: JSON.stringify({ transaction }) }); }
  }
  const scope = (op: O, owner: string, workspaceId: string) => { if (op.ownerUserId !== owner || op.workspaceId !== workspaceId) operationFail('forbidden'); };
  async function authorized(owner: string, workspaceId: string) { const user = await activeUserFenceWrite(db, owner), workspace = await workspaceOwnerFences(db, owner, workspaceId); return [user, ...workspace]; }
  async function payload(op: O) {
    const doc = await read(path('OutboundPayloads', op.id)); if (!doc) operationFail('invalid_state');
    const value = codec.payload(json(doc, 'payloadJson'));
    if (await operationHash(value) !== op.payloadHash) operationFail('invalid_state');
    await codec.verifyPayload(op, value);
    return { value, doc };
  }
  async function finish(id: string, claimId: string, state: 'confirmed' | 'rejected' | 'unknown', outcome: string, receipt?: R) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await pair(id); if (!['queued', 'executing'].includes(current.op.state)) return current.op;
      if (current.job.claimId !== claimId) return current.op;
      if (current.op.state === 'queued' && state !== 'rejected') operationFail('conflict');
      const expiredExecution = current.op.state === 'executing' && Date.parse(current.job.leaseExpiresAt!) <= now();
      const next = codec.finished(current.op, expiredExecution ? 'unknown' : state, expiredExecution ? 'dispatch_unknown' : outcome, new Date(now()).toISOString(), expiredExecution ? undefined : receipt);
      const job = codec.job({ operationId: id, state: 'finished', attemptCount: current.job.attemptCount, nextAttemptAt: current.job.nextAttemptAt }, next);
      try {
        // Recording an already-dispatched outcome must survive subsequent revocation.
        // Disclosure is still fenced by get/list and the signed API's final admission check.
        const sideEffects = await codec.finishWrites?.(db, next, current.op, expiredExecution ? undefined : receipt) ?? [];
        await commit([...sideEffects, write(path('Operations', id), 'operationJson', next, current.opDoc), write(path('IntegrationJobs', id), 'jobJson', job, current.jobDoc)]); return next;
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
    if (!Array.isArray(value) || value.length > 100 || new Set(value.map(row => row?.id)).size !== value.length || value.some(row => !row || Object.keys(row).sort().join(',') !== 'id,taskId,workspaceId' || !codec.idPattern.test(row.id) || !/^wsp_[a-f0-9]{32}$/.test(row.workspaceId) || !taskIdentifier(row.taskId))) operationFail('invalid_state');
    return value;
  }
  return {
    async existing(owner: string, workspaceId: string, raw: unknown) {
      const input = codec.input(raw), key = await codec.identity(owner, workspaceId, input);
      await authorized(owner, workspaceId); const doc = await read(path('Operations', key.id)); if (!doc) return undefined;
      const current = await pair(key.id); scope(current.op, owner, workspaceId);
      if (current.op.requestHash !== key.requestHash) operationFail('conflict');
      await payload(current.op); await authorized(owner, workspaceId); return codec.view(current.op, now());
    },
    async enqueue(owner: string, workspaceId: string, raw: unknown, frozen: P, current: () => Promise<void>) {
      const input = codec.input(raw), value = codec.payload(frozen), key = await codec.identity(owner, workspaceId, input);
      await codec.assertPayload(owner, workspaceId, input, value);
      const hash = await operationHash(value), created = now(), createdAt = new Date(created).toISOString();
      const op = codec.initial({ id: key.id, ownerUserId: owner, workspaceId, taskId: input.taskId, action: input.action, requestId: input.requestId, requestHash: key.requestHash, payloadHash: hash, state: 'queued', createdAt, updatedAt: createdAt, dispatchBefore: new Date(created + OPERATION_INTENT_MS).toISOString(), receiptExpiresAt: new Date(created + OPERATION_RECEIPT_MS).toISOString() }, input, value);
      const job: OperationJob = { operationId: key.id, state: 'queued', attemptCount: 0, nextAttemptAt: createdAt };
      for (let attempt = 0; attempt < 3; attempt++) {
        const fences = await authorized(owner, workspaceId), indexDoc = await read(indexPath(owner)), index = entries(indexDoc);
        const previous = await read(path('Operations', key.id));
        if (previous) { const existing = await pair(key.id); if (existing.op.requestHash !== key.requestHash || existing.op.payloadHash !== hash) operationFail('conflict'); await payload(existing.op); return codec.view(existing.op, now()); }
        if (index.length >= 100) operationFail('workspace_capacity');
        try {
          await current();
          const additions = await codec.enqueueWrites?.(db, op, value) ?? [];
          const workspaceFences = combineWorkspaceFences(fences.slice(1), additions);
          await commit([await activeUserHistoryWrite(db, owner), ...workspaceFences, write(path('Operations', key.id), 'operationJson', op, null), write(path('OutboundPayloads', key.id), 'payloadJson', value, null), write(path('IntegrationJobs', key.id), 'jobJson', job, null), write(indexPath(owner), 'indexJson', [...index, { id: key.id, workspaceId, taskId: input.taskId }], indexDoc)]);
          await authorized(owner, workspaceId); return codec.view(op, now());
        } catch (error) {
          // Another identical enqueue can commit during authority or reservation
          // preparation. Recover that accepted intent before surfacing a conflict.
          const recovered = await this.existing(owner, workspaceId, input); if (recovered) return recovered;
          if (!retryable(error) && !(error && typeof error === 'object' && 'code' in error && error.code === 'conflict')) throw error;
        }
      }
      return operationFail('conflict');
    },
    async get(owner: string, workspaceId: string, id: string) {
      await authorized(owner, workspaceId); let current = await pair(id); scope(current.op, owner, workspaceId);
      if (current.op.state === 'executing' && Date.parse(current.job.leaseExpiresAt!) <= now()) { await finish(id, current.job.claimId!, 'unknown', 'dispatch_unknown'); current = await pair(id); }
      await authorized(owner, workspaceId); return codec.view(current.op, now());
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
    async begin(owner: string, workspaceId: string, id: string, claimId: string, currentAuthority: (value: P) => Promise<void>) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const fences = await authorized(owner, workspaceId), current = await pair(id); scope(current.op, owner, workspaceId);
        if (current.op.state !== 'queued' || current.job.claimId !== claimId || Date.parse(current.job.leaseExpiresAt!) <= now()) return null;
        if (Date.parse(current.op.dispatchBefore) <= now()) { await finish(id, claimId, 'rejected', 'intent_expired'); return null; }
        let frozen; try { frozen = await payload(current.op); } catch { await finish(id, claimId, 'rejected', 'payload_invalid'); return null; }
        try { await currentAuthority(frozen.value); } catch { await finish(id, claimId, 'rejected', 'authority_changed'); return null; }
        if (Date.parse(current.job.leaseExpiresAt!) <= now()) return null;
        if (Date.parse(current.op.dispatchBefore) <= now()) { await finish(id, claimId, 'rejected', 'intent_expired'); return null; }
        const op = codec.record({ ...current.op, state: 'executing', updatedAt: new Date(now()).toISOString() }), job = codec.job({ ...current.job, state: 'executing', attemptCount: 1 }, op);
        try { await commit([...fences, verify(frozen.doc), write(path('Operations', id), 'operationJson', op, current.opDoc), write(path('IntegrationJobs', id), 'jobJson', job, current.jobDoc)]); return frozen.value; } catch (error) { if (!retryable(error)) throw error; }
      }
      return null;
    },
    async dispatchReady(owner: string, workspaceId: string, id: string, claimId: string) {
      await authorized(owner, workspaceId); const current = await pair(id); scope(current.op, owner, workspaceId);
      if (current.op.state !== 'executing' || current.job.claimId !== claimId) return false;
      await authorized(owner, workspaceId);
      if (Date.parse(current.job.leaseExpiresAt!) <= now() || Date.parse(current.op.dispatchBefore) <= now()) { await finish(id, claimId, 'unknown', 'dispatch_unknown'); return false; }
      return true;
    },
    finish,
  };
}

