import type { FixtureCalendarPlanning } from './calendar-planning.ts';
import { calendarFail } from '../shared/provider-calendar.ts';
import { defaultRequestId, errorResponse, jsonResponse } from './v1-http.ts';

/** Canonical human-only Workspace routes; normal runtimes configure no Calendar service. */
export async function calendarPlanningResponse(request: Request, owner: string, service?: FixtureCalendarPlanning) {
  const url = new URL(request.url), match = /^\/api\/v1\/workspaces\/(wsp_[a-f0-9]{32})\/(provider-calendars(?:\/(events|availability))?|planning(?:\/([A-Za-z0-9_-]{1,128})\/review)?|calendar-operations(?:\/(cop_[a-f0-9]{64})(\/run-fixture)?)?)$/.exec(url.pathname);
  if (!match) return undefined;
  const [, workspaceId, route, read, taskId, operationId, run] = match;
  try {
    if (!service) calendarFail('not_configured');
    let data: unknown, nextCursor: string | null | undefined, status = 200;
    const only = (names: string[]) => { if ([...url.searchParams.keys()].some(key => !names.includes(key) || url.searchParams.getAll(key).length !== 1)) calendarFail(); };
    const required = (name: string) => { const value = url.searchParams.get(name); if (!value) calendarFail(); return value; };
    if (route.startsWith('provider-calendars') && request.method === 'GET') {
      only(read ? ['accountId', 'calendarId', 'start', 'end', ...(read === 'events' ? ['cursor'] : [])] : ['accountId', 'cursor']);
      const input = { ownerId: owner, workspaceId, accountId: required('accountId') }, cursor = url.searchParams.get('cursor') ?? undefined;
      if (!read) data = await service.calendars({ ...input, cursor }, request.signal);
      else {
        const selection = { ...input, calendarId: required('calendarId'), window: { start: required('start'), end: required('end') } };
        data = read === 'events' ? await service.events({ ...selection, cursor }, request.signal) : await service.availability(selection, request.signal);
      }
    } else if (route === 'planning' && request.method === 'GET') { only([]); data = await service.planning(owner, workspaceId); }
    else if (taskId && request.method === 'POST') { only([]); if ((await request.text()).length) calendarFail(); data = await service.review(owner, workspaceId, taskId, request.signal); }
    else if (route === 'calendar-operations' && request.method === 'GET') {
      only(['taskId', 'cursor']); const page = await service.list(owner, workspaceId, url.searchParams.get('taskId') ?? undefined, url.searchParams.get('cursor') ?? undefined); data = page.items; nextCursor = page.nextCursor;
    } else if (route === 'calendar-operations' && request.method === 'POST') {
      only([]); if (!request.headers.get('content-type')?.startsWith('application/json')) calendarFail();
      const raw = await request.text(); if (raw.length > 16384) calendarFail(); let input; try { input = JSON.parse(raw); } catch { calendarFail(); }
      data = await service.enqueue(owner, workspaceId, input); status = 202;
    } else if (operationId && !run && request.method === 'GET') { only([]); data = await service.get(owner, workspaceId, operationId); }
    else if (operationId && run && request.method === 'POST') { only([]); if ((await request.text()).length) calendarFail(); data = await service.run(owner, workspaceId, operationId); }
    else calendarFail('not_found');
    return jsonResponse({ data, ...(nextCursor === undefined ? {} : { nextCursor }) }, status);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    const status = ({ invalid_input: 400, invalid_cursor: 400, forbidden: 403, details_forbidden: 403, not_found: 404, not_configured: 503, reconnect_required: 409, execution_disabled: 409, consent_required: 409, conflict: 409, review_required: 409, remote_plan_active: 409, provider_conflict: 409, provider_forbidden: 409, calendar_unavailable: 409, observation_expired: 409, unsupported_event: 409, workspace_capacity: 409 } as Record<string, number>)[code];
    return errorResponse(defaultRequestId, { code: status ? code : 'internal_error', status: status ?? 500, message: 'Provider planning unavailable. Inspect saved planning and its operation before retrying.' });
  }
}
