import type { MailTaskSource } from './mail-task-source.ts';

export type ReplyMode = 'reply' | 'reply-all';
export type ReplyPlan = { from: string; to: string[]; cc: string[]; subject: string; inReplyTo?: string; references: string[] };
export type ConnectedReplyDraft = { storageKind: 'openjob'; mode: ReplyMode; plan: ReplyPlan; body: string; revision: number; updatedAt: string };
export type ReplySource = Pick<MailTaskSource, 'workspaceId' | 'connectionId' | 'accountId' | 'messageId' | 'threadId'>;
export type StoredConnectedReply = { source: ReplySource; draft: ConnectedReplyDraft };
export type ReplyPreparation = { workspaceId: string; taskId: string; storageKind: 'openjob'; plans: { reply: ReplyPlan; replyAll: ReplyPlan }; reviewToken: string; draft: ConnectedReplyDraft | null };
export type ReplySaveInput = { mode: ReplyMode; body: string; expectedRevision: number; reviewToken: string };
export const sameReplyPlan = (a: ReplyPlan, b: ReplyPlan) => a.from === b.from && a.subject === b.subject && a.inReplyTo === b.inReplyTo && JSON.stringify([a.to, a.cc, a.references]) === JSON.stringify([b.to, b.cc, b.references]);
export type ConnectedReplyStore = {
  connectedReply(owner: string, source: MailTaskSource): Promise<ConnectedReplyDraft | undefined>;
  saveConnectedReply(owner: string, source: MailTaskSource, input: Pick<ConnectedReplyDraft, 'mode' | 'plan' | 'body'>, expectedRevision: number, current: () => Promise<void>): Promise<ConnectedReplyDraft>;
};
export const replySource = ({ workspaceId, connectionId, accountId, messageId, threadId }: ReplySource): ReplySource => ({ workspaceId, connectionId, accountId, messageId, threadId });
export const sameReplySource = (a: ReplySource, b: ReplySource) => JSON.stringify(replySource(a)) === JSON.stringify(replySource(b));
const fail = (code = 'invalid_state'): never => { throw Object.assign(new Error('Connected reply unavailable.'), { code }); };
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max && !/[\u0000\r\n\u007f]/.test(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: object, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
export function validReplyPlan(plan: ReplyPlan) {
  return record(plan) && keys(plan, ['from', 'to', 'cc', 'subject', 'inReplyTo', 'references']) && text(plan.from, 320) && !!plan.from && text(plan.subject, 4096)
    && Array.isArray(plan.to) && plan.to.length > 0 && plan.to.length <= 50 && plan.to.every(item => text(item, 320) && !!item)
    && Array.isArray(plan.cc) && plan.cc.length <= 50 && plan.cc.every(item => text(item, 320) && !!item)
    && (plan.inReplyTo === undefined || text(plan.inReplyTo, 998)) && Array.isArray(plan.references) && plan.references.length <= 100 && plan.references.every(item => text(item, 998));
}
export function validateConnectedReplyDraft(value: unknown): ConnectedReplyDraft {
  const draft = value as ConnectedReplyDraft;
  if (!record(draft) || !keys(draft, ['storageKind', 'mode', 'plan', 'body', 'revision', 'updatedAt']) || draft.storageKind !== 'openjob' || !['reply', 'reply-all'].includes(draft.mode) || !validReplyPlan(draft.plan) || typeof draft.body !== 'string' || draft.body.length > 20000 || /\u0000/.test(draft.body) || !Number.isSafeInteger(draft.revision) || draft.revision < 1 || draft.revision > 1_000_000 || !text(draft.updatedAt, 64) || !Number.isFinite(Date.parse(draft.updatedAt))) fail();
  return draft;
}
export function validateReplySave(input: ReplySaveInput) {
  if (!record(input) || !keys(input, ['mode', 'body', 'expectedRevision', 'reviewToken']) || !['reply', 'reply-all'].includes(input.mode) || typeof input.body !== 'string' || input.body.length > 20000 || /\u0000/.test(input.body) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || input.expectedRevision >= 1_000_000 || !/^[a-f0-9]{64}$/.test(input.reviewToken)) fail('invalid_input');
  return input;
}
export function parseConnectedReplies(encoded?: string): StoredConnectedReply[] {
  if (encoded === undefined) return [];
  const rows = JSON.parse(encoded) as StoredConnectedReply[];
  if (!Array.isArray(rows) || rows.length > 100) fail();
  const seen = new Set<string>();
  for (const row of rows) {
    if (!record(row) || !keys(row, ['source', 'draft']) || !record(row.source) || !keys(row.source, ['workspaceId', 'connectionId', 'accountId', 'messageId', 'threadId'])) fail();
    const source = row.source, draft = row.draft;
    if (!/^wsp_[a-f0-9]{32}$/.test(source.workspaceId) || !/^con_[a-f0-9]{32}$/.test(source.connectionId) || !/^gmail_[a-f0-9]{32}$/.test(source.accountId) || !/^[A-Za-z0-9_-]{1,128}$/.test(source.messageId) || !/^[A-Za-z0-9_-]{1,128}$/.test(source.threadId)) fail();
    validateConnectedReplyDraft(draft);
    const key = JSON.stringify(replySource(source)); if (seen.has(key)) fail(); seen.add(key);
  }
  return rows;
}
/** Same authored save is safe to retry after a lost response; different stale text conflicts. */
export function upsertConnectedReply(rows: StoredConnectedReply[], source: MailTaskSource, input: Pick<ConnectedReplyDraft, 'mode' | 'plan' | 'body'>, expectedRevision: number) {
  const existing = rows.find(row => sameReplySource(row.source, source));
  if (existing && existing.draft.mode === input.mode && existing.draft.body === input.body && JSON.stringify(existing.draft.plan) === JSON.stringify(input.plan)) return { rows, draft: existing.draft, unchanged: true };
  if ((existing?.draft.revision ?? 0) !== expectedRevision) fail('conflict');
  if (!existing && rows.length >= 100) fail('workspace_capacity');
  const draft: ConnectedReplyDraft = { storageKind: 'openjob', ...input, revision: expectedRevision + 1, updatedAt: new Date().toISOString() };
  const next = [...rows.filter(row => !sameReplySource(row.source, source)), { source: replySource(source), draft }];
  return { rows: parseConnectedReplies(JSON.stringify(next)), draft, unchanged: false };
}
