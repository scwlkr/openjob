import type { NativePersonalWorkspaceApi } from './personal-workspace-contracts';
import { OpenJobApiError, ProviderSignInError } from './auth/coordinator';
import { assertNativePersonalOwner, validateNativePersonalAgents, validateNativePersonalWorkspace } from './personal-workspace-validation';
import { validateTaskCalendarProjection } from '../../shared/task-calendar-sync';
import type { TaskCalendarSyncSnapshot, TaskCalendarSyncAck } from './offline-workspace-contracts';

export function createNativePersonalWorkspaceApi({ apiBaseUrl, fetchImplementation = fetch }: { apiBaseUrl: string; fetchImplementation?: typeof fetch }): NativePersonalWorkspaceApi {
  const base = apiBaseUrl.replace(/\/+$/, '');
  const codes = new Set(['authentication_required', 'invalid_input', 'forbidden', 'sending_disabled', 'workspace_capacity', 'conflict', 'sync_expired', 'sign_in_method_unrecognized', 'account_deletion_pending', 'rate_limited', 'invalid_content_type', 'invalid_request', 'body_too_large', 'not_found', 'internal_error']);
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
    async readTaskCalendarSync(token, owner) {
      assertNativePersonalOwner(owner);
      const value = await request(token, 'task-calendar-sync') as TaskCalendarSyncSnapshot;
      try {
        if (!value || Object.keys(value).sort().join(',') !== 'projection,revision' || !/^tc1_[a-f0-9]{64}$/.test(value.revision)) throw new Error('Invalid sync response.');
        return { revision: value.revision, projection: validateTaskCalendarProjection(owner, value.projection) };
      } catch { throw new OpenJobApiError(502, 'invalid_response', 'OpenJob returned invalid Task/Calendar data.'); }
    },
    async syncTaskCalendar(token, owner, input) {
      assertNativePersonalOwner(owner);
      const projection = validateTaskCalendarProjection(owner, input.projection);
      if (Object.keys(input).sort().join(',') !== 'baseRevision,expiresAt,operationId,projection' || !/^tc1_[a-f0-9]{64}$/.test(input.baseRevision) || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.operationId) || !Number.isFinite(Date.parse(input.expiresAt)) || new Date(input.expiresAt).toISOString() !== input.expiresAt) throw new OpenJobApiError(400, 'invalid_input', 'Invalid Task/Calendar sync input.');
      const value = await request(token, 'task-calendar-sync', 'POST', { ...input, projection }) as TaskCalendarSyncAck;
      if (!value || Object.keys(value).sort().join(',') !== 'operationId,revision' || value.operationId !== input.operationId || !/^tc1_[a-f0-9]{64}$/.test(value.revision)) throw new OpenJobApiError(502, 'invalid_response', 'OpenJob returned an invalid sync acknowledgment.');
      return { operationId: value.operationId, revision: value.revision };
    },
    async readPersonalWorkspace(token, owner) { assertNativePersonalOwner(owner); return validateNativePersonalWorkspace(await request(token, 'snapshot'), owner); },
    async commandPersonalWorkspace(token, input) { await request(token, 'commands', 'POST', input); },
    async listPersonalAgents(token, owner) { assertNativePersonalOwner(owner); return validateNativePersonalAgents(await request(token, 'agent-grants'), owner); },
    async revokePersonalAgent(token, id) {
      if (!/^agt_[a-f0-9]{32}$/.test(id)) throw new OpenJobApiError(400, 'invalid_input', 'Invalid personal agent.');
      await request(token, `agent-grants/${encodeURIComponent(id)}`, 'DELETE');
    },
  };
}
