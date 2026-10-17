import { WORKSPACE_ID } from './owned-workspaces.ts';
export type WorkspaceItemTarget = { kind: 'task' | 'block'; id: string };
export type WorkspaceDestination = { workspaceId: string; item?: WorkspaceItemTarget };
export function parseWorkspaceFragment(hash: string): WorkspaceDestination | null {
  if (!hash || hash === '#' || hash === '#home') return { workspaceId: '' };
  const parts = hash.slice(1).split('/');
  if (!WORKSPACE_ID.test(parts[0]) || ![1, 3].includes(parts.length)) return null;
  if (parts.length === 1) return { workspaceId: parts[0] };
  let id: string; try { id = decodeURIComponent(parts[2]); } catch { return null; }
  if (!['task', 'block'].includes(parts[1]) || !id.trim() || id.length > 500 || /[\u0000-\u001f\u007f]/.test(id)) return null;
  return { workspaceId: parts[0], item: { kind: parts[1] as WorkspaceItemTarget['kind'], id } };
}
export function workspaceFragment(destination: WorkspaceDestination) {
  if (!destination.workspaceId) return '#home';
  return `#${destination.workspaceId}${destination.item ? `/${destination.item.kind}/${encodeURIComponent(destination.item.id)}` : ''}`;
}
