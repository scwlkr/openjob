import {
  createFirestoreRestClient,
  FirestoreRequestError,
  type FirebaseConfig,
  type FirestoreDocument,
} from "./firestore-rest.ts";
import {
  InvalidGroupCursorError,
  InvalidMemberCursorError,
  type GroupId,
  type GroupRole,
  type GroupStore,
  type GroupUser,
  type InviteToken,
  type OpenJobGroup,
  type OpenJobInviteLink,
  type OpenJobMember,
} from "../server/v1-groups.ts";

const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const INVITE_JOIN_LIMIT = 25;
const MAX_CONCURRENT_ATTEMPTS = 40;

type StoredGroup = {
  createdAt: string;
  groupId: GroupId;
  name: string;
  path: string;
  updateTime: string;
};

type StoredMembership = {
  joinedAt: string | null;
  path: string;
  role: GroupRole;
  updateTime: string;
  userId: string | null;
  username: string | null;
};

type StoredInvite = {
  expiresAt: string;
  groupId: GroupId;
  issuedAt: string;
  path: string;
  successfulJoins: number;
  token: InviteToken;
  updateTime: string;
};

type StoredInvitePointer = {
  groupId: GroupId;
  path: string;
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
  return {
    joinedAt: document.fields?.joinedAt?.timestampValue ?? null,
    path,
    role,
    updateTime: document.updateTime,
    userId: document.fields?.userId?.stringValue ?? null,
    username: document.fields?.username?.stringValue ?? null,
  };
}

function parseInvite(document: FirestoreDocument, path: string): StoredInvite {
  const groupId = document.fields?.groupId?.stringValue as GroupId | undefined;
  const token = document.fields?.token?.stringValue as InviteToken | undefined;
  const issuedAt = document.fields?.issuedAt?.timestampValue;
  const expiresAt = document.fields?.expiresAt?.timestampValue;
  const successfulJoins = Number(document.fields?.successfulJoins?.integerValue);
  if (
    !groupId ||
    !token ||
    !issuedAt ||
    !expiresAt ||
    !Number.isInteger(successfulJoins) ||
    successfulJoins < 0 ||
    successfulJoins > INVITE_JOIN_LIMIT ||
    !document.updateTime
  ) {
    throw new Error("Firestore returned an invalid Invite Link record.");
  }
  return {
    expiresAt,
    groupId,
    issuedAt,
    path,
    successfulJoins,
    token,
    updateTime: document.updateTime,
  };
}

function parseInvitePointer(
  document: FirestoreDocument,
  path: string,
): StoredInvitePointer {
  const groupId = document.fields?.groupId?.stringValue as GroupId | undefined;
  if (!groupId || !document.updateTime) {
    throw new Error("Firestore returned an invalid Invite Link pointer.");
  }
  return { groupId, path, updateTime: document.updateTime };
}

function publicGroup(group: StoredGroup, role: GroupRole): OpenJobGroup {
  return {
    groupId: group.groupId,
    name: group.name,
    role,
    createdAt: group.createdAt,
  };
}

function publicMember(member: StoredMembership): OpenJobMember {
  if (!member.userId || !member.username || !member.joinedAt) {
    throw new Error("Firestore returned an incomplete Group membership record.");
  }
  return {
    userId: member.userId,
    username: member.username,
    role: member.role,
    joinedAt: member.joinedAt,
  };
}

function publicInvite(invite: StoredInvite): OpenJobInviteLink {
  return {
    token: invite.token,
    url: `https://openjob.dev/invites/${invite.token}`,
    issuedAt: invite.issuedAt,
    expiresAt: invite.expiresAt,
    remainingJoins: INVITE_JOIN_LIMIT - invite.successfulJoins,
  };
}

function isConcurrentWrite(error: unknown) {
  return (
    error instanceof FirestoreRequestError &&
    [
      "ABORTED",
      "ALREADY_EXISTS",
      "FAILED_PRECONDITION",
      "NOT_FOUND",
    ].includes(error.code ?? "")
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

  async function readInvite(path: string) {
    const document = await readDocument(path);
    return document ? parseInvite(document, path) : null;
  }

  async function readInvitePointer(path: string) {
    const document = await readDocument(path);
    return document ? parseInvitePointer(document, path) : null;
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

  function banPath(groupId: GroupId, userId: string) {
    return `${groupPath(groupId)}/bans/${userId}`;
  }

  function accessPath(userId: string, groupId: GroupId) {
    return `v1GroupAccess/${userId}/groups/${groupId}`;
  }

  function currentInvitePath(groupId: GroupId) {
    return `${groupPath(groupId)}/invite/current`;
  }

  function invitePointerPath(token: InviteToken) {
    return `v1Invites/${token}`;
  }

  function freshInvite(groupId: GroupId): StoredInvite {
    const issuedAtMs = now();
    return {
      expiresAt: new Date(issuedAtMs + INVITE_LIFETIME_MS).toISOString(),
      groupId,
      issuedAt: new Date(issuedAtMs).toISOString(),
      path: currentInvitePath(groupId),
      successfulJoins: 0,
      token: `ivt_${randomUUID().replaceAll("-", "")}` as InviteToken,
      updateTime: "",
    };
  }

  function inviteFields(invite: StoredInvite) {
    return {
      groupId: { stringValue: invite.groupId },
      token: { stringValue: invite.token },
      issuedAt: { timestampValue: invite.issuedAt },
      expiresAt: { timestampValue: invite.expiresAt },
      successfulJoins: { integerValue: String(invite.successfulJoins) },
    };
  }

  function invitePointerWrite(invite: StoredInvite) {
    return {
      update: {
        name: firestore.documentName(invitePointerPath(invite.token)),
        fields: { groupId: { stringValue: invite.groupId } },
      },
      currentDocument: { exists: false },
    };
  }

  function inviteIsActive(invite: StoredInvite) {
    return (
      Date.parse(invite.expiresAt) > now() &&
      invite.successfulJoins < INVITE_JOIN_LIMIT
    );
  }

  async function get(userId: string, groupId: GroupId) {
    const membership = await readMembership(membershipPath(groupId, userId));
    if (!membership) return null;
    const group = await readGroup(groupPath(groupId));
    return group ? publicGroup(group, membership.role) : null;
  }

  async function rotateCurrentInvite(
    group: StoredGroup,
    member: StoredMembership,
    current: StoredInvite | null,
  ) {
    const fresh = freshInvite(group.groupId);
    const writes: unknown[] = [
      {
        verify: firestore.documentName(member.path),
        currentDocument: { updateTime: member.updateTime },
      },
      {
        verify: firestore.documentName(group.path),
        currentDocument: { updateTime: group.updateTime },
      },
      {
        update: {
          name: firestore.documentName(fresh.path),
          fields: inviteFields(fresh),
        },
        currentDocument: current
          ? { updateTime: current.updateTime }
          : { exists: false },
      },
    ];
    if (current) {
      writes.push({
        delete: firestore.documentName(invitePointerPath(current.token)),
      });
    }
    writes.push(invitePointerWrite(fresh));
    await commit(writes);
    return publicInvite(fresh);
  }

  return Object.freeze({
    async create(user: GroupUser, name) {
      for (let attempt = 0; attempt < MAX_CONCURRENT_ATTEMPTS; attempt += 1) {
        const groupId = `grp_${randomUUID().replaceAll("-", "")}` as GroupId;
        const createdAt = new Date(now()).toISOString();
        const groupDocumentPath = groupPath(groupId);
        const memberDocumentPath = membershipPath(groupId, user.userId);
        const accessDocumentPath = accessPath(user.userId, groupId);
        const invite = freshInvite(groupId);
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
                  userId: { stringValue: user.userId },
                  ...(user.username
                    ? { username: { stringValue: user.username } }
                    : {}),
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
            {
              update: {
                name: firestore.documentName(invite.path),
                fields: inviteFields(invite),
              },
              currentDocument: { exists: false },
            },
            invitePointerWrite(invite),
          ]);
          return { groupId, name, role: "admin", createdAt };
        } catch (error) {
          if (!isConcurrentWrite(error)) throw error;
        }
      }
      throw new Error("A unique Group ID and Invite Link could not be allocated.");
    },

    get,

    async getInvite(userId, groupId) {
      for (let attempt = 0; attempt < MAX_CONCURRENT_ATTEMPTS; attempt += 1) {
        const member = await readMembership(membershipPath(groupId, userId));
        if (!member) return { kind: "not_found" as const };
        const group = await readGroup(groupPath(groupId));
        if (!group) return { kind: "not_found" as const };
        if (member.role !== "admin") return { kind: "forbidden" as const };
        const current = await readInvite(currentInvitePath(groupId));
        if (current && inviteIsActive(current)) {
          return { kind: "found" as const, invite: publicInvite(current) };
        }
        try {
          return {
            kind: "found" as const,
            invite: await rotateCurrentInvite(group, member, current),
          };
        } catch (error) {
          if (!isConcurrentWrite(error)) throw error;
        }
      }
      throw new Error("Invite Link refresh could not resolve concurrent writes.");
    },

    async inspectInvite(token) {
      const pointer = await readInvitePointer(invitePointerPath(token));
      if (!pointer) return { kind: "not_found" as const };
      const [group, current] = await Promise.all([
        readGroup(groupPath(pointer.groupId)),
        readInvite(currentInvitePath(pointer.groupId)),
      ]);
      if (
        !group ||
        !current ||
        current.token !== token ||
        !inviteIsActive(current)
      ) {
        return { kind: "not_found" as const };
      }
      return { kind: "found" as const, groupName: group.name };
    },

    async joinInvite(user, token) {
      for (let attempt = 0; attempt < MAX_CONCURRENT_ATTEMPTS; attempt += 1) {
        const pointer = await readInvitePointer(invitePointerPath(token));
        if (!pointer) return { kind: "not_found" as const };
        const [group, current] = await Promise.all([
          readGroup(groupPath(pointer.groupId)),
          readInvite(currentInvitePath(pointer.groupId)),
        ]);
        if (
          !group ||
          !current ||
          current.token !== token ||
          !inviteIsActive(current)
        ) {
          return { kind: "not_found" as const };
        }

        const memberDocumentPath = membershipPath(group.groupId, user.userId);
        const existing = await readMembership(memberDocumentPath);
        if (existing) {
          return {
            kind: "joined" as const,
            group: publicGroup(group, existing.role),
          };
        }
        if (!user.username) return { kind: "username_required" as const };

        const userBanPath = banPath(group.groupId, user.userId);
        if (await readDocument(userBanPath)) {
          return { kind: "membership_denied" as const };
        }

        const joinedAt = new Date(now()).toISOString();
        const nextJoinCount = current.successfulJoins + 1;
        const replacement =
          nextJoinCount === INVITE_JOIN_LIMIT
            ? freshInvite(group.groupId)
            : null;
        const nextInvite = replacement ?? {
          ...current,
          successfulJoins: nextJoinCount,
        };
        const pointerWrite = replacement
          ? {
              delete: firestore.documentName(pointer.path),
              currentDocument: { updateTime: pointer.updateTime },
            }
          : {
              verify: firestore.documentName(pointer.path),
              currentDocument: { updateTime: pointer.updateTime },
            };
        const writes: unknown[] = [
          pointerWrite,
          {
            verify: firestore.documentName(group.path),
            currentDocument: { updateTime: group.updateTime },
          },
          {
            verify: firestore.documentName(userBanPath),
            currentDocument: { exists: false },
          },
          {
            update: {
              name: firestore.documentName(memberDocumentPath),
              fields: {
                userId: { stringValue: user.userId },
                username: { stringValue: user.username },
                role: { stringValue: "member" },
                joinedAt: { timestampValue: joinedAt },
              },
            },
            currentDocument: { exists: false },
          },
          {
            update: {
              name: firestore.documentName(accessPath(user.userId, group.groupId)),
              fields: { groupId: { stringValue: group.groupId } },
            },
            currentDocument: { exists: false },
          },
          {
            update: {
              name: firestore.documentName(current.path),
              fields: replacement
                ? inviteFields(nextInvite)
                : {
                    successfulJoins: {
                      integerValue: String(nextInvite.successfulJoins),
                    },
                  },
            },
            ...(replacement
              ? {}
              : { updateMask: { fieldPaths: ["successfulJoins"] } }),
            currentDocument: { updateTime: current.updateTime },
          },
        ];
        if (replacement) writes.push(invitePointerWrite(replacement));

        try {
          await commit(writes);
          return {
            kind: "joined" as const,
            group: publicGroup(group, "member"),
          };
        } catch (error) {
          if (!isConcurrentWrite(error)) throw error;
        }
      }
      throw new Error("Invite Link join could not resolve concurrent writes.");
    },

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

    async listMembers(userId, groupId, { cursor, limit }) {
      const [member, group] = await Promise.all([
        readMembership(membershipPath(groupId, userId)),
        readGroup(groupPath(groupId)),
      ]);
      if (!member || !group) return { kind: "not_found" as const };

      const parameters = new URLSearchParams({
        pageSize: String(limit),
        orderBy: "__name__",
      });
      if (cursor !== null) parameters.set("pageToken", cursor);
      let response;
      try {
        response = await firestore.request(
          `${groupPath(groupId)}/members?${parameters}`,
        );
      } catch (error) {
        if (
          error instanceof FirestoreRequestError &&
          error.code === "INVALID_ARGUMENT"
        ) {
          throw new InvalidMemberCursorError();
        }
        throw error;
      }
      const result = (await response.json()) as {
        documents?: FirestoreDocument[];
        nextPageToken?: string;
      };
      const members = (result.documents ?? []).map((document) =>
        publicMember(parseMembership(document, document.name)),
      );
      return {
        kind: "found" as const,
        members,
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

    async rotateInvite(userId, groupId) {
      for (let attempt = 0; attempt < MAX_CONCURRENT_ATTEMPTS; attempt += 1) {
        const member = await readMembership(membershipPath(groupId, userId));
        if (!member) return { kind: "not_found" as const };
        const group = await readGroup(groupPath(groupId));
        if (!group) return { kind: "not_found" as const };
        if (member.role !== "admin") return { kind: "forbidden" as const };
        const current = await readInvite(currentInvitePath(groupId));
        try {
          return {
            kind: "rotated" as const,
            invite: await rotateCurrentInvite(group, member, current),
          };
        } catch (error) {
          if (!isConcurrentWrite(error)) throw error;
        }
      }
      throw new Error("Invite Link rotation could not resolve concurrent writes.");
    },
  });
}
