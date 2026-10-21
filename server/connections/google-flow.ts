import { mailReadFreshness } from '../../shared/connected-mail-freshness.ts';
import { connectionFail } from '../../shared/connection-onboarding.ts';
import { oauthHash, oauthRandom } from '../providers/provider-oauth-types.ts';
import { createGoogleOAuthAdapter, type GoogleConsentBinding } from '../providers/google-oauth-adapter.ts';
import { createGmailReadAdapter } from '../providers/gmail-read-adapter.ts';
import { googleRows, googleBinding, uuid, validAddress, type GoogleConnection, type GoogleConnectionCatalog, type PrivateGoogleConnections } from './google-state.ts';
import type { MailTaskReference, MailTaskResult, MailTaskSource } from '../../shared/mail-task-source.ts';
import { replySource, sameReplyPlan, validateReplySave, type ConnectedReplyStore, type ReplySaveInput, type ReplyPreparation } from '../../shared/connected-reply.ts';
import { replyPlans, replyReviewToken } from './reply-plan.ts';
import { operationFail, validateFrozenReply, type FrozenReplyPayload, type ReplyOperationInput } from '../../shared/reply-operation.ts';

type Options = {
  executionMode?: 'disabled' | 'configured'; evidenceMode?: 'google' | 'google-fixture';
  repository: PrivateGoogleConnections;
  homes: Partial<ConnectedReplyStore> & { list(owner: string): Promise<{ workspaceId: string; name: string }[]>;
    createMailTask?(owner: string, title: string, source: MailTaskReference, current: () => Promise<void>): Promise<MailTaskResult>;
    mailTaskSource?(owner: string, workspaceId: string, taskId: string): Promise<MailTaskSource | undefined> };
  isOwnerActive(owner: string): Promise<boolean>;
  google: Pick<Parameters<typeof createGoogleOAuthAdapter>[0], 'clientId' | 'clientSecret' | 'callbackUri' | 'transport'>;
  mailTransport?: typeof fetch;
};
/** No default backend, transport, activation flags or provider revocation. */
export function createGoogleConnectionsFlow(options: Options) {
  const { repository, homes, isOwnerActive, google, mailTransport, evidenceMode = 'google', executionMode = 'disabled' } = options;
  const configured = { ...google };
  const callback = new URL(configured.callbackUri);
  if (callback.pathname !== '/connections/google/callback') connectionFail('invalid_input');
  function enabled() { if (executionMode !== 'configured') connectionFail('not_configured'); }
  async function active(owner: string) { if (await isOwnerActive(owner) !== true) connectionFail('forbidden'); }
  async function read(owner: string) { await active(owner); const rows = googleRows(await repository.read(owner), owner); await active(owner); return rows; }
  async function change(owner: string, apply: (rows: GoogleConnection[]) => GoogleConnection[]) {
    await active(owner);
    const rows = await repository.change(owner, current => googleRows(apply(googleRows(current, owner)), owner));
    await active(owner); return googleRows(rows, owner);
  }
  async function row(owner: string, id: string) { const found = (await read(owner)).find(item => item.id === id); if (!found) connectionFail('forbidden'); return found; }
  async function home(owner: string, id: string) { await active(owner); if (!(await homes.list(owner)).some(item => item.workspaceId === id)) connectionFail('forbidden'); }
  async function replace(before: GoogleConnection, next: GoogleConnection) {
    await change(before.ownerId, rows => { if (JSON.stringify(rows.find(item => item.id === before.id)) !== JSON.stringify(before)) connectionFail('conflict'); return rows.map(item => item.id === before.id ? next : item); });
  }
  function denied(before: GoogleConnection, status: GoogleConnection['status']): GoogleConnection {
    const next = { ...before, status }; delete next.pending; delete next.grant; delete next.operation; delete next.consentExpiresAt; return next;
  }
  async function authorized(binding: GoogleConsentBinding, operation: 'consent' | 'refresh') {
    try {
      const current = (await read(binding.ownerId)).find(item => item.accountId === binding.accountId);
      if (operation === 'consent' && (!current?.consentExpiresAt || current.consentExpiresAt <= Date.now())) return false;
      if (!current || current.status !== 'authorizing' || current.operation !== (operation === 'consent' ? 'exchange' : 'refresh') || Object.entries(googleBinding(current)).some(([key, value]) => binding[key as keyof GoogleConsentBinding] !== value)) return false;
      await home(current.ownerId, current.workspaceId); return true;
    } catch { return false; }
  }
  const protocol = createGoogleOAuthAdapter({ ...configured, executionMode, isAuthorized: authorized });
  const consentProtocol = createGoogleOAuthAdapter({ ...configured, executionMode, isAuthorized: async binding => {
    try { const current = (await read(binding.ownerId)).find(item => item.accountId === binding.accountId); if (!current || current.status !== 'consent_required' || JSON.stringify(googleBinding(current)) !== JSON.stringify(binding)) return false; await home(current.ownerId, current.workspaceId); return true; } catch { return false; }
  } });
  async function failed(before: GoogleConnection) {
    try { await replace(before, denied(before, 'reconnect_required')); } catch { /* Never overwrite cancellation/new attempt. Interrupted claim remains denied. */ }
  }
  async function mailReader(owner: string, id: string) {
    enabled(); const before = await row(owner, id);
    if (!mailTransport || before.status !== 'connected' || !before.grant || !before.subject) connectionFail('reconnect_required');
    const current = async () => { await home(owner, before.workspaceId); if (JSON.stringify(await row(owner, id)) !== JSON.stringify(before) || before.grant!.entry.credential.expiresAt <= Date.now()) connectionFail('reconnect_required'); };
    const reader = createGmailReadAdapter({ bindings: [{ ownerId: owner, accountId: before.accountId, subject: before.subject, address: before.address, label: before.address }], approveExecution: async () => { await current(); return true; }, resolveCredential: async () => { await current(); return before.grant!.entry.credential; }, fetchImplementation: mailTransport });
    return { before, current, reader };
  }
  async function sourceContext(owner: string, workspaceId: string, taskId: string) {
    enabled(); await home(owner, workspaceId);
    if (!homes.mailTaskSource) connectionFail('not_configured');
    const source = await homes.mailTaskSource(owner, workspaceId, taskId);
    if (!source) connectionFail('source_unavailable');
    const { before, current: access, reader } = await mailReader(owner, source.connectionId);
    if (before.workspaceId !== workspaceId || before.accountId !== source.accountId) connectionFail('forbidden');
    const current = async () => {
      await access();
      if (JSON.stringify(await homes.mailTaskSource!(owner, workspaceId, taskId)) !== JSON.stringify(source)) connectionFail('source_unavailable');
    };
    return { source, before, current, reader };
  }
  async function prepareReply(owner: string, workspaceId: string, taskId: string) {
    const context = await sourceContext(owner, workspaceId, taskId), { before, source, reader, current } = context;
    const result = await reader.getReplySource({ ownerId: owner, accountId: before.accountId, messageId: source.messageId });
    if (result.message.upstreamThreadId !== source.threadId) connectionFail('source_unavailable');
    const plans = replyPlans(before.address, result.headers), reviewToken = await replyReviewToken(owner, replySource(source), plans);
    await current(); return { ...context, plans, reviewToken };
  }
  return {
    /** Only the synthetic launcher may compose this authority with an injected dispatcher. */
    fixtureReplyAuthority() {
      if (evidenceMode !== 'google-fixture') connectionFail('not_configured');
      return {
        async freeze(owner: string, workspaceId: string, input: ReplyOperationInput) {
          if (!homes.connectedReply) connectionFail('not_configured');
          const context = await prepareReply(owner, workspaceId, input.taskId);
          const draft = await homes.connectedReply(owner, context.source);
          if (!draft || !draft.body.trim() || draft.revision !== input.draftRevision) operationFail('conflict');
          if (context.reviewToken !== input.reviewToken || JSON.stringify(draft.plan) !== JSON.stringify(draft.mode === 'reply' ? context.plans.reply : context.plans.replyAll)) connectionFail('reply_review_required');
          const payload = validateFrozenReply({ version: 1, action: 'reply.simulate', ownerUserId: owner, workspaceId, taskId: input.taskId, source: replySource(context.source), connectionRevision: context.before.attemptId, providerSubject: context.before.subject, reviewToken: context.reviewToken, draft });
          return { payload, current: async () => { await context.current(); if (JSON.stringify(await homes.connectedReply!(owner, context.source)) !== JSON.stringify(draft)) operationFail('conflict'); } };
        },
        async current(payload: FrozenReplyPayload) {
          const context = await prepareReply(payload.ownerUserId, payload.workspaceId, payload.taskId);
          const plan = payload.draft.mode === 'reply' ? context.plans.reply : context.plans.replyAll;
          if (JSON.stringify(replySource(context.source)) !== JSON.stringify(payload.source) || context.before.attemptId !== payload.connectionRevision || context.before.subject !== payload.providerSubject || context.reviewToken !== payload.reviewToken || !sameReplyPlan(plan, payload.draft.plan)) connectionFail('forbidden');
          await context.current();
        },
      };
    },
    async reply(owner: string, workspaceId: string, taskId: string): Promise<ReplyPreparation> {
      if (!homes.connectedReply) connectionFail('not_configured');
      const { source, plans, reviewToken, current } = await prepareReply(owner, workspaceId, taskId);
      const draft = await homes.connectedReply(owner, source);
      await current(); return { workspaceId, taskId, storageKind: 'openjob', plans, reviewToken, draft: draft ?? null };
    },
    async saveReply(owner: string, workspaceId: string, taskId: string, value: ReplySaveInput) {
      if (!homes.saveConnectedReply) connectionFail('not_configured');
      const input = validateReplySave(value), { source, plans, reviewToken, current } = await prepareReply(owner, workspaceId, taskId);
      if (input.reviewToken !== reviewToken) connectionFail('reply_review_required');
      const draft = await homes.saveConnectedReply(owner, source, { mode: input.mode, body: input.body, plan: input.mode === 'reply' ? plans.reply : plans.replyAll }, input.expectedRevision, current);
      await current(); return { workspaceId, taskId, draft };
    },
    async createTask(owner: string, id: string, input: { messageId: string; title: string; requestId?: string }) {
      if (!homes.createMailTask) connectionFail('not_configured');
      if (typeof input.messageId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(input.messageId) || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 500 || input.requestId !== undefined && (typeof input.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.requestId))) connectionFail('invalid_input');
      const { before, current, reader } = await mailReader(owner, id);
      const message = await reader.getMessageSummary({ ownerId: owner, accountId: before.accountId, messageId: input.messageId });
      await current();
      const requestHash = input.requestId ? [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([before.id, before.accountId, message.upstreamId, input.title]))))].map(value => value.toString(16).padStart(2, '0')).join('') : undefined;
      const source = { workspaceId: before.workspaceId, connectionId: before.id, accountId: before.accountId, messageId: message.upstreamId, threadId: message.upstreamThreadId, ...(input.requestId ? { requestId: input.requestId, requestHash } : {}) };
      const receipt = await homes.createMailTask(owner, input.title, source, current);
      await current(); return receipt;
    },
    async taskSource(owner: string, workspaceId: string, taskId: string) {
      const { source, before, current, reader } = await sourceContext(owner, workspaceId, taskId);
      const message = await reader.getMessage({ ownerId: owner, accountId: before.accountId, messageId: source.messageId });
      if (message.upstreamThreadId !== source.threadId) connectionFail('source_unavailable');
      await current(); return { workspaceId, taskId, address: before.address, mode: evidenceMode, message };
    },
    async catalog(owner: string): Promise<GoogleConnectionCatalog> {
      enabled(); const rows = await read(owner), currentHomes = await homes.list(owner); await active(owner);
      return { mode: evidenceMode, homes: currentHomes.map(({ workspaceId, name }) => ({ workspaceId, name })), mailAvailable: !!mailTransport, bindings: rows.map(item => ({ id: item.id, workspaceId: item.workspaceId, address: item.address, status: item.status, ...(item.operation ? { operation: item.operation } : {}), expired: !!item.grant && item.grant.entry.credential.expiresAt <= Date.now() })) };
    },
    async begin(owner: string, address: string, workspaceId: string) {
      enabled(); if (!validAddress(address)) connectionFail(); const selected = address.toLowerCase(); await home(owner, workspaceId);
      const existing = (await read(owner)).find(item => item.address.toLowerCase() === selected);
      if (existing && (!['cancelled', 'disconnected', 'reconnect_required'].includes(existing.status) || existing.workspaceId !== workspaceId)) connectionFail('conflict');
      const proof = await protocol.proofKey(); if (!proof.codeChallenge) connectionFail('consent_failed');
      const state = oauthRandom(), nonce = oauthRandom(), attemptId = uuid();
      const next: GoogleConnection = { id: existing?.id ?? `con_${uuid()}`, ownerId: owner, workspaceId, address: selected, accountId: existing?.accountId ?? `gmail_${uuid()}`, attemptId, credentialRef: `google_${attemptId}`, status: 'consent_required', ...(existing?.subject ? { subject: existing.subject } : {}), stateHash: await oauthHash(state), pending: { stateHash: await oauthHash(state), verifier: proof.codeVerifier, nonce, clientId: configured.clientId, callbackUri: configured.callbackUri, expiresAt: Date.now() + 600_000 } };
      if (existing) await replace(existing, next);
      else await change(owner, rows => { if (rows.some(item => item.address.toLowerCase() === selected)) connectionFail('conflict'); return [...rows, next]; });
      try {
        const authorizationUrl = await consentProtocol.authorizationUrl({ binding: googleBinding(next), state, nonce, codeChallenge: proof.codeChallenge });
        await home(owner, workspaceId); if (JSON.stringify(await row(owner, next.id)) !== JSON.stringify(next)) connectionFail('conflict');
        return { connectionId: next.id, authorizationUrl };
      } catch { await failed(next); return connectionFail('consent_failed'); }
    },
    async callback(owner: string, input: { state: string; callbackUri: string; code?: string; error?: string }) {
      enabled(); if (!/^[A-Za-z0-9_-]{43}$/.test(input.state) || input.callbackUri !== configured.callbackUri) connectionFail('invalid_input');
      const hash = await oauthHash(input.state), before = (await read(owner)).find(item => item.stateHash === hash);
      if (!before || before.status !== 'consent_required' || !before.pending || before.pending.clientId !== configured.clientId || before.pending.callbackUri !== configured.callbackUri) connectionFail('conflict');
      await home(owner, before.workspaceId);
      const pending = before.pending;
      const claimed = denied(before, 'authorizing'); claimed.operation = 'exchange'; claimed.consentExpiresAt = pending.expiresAt;
      // The atomic claim erases PKCE/nonce from persistent state BEFORE one exchange.
      await replace(before, claimed);
      if (pending.expiresAt <= Date.now() || input.error !== undefined) { await replace(claimed, denied(claimed, input.error === 'access_denied' ? 'cancelled' : 'reconnect_required')); return { status: input.error === 'access_denied' ? 'cancelled' : 'reconnect_required' }; }
      try {
        if (!input.code) connectionFail();
        const grant = await protocol.exchange({ binding: googleBinding(claimed), code: input.code, codeVerifier: pending.verifier, nonce: pending.nonce });
        await home(owner, before.workspaceId);
        const connected: GoogleConnection = { ...claimed, status: 'connected', subject: grant.binding.subject, grant }; delete connected.operation; delete connected.consentExpiresAt;
        await replace(claimed, connected); return { status: 'connected' };
      } catch { await failed(claimed); return connectionFail('consent_failed'); }
    },
    async act(owner: string, id: string, action: string) {
      enabled(); const before = await row(owner, id);
      if (action === 'refresh') {
        if (before.status !== 'connected' || !before.grant) connectionFail('conflict'); await home(owner, before.workspaceId);
        const claimed: GoogleConnection = { ...before, status: 'authorizing', operation: 'refresh' }; await replace(before, claimed);
        try { const grant = await protocol.refresh(before.grant); await home(owner, before.workspaceId); await replace(claimed, { ...before, grant }); }
        catch { await failed(claimed); return connectionFail('reconnect_required'); }
      } else {
        if (action === 'cancel' && !['consent_required', 'authorizing'].includes(before.status) || action === 'retry-cleanup' && before.status !== 'cleanup_pending' || !['cancel', 'disconnect', 'retry-cleanup'].includes(action)) connectionFail('conflict');
        await replace(before, denied(before, before.status === 'authorizing' ? 'cleanup_pending' : action === 'cancel' ? 'cancelled' : 'disconnected'));
      }
      return { status: 'status_updated' };
    },
    async message(owner: string, id: string, messageId: string) {
      if (typeof messageId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(messageId)) connectionFail('invalid_input');
      const { before, current, reader } = await mailReader(owner, id);
      const message = await reader.getMessage({ ownerId: owner, accountId: before.accountId, messageId }).finally(current);
      return { mode: evidenceMode, workspaceId: before.workspaceId, message };
    },
    async mail(owner: string, id: string, cursor?: string, folderId?: string, search?: string, view?: 'metadata') {
      if (view !== undefined && view !== 'metadata') connectionFail('invalid_input');
      const { before, current, reader } = await mailReader(owner, id);
      const observedAt = Date.now();
      const page = await (view === 'metadata' ? reader.listMessageSummaries : reader.listMessages)({ ownerId: owner, accountId: before.accountId, cursor, folderId, search }).finally(current);
      if (view !== 'metadata') return { mode: evidenceMode, workspaceId: before.workspaceId, page };
      const freshness = mailReadFreshness(observedAt, before.grant!.entry.credential.expiresAt);
      if (Date.parse(freshness.expiresAt) <= Date.now()) connectionFail('mail_view_expired');
      return { mode: evidenceMode, workspaceId: before.workspaceId, page, freshness };
    },
  };
}
export type GoogleConnectionsFlow = ReturnType<typeof createGoogleConnectionsFlow>;
