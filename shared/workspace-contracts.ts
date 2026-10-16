/** Prototype contracts. All provider data is isolated fixture data; no live credentials or provider sending. */
export type WorkspaceScope = "mail:read" | "mail:draft" | "mail:simulate-send" | "tasks:read" | "tasks:write" | "calendar:read" | "calendar:write";
export type WorkspaceActor = { kind: "human"; ownerId: string } | { kind: "agent"; ownerId: string; agentId: string };
export type WorkspaceAccount = { id: string; ownerId: string; provider: "gmail" | "outlook" | "imap"; label: string; address: string; mode: "fixture" };
export type WorkspaceMessage = { id: string; accountId: string; subject: string; from: string; to: string; body: string; receivedAt: string; read: boolean };
export type WorkspaceTask = { id: string; ownerId: string; title: string; completed: boolean; sourceMessageId?: string; sourceAccountId?: string; scheduledSlot?: { start: string; end: string }; calendarEventId?: string };
export type WorkspaceCalendar = { id: string; ownerId: string; accountId?: string; name: string; color: string };
export type WorkspaceEvent = { id: string; calendarId: string; title: string; start: string; end: string; taskId?: string };
export type WorkspaceDraft = { id: string; accountId: string; messageId?: string; to?: string; subject?: string; body: string; status: "draft" };
export type WorkspaceSent = { id: string; accountId: string; messageId?: string; from: string; to: string; subject: string; body: string; sentAt: string; mode: "fixture" };
export type WorkspaceAgent = { id: string; ownerId: string; name: string; scopes: WorkspaceScope[]; resourceIds: string[]; revoked: boolean; createdAt: string };
export type WorkspaceActivity = { id: string; ownerId: string; actor: string; action: string; createdAt: string };
export type WorkspaceState = { accounts: WorkspaceAccount[]; messages: WorkspaceMessage[]; tasks: WorkspaceTask[]; calendars: WorkspaceCalendar[]; events: WorkspaceEvent[]; drafts: WorkspaceDraft[]; sent: WorkspaceSent[]; agents: WorkspaceAgent[]; activity: WorkspaceActivity[] };
export type WorkspaceView = WorkspaceState;
export type WorkspaceCommand =
  | { type: "task.create"; title: string; messageId?: string }
  | { type: "task.complete"; taskId: string; completed: boolean }
  | { type: "task.schedule"; taskId: string; calendarId: string; start: string; end: string }
  | { type: "calendar.create"; calendarId: string; title: string; start: string; end: string }
  | { type: "calendar.update"; eventId: string; title: string; start: string; end: string }
  | { type: "calendar.delete"; eventId: string }
  | { type: "mail.read"; messageId: string; read: boolean }
  | { type: "mail.draft"; messageId: string; body: string }
  | { type: "mail.compose"; accountId: string; to: string; subject: string; body: string }
  | { type: "mail.draft.update"; draftId: string; to: string; subject: string; body: string }
  | { type: "mail.simulate-send"; draftId: string }
  | { type: "mail.send"; draftId: string }
  | { type: "agent.grant"; name: string; scopes: WorkspaceScope[]; resourceIds: string[] }
  | { type: "agent.revoke"; agentId: string };
export type WorkspaceEngine = { snapshot(actor: WorkspaceActor): WorkspaceView; command(actor: WorkspaceActor, input: unknown): unknown; exportState(): WorkspaceState };
