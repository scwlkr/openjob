import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectedAgents, NativeConnectedWorkspaceController, OwnedWorkspace } from '../connected-workspaces-contracts';
import type { WorkspaceAgentAction, WorkspaceAgentOperation } from '../../../shared/owned-workspace-agents';
import type { WorkspaceItemTarget } from '../../../shared/workspace-navigation';
import { Action, Block, Confirm, Copy } from '../personal-workspace/controls';

const labels: Record<WorkspaceAgentOperation, string> = {
  'task.create': 'Task created', 'task.update': 'Task title changed', 'task.notes': 'Task notes updated',
  'task.complete': 'Task completion changed', 'task.delete': 'Task deleted', 'task.unschedule': 'Task unplanned',
  'task.schedule': 'Task planned', 'calendar.create': 'Calendar block created',
  'calendar.update': 'Calendar block changed', 'calendar.delete': 'Calendar block deleted',
};
type Props = { controller: Pick<NativeConnectedWorkspaceController, 'agentGrants' | 'revokeAgent'>; owner: string; workspace: OwnedWorkspace; onAccessEnded(error: unknown): void; onOpenItem(item: WorkspaceItemTarget): Promise<void> };

/** Disposable access observation. Credentials and authored Workspace work never enter this view. */
export function WorkspaceAgents({ controller, owner, workspace, onAccessEnded, onOpenItem }: Props) {
  const [data, setData] = useState<ConnectedAgents>(), [checkedAt, setCheckedAt] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState(''), [limit, setLimit] = useState(20), [details, setDetails] = useState(false);
  const lease = useRef({ active: false, pending: false, generation: {} });
  const current = useCallback((operation: object) => lease.current.active && lease.current.generation === operation, []);
  const begin = useCallback(() => {
    if (!lease.current.active || lease.current.pending) return;
    const operation = {}; lease.current.generation = operation; lease.current.pending = true;
    setBusy(true); setError(''); setNotice(''); setConfirm(''); setData(undefined);
    return operation;
  }, []);
  const finish = useCallback((operation: object) => { if (current(operation)) { lease.current.pending = false; setBusy(false); } }, [current]);
  const refresh = useCallback(async () => {
    const operation = begin(); if (!operation) return;
    try {
      const value = await controller.agentGrants(owner, workspace);
      if (current(operation)) { setData(value); setCheckedAt(Date.now()); setLimit(20); setNotice('Agent access refreshed.'); }
    } catch (failure) {
      if (current(operation)) { setError('Agent access unavailable. Refresh before relying on this view. Independent Workspaces support these grants; retained Personal uses Personal → Agents.'); onAccessEnded(failure); }
    } finally { finish(operation); }
  }, [begin, controller, owner, workspace, current, finish, onAccessEnded]);
  useEffect(() => {
    const state = lease.current; state.active = true;
    queueMicrotask(() => { if (state.active) void refresh(); });
    return () => { state.active = false; state.pending = false; state.generation = {}; };
  }, [refresh]);
  const revoke = useCallback(async (id: string, name: string) => {
    const operation = begin(); if (!operation) return;
    try {
      const result = await controller.revokeAgent(owner, workspace.workspaceId, id);
      if (!current(operation)) return;
      if (result.id !== id || result.revoked !== true || Object.keys(result).sort().join(',') !== 'id,revoked') throw new Error('Unconfirmed revocation.');
      const value = await controller.agentGrants(owner, workspace);
      if (!current(operation)) return;
      if (value.agents.find(grant => grant.id === id)?.revoked !== true) throw new Error('Revocation not observed.');
      setData(value); setCheckedAt(Date.now()); setNotice(`Access revoked for ${name}. Other Workspace grants are unchanged.`);
    } catch (failure) {
      if (current(operation)) { setError('Revocation could not be confirmed. Refresh access before retrying; no automatic retry was made.'); onAccessEnded(failure); }
    } finally { finish(operation); }
  }, [begin, controller, owner, workspace, current, onAccessEnded, finish]);
  async function open(action: WorkspaceAgentAction) {
    if (!lease.current.active || lease.current.pending) return;
    const operation = {}; lease.current.generation = operation; lease.current.pending = true; setBusy(true); setConfirm('');
    try { await onOpenItem({ kind: action.operation.startsWith('task.') ? 'task' : 'block', id: action.itemId }); }
    catch (failure) { if (current(operation)) { setError('This item could not be opened. Refresh Workspace work before trying again.'); onAccessEnded(failure); } }
    finally { finish(operation); }
  }
  return <Block><Copy heading>Workspace agent access</Copy>
    <Copy>External agents use only their reviewed Tasks and OpenJob Calendar permissions. Access expires after 24 hours. Credentials cannot read Mail or administer access.</Copy>
    <Action label="Refresh Workspace agent access" disabled={busy} onPress={() => void refresh()} />
    {checkedAt > 0 && <Copy>Last checked: {new Date(checkedAt).toLocaleString()}. {data ? 'Refresh to check current access.' : 'Access details are hidden.'}</Copy>}
    <Action label={details ? 'Hide CLI access details' : 'Show CLI access details'} onPress={() => setDetails(value => !value)} />
    {details && <Copy>Issue a credential with the existing CLI after reviewing its scopes and exact resources. This screen never shows credentials.{'\n'}Workspace: {workspace.workspaceId}{'\n'}Tasks: {workspace.taskSpaceId}{'\n'}Calendar: {workspace.calendarId}{'\n'}Retained Personal keeps its existing Personal → Agents path.</Copy>}
    {busy && <Copy>Checking agent access…</Copy>}{error ? <Copy>{error}</Copy> : notice ? <Copy>{notice}</Copy> : !data && <Copy>Loading agent access…</Copy>}
    {data?.agents.length === 0 && <Copy>No agents have access to this Workspace.</Copy>}
    {data?.agents.map(grant => <Block key={grant.id}><Copy heading>{grant.name}</Copy>
      <Copy>{grant.revoked ? 'Revoked' : Date.parse(grant.expiresAt) <= checkedAt ? 'Expired' : 'Active at last check'} · Expires {new Date(grant.expiresAt).toLocaleString()}{'\n'}Agent: {grant.id}{'\n'}Issued: {new Date(grant.createdAt).toLocaleString()}</Copy>
      <Copy>Reviewed scopes: {grant.scopes.join(', ')}{'\n'}Resources: {grant.resourceIds.join(', ')}{grant.revoked || Date.parse(grant.expiresAt) <= checkedAt ? '\nEffective access: None' : ''}</Copy>
      <Action label={`Revoke Workspace agent ${grant.name}`} disabled={busy || grant.revoked} onPress={() => setConfirm(grant.id)} />
      {confirm === grant.id && <Confirm message={`Revoke future access for ${grant.name} in this Workspace? Saved Tasks, Calendar blocks and other Workspace grants remain.`} label="Confirm revoke Workspace agent" busy={busy} onCancel={() => setConfirm('')} onConfirm={() => void revoke(grant.id, grant.name)} />}
    </Block>)}
    {data && <Block><Copy heading>Recent confirmed agent actions</Copy><Copy>Up to 200 confirmed changes. Item links check this Workspace’s current saved work.</Copy>
      {!data.actions.length && <Copy>No recorded agent changes.</Copy>}
      {[...data.actions].reverse().slice(0, limit).map((action, index) => <Block key={`${action.at}-${index}`}>
        {action.operation.endsWith('.delete') ? <Copy>{labels[action.operation]}</Copy> : <Action label={`Open item: ${labels[action.operation]}`} disabled={busy} onPress={() => void open(action)} />}
        <Copy>{data.agents.find(grant => grant.id === action.agentId)?.name ?? action.agentId} · {new Date(action.at).toLocaleString()}</Copy>
      </Block>)}
      {data.actions.length > limit && <Action label="Show more Workspace agent actions" disabled={busy} onPress={() => setLimit(value => value + 20)} />}
    </Block>}
  </Block>;
}
