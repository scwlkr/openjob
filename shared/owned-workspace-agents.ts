import { workspaceFail, type OwnedWorkspace, type OwnedWorkspaceSnapshot } from './owned-workspaces.ts';
import type { TaskCalendarCommand, TaskCalendarProjection } from './task-calendar-sync.ts';
export const WORKSPACE_AGENT_ID = /^agt_[a-f0-9]{32}$/;
export const WORKSPACE_AGENT_TOKEN = /^oj_workspace_(wsp_[a-f0-9]{32})\.(agt_[a-f0-9]{32})\.([A-Za-z0-9_-]{43})$/;
export const WORKSPACE_AGENT_LIFETIME_MS = 86_400_000;
export const WORKSPACE_AGENT_SCOPES = ['tasks:read', 'tasks:write', 'calendar:read', 'calendar:write'] as const;
export type WorkspaceAgentScope = typeof WORKSPACE_AGENT_SCOPES[number];
export type WorkspaceAgentInput = { name: string; scopes: WorkspaceAgentScope[]; resourceIds: string[] };
export type WorkspaceAgentGrant = WorkspaceAgentInput & { id: string; ownerUserId: string; workspaceId: string; createdAt: string; expiresAt: string; revoked: boolean };
export type StoredWorkspaceAgent = WorkspaceAgentGrant & { tokenHash: string };
export const WORKSPACE_AGENT_OPERATIONS = ['task.create', 'task.update', 'task.notes', 'task.complete', 'task.delete', 'task.unschedule', 'task.schedule', 'calendar.create', 'calendar.update', 'calendar.delete'] as const;
export type WorkspaceAgentOperation = typeof WORKSPACE_AGENT_OPERATIONS[number];
export type WorkspaceAgentAction = { agentId: string; operation: WorkspaceAgentOperation; itemId: string; at: string };
export type WorkspaceAgentReceipt = { workspaceId: string; operation: WorkspaceAgentOperation; itemId: string };
export type WorkspaceAgentView = { workspaceId: string; access: { scopes: WorkspaceAgentScope[]; resourceIds: string[] }; work: TaskCalendarProjection };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const iso = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export function validateWorkspaceAgentInput(workspace: OwnedWorkspace, input: unknown): WorkspaceAgentInput {
  if (!object(input) || Object.keys(input).sort().join(',') !== 'name,resourceIds,scopes' || typeof input.name !== 'string' || !input.name.trim() || [...input.name.trim()].length > 80 || /[\u0000-\u001f\u007f-\u009f]/.test(input.name)) workspaceFail();
  if (!Array.isArray(input.scopes) || !input.scopes.length || input.scopes.length > 4 || new Set(input.scopes).size !== input.scopes.length || input.scopes.some(scope => !WORKSPACE_AGENT_SCOPES.includes(scope))) workspaceFail();
  if (!Array.isArray(input.resourceIds) || !input.resourceIds.length || input.resourceIds.length > 2 || new Set(input.resourceIds).size !== input.resourceIds.length || input.resourceIds.some(id => ![workspace.taskSpaceId, workspace.calendarId].includes(id))) workspaceFail();
  for (const [family, resource] of [['tasks', workspace.taskSpaceId], ['calendar', workspace.calendarId]]) {
    if (input.scopes.some(scope => scope.startsWith(`${family}:`)) !== input.resourceIds.includes(resource)) workspaceFail();
  }
  return { name: input.name.trim(), scopes: [...input.scopes], resourceIds: [...input.resourceIds] } as WorkspaceAgentInput;
}
export function validateWorkspaceAgent(workspace: OwnedWorkspace, value: unknown): WorkspaceAgentGrant {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'createdAt,expiresAt,id,name,ownerUserId,resourceIds,revoked,scopes,workspaceId') workspaceFail('invalid_state');
  try { validateWorkspaceAgentInput(workspace, { name: value.name, scopes: value.scopes, resourceIds: value.resourceIds }); } catch { workspaceFail('invalid_state'); }
  if (typeof value.id !== 'string' || !WORKSPACE_AGENT_ID.test(value.id) || value.ownerUserId !== workspace.ownerUserId || value.workspaceId !== workspace.workspaceId || typeof value.revoked !== 'boolean' || !iso(value.createdAt) || !iso(value.expiresAt) || Date.parse(value.expiresAt) - Date.parse(value.createdAt) !== WORKSPACE_AGENT_LIFETIME_MS) workspaceFail('invalid_state');
  return structuredClone(value) as WorkspaceAgentGrant;
}
export function parseWorkspaceAgents(workspace: OwnedWorkspace, encoded?: string): StoredWorkspaceAgent[] {
  if (encoded === undefined) return [];
  let value: unknown; try { value = JSON.parse(encoded); } catch { workspaceFail('invalid_state'); }
  if (!Array.isArray(value) || value.length > 100) workspaceFail('invalid_state');
  const seen = new Set<string>();
  return value.map(row => {
    if (!object(row) || typeof row.tokenHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.tokenHash)) workspaceFail('invalid_state');
    const { tokenHash, ...publicRow } = row; const grant = validateWorkspaceAgent(workspace, publicRow);
    if (seen.has(grant.id)) workspaceFail('invalid_state'); seen.add(grant.id);
    return { ...grant, tokenHash };
  });
}
export function publicWorkspaceAgent({ tokenHash: _, ...grant }: StoredWorkspaceAgent): WorkspaceAgentGrant { void _; return structuredClone(grant); }
export function parseWorkspaceAgentActions(encoded?: string): WorkspaceAgentAction[] {
  if (encoded === undefined) return [];
  let value: unknown; try { value = JSON.parse(encoded); } catch { workspaceFail('invalid_state'); }
  if (!Array.isArray(value) || value.length > 200 || value.some(row => !object(row) || Object.keys(row).sort().join(',') !== 'agentId,at,itemId,operation' || typeof row.agentId !== 'string' || !WORKSPACE_AGENT_ID.test(row.agentId) || !WORKSPACE_AGENT_OPERATIONS.includes(row.operation as WorkspaceAgentOperation) || typeof row.itemId !== 'string' || !/^offline_[a-f0-9-]{36}$/.test(row.itemId) || !iso(row.at))) workspaceFail('invalid_state');
  return structuredClone(value) as WorkspaceAgentAction[];
}
export function workspaceAgentView(snapshot: OwnedWorkspaceSnapshot, grant: WorkspaceAgentGrant): WorkspaceAgentView {
  const tasks = grant.scopes.includes('tasks:read') && grant.resourceIds.includes(snapshot.workspace.taskSpaceId);
  const calendar = grant.scopes.includes('calendar:read') && grant.resourceIds.includes(snapshot.workspace.calendarId);
  if (!tasks && !calendar) workspaceFail('forbidden');
  const work = structuredClone(snapshot.work);
  work.tasks = tasks ? work.tasks.map(task => { if (!calendar) { delete task.scheduledSlot; delete task.calendarEventId; } return task; }) : [];
  work.calendars = calendar ? work.calendars : [];
  work.events = calendar ? work.events.map(event => { if (!tasks) delete event.taskId; return event; }) : [];
  return { workspaceId: snapshot.workspace.workspaceId, access: { scopes: [...grant.scopes], resourceIds: [...grant.resourceIds] }, work };
}
/** Only checks authority; the canonical Task/Calendar engine validates and applies the command. */
export function authorizeWorkspaceAgentCommand(snapshot: OwnedWorkspaceSnapshot, grant: WorkspaceAgentGrant, input: unknown): asserts input is TaskCalendarCommand {
  if (!object(input) || !WORKSPACE_AGENT_OPERATIONS.includes(input.type as WorkspaceAgentOperation)) workspaceFail('forbidden');
  const { workspace, work } = snapshot;
  const need = (scope: WorkspaceAgentScope, resource: string) => { if (!grant.scopes.includes(scope) || !grant.resourceIds.includes(resource)) workspaceFail('forbidden'); };
  if ((input.type as string).startsWith('task.')) {
    need('tasks:write', workspace.taskSpaceId);
    const task = input.type === 'task.create' ? undefined : work.tasks.find(row => row.id === input.taskId);
    if (input.type !== 'task.create' && !task) workspaceFail('forbidden');
    if (input.type === 'task.schedule') { need('calendar:write', workspace.calendarId); if (input.calendarId !== workspace.calendarId) workspaceFail('forbidden'); }
    if (task?.calendarEventId && ['task.update', 'task.delete', 'task.unschedule'].includes(input.type as string)) need('calendar:write', workspace.calendarId);
  } else {
    need('calendar:write', workspace.calendarId);
    const event = input.type === 'calendar.create' ? undefined : work.events.find(row => row.id === input.eventId);
    if (input.type === 'calendar.create' ? input.calendarId !== workspace.calendarId : !event) workspaceFail('forbidden');
    if (event?.taskId) need('tasks:write', workspace.taskSpaceId);
  }
}
