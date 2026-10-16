import type { WorkspaceCommand, WorkspaceState, WorkspaceView } from "./workspace-contracts.ts";
import { createWorkspaceEngine } from "./workspace-engine.ts";

export type PersonalWorkspaceStore = {
  snapshot(ownerUserId: string): Promise<WorkspaceView>;
  command(ownerUserId: string, input: unknown): Promise<unknown>;
  removeAllForUser(ownerUserId: string): Promise<number>;
};
const COMMANDS = new Set(["task.create", "task.complete", "task.update", "task.schedule", "task.unschedule", "task.delete", "calendar.create", "calendar.update", "calendar.delete"]);
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
  if ([state.accounts, state.messages, state.drafts, state.sent, state.agents].some(items => items.length)) return invalid();
  const ids = new Set<string>();
  const unique = (id: unknown) => { if (!string(id, 128) || ids.has(id)) return false; ids.add(id); return true; };
  if (!state.calendars.length) return invalid();
  for (const calendar of state.calendars) if (!record(calendar) || !keys(calendar, ["id", "ownerId", "name", "color"]) || !unique(calendar.id) || calendar.ownerId !== ownerId || !string(calendar.name) || !/^#[0-9a-f]{6}$/i.test(calendar.color)) return invalid();
  for (const task of state.tasks) {
    if (!record(task) || !keys(task, ["id", "ownerId", "title", "completed", "scheduledSlot", "calendarEventId"]) || !unique(task.id) || task.ownerId !== ownerId || !string(task.title) || typeof task.completed !== "boolean") return invalid();
    if (task.scheduledSlot !== undefined && (!record(task.scheduledSlot) || !keys(task.scheduledSlot, ["start", "end"]) || !date(task.scheduledSlot.start) || !date(task.scheduledSlot.end) || task.scheduledSlot.start >= task.scheduledSlot.end)) return invalid();
    if ((task.calendarEventId === undefined) !== (task.scheduledSlot === undefined) || (task.calendarEventId !== undefined && !string(task.calendarEventId, 128))) return invalid();
  }
  for (const event of state.events) {
    if (!record(event) || !keys(event, ["id", "calendarId", "title", "start", "end", "taskId"]) || !unique(event.id) || !state.calendars.some(calendar => calendar.id === event.calendarId) || !string(event.title) || !date(event.start) || !date(event.end) || event.start >= event.end) return invalid();
    if (event.taskId !== undefined && !state.tasks.some(task => task.id === event.taskId && task.calendarEventId === event.id && task.scheduledSlot?.start === event.start && task.scheduledSlot.end === event.end)) return invalid();
  }
  for (const task of state.tasks) if (task.calendarEventId && !state.events.some(event => event.id === task.calendarEventId && event.taskId === task.id)) return invalid();
  for (const entry of state.activity) if (!record(entry) || !keys(entry, ["id", "ownerId", "actor", "action", "createdAt"]) || !unique(entry.id) || entry.ownerId !== ownerId || entry.actor !== "You" || !COMMANDS.has(entry.action) || !date(entry.createdAt)) return invalid();
  return structuredClone(state);
}
export function applyPersonalWorkspaceCommand(ownerId: string, state: WorkspaceState, input: unknown) {
  const initial = validatePersonalWorkspace(ownerId, state);
  if (!record(input) || typeof input.type !== "string") fail("invalid_input", "A workspace command is required");
  if (!COMMANDS.has(input.type)) fail("forbidden", "Only personal Task and Calendar commands are available");
  if (input.type === "task.create" && Object.hasOwn(input, "messageId")) fail("forbidden", "Personal tasks cannot link provider mail");
  const engine = createWorkspaceEngine(initial);
  const result = engine.command({ kind: "human", ownerId }, input as WorkspaceCommand);
  return { result, state: validatePersonalWorkspace(ownerId, engine.exportState()) };
}
