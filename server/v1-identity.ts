declare const usernameBrand: unique symbol;

import type { GroupStore, OpenJobGroup } from "./v1-groups";

export type Username = string & { readonly [usernameBrand]: true };

export type OpenJobUser = {
  userId: string;
  username: string | null;
};

type UserStore = {
  claimUsername(
    firebaseUid: string,
    username: Username,
  ): Promise<
    | { kind: "claimed"; user: OpenJobUser }
    | { kind: "immutable" }
    | { kind: "taken" }
  >;
  getOrCreate(firebaseUid: string): Promise<OpenJobUser>;
};

type IdentityApiOptions = {
  groups?: Pick<GroupStore, "list">;
  requestId?: () => string;
  users: UserStore;
  verifyIdToken(request: Request): Promise<{ uid: string } | null>;
};

const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,30}[a-z0-9])$/;
const RESERVED_USERNAMES = new Set([
  "admin",
  "support",
  "openjob",
  "unassigned",
  "me",
]);

function response(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function defaultRequestId() {
  return `req_${crypto.randomUUID().replaceAll("-", "")}`;
}

function internalErrorResponse(requestId: () => string) {
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

async function currentUser(
  user: OpenJobUser,
  groups?: Pick<GroupStore, "list">,
) {
  let accessibleGroups: OpenJobGroup[] = [];
  if (groups) {
    accessibleGroups = (
      await groups.list(user.userId, { cursor: null, limit: 500 })
    ).groups;
  }
  return {
    userId: user.userId,
    username: user.username,
    usernameRequired: user.username === null,
    groups: accessibleGroups,
  };
}

async function readUsername(request: Request) {
  try {
    const input = (await request.json()) as unknown;
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).length !== 1 ||
      !("username" in input) ||
      typeof input.username !== "string" ||
      !USERNAME_PATTERN.test(input.username)
    ) {
      return null;
    }
    return input.username as Username;
  } catch {
    return null;
  }
}

export function createV1IdentityApi({
  groups,
  requestId = defaultRequestId,
  users,
  verifyIdToken,
}: IdentityApiOptions) {
  return Object.freeze({
    async fetch(request: Request) {
      try {
        const url = new URL(request.url);
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

        if (request.method === "GET" && url.pathname === "/api/v1/me") {
          const user = await users.getOrCreate(identity.uid);
          return response({ data: await currentUser(user, groups) });
        }

        if (
          request.method === "PUT" &&
          url.pathname === "/api/v1/me/username"
        ) {
          const username = await readUsername(request);
          if (username === null) {
            return response(
              {
                error: {
                  code: "invalid_request",
                  message: "One or more fields are invalid.",
                  fields: {
                    username: "Use 2 to 32 lowercase letters, numbers, or internal ._- characters.",
                  },
                  requestId: requestId(),
                },
              },
              400,
            );
          }
          if (RESERVED_USERNAMES.has(username)) {
            return response(
              {
                error: {
                  code: "username_taken",
                  message: "That Username is unavailable.",
                  requestId: requestId(),
                },
              },
              409,
            );
          }
          const result = await users.claimUsername(identity.uid, username);
          if (result.kind === "claimed") {
            return response({ data: await currentUser(result.user, groups) });
          }
          const immutable = result.kind === "immutable";
          return response(
            {
              error: {
                code: immutable ? "username_immutable" : "username_taken",
                message: immutable
                  ? "Username cannot be changed."
                  : "That Username is unavailable.",
                requestId: requestId(),
              },
            },
            409,
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
        return internalErrorResponse(requestId);
      }
    },
  });
}

export function createV1IdentityHandler(
  getIdentityApi: () => ReturnType<typeof createV1IdentityApi>,
  requestId = defaultRequestId,
) {
  return async function handleV1IdentityRequest(request: Request) {
    try {
      return await getIdentityApi().fetch(request);
    } catch {
      return internalErrorResponse(requestId);
    }
  };
}
