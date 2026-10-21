import { lstatSync } from 'node:fs';
import { CliError } from './errors.mjs';
import { preparePrivateTokenOutput } from './agent-grant.mjs';
import { readTextSource } from './input.mjs';
import { writeEnvelope } from './output.mjs';
const SCOPES = ['tasks:read', 'tasks:write', 'calendar:read', 'calendar:write'];
export function ownedWorkspaceId(value) {
  if (typeof value !== 'string' || !/^wsp_[a-f0-9]{32}$/.test(value)) throw new CliError('usage_error', 'Use an explicit owned Workspace ID with --workspace.', 2);
  return value;
}
function input(value) {
  const { name, scopes, resourceIds } = value ?? {};
  if (typeof name !== 'string' || !name.trim() || [...name.trim()].length > 80 || /[\u0000-\u001f\u007f-\u009f]/.test(name) || !Array.isArray(scopes) || !scopes.length || scopes.length > 4 || new Set(scopes).size !== scopes.length || scopes.some(scope => !SCOPES.includes(scope)) || !Array.isArray(resourceIds) || !resourceIds.length || resourceIds.length > 2 || new Set(resourceIds).size !== resourceIds.length || resourceIds.some(id => typeof id !== 'string' || !/^(tsp|cal)_[a-f0-9]{32}$/.test(id))) throw new CliError('input_invalid', 'Use a plain-text name, supported Task/Calendar scopes and exact Workspace resource IDs.', 2);
  for (const [family, prefix] of [['tasks:', 'tsp_'], ['calendar:', 'cal_']]) if (scopes.some(scope => scope.startsWith(family)) !== resourceIds.some(id => id.startsWith(prefix)) || resourceIds.filter(id => id.startsWith(prefix)).length > 1) throw new CliError('input_invalid', 'Match each scope family to exactly one resource.', 2);
  return { name: name.trim(), scopes: [...scopes], resourceIds: [...resourceIds] };
}
export function prepareWorkspaceAgentGrant(options) {
  const list = key => { const value = options.get(key); return typeof value === 'string' ? value.split(',').map(item => item.trim()) : []; };
  return { workspaceId: ownedWorkspaceId(options.get('--workspace')), body: input({ name: options.get('--name'), scopes: list('--scopes'), resourceIds: list('--resources') }), tokenOptions: preparePrivateTokenOutput(options) };
}
export function publicWorkspaceAgent(value, workspaceId) {
  try {
    const selected = input(value);
    if (!value || Object.keys(value).sort().join(',') !== 'createdAt,expiresAt,id,name,ownerUserId,resourceIds,revoked,scopes,workspaceId' || !/^agt_[a-f0-9]{32}$/.test(value.id) || !/^user_[a-f0-9]{32}$/.test(value.ownerUserId) || value.workspaceId !== workspaceId || typeof value.revoked !== 'boolean' || typeof value.createdAt !== 'string' || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) || Date.parse(value.expiresAt) - Date.parse(value.createdAt) !== 86_400_000) throw new Error();
    return { ...selected, id: value.id, ownerUserId: value.ownerUserId, workspaceId, createdAt: value.createdAt, expiresAt: value.expiresAt, revoked: value.revoked };
  } catch { throw new CliError('invalid_response', 'Invalid Workspace grant metadata. Inspect access before retrying.', 8); }
}
export function deliverWorkspaceAgentGrant(response, prepared) {
  const agent = publicWorkspaceAgent(response?.data?.agent, prepared.workspaceId), token = response?.data?.token;
  const equal = (left, right) => left.length === right.length && left.every(item => right.includes(item));
  if (agent.name !== prepared.body.name || agent.revoked || !equal(agent.scopes, prepared.body.scopes) || !equal(agent.resourceIds, prepared.body.resourceIds) || typeof token !== 'string' || !new RegExp(`^oj_workspace_${prepared.workspaceId}\\.${agent.id}\\.[A-Za-z0-9_-]{43}$`).test(token)) throw new CliError('invalid_response', 'Invalid Workspace grant delivery. Inspect access and revoke uncertain grants before retrying.', 8);
  try { writeEnvelope({ data: token }, 'table', prepared.tokenOptions); }
  catch { throw new CliError('agent_token_delivery_failed', `Grant ${agent.id} was created but its credential was not saved. Revoke it with openjob workspace agent revoke ${agent.id} --workspace ${prepared.workspaceId} --yes.`, 8); }
  return agent;
}
export function readWorkspaceAgentToken(path, workspaceId) {
  ownedWorkspaceId(workspaceId);
  if (path !== '-') {
    try { const file = lstatSync(path); if (!file.isFile() || (file.mode & 0o077) !== 0) throw new Error(); }
    catch { throw new CliError('input_invalid', 'Workspace agent credentials require a regular private file (mode 0600), or stdin.', 2); }
  }
  const token = readTextSource(path), match = /^oj_workspace_(wsp_[a-f0-9]{32})\.agt_[a-f0-9]{32}\.[A-Za-z0-9_-]{43}$/.exec(token);
  if (match?.[1] !== workspaceId) throw new CliError('input_invalid', 'Use this Workspace’s exact credential with --workspace. Personal and Group credentials are separate.', 2);
  return token;
}

export function publicWorkspaceAgentAction(value) {
  const operations = ['task.create', 'task.update', 'task.notes', 'task.complete', 'task.delete', 'task.unschedule', 'task.schedule', 'calendar.create', 'calendar.update', 'calendar.delete'];
  if (!value || Object.keys(value).sort().join(',') !== 'agentId,at,itemId,operation' || typeof value.agentId !== 'string' || !/^agt_[a-f0-9]{32}$/.test(value.agentId) || !operations.includes(value.operation) || typeof value.itemId !== 'string' || !/^offline_[a-f0-9-]{36}$/.test(value.itemId) || typeof value.at !== 'string' || !Number.isFinite(Date.parse(value.at)) || new Date(value.at).toISOString() !== value.at) throw new CliError('invalid_response', 'Invalid Workspace action metadata.', 8);
  const { agentId, operation, itemId, at } = value; return { agentId, operation, itemId, at };
}
