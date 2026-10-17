import { validateOwnedSnapshot, validateWorkspace, workspaceFail } from '../shared/owned-workspaces.ts';
import { HOME_DAYS, HOME_ROWS, validateWorkspaceHome, type WorkspaceHomeContext } from '../shared/workspace-home.ts';
import type { createWorkspaceContextStore } from './workspace-context-store.ts';
type Store = Pick<ReturnType<typeof createWorkspaceContextStore>, 'list' | 'snapshot'>;
/** Derived read only; each context uses its existing current-owner repository boundary. */
export async function readWorkspaceHome(owner: string, store: Store, now = new Date()) {
  const asOf = now.toISOString(), until = new Date(now.getTime() + HOME_DAYS * 86400000).toISOString();
  const catalog = await store.list(owner);
  if (catalog.length > 51 || new Set(catalog.map(item => item.workspaceId)).size !== catalog.length) workspaceFail('invalid_state');
  for (const item of catalog) if (validateWorkspace(item).ownerUserId !== owner) workspaceFail('forbidden');
  const workspaces: WorkspaceHomeContext[] = [];
  // At most four independent snapshot reads; a failed context fails the entire response.
  for (let offset = 0; offset < catalog.length; offset += 4) {
    workspaces.push(...await Promise.all(catalog.slice(offset, offset + 4).map(async item => {
      const snapshot = validateOwnedSnapshot(await store.snapshot(owner, item.workspaceId));
      if (snapshot.workspace.workspaceId !== item.workspaceId || snapshot.workspace.ownerUserId !== owner) workspaceFail('forbidden');
      const tasks = snapshot.work.tasks.filter(task => !task.completed);
      const blocks = snapshot.work.events.filter(block => block.end > asOf && block.start < until).sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
      return { workspace: snapshot.workspace, openTaskCount: tasks.length, tasks: tasks.slice(0, HOME_ROWS).map(({ id, title }) => ({ id, title })), upcomingBlockCount: blocks.length, blocks: blocks.slice(0, HOME_ROWS).map(({ id, title, start, end }) => ({ id, title, start, end })) };
    })));
  }
  return validateWorkspaceHome({ asOf, until, workspaces }, owner);
}
