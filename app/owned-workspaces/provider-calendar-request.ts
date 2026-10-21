export type CalendarRequest = (path: string, body?: unknown, emptyPost?: boolean) => Promise<{ data: unknown; nextCursor?: string | null }>;
/** One request, no mutation retries. The retained editor owns uncertain intent. */
export async function requestProviderCalendar(getToken: () => Promise<string>, signal: AbortSignal, workspace: string, path: string, body?: unknown, emptyPost = false) {
  signal.throwIfAborted(); const token = await getToken(); signal.throwIfAborted();
  const response = await fetch(`/api/v1/workspaces/${workspace}/${path}`, { method: body !== undefined || emptyPost ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal, cache: 'no-store', redirect: 'error' });
  const text = await response.text(); signal.throwIfAborted();
  if (!response.ok || text.length > 1000000) {
    let code = ''; try { const value = JSON.parse(text); if (['invalid_input', 'conflict', 'remote_plan_active', 'review_required', 'workspace_capacity'].includes(value?.error?.code)) code = value.error.code; } catch {}
    throw Object.assign(new Error('Provider planning unavailable. Inspect saved status before retrying.'), { status: response.status, code });
  }
  const value = JSON.parse(text) as { data?: unknown; nextCursor?: unknown };
  if (!value || typeof value !== 'object' || !Object.hasOwn(value, 'data') || Object.keys(value).some(key => !['data', 'nextCursor'].includes(key)) || value.nextCursor !== undefined && value.nextCursor !== null && (typeof value.nextCursor !== 'string' || !value.nextCursor || value.nextCursor.length > 8192)) throw new Error('Provider planning response unavailable.');
  return value as { data: unknown; nextCursor?: string | null };
}
