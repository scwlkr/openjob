import {
  createFirestoreRestClient,
  FirestoreRequestError,
  type FirebaseConfig,
  type FirestoreDocument,
} from "./firestore-rest.ts";

export type OpenJobUser = {
  userId: string;
  username: string | null;
};

type StoredUser = OpenJobUser & {
  path: string;
  updateTime: string;
};

type UserStoreOptions = {
  now?: () => number;
  randomUUID?: () => string;
};

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function firebaseIdentityKey(firebaseUid: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(firebaseUid),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

function parseUser(document: FirestoreDocument, path: string): StoredUser {
  const userId = document.fields?.userId?.stringValue;
  const username = document.fields?.username?.stringValue ?? null;
  if (!userId || !document.updateTime) {
    throw new Error("Firestore returned an invalid User record.");
  }
  return { path, updateTime: document.updateTime, userId, username };
}

function publicUser(user: StoredUser): OpenJobUser {
  return { userId: user.userId, username: user.username };
}

function isConcurrentWrite(error: unknown) {
  return (
    error instanceof FirestoreRequestError &&
    ["ABORTED", "ALREADY_EXISTS", "FAILED_PRECONDITION"].includes(
      error.code ?? "",
    )
  );
}

export function createFirestoreUserStore(
  config: FirebaseConfig,
  fetchImplementation: typeof fetch = fetch,
  {
    now = Date.now,
    randomUUID = crypto.randomUUID,
  }: UserStoreOptions = {},
) {
  const firestore = createFirestoreRestClient(config, fetchImplementation);

  async function readDocument(path: string) {
    const response = await firestore.request(
      path,
      {},
      { allowNotFound: true },
    );
    if (response.status === 404) return null;
    return (await response.json()) as FirestoreDocument;
  }

  async function userPath(firebaseUid: string) {
    return `v1Users/${await firebaseIdentityKey(firebaseUid)}`;
  }

  async function readUser(path: string) {
    const document = await readDocument(path);
    return document ? parseUser(document, path) : null;
  }

  async function commit(writes: unknown[]) {
    return firestore.request(":commit", {
      method: "POST",
      body: JSON.stringify({ writes }),
    });
  }

  async function getOrCreateStored(firebaseUid: string): Promise<StoredUser> {
    const path = await userPath(firebaseUid);
    const existing = await readUser(path);
    if (existing) return existing;

    const createdAt = new Date(now()).toISOString();
    const userId = `user_${randomUUID().replaceAll("-", "")}`;
    try {
      await commit([
        {
          update: {
            name: firestore.documentName(path),
            fields: {
              userId: { stringValue: userId },
              createdAt: { timestampValue: createdAt },
            },
          },
          currentDocument: { exists: false },
        },
      ]);
    } catch (error) {
      if (!isConcurrentWrite(error)) throw error;
    }

    const persisted = await readUser(path);
    if (!persisted) throw new Error("Firestore did not persist the User record.");
    return persisted;
  }

  return Object.freeze({
    async getOrCreate(firebaseUid: string) {
      return publicUser(await getOrCreateStored(firebaseUid));
    },

    async claimUsername(firebaseUid: string, username: string) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const user = await getOrCreateStored(firebaseUid);
        if (user.username === username) {
          return { kind: "claimed" as const, user: publicUser(user) };
        }
        if (user.username !== null) return { kind: "immutable" as const };

        const usernamePath = `v1Usernames/${username}`;
        const claimedAt = new Date(now()).toISOString();
        try {
          await commit([
            {
              update: {
                name: firestore.documentName(usernamePath),
                fields: {
                  userId: { stringValue: user.userId },
                  claimedAt: { timestampValue: claimedAt },
                },
              },
              currentDocument: { exists: false },
            },
            {
              update: {
                name: firestore.documentName(user.path),
                fields: { username: { stringValue: username } },
              },
              updateMask: { fieldPaths: ["username"] },
              currentDocument: { updateTime: user.updateTime },
            },
          ]);
          return {
            kind: "claimed" as const,
            user: { ...publicUser(user), username },
          };
        } catch (error) {
          if (!isConcurrentWrite(error)) throw error;
          const current = await readUser(user.path);
          if (current?.username === username) {
            return { kind: "claimed" as const, user: publicUser(current) };
          }
          if (current?.username) return { kind: "immutable" as const };
          if (await readDocument(usernamePath)) return { kind: "taken" as const };
        }
      }
      throw new Error("Username claim could not be resolved after concurrent writes.");
    },
  });
}
