"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { parseWorkspaceAgentActions, validateWorkspaceAgent, type WorkspaceAgentGrant, type WorkspaceAgentAction } from '../../shared/owned-workspace-agents';
import type { OwnedWorkspace } from '../../shared/owned-workspaces';
import type { WorkspaceItemTarget } from '../../shared/workspace-navigation';
import styles from '../workspace/workspace.module.css';
import agentStyles from './workspace-agents.module.css';
type Request = (path?: string, input?: unknown, method?: 'DELETE') => Promise<unknown>;
const ACTION_LABELS = { 'task.create': 'Task created', 'task.update': 'Task title changed', 'task.notes': 'Task notes updated', 'task.complete': 'Task completion changed', 'task.delete': 'Task deleted', 'task.unschedule': 'Task unplanned', 'task.schedule': 'Task planned', 'calendar.create': 'Calendar block created', 'calendar.update': 'Calendar block changed', 'calendar.delete': 'Calendar block deleted' };
export default function WorkspaceAgents({ workspace, request, onOpenItem }: { workspace: OwnedWorkspace; request: Request; onOpenItem: (item: WorkspaceItemTarget) => void }) {
  const [grants, setGrants] = useState<WorkspaceAgentGrant[]>(); const [actions, setActions] = useState<WorkspaceAgentAction[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const mounted = useRef(true), pending = useRef(false), generation = useRef(0);
  const path = `/${workspace.workspaceId}/agent-grants`;
  const read = useCallback(async () => {
    const current = ++generation.current;
    let raw: unknown;
    try { raw = await request(path); } catch (error) { if (!mounted.current || current !== generation.current) return; throw error; }
    if (!mounted.current || current !== generation.current) return;
    const value = raw as { agents?: unknown; actions?: unknown };
    if (!value || Object.keys(value).sort().join(',') !== 'actions,agents' || !Array.isArray(value.agents) || !Array.isArray(value.actions) || value.agents.length > 100) throw new Error();
    const next = value.agents.map(row => validateWorkspaceAgent(workspace, row));
    if (new Set(next.map(row => row.id)).size !== next.length) throw new Error();
    const recent = parseWorkspaceAgentActions(JSON.stringify(value.actions));
    if (mounted.current) { setGrants(next); setActions(recent); }
  }, [request, path, workspace]);
  useEffect(() => {
    mounted.current = true;
    void read().catch(() => { if (mounted.current) setError('Agent access could not be loaded. Independent Workspaces support these grants; retained Personal uses its existing Agents view.'); });
    return () => { mounted.current = false; };
  }, [read]);
  async function refresh() {
    if (pending.current) return; pending.current = true; setBusy(true); setError(''); setNotice('');
    try { await read(); if (mounted.current) setNotice('Agent access refreshed.'); }
    catch { if (mounted.current) { setGrants(undefined); setActions([]); setError('Agent access unavailable. Refresh before relying on this view.'); } }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  async function revoke(grant: WorkspaceAgentGrant) {
    if (pending.current) return; pending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const result = await request(`${path}/${grant.id}`, undefined, 'DELETE') as { id?: unknown; revoked?: unknown };
      if (result?.id !== grant.id || result.revoked !== true || Object.keys(result).sort().join(',') !== 'id,revoked') throw new Error();
      await read(); if (mounted.current) setNotice(`Access revoked for ${grant.name}. Other Workspace grants are unchanged.`);
    } catch { if (mounted.current) { setGrants(undefined); setActions([]); setError('Revocation could not be confirmed. Refresh access before retrying; no automatic retry was made.'); } }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  return <section className={agentStyles.access} aria-label="Workspace agent access"><h2>Agents</h2>
    <p>External agents act only within their reviewed Tasks and Calendar permissions. Access expires after 24 hours and can be revoked here. Mail and access administration are unavailable to these credentials.</p>
    <button disabled={busy} onClick={refresh}>Refresh agent access</button>
    <details className={agentStyles.guide}><summary>Issue a credential with the CLI</summary><p>Choose this Workspace and its exact resources. The CLI saves the credential once to a new private file; it is never shown here.</p>
      <p>Workspace: <code>{workspace.workspaceId}</code><br />Tasks: <code>{workspace.taskSpaceId}</code><br />Calendar: <code>{workspace.calendarId}</code></p>
      <pre className={agentStyles.command}>{`openjob workspace agent grant --workspace ${workspace.workspaceId} --name "My agent" --scopes tasks:read --resources ${workspace.taskSpaceId} --token-out ./agent.token`}</pre>
      <p>Supported scopes: tasks:read, tasks:write, calendar:read, calendar:write. Linked planning changes need write access to both resources. Retained Personal keeps its existing grant path.</p>
    </details>
    {error && <p role="alert" className={styles.error}>{error}</p>}{notice && <p role="status" className={styles.success}>{notice}</p>}
    {!grants && !error && <p role="status">Loading agent access…</p>}
    {grants?.length === 0 && <p className={styles.empty}>No agents have access to this Workspace.</p>}
    {grants?.map(grant => <article key={grant.id} className={`${styles.panel} ${styles.agent} ${agentStyles.grant}`} data-testid="workspace-agent-row"><h3>{grant.name}</h3>
      <p>{grant.revoked ? 'Revoked' : `Expires ${new Date(grant.expiresAt).toLocaleString()}`}</p><small>{grant.id}</small>
      <p>Scopes: {grant.scopes.join(', ')}<br />Resources: {grant.resourceIds.join(', ')}</p><small>Issued {new Date(grant.createdAt).toLocaleString()}</small>
      <button disabled={busy || grant.revoked} onClick={() => revoke(grant)}>Revoke access</button>
    </article>)}
    {grants && <><h3>Recent confirmed agent actions</h3>{actions.length === 0 ? <p>No recorded agent changes.</p> : <ul className={agentStyles.actions}>{[...actions].reverse().map((action, index) => <li key={`${action.at}-${index}`}>{action.operation.endsWith('.delete') ? <span>{ACTION_LABELS[action.operation]}</span> : <button onClick={() => onOpenItem({ kind: action.operation.startsWith('task.') ? 'task' : 'block', id: action.itemId })}>{ACTION_LABELS[action.operation]}</button>}<br /><small>{grants.find(grant => grant.id === action.agentId)?.name ?? action.agentId} · {new Date(action.at).toLocaleString()}</small></li>)}</ul>}</>}
  </section>;
}
