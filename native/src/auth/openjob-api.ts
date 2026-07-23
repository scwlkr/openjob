import {
  OpenJobApiError,
  type OpenJobUser,
  ProviderSignInError,
  type SignInMethod,
} from "./coordinator";
import type { FetchImplementation } from "./firebase-rest";

type NativeOpenJobApiConfig = {
  apiBaseUrl: string;
  fetchImplementation?: FetchImplementation;
};

function isUser(value: unknown): value is OpenJobUser {
  if (!value || typeof value !== "object") return false;
  const user = value as Partial<OpenJobUser>;
  return (
    typeof user.userId === "string" &&
    (typeof user.username === "string" || user.username === null) &&
    typeof user.usernameRequired === "boolean"
  );
}

function isMethod(value: unknown): value is SignInMethod {
  return value === "apple" || value === "google";
}

export function createNativeOpenJobApi({
  apiBaseUrl,
  fetchImplementation = fetch,
}: NativeOpenJobApiConfig) {
  const baseUrl = apiBaseUrl.replace(/\/+$/u, "");

  async function request<T>(
    path: string,
    token: string,
    init: RequestInit = {},
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetchImplementation(`${baseUrl}${path}`, {
        ...init,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
        method: init.method ?? "GET",
      });
    } catch {
      throw new ProviderSignInError("offline");
    }

    let body: {
      data?: unknown;
      error?: { code?: unknown; message?: unknown };
    } = {};
    try {
      body = (await response.json()) as typeof body;
    } catch {
      // Status handling below remains stable for empty or non-JSON edge errors.
    }
    if (!response.ok) {
      throw new OpenJobApiError(
        response.status,
        typeof body.error?.code === "string"
          ? body.error.code
          : "request_failed",
        typeof body.error?.message === "string"
          ? body.error.message
          : "OpenJob could not complete the request.",
      );
    }
    return body.data as T;
  }

  async function userRequest(
    path: string,
    token: string,
    init?: RequestInit,
  ) {
    const user = await request<unknown>(path, token, init);
    if (!isUser(user)) {
      throw new OpenJobApiError(
        502,
        "invalid_response",
        "OpenJob returned an invalid User.",
      );
    }
    return user;
  }

  return {
    createUser(token: string) {
      return userRequest("/me", token, {
        body: JSON.stringify({ confirmation: "create" }),
        method: "POST",
      });
    },

    getMe(token: string) {
      return userRequest("/me", token);
    },

    async listSignInMethods(token: string) {
      const methods = await request<unknown>("/me/sign-in-methods", token);
      if (!Array.isArray(methods) || !methods.every(isMethod)) {
        throw new OpenJobApiError(
          502,
          "invalid_response",
          "OpenJob returned invalid Sign-in Methods.",
        );
      }
      return methods;
    },

    linkSignInMethod(
      token: string,
      credentialToken: string,
      expectedTargetUserId: string,
    ) {
      return userRequest("/me/sign-in-methods", token, {
        body: JSON.stringify({
          confirmation: "link",
          credentialToken,
          expectedTargetUserId,
        }),
        method: "POST",
      });
    },
  };
}
