import {
  bytesToBase64Url,
  createFirestoreRestClient,
  FirestoreRequestError,
  type FirebaseConfig,
  type FirestoreDocument,
} from "./firestore-rest.ts";
import {
  advanceGroupStateRevisionWrite,
  readGroupStateRevision,
} from "./group-state.ts";
import { isOpenTaskAssignedTo } from "./v1-tasks.ts";
import {
  InvalidBanCursorError,
  InvalidGroupCursorError,
  InvalidMemberCursorError,
  type GroupId,
  type GroupRole,
  type GroupStore,
  type GroupUser,
  type InviteToken,
  type OpenJobGroup,
  type OpenJobBan,
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
  membershipId: string | null;
  path: string;
  role: GroupRole;
  updateTime: string;
  userId: string | null;
  username: string | null;
};

type StoredBan = OpenJobBan & {
  path: string;
  updateTime: string;
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
  const stateRevision = readGroupStateRevision(document);
  if (
    !groupId ||
    !name ||
    !createdAt ||
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
    membershipId: document.fields?.membershipId?.stringValue ?? null,
    path,
    role,
    updateTime: document.updateTime,
    userId: document.fields?.userId?.stringValue ?? null,
    username: document.fields?.username?.stringValue ?? null,
  };
}

function parseBan(document: FirestoreDocument, path: string): StoredBan {
  const userId = document.fields?.userId?.stringValue;
  const username = document.fields?.username?.stringValue ?? null;
  const bannedAt = document.fields?.bannedAt?.timestampValue;
  if (!userId || !bannedAt || !document.updateTime) {
    throw new Error("Firestore returned an invalid Group ban record.");
  }
  return { bannedAt, path, updateTime: document.updateTime, userId, username };
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

function publicBan(ban: StoredBan): OpenJobBan {
  return {
    userId: ban.userId,
    username: ban.username,
    bannedAt: ban.bannedAt,
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

  async function readBan(path: string) {
    const document = await readDocument(path);
    return document ? parseBan(document, path) : null;
  }

  async function readInvite(path: string) {
    const document = await readDocument(path);
    return document ? parseInvite(document, path) : null;
  }

  async function readInvitePointer(path: string) {
    const document = await readDocument(path);
    return document ? parseInvitePointer(document, path) : null;
  }

  async function readAllCollectionDocuments(path: string) {
    const documents: FirestoreDocument[] = [];
    let pageToken: string | null = null;
    do {
      const parameters = new URLSearchParams({
        pageSize: "500",
        orderBy: "__name__",
      });
      if (pageToken !== null) parameters.set("pageToken", pageToken);
      const response = await firestore.request(`${path}?${parameters}`);
      const page = (await response.json()) as {
        documents?: FirestoreDocument[];
        nextPageToken?: string;
      };
      documents.push(...(page.documents ?? []));
      pageToken = page.nextPageToken ?? null;
    } while (pageToken !== null);
    return documents;
  }

  async function readAllMemberships(groupId: GroupId) {
    const documents = await readAllCollectionDocuments(
      `${groupPath(groupId)}/members`,
    );
    return documents.map((document) =>
      parseMembership(document, document.name),
    );
  }

  async function readAllGroupDocuments(groupId: GroupId) {
    const collections = [
      "bans",
      "invite",
      "members",
      "membershipEvidence",
      "tasks",
    ] as const;
    const pages = await Promise.all(
      collections.map((collection) =>
        readAllCollectionDocuments(`${groupPath(groupId)}/${collection}`),
      ),
    );
    return Object.fromEntries(
      collections.map((collection, index) => [collection, pages[index]]),
    ) as Record<(typeof collections)[number], FirestoreDocument[]>;
  }

  async function hasOpenTasksAssigned(
    groupId: GroupId,
    userId: string,
    membershipId: string | null,
  ) {
    const documents = await readAllCollectionDocuments(
      `${groupPath(groupId)}/tasks`,
    );
    return documents.some((document) =>
      isOpenTaskAssignedTo(document, userId, membershipId),
    );
  }

  async function commit(writes: unknown[]) {
    return firestore.request(":commit", {
      method: "POST",
      body: JSON.stringify({ writes }),
    });
  }

  function userHistoryWrite(userId: string) {
    return {
      update: {
        name: firestore.documentName(`v1UserDirectory/${userId}`),
        fields: {
          emptyShellEligible: { booleanValue: false },
        },
      },
      updateMask: { fieldPaths: ["emptyShellEligible"] },
      currentDocument: { exists: true },
    };
  }

  function groupPath(groupId: GroupId) {
    return `v1Groups/${groupId}`;
  }

  function groupIdReservationPath(groupId: GroupId) {
    return `v1GroupIds/${groupId}`;
  }

  function membershipPath(groupId: GroupId, userId: string) {
    return `${groupPath(groupId)}/members/${userId}`;
  }

  function banPath(groupId: GroupId, userId: string) {
    return `${groupPath(groupId)}/bans/${userId}`;
  }

  function membershipEvidencePath(groupId: GroupId, userId: string) {
    return `${groupPath(groupId)}/membershipEvidence/${userId}`;
  }

  function membershipEvidenceWrite(groupId: GroupId, user: GroupUser) {
    return {
      update: {
        name: firestore.documentName(
          membershipEvidencePath(groupId, user.userId),
        ),
        fields: {
          userId: { stringValue: user.userId },
          ...(user.username
            ? { username: { stringValue: user.username } }
            : {}),
        },
      },
      currentDocument: { exists: false },
    };
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

  function updateTimePrecondition(document: FirestoreDocument) {
    if (!document.updateTime) {
      throw new Error("Firestore returned a document without an update time.");
    }
    return { updateTime: document.updateTime };
  }

  function deleteDocumentWrite(document: FirestoreDocument) {
    return {
      delete: document.name,
      currentDocument: updateTimePrecondition(document),
    };
  }

  function groupIdReservationWrite(groupId: GroupId) {
    return {
      update: {
        name: firestore.documentName(groupIdReservationPath(groupId)),
        fields: { groupId: { stringValue: groupId } },
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
    return advanceGroupStateRevisionWrite({
      documentName: firestore.documentName(group.path),
      revision: group.stateRevision,
      updateTime: group.updateTime,
    });
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

  async function changeRole(
    actorUserId: string,
    groupId: GroupId,
    targetUserId: string,
    desiredRole: GroupRole,
  ) {
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
      if (target.role === desiredRole) return { kind: "role_conflict" as const };
      if (desiredRole === "member") {
        const members = await readAllMemberships(groupId);
        if (members.filter(({ role }) => role === "admin").length <= 1) {
          return { kind: "last_admin" as const };
        }
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
              fields: { role: { stringValue: desiredRole } },
            },
            updateMask: { fieldPaths: ["role"] },
            currentDocument: { updateTime: target.updateTime },
          },
        ]);
        return {
          kind: "changed" as const,
          member: publicMember({ ...target, role: desiredRole }),
        };
      } catch (error) {
        if (!isConcurrentWrite(error)) throw error;
      }
    }
    throw new Error("Member role change could not resolve concurrent writes.");
  }

  return Object.freeze({
    async ban(actorUserId, groupId, targetUser) {
      for (let attempt = 0; attempt < MAX_CONCURRENT_ATTEMPTS; attempt += 1) {
        const targetUserId = targetUser.userId;
        const group = await readGroup(groupPath(groupId));
        if (!group) return { kind: "not_found" as const };
        const [actor, target, existingBan, membershipEvidence] = await Promise.all([
          readMembership(membershipPath(groupId, actorUserId)),
          readMembership(membershipPath(groupId, targetUserId)),
          readBan(banPath(groupId, targetUserId)),
          readDocument(membershipEvidencePath(groupId, targetUserId)),
        ]);
        if (!actor) return { kind: "not_found" as const };
        if (actor.role !== "admin") return { kind: "forbidden" as const };
        if (actorUserId === targetUserId) {
          return { kind: "self_removal" as const };
        }
        if (existingBan) return { kind: "ban_not_allowed" as const };
        if (!target && !membershipEvidence) {
          return { kind: "user_not_found" as const };
        }
        if (target?.role === "admin") {
          const members = await readAllMemberships(groupId);
          if (members.filter(({ role }) => role === "admin").length <= 1) {
            return { kind: "last_admin" as const };
          }
        }
        const ban: OpenJobBan = {
          userId: targetUserId,
          username: targetUser.username,
          bannedAt: new Date(now()).toISOString(),
        };
        try {
          await commit([
            stateRevisionWrite(group),
            {
              verify: firestore.documentName(actor.path),
              currentDocument: { updateTime: actor.updateTime },
            },
            {
              update: {
                name: firestore.documentName(banPath(groupId, targetUserId)),
                fields: {
                  userId: { stringValue: ban.userId },
                  ...(ban.username
                    ? { username: { stringValue: ban.username } }
                    : {}),
                  bannedAt: { timestampValue: ban.bannedAt },
                },
              },
              currentDocument: { exists: false },
            },
            ...(target
              ? [
                  {
                    delete: firestore.documentName(target.path),
                    currentDocument: { updateTime: target.updateTime },
                  },
                  {
                    delete: firestore.documentName(
                      accessPath(targetUserId, groupId),
                    ),
                  },
                ]
              : [
                  {
                    verify: firestore.documentName(
                      membershipPath(groupId, targetUserId),
                    ),
                    currentDocument: { exists: false },
                  },
                ]),
            ...(membershipEvidence
              ? []
              : [membershipEvidenceWrite(groupId, targetUser)]),
          ]);
          return { kind: "banned" as const, ban };
        } catch (error) {
          if (!isConcurrentWrite(error)) throw error;
        }
      }
      throw new Error("Member Ban could not resolve concurrent writes.");
    },

    async create(user: GroupUser, name) {
      for (let attempt = 0; attempt < MAX_CONCURRENT_ATTEMPTS; attempt += 1) {
        const groupId = `grp_${randomUUID().replaceAll("-", "")}` as GroupId;
        const createdAt = new Date(now()).toISOString();
        const groupDocumentPath = groupPath(groupId);
        const memberDocumentPath = membershipPath(groupId, user.userId);
        const accessDocumentPath = accessPath(user.userId, groupId);
        const invite = freshInvite(groupId);
        const membershipId = crypto.randomUUID().replaceAll("-", "");
        try {
          await commit([
            groupIdReservationWrite(groupId),
            userHistoryWrite(user.userId),
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
                  membershipId: { stringValue: membershipId },
                  role: { stringValue: "admin" },
                  joinedAt: { timestampValue: createdAt },
                },
              },
              currentDocument: { exists: false },
            },
            membershipEvidenceWrite(groupId, user),
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
      const result = await changeRole(
        actorUserId,
        groupId,
        targetUserId,
        "member",
      );
      return result.kind === "changed"
        ? { kind: "demoted" as const, member: result.member }
        : result;
    },

    async end(actorUserId, groupId, confirmationName) {
      for (let attempt = 0; attempt < MAX_CONCURRENT_ATTEMPTS; attempt += 1) {
        const group = await readGroup(groupPath(groupId));
        if (!group) return { kind: "not_found" as const };
        const actor = await readMembership(
          membershipPath(groupId, actorUserId),
        );
        if (!actor) return { kind: "not_found" as const };
        if (actor.role !== "admin") return { kind: "forbidden" as const };
        if (group.name !== confirmationName) {
          return { kind: "confirmation_mismatch" as const };
        }

        const groupDocuments = await readAllGroupDocuments(groupId);
        if (groupDocuments.members.length !== 1) {
          return { kind: "members_remain" as const };
        }
        const inviteRoutes = groupDocuments.invite.map((document) =>
          inviteRoutePath(parseInvite(document, document.name).routeId),
        );
        const [access, reservation, ...routePointers] = await Promise.all([
          readDocument(accessPath(actorUserId, groupId)),
          readDocument(groupIdReservationPath(groupId)),
          ...inviteRoutes.map((path) => readDocument(path)),
        ]);
        const scopedDocuments = Object.values(groupDocuments).flat();
        const externalDocuments = [access, ...routePointers].filter(
          (document): document is FirestoreDocument => document !== null,
        );

        try {
          await commit([
            ...(reservation
              ? [
                  {
                    verify: reservation.name,
                    currentDocument: updateTimePrecondition(reservation),
                  },
                ]
              : [groupIdReservationWrite(groupId)]),
            ...scopedDocuments.map(deleteDocumentWrite),
            ...externalDocuments.map(deleteDocumentWrite),
            {
              delete: firestore.documentName(group.path),
              currentDocument: { updateTime: group.updateTime },
            },
          ]);
          return { kind: "ended" as const };
        } catch (error) {
          if (!isConcurrentWrite(error)) throw error;
        }
      }
      throw new Error("Group ending could not resolve concurrent writes.");
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
        const userBanPath = banPath(group.groupId, user.userId);
        const evidencePath = membershipEvidencePath(group.groupId, user.userId);
        const [existing, existingBan, membershipEvidence] = await Promise.all([
          readMembership(memberDocumentPath),
          readBan(userBanPath),
          readDocument(evidencePath),
        ]);
        if (existing) {
          return {
            kind: "joined" as const,
            group: publicGroup(group, existing.role),
          };
        }
        if (!user.username) return { kind: "username_required" as const };
        if (existingBan) {
          return { kind: "membership_denied" as const };
        }

        const joinedAt = new Date(now()).toISOString();
        const membershipId = crypto.randomUUID().replaceAll("-", "");
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
          userHistoryWrite(user.userId),
          {
            update: {
              name: firestore.documentName(memberDocumentPath),
              fields: {
                userId: { stringValue: user.userId },
                username: { stringValue: user.username },
                membershipId: { stringValue: membershipId },
                role: { stringValue: "member" },
                joinedAt: { timestampValue: joinedAt },
              },
            },
            currentDocument: { exists: false },
          },
          ...(membershipEvidence
            ? []
            : [membershipEvidenceWrite(group.groupId, user)]),
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

    async kick(actorUserId, groupId, targetUserId) {
      for (let attempt = 0; attempt < MAX_CONCURRENT_ATTEMPTS; attempt += 1) {
        const group = await readGroup(groupPath(groupId));
        if (!group) return { kind: "not_found" as const };
        const [actor, target, membershipEvidence] = await Promise.all([
          readMembership(membershipPath(groupId, actorUserId)),
          readMembership(membershipPath(groupId, targetUserId)),
          readDocument(membershipEvidencePath(groupId, targetUserId)),
        ]);
        if (!actor) return { kind: "not_found" as const };
        if (actor.role !== "admin") return { kind: "forbidden" as const };
        if (!target) return { kind: "member_not_found" as const };
        if (actorUserId === targetUserId) {
          return { kind: "self_removal" as const };
        }
        if (target.role === "admin") {
          const members = await readAllMemberships(groupId);
          if (members.filter(({ role }) => role === "admin").length <= 1) {
            return { kind: "last_admin" as const };
          }
        }
        try {
          await commit([
            stateRevisionWrite(group),
            {
              verify: firestore.documentName(actor.path),
              currentDocument: { updateTime: actor.updateTime },
            },
            {
              delete: firestore.documentName(target.path),
              currentDocument: { updateTime: target.updateTime },
            },
            {
              delete: firestore.documentName(accessPath(targetUserId, groupId)),
            },
            ...(membershipEvidence
              ? []
              : [
                  membershipEvidenceWrite(groupId, {
                    userId: targetUserId,
                    username: target.username,
                  }),
                ]),
          ]);
          return { kind: "kicked" as const };
        } catch (error) {
          if (!isConcurrentWrite(error)) throw error;
        }
      }
      throw new Error("Member Kick could not resolve concurrent writes.");
    },

    async leave(userId, groupId) {
      for (let attempt = 0; attempt < MAX_CONCURRENT_ATTEMPTS; attempt += 1) {
        const group = await readGroup(groupPath(groupId));
        if (!group) return { kind: "not_found" as const };
        const [member, membershipEvidence] = await Promise.all([
          readMembership(membershipPath(groupId, userId)),
          readDocument(membershipEvidencePath(groupId, userId)),
        ]);
        if (!member) return { kind: "not_found" as const };
        if (member.role === "admin") {
          const members = await readAllMemberships(groupId);
          if (members.filter(({ role }) => role === "admin").length <= 1) {
            return { kind: "last_admin" as const };
          }
        }
        if (await hasOpenTasksAssigned(groupId, userId, member.membershipId)) {
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
            ...(membershipEvidence
              ? []
              : [
                  membershipEvidenceWrite(groupId, {
                    userId,
                    username: member.username,
                  }),
                ]),
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

    async listBans(userId, groupId, { cursor, limit }) {
      const [member, group] = await Promise.all([
        readMembership(membershipPath(groupId, userId)),
        readGroup(groupPath(groupId)),
      ]);
      if (!member || !group) return { kind: "not_found" as const };
      if (member.role !== "admin") return { kind: "forbidden" as const };

      const parameters = new URLSearchParams({
        pageSize: String(limit),
        orderBy: "__name__",
      });
      if (cursor !== null) parameters.set("pageToken", cursor);
      let response;
      try {
        response = await firestore.request(
          `${groupPath(groupId)}/bans?${parameters}`,
        );
      } catch (error) {
        if (
          error instanceof FirestoreRequestError &&
          error.code === "INVALID_ARGUMENT"
        ) {
          throw new InvalidBanCursorError();
        }
        throw error;
      }
      const result = (await response.json()) as {
        documents?: FirestoreDocument[];
        nextPageToken?: string;
      };
      return {
        kind: "found" as const,
        bans: (result.documents ?? []).map((document) =>
          publicBan(parseBan(document, document.name)),
        ),
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
      const result = await changeRole(
        actorUserId,
        groupId,
        targetUserId,
        "admin",
      );
      if (result.kind === "last_admin") {
        throw new Error("Admin promotion returned a final-Admin conflict.");
      }
      return result.kind === "changed"
        ? { kind: "promoted" as const, member: result.member }
        : result;
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

    async unban(actorUserId, groupId, targetUserId) {
      for (let attempt = 0; attempt < MAX_CONCURRENT_ATTEMPTS; attempt += 1) {
        const group = await readGroup(groupPath(groupId));
        if (!group) return { kind: "not_found" as const };
        const [actor, ban] = await Promise.all([
          readMembership(membershipPath(groupId, actorUserId)),
          readBan(banPath(groupId, targetUserId)),
        ]);
        if (!actor) return { kind: "not_found" as const };
        if (actor.role !== "admin") return { kind: "forbidden" as const };
        if (!ban) return { kind: "ban_not_found" as const };
        try {
          await commit([
            stateRevisionWrite(group),
            {
              verify: firestore.documentName(actor.path),
              currentDocument: { updateTime: actor.updateTime },
            },
            {
              delete: firestore.documentName(ban.path),
              currentDocument: { updateTime: ban.updateTime },
            },
          ]);
          return { kind: "unbanned" as const };
        } catch (error) {
          if (!isConcurrentWrite(error)) throw error;
        }
      }
      throw new Error("Member unban could not resolve concurrent writes.");
    },
  });
}
