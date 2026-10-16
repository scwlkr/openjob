import { createFirestoreRestClient, FirestoreRequestError, type FirebaseConfig, type FirestoreDocument } from "./firestore-rest.ts";
import { activeUserHistoryWrite, assertActiveUser } from "./user-history.ts";
import { applyPersonalWorkspaceCommand, assertPersonalWorkspaceOwner, createEmptyPersonalWorkspace, validatePersonalWorkspace, type PersonalWorkspaceStore } from "../shared/personal-workspace.ts";

const MAX_ENCODED_BYTES = 900_000;
function fail(code: string, message: string): never { throw Object.assign(new Error(message), { code }); }
function concurrent(error: unknown) { return error instanceof FirestoreRequestError && ["ABORTED", "ALREADY_EXISTS", "FAILED_PRECONDITION", "NOT_FOUND"].includes(error.code ?? ""); }

export function createFirestorePersonalWorkspaceStore(config: FirebaseConfig, fetchImplementation: typeof fetch = fetch): PersonalWorkspaceStore {
  const firestore = createFirestoreRestClient(config, fetchImplementation);
  const path = (owner: string) => { assertPersonalWorkspaceOwner(owner); return `v1PersonalWorkspaces/${owner}`; };
  async function read(owner: string) {
    const response = await firestore.request(path(owner), {}, { allowNotFound: true });
    if (response.status === 404) return null;
    const document = await response.json() as FirestoreDocument;
    if (document.name !== firestore.documentName(path(owner)) || !document.updateTime || document.fields?.ownerUserId?.stringValue !== owner) fail("invalid_state", "Invalid personal workspace record");
    return document;
  }
  function state(owner: string, document: FirestoreDocument | null) {
    if (!document) return createEmptyPersonalWorkspace(owner);
    const encoded = document.fields?.stateJson?.stringValue;
    if (!encoded || new TextEncoder().encode(JSON.stringify(document)).length > MAX_ENCODED_BYTES) fail("invalid_state", "Invalid personal workspace record");
    let value: unknown;
    try { value = JSON.parse(encoded); } catch { fail("invalid_state", "Invalid personal workspace record"); }
    return validatePersonalWorkspace(owner, value);
  }
  async function commit(writes: unknown[]) { await firestore.request(":commit", { method: "POST", body: JSON.stringify({ writes }) }); }
  return {
    async snapshot(owner) {
      assertPersonalWorkspaceOwner(owner); await assertActiveUser(firestore, owner);
      const result = state(owner, await read(owner));
      await assertActiveUser(firestore, owner);
      return result;
    },
    async command(owner, input) {
      assertPersonalWorkspaceOwner(owner);
      for (let attempt = 0; attempt < 3; attempt++) {
        await assertActiveUser(firestore, owner);
        const existing = await read(owner);
        const next = applyPersonalWorkspaceCommand(owner, state(owner, existing), input);
        const update = { name: firestore.documentName(path(owner)), fields: { ownerUserId: { stringValue: owner }, stateJson: { stringValue: JSON.stringify(next.state) } } };
        if (new TextEncoder().encode(JSON.stringify(update)).length > MAX_ENCODED_BYTES - 1024) fail("workspace_capacity", "Personal workspace storage limit reached");
        try {
          await commit([await activeUserHistoryWrite(firestore, owner), { update, currentDocument: existing ? { updateTime: existing.updateTime } : { exists: false } }]);
          return next.result;
        } catch (error) { if (!concurrent(error)) throw error; }
      }
      return fail("conflict", "Personal workspace changed concurrently; retry the command");
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
