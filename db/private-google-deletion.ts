import { FirestoreRequestError, type createFirestoreRestClient, type FirestoreDocument } from './firestore-rest.ts';
import { connectionFail } from '../shared/connection-onboarding.ts';

type Options = { db: ReturnType<typeof createFirestoreRestClient>; executionMode?: string };
/** Key-free worker dependency. No scheduler, provider revoke or runtime activation. */
export function createPrivateGoogleDeletionCleanup({ db, executionMode = 'disabled' }: Options) {
  if (!['disabled', 'configured'].includes(executionMode)) connectionFail('not_configured');
  const concurrent = (error: unknown) => error instanceof FirestoreRequestError && ['ABORTED', 'ALREADY_EXISTS', 'FAILED_PRECONDITION', 'NOT_FOUND'].includes(error.code ?? '');
  async function remove(owner: string, requestId: string) {
    if (!/^user_[a-f0-9]{32}$/.test(owner) || typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(requestId)) connectionFail('invalid_input');
    const userPath = `v1UserDirectory/${owner}`;
    // Personal home is only a reference; retained Tasks/Calendar cleanup belongs to
    // the existing Personal store. Disconnect preserves this home; deletion removes it.
    const paths = [`v1PrivateGoogleConnections/${owner}`, `v1PersonalWorkspaceContexts/${owner}`];
    for (let attempt = 0; attempt < 3; attempt++) {
      const userResponse = await db.request(userPath, {}, { allowNotFound: true });
      if (userResponse.status === 404) connectionFail('forbidden');
      const user = await userResponse.json() as FirestoreDocument;
      if (user.name !== db.documentName(userPath) || !user.updateTime || user.fields?.userId?.stringValue !== owner || user.fields.deletionState?.stringValue !== 'pending' || user.fields.deletionRequestId?.stringValue !== requestId) connectionFail('forbidden');
      const documents: FirestoreDocument[] = [];
      for (const path of paths) {
        const response = await db.request(path, {}, { allowNotFound: true });
        if (response.status === 404) continue;
        const doc = await response.json() as FirestoreDocument;
        if (doc.name !== db.documentName(path) || !doc.updateTime) connectionFail('invalid_state');
        documents.push(doc);
      }
      if (!documents.length) return false;
      try {
        await db.request(':commit', { method: 'POST', body: JSON.stringify({ writes: [
          { verify: user.name, currentDocument: { updateTime: user.updateTime } },
          ...documents.map(doc => ({ delete: doc.name, currentDocument: { updateTime: doc.updateTime } })),
        ] }) });
      } catch (error) { if (concurrent(error)) continue; throw error; }
      return true;
    }
    return connectionFail('conflict');
  }
  return {
    async removeForDeletion(owner: string, requestId: string) {
      if (executionMode !== 'configured') connectionFail('not_configured');
      try { return await remove(owner, requestId); }
      catch (error) {
        const code = (error as { code?: string })?.code;
        return connectionFail(code && ['invalid_input', 'invalid_state', 'forbidden', 'conflict'].includes(code) ? code : 'unavailable');
      }
    },
  };
}
