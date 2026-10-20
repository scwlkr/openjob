import { googleConnectionsRequest } from './google-http.ts';
import type { GoogleConnectionsFlow } from './google-flow.ts';
import type { FirebaseTokenIdentity } from '../firebase-id-token.ts';
import type { OpenJobUser } from '../v1-identity.ts';
import { isInactiveUserError } from '../../db/user-history.ts';
import { defaultRequestId, errorResponse, internalErrorResponse, jsonResponse, accountDeletionPendingResponse, signInMethodUnrecognizedResponse } from '../v1-http.ts';
import type { ConnectionsApplication } from './application.ts';
import { googleSessionRequest } from './google-session-http.ts';
import type { GoogleMailSession } from './google-session.ts';
export function createConnectionsApi({ users, verifyIdToken, onboarding, google, googleAdmission, googleSession }: {
  users: { resolve(identity: FirebaseTokenIdentity): Promise<OpenJobUser | null> };
  verifyIdToken(request: Request): Promise<FirebaseTokenIdentity | null>;
  onboarding?: ConnectionsApplication;
  google?: GoogleConnectionsFlow;
  googleSession?: GoogleMailSession;
  googleAdmission?: { userId: string; provider: 'google'; firebaseUid: string };
}) {
  const fail = (code: string, status: number) => errorResponse(defaultRequestId, { code, status, message: code === 'search_rejected' ? 'This Mail search could not be used. Review the query or clear search.' : code === 'folder_unavailable' ? 'This Mail folder is unavailable. Choose All Mail or another folder.' : code === 'invalid_cursor' ? 'This Mail page is unavailable. Open the first page and retry.' : code === 'not_configured' ? 'Connections are not configured. No account has been connected.' : 'Connection unavailable. Refresh status before retrying.' });
  return { async fetch(request: Request) {
    try {
      if (/^Bearer\s+oj_/i.test(request.headers.get('authorization') ?? '')) return fail('authentication_required', 401);
      const identity = await verifyIdToken(request); if (!identity) return fail('authentication_required', 401);
      const user = await users.resolve(identity); if (!user) return signInMethodUnrecognizedResponse(defaultRequestId); if (user.deletionPending) return accountDeletionPendingResponse(defaultRequestId);
      const url = new URL(request.url);
      if (request.headers.get('origin') && request.headers.get('origin') !== url.origin) return fail('invalid_input', 400);
      if (url.search) {
        if (!google || request.method !== 'GET' || !/^\/api\/v1\/connections\/con_[a-f0-9]{32}\/mail$/.test(url.pathname)) return fail('invalid_input', 400);
        const keys = [...url.searchParams.keys()];
        if (keys.length !== new Set(keys).size || keys.some(key => !['cursor', 'folderId', 'search', 'view'].includes(key))) return fail('invalid_input', 400);
        if (url.searchParams.has('view') && url.searchParams.get('view') !== 'metadata') return fail('invalid_input', 400);
        const cursor = url.searchParams.get('cursor'), folderId = url.searchParams.get('folderId'), search = url.searchParams.get('search');
        if (cursor !== null && (!cursor || cursor.length > 4096 || !/^gm3\.[A-Za-z0-9_-]+$/.test(cursor))) return fail('invalid_cursor', 400);
        if (search !== null && (search.length > 512 || !search.trim() || /[\u0000-\u001f\u007f]/.test(search))) return fail('invalid_input', 400);
        if (folderId !== null && !/^[A-Za-z0-9_-]{1,128}:folder:[A-Za-z0-9_-]{1,128}$/.test(folderId)) return fail('invalid_input', 400);
      }
      if (url.pathname === '/api/v1/connections/session' || url.pathname.startsWith('/api/v1/connections/session/')) {
        const isCurrent = async () => { const current = await users.resolve(identity); return !request.signal.aborted && !!current && current.userId === user.userId && !current.deletionPending; };
        const response = await googleSessionRequest(request, user.userId, identity, googleSession, isCurrent);
        return await isCurrent() ? response : accountDeletionPendingResponse(defaultRequestId);
      }
      if (google || url.pathname === '/api/v1/connections/google/callback') {
        if (googleAdmission && (user.userId !== googleAdmission.userId || identity.provider !== googleAdmission.provider || identity.uid !== googleAdmission.firebaseUid)) return fail('forbidden', 403);
        const isCurrent = async () => { const current = await users.resolve(identity); return !!current && current.userId === user.userId && !current.deletionPending; };
        const response = await googleConnectionsRequest(request, user.userId, google, isCurrent);
        return await isCurrent() ? response : accountDeletionPendingResponse(defaultRequestId);
      }
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
      if (code && ['not_configured', 'invalid_input', 'invalid_cursor', 'search_rejected', 'folder_unavailable', 'forbidden', 'conflict', 'capacity', 'workspace_capacity', 'source_unavailable', 'message_unavailable', 'consent_failed', 'reconnect_required', 'reply_review_required', 'reply_unavailable'].includes(code)) return fail(code, code === 'not_configured' ? 503 : ['source_unavailable', 'folder_unavailable', 'message_unavailable'].includes(code) ? 404 : code === 'workspace_capacity' ? 413 : code === 'forbidden' ? 403 : ['conflict', 'consent_failed', 'reconnect_required', 'reply_review_required', 'reply_unavailable'].includes(code) ? 409 : 400);
      return internalErrorResponse(defaultRequestId);
    }
  } };
}
