import { assertTaskNotesBase } from '../shared/task-notes-precondition.ts';
import { applyCalendarIcalImport, isCalendarIcalImport } from "./calendar-ical.ts";
import { projectTaskCalendar, validateTaskCalendarSyncInput, TASK_CALENDAR_MAX_AGE_MS, taskCalendarFail, type TaskCalendarSyncAck } from "../shared/task-calendar-sync.ts";
import { mergeTaskCalendar, parseTaskCalendarReceipts, taskCalendarPayloadHash, taskCalendarRevision, type TaskCalendarReceipt } from "./task-calendar-sync.ts";
import { createFirestoreRestClient, FirestoreRequestError, type FirebaseConfig, type FirestoreDocument } from "./firestore-rest.ts";
import { activeUserHistoryWrite, assertActiveUser } from "./user-history.ts";
import { applyPersonalAgentCommand, personalAgentSnapshot, applyPersonalWorkspaceCommand, assertPersonalWorkspaceOwner, createEmptyPersonalWorkspace, validatePersonalWorkspace, type PersonalWorkspaceStore } from "../shared/personal-workspace.ts";
import { PERSONAL_AGENT_ID, PERSONAL_AGENT_TOKEN, PERSONAL_AGENT_LIFETIME_MS, newPersonalAgentSecret, parsePersonalAgentGrants, personalAgentHashEqual, personalAgentTokenHash, publicPersonalAgent, validatePersonalAgentInput, type StoredPersonalAgentGrant } from "../shared/personal-agent-grants.ts";
import type { WorkspaceState } from "../shared/workspace-contracts.ts";
import { parseMailTaskSources, retainMailTaskSources, existingMailTask, type MailTaskSource } from '../shared/mail-task-source.ts';

const MAX_ENCODED_BYTES = 900_000;
function fail(code: string, message: string): never { throw Object.assign(new Error(message), { code }); }
function concurrent(error: unknown) { return error instanceof FirestoreRequestError && ["ABORTED", "ALREADY_EXISTS", "FAILED_PRECONDITION", "NOT_FOUND"].includes(error.code ?? ""); }
type Options = { now?: () => number; agentId?: () => string; secret?: () => string };
type Credential = { owner: string; id: string; hash: string };
type Envelope = { state: WorkspaceState; grants: StoredPersonalAgentGrant[]; receipts: TaskCalendarReceipt[]; mailSources: MailTaskSource[] };

export function createFirestorePersonalWorkspaceStore(config: FirebaseConfig, fetchImplementation: typeof fetch = fetch,
  { now = Date.now, agentId = () => `agt_${crypto.randomUUID().replaceAll("-", "")}`, secret = newPersonalAgentSecret }: Options = {}): PersonalWorkspaceStore {
  const firestore = createFirestoreRestClient(config, fetchImplementation);
  const path = (owner: string) => { assertPersonalWorkspaceOwner(owner); return `v1PersonalWorkspaces/${owner}`; };
  async function read(owner: string) {
    const response = await firestore.request(path(owner), {}, { allowNotFound: true });
    if (response.status === 404) return null;
    const document = await response.json() as FirestoreDocument;
    if (document.name !== firestore.documentName(path(owner)) || !document.updateTime || document.fields?.ownerUserId?.stringValue !== owner) fail("invalid_state", "Invalid personal workspace record");
    return document;
  }
  function envelope(owner: string, document: FirestoreDocument | null): Envelope {
    if (!document) return { state: createEmptyPersonalWorkspace(owner), grants: [], receipts: [], mailSources: [] };
    const encoded = document.fields?.stateJson?.stringValue;
    if (!encoded || new TextEncoder().encode(JSON.stringify(document)).length > MAX_ENCODED_BYTES) fail("invalid_state", "Invalid personal workspace record");
    let value: unknown;
    try { value = JSON.parse(encoded); } catch { fail("invalid_state", "Invalid personal workspace record"); }
    if (document.fields?.grantJson && typeof document.fields.grantJson.stringValue !== "string") fail("invalid_state", "Invalid personal grant envelope");
    if (document.fields?.syncJson && typeof document.fields.syncJson.stringValue !== "string") fail("invalid_state", "Invalid sync receipt envelope");
    return { state: validatePersonalWorkspace(owner, value), grants: parsePersonalAgentGrants(owner, document.fields?.grantJson?.stringValue), receipts: parseTaskCalendarReceipts(owner, document.fields?.syncJson?.stringValue), mailSources: parseMailTaskSources(document.fields?.mailSourcesJson?.stringValue) };
  }
  async function commit(writes: unknown[]) { await firestore.request(":commit", { method: "POST", body: JSON.stringify({ writes }) }); }
  async function credential(token: string): Promise<Credential> {
    const match = typeof token === "string" ? PERSONAL_AGENT_TOKEN.exec(token) : null;
    if (!match) fail("authentication_required", "Personal agent access is unavailable");
    return { owner: match[1], id: match[2], hash: await personalAgentTokenHash(token) };
  }
  function authorized(grants: StoredPersonalAgentGrant[], auth: Credential) {
    const grant = grants.find(item => item.id === auth.id && item.ownerUserId === auth.owner);
    if (!grant || grant.revoked || Date.parse(grant.createdAt) > now() || Date.parse(grant.expiresAt) <= now() || !personalAgentHashEqual(grant.tokenHash, auth.hash)) fail("authentication_required", "Personal agent access is unavailable");
    return grant;
  }
  type Mutation = { result: unknown; state?: WorkspaceState; grants?: StoredPersonalAgentGrant[]; skip?: boolean; receipts?: TaskCalendarReceipt[]; mailSources?: MailTaskSource[]; beforeCommit?: () => void | Promise<void> };
  async function mutate(owner: string, apply: (current: Envelope) => Mutation | Promise<Mutation>, auth?: Credential) {
    assertPersonalWorkspaceOwner(owner);
    for (let attempt = 0; attempt < 3; attempt++) {
      await assertActiveUser(firestore, owner);
      const existing = await read(owner); const current = envelope(owner, existing);
      if (auth) authorized(current.grants, auth);
      const next = await apply(current);
      if (next.skip) { if (auth) authorized((await activeEnvelope(owner)).grants, auth); else await assertActiveUser(firestore, owner); return next.result; }
      // Every newly saved Task/Calendar state must still fit the existing offline contract.
      if (next.state) projectTaskCalendar(owner, next.state);
      const mailSources = retainMailTaskSources(next.mailSources ?? current.mailSources, (next.state ?? current.state).tasks);
      const update = { name: firestore.documentName(path(owner)), fields: { ownerUserId: { stringValue: owner }, stateJson: { stringValue: JSON.stringify(next.state ?? current.state) }, grantJson: { stringValue: JSON.stringify(next.grants ?? current.grants) }, syncJson: { stringValue: JSON.stringify(next.receipts ?? current.receipts) }, mailSourcesJson: { stringValue: JSON.stringify(mailSources) } } };
      if (new TextEncoder().encode(JSON.stringify(update)).length > MAX_ENCODED_BYTES - 1024) fail("workspace_capacity", "Personal workspace storage limit reached");
      try {
        const userFence = await activeUserHistoryWrite(firestore, owner);
        // Authorization-time expiry: REST CAS cannot compare the server's commit clock.
        // Check immediately before dispatch; unchanged envelope CAS fences revocation.
        if (auth) authorized(current.grants, auth);
        await next.beforeCommit?.();
        await commit([userFence, { update, currentDocument: existing ? { updateTime: existing.updateTime } : { exists: false } }]);
        return next.result;
      } catch (error) { if (!concurrent(error)) throw error; }
    }
    return fail("conflict", "Personal workspace changed concurrently; retry the command");
  }
  async function activeEnvelope(owner: string) {
    assertPersonalWorkspaceOwner(owner); await assertActiveUser(firestore, owner);
    const result = envelope(owner, await read(owner)); await assertActiveUser(firestore, owner); return result;
  }
  return {
    async snapshot(owner) { return (await activeEnvelope(owner)).state; },
    async mailTaskSource(owner, workspaceId, taskId) {
      const current = await activeEnvelope(owner);
      return retainMailTaskSources(current.mailSources, current.state.tasks).find(row => row.workspaceId === workspaceId && row.taskId === taskId);
    },
    async createMailTask(owner, title, source, currentAccess) {
      return await mutate(owner, async current => {
        await currentAccess();
        const rows = retainMailTaskSources(current.mailSources, current.state.tasks);
        const existing = existingMailTask(rows, source);
        if (existing) return { result: { workspaceId: source.workspaceId, taskId: existing.taskId, created: false }, skip: true };
        const next = applyPersonalWorkspaceCommand(owner, current.state, { type: 'task.create', title });
        const taskId = (next.result as { id: string }).id;
        const mailSources = parseMailTaskSources(JSON.stringify([...rows, { ...source, taskId }]));
        return { ...next, mailSources, result: { workspaceId: source.workspaceId, taskId, created: true }, beforeCommit: currentAccess };
      }) as { workspaceId: string; taskId: string; created: boolean };
    },
    async readTaskCalendarSync(owner) {
      const current = await activeEnvelope(owner); const projection = projectTaskCalendar(owner, current.state);
      const revision = await taskCalendarRevision(owner, projection); await assertActiveUser(firestore, owner);
      return { revision, projection };
    },
    async syncTaskCalendar(owner, value) {
      const input = validateTaskCalendarSyncInput(owner, value); const payloadHash = await taskCalendarPayloadHash(owner, input);
      return await mutate(owner, async current => {
        const receipts = current.receipts.filter(receipt => Date.parse(receipt.retainUntil) > now());
        const receipt = receipts.find(receipt => receipt.operationId === input.operationId);
        if (receipt) { if (receipt.payloadHash !== payloadHash) taskCalendarFail("conflict"); return { result: { operationId: input.operationId, revision: receipt.revision }, skip: true }; }
        const checkExpiry = () => { if (Date.parse(input.expiresAt) <= now() || Date.parse(input.expiresAt) > now() + TASK_CALENDAR_MAX_AGE_MS) taskCalendarFail("sync_expired"); };
        checkExpiry();
        if (await taskCalendarRevision(owner, projectTaskCalendar(owner, current.state)) !== input.baseRevision) taskCalendarFail("conflict");
        if (receipts.length >= 100) taskCalendarFail("workspace_capacity");
        const next = mergeTaskCalendar(owner, current.state, input.projection);
        next.activity = [...next.activity, { id: crypto.randomUUID(), ownerId: owner, actor: "You", action: "task-calendar.sync", createdAt: new Date(now()).toISOString() }];
        const state = validatePersonalWorkspace(owner, next); const revision = await taskCalendarRevision(owner, projectTaskCalendar(owner, state));
        receipts.push({ ownerId: owner, operationId: input.operationId, payloadHash, expiresAt: input.expiresAt, retainUntil: new Date(Date.parse(input.expiresAt) + TASK_CALENDAR_MAX_AGE_MS).toISOString(), revision });
        return { result: { operationId: input.operationId, revision }, state, receipts, beforeCommit: checkExpiry };
      }) as TaskCalendarSyncAck;
    },

    async saveTaskNotes(owner, input, expectedNotes) {
      return mutate(owner, current => {
        assertTaskNotesBase(current.state.tasks, input, expectedNotes);
        return applyPersonalWorkspaceCommand(owner, current.state, input);
      });
    },
    async command(owner, input) {
      return mutate(owner, async current => {
        if (!isCalendarIcalImport(input)) return applyPersonalWorkspaceCommand(owner, current.state, input);
        const next = await applyCalendarIcalImport(owner, current.state, input, undefined, now());
        return { ...next, ...(next.state ? { state: validatePersonalWorkspace(owner, next.state) } : {}) };
      });
    },
    async createAgent(owner, input) {
      assertPersonalWorkspaceOwner(owner); const validated = validatePersonalAgentInput(input);
      const id = agentId(); const token = `oj_personal_${owner}.${id}.${secret()}`;
      if (!PERSONAL_AGENT_ID.test(id) || !PERSONAL_AGENT_TOKEN.test(token)) fail("invalid_state", "Invalid generated personal credential");
      const createdAt = now();
      const grant: StoredPersonalAgentGrant = { ...validated, id, ownerUserId: owner, createdAt: new Date(createdAt).toISOString(), expiresAt: new Date(createdAt + PERSONAL_AGENT_LIFETIME_MS).toISOString(), revoked: false, tokenHash: await personalAgentTokenHash(token) };
      return await mutate(owner, current => {
        if (current.grants.length >= 100) fail("workspace_capacity", "Personal agent limit reached");
        if (current.grants.some(item => item.id === id)) fail("conflict", "Personal agent identity collision");
        return { grants: [...current.grants, grant], result: { agent: publicPersonalAgent(grant), token } };
      }) as Awaited<ReturnType<PersonalWorkspaceStore["createAgent"]>>;
    },
    async listAgents(owner) { return (await activeEnvelope(owner)).grants.map(publicPersonalAgent); },
    async revokeAgent(owner, id) {
      if (typeof id !== "string" || !PERSONAL_AGENT_ID.test(id)) fail("invalid_input", "Invalid personal agent ID");
      return await mutate(owner, current => {
        const grant = current.grants.find(item => item.id === id);
        if (!grant) return { result: false, skip: true };
        grant.revoked = true; return { grants: current.grants, result: true };
      }) as boolean;
    },
    async snapshotForAgent(token) {
      const auth = await credential(token); const first = await activeEnvelope(auth.owner);
      const grant = authorized(first.grants, auth); const result = personalAgentSnapshot(auth.owner, first.state, publicPersonalAgent(grant));
      const latest = await activeEnvelope(auth.owner); authorized(latest.grants, auth); return result;
    },
    async commandForAgent(token, input) {
      const auth = await credential(token);
      return mutate(auth.owner, async current => {
        const grant = publicPersonalAgent(authorized(current.grants, auth));
        if (!isCalendarIcalImport(input)) return applyPersonalAgentCommand(auth.owner, current.state, grant, input);
        const next = await applyCalendarIcalImport(auth.owner, current.state, input, grant, now());
        return { ...next, ...(next.state ? { state: validatePersonalWorkspace(auth.owner, next.state) } : {}) };
      }, auth);
    },
    async removeAllForUser(owner) {
      assertPersonalWorkspaceOwner(owner);
      for (let attempt = 0; attempt < 3; attempt++) {
        const existing = await read(owner); if (!existing) return 0;
        try { await commit([{ delete: existing.name, currentDocument: { updateTime: existing.updateTime } }]); return 1; }
        catch (error) { if (!concurrent(error)) throw error; }
      }
      return fail("conflict", "Personal workspace cleanup changed concurrently; retry cleanup");
    },
  };
}
