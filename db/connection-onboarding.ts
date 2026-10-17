import { createFirestoreRestClient, FirestoreRequestError, type FirebaseConfig, type FirestoreDocument } from './firestore-rest.ts';
import { activeUserHistoryWrite, assertActiveUser } from './user-history.ts';
import { connectionFail, validateConnectionBindings, type ConnectionBinding } from '../shared/connection-onboarding.ts';
export type ConnectionOnboardingStore = {
  read(owner: string): Promise<ConnectionBinding[]>;
  change(owner: string, apply: (rows: ConnectionBinding[]) => ConnectionBinding[]): Promise<ConnectionBinding[]>;
};
/** Bounded lifecycle metadata/cleanup intent. No credential values or crypto. */
export function createConnectionOnboardingStore(config: FirebaseConfig, transport: typeof fetch = fetch): ConnectionOnboardingStore {
  const db = createFirestoreRestClient(config, transport);
  const path = (owner: string) => { if (!/^user_[a-f0-9]{32}$/.test(owner)) connectionFail(); return `v1ConnectionOnboarding/${owner}`; };
  async function read(owner: string) {
    await assertActiveUser(db, owner); const location = path(owner);
    const response = await db.request(location, {}, { allowNotFound: true });
    const doc = response.status === 404 ? null : await response.json() as FirestoreDocument;
    if (doc && (doc.name !== db.documentName(location) || !doc.updateTime || doc.fields?.ownerUserId?.stringValue !== owner)) connectionFail('invalid_state');
    const rows = validateConnectionBindings(doc ? JSON.parse(doc.fields?.bindingsJson?.stringValue ?? 'null') : [], owner);
    await assertActiveUser(db, owner); return { doc, rows };
  }
  return {
    async read(owner) { return (await read(owner)).rows; },
    async change(owner, apply) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const { doc, rows } = await read(owner), next = validateConnectionBindings(apply(rows), owner);
        const update = { name: db.documentName(path(owner)), fields: { ownerUserId: { stringValue: owner }, bindingsJson: { stringValue: JSON.stringify(next) } } };
        if (JSON.stringify(update).length > 100000) connectionFail('capacity');
        try {
          await db.request(':commit', { method: 'POST', body: JSON.stringify({ writes: [await activeUserHistoryWrite(db, owner), { update, currentDocument: doc ? { updateTime: doc.updateTime } : { exists: false } }] }) });
          return next;
        } catch (error) { if (!(error instanceof FirestoreRequestError) || !['ABORTED', 'ALREADY_EXISTS', 'FAILED_PRECONDITION', 'NOT_FOUND'].includes(error.code ?? '')) throw error; }
      }
      return connectionFail('conflict');
    },
  };
}
