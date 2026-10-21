import { calendarFail, calendarRecord } from '../../shared/provider-calendar.ts';

/** Fixed-origin bounded transport. POST FreeBusy is a read, never a write retry. */
export async function googleCalendarHttp({ path, query = new URLSearchParams(), method = 'GET', body, etag, token, transport, signal, timeoutMs = 5000, write = false }: {
  path: string; query?: URLSearchParams; method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: object; etag?: string;
  token: string; transport: typeof fetch; signal: AbortSignal; timeoutMs?: number; write?: boolean;
}): Promise<Record<string, unknown> | null> {
  if (!/^(?:users\/me\/calendarList(?:\/[^/?#]+)?|freeBusy|calendars\/[^/?#]+\/events(?:\/[^/?#]+)?)$/.test(path) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) calendarFail();
  try { if (path.split('/').some(part => ['.', '..'].includes(decodeURIComponent(part)))) calendarFail(); } catch { calendarFail(); }
  const url = new URL('https://www.googleapis.com/calendar/v3/' + path); url.search = query.toString();
  const controller = new AbortController(), abort = () => controller.abort(); let timer: ReturnType<typeof setTimeout> | undefined;
  const unavailable = (): never => calendarFail(write ? 'dispatch_unknown' : 'calendar_unavailable');
  if (signal.aborted) return unavailable(); signal.addEventListener('abort', abort, { once: true });
  try {
    const operation = async () => {
      if (signal.aborted) return unavailable();
      const response = await transport(url, { method, headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(etag === undefined ? {} : { 'if-match': etag }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: 'no-store', redirect: 'error', signal: controller.signal });
      if (controller.signal.aborted || response.redirected || response.status >= 300 && response.status < 400) return unavailable();
      if ([400, 401, 403, 404, 409, 410, 412, 429].includes(response.status)) {
        await response.body?.cancel();
        if (response.status === 412 || response.status === 409) calendarFail('provider_conflict');
        if (response.status === 401 || response.status === 403) calendarFail('provider_forbidden');
        calendarFail(write ? 'provider_rejected' : 'calendar_unavailable');
      }
      if (method === 'DELETE' && response.status === 204) return null;
      if (response.status !== 200 || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) return unavailable();
      const length = response.headers.get('content-length'); if (length && (!/^\d+$/.test(length) || Number(length) > 262144)) return unavailable();
      const reader = response.body?.getReader(); if (!reader) return unavailable();
      const chunks: Uint8Array[] = []; let size = 0;
      for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 262144) { await reader.cancel(); return unavailable(); } chunks.push(value); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!calendarRecord(value) || controller.signal.aborted) return unavailable(); return value;
    };
    return await Promise.race([operation(), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error('Provider Calendar unavailable.'), { code: write ? 'dispatch_unknown' : 'calendar_unavailable' })); }, timeoutMs); })]);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && ['provider_conflict', 'provider_forbidden', 'provider_rejected', 'calendar_unavailable', 'dispatch_unknown'].includes(String(error.code))) throw error;
    return unavailable();
  } finally { clearTimeout(timer); controller.abort(); signal.removeEventListener('abort', abort); }
}
