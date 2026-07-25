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

test("uses the authenticated contract for discovery, create, Username claim, and confirmed link", async () => {
  const fetchImplementation = jest
    .fn()
    .mockResolvedValueOnce(jsonResponse({ data: user }))
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
  await expect(
    api.claimUsername("current-token", "walker"),
  ).resolves.toEqual(user);
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
      "https://preview.example/api/v1/me/username",
      expect.objectContaining({
        body: JSON.stringify({ username: "walker" }),
        method: "PUT",
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

test("paginates real Groups, Members, and service-ordered Tasks through the authenticated contract", async () => {
  const groups = [
    {
      groupId: "grp_one",
      name: "Walker Workshop",
      role: "admin" as const,
      createdAt: "2026-07-20T12:00:00.000Z",
    },
    {
      groupId: "grp_two",
      name: "Field Notes",
      role: "member" as const,
      createdAt: "2026-07-21T12:00:00.000Z",
    },
  ];
  const members = [
    {
      userId: "usr_one",
      username: "walker",
      role: "admin" as const,
      joinedAt: "2026-07-20T12:00:00.000Z",
    },
    {
      userId: "usr_two",
      username: "qa-two",
      role: "member" as const,
      joinedAt: "2026-07-20T12:01:00.000Z",
    },
  ];
  const tasks = [
    {
      taskId: "task_high",
      groupId: "grp_one",
      text: "Keep the service order",
      assignee: {
        state: "assigned" as const,
        userId: "usr_two",
        username: "qa-two",
      },
      priority: "high" as const,
      dueDate: "2026-07-26",
      state: "open" as const,
      createdAt: "2026-07-20T12:02:00.000Z",
      completedAt: null,
    },
    {
      taskId: "task_unassigned",
      groupId: "grp_one",
      text: "Recover ownership",
      assignee: { state: "unassigned" as const },
      priority: "normal" as const,
      dueDate: null,
      state: "open" as const,
      createdAt: "2026-07-20T12:03:00.000Z",
      completedAt: null,
    },
  ];
  const fetchImplementation = jest
    .fn()
    .mockResolvedValueOnce(
      jsonResponse({ data: [groups[0]], nextCursor: "groups-page-2" }),
    )
    .mockResolvedValueOnce(
      jsonResponse({ data: [groups[1]], nextCursor: null }),
    )
    .mockResolvedValueOnce(
      jsonResponse({ data: members, nextCursor: null }),
    )
    .mockResolvedValueOnce(
      jsonResponse({ data: tasks, nextCursor: null }),
    );
  const api = createNativeOpenJobApi({
    apiBaseUrl: "https://preview.example/api/v1/",
    fetchImplementation,
  });

  await expect(api.listGroups("current-token")).resolves.toEqual(groups);
  await expect(
    api.listMembers("current-token", "grp_one"),
  ).resolves.toEqual(members);
  await expect(
    api.listTasks("current-token", "grp_one"),
  ).resolves.toEqual(tasks);

  expect(fetchImplementation.mock.calls.map(([url]) => url)).toEqual([
    "https://preview.example/api/v1/groups?limit=500",
    "https://preview.example/api/v1/groups?limit=500&cursor=groups-page-2",
    "https://preview.example/api/v1/groups/grp_one/members?limit=500",
    "https://preview.example/api/v1/groups/grp_one/tasks?status=all&limit=500",
  ]);
  for (const [, init] of fetchImplementation.mock.calls) {
    expect(init).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer current-token",
        }),
        method: "GET",
      }),
    );
  }
});

test("rejects malformed native Task List representations instead of inventing client rules", async () => {
  const invalidGroups = createNativeOpenJobApi({
    apiBaseUrl: "https://preview.example/api/v1",
    fetchImplementation: jest.fn(async () =>
      jsonResponse({
        data: [
          {
            groupId: "grp_one",
            name: "Walker Workshop",
            role: "owner",
            createdAt: "2026-07-20T12:00:00.000Z",
          },
        ],
        nextCursor: null,
      }),
    ),
  });
  await expect(invalidGroups.listGroups("token")).rejects.toEqual(
    new OpenJobApiError(
      502,
      "invalid_response",
      "OpenJob returned invalid Task List data.",
    ),
  );

  const invalidTasks = createNativeOpenJobApi({
    apiBaseUrl: "https://preview.example/api/v1",
    fetchImplementation: jest.fn(async () =>
      jsonResponse({
        data: [
          {
            taskId: "task_one",
            groupId: "grp_one",
            text: "Invalid completed state",
            assignee: { state: "unassigned" },
            priority: "normal",
            dueDate: null,
            state: "done",
            createdAt: "2026-07-20T12:00:00.000Z",
            completedAt: null,
          },
        ],
        nextCursor: null,
      }),
    ),
  });
  await expect(invalidTasks.listTasks("token", "grp_one")).rejects.toEqual(
    new OpenJobApiError(
      502,
      "invalid_response",
      "OpenJob returned invalid Task List data.",
    ),
  );
});
