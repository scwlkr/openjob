import { createNativeOpenJobApi } from "../src/auth/openjob-api";
import { OpenJobApiError, ProviderSignInError } from "../src/auth/coordinator";

const user = {
  userId: "usr_one",
  username: "walker",
  usernameRequired: false,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

test("uses the authenticated contract for discovery, create, and confirmed link", async () => {
  const fetchImplementation = jest
    .fn()
    .mockResolvedValueOnce(jsonResponse({ data: user }))
    .mockResolvedValueOnce(jsonResponse({ data: user }))
    .mockResolvedValueOnce(jsonResponse({ data: ["apple", "google"] }))
    .mockResolvedValueOnce(jsonResponse({ data: user }));
  const api = createNativeOpenJobApi({
    apiBaseUrl: "https://preview.example/api/v1",
    fetchImplementation,
  });

  await expect(api.getMe("current-token")).resolves.toEqual(user);
  await expect(api.createUser("current-token")).resolves.toEqual(user);
  await expect(api.listSignInMethods("current-token")).resolves.toEqual([
    "apple",
    "google",
  ]);
  await expect(
    api.linkSignInMethod(
      "current-token",
      "fresh-second-token",
      "user_one",
    ),
  ).resolves.toEqual(user);

  expect(fetchImplementation.mock.calls).toEqual([
    [
      "https://preview.example/api/v1/me",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer current-token",
        }),
        method: "GET",
      }),
    ],
    [
      "https://preview.example/api/v1/me",
      expect.objectContaining({
        body: JSON.stringify({ confirmation: "create" }),
        method: "POST",
      }),
    ],
    [
      "https://preview.example/api/v1/me/sign-in-methods",
      expect.objectContaining({ method: "GET" }),
    ],
    [
      "https://preview.example/api/v1/me/sign-in-methods",
      expect.objectContaining({
        body: JSON.stringify({
          confirmation: "link",
          credentialToken: "fresh-second-token",
          expectedTargetUserId: "user_one",
        }),
        method: "POST",
      }),
    ],
  ]);
});

test("preserves API error codes and normalizes interrupted network requests", async () => {
  const conflict = createNativeOpenJobApi({
    apiBaseUrl: "https://preview.example/api/v1",
    fetchImplementation: jest.fn(async () =>
      jsonResponse(
        {
          error: {
            code: "sign_in_method_conflict",
            message: "Cannot link that method.",
          },
        },
        409,
      ),
    ),
  });
  await expect(conflict.getMe("token")).rejects.toEqual(
    new OpenJobApiError(
      409,
      "sign_in_method_conflict",
      "Cannot link that method.",
    ),
  );

  const offline = createNativeOpenJobApi({
    apiBaseUrl: "https://preview.example/api/v1",
    fetchImplementation: jest.fn(async () => {
      throw new TypeError("Network request failed");
    }),
  });
  await expect(offline.getMe("token")).rejects.toEqual(
    new ProviderSignInError("offline"),
  );

  const unavailable = createNativeOpenJobApi({
    apiBaseUrl: "https://preview.example/api/v1",
    fetchImplementation: jest.fn(async () =>
      new Response("upstream unavailable", {
        headers: { "content-type": "text/plain" },
        status: 503,
      }),
    ),
  });
  await expect(unavailable.getMe("token")).rejects.toEqual(
    new OpenJobApiError(
      503,
      "request_failed",
      "OpenJob could not complete the request.",
    ),
  );
});
