declare const groupNameBrand: unique symbol;

export type GroupName = string & { readonly [groupNameBrand]: true };
export type GroupRole = "member" | "admin";

export type OpenJobGroup = {
  groupId: string;
  name: string;
  role: GroupRole;
  createdAt: string;
};

export type GroupStore = {
  create(userId: string, name: GroupName): Promise<OpenJobGroup>;
  get(userId: string, groupId: string): Promise<OpenJobGroup | null>;
  list(
    userId: string,
    options: { cursor: string | null; limit: number },
  ): Promise<{ groups: OpenJobGroup[]; nextCursor: string | null }>;
  rename(
    userId: string,
    groupId: string,
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

function response(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function defaultRequestId() {
  return `req_${crypto.randomUUID().replaceAll("-", "")}`;
}

function groupNameError(requestId: () => string) {
  return response(
    {
      error: {
        code: "invalid_request",
        message: "One or more fields are invalid.",
        fields: { name: "Must contain 1 to 80 characters." },
        requestId: requestId(),
      },
    },
    400,
  );
}

function paginationError(field: "cursor" | "limit", requestId: () => string) {
  return response(
    {
      error: {
        code: "invalid_request",
        message: "One or more fields are invalid.",
        fields: {
          [field]:
            field === "limit"
              ? "Use an integer from 1 to 500."
              : "Use a cursor returned by this collection.",
        },
        requestId: requestId(),
      },
    },
    400,
  );
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
  return match ? decodeURIComponent(match[1]) : null;
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
          return response(
            {
              error: {
                code: "authentication_required",
                message: "Authentication is required.",
                requestId: requestId(),
              },
            },
            401,
          );
        }

        const user = await users.getOrCreate(identity.uid);
        const url = new URL(request.url);

        if (url.pathname === "/api/v1/groups") {
          if (request.method === "GET") {
            const pagination = readPagination(url);
            if ("error" in pagination) {
              return paginationError(pagination.error, requestId);
            }
            const page = await groups.list(user.userId, pagination);
            return response({ data: page.groups, nextCursor: page.nextCursor });
          }
          if (request.method === "POST") {
            const name = await readGroupName(request);
            if (name === null) return groupNameError(requestId);
            return response({ data: await groups.create(user.userId, name) }, 201);
          }
        }

        const groupId = groupIdFromPath(url.pathname);
        if (groupId !== null) {
          if (request.method === "GET") {
            const group = await groups.get(user.userId, groupId);
            if (group) return response({ data: group });
          }
          if (request.method === "PATCH") {
            const visibleGroup = await groups.get(user.userId, groupId);
            if (!visibleGroup) {
              return response(
                {
                  error: {
                    code: "group_not_found",
                    message: "Group was not found.",
                    requestId: requestId(),
                  },
                },
                404,
              );
            }
            if (visibleGroup.role !== "admin") {
              return response(
                {
                  error: {
                    code: "admin_required",
                    message: "Group Admin access is required.",
                    requestId: requestId(),
                  },
                },
                403,
              );
            }
            const name = await readGroupName(request);
            if (name === null) return groupNameError(requestId);
            const result = await groups.rename(user.userId, groupId, name);
            if (result.kind === "renamed") {
              return response({ data: result.group });
            }
            if (result.kind === "forbidden") {
              return response(
                {
                  error: {
                    code: "admin_required",
                    message: "Group Admin access is required.",
                    requestId: requestId(),
                  },
                },
                403,
              );
            }
          }
          return response(
            {
              error: {
                code: "group_not_found",
                message: "Group was not found.",
                requestId: requestId(),
              },
            },
            404,
          );
        }

        return response(
          {
            error: {
              code: "not_found",
              message: "The requested resource was not found.",
              requestId: requestId(),
            },
          },
          404,
        );
      } catch {
        return response(
          {
            error: {
              code: "internal_error",
              message: "An unexpected error occurred.",
              requestId: requestId(),
            },
          },
          500,
        );
      }
    },
  });
}
