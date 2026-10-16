import type { NativePersonalWorkspaceApi } from './personal-workspace-contracts';
import { OpenJobApiError, ProviderSignInError } from './auth/coordinator';
import { assertNativePersonalOwner, validateNativePersonalAgents, validateNativePersonalWorkspace } from './personal-workspace-validation';

export function createNativePersonalWorkspaceApi({ apiBaseUrl, fetchImplementation = fetch }: { apiBaseUrl: string; fetchImplementation?: typeof fetch }): NativePersonalWorkspaceApi {
  const base = apiBaseUrl.replace(/\/+$/, '');
  const codes = new Set(['authentication_required', 'invalid_input', 'forbidden', 'sending_disabled', 'workspace_capacity', 'conflict', 'sign_in_method_unrecognized', 'account_deletion_pending', 'rate_limited', 'invalid_content_type', 'invalid_request', 'body_too_large', 'not_found', 'internal_error']);
  async function request(token: string, path: string, method = 'GET', input?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImplementation(`${base}/workspace/${path}`, { method, headers: { accept: 'application/json', authorization: `Bearer ${token}`, ...(input ? { 'content-type': 'application/json' } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}), cache: 'no-store', redirect: 'error' });
    } catch { throw new ProviderSignInError('offline'); }
    if (response.status === 204 && method === 'DELETE') return;
    // Bound before JSON parsing; never include server content in errors.
    let encoded: string;
    try { encoded = await response.text(); } catch { throw new ProviderSignInError("offline"); }
    if (encoded.length > 2_000_000) throw new OpenJobApiError(502, 'invalid_response', 'OpenJob returned invalid personal workspace data.');
    let envelope: unknown; try { envelope = JSON.parse(encoded); } catch { envelope = null; }
    const body = envelope && typeof envelope === 'object' && !Array.isArray(envelope) ? envelope as Record<string, unknown> : null;
    if (!response.ok) {
      const error = body?.error as { code?: unknown } | undefined;
      const code = typeof error?.code === 'string' && codes.has(error.code) ? error.code : 'request_failed';
      throw new OpenJobApiError(response.status, code, 'The personal workspace request could not be completed.');
    }
    if (!body || !Object.hasOwn(body, 'data') || Object.keys(body).some(key => key !== 'data')) throw new OpenJobApiError(502, 'invalid_response', 'OpenJob returned invalid personal workspace data.');
    return body.data;
  }
  return {
    async readPersonalWorkspace(token, owner) { assertNativePersonalOwner(owner); return validateNativePersonalWorkspace(await request(token, 'snapshot'), owner); },
    async commandPersonalWorkspace(token, input) { await request(token, 'commands', 'POST', input); },
    async listPersonalAgents(token, owner) { assertNativePersonalOwner(owner); return validateNativePersonalAgents(await request(token, 'agent-grants'), owner); },
    async revokePersonalAgent(token, id) {
      if (!/^agt_[a-f0-9]{32}$/.test(id)) throw new OpenJobApiError(400, 'invalid_input', 'Invalid personal agent.');
      await request(token, `agent-grants/${encodeURIComponent(id)}`, 'DELETE');
    },
  };
}
