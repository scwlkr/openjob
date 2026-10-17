import type { WorkspaceView, PersonalAgentGrant } from './personal-workspace-contracts';
import { OpenJobApiError } from './auth/coordinator';

const mailboxIds = ['mail:example-gmail-personal', 'mail:example-gmail-work', 'mail:example-outlook'];
const scopes = ['tasks:read', 'tasks:write', 'calendar:read', 'calendar:write', 'mail:read', 'mail:draft', 'mail:simulate-send'];
const resources = ['tasks:personal', 'calendar:personal', ...mailboxIds];
const actions = ['task.create', 'task.complete', 'task.update', 'task.notes', 'task.delete', 'task.schedule', 'task.schedule-available', 'task.unschedule', 'calendar.create', 'calendar.update', 'calendar.delete', 'calendar.import', 'mail.read', 'mail.draft', 'mail.compose', 'mail.draft.update', 'mail.simulate-send', 'mail.examples.add', 'task-calendar.sync'];
type Row = Record<string, unknown>;
function invalid(): never { throw new OpenJobApiError(502, 'invalid_response', 'OpenJob returned invalid personal workspace data.'); }
function row(value: unknown, allowed: string[], required = allowed): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const result = value as Row;
  if (Object.keys(result).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(result, key))) return invalid();
  return result;
}
const text = (value: unknown, max = 500): value is string => typeof value === 'string' && !!value.trim() && value.length <= max;
const email = (value: unknown) => text(value) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const date = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const id = (value: unknown): value is string => text(value, 128);
export function assertNativePersonalOwner(owner: string) { if (typeof owner !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(owner)) invalid(); }
function list(value: unknown, limit = 2000): unknown[] { if (!Array.isArray(value) || value.length > limit) return invalid(); return value; }
function strings(value: unknown, allowed: string[]) { const entries = list(value, allowed.length); if (!entries.length || entries.some(item => typeof item !== 'string' || !allowed.includes(item)) || new Set(entries).size !== entries.length) invalid(); }
/** Pure JSON boundary. No engine, credentials, native storage or structuredClone dependency. */
export function validateNativePersonalWorkspace(value: unknown, owner: string): WorkspaceView {
  assertNativePersonalOwner(owner);
  const names = ['accounts', 'messages', 'tasks', 'calendars', 'events', 'drafts', 'sent', 'agents', 'activity'];
  const top = row(value, names); const arrays = Object.fromEntries(names.map(name => [name, list(top[name])]));
  if (Object.values(arrays).reduce((count, items) => count + items.length, 0) > 5000 || arrays.agents!.length) invalid();
  const ids = new Set<string>();
  const unique = (value: unknown) => { if (!id(value) || ids.has(value)) invalid(); ids.add(value); };
  const accounts = arrays.accounts!.map(value => {
    const item = row(value, ['id', 'ownerId', 'provider', 'label', 'address', 'mode']); unique(item.id);
    const index = mailboxIds.indexOf(item.id as string);
    if (index < 0 || item.ownerId !== owner || item.mode !== 'fixture' || item.provider !== (index === 2 ? 'outlook' : 'gmail') || !text(item.label) || !email(item.address) || !(item.address as string).endsWith('@example.invalid')) invalid();
    return item;
  });
  if (accounts.length !== 0 && accounts.length !== 3) invalid();
  const messages = arrays.messages!.map(value => {
    const item = row(value, ['id', 'accountId', 'subject', 'from', 'to', 'body', 'receivedAt', 'read']); unique(item.id);
    const match = /^example-message-([1-6])$/.exec(item.id as string);
    if (!match || item.accountId !== mailboxIds[Math.floor((Number(match[1]) - 1) / 2)] || !accounts.some(account => account.id === item.accountId) || !text(item.subject) || !text(item.body, 20000) || !email(item.from) || !(item.from as string).endsWith('@example.invalid') || item.to !== accounts.find(account => account.id === item.accountId)?.address || !date(item.receivedAt) || typeof item.read !== 'boolean') invalid();
    return item;
  });
  if (messages.length !== (accounts.length ? 6 : 0)) invalid();
  const calendars = arrays.calendars!.map(value => {
    const item = row(value, ['id', 'ownerId', 'name', 'color']); unique(item.id);
    if (item.ownerId !== owner || !text(item.name) || typeof item.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(item.color)) invalid(); return item;
  });
  if (!calendars.length) invalid();
  const tasks = arrays.tasks!.map(value => {
    const item = row(value, ['id', 'ownerId', 'title', 'notes', 'completed', 'scheduledSlot', 'calendarEventId', 'sourceMessageId', 'sourceAccountId'], ['id', 'ownerId', 'title', 'completed']); unique(item.id);
    if (item.ownerId !== owner || !text(item.title) || typeof item.completed !== 'boolean' || (item.sourceMessageId === undefined) !== (item.sourceAccountId === undefined) || item.sourceMessageId !== undefined && !messages.some(message => message.id === item.sourceMessageId && message.accountId === item.sourceAccountId)) invalid();
    if (item.notes !== undefined && (typeof item.notes !== 'string' || [...item.notes].length > 20000)) invalid();
    if ((item.scheduledSlot === undefined) !== (item.calendarEventId === undefined)) invalid();
    if (item.scheduledSlot !== undefined) { const slot = row(item.scheduledSlot, ['start', 'end']); if (!date(slot.start) || !date(slot.end) || slot.start >= slot.end || !id(item.calendarEventId)) invalid(); }
    return item;
  });
  const events = arrays.events!.map(value => {
    const item = row(value, ['id', 'calendarId', 'title', 'start', 'end', 'taskId'], ['id', 'calendarId', 'title', 'start', 'end']); unique(item.id);
    if (!calendars.some(calendar => calendar.id === item.calendarId) || !text(item.title) || !date(item.start) || !date(item.end) || item.start >= item.end) invalid();
    if (item.taskId !== undefined && !tasks.some(task => { const slot = task.scheduledSlot as Row | undefined; return task.id === item.taskId && task.calendarEventId === item.id && slot?.start === item.start && slot?.end === item.end; })) invalid(); return item;
  });
  if (tasks.some(task => task.calendarEventId !== undefined && !events.some(event => event.id === task.calendarEventId && event.taskId === task.id))) invalid();
  for (const sent of [false, true]) for (const value of arrays[sent ? 'sent' : 'drafts']!) {
    const required = ['id', 'accountId', 'to', 'subject', 'body', ...(sent ? ['from', 'sentAt', 'mode'] : ['status'])];
    const item = row(value, [...required, 'messageId'], required); unique(item.id);
    if (!accounts.some(account => account.id === item.accountId) || !email(item.to) || !text(item.subject) || !text(item.body, 20000) || item.messageId !== undefined && !messages.some(message => message.id === item.messageId && message.accountId === item.accountId)) invalid();
    if (sent ? item.mode !== 'fixture' || !date(item.sentAt) || item.from !== accounts.find(account => account.id === item.accountId)?.address : item.status !== 'draft') invalid();
  }
  for (const value of arrays.activity!) {
    const item = row(value, ['id', 'ownerId', 'actor', 'action', 'createdAt']); unique(item.id);
    if (item.ownerId !== owner || item.actor !== 'You' && !(typeof item.actor === 'string' && /^Agent agt_[a-f0-9]{32}$/.test(item.actor)) || typeof item.action !== 'string' || !actions.includes(item.action) || !date(item.createdAt)) invalid();
  }
  return value as WorkspaceView;
}
export function validateNativePersonalAgents(value: unknown, owner: string): PersonalAgentGrant[] {
  assertNativePersonalOwner(owner); const seen = new Set<string>();
  for (const entry of list(value, 100)) {
    const grant = row(entry, ['id', 'ownerUserId', 'name', 'scopes', 'resourceIds', 'createdAt', 'expiresAt', 'revoked']);
    if (typeof grant.id !== 'string' || !/^agt_[a-f0-9]{32}$/.test(grant.id) || seen.has(grant.id) || grant.ownerUserId !== owner || !text(grant.name, 80) || /[\u0000-\u001f\u007f-\u009f]/.test(grant.name) || typeof grant.revoked !== 'boolean' || !date(grant.createdAt) || !date(grant.expiresAt) || Date.parse(grant.expiresAt) - Date.parse(grant.createdAt) !== 86400000) invalid();
    strings(grant.scopes, scopes); strings(grant.resourceIds, resources); seen.add(grant.id);
  }
  return value as PersonalAgentGrant[];
}
