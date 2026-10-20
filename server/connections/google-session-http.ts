import type { FirebaseTokenIdentity } from '../firebase-id-token.ts';
import type { GoogleMailSession } from './google-session.ts';
import { defaultRequestId, errorResponse, jsonResponse } from '../v1-http.ts';

/** Called after signed-human/current-User checks; no anonymous provider-token endpoint. */
export async function googleSessionRequest(request: Request, owner: string, identity: FirebaseTokenIdentity, session: GoogleMailSession | undefined, isCurrent: () => Promise<boolean>) {
  const fail = (code: string, status: number) => errorResponse(defaultRequestId, { code, status, message: 'Local Gmail session unavailable. Disconnect and reconnect before reading.' });
  if (!session) return fail('not_configured', 503);
  const url = new URL(request.url);
  if (url.origin !== session.origin || request.headers.get('origin') !== session.origin) return fail('forbidden', 403);
  const path = url.pathname.replace('/api/v1/connections/session', '');
  const id = request.headers.get('x-openjob-mail-session') ?? '';
  if (request.method === 'POST' && path === '/status') return jsonResponse({ data: session.status(owner, identity) });
  if (path !== '/begin' && !/^[a-f0-9]{32}$/.test(id)) return fail('invalid_input', 400);
  if (!await isCurrent() || request.signal.aborted) return fail('forbidden', 403);
  if (request.method === 'DELETE' && path === '') return jsonResponse({ data: session.disconnect(owner, identity, id) });
  if (request.method !== 'POST' || !['/begin', '/connect', '/mail'].includes(path)) return fail('not_found', 404);
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return fail('invalid_input', 415);
  const reader = request.body?.getReader(); if (!reader) return fail('invalid_input', 400);
  const bytes: number[] = [];
  for (;;) { const { done, value } = await reader.read(); if (done) break; if (bytes.length + value.length > 12288) { await reader.cancel(); return fail('invalid_input', 413); } bytes.push(...value); }
  let input;
  try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes))); } catch { return fail('invalid_input', 400); }
  if (!input || typeof input !== 'object' || Array.isArray(input) || !await isCurrent() || request.signal.aborted) return fail('invalid_input', 400);
  if (path === '/begin') {
    if (Object.keys(input).length) return fail('invalid_input', 400);
    return jsonResponse({ data: session.begin(owner, identity) });
  }
  if (path === '/mail') {
    if (Object.keys(input).length) return fail('invalid_input', 400);
    return jsonResponse({ data: await session.mail(owner, identity, id, isCurrent) });
  }
  if (Object.keys(input).join(',') !== 'accessToken' || typeof input.accessToken !== 'string') return fail('invalid_input', 400);
  return jsonResponse({ data: await session.connect(owner, identity, id, input.accessToken, isCurrent) });
}
