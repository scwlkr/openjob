export type ConnectionsRequest = (path?: string, input?: object) => Promise<unknown>;
const publicCodes = ['invalid_cursor', 'folder_unavailable', 'search_rejected', 'message_unavailable', 'authentication_required', 'consent_required', 'execution_disabled', 'provider_forbidden', 'mail_view_expired', 'forbidden', 'reconnect_required'];
/** The caller owns the signed-in session's abort lease. Never retry a mutation. */
export async function requestConnections(getToken: () => Promise<string>, signal: AbortSignal, path = '', input?: object): Promise<unknown> {
  signal.throwIfAborted(); const token = await getToken(); signal.throwIfAborted();
  const response = await fetch(`/api/v1/connections${path}`, { method: input ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, ...(input ? { 'content-type': 'application/json' } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}), signal, cache: 'no-store', redirect: 'error' });
  const raw = await response.text(); signal.throwIfAborted();
  if (raw.length > 1000000) throw new Error('Connection response unavailable.');
  let value; try { value = JSON.parse(raw); } catch { throw new Error('Connection response unavailable.'); }
  if (!response.ok) throw Object.assign(new Error(response.status === 503 ? 'Connections are not configured. No account has been connected.' : 'Connection unavailable. Refresh status before retrying.'), { code: publicCodes.includes(value?.error?.code) ? value.error.code : 'connection_unavailable' });
  if (!value || typeof value !== 'object' || !Object.hasOwn(value, 'data')) throw new Error('Connection response unavailable.');
  return value.data;
}
