import {
  defaultRequestId,
  errorResponse,
  internalErrorResponse,
  isRateLimitError,
  jsonResponse,
  rateLimitedErrorResponse,
  type RequestIdFactory,
} from "./v1-http.ts";

declare const groupNameBrand: unique symbol;
declare const groupIdBrand: unique symbol;

export type GroupName = string & { readonly [groupNameBrand]: true };
export type GroupId = string & { readonly [groupIdBrand]: true };
export type GroupRole = "member" | "admin";

export type OpenJobGroup = {
  groupId: GroupId;
  name: string;
  role: GroupRole;
  createdAt: string;
};

export class InvalidGroupCursorError extends Error {
  constructor() {
    super("The Group collection cursor is invalid.");
    this.name = "InvalidGroupCursorError";
  }
}

export type GroupStore = {
  create(userId: string, name: GroupName): Promise<OpenJobGroup>;
  get(userId: string, groupId: GroupId): Promise<OpenJobGroup | null>;
  list(
    userId: string,
    options: { cursor: string | null; limit: number },
  ): Promise<{ groups: OpenJobGroup[]; nextCursor: string | null }>;
  rename(
    userId: string,
    groupId: GroupId,
    name: GroupName,
  ): Promise<
    | { kind: "renamed"; group: OpenJobGroup }
    | { kind: "forbidden" }
    | { kind: "not_found" }
  >;
};

type UserStore = {
  getOrCreate(firebaseUid: string): Promise<{ userId: string }>;
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

function adminRequired(requestId: RequestIdFactory) {
  return errorResponse(requestId, {
    code: "admin_required",
    message: "Group Admin access is required.",
    status: 403,
  });
}

function readPagination(
  url: URL,
):
  | { error: "cursor" | "limit" }
  | { cursor: string | null; limit: number } {
  const cursors = url.searchParams.getAll("cursor");
  const limits = url.searchParams.getAll("limit");
  if (cursors.length > 1 || cursors[0] === "") {
    return { error: "cursor" as const };
  }
  if (
    limits.length > 1 ||
    (limits.length === 1 &&
      (!/^\d+$/.test(limits[0]) ||
        Number(limits[0]) < 1 ||
        Number(limits[0]) > 500))
  ) {
    return { error: "limit" as const };
  }
  return {
    cursor: cursors[0] ?? null,
    limit: limits.length === 0 ? 100 : Number(limits[0]),
  };
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

function groupIdFromPath(pathname: string) {
  const match = pathname.match(/^\/api\/v1\/groups\/([^/]+)$/);
  if (!match) return { kind: "none" as const };
  try {
    const groupId = decodeURIComponent(match[1]);
    if (groupId.length > 1_500 || !/^grp_[A-Za-z0-9_-]+$/.test(groupId)) {
      return { kind: "invalid" as const };
    }
    return { kind: "valid" as const, groupId: groupId as GroupId };
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
            return jsonResponse(
              { data: await groups.create(user.userId, name) },
              201,
            );
          }
        }

        const groupPath = groupIdFromPath(url.pathname);
        if (groupPath.kind === "invalid") {
          return groupNotFound(requestId);
        }
        if (groupPath.kind === "valid") {
          const { groupId } = groupPath;
          if (request.method === "GET") {
            const group = await groups.get(user.userId, groupId);
            if (group) return jsonResponse({ data: group });
          }
          if (request.method === "PATCH") {
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
            if (result.kind === "forbidden") {
              return adminRequired(requestId);
            }
          }
          return groupNotFound(requestId);
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
