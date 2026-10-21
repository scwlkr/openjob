import { createFirestoreRestClient, FirestoreRequestError, type FirebaseConfig, type FirestoreDocument } from './firestore-rest.ts';
import { activeUserHistoryWrite, assertActiveUser } from './user-history.ts';
import { workspaceOwnerFences } from './workspace-owner-fence.ts';
import { createDurableOperationRepository, type AtomicWrite } from './durable-operations.ts';
import { CALENDAR_OPERATION_ID, managedCalendarEventId, validateFrozenCalendarMutation, type FrozenCalendarMutation } from '../shared/calendar-mutation.ts';
import { calendarPlanInput, calendarPlanIdentity, storedCalendarOperation, calendarOperationView, calendarOperationReceipt, parseRemotePlanningLinks, remotePlanningView, assertRemotePlanningProjection, type CalendarOperationReceipt, type StoredCalendarOperation, type StoredRemotePlanningLink, type CalendarPlanInput, type CalendarOperationView } from '../shared/remote-planning.ts';
import { calendarFail, remoteCalendarEventRef } from '../shared/provider-calendar.ts';
import { validateOperationJob } from '../shared/reply-operation.ts';
import { validateOwnedSnapshot, validateWorkspace } from '../shared/owned-workspaces.ts';
import { validatePersonalWorkspace } from '../shared/personal-workspace.ts';
import { projectTaskCalendar } from '../shared/task-calendar-sync.ts';

type Db = ReturnType<typeof createFirestoreRestClient>;
async function read(db: Db, path: string) {
  const response = await db.request(path, {}, { allowNotFound: true }); if (response.status === 404) return null;
  const document = await response.json() as FirestoreDocument;
  if (document.name !== db.documentName(path) || !document.updateTime) calendarFail('invalid_state'); return document;
}
async function home(db: Db, owner: string, workspace: string) {
  const fences = await workspaceOwnerFences(db, owner, workspace);
  let doc = await read(db, `v1OwnedWorkspaces/${workspace}`), work;
  if (doc) {
    if (doc.fields?.ownerUserId?.stringValue !== owner) calendarFail('forbidden');
    const snapshot = validateOwnedSnapshot(JSON.parse(doc.fields?.snapshotJson?.stringValue ?? 'null'));
    if (snapshot.workspace.workspaceId !== workspace || snapshot.workspace.ownerUserId !== owner) calendarFail('forbidden'); work = snapshot.work;
  } else {
    const context = await read(db, `v1PersonalWorkspaceContexts/${owner}`);
    if (!context || context.fields?.ownerUserId?.stringValue !== owner) calendarFail('forbidden');
    const selected = validateWorkspace(JSON.parse(context.fields?.workspaceJson?.stringValue ?? 'null'));
    if (selected.workspaceId !== workspace || selected.ownerUserId !== owner) calendarFail('forbidden');
    doc = await read(db, `v1PersonalWorkspaces/${owner}`);
    if (!doc || doc.fields?.ownerUserId?.stringValue !== owner) calendarFail('forbidden');
    work = projectTaskCalendar(owner, validatePersonalWorkspace(owner, JSON.parse(doc.fields?.stateJson?.stringValue ?? 'null')));
  }
  if (doc.fields?.remotePlanningJson && typeof doc.fields.remotePlanningJson.stringValue !== 'string') calendarFail('invalid_state');
  const links = parseRemotePlanningLinks(doc.fields?.remotePlanningJson?.stringValue);
  if (links.some(row => row.payload.ownerId !== owner || row.payload.workspaceId !== workspace)) calendarFail('invalid_state');
  assertRemotePlanningProjection(links, work);
  return { doc, work, links, fences };
}
function update(doc: FirestoreDocument, links: StoredRemotePlanningLink[]): AtomicWrite {
  const rows = parseRemotePlanningLinks(JSON.stringify(links)), fields = { ...doc.fields, remotePlanningJson: { stringValue: JSON.stringify(rows) } };
  if (new TextEncoder().encode(JSON.stringify(fields)).length > 898_000) calendarFail('workspace_capacity');
  return { update: { name: doc.name, fields }, currentDocument: { updateTime: doc.updateTime } };
}
function sameIdentity(a: FrozenCalendarMutation, b: FrozenCalendarMutation) {
  return ['ownerId', 'workspaceId', 'taskId', 'accountId', 'connectionId', 'subject', 'bindingRevision', 'calendarId', 'upstreamEventId'].every(key => a[key as keyof FrozenCalendarMutation] === b[key as keyof FrozenCalendarMutation]) && JSON.stringify(a.origin) === JSON.stringify(b.origin);
}
async function assertPayload(owner: string, workspace: string, input: CalendarPlanInput, payload: FrozenCalendarMutation) {
  if (payload.ownerId !== owner || payload.workspaceId !== workspace || payload.taskId !== input.taskId || payload.action !== input.action || payload.upstreamEventId !== await managedCalendarEventId(owner, workspace, input.taskId, payload.origin)) calendarFail();
  if (input.action === 'calendar.create' && (payload.calendarId !== input.calendarId || payload.accountId !== input.accountId)) calendarFail();
  if (input.action !== 'calendar.create' && (payload.action === 'calendar.create' || input.etag !== payload.etag)) calendarFail();
  if (input.action !== 'calendar.delete' && (payload.action === 'calendar.delete' || input.title !== payload.title || JSON.stringify(input.span) !== JSON.stringify(payload.span))) calendarFail();
}
export function createCalendarPlanningRepository(config: FirebaseConfig, transport: typeof fetch, { now = Date.now }: { now?: () => number } = {}) {
  const db = createFirestoreRestClient(config, transport);
  const operations = createDurableOperationRepository<CalendarPlanInput, FrozenCalendarMutation, StoredCalendarOperation, CalendarOperationView, CalendarOperationReceipt>(config, transport, {
    namespace: 'v1FixtureCalendar', idPattern: CALENDAR_OPERATION_ID, idPrefix: 'cop_',
    input: calendarPlanInput, payload: validateFrozenCalendarMutation, record: storedCalendarOperation, job: validateOperationJob,
    identity: calendarPlanIdentity, view: calendarOperationView, assertPayload,
    async verifyPayload(op, payload) {
      const common = { taskId: op.taskId, requestId: op.requestId };
      const input = calendarPlanInput(payload.action === 'calendar.create' ? { ...common, action: payload.action, accountId: payload.accountId, calendarId: payload.calendarId, title: payload.title, span: payload.span } : payload.action === 'calendar.update' ? { ...common, action: payload.action, etag: payload.etag, title: payload.title, span: payload.span } : { ...common, action: payload.action, etag: payload.etag });
      await assertPayload(op.ownerUserId, op.workspaceId, input, payload);
      if (op.calendarId !== payload.calendarId || op.eventId !== remoteCalendarEventRef(payload.calendarId, payload.upstreamEventId) || (await calendarPlanIdentity(op.ownerUserId, op.workspaceId, input)).requestHash !== op.requestHash) calendarFail('invalid_state');
    },
    initial: (base, _input, payload) => storedCalendarOperation({ ...base, calendarId: payload.calendarId, eventId: remoteCalendarEventRef(payload.calendarId, payload.upstreamEventId) }),
    finished: (op, state, outcome, updatedAt, receipt?: CalendarOperationReceipt) => storedCalendarOperation({ ...op, state, outcome, updatedAt, ...(receipt ? { receipt: calendarOperationReceipt(receipt) } : {}) }),
    async enqueueWrites(client, op, payload) {
      const current = await home(client, op.ownerUserId, op.workspaceId), task = current.work.tasks.find(row => row.id === op.taskId), previous = current.links.find(row => row.taskId === op.taskId);
      if (!task || task.calendarEventId || task.scheduledSlot) calendarFail('remote_plan_active');
      if (payload.action === 'calendar.create') {
        if (previous) calendarFail('remote_plan_active');
        if (task.title !== payload.title) calendarFail('conflict');
      } else if (!previous || previous.state !== 'linked' || !previous.confirmed || previous.confirmed.etag !== payload.etag || !sameIdentity(previous.payload, payload)) calendarFail('review_required');
      const link: StoredRemotePlanningLink = { taskId: op.taskId, operationId: op.id, payload, state: 'reserved', confirmed: previous?.confirmed ?? null };
      return [update(current.doc, [...current.links.filter(row => row.taskId !== op.taskId), link])];
    },
    async finishWrites(client, next, previous) {
      let current; try { current = await home(client, next.ownerUserId, next.workspaceId); }
      catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'forbidden') return []; throw error; }
      const row = current.links.find(row => row.taskId === next.taskId);
      if (!row || row.operationId !== next.id) return [];
      const others = current.links.filter(item => item !== row);
      const contextFences = current.fences.filter(fence => fence.verify !== current.doc.name);
      // Definite create denials can release the reservation. A duplicate-ID
      // conflict may refer to an existing event, so it still needs review.
      if (next.action === 'calendar.create' && next.state === 'rejected' && (previous.state === 'queued' || next.outcome !== 'provider_conflict')) return [...contextFences, update(current.doc, others)];
      if (next.state === 'confirmed' && next.receipt && 'deleted' in next.receipt) return [...contextFences, update(current.doc, others)];
      const link: StoredRemotePlanningLink = { ...row, state: next.state === 'confirmed' ? 'linked' : next.state === 'unknown' ? 'unknown' : 'review_required', confirmed: next.receipt && 'block' in next.receipt ? next.receipt.block : row.confirmed };
      return [...contextFences, update(current.doc, [...others, link])];
    },
  }, { now });
  return {
    ...operations,
    async assertOwned(owner: string, workspace: string) { await assertActiveUser(db, owner); await home(db, owner, workspace); await assertActiveUser(db, owner); },
    async planning(owner: string, workspace: string) { await assertActiveUser(db, owner); const current = await home(db, owner, workspace); await assertActiveUser(db, owner); return current.links.map(remotePlanningView); },
    async selectedLink(owner: string, workspace: string, task: string) { await assertActiveUser(db, owner); const current = await home(db, owner, workspace); await assertActiveUser(db, owner); return current.links.find(row => row.taskId === task); },
    async review(owner: string, workspace: string, task: string, operationId: string, receipt: CalendarOperationReceipt, currentAuthority: () => Promise<void>) {
      const checked = calendarOperationReceipt(receipt);
      const operation = await operations.get(owner, workspace, operationId);
      if (operation.taskId !== task || ['queued', 'executing'].includes(operation.state)) calendarFail('conflict');
      for (let attempt = 0; attempt < 3; attempt++) {
        await assertActiveUser(db, owner); const current = await home(db, owner, workspace), row = current.links.find(row => row.taskId === task);
        if (!row || row.operationId !== operationId) calendarFail('conflict');
        if ('block' in checked && checked.block.eventId !== remoteCalendarEventRef(row.payload.calendarId, row.payload.upstreamEventId)) calendarFail('invalid_state');
        const links = current.links.filter(item => item !== row);
        if ('block' in checked) links.push({ ...row, state: 'linked', confirmed: checked.block });
        const write = update(current.doc, links), fences = current.fences.filter(fence => fence.verify !== current.doc.name);
        try { await currentAuthority(); await db.request(':commit', { method: 'POST', body: JSON.stringify({ writes: [await activeUserHistoryWrite(db, owner), ...fences, write] }) }); return links.map(remotePlanningView); }
        catch (error) { if (!(error instanceof FirestoreRequestError) || !['ABORTED', 'FAILED_PRECONDITION'].includes(error.code ?? '')) throw error; }
      }
      return calendarFail('conflict');
    },
  };
}
export type CalendarPlanningRepository = ReturnType<typeof createCalendarPlanningRepository>;
