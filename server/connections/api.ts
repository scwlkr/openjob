import type { FirebaseTokenIdentity } from '../firebase-id-token.ts';
import type { OpenJobUser } from '../v1-identity.ts';
import { isInactiveUserError } from '../../db/user-history.ts';
import { defaultRequestId, errorResponse, internalErrorResponse, jsonResponse, accountDeletionPendingResponse, signInMethodUnrecognizedResponse } from '../v1-http.ts';
import type { ConnectionsApplication } from './application.ts';
export function createConnectionsApi({ users, verifyIdToken, onboarding }: {
  users: { resolve(identity: FirebaseTokenIdentity): Promise<OpenJobUser | null> };
  verifyIdToken(request: Request): Promise<FirebaseTokenIdentity | null>;
  onboarding?: ConnectionsApplication;
}) {
  const fail = (code: string, status: number) => errorResponse(defaultRequestId, { code, status, message: code === 'not_configured' ? 'Connections are not configured. No account has been connected.' : 'Connection unavailable. Refresh status before retrying.' });
  return { async fetch(request: Request) {
    try {
      if (/^Bearer\s+oj_/i.test(request.headers.get('authorization') ?? '')) return fail('authentication_required', 401);
      const identity = await verifyIdToken(request); if (!identity) return fail('authentication_required', 401);
      const user = await users.resolve(identity); if (!user) return signInMethodUnrecognizedResponse(defaultRequestId); if (user.deletionPending) return accountDeletionPendingResponse(defaultRequestId);
      const url = new URL(request.url);
      if (url.search || request.headers.get('origin') && request.headers.get('origin') !== url.origin) return fail('invalid_input', 400);
      const match = /^\/api\/v1\/connections(?:\/(con_[a-f0-9]{32})(?:\/(mail))?)?$/.exec(url.pathname);
      if (!match) return fail('not_found', 404);
      if (!onboarding) return fail('not_configured', 503);
      let data: unknown;
      if (request.method === 'GET' && !match[1]) data = await onboarding.catalog(user.userId);
      else if (request.method === 'GET' && match[1] && match[2]) data = await onboarding.mail(user.userId, match[1]);
      else if (request.method === 'POST' && !match[2]) {
        if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return fail('invalid_input', 415);
        const reader = request.body?.getReader(); if (!reader) return fail('invalid_input', 400);
        const chunks: Uint8Array[] = []; let length = 0;
        for (;;) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > 2048) { await reader.cancel(); return fail('invalid_input', 413); } chunks.push(value); }
        const bytes = new Uint8Array(length); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
        let input; try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return fail('invalid_input', 400); }
        if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('invalid_input', 400);
        const current = await users.resolve(identity); if (!current || current.userId !== user.userId || current.deletionPending) return accountDeletionPendingResponse(defaultRequestId);
        if (!match[1]) {
          if (Object.keys(input).sort().join(',') !== 'choiceId,workspaceId' || typeof input.choiceId !== 'string' || typeof input.workspaceId !== 'string') return fail('invalid_input', 400);
          data = { connectionId: await onboarding.begin(user.userId, input.choiceId, input.workspaceId) };
        } else {
          if (Object.keys(input).join(',') !== 'action' || !['approve', 'cancel', 'disconnect', 'retry-cleanup'].includes(input.action)) return fail('invalid_input', 400);
          if (input.action === 'approve') await onboarding.approve(user.userId, match[1]);
          if (input.action === 'cancel') await onboarding.cancel(user.userId, match[1]);
          if (input.action === 'disconnect') await onboarding.disconnect(user.userId, match[1]);
          if (input.action === 'retry-cleanup') await onboarding.retryCleanup(user.userId, match[1]);
          data = { status: 'status_updated' };
        }
      } else return fail('not_found', 404);
      const current = await users.resolve(identity); if (!current || current.userId !== user.userId || current.deletionPending) return accountDeletionPendingResponse(defaultRequestId);
      return jsonResponse({ data });
    } catch (error) {
      if (isInactiveUserError(error)) return accountDeletionPendingResponse(defaultRequestId);
      const code = (error as { code?: string })?.code;
      if (code && ['invalid_input', 'forbidden', 'conflict', 'capacity', 'consent_failed', 'reconnect_required'].includes(code)) return fail(code, code === 'forbidden' ? 403 : ['conflict', 'consent_failed', 'reconnect_required'].includes(code) ? 409 : 400);
      return internalErrorResponse(defaultRequestId);
    }
  } };
}
