import * as calendarProtocol from '../../shared/calendar-client';
import type { CalendarWindow } from '../../shared/provider-calendar';
import { OpenJobApiError, ProviderSignInError } from './auth/coordinator';
import { validateWorkspace, validateOwnedSnapshot, WORKSPACE_ID } from '../../shared/owned-workspaces';
import { validReplyPlan, validateConnectedReplyDraft, validateReplySave } from '../../shared/connected-reply';
import { mailReadWindow } from '../../shared/connected-mail-freshness';
import { WORKSPACE_AGENT_ID, parseWorkspaceAgentActions, validateWorkspaceAgent } from '../../shared/owned-workspace-agents';
import type { NativeConnectedWorkspaceApi, ProviderMessage, ProviderMessageSummary, OwnedWorkspaceSnapshot, GoogleConnectionCatalog, ConnectedMail, ConnectedSource, ReplyPreparation } from './connected-workspaces-contracts';

function invalid(): never { throw new OpenJobApiError(502, 'invalid_response', 'OpenJob returned invalid Workspace data.'); }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 4096): value is string => typeof value === 'string' && value.length <= max && !/\u0000/.test(value);
const taskId = (value: string) => { if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new OpenJobApiError(400, 'invalid_input'); return value; };
const workspaceId = (value: string) => { if (!WORKSPACE_ID.test(value)) throw new OpenJobApiError(400, 'invalid_input'); return value; };
const connectionId = (value: string) => { if (!/^con_[a-f0-9]{32}$/.test(value)) throw new OpenJobApiError(400, 'invalid_input'); return value; };
const mode = (value: unknown) => value === 'google' || value === 'google-fixture';
function message(value: unknown): ProviderMessage {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'accountId,body,folderIds,from,id,read,receivedAt,subject,threadId,to,upstreamId,upstreamThreadId' || !text(value.accountId, 64) || !/^gmail_[a-f0-9]{32}$/.test(value.accountId) || !text(value.upstreamId, 128) || !/^[A-Za-z0-9_-]+$/.test(value.upstreamId) || !text(value.upstreamThreadId, 128) || !/^[A-Za-z0-9_-]+$/.test(value.upstreamThreadId) || value.id !== `${value.accountId}:message:${value.upstreamId}` || value.threadId !== `${value.accountId}:thread:${value.upstreamThreadId}` || !Array.isArray(value.folderIds) || value.folderIds.length > 500 || value.folderIds.some(id => !text(id, 512) || !id.startsWith(`${value.accountId}:folder:`)) || !text(value.subject) || !text(value.from) || !text(value.to) || !text(value.body, 65536) || !text(value.receivedAt, 64) || !Number.isFinite(Date.parse(value.receivedAt)) || typeof value.read !== 'boolean') invalid();
  return value as unknown as ProviderMessage;
}
function summary(value: unknown): ProviderMessageSummary {
  if (!object(value) || Object.hasOwn(value, 'body') || Object.hasOwn(value, 'snippet')) invalid();
  const { body, ...metadata } = message({ ...value, body: '' }); void body; return metadata;
}
export function createNativeConnectedWorkspaceApi({ apiBaseUrl, fetchImplementation = fetch }: { apiBaseUrl: string; fetchImplementation?: typeof fetch }): NativeConnectedWorkspaceApi {
  const base = apiBaseUrl.replace(/\/+$/, '');
  async function request(token: string, owner: string, path: string, input?: unknown, method?: 'DELETE' | 'POST', paginated = false, signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted();
    if (!/^user_[a-f0-9]{32}$/.test(owner)) throw new OpenJobApiError(400, 'invalid_input');
    let response: Response, raw: string;
    try { response = await fetchImplementation(base + path, { method: method ?? (input === undefined ? 'GET' : 'POST'), headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(input === undefined ? {} : { 'content-type': 'application/json' }) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }), signal, cache: 'no-store', redirect: 'error' }); raw = await response.text(); }
    catch { throw new ProviderSignInError('offline'); }
    signal?.throwIfAborted();
    if (raw.length > 2_000_000) invalid();
    let body: Record<string, unknown>;
    try { const parsed: unknown = JSON.parse(raw); if (!object(parsed)) invalid(); body = parsed; } catch { return invalid(); }
    if (!response.ok) {
      const code = object(body.error) && typeof body.error.code === 'string' && ['authentication_required', 'account_deletion_pending', 'sign_in_method_unrecognized', 'forbidden', 'not_configured', 'not_found', 'invalid_input', 'conflict', 'workspace_capacity', 'source_unavailable', 'reconnect_required', 'reply_review_required', 'reply_unavailable', 'invalid_cursor', 'folder_unavailable', 'search_rejected', 'message_unavailable', 'mail_view_expired', 'execution_disabled', 'consent_required', 'provider_forbidden', 'details_forbidden', 'remote_plan_active', 'review_required', 'provider_conflict', 'calendar_unavailable', 'observation_expired', 'unsupported_event'].includes(body.error.code) ? body.error.code : 'request_failed';
      throw new OpenJobApiError(response.status, code, 'Workspace request unavailable. Refresh before retrying.');
    }
    if (paginated) {
      if (Object.keys(body).sort().join(',') !== 'data,nextCursor' || body.nextCursor !== null && (!text(body.nextCursor, 8192) || !body.nextCursor)) invalid();
      return body;
    }
    if (Object.keys(body).join(',') !== 'data') invalid();
    return body.data;
  }
  function snapshot(value: unknown, owner: string, expected?: string): OwnedWorkspaceSnapshot {
    try { const result = validateOwnedSnapshot(value); if (result.workspace.ownerUserId !== owner || expected && result.workspace.workspaceId !== expected) invalid(); return result; } catch { return invalid(); }
  }
  const sourcePath = (id: string, task: string) => `/connections/task-sources/${workspaceId(id)}/${taskId(task)}`;
  function scoped(value: unknown, id: string, task: string): asserts value is Record<string, unknown> { if (!object(value) || value.workspaceId !== id || value.taskId !== task) invalid(); }
  const calendarPath = (id: string, route: string) => `/workspaces/${workspaceId(id)}/${route}`;
  const accountId = (id: string) => { if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new OpenJobApiError(400, 'invalid_input'); return id; };
  const operationId = (id: string) => { if (!/^cop_[a-f0-9]{64}$/.test(id)) throw new OpenJobApiError(400, 'invalid_input'); return id; };
  const query = (account: string, cursor?: string, calendar?: string, window?: CalendarWindow) => {
    const result = new URLSearchParams({ accountId: accountId(account) });
    if (cursor !== undefined) { if (!text(cursor, 8192) || !cursor) throw new OpenJobApiError(400, 'invalid_input'); result.set('cursor', cursor); }
    if (calendar !== undefined) { if (!text(calendar, 8192) || !calendar.startsWith(account + ':calendar:')) throw new OpenJobApiError(400, 'invalid_input'); result.set('calendarId', calendar); }
    if (window) for (const key of ['start', 'end'] as const) { const value = window[key]; if (!text(value, 64) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new OpenJobApiError(400, 'invalid_input'); result.set(key, value); }
    return result;
  };
  const checked = <T>(validate: () => T): T => { try { return validate(); } catch { return invalid(); } };
  return {
    async calendarAccounts(token, owner, id, signal) { const value = await request(token, owner, calendarPath(id, 'provider-calendars/accounts'), undefined, undefined, false, signal); return checked(() => calendarProtocol.calendarAccounts(value)); },
    async calendars(token, owner, id, account, cursor, signal) { const value = await request(token, owner, calendarPath(id, 'provider-calendars?' + query(account, cursor)), undefined, undefined, false, signal); return checked(() => calendarProtocol.calendarListPage(value, account)); },
    async calendarEvents(token, owner, id, account, calendar, window, cursor, signal) { const value = await request(token, owner, calendarPath(id, 'provider-calendars/events?' + query(account, cursor, calendar, window)), undefined, undefined, false, signal); return checked(() => calendarProtocol.calendarEventsPage(value, account, calendar)); },
    async calendarAvailability(token, owner, id, account, calendar, window, signal) { const value = await request(token, owner, calendarPath(id, 'provider-calendars/availability?' + query(account, undefined, calendar, window)), undefined, undefined, false, signal); return checked(() => calendarProtocol.calendarAvailability(value, calendar, window)); },
    async planning(token, owner, id, signal) { const value = await request(token, owner, calendarPath(id, 'planning'), undefined, undefined, false, signal); return checked(() => calendarProtocol.remotePlanningLinks(value)); },
    async calendarHistory(token, owner, id, task, cursor, signal) {
      const params = new URLSearchParams({ taskId: taskId(task) }); if (cursor !== undefined) { if (!text(cursor, 8192) || !cursor) throw new OpenJobApiError(400, 'invalid_input'); params.set('cursor', cursor); }
      const value = await request(token, owner, calendarPath(id, 'calendar-operations?' + params), undefined, undefined, true, signal);
      if (!object(value) || !Array.isArray(value.data) || value.data.length > 50) invalid();
      const items = checked(() => (value.data as unknown[]).map(row => calendarProtocol.calendarOperation(row, id)));
      if (items.some(row => row.taskId !== task) || new Set(items.map(row => row.id)).size !== items.length) invalid();
      return { items, nextCursor: value.nextCursor as string | null };
    },
    async queueCalendar(token, owner, id, input) { const frozen = calendarProtocol.calendarPlanInput(input); const value = await request(token, owner, calendarPath(id, 'calendar-operations'), frozen); return checked(() => calendarProtocol.calendarOperation(value, id, { input: frozen })); },
    async runCalendar(token, owner, id, operation) { const value = await request(token, owner, calendarPath(id, 'calendar-operations/' + operationId(operation) + '/run-fixture'), undefined, 'POST'); return checked(() => calendarProtocol.calendarOperation(value, id, { id: operation })); },
    async readCalendarOperation(token, owner, id, operation, signal) { const value = await request(token, owner, calendarPath(id, 'calendar-operations/' + operationId(operation)), undefined, undefined, false, signal); return checked(() => calendarProtocol.calendarOperation(value, id, { id: operation })); },
    async reviewCalendar(token, owner, id, task) { const value = await request(token, owner, calendarPath(id, 'planning/' + taskId(task) + '/review'), undefined, 'POST'); return checked(() => calendarProtocol.remotePlanningLinks(value)); },
    async calendarReviewReceipt(token, owner, id, task, operation, event, signal) { const value = await request(token, owner, calendarPath(id, 'planning/' + taskId(task) + '/review?' + new URLSearchParams({ operationId: operationId(operation) })), undefined, undefined, false, signal); return checked(() => calendarProtocol.planningReviewReceipt(value, task, operation, event)); },
    async detachCalendar(token, owner, id, task, input) { const frozen = calendarProtocol.planningDetachInput(input); const value = await request(token, owner, calendarPath(id, 'planning/' + taskId(task) + '/detach'), frozen); return checked(() => calendarProtocol.planningDetachReceipt(value, task, frozen.operationId, frozen)); },
    async calendarDetachReceipt(token, owner, id, task, input, signal) { const frozen = calendarProtocol.planningDetachInput(input); const value = await request(token, owner, calendarPath(id, 'planning/' + taskId(task) + '/detach?' + new URLSearchParams({ operationId: operationId(frozen.operationId) })), undefined, undefined, false, signal); return checked(() => calendarProtocol.planningDetachReceipt(value, task, frozen.operationId, frozen)); },
    async list(token, owner) { const value = await request(token, owner, '/workspaces'); if (!Array.isArray(value) || value.length > 51) invalid(); try { const rows = value.map(validateWorkspace); if (rows.some(item => item.ownerUserId !== owner) || new Set(rows.map(item => item.workspaceId)).size !== rows.length) invalid(); return rows; } catch { return invalid(); } },
    async create(token, owner, name) { return snapshot(await request(token, owner, '/workspaces', { name }), owner); },
    async personal(token, owner) { return snapshot(await request(token, owner, '/workspaces/personal-context', {}), owner); },
    async read(token, owner, id) { return snapshot(await request(token, owner, `/workspaces/${workspaceId(id)}`), owner, id); },
    async command(token, owner, id, input) { return snapshot(await request(token, owner, `/workspaces/${workspaceId(id)}/commands`, input), owner, id); },
    async agentGrants(token, owner, workspace) {
      const target = validateWorkspace(workspace);
      if (target.ownerUserId !== owner) throw new OpenJobApiError(400, 'invalid_input');
      const value = await request(token, owner, `/workspaces/${workspaceId(target.workspaceId)}/agent-grants`);
      if (!object(value) || Object.keys(value).sort().join(',') !== 'actions,agents' || !Array.isArray(value.agents) || value.agents.length > 100 || !Array.isArray(value.actions)) invalid();
      try {
        const agents = value.agents.map(row => validateWorkspaceAgent(target, row));
        if (new Set(agents.map(row => row.id)).size !== agents.length) invalid();
        return { agents, actions: parseWorkspaceAgentActions(JSON.stringify(value.actions)) };
      } catch { return invalid(); }
    },
    async revokeAgent(token, owner, id, agentId) {
      if (!WORKSPACE_AGENT_ID.test(agentId)) throw new OpenJobApiError(400, 'invalid_input');
      const value = await request(token, owner, `/workspaces/${workspaceId(id)}/agent-grants/${agentId}`, undefined, 'DELETE');
      if (!object(value) || Object.keys(value).sort().join(',') !== 'id,revoked' || value.id !== agentId || value.revoked !== true) invalid();
      return { id: agentId, revoked: true };
    },
    async connections(token, owner) {
      const value = await request(token, owner, '/connections') as GoogleConnectionCatalog;
      if (!object(value) || Object.keys(value).sort().join(',') !== 'bindings,homes,mailAvailable,mode' || !mode(value.mode) || typeof value.mailAvailable !== 'boolean' || !Array.isArray(value.bindings) || value.bindings.length > 50 || !Array.isArray(value.homes) || value.homes.length > 51) invalid();
      for (const row of value.bindings) if (!object(row) || Object.keys(row).some(key => !['id', 'workspaceId', 'address', 'status', 'operation', 'expired'].includes(key)) || !/^con_[a-f0-9]{32}$/.test(row.id) || !WORKSPACE_ID.test(row.workspaceId) || !text(row.address, 254) || typeof row.expired !== 'boolean' || row.operation !== undefined && !['exchange', 'refresh'].includes(row.operation) || !['authorizing', 'consent_required', 'connected', 'cancelled', 'reconnect_required', 'cleanup_pending', 'disconnected'].includes(row.status)) invalid();
      for (const row of value.homes) if (!object(row) || Object.keys(row).sort().join(',') !== 'name,workspaceId' || !WORKSPACE_ID.test(row.workspaceId) || !text(row.name, 160)) invalid();
      if (new Set(value.bindings.map(row => row.id)).size !== value.bindings.length || new Set(value.homes.map(row => row.workspaceId)).size !== value.homes.length) invalid();
      return value;
    },
    async mail(token, owner, id, connection, query = {}) {
      const parameters = new URLSearchParams({ view: 'metadata' });
      if (!object(query) || Object.keys(query).some(key => !['cursor', 'folderId', 'search'].includes(key))) throw new OpenJobApiError(400, 'invalid_input');
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === '') continue;
        if (typeof value !== 'string' || value.length > (key === 'cursor' ? 4096 : 512) || /[\u0000-\u001f\u007f]/.test(value) || key === 'folderId' && !/^gmail_[a-f0-9]{32}:folder:[A-Za-z0-9_-]{1,128}$/.test(value)) throw new OpenJobApiError(400, 'invalid_input');
        parameters.set(key, key === 'search' ? value.trim() : value);
      }
      workspaceId(id); const value = await request(token, owner, `/connections/${connectionId(connection)}/mail?${parameters}`) as ConnectedMail;
      if (!object(value) || Object.keys(value).sort().join(',') !== 'freshness,mode,page,workspaceId' || value.workspaceId !== id || !mode(value.mode) || !object(value.page) || Object.keys(value.page).sort().join(',') !== 'calendars,events,folders,messages,nextCursor,syncCursor' || !Array.isArray(value.page.messages) || value.page.messages.length > 10 || !Array.isArray(value.page.folders) || value.page.folders.length > 500 || !Array.isArray(value.page.calendars) || value.page.calendars.length || !Array.isArray(value.page.events) || value.page.events.length || value.page.syncCursor !== null || value.page.nextCursor !== null && !text(value.page.nextCursor, 4096)) invalid();
      try { mailReadWindow(value.freshness, 0, 0); } catch { invalid(); }
      const messages = value.page.messages.map(summary);
      for (const folder of value.page.folders) if (!object(folder) || Object.keys(folder).sort().join(',') !== 'accountId,id,name,upstreamId' || !text(folder.accountId, 64) || !/^gmail_[a-f0-9]{32}$/.test(folder.accountId) || !text(folder.upstreamId, 128) || !/^[A-Za-z0-9_-]+$/.test(folder.upstreamId) || folder.id !== `${folder.accountId}:folder:${folder.upstreamId}` || !text(folder.name, 256)) invalid();
      if (new Set([...messages.map(item => item.accountId), ...value.page.folders.map(item => item.accountId)]).size > 1 || new Set(messages.map(item => item.id)).size !== messages.length) invalid();
      return { ...value, page: { ...value.page, messages } };
    },
    async message(token, owner, id, connection, upstreamId) {
      workspaceId(id); const value = await request(token, owner, `/connections/${connectionId(connection)}/mail/${taskId(upstreamId)}`);
      if (!object(value) || Object.keys(value).sort().join(',') !== 'message,mode,workspaceId' || value.workspaceId !== id || !mode(value.mode)) invalid();
      const full = message(value.message); if (full.upstreamId !== upstreamId) invalid();
      return { workspaceId: id, mode: value.mode as 'google' | 'google-fixture', message: full };
    },
    async createMailTask(token, owner, id, connection, input) {
      workspaceId(id); const value = await request(token, owner, `/connections/${connectionId(connection)}/tasks`, input);
      if (!object(value) || Object.keys(value).sort().join(',') !== 'created,taskId,workspaceId' || value.workspaceId !== id || !text(value.taskId, 128) || !/^[A-Za-z0-9_-]+$/.test(value.taskId) || typeof value.created !== 'boolean') invalid();
      return { workspaceId: id, taskId: value.taskId, created: value.created };
    },
    async source(token, owner, id, task) {
      const value = await request(token, owner, sourcePath(id, task)); scoped(value, id, task);
      if (Object.keys(value).sort().join(',') !== 'address,message,mode,taskId,workspaceId' || !mode(value.mode) || !text(value.address, 254)) invalid();
      return { ...value, message: message(value.message) } as ConnectedSource;
    },
    async reply(token, owner, id, task) {
      const value = await request(token, owner, sourcePath(id, task) + '/reply'); scoped(value, id, task);
      const data = value as unknown as ReplyPreparation;
      if (Object.keys(value).sort().join(',') !== 'draft,plans,reviewToken,storageKind,taskId,workspaceId' || data.storageKind !== 'openjob' || !object(data.plans) || Object.keys(data.plans).sort().join(',') !== 'reply,replyAll' || !validReplyPlan(data.plans.reply) || !validReplyPlan(data.plans.replyAll) || !/^[a-f0-9]{64}$/.test(data.reviewToken)) invalid();
      if (data.draft !== null) { try { validateConnectedReplyDraft(data.draft); } catch { invalid(); } }
      return data;
    },
    async saveReply(token, owner, id, task, input) {
      validateReplySave(input); const value = await request(token, owner, sourcePath(id, task) + '/reply', input); scoped(value, id, task);
      try { const draft = validateConnectedReplyDraft(value.draft); if (Object.keys(value).sort().join(',') !== 'draft,taskId,workspaceId' || draft.body !== input.body || draft.mode !== input.mode) invalid(); return { workspaceId: id, taskId: task, draft }; } catch { return invalid(); }
    },
  };
}
