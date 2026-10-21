import { CliError } from './errors.mjs';
import { readInputObject } from './input.mjs';
import { normalizeWorkspaceTaskQuery, filterWorkspaceTasks } from './workspace-task-query.mjs';
import { ownedWorkspaceId, prepareWorkspaceAgentGrant, deliverWorkspaceAgentGrant, publicWorkspaceAgent, publicWorkspaceAgentAction } from './owned-workspace-agents.mjs';
export async function runOwnedWorkspace({ command, rest, options, apiRequest, writeResult, confirmDestructiveAction }) {
  const id = ownedWorkspaceId(options.get('--workspace')), path = `/workspaces/${id}`;
  if (command === 'snapshot' && rest.length === 0) { writeResult(await apiRequest(path, {}, { retryable: true })); return; }
  if (command === 'tasks' && rest.length === 0) {
    let query;
    try { query = normalizeWorkspaceTaskQuery({ status: options.get('--status'), search: options.get('--search'), scheduledOn: options.get('--scheduled-on') }); }
    catch { throw new CliError('input_invalid', 'Use valid Task status, literal search and calendar-day filters.', 2); }
    const response = await apiRequest(path, {}, { retryable: true });
    if (response?.data?.access && !response.data.access.scopes?.includes('tasks:read')) throw new CliError('forbidden', 'This credential has no Tasks read permission.', 4);
    if (!Array.isArray(response?.data?.work?.tasks)) throw new CliError('invalid_response', 'Workspace Tasks unavailable.', 8);
    writeResult({ data: filterWorkspaceTasks(response.data.work.tasks, query) }); return;
  }
  if (command === 'command' && rest.length === 0) {
    const file = options.get('--input'); if (typeof file !== 'string' || !file) throw new CliError('usage_error', 'Workspace command requires --input <path|->.', 2);
    const value = readInputObject(file);
    const fields = { 'task.create': ['title'], 'task.update': ['taskId', 'title'], 'task.notes': ['taskId', 'notes', 'expectedNotes'], 'task.complete': ['taskId', 'completed'], 'task.delete': ['taskId'], 'task.unschedule': ['taskId'], 'task.schedule': ['taskId', 'calendarId', 'start', 'end'], 'task.schedule-available': ['taskId', 'calendarId', 'start', 'end'], 'calendar.create': ['calendarId', 'title', 'start', 'end'], 'calendar.update': ['eventId', 'title', 'start', 'end'], 'calendar.delete': ['eventId'] };
    const required = Object.hasOwn(fields, value.type) ? fields[value.type] : undefined;
    if (!required || Object.keys(value).sort().join(',') !== ['type', ...required].sort().join(',') || Buffer.byteLength(JSON.stringify(value)) > 250000 || required.some(key => key === 'completed' ? typeof value[key] !== 'boolean' : typeof value[key] !== 'string' || !['notes', 'expectedNotes'].includes(key) && !value[key].trim())) throw new CliError('input_invalid', 'Use one documented Workspace Tasks/Calendar command with its exact fields. Notes require expectedNotes.', 2);
    if (options.has('--agent-token-file') && value.type === 'task.schedule-available') throw new CliError('forbidden', 'Availability planning requires a human session.', 4);
    writeResult(await apiRequest(`${path}/commands`, { method: 'POST', body: JSON.stringify(value) })); return;
  }
  if (command === 'agent' && rest[0] === 'grant' && rest.length === 1) {
    const prepared = prepareWorkspaceAgentGrant(options); let response;
    try { response = await apiRequest(`${path}/agent-grants`, { method: 'POST', body: JSON.stringify(prepared.body) }); }
    catch (error) {
      if (!(error instanceof CliError) || !['service_unavailable', 'invalid_response'].includes(error.code) && error.exitStatus !== 8) throw error;
      throw new CliError('agent_grant_uncertain', `Grant issuance could not be confirmed. Inspect openjob workspace agent list --workspace ${id} and revoke uncertain grants before retrying. No automatic retry was made.`, 8);
    }
    writeResult({ data: deliverWorkspaceAgentGrant(response, prepared) }); return;
  }
  if (command === 'agent' && rest[0] === 'list' && rest.length === 1) {
    const response = await apiRequest(`${path}/agent-grants`, {}, { retryable: true });
    if (!Array.isArray(response?.data?.agents) || response.data.agents.length > 100 || !Array.isArray(response?.data?.actions) || response.data.actions.length > 200) throw new CliError('invalid_response', 'Workspace agent access unavailable.', 8);
    writeResult({ data: { agents: response.data.agents.map(row => publicWorkspaceAgent(row, id)), actions: response.data.actions.map(publicWorkspaceAgentAction) } }); return;
  }
  if (command === 'agent' && rest[0] === 'revoke' && rest.length === 2) {
    const agentId = rest[1]; if (!/^agt_[a-f0-9]{32}$/.test(agentId)) throw new CliError('usage_error', 'Use an Agent ID returned for this Workspace.', 2);
    await confirmDestructiveAction(`Revoke agent ${agentId} in ${id}?`, 'Non-interactive revocation requires --yes.', options);
    writeResult(await apiRequest(`${path}/agent-grants/${agentId}`, { method: 'DELETE' })); return;
  }
  throw new CliError('usage_error', 'Owned Workspace supports snapshot, tasks, command and agent grant/list/revoke. Personal commands remain separate.', 2);
}
