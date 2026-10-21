import type { ConnectedReplyDraft } from '../../shared/connected-reply.ts';
import { serializeGmailReply } from './gmail-reply-mime.ts';
import type { GmailReadCredential } from './gmail-read-adapter.ts';

export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
export type GmailReplyBinding = { ownerId: string; workspaceId: string; accountId: string; subject: string; address: string };
export type GmailReplyRequest = { action: 'mail.send'; ownerId: string; workspaceId: string; accountId: string; providerSubject: string; threadId: string; draft: ConnectedReplyDraft };
export type GmailReplyResult = { kind: 'accepted'; provider: 'gmail'; messageId: string; threadId: string } | { kind: 'rejected' };
type ErrorCode = 'invalid_input' | 'forbidden' | 'execution_disabled' | 'authentication_required' | 'consent_required' | 'dispatch_unknown';
export class GmailReplyError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode) { super(`Gmail reply adapter: ${code.replaceAll('_', ' ')}.`); this.name = 'GmailReplyError'; this.code = code; }
}
function fail(code: ErrorCode): never { throw new GmailReplyError(code); }
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const opaque = (value: unknown): value is string => typeof value === 'string' && !!value && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Unbound protocol adapter. No default HTTP transport, credential source or execution approval. */
export function createGmailReplyAdapter(options: {
  bindings: GmailReplyBinding[];
  resolveCredential(binding: GmailReplyBinding): Promise<GmailReadCredential | null>;
  approveExecution?(binding: GmailReplyBinding, request: GmailReplyRequest): boolean | Promise<boolean>;
  fetchImplementation: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}) {
  const { resolveCredential, approveExecution = () => false, fetchImplementation, now = Date.now, timeoutMs = 5000 } = options;
  if (!Array.isArray(options.bindings) || options.bindings.length > 100 || typeof resolveCredential !== 'function' || typeof approveExecution !== 'function' || typeof fetchImplementation !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) fail('invalid_input');
  const bindings = structuredClone(options.bindings), seen = new Set<string>();
  for (const b of bindings) {
    const key = `${b.ownerId}:${b.workspaceId}:${b.accountId}`;
    if (!id(b.ownerId) || !id(b.workspaceId) || !id(b.accountId) || !opaque(b.subject) || typeof b.address !== 'string' || b.address.length > 254 || !/^[A-Za-z0-9.!#$%&'*+\-/=?^_`{|}~]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(b.address) || seen.has(key)) fail('invalid_input');
    seen.add(key);
  }
  return {
    async send(rawRequest: GmailReplyRequest, signal: AbortSignal): Promise<GmailReplyResult> {
      if (!record(rawRequest) || Object.keys(rawRequest).sort().join(',') !== 'accountId,action,draft,ownerId,providerSubject,threadId,workspaceId' || rawRequest.action !== 'mail.send' || !id(rawRequest.ownerId) || !id(rawRequest.workspaceId) || !id(rawRequest.accountId) || !id(rawRequest.threadId) || !opaque(rawRequest.providerSubject)) fail('invalid_input');
      const request = structuredClone(rawRequest), binding = bindings.find(b => b.ownerId === request.ownerId && b.workspaceId === request.workspaceId && b.accountId === request.accountId);
      if (!binding || binding.subject !== request.providerSubject) fail('forbidden');
      let mime: string; try { mime = serializeGmailReply(request.draft); } catch { return fail('invalid_input'); }
      if (request.draft.plan.from.toLowerCase() !== binding.address.toLowerCase()) fail('forbidden');
      const active = () => { if (signal.aborted) fail('dispatch_unknown'); };
      const approved = async () => {
        active(); let allowed = false;
        try { allowed = await approveExecution(structuredClone(binding), structuredClone(request)); } catch { fail('execution_disabled'); }
        active(); if (allowed !== true) fail('execution_disabled');
      };
      await approved();
      let credential: GmailReadCredential | null;
      try { credential = structuredClone(await resolveCredential(structuredClone(binding))); } catch { return fail('authentication_required'); }
      active();
      const consent = () => {
        if (!credential || credential.subject !== binding.subject || typeof credential.accessToken !== 'string' || !/^[A-Za-z0-9._~+\/-]{1,8192}={0,2}$/.test(credential.accessToken) || !Number.isFinite(credential.expiresAt) || credential.expiresAt <= now()) fail('authentication_required');
        if (!Array.isArray(credential.scopes) || credential.scopes.length > 100 || !credential.scopes.includes(GMAIL_SEND_SCOPE)) fail('consent_required');
      };
      consent(); await approved(); consent(); active();
      // Exactly one POST. The caller owns durable intent/authority and must never retry ambiguity.
      const controller = new AbortController(), abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const operation = async (): Promise<GmailReplyResult> => {
          active();
          const response = await fetchImplementation('https://gmail.googleapis.com/gmail/v1/users/me/messages/send?fields=id,threadId', {
            method: 'POST', headers: { authorization: `Bearer ${credential!.accessToken}`, accept: 'application/json', 'content-type': 'application/json' },
            body: JSON.stringify({ raw: mime, threadId: request.threadId }), redirect: 'error', cache: 'no-store', signal: controller.signal,
          });
          if (controller.signal.aborted || response.redirected || response.status >= 300 && response.status < 400) fail('dispatch_unknown');
          if ([400, 401, 403, 404, 413, 429].includes(response.status)) { await response.body?.cancel(); return { kind: 'rejected' }; }
          if (response.status !== 200 || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) fail('dispatch_unknown');
          const reader = response.body?.getReader(); if (!reader) fail('dispatch_unknown');
          const chunks: Uint8Array[] = []; let size = 0;
          for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 4096) { await reader.cancel(); fail('dispatch_unknown'); } chunks.push(value); }
          const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
          const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
          if (controller.signal.aborted || !record(result) || !id(result.id) || result.threadId !== request.threadId) fail('dispatch_unknown');
          return { kind: 'accepted', provider: 'gmail', messageId: result.id, threadId: request.threadId };
        };
        return await Promise.race([operation(), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new GmailReplyError('dispatch_unknown')); }, timeoutMs); })]);
      } catch { return fail('dispatch_unknown'); }
      finally { clearTimeout(timer); controller.abort(); signal.removeEventListener('abort', abort); }
    },
  };
}
