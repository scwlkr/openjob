import { WORKSPACE_AGENT_TOKEN, WORKSPACE_AGENT_ID, WORKSPACE_AGENT_LIFETIME_MS, parseWorkspaceAgents, parseWorkspaceAgentActions, publicWorkspaceAgent, validateWorkspaceAgentInput, workspaceAgentView, authorizeWorkspaceAgentCommand, type StoredWorkspaceAgent, type WorkspaceAgentReceipt, type WorkspaceAgentOperation } from '../shared/owned-workspace-agents.ts';
import { agentTokenHash, agentTokenHashEqual, newAgentSecret } from '../server/agent-grants.ts';
import { assertTaskNotesBase } from '../shared/task-notes-precondition.ts';
import { createFirestoreRestClient, FirestoreRequestError, type FirebaseConfig, type FirestoreDocument } from './firestore-rest.ts';
import { activeUserHistoryWrite, assertActiveUser } from './user-history.ts';
import { assertTaskSlotAvailable } from '../shared/workspace-availability.ts';
import { applyTaskCalendarCommand, type TaskCalendarCommand } from '../shared/task-calendar-sync.ts';
import { WORKSPACE_ID, validateWorkspace, validateOwnedSnapshot, workspaceFail, type OwnedWorkspace, type OwnedWorkspaceSnapshot } from '../shared/owned-workspaces.ts';
import { parseMailTaskSources, retainMailTaskSources, existingMailTask, type MailTaskReference, type MailTaskResult } from '../shared/mail-task-source.ts';
import { parseConnectedReplies, sameReplySource, upsertConnectedReply, type ConnectedReplyStore } from '../shared/connected-reply.ts';

/** New owner-only Workspace repository; never reads/migrates Personal Mail aggregates. */
export function createOwnedWorkspaceStore(config: FirebaseConfig, transport: typeof fetch = fetch, { now = Date.now }: { now?: () => number } = {}) {
  const db = createFirestoreRestClient(config, transport);
  const uuid = () => crypto.randomUUID().replaceAll('-', '');
  const ownerId = (owner: string) => { if (!/^user_[a-f0-9]{32}$/.test(owner)) workspaceFail(); };
  const catalogPath = (owner: string) => { ownerId(owner); return `v1OwnedWorkspaceCatalogs/${owner}`; };
  const workPath = (id: string) => { if (!WORKSPACE_ID.test(id)) workspaceFail(); return `v1OwnedWorkspaces/${id}`; };
  async function read(path: string) {
    const response = await db.request(path, {}, { allowNotFound: true });
    if (response.status === 404) return null;
    const doc = await response.json() as FirestoreDocument;
    if (doc.name !== db.documentName(path) || !doc.updateTime) workspaceFail('invalid_state');
    return doc;
  }
  function decode(doc: FirestoreDocument | null, owner: string) {
    if (!doc || doc.fields?.ownerUserId?.stringValue !== owner) workspaceFail('forbidden');
    const snapshot = validateOwnedSnapshot(JSON.parse(doc.fields?.snapshotJson?.stringValue ?? 'null'));
    if (snapshot.workspace.ownerUserId !== owner || doc.name !== db.documentName(workPath(snapshot.workspace.workspaceId))) workspaceFail('invalid_state');
    return snapshot;
  }
  function catalog(doc: FirestoreDocument | null, owner: string): OwnedWorkspace[] {
    if (!doc) return [];
    if (doc.fields?.ownerUserId?.stringValue !== owner) workspaceFail('invalid_state');
    const value = JSON.parse(doc.fields?.catalogJson?.stringValue ?? 'null');
    if (!Array.isArray(value) || value.length > 50) workspaceFail('invalid_state');
    const result = value.map(validateWorkspace);
    if (result.some(item => item.ownerUserId !== owner) || new Set(result.map(item => item.workspaceId)).size !== result.length) workspaceFail('invalid_state');
    return result;
  }
  const retryable = (error: unknown) => error instanceof FirestoreRequestError && ['ABORTED', 'ALREADY_EXISTS', 'FAILED_PRECONDITION', 'NOT_FOUND'].includes(error.code ?? '');
  const update = (path: string, fields: FirestoreDocument['fields'], previous: FirestoreDocument | null) => ({ update: { name: db.documentName(path), fields }, currentDocument: previous ? { updateTime: previous.updateTime } : { exists: false } });
  async function commit(owner: string, writes: unknown[], current?: () => Promise<void>) { const fence = await activeUserHistoryWrite(db, owner); await current?.(); await db.request(':commit', { method: 'POST', body: JSON.stringify({ writes: [fence, ...writes] }) }); }
  function replies(doc: FirestoreDocument | null, id: string) {
    if (doc?.fields?.connectedRepliesJson && typeof doc.fields.connectedRepliesJson.stringValue !== 'string') workspaceFail('invalid_state');
    const result = parseConnectedReplies(doc?.fields?.connectedRepliesJson?.stringValue);
    if (result.some(row => row.source.workspaceId !== id)) workspaceFail('invalid_state');
    return result;
  }
  const agentRows = (doc: FirestoreDocument, snapshot: OwnedWorkspaceSnapshot) => parseWorkspaceAgents(snapshot.workspace, doc.fields?.workspaceAgentsJson?.stringValue);
  type AgentCredential = { token: string; hash: string; workspaceId: string; agentId: string; sponsor?: string };
  async function credential(token: string, id: string, sponsor?: string): Promise<AgentCredential> {
    const match = WORKSPACE_AGENT_TOKEN.exec(token);
    if (!match || match[1] !== id) workspaceFail('authentication_required');
    return { token, hash: await agentTokenHash(token), workspaceId: id, agentId: match[2], sponsor };
  }
  function authorized(doc: FirestoreDocument, snapshot: OwnedWorkspaceSnapshot, auth: AgentCredential) {
    if (snapshot.workspace.workspaceId !== auth.workspaceId || auth.sponsor !== undefined && snapshot.workspace.ownerUserId !== auth.sponsor) workspaceFail('forbidden');
    const grant = agentRows(doc, snapshot).find(row => row.id === auth.agentId);
    if (!grant || grant.revoked || Date.parse(grant.expiresAt) <= now() || !agentTokenHashEqual(grant.tokenHash, auth.hash)) workspaceFail('authentication_required');
    return grant;
  }
  async function agentEnvelope(auth: AgentCredential) {
    const doc = await read(workPath(auth.workspaceId));
    const owner = doc?.fields?.ownerUserId?.stringValue;
    if (!owner) workspaceFail('authentication_required');
    ownerId(owner); const snapshot = decode(doc, owner);
    await assertActiveUser(db, owner);
    const grant = authorized(doc!, snapshot, auth);
    return { doc: doc!, snapshot, grant, owner };
  }
  async function editAgents<T>(owner: string, id: string, apply: (rows: StoredWorkspaceAgent[], snapshot: OwnedWorkspaceSnapshot) => { rows: StoredWorkspaceAgent[]; result: T }) {
    ownerId(owner);
    for (let attempt = 0; attempt < 3; attempt++) {
      await assertActiveUser(db, owner); const previous = await read(workPath(id)), snapshot = decode(previous, owner);
      const next = apply(agentRows(previous!, snapshot), snapshot);
      const rows = parseWorkspaceAgents(snapshot.workspace, JSON.stringify(next.rows));
      const fields = { ...previous!.fields, workspaceAgentsJson: { stringValue: JSON.stringify(rows) } };
      if (new TextEncoder().encode(JSON.stringify(fields)).length > 898000) workspaceFail('workspace_capacity');
      try { await commit(owner, [update(workPath(id), fields, previous)]); return next.result; }
      catch (error) { if (!retryable(error)) throw error; }
    }
    return workspaceFail('conflict');
  }
  async function change(owner: string, id: string, input: unknown, guard?: { expectedNotes: unknown }, mail?: { source: MailTaskReference; current: () => Promise<void> }, agent?: AgentCredential) {
    ownerId(owner);
    for (let attempt = 0; attempt < 3; attempt++) {
      await assertActiveUser(db, owner); const previous = await read(workPath(id)); const snapshot = decode(previous, owner);
      const grant = agent ? authorized(previous!, snapshot, agent) : undefined;
      if (grant) authorizeWorkspaceAgentCommand(snapshot, publicWorkspaceAgent(grant), input);
      const sources = retainMailTaskSources(parseMailTaskSources(previous?.fields?.mailSourcesJson?.stringValue), snapshot.work.tasks);
      if (sources.some(source => source.workspaceId !== id)) workspaceFail('invalid_state');
      if (mail) {
        if (mail.source.workspaceId !== id) workspaceFail('forbidden');
        await mail.current();
        const existing = existingMailTask(sources, mail.source);
        if (existing) { await assertActiveUser(db, owner); return { snapshot, receipt: { workspaceId: id, taskId: existing.taskId, created: false } }; }
      }
      if (guard) assertTaskNotesBase(snapshot.work.tasks, input, guard.expectedNotes);
      // The existing pure Task/Calendar engine rejects all Mail, source-link and agent commands.
      const available = !!input && typeof input === 'object' && (input as { type?: string }).type === 'task.schedule-available';
      const normalized = available ? { ...input as object, type: 'task.schedule' } : input;
      const work = applyTaskCalendarCommand(snapshot.work, normalized as TaskCalendarCommand, owner, () => `offline_${crypto.randomUUID()}`);
      if (available) { const task = work.tasks.find(item => item.id === (input as { taskId: string }).taskId)!; assertTaskSlotAvailable({ ...snapshot.work, accounts: [], messages: [], drafts: [], sent: [], agents: [], activity: [] }, { taskId: task.id, ...task.scheduledSlot! }); }
      const result = validateOwnedSnapshot({ workspace: snapshot.workspace, work });
      const receipt: MailTaskResult | undefined = mail ? { workspaceId: id, taskId: work.tasks.at(-1)!.id, created: true } : undefined;
      const nextSources = parseMailTaskSources(JSON.stringify(retainMailTaskSources([...sources, ...(mail ? [{ ...mail.source, taskId: receipt!.taskId }] : [])], work.tasks)));
      const fields = { ...previous!.fields, ownerUserId: { stringValue: owner }, snapshotJson: { stringValue: JSON.stringify(result) }, mailSourcesJson: { stringValue: JSON.stringify(nextSources) }, connectedRepliesJson: { stringValue: JSON.stringify(replies(previous, id)) } };
      let agentReceipt: WorkspaceAgentReceipt | undefined;
      if (agent) {
        const command = input as TaskCalendarCommand;
        const itemId = command.type === 'task.create' ? work.tasks.at(-1)!.id : command.type === 'calendar.create' ? work.events.at(-1)!.id : 'taskId' in command ? command.taskId : 'eventId' in command ? command.eventId : workspaceFail();
        agentReceipt = { workspaceId: id, operation: command.type as WorkspaceAgentOperation, itemId };
        const actions = parseWorkspaceAgentActions(previous?.fields?.workspaceAgentActionsJson?.stringValue);
        Object.assign(fields, { workspaceAgentActionsJson: { stringValue: JSON.stringify([...actions, { agentId: agent.agentId, operation: command.type, itemId, at: new Date(now()).toISOString() }].slice(-200)) } });
      }
      if (new TextEncoder().encode(JSON.stringify(fields)).length > 898000) workspaceFail('workspace_capacity');
      try {
        await commit(owner, [update(workPath(id), fields, previous)], async () => { await mail?.current(); if (agent) authorized(previous!, snapshot, agent); });
        if (agent) await agentEnvelope(agent);
        return { snapshot: result, receipt, agentReceipt };
      }
      catch (error) { if (!retryable(error)) throw error; }
    }
    return workspaceFail('conflict');
  }
  const connected: ConnectedReplyStore = {
    async connectedReply(owner, source) {
      ownerId(owner); await assertActiveUser(db, owner);
      const doc = await read(workPath(source.workspaceId)); decode(doc, owner);
      const draft = replies(doc, source.workspaceId).find(row => sameReplySource(row.source, source))?.draft;
      await assertActiveUser(db, owner); return draft;
    },
    async saveConnectedReply(owner, source, input, expectedRevision, current) {
      ownerId(owner);
      for (let attempt = 0; attempt < 3; attempt++) {
        await assertActiveUser(db, owner); const previous = await read(workPath(source.workspaceId)), snapshot = decode(previous, owner);
        await current();
        const sources = retainMailTaskSources(parseMailTaskSources(previous?.fields?.mailSourcesJson?.stringValue), snapshot.work.tasks);
        if (!sources.some(row => JSON.stringify(row) === JSON.stringify(source))) workspaceFail('source_unavailable');
        const next = upsertConnectedReply(replies(previous, source.workspaceId), source, input, expectedRevision);
        if (next.unchanged) { await current(); await assertActiveUser(db, owner); return next.draft; }
        const fields = { ...previous!.fields, connectedRepliesJson: { stringValue: JSON.stringify(next.rows) } };
        if (new TextEncoder().encode(JSON.stringify(fields)).length > 898000) workspaceFail('workspace_capacity');
        try { await commit(owner, [update(workPath(source.workspaceId), fields, previous)], current); return next.draft; }
        catch (error) { if (!retryable(error)) throw error; }
      }
      return workspaceFail('conflict');
    },
  };
  return {
    ...connected,
    async createAgent(owner: string, id: string, input: unknown) {
      const agentId = `agt_${uuid()}`, token = `oj_workspace_${id}.${agentId}.${newAgentSecret()}`, hash = await agentTokenHash(token), issued = now();
      if (!WORKSPACE_AGENT_TOKEN.test(token)) workspaceFail();
      return editAgents(owner, id, (rows, snapshot) => {
        const validated = validateWorkspaceAgentInput(snapshot.workspace, input);
        if (rows.length >= 100) workspaceFail('workspace_capacity');
        if (rows.some(row => row.id === agentId)) workspaceFail('conflict');
        const grant: StoredWorkspaceAgent = { ...validated, id: agentId, ownerUserId: owner, workspaceId: id, createdAt: new Date(issued).toISOString(), expiresAt: new Date(issued + WORKSPACE_AGENT_LIFETIME_MS).toISOString(), revoked: false, tokenHash: hash };
        return { rows: [...rows, grant], result: { agent: publicWorkspaceAgent(grant), token } };
      });
    },
    async listAgents(owner: string, id: string) {
      ownerId(owner); await assertActiveUser(db, owner); const previous = await read(workPath(id)), snapshot = decode(previous, owner);
      const result = { agents: agentRows(previous!, snapshot).map(publicWorkspaceAgent), actions: parseWorkspaceAgentActions(previous?.fields?.workspaceAgentActionsJson?.stringValue) };
      await assertActiveUser(db, owner); decode(await read(workPath(id)), owner); return result;
    },
    async revokeAgent(owner: string, id: string, agentId: string) {
      if (!WORKSPACE_AGENT_ID.test(agentId)) workspaceFail();
      return editAgents(owner, id, rows => { const grant = rows.find(row => row.id === agentId); if (!grant) workspaceFail('forbidden'); grant.revoked = true; return { rows, result: { id: agentId, revoked: true as const } }; });
    },
    async snapshotForAgent(token: string, id: string, sponsor?: string) {
      const auth = await credential(token, id, sponsor), current = await agentEnvelope(auth);
      const result = workspaceAgentView(current.snapshot, publicWorkspaceAgent(current.grant));
      await agentEnvelope(auth); return result;
    },
    async commandForAgent(token: string, id: string, input: unknown, sponsor?: string) {
      const auth = await credential(token, id, sponsor), current = await agentEnvelope(auth);
      let command = input, guard;
      if (input && typeof input === 'object' && !Array.isArray(input) && (input as { type?: unknown }).type === 'task.notes' && Object.hasOwn(input, 'expectedNotes')) {
        const { expectedNotes, ...rest } = input as Record<string, unknown>; command = rest; guard = { expectedNotes };
      }
      return (await change(current.owner, id, command, guard, undefined, auth)).agentReceipt!;
    },
    async list(owner: string) { await assertActiveUser(db, owner); const result = catalog(await read(catalogPath(owner)), owner); await assertActiveUser(db, owner); return result; },
    async create(owner: string, name: unknown) {
      ownerId(owner);
      const workspace = validateWorkspace({ workspaceId: `wsp_${uuid()}`, ownerUserId: owner, name: typeof name === 'string' ? name.trim() : name, createdAt: new Date().toISOString(), taskSpaceId: `tsp_${uuid()}`, calendarId: `cal_${uuid()}` });
      const snapshot: OwnedWorkspaceSnapshot = { workspace, work: { tasks: [], events: [], calendars: [{ id: workspace.calendarId, ownerId: owner, name: 'Planning', color: '#2454dc' }] } };
      for (let attempt = 0; attempt < 3; attempt++) {
        await assertActiveUser(db, owner); const previous = await read(catalogPath(owner)); const items = catalog(previous, owner);
        if (items.length >= 50) workspaceFail('workspace_capacity');
        try { await commit(owner, [update(catalogPath(owner), { ownerUserId: { stringValue: owner }, catalogJson: { stringValue: JSON.stringify([...items, workspace]) } }, previous), update(workPath(workspace.workspaceId), { ownerUserId: { stringValue: owner }, snapshotJson: { stringValue: JSON.stringify(snapshot) } }, null)]); return snapshot; }
        catch (error) { if (!retryable(error)) throw error; }
      }
      return workspaceFail('conflict');
    },
    async snapshot(owner: string, id: string) { ownerId(owner); await assertActiveUser(db, owner); const result = decode(await read(workPath(id)), owner); await assertActiveUser(db, owner); return result; },
    command: async (owner: string, id: string, input: unknown) => (await change(owner, id, input)).snapshot,
    saveTaskNotes: async (owner: string, id: string, input: unknown, expectedNotes: unknown) => (await change(owner, id, input, { expectedNotes })).snapshot,
    createMailTask: async (owner: string, title: string, source: MailTaskReference, current: () => Promise<void>) => (await change(owner, source.workspaceId, { type: 'task.create', title }, undefined, { source, current })).receipt!,
    async mailTaskSource(owner: string, workspaceId: string, taskId: string) {
      ownerId(owner); await assertActiveUser(db, owner);
      const doc = await read(workPath(workspaceId)), snapshot = decode(doc, owner);
      const source = retainMailTaskSources(parseMailTaskSources(doc?.fields?.mailSourcesJson?.stringValue), snapshot.work.tasks).find(row => row.workspaceId === workspaceId && row.taskId === taskId);
      await assertActiveUser(db, owner); return source;
    },
  };
}
export type OwnedWorkspaceStore = ReturnType<typeof createOwnedWorkspaceStore>;
