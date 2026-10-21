import { WORKSPACE_ID } from './owned-workspaces.ts';
export type WorkspaceItemTarget = { kind: 'task' | 'block'; id: string };
export type WorkspaceDestination = { workspaceId: string; item?: WorkspaceItemTarget };
export function parseWorkspaceFragment(hash: string): WorkspaceDestination | null {
  if (!hash || hash === '#' || hash === '#home') return { workspaceId: '' };
  const parts = hash.slice(1).split('/');
  const workspaceId = parts[0], kind = parts[1], encodedId = parts[2];
  if (!workspaceId || !WORKSPACE_ID.test(workspaceId) || ![1, 3].includes(parts.length)) return null;
  if (parts.length === 1) return { workspaceId };
  if (kind !== 'task' && kind !== 'block' || encodedId === undefined) return null;
  let id: string; try { id = decodeURIComponent(encodedId); } catch { return null; }
  if (!id.trim() || id.length > 500 || /[\u0000-\u001f\u007f]/.test(id)) return null;
  return { workspaceId, item: { kind, id } };
}
export function workspaceFragment(destination: WorkspaceDestination) {
  if (!destination.workspaceId) return '#home';
  return `#${destination.workspaceId}${destination.item ? `/${destination.item.kind}/${encodeURIComponent(destination.item.id)}` : ''}`;
}
