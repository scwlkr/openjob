import { WORKSPACE_AGENT_TOKEN } from '../shared/owned-workspace-agents.ts';
import { readWorkspaceHome } from './workspace-home.ts';
import { workspaceIdentityEligibility } from './workspace-context-store.ts';
import type { OwnedWorkspaceStore } from '../db/owned-workspaces.ts';
import type { FirebaseTokenIdentity } from './firebase-id-token.ts';
import type { OpenJobUser } from './v1-identity.ts';
import { isInactiveUserError } from '../db/user-history.ts';
import { defaultRequestId, errorResponse, internalErrorResponse, jsonResponse } from './v1-http.ts';
/** Context operations; callers own runtime admission in addition to these User/resource checks. */
export function createOwnedWorkspacesApi({ store, users, verifyIdToken, requireNotesPrecondition = false, agentSponsorId }: { agentSponsorId?: string; requireNotesPrecondition?: boolean; store: OwnedWorkspaceStore & { personalContext?: (owner: string) => Promise<unknown> }; users: { resolve(identity: FirebaseTokenIdentity): Promise<OpenJobUser | null> }; verifyIdToken(request: Request): Promise<FirebaseTokenIdentity | null> }) {
  const fail = (code: string, status: number) => errorResponse(defaultRequestId, { code, status, message: 'Workspace unavailable. Check the selected context and sign-in.' });
  async function body(request: Request, max = 250000) {
    const reader = request.body?.getReader(); if (!reader) throw Object.assign(new Error('Missing body'), { code: 'invalid_input' });
    const chunks: Uint8Array[] = []; let length = 0;
    for (;;) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > max) { await reader.cancel(); throw Object.assign(new Error('Body too large'), { code: 'body_too_large' }); } chunks.push(value); }
    const bytes = new Uint8Array(length); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; } catch { throw Object.assign(new Error('Invalid JSON'), { code: 'invalid_input' }); }
  }
  return { async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const bearer = /^Bearer\s+(oj_\S*)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
      if (/^Bearer\s+oj_/i.test(request.headers.get('authorization') ?? '')) {
        if (!bearer || !WORKSPACE_AGENT_TOKEN.test(bearer)) return fail('authentication_required', 401);
        if (url.search || request.headers.get('origin') && request.headers.get('origin') !== url.origin) return fail('invalid_input', 400);
        const target = /^\/api\/owned-workspaces\/(wsp_[a-f0-9]{32})(\/commands)?$/.exec(url.pathname);
        if (!target) return fail('forbidden', 403);
        if (request.method === 'GET' && !target[2]) return jsonResponse({ data: await store.snapshotForAgent(bearer, target[1], agentSponsorId) });
        if (request.method === 'POST' && target[2]) {
          if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return fail('invalid_input', 415);
          const input = await body(request);
          if (requireNotesPrecondition && input && typeof input === 'object' && (input as { type?: unknown }).type === 'task.notes' && !Object.hasOwn(input, 'expectedNotes')) return fail('invalid_input', 400);
          return jsonResponse({ data: await store.commandForAgent(bearer, target[1], input, agentSponsorId) });
        }
        return fail('forbidden', 403);
      }

      const identity = await verifyIdToken(request); if (!identity) return fail('authentication_required', 401);
      const user = await users.resolve(identity); if (!user || user.deletionPending) return fail('account_unavailable', 410);
      if (url.search || request.headers.get('origin') && request.headers.get('origin') !== url.origin) return fail('invalid_input', 400);
      if (url.pathname === '/api/owned-workspaces/eligibility' && request.method === 'GET') return jsonResponse({ data: workspaceIdentityEligibility() });
      if (url.pathname === '/api/owned-workspaces/home' && request.method === 'GET') {
        const data = await readWorkspaceHome(user.userId, store); const current = await users.resolve(identity);
        if (!current || current.userId !== user.userId || current.deletionPending) return fail('account_unavailable', 410);
        return jsonResponse({ data });
      }
      if (url.pathname === '/api/owned-workspaces/personal-context' && request.method === 'POST') {
        if (!store.personalContext) return fail('unavailable', 503);
        // No browser claim may determine identity control, source owner or target Workspace.
        if (request.headers.get('content-type')?.split(';')[0] !== 'application/json' || request.headers.get('content-length') && Number(request.headers.get('content-length')) > 2) return fail('invalid_input', 400);
        const reader = request.body?.getReader(); if (!reader) return fail('invalid_input', 400);
        const bytes: number[] = []; for (;;) { const { value, done } = await reader.read(); if (done) break; if (bytes.length + value.length > 2) { await reader.cancel(); return fail('invalid_input', 400); } bytes.push(...value); }
        if (new TextDecoder().decode(new Uint8Array(bytes)) !== '{}') return fail('invalid_input', 400);
        const admitted = await users.resolve(identity); if (!admitted || admitted.userId !== user.userId || admitted.deletionPending) return fail('account_unavailable', 410);
        const data = await store.personalContext(user.userId); const current = await users.resolve(identity);
        if (!current || current.userId !== user.userId || current.deletionPending) return fail('account_unavailable', 410);
        return jsonResponse({ data });
      }
      const grants = /^\/api\/owned-workspaces\/(wsp_[a-f0-9]{32})\/agent-grants(?:\/(agt_[a-f0-9]{32}))?$/.exec(url.pathname);
      if (grants) {
        let data: unknown;
        if (request.method === 'GET' && !grants[2]) data = await store.listAgents(user.userId, grants[1]);
        else if (request.method === 'POST' && !grants[2]) {
          if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return fail('invalid_input', 415);
          const input = await body(request, 4096);
          const admitted = await users.resolve(identity); if (!admitted || admitted.userId !== user.userId || admitted.deletionPending) return fail('account_unavailable', 410);
          data = await store.createAgent(user.userId, grants[1], input);
        } else if (request.method === 'DELETE' && grants[2]) data = await store.revokeAgent(user.userId, grants[1], grants[2]);
        else return fail('not_found', 404);
        const current = await users.resolve(identity); if (!current || current.userId !== user.userId || current.deletionPending) return fail('account_unavailable', 410);
        return jsonResponse({ data }, request.method === 'POST' ? 201 : 200);
      }
      const match = /^\/api\/owned-workspaces(?:\/(wsp_[a-f0-9]{32})(\/commands)?)?$/.exec(url.pathname);
      if (!match) return fail('not_found', 404);
      let data: unknown;
      if (request.method === 'GET' && !match[2]) data = match[1] ? await store.snapshot(user.userId, match[1]) : await store.list(user.userId);
      else if (request.method === 'POST' && (!match[1] || match[2])) {
        if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return fail('invalid_input', 415);
        const input = await body(request);
        const admitted = await users.resolve(identity); if (!admitted || admitted.userId !== user.userId || admitted.deletionPending) return fail('account_unavailable', 410);
        if (match[1]) {
          if (input && typeof input === 'object' && !Array.isArray(input) && (input as { type?: unknown }).type === 'task.notes') {
            const guarded = Object.hasOwn(input, 'expectedNotes');
            if (requireNotesPrecondition && !guarded) return fail('invalid_input', 400);
            if (guarded) {
              const { expectedNotes, ...command } = input as Record<string, unknown>;
              data = await store.saveTaskNotes(user.userId, match[1], command, expectedNotes);
            } else data = await store.command(user.userId, match[1], input);
          } else data = await store.command(user.userId, match[1], input);
        }
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
      if (code && ['authentication_required', 'body_too_large', 'forbidden', 'invalid_input', 'conflict', 'schedule_conflict', 'workspace_capacity', 'unavailable'].includes(code)) return fail(code, code === 'unavailable' ? 503 : code === 'authentication_required' ? 401 : code === 'body_too_large' ? 413 : code === 'forbidden' ? 403 : ['conflict', 'schedule_conflict'].includes(code) ? 409 : code === 'workspace_capacity' ? 413 : 400);
      return internalErrorResponse(defaultRequestId);
    }
  } };
}
