import { parseConnectedReplies, replySource, type ConnectedReplyDraft, type ReplySource } from './connected-reply.ts';
export const OPERATION_ID = /^op_[a-f0-9]{64}$/;
export const OPERATION_INTENT_MS = 15 * 60_000;
export const OPERATION_RECEIPT_MS = 7 * 86_400_000;
export const OPERATION_LEASE_MS = 30_000;
export type ReplyOperationInput = { action: 'reply.simulate'; taskId: string; requestId: string; draftRevision: number; reviewToken: string };
export type OperationState = 'queued' | 'executing' | 'confirmed' | 'rejected' | 'unknown';
export type OperationOutcome = 'simulated_accepted' | 'synthetic_rejected' | 'authority_changed' | 'payload_invalid' | 'intent_expired' | 'dispatch_unknown';
export type FrozenReplyPayload = { version: 1; action: 'reply.simulate'; ownerUserId: string; workspaceId: string; taskId: string; source: ReplySource; connectionRevision: string; providerSubject: string; reviewToken: string; draft: ConnectedReplyDraft };
export type StoredOperation = { id: string; ownerUserId: string; workspaceId: string; taskId: string; action: 'reply.simulate'; requestId: string; requestHash: string; payloadHash: string; draftRevision: number; state: OperationState; createdAt: string; updatedAt: string; dispatchBefore: string; receiptExpiresAt: string; outcome?: OperationOutcome; receiptId?: string };
export type OperationJob = { operationId: string; state: 'queued' | 'executing' | 'finished'; attemptCount: number; nextAttemptAt: string; claimId?: string; leaseExpiresAt?: string };
export type ReplyOperationView = Omit<StoredOperation, 'ownerUserId' | 'requestHash' | 'payloadHash'> & { mode: 'fixture'; receiptExpired: boolean };
export function operationFail(code = 'invalid_input'): never { throw Object.assign(new Error('Reply operation unavailable.'), { code }); }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: object, expected: string[]) => Object.keys(value).sort().join(',') === expected.sort().join(',');
const iso = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export const taskIdentifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export function validateOperationInput(value: unknown): ReplyOperationInput {
  if (!object(value) || !keys(value, ['action', 'taskId', 'requestId', 'draftRevision', 'reviewToken']) || value.action !== 'reply.simulate' || !taskIdentifier(value.taskId) || typeof value.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.requestId) || !Number.isSafeInteger(value.draftRevision) || (value.draftRevision as number) < 1 || (value.draftRevision as number) > 1_000_000 || typeof value.reviewToken !== 'string' || !/^[a-f0-9]{64}$/.test(value.reviewToken)) operationFail();
  return { action: 'reply.simulate', taskId: value.taskId, requestId: value.requestId, draftRevision: value.draftRevision as number, reviewToken: value.reviewToken };
}
export async function operationHash(value: unknown): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function operationIdentity(owner: string, workspaceId: string, input: ReplyOperationInput) {
  return { id: `op_${await operationHash([owner, workspaceId, input.action, input.requestId])}`, requestHash: await operationHash(input) };
}
export function validateFrozenReply(value: unknown): FrozenReplyPayload {
  if (!object(value) || !keys(value, ['version', 'action', 'ownerUserId', 'workspaceId', 'taskId', 'source', 'connectionRevision', 'providerSubject', 'reviewToken', 'draft']) || value.version !== 1 || value.action !== 'reply.simulate' || typeof value.ownerUserId !== 'string' || !/^user_[a-f0-9]{32}$/.test(value.ownerUserId) || typeof value.workspaceId !== 'string' || !/^wsp_[a-f0-9]{32}$/.test(value.workspaceId) || !taskIdentifier(value.taskId) || typeof value.connectionRevision !== 'string' || !/^[a-f0-9]{32}$/.test(value.connectionRevision) || typeof value.providerSubject !== 'string' || !value.providerSubject || value.providerSubject.length > 256 || /[\u0000-\u001f\u007f]/.test(value.providerSubject) || typeof value.reviewToken !== 'string' || !/^[a-f0-9]{64}$/.test(value.reviewToken)) operationFail('invalid_state');
  let stored; try { [stored] = parseConnectedReplies(JSON.stringify([{ source: value.source, draft: value.draft }])); } catch { operationFail('invalid_state'); }
  if (!stored || stored.source.workspaceId !== value.workspaceId || !stored.draft.body.trim()) operationFail('invalid_state');
  const { plan, ...draft } = stored.draft;
  return { version: 1, action: 'reply.simulate', ownerUserId: value.ownerUserId, workspaceId: value.workspaceId, taskId: value.taskId, source: replySource(stored.source), connectionRevision: value.connectionRevision, providerSubject: value.providerSubject, reviewToken: value.reviewToken, draft: { ...draft, plan: { from: plan.from, to: [...plan.to], cc: [...plan.cc], subject: plan.subject, ...(plan.inReplyTo === undefined ? {} : { inReplyTo: plan.inReplyTo }), references: [...plan.references] } } };
}
export function validateStoredOperation(value: unknown): StoredOperation {
  if (!object(value) || !keys(value, ['id', 'ownerUserId', 'workspaceId', 'taskId', 'action', 'requestId', 'requestHash', 'payloadHash', 'draftRevision', 'state', 'createdAt', 'updatedAt', 'dispatchBefore', 'receiptExpiresAt', ...(value.outcome === undefined ? [] : ['outcome']), ...(value.receiptId === undefined ? [] : ['receiptId'])]) || typeof value.id !== 'string' || !OPERATION_ID.test(value.id) || typeof value.ownerUserId !== 'string' || !/^user_[a-f0-9]{32}$/.test(value.ownerUserId) || typeof value.workspaceId !== 'string' || !/^wsp_[a-f0-9]{32}$/.test(value.workspaceId) || !taskIdentifier(value.taskId) || value.action !== 'reply.simulate' || typeof value.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.requestId) || typeof value.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.requestHash) || typeof value.payloadHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.payloadHash) || !Number.isSafeInteger(value.draftRevision) || (value.draftRevision as number) < 1 || (value.draftRevision as number) > 1_000_000 || !['queued', 'executing', 'confirmed', 'rejected', 'unknown'].includes(value.state as string) || ![value.createdAt, value.updatedAt, value.dispatchBefore, value.receiptExpiresAt].every(iso)) operationFail('invalid_state');
  if (Date.parse(value.dispatchBefore as string) - Date.parse(value.createdAt as string) !== OPERATION_INTENT_MS || Date.parse(value.receiptExpiresAt as string) - Date.parse(value.createdAt as string) !== OPERATION_RECEIPT_MS || Date.parse(value.updatedAt as string) < Date.parse(value.createdAt as string)) operationFail('invalid_state');
  const terminal = ['confirmed', 'rejected', 'unknown'].includes(value.state as string);
  if (terminal !== (value.outcome !== undefined) || value.outcome !== undefined && !['simulated_accepted', 'synthetic_rejected', 'authority_changed', 'payload_invalid', 'intent_expired', 'dispatch_unknown'].includes(value.outcome as string) || (value.state === 'confirmed') !== (value.receiptId !== undefined) || value.receiptId !== undefined && (typeof value.receiptId !== 'string' || !/^sim_[a-f0-9]{32}$/.test(value.receiptId)) || value.state === 'confirmed' && value.outcome !== 'simulated_accepted' || value.state === 'unknown' && value.outcome !== 'dispatch_unknown' || value.state === 'rejected' && !['synthetic_rejected', 'authority_changed', 'payload_invalid', 'intent_expired'].includes(value.outcome as string)) operationFail('invalid_state');
  return structuredClone(value) as StoredOperation;
}
export function validateOperationJob(value: unknown, operation: StoredOperation): OperationJob {
  if (!object(value) || !keys(value, ['operationId', 'state', 'attemptCount', 'nextAttemptAt', ...(value.claimId === undefined ? [] : ['claimId', 'leaseExpiresAt'])]) || value.operationId !== operation.id || !['queued', 'executing', 'finished'].includes(value.state as string) || ![0, 1].includes(value.attemptCount as number) || !iso(value.nextAttemptAt) || value.claimId !== undefined && (typeof value.claimId !== 'string' || !/^[a-f0-9]{32}$/.test(value.claimId) || !iso(value.leaseExpiresAt)) || value.claimId === undefined && value.leaseExpiresAt !== undefined) operationFail('invalid_state');
  if (value.state !== (operation.state === 'queued' ? 'queued' : operation.state === 'executing' ? 'executing' : 'finished') || value.state === 'executing' && (value.attemptCount !== 1 || !value.claimId) || value.state === 'queued' && value.attemptCount !== 0 || value.state === 'finished' && value.claimId !== undefined) operationFail('invalid_state');
  return structuredClone(value) as OperationJob;
}
export function operationView(operation: StoredOperation, now: number): ReplyOperationView {
  const { ownerUserId: _, requestHash: __, payloadHash: ___, ...publicValue } = operation; void _; void __; void ___;
  return { ...structuredClone(publicValue), mode: 'fixture', receiptExpired: Date.parse(operation.receiptExpiresAt) <= now };
}
export function validateOperationView(value: unknown): ReplyOperationView {
  if (!object(value) || value.mode !== 'fixture' || typeof value.receiptExpired !== 'boolean') operationFail('invalid_state');
  const { mode, receiptExpired, ...stored } = value; void mode;
  // Validate the same redacted schema without allowing hidden payload fields through.
  if ('ownerUserId' in stored || 'requestHash' in stored || 'payloadHash' in stored) operationFail('invalid_state');
  const validated = validateStoredOperation({ ...stored, ownerUserId: 'user_' + '0'.repeat(32), requestHash: '0'.repeat(64), payloadHash: '0'.repeat(64) });
  return { ...operationView(validated, 0), receiptExpired };
}
