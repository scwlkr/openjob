import {
  defaultRequestId,
  errorResponse,
  internalErrorResponse,
  isRateLimitError,
  jsonResponse,
  readPagination,
  rateLimitedErrorResponse,
  type RequestIdFactory,
} from "./v1-http.ts";

declare const groupNameBrand: unique symbol;
declare const groupIdBrand: unique symbol;
declare const inviteTokenBrand: unique symbol;

export type GroupName = string & { readonly [groupNameBrand]: true };
export type GroupId = string & { readonly [groupIdBrand]: true };
export type InviteToken = string & { readonly [inviteTokenBrand]: true };
export type GroupRole = "member" | "admin";

export function isGroupId(value: string): value is GroupId {
  return value.length <= 1_500 && /^grp_[A-Za-z0-9_-]+$/.test(value);
}

export type OpenJobGroup = {
  groupId: GroupId;
  name: string;
  role: GroupRole;
  createdAt: string;
};

export type OpenJobMember = {
  userId: string;
  username: string | null;
  role: GroupRole;
  joinedAt: string;
};

export type OpenJobInviteLink = {
  token: InviteToken;
  url: string;
  issuedAt: string;
  expiresAt: string;
  remainingJoins: number;
};

export type GroupUser = {
  userId: string;
  username: string | null;
};

export class InvalidGroupCursorError extends Error {
  constructor() {
    super("The Group collection cursor is invalid.");
    this.name = "InvalidGroupCursorError";
  }
}

export class InvalidMemberCursorError extends Error {
  constructor() {
    super("The Member collection cursor is invalid.");
    this.name = "InvalidMemberCursorError";
  }
}

export type GroupStore = {
  create(user: GroupUser, name: GroupName): Promise<OpenJobGroup>;
  demote(
    actorUserId: string,
    groupId: GroupId,
    targetUserId: string,
  ): Promise<
    | { kind: "demoted"; member: OpenJobMember }
    | { kind: "forbidden" }
    | { kind: "last_admin" }
    | { kind: "member_not_found" }
    | { kind: "not_found" }
    | { kind: "role_conflict" }
  >;
  get(userId: string, groupId: GroupId): Promise<OpenJobGroup | null>;
  getInvite(
    userId: string,
    groupId: GroupId,
  ): Promise<
    | { kind: "found"; invite: OpenJobInviteLink }
    | { kind: "forbidden" }
    | { kind: "not_found" }
  >;
  inspectInvite(
    token: InviteToken,
  ): Promise<{ kind: "found"; groupName: string } | { kind: "not_found" }>;
  joinInvite(
    user: GroupUser,
    token: InviteToken,
  ): Promise<
    | { kind: "joined"; group: OpenJobGroup }
    | { kind: "membership_denied" }
    | { kind: "not_found" }
    | { kind: "username_required" }
  >;
  kick(
    actorUserId: string,
    groupId: GroupId,
    targetUserId: string,
  ): Promise<
    | { kind: "kicked" }
    | { kind: "forbidden" }
    | { kind: "last_admin" }
    | { kind: "member_not_found" }
    | { kind: "not_found" }
    | { kind: "self_removal" }
  >;
  leave(
    userId: string,
    groupId: GroupId,
  ): Promise<
    | { kind: "left" }
    | { kind: "last_admin" }
    | { kind: "not_found" }
    | { kind: "open_tasks_assigned" }
  >;
  list(
    userId: string,
    options: { cursor: string | null; limit: number },
  ): Promise<{ groups: OpenJobGroup[]; nextCursor: string | null }>;
  listMembers(
    userId: string,
    groupId: GroupId,
    options: { cursor: string | null; limit: number },
  ): Promise<
    | {
        kind: "found";
        members: OpenJobMember[];
        nextCursor: string | null;
      }
    | { kind: "not_found" }
  >;
  promote(
    actorUserId: string,
    groupId: GroupId,
    targetUserId: string,
  ): Promise<
    | { kind: "promoted"; member: OpenJobMember }
    | { kind: "forbidden" }
    | { kind: "member_not_found" }
    | { kind: "not_found" }
    | { kind: "role_conflict" }
  >;
  rename(
    userId: string,
    groupId: GroupId,
    name: GroupName,
  ): Promise<
    | { kind: "renamed"; group: OpenJobGroup }
    | { kind: "forbidden" }
    | { kind: "not_found" }
  >;
  rotateInvite(
    userId: string,
    groupId: GroupId,
  ): Promise<
    | { kind: "rotated"; invite: OpenJobInviteLink }
    | { kind: "forbidden" }
    | { kind: "not_found" }
  >;
};

type UserStore = {
  getById(userId: string): Promise<GroupUser | null>;
  getOrCreate(firebaseUid: string): Promise<GroupUser>;
};

type GroupsApiOptions = {
  groups: GroupStore;
  requestId?: () => string;
  users: UserStore;
  verifyIdToken(request: Request): Promise<{ uid: string } | null>;
};

function groupNameError(requestId: RequestIdFactory) {
  return errorResponse(requestId, {
    code: "invalid_request",
    message: "One or more fields are invalid.",
    fields: { name: "Must contain 1 to 80 characters." },
    status: 400,
  });
}

function paginationError(
  field: "cursor" | "limit",
  requestId: RequestIdFactory,
) {
  return errorResponse(requestId, {
    code: "invalid_request",
    message: "One or more fields are invalid.",
    fields: {
      [field]:
        field === "limit"
          ? "Use an integer from 1 to 500."
          : "Use a cursor returned by this collection.",
    },
    status: 400,
  });
}

function groupNotFound(requestId: RequestIdFactory) {
  return errorResponse(requestId, {
    code: "group_not_found",
    message: "Group was not found.",
    status: 404,
  });
}

function inviteNotFound(requestId: RequestIdFactory) {
  return errorResponse(requestId, {
    code: "invite_not_found",
    message: "Invite Link is not valid.",
    status: 404,
  });
}

function adminRequired(requestId: RequestIdFactory) {
  return errorResponse(requestId, {
    code: "admin_required",
    message: "Group Admin access is required.",
    status: 403,
  });
}

function memberNotFound(requestId: RequestIdFactory) {
  return errorResponse(requestId, {
    code: "member_not_found",
    message: "Member was not found.",
    status: 404,
  });
}

function memberRoleConflict(requestId: RequestIdFactory, message: string) {
  return errorResponse(requestId, {
    code: "member_role_conflict",
    message,
    status: 409,
  });
}

function lastAdminConflict(requestId: RequestIdFactory) {
  return errorResponse(requestId, {
    code: "last_admin",
    message: "At least one Admin must remain.",
    status: 409,
  });
}

function selfRemovalConflict(requestId: RequestIdFactory) {
  return errorResponse(requestId, {
    code: "self_removal",
    message: "Use Leave Group to remove yourself.",
    status: 409,
  });
}

function openTasksAssignedConflict(requestId: RequestIdFactory) {
  return errorResponse(requestId, {
    code: "open_tasks_assigned",
    message: "Reassign or complete open Tasks before leaving.",
    status: 409,
  });
}

function usernameRequired(requestId: RequestIdFactory) {
  return errorResponse(requestId, {
    code: "username_required",
    message: "Claim a Username before joining a Group.",
    status: 409,
  });
}

async function readGroupName(request: Request) {
  try {
    const input = (await request.json()) as unknown;
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).length !== 1 ||
      !("name" in input) ||
      typeof input.name !== "string"
    ) {
      return null;
    }
    const name = input.name.trim();
    if (
      name.length === 0 ||
      Array.from(name).length > 80 ||
      /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/u.test(input.name)
    ) {
      return null;
    }
    return name as GroupName;
  } catch {
    return null;
  }
}

type GroupResource =
  | "group"
  | "invite"
  | "leave"
  | "members"
  | "rotate_invite";

function groupResourceFromPath(pathname: string) {
  const match = pathname.match(
    /^\/api\/v1\/groups\/([^/]+)(\/actions\/leave|\/members|\/invite-link|\/invite-link\/actions\/rotate)?$/,
  );
  if (!match) return { kind: "none" as const };
  try {
    const groupId = decodeURIComponent(match[1]);
    if (!isGroupId(groupId)) {
      return { kind: "invalid" as const };
    }
    const resources: Record<string, GroupResource> = {
      "": "group",
      "/invite-link": "invite",
      "/invite-link/actions/rotate": "rotate_invite",
      "/actions/leave": "leave",
      "/members": "members",
    };
    return {
      kind: "valid" as const,
      groupId: groupId as GroupId,
      resource: resources[match[2] ?? ""],
    };
  } catch {
    return { kind: "invalid" as const };
  }
}

function inviteResourceFromPath(pathname: string) {
  const match = pathname.match(/^\/api\/v1\/invites\/([^/]+)(\/actions\/join)?$/);
  if (!match) return { kind: "none" as const };
  try {
    const token = decodeURIComponent(match[1]);
    if (token.length > 1_500 || !/^ivt_[A-Za-z0-9_-]+$/.test(token)) {
      return { kind: "invalid" as const };
    }
    return {
      kind: "valid" as const,
      token: token as InviteToken,
      resource: match[2] ? ("join" as const) : ("inspect" as const),
    };
  } catch {
    return { kind: "invalid" as const };
  }
}

function memberActionFromPath(pathname: string) {
  const match = pathname.match(
    /^\/api\/v1\/groups\/([^/]+)\/members\/([^/]+)\/actions\/(promote|demote|kick)$/,
  );
  if (!match) return { kind: "none" as const };
  try {
    const groupId = decodeURIComponent(match[1]);
    const userId = decodeURIComponent(match[2]);
    if (
      !isGroupId(groupId) ||
      userId.length === 0 ||
      userId.length > 1_500 ||
      /[/?#]/.test(userId)
    ) {
      return { kind: "invalid" as const };
    }
    return {
      kind: "valid" as const,
      groupId: groupId as GroupId,
      userId,
      action: match[3] as "promote" | "demote" | "kick",
    };
  } catch {
    return { kind: "invalid" as const };
  }
}

export function createV1GroupsApi({
  groups,
  requestId = defaultRequestId,
  users,
  verifyIdToken,
}: GroupsApiOptions) {
  return Object.freeze({
    async fetch(request: Request) {
      try {
        const identity = await verifyIdToken(request);
        if (!identity) {
          return errorResponse(requestId, {
            code: "authentication_required",
            message: "Authentication is required.",
            status: 401,
          });
        }

        const user = await users.getOrCreate(identity.uid);
        const url = new URL(request.url);

        if (url.pathname === "/api/v1/groups") {
          if (request.method === "GET") {
            const pagination = readPagination(url);
            if ("error" in pagination) {
              return paginationError(pagination.error, requestId);
            }
            let page;
            try {
              page = await groups.list(user.userId, pagination);
            } catch (error) {
              if (error instanceof InvalidGroupCursorError) {
                return paginationError("cursor", requestId);
              }
              throw error;
            }
            return jsonResponse({
              data: page.groups,
              nextCursor: page.nextCursor,
            });
          }
          if (request.method === "POST") {
            const name = await readGroupName(request);
            if (name === null) return groupNameError(requestId);
            return jsonResponse({ data: await groups.create(user, name) }, 201);
          }
        }

        const groupPath = groupResourceFromPath(url.pathname);
        if (groupPath.kind === "invalid") {
          return groupNotFound(requestId);
        }
        if (groupPath.kind === "valid") {
          const { groupId, resource } = groupPath;
          if (resource === "group" && request.method === "GET") {
            const group = await groups.get(user.userId, groupId);
            if (group) return jsonResponse({ data: group });
            return groupNotFound(requestId);
          }
          if (resource === "group" && request.method === "PATCH") {
            const visibleGroup = await groups.get(user.userId, groupId);
            if (!visibleGroup) return groupNotFound(requestId);
            if (visibleGroup.role !== "admin") {
              return adminRequired(requestId);
            }
            const name = await readGroupName(request);
            if (name === null) return groupNameError(requestId);
            const result = await groups.rename(user.userId, groupId, name);
            if (result.kind === "renamed") {
              return jsonResponse({ data: result.group });
            }
            if (result.kind === "forbidden") return adminRequired(requestId);
            return groupNotFound(requestId);
          }
          if (resource === "members" && request.method === "GET") {
            const pagination = readPagination(url);
            if ("error" in pagination) {
              return paginationError(pagination.error, requestId);
            }
            let result;
            try {
              result = await groups.listMembers(user.userId, groupId, pagination);
            } catch (error) {
              if (error instanceof InvalidMemberCursorError) {
                return paginationError("cursor", requestId);
              }
              throw error;
            }
            if (result.kind === "not_found") return groupNotFound(requestId);
            const members = await Promise.all(
              result.members.map(async (member) => {
                const currentUser = await users.getById(member.userId);
                return {
                  ...member,
                  username: currentUser?.username ?? member.username,
                };
              }),
            );
            return jsonResponse({
              data: members,
              nextCursor: result.nextCursor,
            });
          }
          if (resource === "leave" && request.method === "POST") {
            const result = await groups.leave(user.userId, groupId);
            if (result.kind === "left") {
              return new Response(null, {
                status: 204,
                headers: { "cache-control": "no-store" },
              });
            }
            if (result.kind === "last_admin") {
              return lastAdminConflict(requestId);
            }
            if (result.kind === "open_tasks_assigned") {
              return openTasksAssignedConflict(requestId);
            }
            return groupNotFound(requestId);
          }
          if (resource === "invite" && request.method === "GET") {
            const result = await groups.getInvite(user.userId, groupId);
            if (result.kind === "found") {
              return jsonResponse({ data: result.invite });
            }
            if (result.kind === "forbidden") return adminRequired(requestId);
            return groupNotFound(requestId);
          }
          if (resource === "rotate_invite" && request.method === "POST") {
            const result = await groups.rotateInvite(user.userId, groupId);
            if (result.kind === "rotated") {
              return jsonResponse({ data: result.invite });
            }
            if (result.kind === "forbidden") return adminRequired(requestId);
            return groupNotFound(requestId);
          }
        }

        const memberActionPath = memberActionFromPath(url.pathname);
        if (memberActionPath.kind === "invalid") return memberNotFound(requestId);
        if (memberActionPath.kind === "valid" && request.method === "POST") {
          const result = await groups[memberActionPath.action](
            user.userId,
            memberActionPath.groupId,
            memberActionPath.userId,
          );
          if (result.kind === "kicked") {
            return new Response(null, {
              status: 204,
              headers: { "cache-control": "no-store" },
            });
          }
          if (result.kind === "promoted" || result.kind === "demoted") {
            const currentUser = await users.getById(result.member.userId);
            return jsonResponse({
              data: {
                ...result.member,
                username: currentUser?.username ?? result.member.username,
              },
            });
          }
          if (result.kind === "forbidden") return adminRequired(requestId);
          if (result.kind === "last_admin") {
            return lastAdminConflict(requestId);
          }
          if (result.kind === "self_removal") {
            return selfRemovalConflict(requestId);
          }
          if (result.kind === "role_conflict") {
            return memberRoleConflict(
              requestId,
              memberActionPath.action === "promote"
                ? "The Member is already an Admin."
                : "The Member is not an Admin.",
            );
          }
          return memberNotFound(requestId);
        }

        const invitePath = inviteResourceFromPath(url.pathname);
        if (invitePath.kind === "invalid") return inviteNotFound(requestId);
        if (invitePath.kind === "valid") {
          if (invitePath.resource === "inspect" && request.method === "GET") {
            const result = await groups.inspectInvite(invitePath.token);
            return result.kind === "found"
              ? jsonResponse({ data: { groupName: result.groupName } })
              : inviteNotFound(requestId);
          }
          if (invitePath.resource === "join" && request.method === "POST") {
            const result = await groups.joinInvite(user, invitePath.token);
            if (result.kind === "joined") {
              return jsonResponse({ data: result.group });
            }
            if (result.kind === "membership_denied") {
              return errorResponse(requestId, {
                code: "membership_denied",
                message: "Membership could not be granted.",
                status: 403,
              });
            }
            if (result.kind === "username_required") {
              return usernameRequired(requestId);
            }
            return inviteNotFound(requestId);
          }
        }

        return errorResponse(requestId, {
          code: "not_found",
          message: "The requested resource was not found.",
          status: 404,
        });
      } catch (error) {
        if (isRateLimitError(error)) {
          return rateLimitedErrorResponse(requestId);
        }
        return internalErrorResponse(requestId);
      }
    },
  });
}

export function createV1GroupsHandler(
  getGroupsApi: () => ReturnType<typeof createV1GroupsApi>,
  requestId = defaultRequestId,
) {
  return async function handleV1GroupsRequest(request: Request) {
    try {
      return await getGroupsApi().fetch(request);
    } catch {
      return internalErrorResponse(requestId);
    }
  };
}
