/** Adapter preview contracts describe synthetic implementation capabilities, not live provider support. */
export type ProviderKind = "gmail" | "outlook" | "imap";
export type ProviderStatus = "ready" | "reconnect_required" | "error" | "unsupported";
export type ProviderCapability = { available: boolean; reason: string };
export type ProviderAccount = {
  id: string; upstreamId: string; provider: ProviderKind; label: string; address: string; mode: "synthetic";
  status: ProviderStatus; statusReason: string;
  capabilities: { mailRead: ProviderCapability; calendarRead: ProviderCapability; draft: ProviderCapability; send: ProviderCapability; calendarWrite: ProviderCapability; reconnect: ProviderCapability };
  sync: { state: "synthetic_ready" | "blocked"; asOf: string; reason: string };
};
export type ProviderMessage = { id: string; accountId: string; upstreamId: string; upstreamThreadId: string; threadId: string; folderIds: string[]; subject: string; from: string; to: string; body: string; receivedAt: string; read: boolean };
export type ProviderFolder = { id: string; accountId: string; upstreamId: string; name: string };
export type ProviderCalendar = { id: string; accountId: string; upstreamId: string; name: string; color: string };
export type ProviderEvent = { id: string; accountId: string; upstreamId: string; calendarId: string; title: string; start: string; end: string };
export type ProviderMessagePage = { messages: ProviderMessage[]; folders: ProviderFolder[]; calendars: ProviderCalendar[]; events: ProviderEvent[]; nextCursor: string | null; syncCursor: string };
export type ProviderPreview = ProviderMessagePage & { mode: "synthetic"; accounts: ProviderAccount[]; selectedAccountId: string };
export type ProviderChange = { kind: "message"; value: ProviderMessage } | { kind: "event"; value: ProviderEvent };
export type ProviderTombstone = { kind: "message" | "event"; id: string; accountId: string };
export type ProviderChanges = { mode: "synthetic"; accountId: string; changes: ProviderChange[]; tombstones: ProviderTombstone[]; syncCursor: string };
export type ProviderReadAdapter = {
  listAccounts(ownerId: string): Promise<ProviderAccount[]>;
  listMessages(input: { ownerId: string; accountId: string; cursor?: string }): Promise<ProviderMessagePage>;
  readChanges(input: { ownerId: string; accountId: string; syncCursor: string }): Promise<ProviderChanges>;
};
