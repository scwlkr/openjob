import type { WorkspaceView } from '../../shared/workspace-contracts';
import type { PersonalWorkspaceCommand, PersonalAgentGrant } from '../../shared/personal-workspace-contracts';
import type { NativeOfflineWorkspaceController, TaskCalendarSyncSnapshot, TaskCalendarSyncInput, TaskCalendarSyncAck } from './offline-workspace-contracts';
import type { NativeConnectedWorkspaceController } from './connected-workspaces-contracts';

export type { WorkspaceView, PersonalWorkspaceCommand, PersonalAgentGrant };
/** No credentials or persistent cache are exposed to presentation code. */
export type NativePersonalWorkspaceController = {
  connected?: NativeConnectedWorkspaceController;
  offline?: NativeOfflineWorkspaceController;
  readPersonalWorkspace(expectedOwnerUserId: string): Promise<WorkspaceView>;
  commandPersonalWorkspace(expectedOwnerUserId: string, input: PersonalWorkspaceCommand): Promise<void>;
  listPersonalAgents(expectedOwnerUserId: string): Promise<PersonalAgentGrant[]>;
  revokePersonalAgent(expectedOwnerUserId: string, id: string): Promise<void>;
};
export type NativePersonalWorkspaceApi = {
  readTaskCalendarSync?(token: string, ownerUserId: string): Promise<TaskCalendarSyncSnapshot>;
  syncTaskCalendar?(token: string, ownerUserId: string, input: TaskCalendarSyncInput): Promise<TaskCalendarSyncAck>;
  readPersonalWorkspace(token: string, ownerUserId: string): Promise<WorkspaceView>;
  commandPersonalWorkspace(token: string, input: PersonalWorkspaceCommand): Promise<void>;
  listPersonalAgents(token: string, ownerUserId: string): Promise<PersonalAgentGrant[]>;
  revokePersonalAgent(token: string, id: string): Promise<void>;
};
