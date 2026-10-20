import { assertTaskNotesBase } from '../shared/task-notes-precondition.ts';
import { createFirestoreRestClient, FirestoreRequestError, type FirebaseConfig, type FirestoreDocument } from './firestore-rest.ts';
import { activeUserHistoryWrite, assertActiveUser } from './user-history.ts';
import { assertTaskSlotAvailable } from '../shared/workspace-availability.ts';
import { applyTaskCalendarCommand, type TaskCalendarCommand } from '../shared/task-calendar-sync.ts';
import { WORKSPACE_ID, validateWorkspace, validateOwnedSnapshot, workspaceFail, type OwnedWorkspace, type OwnedWorkspaceSnapshot } from '../shared/owned-workspaces.ts';
import { parseMailTaskSources, retainMailTaskSources, existingMailTask, type MailTaskReference, type MailTaskResult } from '../shared/mail-task-source.ts';

/** New owner-only Workspace repository; never reads/migrates Personal Mail aggregates. */
export function createOwnedWorkspaceStore(config: FirebaseConfig, transport: typeof fetch = fetch) {
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
  async function commit(owner: string, writes: unknown[]) { await db.request(':commit', { method: 'POST', body: JSON.stringify({ writes: [await activeUserHistoryWrite(db, owner), ...writes] }) }); }
  async function change(owner: string, id: string, input: unknown, guard?: { expectedNotes: unknown }, mail?: { source: MailTaskReference; current: () => Promise<void> }) {
    ownerId(owner);
    for (let attempt = 0; attempt < 3; attempt++) {
      await assertActiveUser(db, owner); const previous = await read(workPath(id)); const snapshot = decode(previous, owner);
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
      const fields = { ownerUserId: { stringValue: owner }, snapshotJson: { stringValue: JSON.stringify(result) }, mailSourcesJson: { stringValue: JSON.stringify(nextSources) } };
      if (new TextEncoder().encode(JSON.stringify(fields)).length > 898000) workspaceFail('workspace_capacity');
      try { await mail?.current(); await commit(owner, [update(workPath(id), fields, previous)]); return { snapshot: result, receipt }; }
      catch (error) { if (!retryable(error)) throw error; }
    }
    return workspaceFail('conflict');
  }
  return {
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
