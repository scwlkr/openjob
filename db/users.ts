import {
  bytesToBase64Url,
  createFirestoreRestClient,
  FirestoreRequestError,
  type FirebaseConfig,
  type FirestoreDocument,
} from "./firestore-rest.ts";
import type {
  FirebaseTokenIdentity,
  SignInProvider,
} from "../server/firebase-id-token.ts";
import type { OpenJobUser, Username } from "../server/v1-identity.ts";

type StoredUserDirectory = OpenJobUser & {
  emptyShellEligible: boolean;
  path: string;
  updateTime: string;
};

type StoredLegacyUser = OpenJobUser & {
  path: string;
  updateTime: string;
};

type StoredSignInMethod = {
  methodId: string;
  path: string;
  provider: SignInProvider;
  updateTime: string;
  userId: string;
};

type StoredProviderSlot = {
  methodId: string;
  path: string;
  provider: SignInProvider;
  updateTime: string;
  userId: string;
};

type UserStoreOptions = {
  now?: () => number;
  randomUUID?: () => string;
};

const MAX_CONCURRENT_ATTEMPTS = 3;

async function sha256Key(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

async function signInMethodKey(identity: FirebaseTokenIdentity) {
  return sha256Key(`${identity.provider}\0${identity.uid}`);
}

async function legacyFirebaseIdentityKey(firebaseUid: string) {
  return sha256Key(firebaseUid);
}

function parseProvider(value: unknown): SignInProvider | null {
  if (value === "apple" || value === "google") return value;
  return null;
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
  return {
    emptyShellEligible:
      document.fields?.emptyShellEligible?.booleanValue === true,
    path,
    updateTime: document.updateTime,
    userId,
    username,
  };
}

function parseLegacyUser(
  document: FirestoreDocument,
  path: string,
): StoredLegacyUser {
  const userId = document.fields?.userId?.stringValue;
  const username = document.fields?.username?.stringValue ?? null;
  if (!userId || !document.updateTime) {
    throw new Error("Firestore returned an invalid legacy User record.");
  }
  return { path, updateTime: document.updateTime, userId, username };
}

function parseSignInMethod(
  document: FirestoreDocument,
  path: string,
): StoredSignInMethod {
  const methodId = document.fields?.methodId?.stringValue;
  const provider = parseProvider(document.fields?.provider?.stringValue);
  const userId = document.fields?.userId?.stringValue;
  if (!methodId || !provider || !userId || !document.updateTime) {
    throw new Error("Firestore returned an invalid Sign-in Method record.");
  }
  return { methodId, path, provider, updateTime: document.updateTime, userId };
}

function parseProviderSlot(
  document: FirestoreDocument,
  path: string,
): StoredProviderSlot {
  const methodId = document.fields?.methodId?.stringValue;
  const provider = parseProvider(document.fields?.provider?.stringValue);
  const userId = document.fields?.userId?.stringValue;
  if (!methodId || !provider || !userId || !document.updateTime) {
    throw new Error("Firestore returned an invalid Sign-in Method index record.");
  }
  return { methodId, path, provider, updateTime: document.updateTime, userId };
}

function publicUser(user: StoredUserDirectory): OpenJobUser {
  return { userId: user.userId, username: user.username };
}

function isConcurrentWrite(error: unknown) {
  return (
    error instanceof FirestoreRequestError &&
    ["ABORTED", "ALREADY_EXISTS", "FAILED_PRECONDITION", "NOT_FOUND"].includes(
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

  async function readAllCollectionDocuments(path: string) {
    const documents: FirestoreDocument[] = [];
    let pageToken: string | null = null;
    do {
      const parameters = new URLSearchParams({
        orderBy: "__name__",
        pageSize: "500",
      });
      if (pageToken) parameters.set("pageToken", pageToken);
      const response = await firestore.request(`${path}?${parameters}`);
      const page = (await response.json()) as {
        documents?: FirestoreDocument[];
        nextPageToken?: string;
      };
      documents.push(...(page.documents ?? []));
      pageToken = page.nextPageToken ?? null;
    } while (pageToken);
    return documents;
  }

  async function commit(writes: unknown[]) {
    return firestore.request(":commit", {
      method: "POST",
      body: JSON.stringify({ writes }),
    });
  }

  function userDirectoryPath(userId: string) {
    return `v1UserDirectory/${userId}`;
  }

  function signInMethodPath(methodId: string) {
    return `v1SignInMethods/${methodId}`;
  }

  function providerSlotPath(userId: string, provider: SignInProvider) {
    return `v1UserSignInMethods/${userId}/providers/${provider}`;
  }

  async function legacyUserPath(firebaseUid: string) {
    return `v1Users/${await legacyFirebaseIdentityKey(firebaseUid)}`;
  }

  async function methodPath(identity: FirebaseTokenIdentity) {
    return signInMethodPath(await signInMethodKey(identity));
  }

  async function readUserDirectory(userId: string) {
    const path = userDirectoryPath(userId);
    const document = await readDocument(path);
    return document ? parseUserDirectory(document, path) : null;
  }

  async function readSignInMethod(path: string) {
    const document = await readDocument(path);
    return document ? parseSignInMethod(document, path) : null;
  }

  async function readProviderSlot(userId: string, provider: SignInProvider) {
    const path = providerSlotPath(userId, provider);
    const document = await readDocument(path);
    return document ? parseProviderSlot(document, path) : null;
  }

  async function readProviderSlots(userId: string) {
    const documents = await readAllCollectionDocuments(
      `v1UserSignInMethods/${userId}/providers`,
    );
    return documents.map((document) => {
      const marker = "/documents/";
      const markerIndex = document.name.indexOf(marker);
      const path =
        markerIndex === -1
          ? document.name
          : document.name.slice(markerIndex + marker.length);
      return parseProviderSlot(document, path);
    });
  }

  function userDirectoryFields(
    user: OpenJobUser,
    emptyShellEligible: boolean,
    createdAt?: string,
  ) {
    return {
      userId: { stringValue: user.userId },
      ...(user.username ? { username: { stringValue: user.username } } : {}),
      emptyShellEligible: { booleanValue: emptyShellEligible },
      ...(createdAt ? { createdAt: { timestampValue: createdAt } } : {}),
    };
  }

  function signInMethodFields({
    linkedAt,
    methodId,
    provider,
    userId,
  }: {
    linkedAt: string;
    methodId: string;
    provider: SignInProvider;
    userId: string;
  }) {
    return {
      methodId: { stringValue: methodId },
      provider: { stringValue: provider },
      userId: { stringValue: userId },
      linkedAt: { timestampValue: linkedAt },
    };
  }

  function providerSlotFields({
    linkedAt,
    methodId,
    provider,
    userId,
  }: {
    linkedAt: string;
    methodId: string;
    provider: SignInProvider;
    userId: string;
  }) {
    return {
      methodId: { stringValue: methodId },
      provider: { stringValue: provider },
      userId: { stringValue: userId },
      linkedAt: { timestampValue: linkedAt },
    };
  }

  async function ensureLegacyDirectory(user: StoredLegacyUser) {
    const existing = await readUserDirectory(user.userId);
    if (existing) return existing;
    const path = userDirectoryPath(user.userId);
    try {
      await commit([
        {
          update: {
            name: firestore.documentName(path),
            fields: userDirectoryFields(
              { userId: user.userId, username: user.username },
              false,
            ),
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

  async function migrateLegacyGoogleIdentity(identity: FirebaseTokenIdentity) {
    if (identity.provider !== "google") return null;
    const path = await legacyUserPath(identity.uid);
    const document = await readDocument(path);
    if (!document) return null;
    const legacy = parseLegacyUser(document, path);
    const directory = await ensureLegacyDirectory(legacy);
    const newPath = await methodPath(identity);
    const methodId = newPath.slice(newPath.lastIndexOf("/") + 1);
    const slotPath = providerSlotPath(directory.userId, identity.provider);

    for (
      let attempt = 0;
      attempt < MAX_CONCURRENT_ATTEMPTS;
      attempt += 1
    ) {
      const existing = await readSignInMethod(newPath);
      if (existing) return existing;
      const slot = await readProviderSlot(directory.userId, identity.provider);
      if (slot && slot.methodId !== methodId) {
        throw new Error("Firestore returned conflicting Sign-in Method records.");
      }
      const linkedAt = new Date(now()).toISOString();
      try {
        await commit([
          {
            verify: firestore.documentName(legacy.path),
            currentDocument: { updateTime: legacy.updateTime },
          },
          {
            verify: firestore.documentName(directory.path),
            currentDocument: { updateTime: directory.updateTime },
          },
          {
            update: {
              name: firestore.documentName(newPath),
              fields: signInMethodFields({
                linkedAt,
                methodId,
                provider: identity.provider,
                userId: directory.userId,
              }),
            },
            currentDocument: { exists: false },
          },
          ...(slot
            ? []
            : [
                {
                  update: {
                    name: firestore.documentName(slotPath),
                    fields: providerSlotFields({
                      linkedAt,
                      methodId,
                      provider: identity.provider,
                      userId: directory.userId,
                    }),
                  },
                  currentDocument: { exists: false },
                },
              ]),
        ]);
        const migrated = await readSignInMethod(newPath);
        if (!migrated) {
          throw new Error("Firestore did not persist the Sign-in Method record.");
        }
        return migrated;
      } catch (error) {
        if (!isConcurrentWrite(error)) throw error;
      }
    }
    throw new Error("Legacy Sign-in Method migration could not resolve.");
  }

  async function resolveStored(identity: FirebaseTokenIdentity) {
    const path = await methodPath(identity);
    const method =
      (await readSignInMethod(path)) ??
      (await migrateLegacyGoogleIdentity(identity));
    if (!method) return null;
    if (method.provider !== identity.provider) {
      throw new Error("Firestore returned a mismatched Sign-in Method record.");
    }
    const user = await readUserDirectory(method.userId);
    if (!user) {
      throw new Error("Firestore returned an orphaned Sign-in Method record.");
    }
    return { method, user };
  }

  return Object.freeze({
    async resolve(identity: FirebaseTokenIdentity) {
      const resolved = await resolveStored(identity);
      return resolved ? publicUser(resolved.user) : null;
    },

    async create(identity: FirebaseTokenIdentity) {
      const existing = await resolveStored(identity);
      if (existing) {
        return { kind: "existing" as const, user: publicUser(existing.user) };
      }

      for (
        let attempt = 0;
        attempt < MAX_CONCURRENT_ATTEMPTS;
        attempt += 1
      ) {
        const userId = `user_${randomUUID().replaceAll("-", "")}`;
        const userPath = userDirectoryPath(userId);
        const signInPath = await methodPath(identity);
        const methodId = signInPath.slice(signInPath.lastIndexOf("/") + 1);
        const slotPath = providerSlotPath(userId, identity.provider);
        const createdAt = new Date(now()).toISOString();
        try {
          await commit([
            {
              update: {
                name: firestore.documentName(userPath),
                fields: userDirectoryFields(
                  { userId, username: null },
                  true,
                  createdAt,
                ),
              },
              currentDocument: { exists: false },
            },
            {
              update: {
                name: firestore.documentName(signInPath),
                fields: signInMethodFields({
                  linkedAt: createdAt,
                  methodId,
                  provider: identity.provider,
                  userId,
                }),
              },
              currentDocument: { exists: false },
            },
            {
              update: {
                name: firestore.documentName(slotPath),
                fields: providerSlotFields({
                  linkedAt: createdAt,
                  methodId,
                  provider: identity.provider,
                  userId,
                }),
              },
              currentDocument: { exists: false },
            },
          ]);
          return {
            kind: "created" as const,
            user: { userId, username: null },
          };
        } catch (error) {
          if (!isConcurrentWrite(error)) throw error;
          const concurrentlyCreated = await resolveStored(identity);
          if (concurrentlyCreated) {
            return {
              kind: "existing" as const,
              user: publicUser(concurrentlyCreated.user),
            };
          }
        }
      }
      throw new Error("User creation could not resolve concurrent writes.");
    },

    async getById(userId: string) {
      const user = await readUserDirectory(userId);
      return user ? publicUser(user) : null;
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
      return publicUser(user);
    },

    async claimUsername(
      identity: FirebaseTokenIdentity,
      username: Username,
    ) {
      for (
        let attempt = 0;
        attempt < MAX_CONCURRENT_ATTEMPTS;
        attempt += 1
      ) {
        const resolved = await resolveStored(identity);
        if (!resolved) return { kind: "unrecognized" as const };
        const { user } = resolved;
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
                fields: {
                  username: { stringValue: username },
                  emptyShellEligible: { booleanValue: false },
                },
              },
              updateMask: {
                fieldPaths: ["username", "emptyShellEligible"],
              },
              currentDocument: { updateTime: user.updateTime },
            },
          ]);
          return {
            kind: "claimed" as const,
            user: { ...publicUser(user), username },
          };
        } catch (error) {
          if (!isConcurrentWrite(error)) throw error;
          const current = await readUserDirectory(user.userId);
          if (current?.username === username) {
            return { kind: "claimed" as const, user: publicUser(current) };
          }
          if (current?.username) return { kind: "immutable" as const };
          if (await readDocument(usernamePath)) return { kind: "taken" as const };
        }
      }
      throw new Error("Username claim could not be resolved after concurrent writes.");
    },

    async link(
      firstIdentity: FirebaseTokenIdentity,
      secondIdentity: FirebaseTokenIdentity,
      expectedTargetUserId?: string,
    ) {
      if (firstIdentity.provider === secondIdentity.provider) {
        return { kind: "conflict" as const };
      }

      for (
        let attempt = 0;
        attempt < MAX_CONCURRENT_ATTEMPTS;
        attempt += 1
      ) {
        const [first, second] = await Promise.all([
          resolveStored(firstIdentity),
          resolveStored(secondIdentity),
        ]);
        if (!first && !second) return { kind: "unrecognized" as const };

        const linkedAt = new Date(now()).toISOString();
        if (!first || !second) {
          const target = first ?? second;
          if (!target) return { kind: "unrecognized" as const };
          if (
            expectedTargetUserId &&
            target.user.userId !== expectedTargetUserId
          ) {
            return { kind: "target_changed" as const };
          }
          const unknownIdentity = first ? secondIdentity : firstIdentity;
          const unknownPath = await methodPath(unknownIdentity);
          const unknownMethodId = unknownPath.slice(
            unknownPath.lastIndexOf("/") + 1,
          );
          const [concurrentlyLinked, targetSlot] = await Promise.all([
            readSignInMethod(unknownPath),
            readProviderSlot(target.user.userId, unknownIdentity.provider),
          ]);
          if (concurrentlyLinked) continue;
          if (targetSlot) return { kind: "conflict" as const };

          try {
            await commit([
              {
                verify: firestore.documentName(target.method.path),
                currentDocument: { updateTime: target.method.updateTime },
              },
              {
                update: {
                  name: firestore.documentName(target.user.path),
                  fields: {
                    emptyShellEligible: { booleanValue: false },
                  },
                },
                updateMask: { fieldPaths: ["emptyShellEligible"] },
                currentDocument: { updateTime: target.user.updateTime },
              },
              {
                update: {
                  name: firestore.documentName(unknownPath),
                  fields: signInMethodFields({
                    linkedAt,
                    methodId: unknownMethodId,
                    provider: unknownIdentity.provider,
                    userId: target.user.userId,
                  }),
                },
                currentDocument: { exists: false },
              },
              {
                update: {
                  name: firestore.documentName(
                    providerSlotPath(
                      target.user.userId,
                      unknownIdentity.provider,
                    ),
                  ),
                  fields: providerSlotFields({
                    linkedAt,
                    methodId: unknownMethodId,
                    provider: unknownIdentity.provider,
                    userId: target.user.userId,
                  }),
                },
                currentDocument: { exists: false },
              },
            ]);
            return {
              kind: "linked" as const,
              user: publicUser({
                ...target.user,
                emptyShellEligible: false,
              }),
            };
          } catch (error) {
            if (!isConcurrentWrite(error)) throw error;
            continue;
          }
        }

        if (first.user.userId === second.user.userId) {
          if (
            expectedTargetUserId &&
            first.user.userId !== expectedTargetUserId
          ) {
            return { kind: "target_changed" as const };
          }
          if (!first.user.emptyShellEligible) {
            const canonical = await readUserDirectory(first.user.userId);
            if (!canonical) continue;
            return { kind: "linked" as const, user: publicUser(canonical) };
          }
          try {
            await commit([
              {
                verify: firestore.documentName(first.method.path),
                currentDocument: { updateTime: first.method.updateTime },
              },
              {
                verify: firestore.documentName(second.method.path),
                currentDocument: { updateTime: second.method.updateTime },
              },
              {
                update: {
                  name: firestore.documentName(first.user.path),
                  fields: {
                    emptyShellEligible: { booleanValue: false },
                  },
                },
                updateMask: { fieldPaths: ["emptyShellEligible"] },
                currentDocument: { updateTime: first.user.updateTime },
              },
            ]);
            return {
              kind: "linked" as const,
              user: publicUser({
                ...first.user,
                emptyShellEligible: false,
              }),
            };
          } catch (error) {
            if (!isConcurrentWrite(error)) throw error;
            continue;
          }
        }

        const source =
          first.user.emptyShellEligible && second.user.emptyShellEligible
            ? first
            : first.user.emptyShellEligible && !second.user.emptyShellEligible
            ? first
            : second.user.emptyShellEligible && !first.user.emptyShellEligible
              ? second
              : null;
        if (!source) return { kind: "conflict" as const };
        const target = source === first ? second : first;
        if (
          expectedTargetUserId &&
          target.user.userId !== expectedTargetUserId
        ) {
          return { kind: "target_changed" as const };
        }
        const [sourceSlots, targetSlot] = await Promise.all([
          readProviderSlots(source.user.userId),
          readProviderSlot(target.user.userId, source.method.provider),
        ]);
        const sourceSlot = sourceSlots[0];
        if (
          source.user.username !== null ||
          sourceSlots.length !== 1 ||
          !sourceSlot ||
          sourceSlot.provider !== source.method.provider ||
          sourceSlot.methodId !== source.method.methodId ||
          targetSlot
        ) {
          return { kind: "conflict" as const };
        }

        try {
          await commit([
            {
              verify: firestore.documentName(target.method.path),
              currentDocument: { updateTime: target.method.updateTime },
            },
            {
              update: {
                name: firestore.documentName(target.user.path),
                fields: {
                  emptyShellEligible: { booleanValue: false },
                },
              },
              updateMask: { fieldPaths: ["emptyShellEligible"] },
              currentDocument: { updateTime: target.user.updateTime },
            },
            {
              update: {
                name: firestore.documentName(source.method.path),
                fields: {
                  userId: { stringValue: target.user.userId },
                  linkedAt: { timestampValue: linkedAt },
                },
              },
              updateMask: { fieldPaths: ["userId", "linkedAt"] },
              currentDocument: { updateTime: source.method.updateTime },
            },
            {
              delete: firestore.documentName(sourceSlot.path),
              currentDocument: { updateTime: sourceSlot.updateTime },
            },
            {
              delete: firestore.documentName(source.user.path),
              currentDocument: { updateTime: source.user.updateTime },
            },
            {
              update: {
                name: firestore.documentName(
                  providerSlotPath(
                    target.user.userId,
                    source.method.provider,
                  ),
                ),
                fields: providerSlotFields({
                  linkedAt,
                  methodId: source.method.methodId,
                  provider: source.method.provider,
                  userId: target.user.userId,
                }),
              },
              currentDocument: { exists: false },
            },
          ]);
          return {
            kind: "linked" as const,
            user: publicUser({
              ...target.user,
              emptyShellEligible: false,
            }),
          };
        } catch (error) {
          if (!isConcurrentWrite(error)) throw error;
        }
      }
      throw new Error("Sign-in Method linking could not resolve concurrent writes.");
    },

    async listSignInMethods(userId: string) {
      return (await readProviderSlots(userId))
        .map(({ provider }) => provider)
        .sort();
    },
  });
}
