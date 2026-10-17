import type { OwnedWorkspaceStore } from '../db/owned-workspaces.ts';
import type { FirebaseTokenIdentity } from './firebase-id-token.ts';
import type { OpenJobUser } from './v1-identity.ts';
import { isInactiveUserError } from '../db/user-history.ts';
import { defaultRequestId, errorResponse, internalErrorResponse, jsonResponse } from './v1-http.ts';
/** Explicit fixture composition only. No production route or identity eligibility bypass. */
export function createOwnedWorkspacesApi({ store, users, verifyIdToken }: { store: OwnedWorkspaceStore; users: { resolve(identity: FirebaseTokenIdentity): Promise<OpenJobUser | null> }; verifyIdToken(request: Request): Promise<FirebaseTokenIdentity | null> }) {
  const fail = (code: string, status: number) => errorResponse(defaultRequestId, { code, status, message: 'Workspace unavailable. Check the selected context and sign-in.' });
  return { async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (/^Bearer\s+oj_/i.test(request.headers.get('authorization') ?? '')) return fail('authentication_required', 401);
      const identity = await verifyIdToken(request); if (!identity) return fail('authentication_required', 401);
      const user = await users.resolve(identity); if (!user || user.deletionPending) return fail('account_unavailable', 410);
      if (url.search || request.headers.get('origin') && request.headers.get('origin') !== url.origin) return fail('invalid_input', 400);
      const match = /^\/api\/owned-workspaces(?:\/(wsp_[a-f0-9]{32})(\/commands)?)?$/.exec(url.pathname);
      if (!match) return fail('not_found', 404);
      let data: unknown;
      if (request.method === 'GET' && !match[2]) data = match[1] ? await store.snapshot(user.userId, match[1]) : await store.list(user.userId);
      else if (request.method === 'POST' && (!match[1] || match[2])) {
        if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return fail('invalid_input', 415);
        const reader = request.body?.getReader(); if (!reader) return fail('invalid_input', 400);
        const chunks: Uint8Array[] = []; let length = 0;
        for (;;) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > 100000) { await reader.cancel(); return fail('body_too_large', 413); } chunks.push(value); }
        const bytes = new Uint8Array(length); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
        let input: unknown; try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return fail('invalid_input', 400); }
        if (match[1]) data = await store.command(user.userId, match[1], input);
        else {
          if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).join(',') !== 'name') return fail('invalid_input', 400);
          data = await store.create(user.userId, (input as { name: unknown }).name);
        }
      } else return fail('not_found', 404);
      const current = await users.resolve(identity);
      if (!current || current.userId !== user.userId || current.deletionPending) return fail('account_unavailable', 410);
      return jsonResponse({ data });
    } catch (error) {
      if (isInactiveUserError(error)) return fail('account_unavailable', 410);
      const code = (error as { code?: string })?.code;
      if (code && ['forbidden', 'invalid_input', 'conflict', 'schedule_conflict', 'workspace_capacity'].includes(code)) return fail(code, code === 'forbidden' ? 403 : ['conflict', 'schedule_conflict'].includes(code) ? 409 : code === 'workspace_capacity' ? 413 : 400);
      return internalErrorResponse(defaultRequestId);
    }
  } };
}
