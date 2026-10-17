import { validateTaskCalendarProjection, type TaskCalendarProjection } from './task-calendar-sync.ts';
export type OwnedWorkspace = { workspaceId: string; ownerUserId: string; name: string; createdAt: string; taskSpaceId: string; calendarId: string };
export type OwnedWorkspaceSnapshot = { workspace: OwnedWorkspace; work: TaskCalendarProjection };
export const WORKSPACE_ID = /^wsp_[a-f0-9]{32}$/;
export function workspaceFail(code = 'invalid_input'): never { throw Object.assign(new Error('Workspace unavailable or invalid.'), { code }); }
export function validateWorkspace(value: unknown): OwnedWorkspace {
  if (!value || typeof value !== 'object' || Array.isArray(value)) workspaceFail();
  const item = value as OwnedWorkspace;
  if (Object.keys(item).sort().join(',') !== 'calendarId,createdAt,name,ownerUserId,taskSpaceId,workspaceId' || !WORKSPACE_ID.test(item.workspaceId) || !/^user_[a-f0-9]{32}$/.test(item.ownerUserId) || !/^tsp_[a-f0-9]{32}$/.test(item.taskSpaceId) || !/^cal_[a-f0-9]{32}$/.test(item.calendarId) || typeof item.name !== 'string' || !item.name.trim() || [...item.name].length > 80 || /[\u0000-\u001f\u007f]/.test(item.name) || !Number.isFinite(Date.parse(item.createdAt))) workspaceFail();
  return item;
}
export function validateOwnedSnapshot(value: unknown): OwnedWorkspaceSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'work,workspace') workspaceFail();
  const snapshot = value as OwnedWorkspaceSnapshot; const workspace = validateWorkspace(snapshot.workspace);
  const work = validateTaskCalendarProjection(workspace.ownerUserId, snapshot.work);
  if (work.calendars.length !== 1 || work.calendars[0].id !== workspace.calendarId) workspaceFail('invalid_state');
  return { workspace, work };
}
