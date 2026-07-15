import type { GroupStore, OpenJobGroup } from "./v1-groups";
import {
  defaultRequestId,
  errorResponse,
  internalErrorResponse,
  isRateLimitError,
  jsonResponse,
  rateLimitedErrorResponse,
} from "./v1-http.ts";

declare const usernameBrand: unique symbol;

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
  groups: Pick<GroupStore, "list">;
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

export function isUsernameSyntax(value: unknown): value is Username {
  return typeof value === "string" && USERNAME_PATTERN.test(value);
}

export function isReservedUsername(value: string) {
  return RESERVED_USERNAMES.has(value);
}

async function currentUser(
  user: OpenJobUser,
  groups: Pick<GroupStore, "list">,
) {
  const accessibleGroups: OpenJobGroup[] = [];
  let cursor: string | null = null;
  do {
    const page = await groups.list(user.userId, { cursor, limit: 500 });
    accessibleGroups.push(...page.groups);
    cursor = page.nextCursor;
  } while (cursor !== null);
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
      !isUsernameSyntax(input.username)
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
          return errorResponse(requestId, {
            code: "authentication_required",
            message: "Authentication is required.",
            status: 401,
          });
        }

        if (request.method === "GET" && url.pathname === "/api/v1/me") {
          const user = await users.getOrCreate(identity.uid);
          return jsonResponse({ data: await currentUser(user, groups) });
        }

        if (
          request.method === "PUT" &&
          url.pathname === "/api/v1/me/username"
        ) {
          const username = await readUsername(request);
          if (username === null) {
            return errorResponse(requestId, {
              code: "invalid_request",
              message: "One or more fields are invalid.",
              fields: {
                username: "Use 2 to 32 lowercase letters, numbers, or internal ._- characters.",
              },
              status: 400,
            });
          }
          if (isReservedUsername(username)) {
            return errorResponse(requestId, {
              code: "username_taken",
              message: "That Username is unavailable.",
              status: 409,
            });
          }
          const result = await users.claimUsername(identity.uid, username);
          if (result.kind === "claimed") {
            return jsonResponse({ data: await currentUser(result.user, groups) });
          }
          const immutable = result.kind === "immutable";
          return errorResponse(requestId, {
            code: immutable ? "username_immutable" : "username_taken",
            message: immutable
              ? "Username cannot be changed."
              : "That Username is unavailable.",
            status: 409,
          });
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
