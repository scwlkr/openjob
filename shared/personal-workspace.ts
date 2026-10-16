import type { TaskCalendarSyncSnapshot, TaskCalendarSyncAck } from "./task-calendar-sync.ts";
import { PERSONAL_MAIL_ACCOUNTS, PERSONAL_MAIL_MESSAGES, addPersonalMailExamples } from "./personal-mail-examples.ts";
import type { WorkspaceCommand, WorkspaceState, WorkspaceView } from "./workspace-contracts.ts";
import type { PersonalAgentGrant, PersonalAgentInput } from "./personal-agent-grants.ts";
import { createWorkspaceEngine } from "./workspace-engine.ts";

import type { PersonalWorkspaceCommand } from "./personal-workspace-contracts.ts";
export type { PersonalWorkspaceCommand } from "./personal-workspace-contracts.ts";
export type { PersonalMailExamplesResult } from "./personal-mail-examples.ts";

export type PersonalWorkspaceStore = {
  snapshot(ownerUserId: string): Promise<WorkspaceView>;
  readTaskCalendarSync?(ownerUserId: string): Promise<TaskCalendarSyncSnapshot>;
  syncTaskCalendar?(ownerUserId: string, input: unknown): Promise<TaskCalendarSyncAck>;
  command(ownerUserId: string, input: unknown): Promise<unknown>;
  removeAllForUser(ownerUserId: string): Promise<number>;
  createAgent(ownerUserId: string, input: PersonalAgentInput): Promise<{ agent: PersonalAgentGrant; token: string }>;
  listAgents(ownerUserId: string): Promise<PersonalAgentGrant[]>;
  revokeAgent(ownerUserId: string, id: string): Promise<boolean>;
  snapshotForAgent(token: string): Promise<WorkspaceView>;
  commandForAgent(token: string, input: unknown): Promise<unknown>;
};
const COMMANDS = new Set(["task.create", "task.complete", "task.update", "task.schedule", "task.unschedule", "task.delete", "calendar.create", "calendar.update", "calendar.delete", "mail.read", "mail.draft", "mail.compose", "mail.draft.update", "mail.simulate-send", "mail.send", "mail.examples.add"]);
const KEYS = ["accounts", "messages", "tasks", "calendars", "events", "drafts", "sent", "agents", "activity"];
function fail(code: string, message: string): never { throw Object.assign(new Error(message), { code }); }
export function assertPersonalWorkspaceOwner(ownerId: string) {
  if (typeof ownerId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(ownerId)) fail("invalid_input", "Invalid personal workspace owner");
}
export function createEmptyPersonalWorkspace(ownerId: string): WorkspaceState {
  assertPersonalWorkspaceOwner(ownerId);
  return { accounts: [], messages: [], tasks: [], calendars: [{ id: "personal", ownerId, name: "Personal", color: "#2454dc" }], events: [], drafts: [], sent: [], agents: [], activity: [] };
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown, max = 500): value is string => typeof value === "string" && !!value.trim() && value.length <= max;
const date = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
function keys(value: Record<string, unknown>, allowed: string[]) { return Object.keys(value).every(key => allowed.includes(key)); }
/** Reject foreign or malformed persisted content rather than quietly filtering it. */
export function validatePersonalWorkspace(ownerId: string, value: unknown): WorkspaceState {
  assertPersonalWorkspaceOwner(ownerId);
  const invalid = () => fail("invalid_state", "Invalid personal workspace state");
  if (!record(value) || !keys(value, KEYS) || KEYS.some(key => !Array.isArray(value[key]))) return invalid();
  const state = value as unknown as WorkspaceState;
  if (state.agents.length) return invalid();
  const ids = new Set<string>();
  const unique = (id: unknown) => { if (!string(id, 128) || ids.has(id)) return false; ids.add(id); return true; };
  if (state.accounts.length !== 0 && state.accounts.length !== PERSONAL_MAIL_ACCOUNTS.length) return invalid();
  for (const account of state.accounts) {
    if (!record(account)) return invalid();
    const expected = PERSONAL_MAIL_ACCOUNTS.find(item => item.id === account.id);
    if (!record(account) || !unique(account.id) || !expected || !keys(account, ["id", "ownerId", "provider", "label", "address", "mode"]) || account.ownerId !== ownerId || Object.entries(expected).some(([key, value]) => (account as unknown as Record<string, unknown>)[key] !== value)) return invalid();
  }
  if (state.messages.length !== (state.accounts.length ? PERSONAL_MAIL_MESSAGES.length : 0)) return invalid();
  for (const message of state.messages) {
    if (!record(message)) return invalid();
    const expected = PERSONAL_MAIL_MESSAGES.find(item => item.id === message.id);
    if (!record(message) || !unique(message.id) || !expected || !keys(message, ["id", "accountId", "subject", "from", "to", "body", "receivedAt", "read"]) || typeof message.read !== "boolean" || Object.entries(expected).some(([key, value]) => key !== "read" && (message as unknown as Record<string, unknown>)[key] !== value)) return invalid();
  }
  const email = (value: unknown) => string(value) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  for (const [item, sent] of [...state.drafts.map(item => [item, false] as const), ...state.sent.map(item => [item, true] as const)]) {
    if (!record(item)) return invalid();
    const fields = item as unknown as Record<string, unknown>;
    if (!record(item) || !unique(item.id) || !state.accounts.some(account => account.id === item.accountId) || !keys(item, sent ? ["id", "accountId", "messageId", "from", "to", "subject", "body", "sentAt", "mode"] : ["id", "accountId", "messageId", "to", "subject", "body", "status"]) || !email(item.to) || !string(item.subject) || !string(item.body, 20000)) return invalid();
    if (item.messageId !== undefined && !state.messages.some(message => message.id === item.messageId && message.accountId === item.accountId)) return invalid();
    if (sent ? fields.mode !== "fixture" || !date(fields.sentAt) || fields.from !== state.accounts.find(account => account.id === item.accountId)?.address : fields.status !== "draft") return invalid();
  }
  if (!state.calendars.length) return invalid();
  for (const calendar of state.calendars) if (!record(calendar) || !keys(calendar, ["id", "ownerId", "name", "color"]) || !unique(calendar.id) || calendar.ownerId !== ownerId || !string(calendar.name) || !/^#[0-9a-f]{6}$/i.test(calendar.color)) return invalid();
  for (const task of state.tasks) {
    if (!record(task) || !keys(task, ["id", "ownerId", "title", "completed", "scheduledSlot", "calendarEventId", "sourceMessageId", "sourceAccountId"]) || !unique(task.id) || task.ownerId !== ownerId || !string(task.title) || typeof task.completed !== "boolean") return invalid();
    if ((task.sourceMessageId === undefined) !== (task.sourceAccountId === undefined) || (task.sourceMessageId !== undefined && !state.messages.some(message => message.id === task.sourceMessageId && message.accountId === task.sourceAccountId))) return invalid();
    if (task.scheduledSlot !== undefined && (!record(task.scheduledSlot) || !keys(task.scheduledSlot, ["start", "end"]) || !date(task.scheduledSlot.start) || !date(task.scheduledSlot.end) || task.scheduledSlot.start >= task.scheduledSlot.end)) return invalid();
    if ((task.calendarEventId === undefined) !== (task.scheduledSlot === undefined) || (task.calendarEventId !== undefined && !string(task.calendarEventId, 128))) return invalid();
  }
  for (const event of state.events) {
    if (!record(event) || !keys(event, ["id", "calendarId", "title", "start", "end", "taskId"]) || !unique(event.id) || !state.calendars.some(calendar => calendar.id === event.calendarId) || !string(event.title) || !date(event.start) || !date(event.end) || event.start >= event.end) return invalid();
    if (event.taskId !== undefined && !state.tasks.some(task => task.id === event.taskId && task.calendarEventId === event.id && task.scheduledSlot?.start === event.start && task.scheduledSlot.end === event.end)) return invalid();
  }
  for (const task of state.tasks) if (task.calendarEventId && !state.events.some(event => event.id === task.calendarEventId && event.taskId === task.id)) return invalid();
  for (const entry of state.activity) if (!record(entry) || !keys(entry, ["id", "ownerId", "actor", "action", "createdAt"]) || !unique(entry.id) || entry.ownerId !== ownerId || (entry.actor !== "You" && !/^Agent agt_[a-f0-9]{32}$/.test(entry.actor)) || (!COMMANDS.has(entry.action) && entry.action !== "task-calendar.sync") || !date(entry.createdAt)) return invalid();
  return structuredClone(state);
}
function assertCommand(input: unknown): asserts input is PersonalWorkspaceCommand {
  if (!record(input) || typeof input.type !== "string") fail("invalid_input", "A workspace command is required");
  if (!COMMANDS.has(input.type)) fail("forbidden", "Only personal workspace commands are available");

}
function agentEngine(ownerId: string, state: WorkspaceState, grant: PersonalAgentGrant) {
  if (grant.ownerUserId !== ownerId || grant.revoked) fail("unauthorized", "Personal agent access is unavailable");
  const initial = validatePersonalWorkspace(ownerId, state);
  initial.agents = [{ id: grant.id, ownerId, name: `Agent ${grant.id}`, scopes: grant.scopes, resourceIds: grant.resourceIds.map(id => id === "calendar:personal" ? "personal" : id), revoked: false, createdAt: grant.createdAt }];
  return createWorkspaceEngine(initial);
}
export function personalAgentSnapshot(ownerId: string, state: WorkspaceState, grant: PersonalAgentGrant): WorkspaceView {
  const view = agentEngine(ownerId, state, grant).snapshot({ kind: "agent", ownerId, agentId: grant.id });
  if (!grant.scopes.includes("mail:read")) view.drafts = [];
  view.agents = []; return view;
}
export function applyPersonalAgentCommand(ownerId: string, state: WorkspaceState, grant: PersonalAgentGrant, input: unknown) {
  assertCommand(input);
  if (input.type === "mail.examples.add") fail("forbidden", "Only a human can add example mail");
  const engine = agentEngine(ownerId, state, grant);
  let result = engine.command({ kind: "agent", ownerId, agentId: grant.id }, input) as Record<string, unknown>;
  const readScope = input.type.startsWith("task.") ? "tasks:read" : input.type.startsWith("mail.") ? "mail:read" : "calendar:read";
  if (!grant.scopes.includes(readScope)) result = { id: result.id, ...(result.deleted === true ? { deleted: true } : { updated: true }) };
  const next = engine.exportState(); next.agents = [];
  return { result, state: validatePersonalWorkspace(ownerId, next) };
}
export function applyPersonalWorkspaceCommand(ownerId: string, state: WorkspaceState, input: unknown) {
  const initial = validatePersonalWorkspace(ownerId, state);
  assertCommand(input);
  if (input.type === "mail.examples.add") {
    if (Object.keys(input).some(key => key !== "type")) fail("invalid_input", "Unknown command field");
    const result = addPersonalMailExamples(ownerId, initial);
    return { result, state: validatePersonalWorkspace(ownerId, initial) };
  }
  const engine = createWorkspaceEngine(initial);
  const result = engine.command({ kind: "human", ownerId }, input as WorkspaceCommand);
  return { result, state: validatePersonalWorkspace(ownerId, engine.exportState()) };
}
