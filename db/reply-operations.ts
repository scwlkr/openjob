import type { FirebaseConfig } from './firestore-rest.ts';
import { createDurableOperationRepository } from './durable-operations.ts';
import { OPERATION_ID, operationFail, operationIdentity, operationView, validateFrozenReply, validateOperationInput, validateOperationJob, validateStoredOperation, type OperationOutcome, type FrozenReplyPayload, type ReplyOperationInput, type StoredOperation, type ReplyOperationView } from '../shared/reply-operation.ts';
/** Exact reply.simulate schema/collections remain fixture-only. */
export function createReplyOperationRepository(config: FirebaseConfig, transport: typeof fetch, options: { now?: () => number } = {}) {
  return createDurableOperationRepository<ReplyOperationInput, FrozenReplyPayload, StoredOperation, ReplyOperationView, string>(config, transport, {
    namespace: 'v1Fixture', idPattern: OPERATION_ID, idPrefix: 'op_',
    input: validateOperationInput, payload: validateFrozenReply, record: validateStoredOperation, job: validateOperationJob,
    identity: operationIdentity, view: operationView,
    assertPayload(owner, workspaceId, input, value) {
      if (value.ownerUserId !== owner || value.workspaceId !== workspaceId || value.taskId !== input.taskId || value.draft.revision !== input.draftRevision || value.reviewToken !== input.reviewToken) operationFail();
    },
    async verifyPayload(op, value) {
      const input = { action: op.action, taskId: op.taskId, requestId: op.requestId, draftRevision: op.draftRevision, reviewToken: value.reviewToken };
      if (value.ownerUserId !== op.ownerUserId || value.workspaceId !== op.workspaceId || value.taskId !== op.taskId || value.draft.revision !== op.draftRevision || (await operationIdentity(op.ownerUserId, op.workspaceId, input)).requestHash !== op.requestHash) operationFail('invalid_state');
    },
    initial: (base, input) => validateStoredOperation({ ...base, draftRevision: input.draftRevision }),
    finished: (op, state, outcome, updatedAt, receiptId?: string) => validateStoredOperation({ ...op, state, outcome: outcome as OperationOutcome, updatedAt, ...(receiptId ? { receiptId } : {}) }),
  }, options);
}
export type ReplyOperationRepository = ReturnType<typeof createReplyOperationRepository>;
export type { FrozenReplyPayload };
