import { createOwnedWorkspacesApi } from './owned-workspaces-api.ts';
import type { FirebaseTokenIdentity } from './firebase-id-token.ts';
import type { OpenJobUser } from './v1-identity.ts';
import type { createWorkspaceContextStore } from './workspace-context-store.ts';
import { defaultRequestId, errorResponse, internalErrorResponse, jsonResponse } from './v1-http.ts';

/** Trusted server selection only. It does not classify personal/employer control. */
export type WorkspacePilotAdmission = Readonly<{ userId: string; provider: 'google' | 'apple'; firebaseUid: string }>;
type Options = {
  store: ReturnType<typeof createWorkspaceContextStore>;
  users: { resolve(identity: FirebaseTokenIdentity): Promise<OpenJobUser | null> };
  verifyIdToken(request: Request): Promise<FirebaseTokenIdentity | null>;
  admission?: WorkspacePilotAdmission;
};
export function createWorkspacePilotApplication({ store, users, verifyIdToken, admission }: Options) {
  const configured = !!admission && Object.keys(admission).sort().join(',') === 'firebaseUid,provider,userId' && /^user_[a-f0-9]{32}$/.test(admission.userId) && ['google', 'apple'].includes(admission.provider) && typeof admission.firebaseUid === 'string' && admission.firebaseUid.length > 0 && admission.firebaseUid.length <= 128;
  // Copy caller-owned selection so later mutation cannot silently widen this instance's admission.
  const selected = configured ? Object.freeze({ ...admission! }) : null;
  const fail = (code: string, status: number) => errorResponse(defaultRequestId, { code, status, message: 'Workspace pilot is unavailable for this session. Existing Personal work is unchanged.' });
  const admitted = (user: OpenJobUser | null, identity: FirebaseTokenIdentity) => !!user && !user.deletionPending && !!selected && user.userId === selected.userId && identity.provider === selected.provider && identity.uid === selected.firebaseUid;
  return { async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (!/^\/api\/v1\/workspaces(?:\/|$)/.test(url.pathname)) return fail('not_found', 404);
      if (/^Bearer\s+oj_/i.test(request.headers.get('authorization') ?? '')) return fail('authentication_required', 401);
      const identity = await verifyIdToken(request); if (!identity) return fail('authentication_required', 401);
      const user = await users.resolve(identity); if (!user || user.deletionPending) return fail('account_unavailable', 410);
      if (!selected) return fail('workspace_pilot_unconfigured', 503);
      if (!admitted(user, identity)) return fail('workspace_pilot_not_admitted', 403);
      if (url.search || request.headers.get('origin') && request.headers.get('origin') !== url.origin) return fail('invalid_input', 400);
      if (url.pathname === '/api/v1/workspaces/session') {
        if (request.method !== 'GET') return fail('not_found', 404);
        if (!admitted(await users.resolve(identity), identity)) return fail('workspace_pilot_not_admitted', 403);
        return jsonResponse({ data: { ownerUserId: user.userId, assurance: 'limited_owner_pilot', employerIsolation: false } });
      }
      if (url.pathname === '/api/v1/workspaces/eligibility') return fail('not_found', 404);
      // Existing context API owns all Workspace/resource checks and rechecks current User/binding.
      const api = createOwnedWorkspacesApi({ requireNotesPrecondition: true, store, verifyIdToken: async () => identity, users: { resolve: async current => { const value = await users.resolve(current); return admitted(value, current) ? value : null; } } });
      url.pathname = url.pathname.replace('/api/v1/workspaces', '/api/owned-workspaces');
      return api.fetch(new Request(url, request));
    } catch { return internalErrorResponse(defaultRequestId); }
  } };
}
