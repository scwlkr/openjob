import type { OpenJobUser } from "./v1-identity.ts";
import {
  defaultRequestId,
  errorResponse,
  internalErrorResponse,
  isRateLimitError,
  jsonResponse,
  rateLimitedErrorResponse,
} from "./v1-http.ts";

type StoredNotificationSubscription = {
  installationId: string;
  userId: string;
  state: "active" | "paused";
};

type NotificationSubscriptionStore = {
  get(installationId: string): Promise<StoredNotificationSubscription | null>;
  register(input: {
    installationId: string;
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }): Promise<StoredNotificationSubscription>;
  setState(
    installationId: string,
    userId: string,
    state: "active" | "paused",
  ): Promise<StoredNotificationSubscription | null>;
};

type NotificationSubscriptionsApiOptions = {
  requestId?: () => string;
  subscriptions: NotificationSubscriptionStore;
  users: { getOrCreate(firebaseUid: string): Promise<OpenJobUser> };
  verifyIdToken(request: Request): Promise<{ uid: string } | null>;
};

const SUBSCRIPTION_PATH =
  /^\/api\/v1\/me\/notification-subscriptions\/([^/]+)$/;
const BASE64_URL = /^[A-Za-z0-9_-]+$/;
const INSTALLATION_ID = /^[A-Za-z0-9_-]{16,128}$/;

function readRegistration(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const candidate = input as Record<string, unknown>;
  if (
    Object.keys(candidate).sort().join(",") !== "endpoint,keys" ||
    typeof candidate.endpoint !== "string" ||
    candidate.endpoint.length > 2_048 ||
    !candidate.keys ||
    typeof candidate.keys !== "object" ||
    Array.isArray(candidate.keys)
  ) {
    return null;
  }
  const keys = candidate.keys as Record<string, unknown>;
  if (
    Object.keys(keys).sort().join(",") !== "auth,p256dh" ||
    typeof keys.p256dh !== "string" ||
    keys.p256dh.length < 43 ||
    keys.p256dh.length > 128 ||
    !BASE64_URL.test(keys.p256dh) ||
    typeof keys.auth !== "string" ||
    keys.auth.length < 16 ||
    keys.auth.length > 64 ||
    !BASE64_URL.test(keys.auth)
  ) {
    return null;
  }
  try {
    const endpoint = new URL(candidate.endpoint);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) {
      return null;
    }
  } catch {
    return null;
  }
  return {
    endpoint: candidate.endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
  };
}

function notFound(requestId: () => string) {
  return errorResponse(requestId, {
    code: "notification_subscription_not_found",
    message: "Notification Subscription was not found.",
    status: 404,
  });
}

export function createV1NotificationSubscriptionsApi({
  requestId = defaultRequestId,
  subscriptions,
  users,
  verifyIdToken,
}: NotificationSubscriptionsApiOptions) {
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

        const match = new URL(request.url).pathname.match(SUBSCRIPTION_PATH);
        if (!match) return notFound(requestId);

        let installationId = "";
        try {
          installationId = decodeURIComponent(match[1]);
        } catch {
          // The validation response below deliberately avoids reflecting the path.
        }
        if (!INSTALLATION_ID.test(installationId)) {
          return errorResponse(requestId, {
            code: "invalid_request",
            message: "One or more fields are invalid.",
            fields: {
              installationId: "Use a 16 to 128 character opaque installation ID.",
            },
            status: 400,
          });
        }
        const user = await users.getOrCreate(identity.uid);
        if (request.method === "PUT") {
          const registration = readRegistration(await request.json().catch(() => null));
          if (!registration) {
            return errorResponse(requestId, {
              code: "invalid_request",
              message: "One or more fields are invalid.",
              fields: {
                subscription: "Provide one bounded HTTPS Push subscription.",
              },
              status: 400,
            });
          }
          const subscription = await subscriptions.register({
            installationId,
            userId: user.userId,
            ...registration,
          });
          return jsonResponse({
            data: {
              installationId: subscription.installationId,
              state: subscription.state,
            },
          });
        }
        if (request.method === "PATCH") {
          const input = (await request.json().catch(() => null)) as unknown;
          const valid =
            input !== null &&
            typeof input === "object" &&
            !Array.isArray(input) &&
            Object.keys(input).length === 1 &&
            "state" in input &&
            (input.state === "active" || input.state === "paused");
          if (!valid) {
            return errorResponse(requestId, {
              code: "invalid_request",
              message: "One or more fields are invalid.",
              fields: { state: "Use active or paused." },
              status: 400,
            });
          }
          const subscription = await subscriptions.setState(
            installationId,
            user.userId,
            (input as { state: "active" | "paused" }).state,
          );
          if (!subscription) return notFound(requestId);
          return jsonResponse({
            data: {
              installationId: subscription.installationId,
              state: subscription.state,
            },
          });
        }
        if (request.method !== "GET") return notFound(requestId);
        const subscription = await subscriptions.get(installationId);
        if (!subscription || subscription.userId !== user.userId) {
          return notFound(requestId);
        }
        return jsonResponse({
          data: {
            installationId: subscription.installationId,
            state: subscription.state,
          },
        });
      } catch (error) {
        if (isRateLimitError(error)) return rateLimitedErrorResponse(requestId);
        return internalErrorResponse(requestId);
      }
    },
  });
}

export function createV1NotificationSubscriptionsHandler(
  getApi: () => ReturnType<typeof createV1NotificationSubscriptionsApi>,
  requestId = defaultRequestId,
) {
  return async function handleV1NotificationSubscriptionsRequest(request: Request) {
    try {
      return await getApi().fetch(request);
    } catch {
      return internalErrorResponse(requestId);
    }
  };
}
