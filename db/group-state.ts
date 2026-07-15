import type { FirestoreDocument } from "./firestore-rest.ts";

export function readGroupStateRevision(document: FirestoreDocument) {
  const revision = Number(document.fields?.stateRevision?.integerValue ?? 0);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("Firestore returned an invalid Group state revision.");
  }
  return revision;
}

export function advanceGroupStateRevisionWrite({
  documentName,
  revision,
  updateTime,
}: {
  documentName: string;
  revision: number;
  updateTime: string;
}) {
  if (
    !documentName ||
    !updateTime ||
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    revision === Number.MAX_SAFE_INTEGER
  ) {
    throw new Error("Firestore returned an invalid Group state revision.");
  }
  return {
    update: {
      name: documentName,
      fields: {
        stateRevision: { integerValue: String(revision + 1) },
      },
    },
    updateMask: { fieldPaths: ["stateRevision"] },
    currentDocument: { updateTime },
  };
}
