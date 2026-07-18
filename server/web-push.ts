import {
  buildPushHTTPRequest,
  type BuilderOptions,
  type PushSubscription,
} from "@pushforge/builder";
import type { StoredNotificationSubscription } from "../db/notification-subscriptions.ts";
import type { TaskPushMessage } from "./task-notifications.ts";

type WebPushSenderOptions = {
  vapid: {
    subject: string;
    publicKey: string;
    privateKey: string;
  };
  buildRequest?: (options: BuilderOptions) => ReturnType<typeof buildPushHTTPRequest>;
  fetchImplementation?: typeof fetch;
};

function base64UrlBytes(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function privateJwk(publicKey: string, privateKey: string): JsonWebKey {
  const publicBytes = base64UrlBytes(publicKey);
  const privateBytes = base64UrlBytes(privateKey);
  if (
    publicBytes.length !== 65 ||
    publicBytes[0] !== 4 ||
    privateBytes.length !== 32
  ) {
    throw new Error("The VAPID key pair is invalid.");
  }
  return {
    kty: "EC",
    crv: "P-256",
    x: base64Url(publicBytes.slice(1, 33)),
    y: base64Url(publicBytes.slice(33, 65)),
    d: base64Url(privateBytes),
  };
}

export function createWebPushSender({
  vapid,
  buildRequest: build = buildPushHTTPRequest,
  fetchImplementation = fetch,
}: WebPushSenderOptions) {
  return Object.freeze({
    async send(
      subscription: StoredNotificationSubscription,
      message: TaskPushMessage,
    ) {
      const pushSubscription: PushSubscription = {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      };
      const payload = await build({
        privateJWK: privateJwk(vapid.publicKey, vapid.privateKey),
        subscription: pushSubscription,
        message: {
          payload: message.data,
          adminContact: vapid.subject,
          options: { ttl: message.ttl },
        },
      });
      const response = await fetchImplementation(
        payload.endpoint,
        { method: "POST", headers: payload.headers, body: payload.body },
      );
      return { status: response.status };
    },
  });
}
