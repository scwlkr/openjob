import {
  bytesToBase64Url,
  createFirestoreRestClient,
  FirestoreRequestError,
  type FirebaseConfig,
  type FirestoreDocument,
} from "./firestore-rest.ts";
import type { OpenJobUser, Username } from "../server/v1-identity.ts";

type StoredUser = OpenJobUser & {
  path: string;
  updateTime: string;
};

type StoredUserDirectory = OpenJobUser & {
  path: string;
  updateTime: string;
};

type UserStoreOptions = {
  now?: () => number;
  randomUUID?: () => string;
};

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

function parseUserDirectory(
  document: FirestoreDocument,
  path: string,
): StoredUserDirectory {
  const userId = document.fields?.userId?.stringValue;
  const username = document.fields?.username?.stringValue ?? null;
  if (!userId || !document.updateTime) {
    throw new Error("Firestore returned an invalid User directory record.");
  }
  return { path, updateTime: document.updateTime, userId, username };
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
    randomUUID = () => crypto.randomUUID(),
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

  function userDirectoryPath(userId: string) {
    return `v1UserDirectory/${userId}`;
  }

  async function readUserDirectory(userId: string) {
    const path = userDirectoryPath(userId);
    const document = await readDocument(path);
    return document ? parseUserDirectory(document, path) : null;
  }

  async function commit(writes: unknown[]) {
    return firestore.request(":commit", {
      method: "POST",
      body: JSON.stringify({ writes }),
    });
  }

  function userDirectoryFields(user: OpenJobUser) {
    return {
      userId: { stringValue: user.userId },
      ...(user.username ? { username: { stringValue: user.username } } : {}),
    };
  }

  async function ensureUserDirectory(user: StoredUser) {
    const existing = await readUserDirectory(user.userId);
    if (existing) return existing;
    const path = userDirectoryPath(user.userId);
    try {
      await commit([
        {
          update: {
            name: firestore.documentName(path),
            fields: userDirectoryFields(user),
          },
          currentDocument: { exists: false },
        },
      ]);
    } catch (error) {
      if (!isConcurrentWrite(error)) throw error;
    }
    const persisted = await readUserDirectory(user.userId);
    if (!persisted) {
      throw new Error("Firestore did not persist the User directory record.");
    }
    return persisted;
  }

  async function getOrCreateStored(firebaseUid: string): Promise<StoredUser> {
    const path = await userPath(firebaseUid);
    const existing = await readUser(path);
    if (existing) {
      await ensureUserDirectory(existing);
      return existing;
    }

    const createdAt = new Date(now()).toISOString();
    const userId = `user_${randomUUID().replaceAll("-", "")}`;
    const directoryPath = userDirectoryPath(userId);
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
        {
          update: {
            name: firestore.documentName(directoryPath),
            fields: userDirectoryFields({ userId, username: null }),
          },
          currentDocument: { exists: false },
        },
      ]);
    } catch (error) {
      if (!isConcurrentWrite(error)) throw error;
    }

    const persisted = await readUser(path);
    if (!persisted) throw new Error("Firestore did not persist the User record.");
    await ensureUserDirectory(persisted);
    return persisted;
  }

  return Object.freeze({
    async getById(userId: string) {
      const user = await readUserDirectory(userId);
      return user ? { userId: user.userId, username: user.username } : null;
    },

    async getByUsername(username: Username) {
      const claim = await readDocument(`v1Usernames/${username}`);
      if (!claim) return null;
      const userId = claim.fields?.userId?.stringValue;
      if (!userId) {
        throw new Error("Firestore returned an invalid Username claim record.");
      }
      const user = await readUserDirectory(userId);
      if (!user || user.username !== username) {
        throw new Error("Firestore returned an inconsistent Username claim record.");
      }
      return { userId: user.userId, username: user.username };
    },

    async getOrCreate(firebaseUid: string) {
      return publicUser(await getOrCreateStored(firebaseUid));
    },

    async claimUsername(firebaseUid: string, username: Username) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const user = await getOrCreateStored(firebaseUid);
        if (user.username === username) {
          return { kind: "claimed" as const, user: publicUser(user) };
        }
        if (user.username !== null) return { kind: "immutable" as const };

        const usernamePath = `v1Usernames/${username}`;
        const claimedAt = new Date(now()).toISOString();
        const directory = await ensureUserDirectory(user);
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
            {
              update: {
                name: firestore.documentName(directory.path),
                fields: { username: { stringValue: username } },
              },
              updateMask: { fieldPaths: ["username"] },
              currentDocument: { updateTime: directory.updateTime },
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
