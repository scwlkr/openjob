import { validateWorkspace, workspaceFail, type OwnedWorkspace } from './owned-workspaces.ts';
import { taskCalendarDate } from './task-calendar-sync.ts';
export const HOME_ROWS = 5;
export const HOME_DAYS = 7;
export type WorkspaceHome = { asOf: string; until: string; workspaces: WorkspaceHomeContext[] };
export type WorkspaceHomeContext = { workspace: OwnedWorkspace; openTaskCount: number; tasks: { id: string; title: string }[]; upcomingBlockCount: number; blocks: { id: string; title: string; start: string; end: string }[] };
const exact = (value: unknown, keys: string) => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys;
const text = (value: unknown) => typeof value === 'string' && !!value.trim() && value.length <= 500;
const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 1000;
/** Projection allowlist: never accept notes, source Mail, grants or unqualified items. */
export function validateWorkspaceHome(value: unknown, owner: string): WorkspaceHome {
  if (!exact(value, 'asOf,until,workspaces')) workspaceFail();
  const home = value as WorkspaceHome;
  if (!taskCalendarDate(home.asOf) || !taskCalendarDate(home.until) || Date.parse(home.until) - Date.parse(home.asOf) !== HOME_DAYS * 86400000 || !Array.isArray(home.workspaces) || home.workspaces.length > 51) workspaceFail();
  const ids = new Set<string>();
  for (const context of home.workspaces) {
    if (!exact(context, 'blocks,openTaskCount,tasks,upcomingBlockCount,workspace')) workspaceFail();
    const workspace = validateWorkspace(context.workspace);
    if (workspace.ownerUserId !== owner || ids.has(workspace.workspaceId)) workspaceFail('forbidden'); ids.add(workspace.workspaceId);
    if (!count(context.openTaskCount) || !count(context.upcomingBlockCount) || !Array.isArray(context.tasks) || !Array.isArray(context.blocks) || context.tasks.length !== Math.min(context.openTaskCount, HOME_ROWS) || context.blocks.length !== Math.min(context.upcomingBlockCount, HOME_ROWS)) workspaceFail();
    const taskIds = new Set<string>(), blockIds = new Set<string>();
    for (const task of context.tasks) { if (!exact(task, 'id,title') || !text(task.id) || !text(task.title) || taskIds.has(task.id)) workspaceFail(); taskIds.add(task.id); }
    for (const block of context.blocks) { if (!exact(block, 'end,id,start,title') || !text(block.id) || !text(block.title) || !taskCalendarDate(block.start) || !taskCalendarDate(block.end) || block.start >= block.end || block.end <= home.asOf || block.start >= home.until || blockIds.has(block.id)) workspaceFail(); blockIds.add(block.id); }
  }
  return home;
}
