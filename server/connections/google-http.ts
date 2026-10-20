import type { GoogleConnectionsFlow } from './google-flow.ts';
import { defaultRequestId, errorResponse, jsonResponse } from '../v1-http.ts';
import type { ReplySaveInput } from '../../shared/connected-reply.ts';

/** Called only after existing signed-human authentication; never an anonymous token endpoint. */
export async function googleConnectionsRequest(request: Request, owner: string, flow: GoogleConnectionsFlow | undefined, isCurrent: () => Promise<boolean>) {
  const fail = (code: string, status = 400) => errorResponse(defaultRequestId, { code, status, message: code === 'not_configured' ? 'Google connections are not configured.' : 'Connection unavailable. Refresh status before retrying.' });
  if (!flow) return fail('not_configured', 503);
  const url = new URL(request.url), path = url.pathname;
  const source = /^\/api\/v1\/connections\/task-sources\/(wsp_[a-f0-9]{32})\/([A-Za-z0-9_-]{1,128})(\/reply)?$/.exec(path);
  if (source && request.method === 'GET') return jsonResponse({ data: await (source[3] ? flow.reply(owner, source[1], source[2]) : flow.taskSource(owner, source[1], source[2])) });
  if (source && !source[3]) return fail('not_found', 404);
  const match = /^\/api\/v1\/connections(?:\/(con_[a-f0-9]{32})(?:\/(mail|tasks))?)?$/.exec(path);
  const callback = path === '/api/v1/connections/google/callback';
  if (!match && !callback && !source) return fail('not_found', 404);
  if (request.method === 'GET' && match?.[1] && !match[2]) return fail('not_found', 404);
  if (request.method === 'GET' && match) return match[2] === 'tasks' ? fail('not_found', 404) : jsonResponse({ data: match[1] && match[2] ? await flow.mail(owner, match[1], url.searchParams.get('cursor') ?? undefined, url.searchParams.get('folderId') ?? undefined, url.searchParams.get('search') ?? undefined) : !match[1] ? await flow.catalog(owner) : null });
  if (request.method !== 'POST' || match?.[2] === 'mail') return fail('not_found', 404);
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return fail('invalid_input', 415);
  const reader = request.body?.getReader(); if (!reader) return fail('invalid_input');
  const bytes: number[] = [];
  for (;;) { const { done, value } = await reader.read(); if (done) break; if (bytes.length + value.length > (source ? 128000 : callback || match?.[2] === 'tasks' ? 8192 : 2048)) { await reader.cancel(); return fail('invalid_input', 413); } bytes.push(...value); }
  let input: Record<string, unknown>;
  try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes))); } catch { return fail('invalid_input'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('invalid_input');
  if (!await isCurrent()) return fail('account_deletion_pending', 410);
  let data;
  if (source) {
    if (Object.keys(input).sort().join(',') !== 'body,expectedRevision,mode,reviewToken') return fail('invalid_input');
    data = await flow.saveReply(owner, source[1], source[2], input as ReplySaveInput);
  } else if (callback) {
    const keys = Object.keys(input).sort().join(',');
    if (!['callbackUri,code,state', 'callbackUri,error,state'].includes(keys) || typeof input.state !== 'string' || typeof input.callbackUri !== 'string' || input.code !== undefined && (typeof input.code !== 'string' || input.code.length > 4096) || input.error !== undefined && input.error !== 'access_denied') return fail('invalid_input');
    data = await flow.callback(owner, input as { state: string; callbackUri: string; code?: string; error?: string });
  } else if (match?.[2] === 'tasks') {
    if (!['messageId,title', 'messageId,requestId,title'].includes(Object.keys(input).sort().join(','))) return fail('invalid_input');
    data = await flow.createTask(owner, match[1], input as { messageId: string; title: string; requestId?: string });
  } else if (!match?.[1]) {
    if (Object.keys(input).sort().join(',') !== 'address,workspaceId' || typeof input.address !== 'string' || typeof input.workspaceId !== 'string') return fail('invalid_input');
    data = await flow.begin(owner, input.address, input.workspaceId);
  } else {
    if (Object.keys(input).join(',') !== 'action' || typeof input.action !== 'string') return fail('invalid_input');
    data = await flow.act(owner, match[1], input.action);
  }
  return jsonResponse({ data });
}
