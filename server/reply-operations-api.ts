import type { FixtureReplyOperations } from './reply-operations.ts';
import { OPERATION_ID, operationFail } from '../shared/reply-operation.ts';
import { defaultRequestId, errorResponse, jsonResponse } from './v1-http.ts';

export async function replyOperationsResponse(request: Request, owner: string, operations?: FixtureReplyOperations) {
  const url = new URL(request.url), match = /^\/api\/v1\/workspaces\/(wsp_[a-f0-9]{32})\/operations(?:\/(op_[a-f0-9]{64})(\/run-fixture)?)?$/.exec(url.pathname);
  if (!match) return undefined;
  const [, workspaceId, id, run] = match;
  try {
    if (!operations) operationFail('not_configured');
    let data: unknown, status = 200;
    if (!id && request.method === 'GET') {
      if ([...url.searchParams.keys()].some(key => !['taskId', 'cursor'].includes(key) || url.searchParams.getAll(key).length !== 1)) operationFail();
      const page = await operations.list(owner, workspaceId, url.searchParams.get('taskId') ?? undefined, url.searchParams.get('cursor') ?? undefined);
      return jsonResponse({ data: page.items, nextCursor: page.nextCursor });
    }
    if (url.search) operationFail();
    if (!id && request.method === 'POST') {
      if (!request.headers.get('content-type')?.startsWith('application/json')) operationFail();
      const body = await request.text(); if (body.length > 4096) operationFail();
      let input; try { input = JSON.parse(body); } catch { operationFail(); }
      data = await operations.enqueue(owner, workspaceId, input); status = 202;
    } else if (id && OPERATION_ID.test(id) && !run && request.method === 'GET') data = await operations.get(owner, workspaceId, id);
    else if (id && run && request.method === 'POST' && !(await request.text()).length) data = await operations.run(owner, workspaceId, id);
    else operationFail('not_found');
    return jsonResponse({ data }, status);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'internal_error';
    const status = ({ invalid_input: 400, invalid_cursor: 400, forbidden: 403, not_found: 404, not_configured: 503, reconnect_required: 409, source_unavailable: 409, reply_review_required: 409, conflict: 409, workspace_capacity: 409 } as Record<string, number>)[code];
    return errorResponse(defaultRequestId, { code: status ? code : 'internal_error', status: status ?? 500, message: 'Reply simulation unavailable. Inspect its operation before retrying.' });
  }
}
