import { createNativeOpenJobApi } from "../src/auth/openjob-api";
import { OpenJobApiError, ProviderSignInError } from "../src/auth/coordinator";

const user = {
  userId: "usr_one",
  username: "walker",
  usernameRequired: false,
};

function jsonResponse(
  body: unknown,
  status = 200,
  headers: HeadersInit = {},
) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", ...headers },
    status,
  });
}

const task = {
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
};

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
    task,
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
      jsonResponse(
        { data: tasks, nextCursor: null },
        200,
        { etag: '"task-list-v1"' },
      ),
    )
    .mockResolvedValueOnce(
      new Response(null, {
        headers: { etag: '"task-list-v1"' },
        status: 304,
      }),
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
  ).resolves.toEqual({
    kind: "changed",
    tasks,
    validator: '"task-list-v1"',
  });

  expect(fetchImplementation.mock.calls.map(([url]) => url)).toEqual([
    "https://preview.example/api/v1/groups?limit=500",
    "https://preview.example/api/v1/groups?limit=500&cursor=groups-page-2",
    "https://preview.example/api/v1/groups/grp_one/members?limit=500",
    "https://preview.example/api/v1/groups/grp_one/tasks?status=all&limit=500",
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

test("sends If-None-Match on the first Task List request and accepts an empty 304", async () => {
  const fetchImplementation = jest.fn(async () =>
    new Response(null, {
      headers: { etag: '"task-list-v1"' },
      status: 304,
    }),
  );
  const api = createNativeOpenJobApi({
    apiBaseUrl: "https://preview.example/api/v1",
    fetchImplementation,
  });

  await expect(
    api.listTasks("token", "grp_one", '"task-list-v1"'),
  ).resolves.toEqual({
    kind: "not-modified",
    validator: '"task-list-v1"',
  });
  expect(fetchImplementation).toHaveBeenCalledWith(
    "https://preview.example/api/v1/groups/grp_one/tasks?status=all&limit=500",
    expect.objectContaining({
      headers: expect.objectContaining({
        "if-none-match": '"task-list-v1"',
      }),
    }),
  );
});

test.each([
  ["missing", undefined],
  ["malformed", "task-list-v1"],
] as const)("rejects %s Task List validators on 200 and 304", async (_label, etag) => {
  for (const response of [
    jsonResponse(
      { data: [task], nextCursor: null },
      200,
      etag ? { etag } : {},
    ),
    new Response(null, {
      headers: etag ? { etag } : {},
      status: 304,
    }),
  ]) {
    const api = createNativeOpenJobApi({
      apiBaseUrl: "https://preview.example/api/v1",
      fetchImplementation: jest.fn(async () => response),
    });
    await expect(
      api.listTasks("token", "grp_one", '"previous"'),
    ).rejects.toEqual(
      new OpenJobApiError(
        502,
        "invalid_response",
        "OpenJob returned an invalid Task List validator.",
      ),
    );
  }
});

test("paginates a changed Task List and revalidates the first representation before returning it", async () => {
  const secondTask = {
    ...task,
    taskId: "task_second",
    text: "Finish the second page",
  };
  const fetchImplementation = jest
    .fn()
    .mockResolvedValueOnce(
      jsonResponse(
        { data: [task], nextCursor: "tasks-page-2" },
        200,
        { etag: '"task-list-page-1-v2"' },
      ),
    )
    .mockResolvedValueOnce(
      jsonResponse(
        { data: [secondTask], nextCursor: null },
        200,
        { etag: '"task-list-page-2-v2"' },
      ),
    )
    .mockResolvedValueOnce(
      new Response(null, {
        headers: { etag: '"task-list-page-1-v2"' },
        status: 304,
      }),
    );
  const api = createNativeOpenJobApi({
    apiBaseUrl: "https://preview.example/api/v1",
    fetchImplementation,
  });

  await expect(
    api.listTasks("token", "grp_one", '"task-list-v1"'),
  ).resolves.toEqual({
    kind: "changed",
    tasks: [task, secondTask],
    validator: '"task-list-page-1-v2"',
  });
  expect(fetchImplementation.mock.calls.map(([url]) => url)).toEqual([
    "https://preview.example/api/v1/groups/grp_one/tasks?status=all&limit=500",
    "https://preview.example/api/v1/groups/grp_one/tasks?status=all&limit=500&cursor=tasks-page-2",
    "https://preview.example/api/v1/groups/grp_one/tasks?status=all&limit=500",
  ]);
  expect(fetchImplementation.mock.calls[0]?.[1]?.headers).toEqual(
    expect.objectContaining({ "if-none-match": '"task-list-v1"' }),
  );
  expect(fetchImplementation.mock.calls[1]?.[1]?.headers).not.toEqual(
    expect.objectContaining({ "if-none-match": expect.any(String) }),
  );
  expect(fetchImplementation.mock.calls[2]?.[1]?.headers).toEqual(
    expect.objectContaining({
      "if-none-match": '"task-list-page-1-v2"',
    }),
  );
});

test("rejects a continuation page that returns 304", async () => {
  const api = createNativeOpenJobApi({
    apiBaseUrl: "https://preview.example/api/v1",
    fetchImplementation: jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { data: [task], nextCursor: "tasks-page-2" },
          200,
          { etag: '"task-list-page-1-v2"' },
        ),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          headers: { etag: '"task-list-page-2-v2"' },
          status: 304,
        }),
      ),
  });

  await expect(api.listTasks("token", "grp_one")).rejects.toEqual(
    new OpenJobApiError(
      502,
      "invalid_response",
      "OpenJob returned an invalid paginated Task List response.",
    ),
  );
});

test("fails recoverably when the first Task List representation changes during pagination", async () => {
  const api = createNativeOpenJobApi({
    apiBaseUrl: "https://preview.example/api/v1",
    fetchImplementation: jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { data: [task], nextCursor: null },
          200,
          { etag: '"task-list-v2"' },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { data: [task], nextCursor: null },
          200,
          { etag: '"task-list-v3"' },
        ),
      ),
  });

  await expect(api.listTasks("token", "grp_one")).rejects.toEqual(
    new OpenJobApiError(
      409,
      "task_list_changed",
      "The Task List changed while it was loading.",
    ),
  );
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
      jsonResponse(
        {
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
        },
        200,
        { etag: '"task-list-v1"' },
      ),
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
