import { CliError } from './errors.mjs';
import { readInputObject } from './input.mjs';
import { ownedWorkspaceId } from './owned-workspace-agents.mjs';
import * as protocol from './calendar-protocol.mjs';
const cop = value => typeof value === 'string' && /^cop_[a-f0-9]{64}$/.test(value);
const task = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const usage = () => { throw new CliError('usage_error', 'Use calendar/planning/calendar-operation --help with an explicit --workspace.', 2); };
const validate = action => { try { return action(); } catch { throw new CliError('invalid_response', 'Provider Calendar response unavailable. Inspect saved planning and operations before retrying.', 8); } };
export async function runProviderCalendar({ resource, command, rest, options, apiRequest, writeResult }) {
  const workspace = ownedWorkspaceId(options.get('--workspace')), base = '/workspaces/' + workspace;
  let response, data;
  if (resource === 'calendar') {
    if (command === 'accounts' && !rest.length) { response = await apiRequest(base + '/provider-calendars/accounts', {}, { retryable: true }); writeResult({ data: validate(() => protocol.calendarAccounts(response?.data)) }); return; }
    if (rest.length || !['list', 'events', 'availability'].includes(command)) usage();
    const account = options.get('--account'); if (!task(account)) usage(); const query = new URLSearchParams({ accountId: account });
    const target = options.get('--calendar'); let window;
    if (command !== 'list') {
      const start = options.get('--schedule-start'), end = options.get('--schedule-end');
      if (!target || !start || !end || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end))) usage();
      window = { start: new Date(start).toISOString(), end: new Date(end).toISOString() }; query.set('calendarId', target); query.set('start', window.start); query.set('end', window.end);
    }
    if (options.has('--cursor')) query.set('cursor', options.get('--cursor'));
    response = await apiRequest(base + '/provider-calendars' + (command === 'list' ? '' : '/' + command) + '?' + query, {}, { retryable: true });
    data = validate(() => command === 'list' ? protocol.calendarListPage(response?.data, account) : command === 'events' ? protocol.calendarEventsPage(response?.data, account, target) : protocol.calendarAvailability(response?.data, target, window));
  } else if (resource === 'calendar-operation') {
    const path = base + '/calendar-operations';
    if (command === 'list' && !rest.length) {
      const query = new URLSearchParams(); if (options.has('--task')) { if (!task(options.get('--task'))) usage(); query.set('taskId', options.get('--task')); } if (options.has('--cursor')) query.set('cursor', options.get('--cursor'));
      response = await apiRequest(path + (query.size ? '?' + query : ''), {}, { retryable: true });
      if (!Array.isArray(response?.data) || response.data.length > 50 || response.nextCursor !== null && typeof response.nextCursor !== 'string') throw new CliError('invalid_response', 'Calendar operation history unavailable.', 8);
      const rows = validate(() => response.data.map(row => protocol.calendarOperation(row, workspace)));
      if (options.has('--task') && rows.some(row => row.taskId !== options.get('--task'))) throw new CliError('invalid_response', 'Calendar operation history does not match the requested Task.', 8);
      writeResult({ data: rows, nextCursor: response.nextCursor }); return;
    }
    let expected;
    if (command === 'enqueue' && !rest.length) {
      let input; try { input = protocol.calendarPlanInput(readInputObject(options.get('--input'))); } catch { throw new CliError('input_invalid', 'Use a reviewed Calendar intent and retain its requestId for recovery.', 2); }
      response = await apiRequest(path, { method: 'POST', body: JSON.stringify(input) });
      expected = { input };
    } else if (['show', 'run-fixture'].includes(command) && rest.length === 1 && cop(rest[0])) response = await apiRequest(path + '/' + rest[0] + (command === 'run-fixture' ? '/run-fixture' : ''), command === 'show' ? {} : { method: 'POST' }, { retryable: command === 'show' });
    else usage();
    data = validate(() => protocol.calendarOperation(response?.data, workspace, expected ?? { id: rest[0] }));
    if (command === 'run-fixture') process.exitCode = data.state === 'confirmed' ? 0 : data.state === 'rejected' ? 4 : 8;
  } else if (resource === 'planning') {
    if (command === 'list' && !rest.length) { response = await apiRequest(base + '/planning', {}, { retryable: true }); data = validate(() => protocol.remotePlanningLinks(response?.data)); }
    else if (command === 'review' && rest.length === 1 && task(rest[0])) { response = await apiRequest(base + '/planning/' + rest[0] + '/review', { method: 'POST' }); data = validate(() => protocol.remotePlanningLinks(response?.data)); }
    else if (command === 'review-receipt' && rest.length === 2 && task(rest[0]) && cop(rest[1])) { response = await apiRequest(base + '/planning/' + rest[0] + '/review?' + new URLSearchParams({ operationId: rest[1] }), {}, { retryable: true }); data = validate(() => protocol.planningReviewReceipt(response?.data, rest[0], rest[1])); }
    else if (command === 'detach' && rest.length === 1 && task(rest[0])) {
      let input; try { input = protocol.planningDetachInput(readInputObject(options.get('--input'))); } catch { throw new CliError('input_invalid', 'Detaching requires the exact reviewed link and acknowledge: leave_provider_event. It does not delete the event.', 2); }
      response = await apiRequest(base + '/planning/' + rest[0] + '/detach', { method: 'POST', body: JSON.stringify(input) }); data = validate(() => protocol.planningDetachReceipt(response?.data, rest[0], input.operationId, input));
    } else if (command === 'detach-receipt' && rest.length === 2 && task(rest[0]) && cop(rest[1])) { response = await apiRequest(base + '/planning/' + rest[0] + '/detach?' + new URLSearchParams({ operationId: rest[1] }), {}, { retryable: true }); data = validate(() => protocol.planningDetachReceipt(response?.data, rest[0], rest[1])); }
    else usage();
  } else usage();
  writeResult({ data });
}
