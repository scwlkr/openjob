import type { FirestoreDocument } from "./firestore-rest.ts";

type FirestoreUserFenceClient = {
  documentName(path: string): string;
  request(
    path: string,
    init?: RequestInit,
    options?: { allowNotFound?: boolean },
  ): Promise<Response>;
};

export class InactiveUserError extends Error {
  readonly userId: string;

  constructor(userId: string) {
    super("The User is no longer active.");
    this.name = "InactiveUserError";
    this.userId = userId;
  }
}

export function isInactiveUserError(
  error: unknown,
): error is InactiveUserError {
  return error instanceof InactiveUserError;
}

function isActiveUserDocument(
  document: FirestoreDocument,
  expectedName: string,
  userId: string,
) {
  const fields = document.fields ?? {};
  return (
    document.name === expectedName &&
    typeof document.updateTime === "string" &&
    fields.userId?.stringValue === userId &&
    !Object.hasOwn(fields, "deletionState") &&
    !Object.hasOwn(fields, "deletionRequestId") &&
    !Object.hasOwn(fields, "deletionStartedAt") &&
    !Object.hasOwn(fields, "deletionDeadline") &&
    !Object.hasOwn(fields, "deletionIntentId")
  );
}

async function activeUserDocument(
  firestore: FirestoreUserFenceClient,
  userId: string,
) {
  const path = `v1UserDirectory/${userId}`;
  const name = firestore.documentName(path);
  const response = await firestore.request(path, {}, { allowNotFound: true });
  if (response.status === 404) throw new InactiveUserError(userId);
  const document = (await response.json()) as FirestoreDocument;
  if (!isActiveUserDocument(document, name, userId)) {
    throw new InactiveUserError(userId);
  }
  return document;
}

export async function assertActiveUser(
  firestore: FirestoreUserFenceClient,
  userId: string,
) {
  await activeUserDocument(firestore, userId);
}

export async function isActiveUser(
  firestore: FirestoreUserFenceClient,
  userId: string,
) {
  try {
    await activeUserDocument(firestore, userId);
    return true;
  } catch (error) {
    if (isInactiveUserError(error)) return false;
    throw error;
  }
}

export async function activeUserFenceWrite(
  firestore: FirestoreUserFenceClient,
  userId: string,
) {
  const document = await activeUserDocument(firestore, userId);
  return {
    verify: document.name,
    currentDocument: { updateTime: document.updateTime },
  };
}

export async function activeUserHistoryWrite(
  firestore: FirestoreUserFenceClient,
  userId: string,
) {
  const document = await activeUserDocument(firestore, userId);
  return {
    update: {
      name: document.name,
      fields: {
        emptyShellEligible: { booleanValue: false },
      },
    },
    updateMask: { fieldPaths: ["emptyShellEligible"] },
    currentDocument: { updateTime: document.updateTime },
  };
}
