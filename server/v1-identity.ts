import type { FirebaseTokenIdentity } from "./firebase-id-token";
import type { GroupStore, OpenJobGroup } from "./v1-groups";
import {
  defaultRequestId,
  errorResponse,
  internalErrorResponse,
  isRateLimitError,
  jsonResponse,
  rateLimitedErrorResponse,
  signInMethodUnrecognizedResponse,
} from "./v1-http.ts";

declare const usernameBrand: unique symbol;

export type Username = string & { readonly [usernameBrand]: true };

export type OpenJobUser = {
  userId: string;
  username: string | null;
};

type UserStore = {
  create(
    identity: FirebaseTokenIdentity,
  ): Promise<
    | { kind: "created"; user: OpenJobUser }
    | { kind: "existing"; user: OpenJobUser }
  >;
  claimUsername(
    identity: FirebaseTokenIdentity,
    username: Username,
  ): Promise<
    | { kind: "claimed"; user: OpenJobUser }
    | { kind: "immutable" }
    | { kind: "taken" }
    | { kind: "unrecognized" }
  >;
  link(
    current: FirebaseTokenIdentity,
    candidate: FirebaseTokenIdentity,
    expectedTargetUserId: string,
  ): Promise<
    | { kind: "linked"; user: OpenJobUser }
    | { kind: "conflict" }
    | { kind: "target_changed" }
    | { kind: "unrecognized" }
  >;
  listSignInMethods(userId: string): Promise<FirebaseTokenIdentity["provider"][]>;
  resolve(identity: FirebaseTokenIdentity): Promise<OpenJobUser | null>;
};

type IdentityApiOptions = {
  groups: Pick<GroupStore, "list">;
  now?: () => number;
  requestId?: () => string;
  users: UserStore;
  verifyCredentialToken?(
    token: string,
  ): Promise<FirebaseTokenIdentity | null>;
  verifyIdToken(request: Request): Promise<FirebaseTokenIdentity | null>;
};

const SIGN_IN_METHODS_PATH = "/api/v1/me/sign-in-methods";
const FRESH_AUTHENTICATION_WINDOW_MS = 5 * 60_000;

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

async function confirmsUserCreation(request: Request) {
  try {
    const input = (await request.json()) as unknown;
    return Boolean(
      input &&
        typeof input === "object" &&
        !Array.isArray(input) &&
        Object.keys(input).length === 1 &&
        "confirmation" in input &&
        input.confirmation === "create",
    );
  } catch {
    return false;
  }
}

async function readLinkConfirmation(request: Request) {
  try {
    const input = (await request.json()) as unknown;
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const candidate = input as Record<string, unknown>;
    if (
      Object.keys(candidate).sort().join(",") !==
        "confirmation,credentialToken,expectedTargetUserId" ||
      candidate.confirmation !== "link" ||
      typeof candidate.credentialToken !== "string" ||
      candidate.credentialToken.length < 1 ||
      candidate.credentialToken.length > 8_192 ||
      typeof candidate.expectedTargetUserId !== "string" ||
      candidate.expectedTargetUserId.length < 1 ||
      candidate.expectedTargetUserId.length > 256
    ) {
      return null;
    }
    return {
      credentialToken: candidate.credentialToken,
      expectedTargetUserId: candidate.expectedTargetUserId,
    };
  } catch {
    return null;
  }
}

function freshAuthenticationRequired(requestId: () => string) {
  return errorResponse(requestId, {
    code: "fresh_authentication_required",
    message: "Authenticate the additional Sign-in Method again.",
    status: 401,
  });
}

function signInMethodConflict(requestId: () => string) {
  return errorResponse(requestId, {
    code: "sign_in_method_conflict",
    message: "That Sign-in Method cannot be linked.",
    status: 409,
  });
}

function linkTargetChanged(requestId: () => string) {
  return errorResponse(requestId, {
    code: "link_target_changed",
    message: "The User to keep changed. Authenticate and confirm again.",
    status: 409,
  });
}

export function createV1IdentityApi({
  groups,
  now = Date.now,
  requestId = defaultRequestId,
  users,
  verifyCredentialToken = async () => null,
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

        if (url.pathname === SIGN_IN_METHODS_PATH) {
          if (request.method === "GET") {
            const user = await users.resolve(identity);
            if (!user) return signInMethodUnrecognizedResponse(requestId);
            return jsonResponse({
              data: await users.listSignInMethods(user.userId),
            });
          }

          if (request.method === "POST") {
            const confirmation = await readLinkConfirmation(request);
            if (!confirmation) {
              return errorResponse(requestId, {
                code: "invalid_request",
                message: "One or more fields are invalid.",
                fields: {
                  confirmation:
                    "Explicitly confirm linking with one fresh credential.",
                },
                status: 400,
              });
            }
            const candidate = await verifyCredentialToken(
              confirmation.credentialToken,
            );
            const checkedAt = now();
            if (
              !candidate ||
              candidate.authenticatedAt > checkedAt ||
              checkedAt - candidate.authenticatedAt >
                FRESH_AUTHENTICATION_WINDOW_MS
            ) {
              return freshAuthenticationRequired(requestId);
            }
            if (candidate.provider === identity.provider) {
              return signInMethodConflict(requestId);
            }
            const result = await users.link(
              identity,
              candidate,
              confirmation.expectedTargetUserId,
            );
            if (result.kind === "unrecognized") {
              return signInMethodUnrecognizedResponse(requestId);
            }
            if (result.kind === "conflict") {
              return signInMethodConflict(requestId);
            }
            if (result.kind === "target_changed") {
              return linkTargetChanged(requestId);
            }
            return jsonResponse({
              data: await currentUser(result.user, groups),
            });
          }
        }

        if (request.method === "POST" && url.pathname === "/api/v1/me") {
          if (!(await confirmsUserCreation(request))) {
            return errorResponse(requestId, {
              code: "invalid_request",
              message: "One or more fields are invalid.",
              fields: {
                confirmation: "Explicitly confirm User creation.",
              },
              status: 400,
            });
          }
          const result = await users.create(identity);
          return jsonResponse(
            { data: await currentUser(result.user, groups) },
            result.kind === "created" ? 201 : 200,
          );
        }

        if (request.method === "GET" && url.pathname === "/api/v1/me") {
          const user = await users.resolve(identity);
          if (!user) return signInMethodUnrecognizedResponse(requestId);
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
          const user = await users.resolve(identity);
          if (!user) return signInMethodUnrecognizedResponse(requestId);
          const result = await users.claimUsername(identity, username);
          if (result.kind === "unrecognized") {
            return signInMethodUnrecognizedResponse(requestId);
          }
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
