import { createFirestoreRestClient, FirestoreRequestError, type FirebaseConfig, type FirestoreDocument } from './firestore-rest.ts';
import { activeUserHistoryWrite, assertActiveUser } from './user-history.ts';
import { assertTaskSlotAvailable } from '../shared/workspace-availability.ts';
import { applyTaskCalendarCommand, type TaskCalendarCommand } from '../shared/task-calendar-sync.ts';
import { WORKSPACE_ID, validateWorkspace, validateOwnedSnapshot, workspaceFail, type OwnedWorkspace, type OwnedWorkspaceSnapshot } from '../shared/owned-workspaces.ts';

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
    async command(owner: string, id: string, input: unknown) {
      ownerId(owner);
      for (let attempt = 0; attempt < 3; attempt++) {
        await assertActiveUser(db, owner); const previous = await read(workPath(id)); const snapshot = decode(previous, owner);
        // The existing pure Task/Calendar engine rejects all Mail, source-link and agent commands.
        const available = !!input && typeof input === 'object' && (input as { type?: string }).type === 'task.schedule-available';
        const normalized = available ? { ...input as object, type: 'task.schedule' } : input;
        const work = applyTaskCalendarCommand(snapshot.work, normalized as TaskCalendarCommand, owner, () => `offline_${crypto.randomUUID()}`);
        if (available) { const task = work.tasks.find(item => item.id === (input as { taskId: string }).taskId)!; assertTaskSlotAvailable({ ...snapshot.work, accounts: [], messages: [], drafts: [], sent: [], agents: [], activity: [] }, { taskId: task.id, ...task.scheduledSlot! }); }
        const result = validateOwnedSnapshot({ workspace: snapshot.workspace, work });
        try { await commit(owner, [update(workPath(id), { ownerUserId: { stringValue: owner }, snapshotJson: { stringValue: JSON.stringify(result) } }, previous)]); return result; }
        catch (error) { if (!retryable(error)) throw error; }
      }
      return workspaceFail('conflict');
    },
  };
}
export type OwnedWorkspaceStore = ReturnType<typeof createOwnedWorkspaceStore>;
