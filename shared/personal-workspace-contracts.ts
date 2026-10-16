import type { WorkspaceCommand, WorkspaceScope } from './workspace-contracts';

export type PersonalWorkspaceCommand = WorkspaceCommand | { type: 'mail.examples.add' };
export type PersonalAgentScope = WorkspaceScope;
export type PersonalAgentResource = 'tasks:personal' | 'calendar:personal' | 'mail:example-gmail-personal' | 'mail:example-gmail-work' | 'mail:example-outlook';
export type PersonalAgentInput = { name: string; scopes: PersonalAgentScope[]; resourceIds: PersonalAgentResource[] };
export type PersonalAgentGrant = PersonalAgentInput & { id: string; ownerUserId: string; createdAt: string; expiresAt: string; revoked: boolean };
