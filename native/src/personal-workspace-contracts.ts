import type { WorkspaceView } from '../../shared/workspace-contracts';
import type { PersonalWorkspaceCommand, PersonalAgentGrant } from '../../shared/personal-workspace-contracts';

export type { WorkspaceView, PersonalWorkspaceCommand, PersonalAgentGrant };
/** No credentials or persistent cache are exposed to presentation code. */
export type NativePersonalWorkspaceController = {
  readPersonalWorkspace(expectedOwnerUserId: string): Promise<WorkspaceView>;
  commandPersonalWorkspace(expectedOwnerUserId: string, input: PersonalWorkspaceCommand): Promise<void>;
  listPersonalAgents(expectedOwnerUserId: string): Promise<PersonalAgentGrant[]>;
  revokePersonalAgent(expectedOwnerUserId: string, id: string): Promise<void>;
};
export type NativePersonalWorkspaceApi = {
  readPersonalWorkspace(token: string, ownerUserId: string): Promise<WorkspaceView>;
  commandPersonalWorkspace(token: string, input: PersonalWorkspaceCommand): Promise<void>;
  listPersonalAgents(token: string, ownerUserId: string): Promise<PersonalAgentGrant[]>;
  revokePersonalAgent(token: string, id: string): Promise<void>;
};
