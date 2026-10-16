import type { WorkspaceActor, WorkspaceAgent, WorkspaceCommand, WorkspaceEngine, WorkspaceScope, WorkspaceState } from "./workspace-contracts.ts";
import { createFixtureWorkspace } from "./workspace-fixtures.ts";

const SCOPES: WorkspaceScope[] = ["mail:read", "mail:draft", "mail:simulate-send", "tasks:read", "tasks:write", "calendar:read", "calendar:write"];
function fail(code: string, message: string): never { throw Object.assign(new Error(message), { code }); }
function text(value: unknown, name: string, limit = 500): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit) fail("invalid_input", `Invalid ${name}`);
  return value.trim();
}
function parse(input: unknown): WorkspaceCommand {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("invalid_input", "Command must be an object");
  const obj = input as Record<string, unknown>;
  const fields: Record<string, string[]> = {
    "task.create": ["title", "messageId"], "task.complete": ["taskId", "completed"],
    "task.schedule": ["taskId", "calendarId", "start", "end"], "calendar.create": ["calendarId", "title", "start", "end"],
    "calendar.update": ["eventId", "title", "start", "end"], "calendar.delete": ["eventId"],
    "mail.compose": ["accountId", "to", "subject", "body"],
    "mail.draft.update": ["draftId", "to", "subject", "body"], "mail.simulate-send": ["draftId"],
    "mail.read": ["messageId", "read"], "mail.draft": ["messageId", "body"], "mail.send": ["draftId"],
    "agent.grant": ["name", "scopes", "resourceIds"], "agent.revoke": ["agentId"],
  };
  const type = typeof obj.type === "string" ? obj.type : "";
  if (!Object.hasOwn(fields, type)) fail("invalid_input", "Unknown command");
  if (Object.keys(obj).some(key => key !== "type" && !fields[type].includes(key))) fail("invalid_input", "Unknown command field");
  const parsed: Record<string, unknown> = { type };
  for (const field of fields[type]) {
    if (field === "messageId" && type === "task.create" && obj[field] === undefined) continue;
    if (field === "completed" || field === "read") {
      if (typeof obj[field] !== "boolean") fail("invalid_input", `Invalid ${field}`);
      parsed[field] = obj[field];
    } else if (field === "scopes" || field === "resourceIds") {
      const values = obj[field];
      if (!Array.isArray(values) || !values.length || values.length > 100) fail("invalid_input", `Invalid ${field}`);
      parsed[field] = [...new Set(values.map(value => text(value, field)))];
      if (field === "scopes" && (parsed[field] as string[]).some(scope => !SCOPES.includes(scope as WorkspaceScope))) fail("invalid_input", "Unknown scope");
    } else parsed[field] = text(obj[field], field, field === "body" ? 20000 : 500);
  }
  if ("start" in parsed) {
    for (const key of ["start", "end"]) {
      const value = parsed[key] as string;
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail("invalid_input", "Times require valid ISO timestamps with timezone");
      if (new Date(value.slice(0, 10) + "T00:00:00Z").toISOString().slice(0, 10) !== value.slice(0, 10)) fail("invalid_input", "Invalid calendar date");
      parsed[key] = new Date(value).toISOString();
    }
    if ((parsed.start as string) >= (parsed.end as string)) fail("invalid_input", "End must follow start");
  }
  return parsed as WorkspaceCommand;
}

export function createWorkspaceEngine(initial: WorkspaceState = createFixtureWorkspace()): WorkspaceEngine {
  let state = structuredClone(initial);
  if (state.sent === undefined) state.sent = [];
  function authorize(actor: WorkspaceActor): WorkspaceAgent | undefined {
    if (!actor || !["human", "agent"].includes(actor.kind) || typeof actor.ownerId !== "string" || !actor.ownerId.trim()) fail("unauthorized", "Invalid actor");
    if (actor.kind === "human") return;
    const grant = state.agents.find(item => item.id === actor.agentId && item.ownerId === actor.ownerId);
    if (!grant || grant.revoked) fail("unauthorized", "Agent grant is unavailable or revoked");
    return grant;
  }
  function snapshot(actor: WorkspaceActor) {
    const grant = authorize(actor);
    const allowed = (scope: WorkspaceScope, resource: string) => !grant || (grant.scopes.includes(scope) && grant.resourceIds.includes(resource));
    const accounts = state.accounts.filter(a => a.ownerId === actor.ownerId && (allowed("mail:read", a.id) || allowed("mail:draft", a.id)));
    const mailAccounts = new Set(state.accounts.filter(a => a.ownerId === actor.ownerId && allowed("mail:read", a.id)).map(a => a.id));
    const calendars = state.calendars.filter(c => c.ownerId === actor.ownerId && allowed("calendar:read", c.id)).map(c => {
      const copy = { ...c };
      if (copy.accountId && !accounts.some(a => a.id === copy.accountId)) delete copy.accountId;
      return copy;
    });
    const calendarIds = new Set(calendars.map(c => c.id));
    const tasks = state.tasks.filter(t => t.ownerId === actor.ownerId && allowed("tasks:read", "tasks:personal")).map(task => {
      const copy = { ...task };
      if (copy.sourceAccountId && !mailAccounts.has(copy.sourceAccountId)) { delete copy.sourceAccountId; delete copy.sourceMessageId; }
      if (copy.calendarEventId && !state.events.some(e => e.id === copy.calendarEventId && calendarIds.has(e.calendarId))) delete copy.calendarEventId;
      return copy;
    });
    const taskIds = new Set(tasks.map(t => t.id));
    return structuredClone({ accounts, messages: state.messages.filter(m => mailAccounts.has(m.accountId)), tasks, calendars,
      events: state.events.filter(e => calendarIds.has(e.calendarId)).map(e => { const copy = { ...e }; if (copy.taskId && !taskIds.has(copy.taskId)) delete copy.taskId; return copy; }),
      drafts: state.drafts.filter(d => state.accounts.some(a => a.id === d.accountId && a.ownerId === actor.ownerId) && allowed("mail:draft", d.accountId)),
      sent: state.sent.filter(item => mailAccounts.has(item.accountId)),
      agents: state.agents.filter(a => a.ownerId === actor.ownerId && (!grant || a.id === grant.id)), activity: grant ? [] : state.activity.filter(a => a.ownerId === actor.ownerId),
    });
  }
  function command(actor: WorkspaceActor, input: unknown): unknown {
    const grant = authorize(actor);
    const cmd = parse(input);
    if (cmd.type === "mail.send") fail("sending_disabled", "Sending is disabled in this fixture prototype");
    const next = structuredClone(state);
    const need = (scope: WorkspaceScope, resource: string) => {
      if (grant && (!grant.scopes.includes(scope) || !grant.resourceIds.includes(resource))) fail("forbidden", "Scope or resource is not granted");
    };
    const account = (id: string) => { const found = next.accounts.find(a => a.id === id && a.ownerId === actor.ownerId); if (!found) fail("forbidden", "Account is unavailable"); return found; };
    const message = (id: string) => { const found = next.messages.find(m => m.id === id); if (!found) fail("forbidden", "Message is unavailable"); account(found.accountId); return found; };
    const draft = (id: string) => { const found = next.drafts.find(d => d.id === id); if (!found) fail("forbidden", "Draft is unavailable"); account(found.accountId); return found; };
    const task = (id: string) => { const found = next.tasks.find(t => t.id === id && t.ownerId === actor.ownerId); if (!found) fail("forbidden", "Task is unavailable"); return found; };
    const calendar = (id: string) => { const found = next.calendars.find(c => c.id === id && c.ownerId === actor.ownerId); if (!found) fail("forbidden", "Calendar is unavailable"); return found; };
    const id = () => crypto.randomUUID();
    let result: unknown;
    switch (cmd.type) {
      case "task.create": {
        need("tasks:write", "tasks:personal");
        const source = cmd.messageId ? message(cmd.messageId) : undefined;
        if (source) need("mail:read", source.accountId);
        const created = { id: id(), ownerId: actor.ownerId, title: cmd.title, completed: false, ...(source ? { sourceMessageId: source.id, sourceAccountId: source.accountId } : {}) };
        next.tasks.push(created); result = created; break;
      }
      case "task.complete": { need("tasks:write", "tasks:personal"); const found = task(cmd.taskId); found.completed = cmd.completed; result = found; break; }
      case "task.schedule": {
        need("tasks:write", "tasks:personal"); need("calendar:write", cmd.calendarId); const found = task(cmd.taskId); calendar(cmd.calendarId);
        let event = found.calendarEventId ? next.events.find(e => e.id === found.calendarEventId) : undefined;
        if (event) { calendar(event.calendarId); need("calendar:write", event.calendarId); }
        else { event = { id: id(), calendarId: cmd.calendarId, title: found.title, start: cmd.start, end: cmd.end, taskId: found.id }; next.events.push(event); }
        Object.assign(event, { calendarId: cmd.calendarId, start: cmd.start, end: cmd.end });
        found.scheduledSlot = { start: cmd.start, end: cmd.end }; found.calendarEventId = event.id; result = found; break;
      }
      case "calendar.create": { calendar(cmd.calendarId); need("calendar:write", cmd.calendarId); const event = { id: id(), calendarId: cmd.calendarId, title: cmd.title, start: cmd.start, end: cmd.end }; next.events.push(event); result = event; break; }
      case "calendar.update": {
        const event = next.events.find(e => e.id === cmd.eventId); if (!event) fail("forbidden", "Event is unavailable");
        calendar(event.calendarId); need("calendar:write", event.calendarId);
        if (event.taskId) { need("tasks:write", "tasks:personal"); const linked = task(event.taskId); linked.scheduledSlot = { start: cmd.start, end: cmd.end }; }
        Object.assign(event, { title: cmd.title, start: cmd.start, end: cmd.end }); result = event; break;
      }
      case "calendar.delete": {
        const event = next.events.find(e => e.id === cmd.eventId); if (!event) fail("forbidden", "Event is unavailable");
        calendar(event.calendarId); need("calendar:write", event.calendarId);
        if (event.taskId) { need("tasks:write", "tasks:personal"); const linked = task(event.taskId); delete linked.scheduledSlot; delete linked.calendarEventId; }
        next.events = next.events.filter(e => e.id !== event.id); result = { id: event.id, deleted: true }; break;
      }
      case "mail.compose": {
        account(cmd.accountId); need("mail:draft", cmd.accountId);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cmd.to)) fail("invalid_input", "Invalid recipient address");
        const draft = { id: id(), accountId: cmd.accountId, to: cmd.to, subject: cmd.subject, body: cmd.body, status: "draft" as const };
        next.drafts.push(draft); result = draft; break;
      }
      case "mail.read": { const found = message(cmd.messageId); need("mail:read", found.accountId); found.read = cmd.read; result = found; break; }
      case "mail.draft": {
        const found = message(cmd.messageId); need("mail:read", found.accountId); need("mail:draft", found.accountId);
        const existing = next.drafts.find(d => d.accountId === found.accountId && d.messageId === found.id);
        if (existing) { existing.body = cmd.body; result = existing; }
        else {
          const created = { id: id(), accountId: found.accountId, messageId: found.id, to: found.from, subject: /^re:/i.test(found.subject) ? found.subject : `Re: ${found.subject}`, body: cmd.body, status: "draft" as const };
          next.drafts.push(created); result = created;
        }
        break;
      }
      case "mail.draft.update": {
        const found = draft(cmd.draftId); need("mail:draft", found.accountId);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cmd.to)) fail("invalid_input", "Invalid recipient address");
        Object.assign(found, { to: cmd.to, subject: cmd.subject, body: cmd.body }); result = found; break;
      }
      case "mail.simulate-send": {
        const found = draft(cmd.draftId); const sender = account(found.accountId);
        need("mail:draft", found.accountId); need("mail:simulate-send", found.accountId);
        const to = text(found.to, "recipient"); const subject = text(found.subject, "subject"); const body = text(found.body, "body", 20000);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) fail("invalid_input", "Invalid recipient address");
        const sent = { id: id(), accountId: found.accountId, ...(found.messageId ? { messageId: found.messageId } : {}), from: sender.address, to, subject, body, sentAt: new Date().toISOString(), mode: "fixture" as const };
        next.sent.push(sent); next.drafts = next.drafts.filter(d => d.id !== found.id); result = sent; break;
      }
      case "agent.grant": {
        if (grant) fail("forbidden", "Only a human can grant agent access");
        for (const resource of cmd.resourceIds) if (resource !== "tasks:personal" && !next.accounts.some(a => a.id === resource && a.ownerId === actor.ownerId) && !next.calendars.some(c => c.id === resource && c.ownerId === actor.ownerId)) fail("forbidden", "Resource is unavailable");
        const created = { id: id(), ownerId: actor.ownerId, name: cmd.name, scopes: cmd.scopes, resourceIds: cmd.resourceIds, revoked: false, createdAt: new Date().toISOString() };
        next.agents.push(created); result = created; break;
      }
      case "agent.revoke": { if (grant) fail("forbidden", "Only a human can revoke agent access"); const found = next.agents.find(a => a.id === cmd.agentId && a.ownerId === actor.ownerId); if (!found) fail("forbidden", "Agent is unavailable"); found.revoked = true; result = found; break; }
    }
    next.activity.push({ id: id(), ownerId: actor.ownerId, actor: actor.kind === "human" ? "You" : grant!.name, action: cmd.type, createdAt: new Date().toISOString() });
    state = next;
    const output = structuredClone(result) as Record<string, unknown>;
    if (grant && output && typeof output === "object") {
      if (typeof output.sourceAccountId === "string" && (!grant.scopes.includes("mail:read") || !grant.resourceIds.includes(output.sourceAccountId))) { delete output.sourceAccountId; delete output.sourceMessageId; }
      if (!grant.scopes.includes("calendar:read") || !next.events.some(e => e.id === output.calendarEventId && grant.resourceIds.includes(e.calendarId))) delete output.calendarEventId;
      if (!grant.scopes.includes("tasks:read") || !grant.resourceIds.includes("tasks:personal")) delete output.taskId;
    }
    return output;
  }
  return { snapshot, command, exportState: () => structuredClone(state) };
}
