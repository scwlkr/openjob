import { fail, object, upstream, OutlookReadError, type OutlookReadErrorCode } from './outlook-wire.ts';
export const OUTLOOK_PROFILE_SELECT = 'id,mail,userPrincipalName';
export const OUTLOOK_MESSAGE_SELECT = 'id,conversationId,parentFolderId,subject,from,toRecipients,body,receivedDateTime,isRead';
export const OUTLOOK_PREFER = 'IdType="ImmutableId", outlook.body-content-type="text"';
export const OUTLOOK_ORIGIN = 'https://graph.microsoft.com';
const MAX_BYTES = 262144;
export function validateMessagesUrl(value: string): URL {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith(`${OUTLOOK_ORIGIN}/v1.0/me/messages?`) || /[\u0000-\u0020\u007f]/.test(value)) fail('malformed_response');
  let url: URL; try { url = new URL(value); } catch { return fail('malformed_response'); }
  if (url.origin !== OUTLOOK_ORIGIN || url.pathname !== '/v1.0/me/messages' || url.username || url.password || url.hash) fail('malformed_response');
  const keys = [...url.searchParams.keys()]; if (new Set(keys).size !== keys.length || keys.some(key => !['$top', '$select', '$skip', '$skiptoken'].includes(key)) || url.searchParams.get('$top') !== '10' || url.searchParams.get('$select') !== 'id' || url.searchParams.has('$skip') && url.searchParams.has('$skiptoken')) fail('malformed_response');
  const skip = url.searchParams.get('$skip'); if (skip !== null && !/^[1-9][0-9]{0,9}$/.test(skip)) fail('malformed_response');
  const token = url.searchParams.get('$skiptoken'); if (token !== null && (!token || token.length > 1024 || /[\u0000-\u001f\u007f]/.test(token))) fail('malformed_response');
  return url;
}
export function initialMessagesUrl(): string { const url = new URL(`${OUTLOOK_ORIGIN}/v1.0/me/messages`); url.search = new URLSearchParams({ $top: '10', $select: 'id' }).toString(); return url.href; }
function validateRequestUrl(value: string) {
  const url = new URL(value);
  if (url.origin !== OUTLOOK_ORIGIN || url.username || url.password || url.hash) fail('invalid_input');
  if (url.pathname === '/v1.0/me/messages') return validateMessagesUrl(value);
  const query = [...url.searchParams.entries()]; if (query.length !== 1 || query[0]?.[0] !== '$select') fail('invalid_input');
  if (url.pathname === '/v1.0/me' && query[0][1] === OUTLOOK_PROFILE_SELECT) return url;
  const match = /^\/v1\.0\/me\/(messages|mailFolders)\/([^/]+)$/.exec(url.pathname);
  if (!match) fail('invalid_input');
  let decoded: string; try { decoded = decodeURIComponent(match[2]!); } catch { return fail('invalid_input'); }
  if (encodeURIComponent(upstream(decoded)) !== match[2] || query[0][1] !== (match[1] === 'messages' ? OUTLOOK_MESSAGE_SELECT : 'id,displayName')) fail('invalid_input');
  return url;
}
async function json(response: Response) {
  const size = response.headers.get('content-length'); if (size && (!/^\d+$/.test(size) || Number(size) > MAX_BYTES)) fail('malformed_response');
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) fail('malformed_response');
  const reader = response.body?.getReader(); if (!reader) fail('malformed_response'); const chunks: Uint8Array[] = []; let length = 0;
  for (;;) { const { value, done } = await reader.read(); if (done) break; length += value.byteLength; if (length > MAX_BYTES) { await reader.cancel(); fail('malformed_response'); } chunks.push(value); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))); } catch { return fail('malformed_response'); }
}
export async function outlookGet(value: string, token: string, fetcher: typeof fetch, timeoutMs: number) {
  const url = validateRequestUrl(value); const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  const operation = async () => {
    const response = await fetcher(url, { method: 'GET', headers: { authorization: `Bearer ${token}`, accept: 'application/json', Prefer: OUTLOOK_PREFER }, redirect: 'error', cache: 'no-store', signal: controller.signal });
    if (response.redirected || response.status >= 300 && response.status < 400) fail('network_error');
    if (response.status === 401) fail('authentication_required'); if (response.status === 429) fail('rate_limited'); if (response.status >= 500) fail('provider_error');
    if (response.status === 403) { let code: OutlookReadErrorCode = 'provider_forbidden'; try { const row = object((await json(response)).error); if (row.code === 'Authorization_RequestDenied' || row.code === 'ErrorInsufficientPermissions') code = 'consent_required'; if (row.code === 'TooManyRequests' || row.code === 'ErrorThrottledRequest') code = 'rate_limited'; } catch { /* Only fixed categories cross this boundary. */ } fail(code); }
    if (!response.ok) fail('provider_error'); return json(response);
  };
  try { return await Promise.race([operation(), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new OutlookReadError('timeout')); }, timeoutMs); })]); }
  catch (error) { if (error instanceof OutlookReadError) throw error; return fail('network_error'); }
  finally { if (timer) clearTimeout(timer); controller.abort(); }
}
