import {
  bytesToBase64Url,
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
  stateRevision: number;
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
  baseIssuedAt: string;
  groupId: GroupId;
  joinWindow: number;
  path: string;
  routeId: string;
  secret: string;
  successfulJoins: number;
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
  const stateRevision = Number(
    document.fields?.stateRevision?.integerValue ?? 0,
  );
  if (
    !groupId ||
    !name ||
    !createdAt ||
    !Number.isInteger(stateRevision) ||
    stateRevision < 0 ||
    !document.updateTime
  ) {
    throw new Error("Firestore returned an invalid Group record.");
  }
  return {
    createdAt,
    groupId,
    name,
    path,
    stateRevision,
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
  const baseIssuedAt = document.fields?.baseIssuedAt?.timestampValue;
  const joinWindow = Number(document.fields?.joinWindow?.integerValue);
  const routeId = document.fields?.routeId?.stringValue;
  const secret = document.fields?.secret?.stringValue;
  const successfulJoins = Number(document.fields?.successfulJoins?.integerValue);
  if (
    !groupId ||
    !baseIssuedAt ||
    !Number.isInteger(joinWindow) ||
    joinWindow < 0 ||
    !routeId ||
    !secret ||
    !Number.isInteger(successfulJoins) ||
    successfulJoins < 0 ||
    successfulJoins > INVITE_JOIN_LIMIT ||
    !document.updateTime
  ) {
    throw new Error("Firestore returned an invalid Invite Link record.");
  }
  return {
    baseIssuedAt,
    groupId,
    joinWindow,
    path,
    routeId,
    secret,
    successfulJoins,
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
  if (!member.userId || !member.joinedAt) {
    throw new Error("Firestore returned an incomplete Group membership record.");
  }
  return {
    userId: member.userId,
    username: member.username,
    role: member.role,
    joinedAt: member.joinedAt,
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

  async function readAllMemberships(groupId: GroupId) {
    const memberships: StoredMembership[] = [];
    let pageToken: string | null = null;
    do {
      const parameters = new URLSearchParams({
        pageSize: "500",
        orderBy: "__name__",
      });
      if (pageToken !== null) parameters.set("pageToken", pageToken);
      const response = await firestore.request(
        `${groupPath(groupId)}/members?${parameters}`,
      );
      const page = (await response.json()) as {
        documents?: FirestoreDocument[];
        nextPageToken?: string;
      };
      memberships.push(
        ...(page.documents ?? []).map((document) =>
          parseMembership(document, document.name),
        ),
      );
      pageToken = page.nextPageToken ?? null;
    } while (pageToken !== null);
    return memberships;
  }

  async function hasOpenTasksAssigned(groupId: GroupId, userId: string) {
    let pageToken: string | null = null;
    do {
      const parameters = new URLSearchParams({
        pageSize: "500",
        orderBy: "__name__",
      });
      if (pageToken !== null) parameters.set("pageToken", pageToken);
      const response = await firestore.request(
        `${groupPath(groupId)}/tasks?${parameters}`,
      );
      const page = (await response.json()) as {
        documents?: FirestoreDocument[];
        nextPageToken?: string;
      };
      if (
        (page.documents ?? []).some(
          (document) =>
            document.fields?.state?.stringValue === "open" &&
            document.fields?.assigneeState?.stringValue === "assigned" &&
            document.fields?.assigneeUserId?.stringValue === userId,
        )
      ) {
        return true;
      }
      pageToken = page.nextPageToken ?? null;
    } while (pageToken !== null);
    return false;
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

  function inviteRoutePath(routeId: string) {
    return `v1InviteRoutes/${routeId}`;
  }

  function inviteRouteFromToken(token: InviteToken) {
    return token.match(/^ivt_([a-f0-9]{32})_[0-9a-z]+_[A-Za-z0-9_-]+$/)?.[1] ?? null;
  }

  function freshInvite(groupId: GroupId, routeId?: string): StoredInvite {
    const issuedAtMs = now();
    return {
      baseIssuedAt: new Date(issuedAtMs).toISOString(),
      groupId,
      joinWindow: 0,
      path: currentInvitePath(groupId),
      routeId: routeId ?? randomUUID().replaceAll("-", ""),
      secret: randomUUID().replaceAll("-", ""),
      successfulJoins: 0,
      updateTime: "",
    };
  }

  function inviteWindow(invite: StoredInvite) {
    return Math.max(
      0,
      Math.floor((now() - Date.parse(invite.baseIssuedAt)) / INVITE_LIFETIME_MS),
    );
  }

  function successfulJoinsInWindow(invite: StoredInvite, window: number) {
    return invite.joinWindow === window ? invite.successfulJoins : 0;
  }

  async function inviteToken(invite: StoredInvite, window: number) {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(invite.secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${invite.routeId}:${window}`),
    );
    return `ivt_${invite.routeId}_${window.toString(36)}_${bytesToBase64Url(
      new Uint8Array(signature),
    )}` as InviteToken;
  }

  async function publicInvite(invite: StoredInvite): Promise<OpenJobInviteLink> {
    const window = inviteWindow(invite);
    const issuedAtMs = Date.parse(invite.baseIssuedAt) + window * INVITE_LIFETIME_MS;
    const token = await inviteToken(invite, window);
    return {
      token,
      url: `https://openjob.dev/invites/${token}`,
      issuedAt: new Date(issuedAtMs).toISOString(),
      expiresAt: new Date(issuedAtMs + INVITE_LIFETIME_MS).toISOString(),
      remainingJoins:
        INVITE_JOIN_LIMIT - successfulJoinsInWindow(invite, window),
    };
  }

  function inviteFields(invite: StoredInvite) {
    return {
      baseIssuedAt: { timestampValue: invite.baseIssuedAt },
      groupId: { stringValue: invite.groupId },
      joinWindow: { integerValue: String(invite.joinWindow) },
      routeId: { stringValue: invite.routeId },
      secret: { stringValue: invite.secret },
      successfulJoins: { integerValue: String(invite.successfulJoins) },
    };
  }

  function inviteRouteWrite(invite: StoredInvite) {
    return {
      update: {
        name: firestore.documentName(inviteRoutePath(invite.routeId)),
        fields: { groupId: { stringValue: invite.groupId } },
      },
      currentDocument: { exists: false },
    };
  }

  async function get(userId: string, groupId: GroupId) {
    const membership = await readMembership(membershipPath(groupId, userId));
    if (!membership) return null;
    const group = await readGroup(groupPath(groupId));
    return group ? publicGroup(group, membership.role) : null;
  }

  function stateRevisionWrite(group: StoredGroup) {
    return {
      update: {
        name: firestore.documentName(group.path),
        fields: {
          stateRevision: { integerValue: String(group.stateRevision + 1) },
        },
      },
      updateMask: { fieldPaths: ["stateRevision"] },
      currentDocument: { updateTime: group.updateTime },
    };
  }

  async function rotateCurrentInvite(
    group: StoredGroup,
    member: StoredMembership,
    current: StoredInvite | null,
  ) {
    const fresh = freshInvite(group.groupId, current?.routeId);
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
    if (!current) writes.push(inviteRouteWrite(fresh));
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
                  stateRevision: { integerValue: "0" },
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
            inviteRouteWrite(invite),
          ]);
          return { groupId, name, role: "admin", createdAt };
        } catch (error) {
          if (!isConcurrentWrite(error)) throw error;
        }
      }
      throw new Error("A unique Group ID and Invite Link could not be allocated.");
    },

    async demote(actorUserId, groupId, targetUserId) {
      for (let attempt = 0; attempt < MAX_CONCURRENT_ATTEMPTS; attempt += 1) {
        const group = await readGroup(groupPath(groupId));
        if (!group) return { kind: "not_found" as const };
        const [actor, target] = await Promise.all([
          readMembership(membershipPath(groupId, actorUserId)),
          readMembership(membershipPath(groupId, targetUserId)),
        ]);
        if (!actor) return { kind: "not_found" as const };
        if (actor.role !== "admin") return { kind: "forbidden" as const };
        if (!target) return { kind: "member_not_found" as const };
        if (target.role !== "admin") return { kind: "role_conflict" as const };
        const members = await readAllMemberships(groupId);
        if (members.filter(({ role }) => role === "admin").length <= 1) {
          return { kind: "last_admin" as const };
        }

        try {
          await commit([
            stateRevisionWrite(group),
            ...(actor.path === target.path
              ? []
              : [
                  {
                    verify: firestore.documentName(actor.path),
                    currentDocument: { updateTime: actor.updateTime },
                  },
                ]),
            {
              update: {
                name: firestore.documentName(target.path),
                fields: { role: { stringValue: "member" } },
              },
              updateMask: { fieldPaths: ["role"] },
              currentDocument: { updateTime: target.updateTime },
            },
          ]);
          return {
            kind: "demoted" as const,
            member: publicMember({ ...target, role: "member" }),
          };
        } catch (error) {
          if (!isConcurrentWrite(error)) throw error;
        }
      }
      throw new Error("Member demotion could not resolve concurrent writes.");
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
        if (current) {
          return {
            kind: "found" as const,
            invite: await publicInvite(current),
          };
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
      const routeId = inviteRouteFromToken(token);
      if (!routeId) return { kind: "not_found" as const };
      const pointer = await readInvitePointer(inviteRoutePath(routeId));
      if (!pointer) return { kind: "not_found" as const };
      const [group, current] = await Promise.all([
        readGroup(groupPath(pointer.groupId)),
        readInvite(currentInvitePath(pointer.groupId)),
      ]);
      if (!group || !current || current.routeId !== routeId) {
        return { kind: "not_found" as const };
      }
      const active = await publicInvite(current);
      return active.token === token
        ? { kind: "found" as const, groupName: group.name }
        : { kind: "not_found" as const };
    },

    async joinInvite(user, token) {
      const routeId = inviteRouteFromToken(token);
      if (!routeId) return { kind: "not_found" as const };
      for (let attempt = 0; attempt < MAX_CONCURRENT_ATTEMPTS; attempt += 1) {
        const pointer = await readInvitePointer(inviteRoutePath(routeId));
        if (!pointer) return { kind: "not_found" as const };
        const [group, current] = await Promise.all([
          readGroup(groupPath(pointer.groupId)),
          readInvite(currentInvitePath(pointer.groupId)),
        ]);
        if (!group || !current || current.routeId !== routeId) {
          return { kind: "not_found" as const };
        }
        const active = await publicInvite(current);
        if (active.token !== token) return { kind: "not_found" as const };

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
        const window = inviteWindow(current);
        const nextJoinCount = successfulJoinsInWindow(current, window) + 1;
        const replacement =
          nextJoinCount === INVITE_JOIN_LIMIT
            ? freshInvite(group.groupId, current.routeId)
            : null;
        const nextInvite = replacement ?? {
          ...current,
          joinWindow: window,
          successfulJoins: nextJoinCount,
        };
        const writes: unknown[] = [
          {
            verify: firestore.documentName(pointer.path),
            currentDocument: { updateTime: pointer.updateTime },
          },
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
                    joinWindow: { integerValue: String(window) },
                    successfulJoins: {
                      integerValue: String(nextInvite.successfulJoins),
                    },
                  },
            },
            ...(replacement
              ? {}
              : {
                  updateMask: {
                    fieldPaths: ["joinWindow", "successfulJoins"],
                  },
                }),
            currentDocument: { updateTime: current.updateTime },
          },
        ];

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

    async leave(userId, groupId) {
      for (let attempt = 0; attempt < MAX_CONCURRENT_ATTEMPTS; attempt += 1) {
        const group = await readGroup(groupPath(groupId));
        if (!group) return { kind: "not_found" as const };
        const member = await readMembership(membershipPath(groupId, userId));
        if (!member) return { kind: "not_found" as const };
        if (member.role === "admin") {
          const members = await readAllMemberships(groupId);
          if (members.filter(({ role }) => role === "admin").length <= 1) {
            return { kind: "last_admin" as const };
          }
        }
        if (await hasOpenTasksAssigned(groupId, userId)) {
          return { kind: "open_tasks_assigned" as const };
        }

        try {
          await commit([
            stateRevisionWrite(group),
            {
              delete: firestore.documentName(member.path),
              currentDocument: { updateTime: member.updateTime },
            },
            {
              delete: firestore.documentName(accessPath(userId, groupId)),
            },
          ]);
          return { kind: "left" as const };
        } catch (error) {
          if (!isConcurrentWrite(error)) throw error;
        }
      }
      throw new Error("Group departure could not resolve concurrent writes.");
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

    async promote(actorUserId, groupId, targetUserId) {
      for (let attempt = 0; attempt < MAX_CONCURRENT_ATTEMPTS; attempt += 1) {
        const [group, actor, target] = await Promise.all([
          readGroup(groupPath(groupId)),
          readMembership(membershipPath(groupId, actorUserId)),
          readMembership(membershipPath(groupId, targetUserId)),
        ]);
        if (!group || !actor) return { kind: "not_found" as const };
        if (actor.role !== "admin") return { kind: "forbidden" as const };
        if (!target) return { kind: "member_not_found" as const };
        if (target.role === "admin") return { kind: "role_conflict" as const };

        try {
          await commit([
            stateRevisionWrite(group),
            ...(actor.path === target.path
              ? []
              : [
                  {
                    verify: firestore.documentName(actor.path),
                    currentDocument: { updateTime: actor.updateTime },
                  },
                ]),
            {
              update: {
                name: firestore.documentName(target.path),
                fields: { role: { stringValue: "admin" } },
              },
              updateMask: { fieldPaths: ["role"] },
              currentDocument: { updateTime: target.updateTime },
            },
          ]);
          return {
            kind: "promoted" as const,
            member: publicMember({ ...target, role: "admin" }),
          };
        } catch (error) {
          if (!isConcurrentWrite(error)) throw error;
        }
      }
      throw new Error("Member promotion could not resolve concurrent writes.");
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
