import type { FirestoreDocument } from './firestore-rest.ts';
import { validateOwnedSnapshot, validateWorkspace } from '../shared/owned-workspaces.ts';
import { operationFail } from '../shared/reply-operation.ts';
type Client = { documentName(path: string): string; request(path: string, init?: RequestInit, options?: { allowNotFound?: boolean }): Promise<Response> };
/** Verify both the selected ownership record and retained work revision in the commit. */
export async function workspaceOwnerFences(db: Client, owner: string, workspaceId: string) {
  if (!/^user_[a-f0-9]{32}$/.test(owner) || !/^wsp_[a-f0-9]{32}$/.test(workspaceId)) operationFail();
  async function read(path: string) {
    const response = await db.request(path, {}, { allowNotFound: true }); if (response.status === 404) return null;
    const doc = await response.json() as FirestoreDocument;
    if (doc.name !== db.documentName(path) || !doc.updateTime) operationFail('invalid_state'); return doc;
  }
  let records: FirestoreDocument[];
  const owned = await read(`v1OwnedWorkspaces/${workspaceId}`);
  if (owned) {
    if (owned.fields?.ownerUserId?.stringValue !== owner) operationFail('forbidden');
    const snapshot = validateOwnedSnapshot(JSON.parse(owned.fields?.snapshotJson?.stringValue ?? 'null'));
    if (snapshot.workspace.workspaceId !== workspaceId || snapshot.workspace.ownerUserId !== owner) operationFail('forbidden'); records = [owned];
  } else {
    const context = await read(`v1PersonalWorkspaceContexts/${owner}`);
    if (!context || context.fields?.ownerUserId?.stringValue !== owner) operationFail('forbidden');
    const workspace = validateWorkspace(JSON.parse(context.fields?.workspaceJson?.stringValue ?? 'null'));
    if (workspace.workspaceId !== workspaceId || workspace.ownerUserId !== owner) operationFail('forbidden');
    const personal = await read(`v1PersonalWorkspaces/${owner}`);
    if (!personal || personal.fields?.ownerUserId?.stringValue !== owner) operationFail('forbidden'); records = [context, personal];
  }
  return records.map(doc => ({ verify: doc.name, currentDocument: { updateTime: doc.updateTime } }));
}
