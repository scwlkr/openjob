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

test("prepares, binds, and reads a protected deletion-status capability", async () => {
  const statusToken = "v1.deletionStatusCapability.signaturePayload";
  const submissionExpiresAt = "2026-07-28T12:05:00.000Z";
  const pending = {
    deadline: "2026-08-04T12:00:00.000Z",
    reauthenticationProviders: [] as Array<"apple" | "google">,
    requestedAt: "2026-07-28T12:00:00.000Z",
    status: "pending" as const,
  };
  const fetchImplementation = jest
    .fn()
    .mockResolvedValueOnce(
      jsonResponse({
        data: {
          status: "not_started",
          statusToken,
          submissionExpiresAt,
        },
      }),
    )
    .mockResolvedValueOnce(
      jsonResponse(
        {
          data: {
            ...pending,
            statusToken,
          },
        },
        202,
      ),
    )
    .mockResolvedValueOnce(jsonResponse({ data: pending }))
    .mockResolvedValueOnce(
      jsonResponse({ data: { status: "completed" } }),
    )
    .mockResolvedValueOnce(
      jsonResponse({
        data: {
          status: "not_started",
          submissionExpired: false,
          submissionExpiresAt,
        },
      }),
    )
    .mockResolvedValueOnce(
      jsonResponse({
        data: {
          status: "not_started",
          submissionExpired: true,
          submissionExpiresAt,
        },
      }),
    );
  const api = createNativeOpenJobApi({
    apiBaseUrl: "https://preview.example/api/v1",
    fetchImplementation,
  });

  await expect(api.prepareDeletionStatus("firebase-token")).resolves.toEqual({
    status: "not_started",
    statusToken,
    submissionExpiresAt,
  });
  await expect(
    api.deleteUser("firebase-token", [], statusToken),
  ).resolves.toEqual({
    ...pending,
    statusToken,
  });
  await expect(
    api.getDeletionStatus(statusToken),
  ).resolves.toEqual(pending);
  await expect(
    api.getDeletionStatus(statusToken),
  ).resolves.toEqual({ status: "completed" });
  await expect(api.getDeletionStatus(statusToken)).resolves.toEqual({
    status: "not_started",
    submissionExpired: false,
    submissionExpiresAt,
  });
  await expect(api.getDeletionStatus(statusToken)).resolves.toEqual({
    status: "not_started",
    submissionExpired: true,
    submissionExpiresAt,
  });

  expect(fetchImplementation.mock.calls[0]).toEqual([
    "https://preview.example/api/v1/me/deletion",
    expect.objectContaining({
      headers: expect.objectContaining({
        authorization: "Bearer firebase-token",
      }),
      method: "PUT",
    }),
  ]);
  expect(fetchImplementation.mock.calls[1]).toEqual([
    "https://preview.example/api/v1/me/deletion",
    expect.objectContaining({
      body: JSON.stringify({ confirmation: "delete", credentials: [] }),
      headers: expect.objectContaining({
        authorization: "Bearer firebase-token",
        "x-openjob-deletion-status": statusToken,
      }),
      method: "POST",
    }),
  ]);
  expect(fetchImplementation.mock.calls[2]).toEqual([
    "https://preview.example/api/v1/me/deletion",
    expect.objectContaining({
      headers: expect.objectContaining({
        authorization: `Bearer ${statusToken}`,
      }),
      method: "GET",
    }),
  ]);
});

test("submits the exact fresh provider proof to deletion recovery PUT and accepts a completed race", async () => {
  const credential = {
    credentialToken: "fresh-firebase-id-token",
    provider: "google" as const,
    revocation: {
      idToken: "raw-google-id-token",
      kind: "access_token" as const,
      value: "fresh-google-access-token",
    },
  };
  const fetchImplementation = jest.fn(async () =>
    jsonResponse({
      data: {
        completedAt: "2026-07-28T12:00:00.000Z",
        status: "completed",
      },
    }),
  );
  const api = createNativeOpenJobApi({
    apiBaseUrl: "https://preview.example/api/v1",
    fetchImplementation,
  });

  await expect(
    api.prepareDeletionStatus("fresh-firebase-id-token", credential),
  ).resolves.toEqual({ status: "completed" });
  expect(fetchImplementation).toHaveBeenCalledWith(
    "https://preview.example/api/v1/me/deletion",
    expect.objectContaining({
      body: JSON.stringify({ credential }),
      headers: expect.objectContaining({
        authorization: "Bearer fresh-firebase-id-token",
        "content-type": "application/json",
      }),
      method: "PUT",
    }),
  );
});

test("accepts a timestamped immediate deletion completion without retaining its timestamp", async () => {
  const api = createNativeOpenJobApi({
    apiBaseUrl: "https://preview.example/api/v1",
    fetchImplementation: jest.fn(async () =>
      jsonResponse({
        data: {
          completedAt: "2026-07-28T12:00:00.000Z",
          status: "completed",
        },
      }),
    ),
  });

  await expect(
    api.deleteUser(
      "firebase-token",
      [],
      "v1.deletionStatusCapability.signaturePayload",
    ),
  ).resolves.toEqual({ status: "completed" });
});

test("refreshes one pending provider with the status capability and exact proof", async () => {
  const statusToken = "v1.deletionStatusCapability.signaturePayload";
  const pending = {
    deadline: "2026-08-04T12:00:00.000Z",
    reauthenticationProviders: [] as Array<"apple" | "google">,
    requestedAt: "2026-07-28T12:00:00.000Z",
    status: "pending" as const,
    statusToken,
  };
  const fetchImplementation = jest.fn(async () =>
    jsonResponse({ data: pending }, 202),
  );
  const api = createNativeOpenJobApi({
    apiBaseUrl: "https://preview.example/api/v1",
    fetchImplementation,
  });
  const credential = {
    credentialToken: "fresh-firebase-token",
    provider: "google" as const,
    revocation: {
      idToken: "raw-google-id-token",
      kind: "access_token" as const,
      value: "google-access-token",
    },
  };

  await expect(
    api.refreshDeletionProvider(statusToken, credential),
  ).resolves.toEqual(pending);
  expect(fetchImplementation).toHaveBeenCalledWith(
    "https://preview.example/api/v1/me/deletion",
    expect.objectContaining({
      body: JSON.stringify({ credential }),
      headers: expect.objectContaining({
        authorization: `Bearer ${statusToken}`,
      }),
      method: "PATCH",
    }),
  );
});

test("accepts an exact already-pending deletion from PUT preflight", async () => {
  const pending = {
    deadline: "2026-08-04T12:00:00.000Z",
    reauthenticationProviders: [] as Array<"apple" | "google">,
    requestedAt: "2026-07-28T12:00:00.000Z",
    status: "pending" as const,
    statusToken: "v1.pendingJobCapability.signaturePayload",
  };
  const fetchImplementation = jest.fn(async () =>
    jsonResponse({ data: pending }, 202),
  );
  const api = createNativeOpenJobApi({
    apiBaseUrl: "https://preview.example/api/v1",
    fetchImplementation,
  });

  await expect(api.prepareDeletionStatus("firebase-token")).resolves.toEqual(
    pending,
  );
  expect(fetchImplementation).toHaveBeenCalledWith(
    "https://preview.example/api/v1/me/deletion",
    expect.objectContaining({
      headers: expect.objectContaining({
        authorization: "Bearer firebase-token",
      }),
      method: "PUT",
    }),
  );
  expect(pending).not.toHaveProperty("submissionExpiresAt");
});

test("rejects a pending deletion response that echoes a different status capability", async () => {
  const preparedStatusToken =
    "v1.deletionStatusCapability.signaturePayload";
  const api = createNativeOpenJobApi({
    apiBaseUrl: "https://preview.example/api/v1",
    fetchImplementation: jest.fn(async () =>
      jsonResponse(
        {
          data: {
            deadline: "2026-08-04T12:00:00.000Z",
            requestedAt: "2026-07-28T12:00:00.000Z",
            status: "pending",
            statusToken: "v1.differentStatusCapability.signaturePayload",
          },
        },
        202,
      ),
    ),
  });

  await expect(
    api.deleteUser("firebase-token", [], preparedStatusToken),
  ).rejects.toEqual(
    new OpenJobApiError(
      502,
      "invalid_response",
      "OpenJob returned an invalid deletion status.",
    ),
  );
});

test.each([
  [
    "pending POST without a capability",
    "deleteUser" as const,
    {
      deadline: "2026-08-04T12:00:00.000Z",
      requestedAt: "2026-07-28T12:00:00.000Z",
      status: "pending",
    },
  ],
  [
    "pending status without its metadata",
    "getDeletionStatus" as const,
    { status: "pending" },
  ],
  [
    "completed POST without a completion timestamp",
    "deleteUser" as const,
    { status: "completed" },
  ],
  [
    "unknown status",
    "getDeletionStatus" as const,
    { status: "finished" },
  ],
  [
    "prepared status without a finite submission expiry",
    "prepareDeletionStatus" as const,
    {
      status: "not_started",
      statusToken: "v1.deletionStatusCapability.signaturePayload",
      submissionExpiresAt: "not-a-date",
    },
  ],
  [
    "prepared status with a date-only submission expiry",
    "prepareDeletionStatus" as const,
    {
      status: "not_started",
      statusToken: "v1.deletionStatusCapability.signaturePayload",
      submissionExpiresAt: "2026-07-28",
    },
  ],
  [
    "prepared status with an impossible calendar date",
    "prepareDeletionStatus" as const,
    {
      status: "not_started",
      statusToken: "v1.deletionStatusCapability.signaturePayload",
      submissionExpiresAt: "2026-02-31T12:05:00.000Z",
    },
  ],
  [
    "prepared status with an unexpected key",
    "prepareDeletionStatus" as const,
    {
      status: "not_started",
      statusToken: "v1.deletionStatusCapability.signaturePayload",
      submissionExpiresAt: "2026-07-28T12:05:00.000Z",
      unexpected: true,
    },
  ],
  [
    "pending PUT status without a job capability",
    "prepareDeletionStatus" as const,
    {
      deadline: "2026-08-04T12:00:00.000Z",
      requestedAt: "2026-07-28T12:00:00.000Z",
      status: "pending",
    },
  ],
  [
    "not-started status without submission state",
    "getDeletionStatus" as const,
    {
      status: "not_started",
      submissionExpiresAt: "2026-07-28T12:05:00.000Z",
    },
  ],
  [
    "completed status with an unexpected key",
    "getDeletionStatus" as const,
    { status: "completed", unexpected: true },
  ],
  [
    "pending POST with an unexpected key",
    "deleteUser" as const,
    {
      deadline: "2026-08-04T12:00:00.000Z",
      requestedAt: "2026-07-28T12:00:00.000Z",
      status: "pending",
      statusToken: "v1.deletionStatusCapability.signaturePayload",
      unexpected: true,
    },
  ],
  [
    "non-finite pending request date",
    "getDeletionStatus" as const,
    {
      deadline: "2026-08-04T12:00:00.000Z",
      requestedAt: "not-a-date",
      status: "pending",
    },
  ],
  [
    "pending deadline before its request",
    "getDeletionStatus" as const,
    {
      deadline: "2026-07-27T12:00:00.000Z",
      requestedAt: "2026-07-28T12:00:00.000Z",
      status: "pending",
    },
  ],
])("rejects an invalid deletion response: %s", async (_name, method, data) => {
  const api = createNativeOpenJobApi({
    apiBaseUrl: "https://preview.example/api/v1",
    fetchImplementation: jest.fn(async () => jsonResponse({ data })),
  });

  const request =
    method === "deleteUser"
      ? api.deleteUser(
          "firebase-token",
          [],
          "v1.deletionStatusCapability.signaturePayload",
        )
      : method === "prepareDeletionStatus"
        ? api.prepareDeletionStatus("firebase-token")
        : api.getDeletionStatus(
            "v1.deletionStatusCapability.signaturePayload",
          );
  await expect(request).rejects.toEqual(
    new OpenJobApiError(
      502,
      "invalid_response",
      "OpenJob returned an invalid deletion status.",
    ),
  );
});

test.each([
  [
    "PUT",
    "prepareDeletionStatus" as const,
    {
      status: "not_started",
      statusToken: "v1.deletionStatusCapability.signaturePayload",
      submissionExpiresAt: "2026-07-28T12:05:00.000Z",
    },
  ],
  [
    "GET",
    "getDeletionStatus" as const,
    { status: "completed" },
  ],
  [
    "POST",
    "deleteUser" as const,
    {
      completedAt: "2026-07-28T12:00:00.000Z",
      status: "completed",
    },
  ],
])("rejects an unexpected key in a successful deletion %s envelope", async (
  _httpMethod,
  method,
  data,
) => {
  const statusToken = "v1.deletionStatusCapability.signaturePayload";
  const api = createNativeOpenJobApi({
    apiBaseUrl: "https://preview.example/api/v1",
    fetchImplementation: jest.fn(async () =>
      jsonResponse({ data, unexpected: true }),
    ),
  });

  const request =
    method === "prepareDeletionStatus"
      ? api.prepareDeletionStatus("firebase-token")
      : method === "getDeletionStatus"
        ? api.getDeletionStatus(statusToken)
        : api.deleteUser("firebase-token", [], statusToken);
  await expect(request).rejects.toEqual(
    new OpenJobApiError(
      502,
      "invalid_response",
      "OpenJob returned an invalid deletion status.",
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

test("accepts equivalent weak and strong validators during Task List revalidation", async () => {
  const fetchImplementation = jest
    .fn()
    .mockResolvedValueOnce(
      jsonResponse(
        { data: [task], nextCursor: null },
        200,
        { etag: 'W/"task-list-v1"' },
      ),
    )
    .mockResolvedValueOnce(
      new Response(null, {
        headers: { etag: '"task-list-v1"' },
        status: 304,
      }),
    );
  const api = createNativeOpenJobApi({
    apiBaseUrl: "https://preview.example/api/v1",
    fetchImplementation,
  });

  await expect(api.listTasks("token", "grp_one")).resolves.toEqual({
    kind: "changed",
    tasks: [task],
    validator: '"task-list-v1"',
  });
  expect(fetchImplementation).toHaveBeenLastCalledWith(
    "https://preview.example/api/v1/groups/grp_one/tasks?status=all&limit=500",
    expect.objectContaining({
      headers: expect.objectContaining({
        "if-none-match": 'W/"task-list-v1"',
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
