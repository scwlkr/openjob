type OpenJobUser = {
  userId: string;
  username: string | null;
};

type UserStore = {
  claimUsername(
    firebaseUid: string,
    username: string,
  ): Promise<
    | { kind: "claimed"; user: OpenJobUser }
    | { kind: "immutable" }
    | { kind: "taken" }
  >;
  getOrCreate(firebaseUid: string): Promise<OpenJobUser>;
};

type IdentityApiOptions = {
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

function currentUser(user: OpenJobUser) {
  return {
    userId: user.userId,
    username: user.username,
    usernameRequired: user.username === null,
    groups: [],
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
    return input.username;
  } catch {
    return null;
  }
}

export function createV1IdentityApi({
  requestId = () => `req_${crypto.randomUUID().replaceAll("-", "")}`,
  users,
  verifyIdToken,
}: IdentityApiOptions) {
  return Object.freeze({
    async fetch(request: Request) {
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
        return response({ data: currentUser(user) });
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
          return response({ data: currentUser(result.user) });
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
    },
  });
}
