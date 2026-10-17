import { createFirestoreRestClient, FirestoreRequestError, type FirebaseConfig, type FirestoreDocument } from './firestore-rest.ts';
import { activeUserHistoryWrite, assertActiveUser } from './user-history.ts';
import { validateWorkspace, workspaceFail, type OwnedWorkspace } from '../shared/owned-workspaces.ts';

/** Stable reference to retained Personal data. No copy, rekey, sign-in link or grant. */
export function createPersonalWorkspaceContextStore(config: FirebaseConfig, transport: typeof fetch = fetch) {
  const db = createFirestoreRestClient(config, transport);
  const path = (owner: string) => { if (!/^user_[a-f0-9]{32}$/.test(owner)) workspaceFail(); return `v1PersonalWorkspaceContexts/${owner}`; };
  async function read(owner: string) {
    const response = await db.request(path(owner), {}, { allowNotFound: true }); if (response.status === 404) return null;
    const document = await response.json() as FirestoreDocument;
    if (document.name !== db.documentName(path(owner)) || !document.updateTime || document.fields?.ownerUserId?.stringValue !== owner) workspaceFail('invalid_state');
    const workspace = validateWorkspace(JSON.parse(document.fields?.workspaceJson?.stringValue ?? 'null'));
    if (workspace.ownerUserId !== owner) workspaceFail('invalid_state'); return workspace;
  }
  return {
    async find(owner: string) { await assertActiveUser(db, owner); const value = await read(owner); await assertActiveUser(db, owner); return value; },
    async ensure(owner: string) {
      await assertActiveUser(db, owner); const existing = await read(owner); if (existing) { await assertActiveUser(db, owner); return existing; }
      const uuid = () => crypto.randomUUID().replaceAll('-', '');
      const workspace: OwnedWorkspace = validateWorkspace({ workspaceId: `wsp_${uuid()}`, ownerUserId: owner, name: 'Personal (retained)', createdAt: new Date().toISOString(), taskSpaceId: `tsp_${uuid()}`, calendarId: `cal_${uuid()}` });
      try {
        await db.request(':commit', { method: 'POST', body: JSON.stringify({ writes: [await activeUserHistoryWrite(db, owner), { update: { name: db.documentName(path(owner)), fields: { ownerUserId: { stringValue: owner }, workspaceJson: { stringValue: JSON.stringify(workspace) } } }, currentDocument: { exists: false } }] }) });
        return workspace;
      } catch (error) {
        if (!(error instanceof FirestoreRequestError) || !['ABORTED', 'ALREADY_EXISTS', 'FAILED_PRECONDITION'].includes(error.code ?? '')) throw error;
        const current = await read(owner); if (!current) workspaceFail('conflict'); await assertActiveUser(db, owner); return current;
      }
    },
  };
}
export type PersonalWorkspaceContextStore = ReturnType<typeof createPersonalWorkspaceContextStore>;
