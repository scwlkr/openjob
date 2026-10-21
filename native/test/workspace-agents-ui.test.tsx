import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { WorkspaceAgents } from '../src/connected-workspaces/WorkspaceAgents';
import { OpenJobThemeProvider } from '../src/theme';
import type { ConnectedAgents, NativeConnectedWorkspaceController, OwnedWorkspace } from '../src/connected-workspaces-contracts';
import type { WorkspaceAgentGrant } from '../../shared/owned-workspace-agents';

const owner = `user_${'a'.repeat(32)}`, id = `wsp_${'b'.repeat(32)}`, agentId = `agt_${'c'.repeat(32)}`;
const workspace: OwnedWorkspace = { workspaceId: id, ownerUserId: owner, taskSpaceId: `tsp_${'b'.repeat(32)}`, calendarId: `cal_${'b'.repeat(32)}`, name: 'Work', createdAt: '2026-10-20T00:00:00.000Z' };
const taskId = 'offline_00000000-0000-4000-8000-000000000001', eventId = 'offline_00000000-0000-4000-8000-000000000002';
function fixture() {
  const createdAt = new Date(Date.now() - 1000).toISOString(), expiresAt = new Date(Date.parse(createdAt) + 86400000).toISOString();
  const grant: WorkspaceAgentGrant = { id: agentId, workspaceId: id, ownerUserId: owner, name: 'Planning helper', scopes: ['tasks:read', 'tasks:write', 'calendar:read', 'calendar:write'], resourceIds: [workspace.taskSpaceId, workspace.calendarId], revoked: false, createdAt, expiresAt };
  const data: ConnectedAgents = { agents: [grant], actions: [{ agentId, operation: 'task.create', itemId: taskId, at: createdAt }, { agentId, operation: 'calendar.update', itemId: eventId, at: createdAt }, { agentId, operation: 'task.delete', itemId: taskId, at: createdAt }] };
  const controller: Pick<NativeConnectedWorkspaceController, 'agentGrants' | 'revokeAgent'> = {
    agentGrants: jest.fn(async () => structuredClone(data)),
    revokeAgent: jest.fn(async (_owner, _id, target) => { grant.revoked = true; return { id: target, revoked: true as const }; }),
  };
  const onOpenItem = jest.fn(async () => undefined), onAccessEnded = jest.fn();
  const view = (target = workspace) => <OpenJobThemeProvider preference="light" setPreference={() => undefined}><WorkspaceAgents key={`${target.ownerUserId}:${target.workspaceId}`} controller={controller} owner={target.ownerUserId} workspace={target} onOpenItem={onOpenItem} onAccessEnded={onAccessEnded} /></OpenJobThemeProvider>;
  return { data, grant, controller, onOpenItem, onAccessEnded, view };
}
async function press(name: string) { await fireEvent.press(await screen.findByRole('button', { name })); }

test('owner reviews exact scopes/resources and confirmed actions; revoke requires confirmation and fresh acknowledgement', async () => {
  const f = fixture(); await render(f.view()); await screen.findByRole('header', { name: 'Planning helper' });
  expect(screen.getByText(/Last checked:/)).toBeTruthy(); expect(screen.getByText(/Reviewed scopes: tasks:read, tasks:write, calendar:read, calendar:write/)).toHaveTextContent(new RegExp(workspace.taskSpaceId));
  await press('Open item: Task created'); expect(f.onOpenItem).toHaveBeenLastCalledWith({ kind: 'task', id: taskId });
  await press('Open item: Calendar block changed'); expect(f.onOpenItem).toHaveBeenLastCalledWith({ kind: 'block', id: eventId });
  expect(screen.queryByRole('button', { name: 'Open item: Task deleted' })).toBeNull();
  await press('Revoke Workspace agent Planning helper'); expect(f.controller.revokeAgent).not.toHaveBeenCalled();
  await press('Cancel confirmation'); expect(f.controller.revokeAgent).not.toHaveBeenCalled();
  await press('Revoke Workspace agent Planning helper'); await press('Confirm revoke Workspace agent');
  await screen.findByText('Access revoked for Planning helper. Other Workspace grants are unchanged.');
  expect(f.controller.revokeAgent).toHaveBeenCalledTimes(1); expect(f.controller.revokeAgent).toHaveBeenCalledWith(owner, id, agentId);
  expect(screen.getByText(/Effective access: None/)).toBeTruthy(); expect(screen.getByRole('button', { name: 'Revoke Workspace agent Planning helper' })).toBeDisabled();
});
test('lost revoke response hides stale access/actions, makes no automatic retry, and manual refresh recovers the saved revocation', async () => {
  const f = fixture(); jest.spyOn(f.controller, 'revokeAgent').mockImplementationOnce(async () => { f.grant.revoked = true; throw new Error('Response lost'); });
  await render(f.view()); await screen.findByRole('header', { name: 'Planning helper' });
  await press('Revoke Workspace agent Planning helper'); await press('Confirm revoke Workspace agent'); await screen.findByText(/Revocation could not be confirmed/);
  expect(screen.queryByRole('header', { name: 'Planning helper' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Open item: Task created' })).toBeNull();
  expect(f.controller.revokeAgent).toHaveBeenCalledTimes(1); expect(f.controller.agentGrants).toHaveBeenCalledTimes(1);
  await press('Refresh Workspace agent access'); await screen.findByText(/Revoked · Expires/);
  expect(f.controller.revokeAgent).toHaveBeenCalledTimes(1); expect(f.controller.agentGrants).toHaveBeenCalledTimes(2);
});
test('acknowledgement without observed revocation stays unconfirmed, and retained Personal never substitutes grants', async () => {
  const f = fixture(); jest.spyOn(f.controller, 'revokeAgent').mockResolvedValueOnce({ id: agentId, revoked: true });
  await render(f.view()); await screen.findByRole('header', { name: 'Planning helper' });
  await press('Revoke Workspace agent Planning helper'); await press('Confirm revoke Workspace agent'); await screen.findByText(/Revocation could not be confirmed/);
  expect(screen.queryByRole('header', { name: 'Planning helper' })).toBeNull();
  jest.spyOn(f.controller, 'agentGrants').mockRejectedValueOnce(Object.assign(new Error(), { status: 403, code: 'forbidden' }));
  await press('Refresh Workspace agent access'); await screen.findByText(/retained Personal uses Personal → Agents/);
  expect(screen.queryByText('No agents have access to this Workspace.')).toBeNull();
});
test('late access response cannot populate a changed Workspace or owner session', async () => {
  const f = fixture(); let release!: (data: ConnectedAgents) => void;
  jest.spyOn(f.controller, 'agentGrants').mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue({ agents: [], actions: [] });
  const root = await render(f.view()); await waitFor(() => expect(f.controller.agentGrants).toHaveBeenCalledTimes(1));
  const other = { ...workspace, workspaceId: `wsp_${'d'.repeat(32)}`, ownerUserId: `user_${'e'.repeat(32)}`, name: 'Other' };
  await root.rerender(f.view(other)); await screen.findByText('No agents have access to this Workspace.');
  await act(async () => release(f.data)); expect(screen.queryByRole('header', { name: 'Planning helper' })).toBeNull(); expect(f.onAccessEnded).not.toHaveBeenCalled();
});
test('a revoke acknowledgement after context change cannot fetch or display the old access list', async () => {
  const f = fixture(); let release!: (value: { id: string; revoked: true }) => void;
  jest.spyOn(f.controller, 'revokeAgent').mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const root = await render(f.view()); await screen.findByRole('header', { name: 'Planning helper' });
  await press('Revoke Workspace agent Planning helper'); await press('Confirm revoke Workspace agent');
  jest.spyOn(f.controller, 'agentGrants').mockResolvedValue({ agents: [], actions: [] });
  const other = { ...workspace, workspaceId: `wsp_${'d'.repeat(32)}`, name: 'Other' };
  await root.rerender(f.view(other)); await screen.findByText('No agents have access to this Workspace.');
  const reads = jest.mocked(f.controller.agentGrants).mock.calls.length;
  await act(async () => release({ id: agentId, revoked: true })); expect(f.controller.agentGrants).toHaveBeenCalledTimes(reads);
  expect(screen.queryByText(/Access revoked for Planning helper/)).toBeNull(); expect(f.onAccessEnded).not.toHaveBeenCalled();
});
