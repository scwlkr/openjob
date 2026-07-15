import {
  createFirestoreRestClient,
  FirestoreRequestError,
  type FirebaseConfig,
  type FirestoreDocument,
} from "./firestore-rest.ts";
import {
  InvalidGroupCursorError,
  type GroupId,
  type GroupRole,
  type GroupStore,
  type OpenJobGroup,
} from "../server/v1-groups.ts";

type StoredGroup = {
  createdAt: string;
  groupId: GroupId;
  name: string;
  path: string;
  updateTime: string;
};

type StoredMembership = {
  path: string;
  role: GroupRole;
  updateTime: string;
};

type GroupStoreOptions = {
  now?: () => number;
  randomUUID?: () => string;
};

function parseGroup(document: FirestoreDocument, path: string): StoredGroup {
  const groupId = document.fields?.groupId?.stringValue as GroupId | undefined;
  const name = document.fields?.name?.stringValue;
  const createdAt = document.fields?.createdAt?.timestampValue;
  if (!groupId || !name || !createdAt || !document.updateTime) {
    throw new Error("Firestore returned an invalid Group record.");
  }
  return {
    createdAt,
    groupId,
    name,
    path,
    updateTime: document.updateTime,
  };
}

function parseMembership(
  document: FirestoreDocument,
  path: string,
): StoredMembership {
  const role = document.fields?.role?.stringValue;
  if ((role !== "admin" && role !== "member") || !document.updateTime) {
    throw new Error("Firestore returned an invalid Group membership record.");
  }
  return { path, role, updateTime: document.updateTime };
}

function publicGroup(group: StoredGroup, role: GroupRole): OpenJobGroup {
  return {
    groupId: group.groupId,
    name: group.name,
    role,
    createdAt: group.createdAt,
  };
}

function isConcurrentWrite(error: unknown) {
  return (
    error instanceof FirestoreRequestError &&
    ["ABORTED", "FAILED_PRECONDITION", "NOT_FOUND"].includes(
      error.code ?? "",
    )
  );
}

export function createFirestoreGroupStore(
  config: FirebaseConfig,
  fetchImplementation: typeof fetch = fetch,
  {
    now = Date.now,
    randomUUID = () => crypto.randomUUID(),
  }: GroupStoreOptions = {},
): GroupStore {
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

  async function readGroup(path: string) {
    const document = await readDocument(path);
    return document ? parseGroup(document, path) : null;
  }

  async function readMembership(path: string) {
    const document = await readDocument(path);
    return document ? parseMembership(document, path) : null;
  }

  async function commit(writes: unknown[]) {
    return firestore.request(":commit", {
      method: "POST",
      body: JSON.stringify({ writes }),
    });
  }

  function groupPath(groupId: GroupId) {
    return `v1Groups/${groupId}`;
  }

  function membershipPath(groupId: GroupId, userId: string) {
    return `${groupPath(groupId)}/members/${userId}`;
  }

  function accessPath(userId: string, groupId: GroupId) {
    return `v1GroupAccess/${userId}/groups/${groupId}`;
  }

  async function get(userId: string, groupId: GroupId) {
    const membership = await readMembership(membershipPath(groupId, userId));
    if (!membership) return null;
    const group = await readGroup(groupPath(groupId));
    return group ? publicGroup(group, membership.role) : null;
  }

  return Object.freeze({
    async create(userId, name) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const groupId = `grp_${randomUUID().replaceAll("-", "")}` as GroupId;
        const createdAt = new Date(now()).toISOString();
        const groupDocumentPath = groupPath(groupId);
        const memberDocumentPath = membershipPath(groupId, userId);
        const accessDocumentPath = accessPath(userId, groupId);
        try {
          await commit([
            {
              update: {
                name: firestore.documentName(groupDocumentPath),
                fields: {
                  groupId: { stringValue: groupId },
                  name: { stringValue: name },
                  createdAt: { timestampValue: createdAt },
                },
              },
              currentDocument: { exists: false },
            },
            {
              update: {
                name: firestore.documentName(memberDocumentPath),
                fields: {
                  userId: { stringValue: userId },
                  role: { stringValue: "admin" },
                  joinedAt: { timestampValue: createdAt },
                },
              },
              currentDocument: { exists: false },
            },
            {
              update: {
                name: firestore.documentName(accessDocumentPath),
                fields: { groupId: { stringValue: groupId } },
              },
              currentDocument: { exists: false },
            },
          ]);
          return { groupId, name, role: "admin", createdAt };
        } catch (error) {
          if (
            !(error instanceof FirestoreRequestError) ||
            error.code !== "ALREADY_EXISTS"
          ) {
            throw error;
          }
        }
      }
      throw new Error("A unique Group ID could not be allocated.");
    },

    get,

    async list(userId, { cursor, limit }) {
      const parameters = new URLSearchParams({
        pageSize: String(limit),
        orderBy: "__name__",
      });
      if (cursor !== null) parameters.set("pageToken", cursor);
      let response;
      try {
        response = await firestore.request(
          `v1GroupAccess/${userId}/groups?${parameters}`,
        );
      } catch (error) {
        if (
          error instanceof FirestoreRequestError &&
          error.code === "INVALID_ARGUMENT"
        ) {
          throw new InvalidGroupCursorError();
        }
        throw error;
      }
      const result = (await response.json()) as {
        documents?: FirestoreDocument[];
        nextPageToken?: string;
      };
      const groupIds = (result.documents ?? []).map((document) => {
        const groupId = document.fields?.groupId?.stringValue;
        if (!groupId) {
          throw new Error("Firestore returned an invalid Group access record.");
        }
        return groupId as GroupId;
      });
      const groups = await Promise.all(
        groupIds.map(async (groupId) => {
          const group = await get(userId, groupId);
          if (!group) {
            throw new Error("Firestore returned an inconsistent Group access record.");
          }
          return group;
        }),
      );
      return {
        groups,
        nextCursor: result.nextPageToken ?? null,
      };
    },

    async rename(userId, groupId, name) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const member = await readMembership(membershipPath(groupId, userId));
        if (!member) return { kind: "not_found" as const };
        const group = await readGroup(groupPath(groupId));
        if (!group) return { kind: "not_found" as const };
        if (member.role !== "admin") return { kind: "forbidden" as const };
        if (group.name === name) {
          return {
            kind: "renamed" as const,
            group: publicGroup(group, member.role),
          };
        }

        try {
          await commit([
            {
              verify: firestore.documentName(member.path),
              currentDocument: { updateTime: member.updateTime },
            },
            {
              update: {
                name: firestore.documentName(group.path),
                fields: { name: { stringValue: name } },
              },
              updateMask: { fieldPaths: ["name"] },
              currentDocument: { updateTime: group.updateTime },
            },
          ]);
          return {
            kind: "renamed" as const,
            group: { ...publicGroup(group, member.role), name },
          };
        } catch (error) {
          if (!isConcurrentWrite(error)) throw error;
        }
      }
      throw new Error("Group rename could not be resolved after concurrent writes.");
    },
  });
}
