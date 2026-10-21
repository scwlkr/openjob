import { CliError } from './errors.mjs';
import { readInputObject } from './input.mjs';
import { ownedWorkspaceId } from './owned-workspace-agents.mjs';
const id = value => typeof value === 'string' && /^op_[a-f0-9]{64}$/.test(value);
function view(value, workspaceId) {
  const fields = ['id', 'workspaceId', 'taskId', 'action', 'requestId', 'draftRevision', 'state', 'createdAt', 'updatedAt', 'dispatchBefore', 'receiptExpiresAt', 'mode', 'receiptExpired', ...(value?.outcome === undefined ? [] : ['outcome']), ...(value?.receiptId === undefined ? [] : ['receiptId'])];
  if (!value || Object.keys(value).sort().join(',') !== fields.sort().join(',') || !id(value.id) || value.workspaceId !== workspaceId || !/^[A-Za-z0-9_-]{1,128}$/.test(value.taskId) || value.action !== 'reply.simulate' || value.mode !== 'fixture' || typeof value.receiptExpired !== 'boolean' || !Number.isSafeInteger(value.draftRevision) || value.draftRevision < 1 || !/^[a-f0-9-]{36}$/.test(value.requestId) || !['queued', 'executing', 'confirmed', 'rejected', 'unknown'].includes(value.state) || !['createdAt', 'updatedAt', 'dispatchBefore', 'receiptExpiresAt'].every(key => typeof value[key] === 'string' && Number.isFinite(Date.parse(value[key]))) || value.outcome !== undefined && !['simulated_accepted', 'synthetic_rejected', 'authority_changed', 'payload_invalid', 'intent_expired', 'dispatch_unknown'].includes(value.outcome) || value.receiptId !== undefined && !/^sim_[a-f0-9]{32}$/.test(value.receiptId)) throw new CliError('invalid_response', 'Invalid reply simulation receipt. Inspect the operation before retrying.', 8);
  return value;
}
export async function runReplyOperation({ command, rest, options, apiRequest, writeResult }) {
  const workspaceId = ownedWorkspaceId(options.get('--workspace')), path = `/workspaces/${workspaceId}/operations`;
  let response;
  if (command === 'list' && rest.length === 0) {
    const query = new URLSearchParams(); if (options.has('--task')) query.set('taskId', options.get('--task')); if (options.has('--cursor')) query.set('cursor', options.get('--cursor'));
    response = await apiRequest(path + (query.size ? '?' + query : ''), {}, { retryable: true });
    if (!Array.isArray(response?.data) || response.data.length > 50 || response.nextCursor !== null && typeof response.nextCursor !== 'string') throw new CliError('invalid_response', 'Invalid operation history.', 8);
    writeResult({ data: response.data.map(row => view(row, workspaceId)), nextCursor: response.nextCursor }); return;
  }
  if (command === 'enqueue' && rest.length === 0) {
    const input = readInputObject(options.get('--input'));
    if (Object.keys(input).sort().join(',') !== 'action,draftRevision,requestId,reviewToken,taskId' || input.action !== 'reply.simulate' || !/^[A-Za-z0-9_-]{1,128}$/.test(input.taskId) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input.requestId) || !Number.isSafeInteger(input.draftRevision) || input.draftRevision < 1 || !/^[a-f0-9]{64}$/.test(input.reviewToken)) throw new CliError('input_invalid', 'Use an exact saved-reply simulation input and retain its requestId for retries.', 2);
    response = await apiRequest(path, { method: 'POST', body: JSON.stringify(input) });
  } else if (['show', 'run-fixture'].includes(command) && rest.length === 1 && id(rest[0])) response = await apiRequest(path + '/' + rest[0] + (command === 'run-fixture' ? '/run-fixture' : ''), command === 'show' ? {} : { method: 'POST' }, { retryable: command === 'show' });
  else throw new CliError('usage_error', 'Use operation list/show/enqueue/run-fixture with --workspace <wsp_id>. Only the synthetic launcher configures execution.', 2);
  const data = view(response?.data, workspaceId); writeResult({ data });
  if (command === 'run-fixture') process.exitCode = data.state === 'confirmed' ? 0 : data.state === 'rejected' ? 4 : 8;
}
