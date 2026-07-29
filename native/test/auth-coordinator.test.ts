import {
  NativeAuthCoordinator,
  OpenJobApiError,
  ProviderSignInError,
  type AuthFlowResult,
  type FirebaseSession,
  type NativeAuthDependencies,
  type StoredSession,
} from "../src/auth/coordinator";

const googleSession: FirebaseSession = {
  expiresAt: 9_999_999,
  idToken: "google-id-token",
  provider: "google",
  refreshToken: "google-refresh-token",
};
const appleSession: FirebaseSession = {
  expiresAt: 9_999_999,
  idToken: "apple-id-token",
  provider: "apple",
  refreshToken: "apple-refresh-token",
};
const qaPasswordSession: FirebaseSession = {
  expiresAt: 9_999_999,
  idToken: "qa-password-id-token",
  provider: "qa-password",
  refreshToken: "qa-password-refresh-token",
};
const user = {
  userId: "usr_one",
  username: "walker",
  usernameRequired: false,
};
const deletionStatusToken =
  "v1.deletionStatusCapability.signaturePayload";
const submissionExpiresAt = "2026-07-28T12:05:00.000Z";
const deletionReceipt = {
  phase: "prepared" as const,
  statusToken: deletionStatusToken,
  version: 1 as const,
};
const submittingDeletionReceipt = {
  ...deletionReceipt,
  phase: "submitting" as const,
};
const completedDeletionReceipt = {
  ...deletionReceipt,
  phase: "completed" as const,
};
const pendingDeletionStatus = {
  deadline: "2026-08-04T12:00:00.000Z",
  reauthenticationProviders: [] as Array<"apple" | "google">,
  requestedAt: "2026-07-28T12:00:00.000Z",
  status: "pending" as const,
};

function createDependencies(
  overrides: Partial<NativeAuthDependencies> = {},
): NativeAuthDependencies & {
  claimUsername: jest.Mock;
  clearProviderSession: jest.Mock;
  clearStoredSession: jest.Mock;
  createUser: jest.Mock;
  deleteUser: jest.Mock;
  exchangeProviderCredential: jest.Mock;
  getMe: jest.Mock;
  linkSignInMethod: jest.Mock;
  listSignInMethods: jest.Mock;
  loadStoredSession: jest.Mock;
  prepareDeletionStatus: jest.Mock;
  purgeLocalDomainCache: jest.Mock;
  refreshDeletionProvider: jest.Mock;
  refreshSession: jest.Mock;
  saveStoredSession: jest.Mock;
  signInWithQaPassword: jest.Mock;
  signInWithProvider: jest.Mock;
} {
  return {
    claimUsername: jest.fn(async () => user),
    clearCleanupPending: jest.fn(async () => undefined),
    clearDeletionReceipt: jest.fn(async () => undefined),
    clearProviderSession: jest.fn(async () => undefined),
    clearStoredSession: jest.fn(async () => undefined),
    createUser: jest.fn(async () => user),
    deleteUser: jest.fn(async () => ({ status: "completed" as const })),
    exchangeProviderCredential: jest.fn(async (credential) =>
      credential.provider === "google" ? googleSession : appleSession,
    ),
    getMe: jest.fn(async () => user),
    getDeletionStatus: jest.fn(async () => ({ status: "completed" as const })),
    linkSignInMethod: jest.fn(async () => user),
    listGroups: jest.fn(async () => []),
    listMembers: jest.fn(async () => []),
    listSignInMethods: jest.fn(async () => ["google" as const]),
    listTasks: jest.fn(async () => ({
      kind: "changed" as const,
      tasks: [],
      validator: '"task-list"',
    })),
    loadLocalTaskListCache: jest.fn(async () => null),
    loadCleanupPending: jest.fn(async () => false),
    loadDeletionReceipt: jest.fn(async () => null),
    loadStoredSession: jest.fn(async () => null),
    markCleanupPending: jest.fn(async () => undefined),
    now: () => 1_000,
    prepareDeletionStatus: jest.fn(async () => ({
      status: "not_started" as const,
      statusToken: deletionStatusToken,
      submissionExpiresAt,
    })),
    purgeLocalDomainCache: jest.fn(async () => undefined),
    refreshDeletionProvider: jest.fn(async () => ({
      status: "completed" as const,
    })),
    refreshSession: jest.fn(async () => googleSession),
    saveStoredSession: jest.fn(async () => undefined),
    saveDeletionReceipt: jest.fn(async () => undefined),
    saveLocalTaskListCache: jest.fn(async () => undefined),
    signInWithQaPassword: jest.fn(async () => qaPasswordSession),
    signInWithProvider: jest.fn(async (provider) => ({
      idToken: `${provider}-provider-token`,
      provider,
    })),
    ...overrides,
  } as unknown as NativeAuthDependencies & {
    claimUsername: jest.Mock;
    clearProviderSession: jest.Mock;
    clearStoredSession: jest.Mock;
    createUser: jest.Mock;
    deleteUser: jest.Mock;
    exchangeProviderCredential: jest.Mock;
    getMe: jest.Mock;
    linkSignInMethod: jest.Mock;
    listSignInMethods: jest.Mock;
    loadStoredSession: jest.Mock;
    prepareDeletionStatus: jest.Mock;
    purgeLocalDomainCache: jest.Mock;
    refreshDeletionProvider: jest.Mock;
    refreshSession: jest.Mock;
    saveStoredSession: jest.Mock;
    signInWithQaPassword: jest.Mock;
    signInWithProvider: jest.Mock;
  };
}

test("claims the immutable Username with the active session and preserves its methods", async () => {
  const emptyShell = {
    userId: "usr_one",
    username: null,
    usernameRequired: true,
  };
  const claimed = {
    ...emptyShell,
    username: "walker",
    usernameRequired: false,
  };
  const dependencies = createDependencies({
    claimUsername: jest.fn(async () => claimed),
    getMe: jest.fn(async () => emptyShell),
    listSignInMethods: jest.fn(async () => [
      "google" as const,
      "apple" as const,
    ]),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await coordinator.signIn("google");
  await expect(coordinator.claimUsername("walker")).resolves.toEqual({
    kind: "signed-in",
    methods: ["apple", "google"],
    user: claimed,
  });

  expect(dependencies.claimUsername).toHaveBeenCalledWith(
    "google-id-token",
    "walker",
  );
  expect(dependencies.listSignInMethods).toHaveBeenCalledTimes(1);
  expect(dependencies.saveStoredSession).toHaveBeenCalledTimes(1);
});

test("reads Groups and a service-ordered Task List without exposing the active credential", async () => {
  const groups = [
    {
      groupId: "grp_one",
      name: "Walker Workshop",
      role: "admin" as const,
      createdAt: "2026-07-20T12:00:00.000Z",
    },
  ];
  const members = [
    {
      userId: "usr_one",
      username: "walker",
      role: "admin" as const,
      joinedAt: "2026-07-20T12:00:00.000Z",
    },
  ];
  const tasks = [
    {
      taskId: "task_one",
      groupId: "grp_one",
      text: "Read this Task",
      assignee: {
        state: "assigned" as const,
        userId: "usr_one",
        username: "walker",
      },
      priority: "normal" as const,
      dueDate: null,
      state: "open" as const,
      createdAt: "2026-07-20T12:01:00.000Z",
      completedAt: null,
    },
  ];
  const dependencies = createDependencies({
    listGroups: jest.fn(async () => groups),
    listMembers: jest.fn(async () => members),
    listTasks: jest.fn(async () => ({
      kind: "changed" as const,
      tasks,
      validator: '"task-list-1"',
    })),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await coordinator.signIn("google");

  await expect(coordinator.listGroups()).resolves.toEqual(groups);
  await expect(coordinator.readTaskList("grp_one")).resolves.toEqual({
    members,
    tasks,
  });
  expect(dependencies.listGroups).toHaveBeenCalledWith("google-id-token");
  expect(dependencies.listMembers).toHaveBeenCalledWith(
    "google-id-token",
    "grp_one",
  );
  expect(dependencies.listTasks).toHaveBeenCalledWith(
    "google-id-token",
    "grp_one",
    undefined,
  );
});

test("reuses a conditional Task List without reading Members", async () => {
  const dependencies = createDependencies({
    listTasks: jest.fn(async () => ({
      kind: "not-modified" as const,
      validator: '"task-list-1"',
    })),
    now: () => 1_000,
  });
  const coordinator = new NativeAuthCoordinator(dependencies);
  await coordinator.signIn("google");

  await expect(
    coordinator.syncTaskList("grp_one", '"task-list-1"'),
  ).resolves.toEqual({
    freshAt: "1970-01-01T00:00:01.000Z",
    kind: "not-modified",
    validator: '"task-list-1"',
  });
  expect(dependencies.listMembers).not.toHaveBeenCalled();
});

test("recovers a concurrent immutable claim from the current User", async () => {
  const emptyShell = {
    userId: "usr_one",
    username: null,
    usernameRequired: true,
  };
  const claimedElsewhere = {
    ...emptyShell,
    username: "already-claimed",
    usernameRequired: false,
  };
  const immutable = new OpenJobApiError(
    409,
    "username_immutable",
    "Username cannot be changed.",
  );
  const dependencies = createDependencies({
    claimUsername: jest.fn(async () => {
      throw immutable;
    }),
    getMe: jest
      .fn()
      .mockResolvedValueOnce(emptyShell)
      .mockResolvedValueOnce(claimedElsewhere),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await coordinator.signIn("google");
  await expect(coordinator.claimUsername("other-draft")).resolves.toEqual({
    kind: "signed-in",
    methods: ["google"],
    user: claimedElsewhere,
  });
  expect(dependencies.getMe).toHaveBeenLastCalledWith("google-id-token");
  expect(dependencies.listSignInMethods).toHaveBeenCalledTimes(1);
});

test("keeps the immutable error when the current User still needs a Username", async () => {
  const emptyShell = {
    userId: "usr_one",
    username: null,
    usernameRequired: true,
  };
  const immutable = new OpenJobApiError(
    409,
    "username_immutable",
    "Username cannot be changed.",
  );
  const dependencies = createDependencies({
    claimUsername: jest.fn(async () => {
      throw immutable;
    }),
    getMe: jest.fn(async () => emptyShell),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await coordinator.signIn("google");
  await expect(
    coordinator.claimUsername("other-draft"),
  ).rejects.toBe(immutable);
  expect(dependencies.getMe).toHaveBeenCalledTimes(2);
});

test("purges a revoked session during immutable Username reconciliation", async () => {
  const emptyShell = {
    userId: "usr_one",
    username: null,
    usernameRequired: true,
  };
  const dependencies = createDependencies({
    claimUsername: jest.fn(async () => {
      throw new OpenJobApiError(
        409,
        "username_immutable",
        "Username cannot be changed.",
      );
    }),
    getMe: jest
      .fn()
      .mockResolvedValueOnce(emptyShell)
      .mockRejectedValueOnce(
        new OpenJobApiError(
          401,
          "authentication_required",
          "Authentication is required.",
        ),
      ),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await coordinator.signIn("google");
  await expect(coordinator.claimUsername("walker")).resolves.toEqual({
    kind: "signed-out",
    reason: "revoked",
  });
  expect(dependencies.clearProviderSession).toHaveBeenCalledTimes(1);
  expect(dependencies.clearStoredSession).toHaveBeenCalledTimes(1);
  expect(dependencies.purgeLocalDomainCache).toHaveBeenCalledTimes(1);
});

test("restores and persists only the refresh credential for a returning provider", async () => {
  const dependencies = createDependencies();
  const coordinator = new NativeAuthCoordinator(dependencies);

  const result = await coordinator.signIn("google");

  expect(result).toEqual({
    kind: "signed-in",
    methods: ["google"],
    user,
  });
  expect(dependencies.saveStoredSession).toHaveBeenCalledWith({
    ownerUserId: "usr_one",
    provider: "google",
    refreshToken: "google-refresh-token",
    version: 2,
  });
  expect(JSON.stringify(dependencies.saveStoredSession.mock.calls)).not.toContain(
    "google-id-token",
  );
});

test("bootstraps only a securely owner-bound session before networking", async () => {
  const versionTwo: StoredSession = {
    ownerUserId: "usr_one",
    provider: "google",
    refreshToken: "stored-refresh",
    version: 2,
  };
  const bound = new NativeAuthCoordinator(
    createDependencies({
      loadLocalTaskListCache: jest.fn(
        async () => ({ ownerUserId: "usr_one" }) as never,
      ),
      loadStoredSession: jest.fn(async () => versionTwo),
    }),
  );

  await expect(bound.restoreCachedSession()).resolves.toEqual({
    kind: "signed-in",
    methods: [],
    provisional: true,
    user: {
      userId: "usr_one",
      username: null,
      usernameRequired: false,
    },
  });

  const legacy = new NativeAuthCoordinator(
    createDependencies({
      loadStoredSession: jest.fn(
        async (): Promise<StoredSession> => ({
          provider: "google",
          refreshToken: "legacy-refresh",
          version: 1,
        }),
      ),
    }),
  );
  await expect(legacy.restoreCachedSession()).resolves.toBeNull();
});

test("purges all private state when a bound credential resolves to another User", async () => {
  const stored: StoredSession = {
    ownerUserId: "usr_previous",
    provider: "google",
    refreshToken: "stored-refresh",
    version: 2,
  };
  const dependencies = createDependencies({
    loadStoredSession: jest.fn(async () => stored),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await expect(coordinator.restore()).resolves.toEqual({
    kind: "signed-out",
    reason: "revoked",
  });
  expect(dependencies.purgeLocalDomainCache).toHaveBeenCalledTimes(1);
  expect(dependencies.clearStoredSession).toHaveBeenCalledTimes(1);
  expect(dependencies.saveStoredSession).not.toHaveBeenCalled();
});

test("restores a valid unknown credential to its explicit decision screen", async () => {
  const stored: StoredSession = {
    provider: "apple",
    refreshToken: "stored-apple-refresh",
    version: 1,
  };
  const dependencies = createDependencies({
    getMe: jest.fn(async () => {
      throw new OpenJobApiError(409, "sign_in_method_unrecognized");
    }),
    loadStoredSession: jest.fn(async () => stored),
    refreshSession: jest.fn(async () => appleSession),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await expect(coordinator.restore()).resolves.toEqual({
    kind: "unrecognized",
    provider: "apple",
  });
  expect(dependencies.clearStoredSession).not.toHaveBeenCalled();
  expect(dependencies.clearProviderSession).not.toHaveBeenCalled();

  await expect(coordinator.createUser()).resolves.toMatchObject({
    kind: "signed-in",
    user,
  });
  expect(dependencies.createUser).toHaveBeenCalledWith("apple-id-token");
});

test("requires an explicit choice before creating an unknown sign-in", async () => {
  const dependencies = createDependencies({
    getMe: jest.fn(async () => {
      throw new OpenJobApiError(409, "sign_in_method_unrecognized");
    }),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  const pending = await coordinator.signIn("google");

  expect(pending).toEqual({
    kind: "unrecognized",
    provider: "google",
  });
  expect(dependencies.createUser).not.toHaveBeenCalled();

  const created = await coordinator.createUser();

  expect(dependencies.createUser).toHaveBeenCalledWith("google-id-token");
  expect(created).toEqual({
    kind: "signed-in",
    methods: ["google"],
    user,
  });
});

test("signs in the Preview QA User without invoking a linkable provider", async () => {
  const dependencies = createDependencies({
    listSignInMethods: jest.fn(async () => []),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await expect(
    coordinator.signInWithQaPassword(
      "qa@example.invalid",
      "fixture-password",
    ),
  ).resolves.toEqual({
    kind: "signed-in",
    methods: [],
    user,
  });

  expect(dependencies.signInWithQaPassword).toHaveBeenCalledWith(
    "qa@example.invalid",
    "fixture-password",
  );
  expect(dependencies.signInWithProvider).not.toHaveBeenCalled();
  expect(dependencies.exchangeProviderCredential).not.toHaveBeenCalled();
  expect(dependencies.saveStoredSession).toHaveBeenCalledWith({
    ownerUserId: "usr_one",
    provider: "qa-password",
    refreshToken: "qa-password-refresh-token",
    version: 2,
  });
  await expect(
    coordinator.authenticateNewMethod("google"),
  ).rejects.toThrow("cannot link providers");
  expect(dependencies.signInWithProvider).not.toHaveBeenCalled();
});

test("blocks creation and linking for an unknown Preview QA credential", async () => {
  const dependencies = createDependencies({
    getMe: jest.fn(async () => {
      throw new OpenJobApiError(409, "sign_in_method_unrecognized");
    }),
    listSignInMethods: jest.fn(async () => []),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await expect(
    coordinator.signInWithQaPassword(
      "qa@example.invalid",
      "fixture-password",
    ),
  ).resolves.toEqual({
    kind: "unrecognized",
    provider: "qa-password",
  });
  await expect(coordinator.authenticateExistingUser()).rejects.toThrow(
    "cannot be linked",
  );
  expect(dependencies.signInWithProvider).not.toHaveBeenCalled();

  await expect(coordinator.createUser()).rejects.toThrow(
    "cannot create a User",
  );
  expect(dependencies.createUser).not.toHaveBeenCalled();
});

test("refreshes an unknown credential before a delayed explicit User creation", async () => {
  let now = 1_000;
  const stored: StoredSession = {
    provider: "google",
    refreshToken: "secure-store-refresh",
    version: 1,
  };
  const refreshed = {
    ...googleSession,
    expiresAt: 30_000_000,
    idToken: "refreshed-google-id-token",
    refreshToken: "rotated-secure-store-refresh",
  };
  const dependencies = createDependencies({
    getMe: jest.fn(async () => {
      throw new OpenJobApiError(409, "sign_in_method_unrecognized");
    }),
    loadStoredSession: jest.fn(async () => stored),
    now: () => now,
    refreshSession: jest.fn(async () => refreshed),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await coordinator.signIn("google");
  now = 20_000_000;
  await expect(coordinator.createUser()).resolves.toMatchObject({
    kind: "signed-in",
    user,
  });

  expect(dependencies.refreshSession).toHaveBeenCalledWith(stored);
  expect(dependencies.createUser).toHaveBeenCalledWith(
    "refreshed-google-id-token",
  );
});

test.each([
  {
    label: "provider refresh revocation",
    createUser: jest.fn(async () => user),
    refreshSession: jest.fn(async () => {
      throw new ProviderSignInError("revoked");
    }),
  },
  {
    label: "API credential rejection",
    createUser: jest.fn(async () => {
      throw new OpenJobApiError(401, "authentication_required");
    }),
    refreshSession: jest.fn(async () => googleSession),
  },
])("cleans up a delayed unknown User creation after $label", async ({
  createUser,
  refreshSession,
}) => {
  let now = 1_000;
  const dependencies = createDependencies({
    createUser,
    getMe: jest.fn(async () => {
      throw new OpenJobApiError(409, "sign_in_method_unrecognized");
    }),
    loadStoredSession: jest.fn(async (): Promise<StoredSession> => ({
      provider: "google",
      refreshToken: "secure-store-refresh",
      version: 1,
    })),
    now: () => now,
    refreshSession,
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await coordinator.signIn("google");
  if (createUser.mock.calls.length === 0) now = 20_000_000;

  await expect(coordinator.createUser()).resolves.toEqual({
    kind: "signed-out",
    reason: "revoked",
  });
  expect(dependencies.clearProviderSession).toHaveBeenCalledTimes(1);
  expect(dependencies.purgeLocalDomainCache).toHaveBeenCalledTimes(1);
  expect(dependencies.clearStoredSession).toHaveBeenCalledTimes(1);
});

test("does not persist a provider exchange until OpenJob recognizes its identity state", async () => {
  const offlineDependencies = createDependencies({
    getMe: jest.fn(async () => {
      throw new ProviderSignInError("offline");
    }),
  });
  const coordinator = new NativeAuthCoordinator(offlineDependencies);

  await expect(coordinator.signIn("google")).resolves.toEqual({
    kind: "offline",
    provider: "google",
  });
  expect(offlineDependencies.saveStoredSession).not.toHaveBeenCalled();
  expect(offlineDependencies.clearProviderSession).toHaveBeenCalledTimes(1);
  await expect(coordinator.cancelPending()).resolves.toEqual({
    kind: "signed-out",
  });

  const relaunched = createDependencies();
  await expect(
    new NativeAuthCoordinator(relaunched).restore(),
  ).resolves.toEqual({ kind: "signed-out" });
  expect(relaunched.refreshSession).not.toHaveBeenCalled();
});

test("links only after fresh existing authentication and an explicit confirmation", async () => {
  const dependencies = createDependencies({
    getMe: jest
      .fn()
      .mockRejectedValueOnce(
        new OpenJobApiError(409, "sign_in_method_unrecognized"),
      )
      .mockResolvedValueOnce(user),
    listSignInMethods: jest.fn(async () => [
      "apple" as const,
      "google" as const,
    ]),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await coordinator.signIn("google");
  const confirmation = await coordinator.authenticateExistingUser();

  expect(confirmation).toEqual({
    existingProvider: "apple",
    kind: "confirm-link",
    newProvider: "google",
    user,
  });
  expect(dependencies.linkSignInMethod).not.toHaveBeenCalled();

  const linked = await coordinator.confirmLink();

  expect(dependencies.signInWithProvider.mock.calls.map(([method]) => method)).toEqual([
    "google",
    "apple",
  ]);
  expect(dependencies.linkSignInMethod).toHaveBeenCalledWith(
    "google-id-token",
    "apple-id-token",
    "usr_one",
  );
  expect(linked).toEqual({
    kind: "signed-in",
    methods: ["apple", "google"],
    user,
  });
});

test("adds a fresh second provider to the current signed-in User", async () => {
  const dependencies = createDependencies({
    listSignInMethods: jest
      .fn()
      .mockResolvedValueOnce(["google"])
      .mockResolvedValueOnce(["apple", "google"]),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await coordinator.signIn("google");
  const confirmation = await coordinator.authenticateNewMethod("apple");
  expect(confirmation).toMatchObject({
    existingProvider: "google",
    kind: "confirm-link",
    newProvider: "apple",
  });
  expect(dependencies.linkSignInMethod).not.toHaveBeenCalled();

  await coordinator.confirmLink();

  expect(dependencies.linkSignInMethod).toHaveBeenCalledWith(
    "google-id-token",
    "apple-id-token",
    "usr_one",
  );
  expect(dependencies.saveStoredSession).toHaveBeenLastCalledWith({
    ownerUserId: "usr_one",
    provider: "google",
    refreshToken: "google-refresh-token",
    version: 2,
  });
});

test.each([
  {
    label: "historical target",
    target: user,
  },
  {
    label: "second empty-shell target",
    target: {
      userId: "usr_target_shell",
      username: null,
      usernameRequired: true,
    },
  },
])("shows and preserves the $label instead of the current empty shell", async ({
  target,
}) => {
  const emptyShell = {
    userId: "usr_current_shell",
    username: null,
    usernameRequired: true,
  };
  const dependencies = createDependencies({
    getMe: jest
      .fn()
      .mockResolvedValueOnce(emptyShell)
      .mockResolvedValueOnce(target),
    linkSignInMethod: jest.fn(async () => target),
    listSignInMethods: jest
      .fn()
      .mockResolvedValueOnce(["google"])
      .mockResolvedValueOnce(["apple", "google"]),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await coordinator.signIn("google");
  await expect(coordinator.authenticateNewMethod("apple")).resolves.toEqual({
    existingProvider: "google",
    kind: "confirm-link",
    newProvider: "apple",
    user: target,
  });
  await expect(coordinator.confirmLink()).resolves.toEqual({
    kind: "signed-in",
    methods: ["apple", "google"],
    user: target,
  });
  expect(dependencies.linkSignInMethod).toHaveBeenCalledWith(
    "google-id-token",
    "apple-id-token",
    target.userId,
  );
});

test("keeps the current empty shell when the additional provider is unrecognized", async () => {
  const emptyShell = {
    userId: "usr_current_shell",
    username: null,
    usernameRequired: true,
  };
  const dependencies = createDependencies({
    getMe: jest
      .fn()
      .mockResolvedValueOnce(emptyShell)
      .mockRejectedValueOnce(
        new OpenJobApiError(409, "sign_in_method_unrecognized"),
      ),
    linkSignInMethod: jest.fn(async () => emptyShell),
    listSignInMethods: jest
      .fn()
      .mockResolvedValueOnce(["google"])
      .mockResolvedValueOnce(["apple", "google"]),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await coordinator.signIn("google");
  await expect(coordinator.authenticateNewMethod("apple")).resolves.toEqual({
    existingProvider: "google",
    kind: "confirm-link",
    newProvider: "apple",
    user: emptyShell,
  });
  await expect(coordinator.confirmLink()).resolves.toEqual({
    kind: "signed-in",
    methods: ["apple", "google"],
    user: emptyShell,
  });
});

test("discards a candidate provider when target lookup fails", async () => {
  const dependencies = createDependencies({
    getMe: jest
      .fn()
      .mockResolvedValueOnce({
        userId: "usr_current_shell",
        username: null,
        usernameRequired: true,
      })
      .mockRejectedValueOnce(new ProviderSignInError("offline")),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await coordinator.signIn("google");
  await expect(
    coordinator.authenticateNewMethod("apple"),
  ).rejects.toEqual(new ProviderSignInError("offline"));
  expect(dependencies.clearProviderSession).toHaveBeenCalledTimes(1);
  await expect(coordinator.cancelPending()).resolves.toMatchObject({
    kind: "signed-in",
  });
  expect(dependencies.clearProviderSession).toHaveBeenCalledTimes(2);
});

test("discards a secondary provider when its credential exchange fails", async () => {
  const dependencies = createDependencies({
    exchangeProviderCredential: jest
      .fn()
      .mockResolvedValueOnce(googleSession)
      .mockRejectedValueOnce(new ProviderSignInError("offline")),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await coordinator.signIn("google");
  await expect(
    coordinator.authenticateNewMethod("apple"),
  ).rejects.toEqual(new ProviderSignInError("offline"));

  expect(dependencies.clearProviderSession).toHaveBeenCalledTimes(1);
  expect(dependencies.clearStoredSession).not.toHaveBeenCalled();
  await expect(coordinator.cancelPending()).resolves.toMatchObject({
    kind: "signed-in",
  });
});

test("reloads the protected refresh credential instead of retaining it in the active session", async () => {
  const stored: StoredSession = {
    provider: "google",
    refreshToken: "secure-store-refresh",
    version: 1,
  };
  const dependencies = createDependencies({
    loadStoredSession: jest.fn(async () => stored),
    now: () => 20_000_000,
    refreshSession: jest.fn(async () => ({
      ...googleSession,
      expiresAt: 30_000_000,
      refreshToken: "rotated-secure-store-refresh",
    })),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await coordinator.signIn("google");
  await coordinator.authenticateNewMethod("apple");

  expect(dependencies.loadStoredSession).toHaveBeenCalledTimes(1);
  expect(dependencies.refreshSession).toHaveBeenCalledWith(stored);
  expect(dependencies.refreshSession).not.toHaveBeenCalledWith(
    expect.objectContaining({ refreshToken: "google-refresh-token" }),
  );
});

test("refreshes the current User proof immediately before link confirmation", async () => {
  let now = 9_600_000;
  const stored: StoredSession = {
    provider: "google",
    refreshToken: "secure-store-refresh",
    version: 1,
  };
  const refreshed = {
    ...googleSession,
    expiresAt: 30_000_000,
    idToken: "refreshed-current-token",
    refreshToken: "rotated-secure-store-refresh",
  };
  const dependencies = createDependencies({
    exchangeProviderCredential: jest.fn(async (credential) =>
      credential.provider === "google"
        ? googleSession
        : { ...appleSession, expiresAt: 20_000_000 },
    ),
    listSignInMethods: jest
      .fn()
      .mockResolvedValueOnce(["google"])
      .mockResolvedValueOnce(["apple", "google"]),
    loadStoredSession: jest.fn(async () => stored),
    now: () => now,
    refreshSession: jest.fn(async () => refreshed),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await coordinator.signIn("google");
  await coordinator.authenticateNewMethod("apple");
  now = 9_800_000;
  await coordinator.confirmLink();

  expect(dependencies.refreshSession).toHaveBeenCalledWith(stored);
  expect(dependencies.linkSignInMethod).toHaveBeenCalledWith(
    "refreshed-current-token",
    "apple-id-token",
    "usr_one",
  );
});

test("returns to the method manager when the confirmed target changes", async () => {
  const dependencies = createDependencies({
    linkSignInMethod: jest.fn(async () => {
      throw new OpenJobApiError(409, "link_target_changed");
    }),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await coordinator.signIn("google");
  await coordinator.authenticateNewMethod("apple");
  await expect(coordinator.confirmLink()).resolves.toEqual({
    kind: "signed-in",
    methods: ["google"],
    notice: "link_target_changed",
    user,
  });

  expect(dependencies.clearProviderSession).toHaveBeenCalledTimes(1);
  expect(dependencies.clearStoredSession).not.toHaveBeenCalled();
  await expect(
    coordinator.authenticateNewMethod("apple"),
  ).resolves.toMatchObject({
    kind: "confirm-link",
    user,
  });
});

test("cleans up a revoked active refresh while keeping offline refresh retryable", async () => {
  let now = 1_000;
  const stored: StoredSession = {
    provider: "google",
    refreshToken: "secure-store-refresh",
    version: 1,
  };
  const revokedDependencies = createDependencies({
    loadStoredSession: jest.fn(async () => stored),
    now: () => now,
    refreshSession: jest.fn(async () => {
      throw new ProviderSignInError("revoked");
    }),
  });
  const revokedCoordinator = new NativeAuthCoordinator(
    revokedDependencies,
  );
  await revokedCoordinator.signIn("google");
  now = 20_000_000;

  await expect(
    revokedCoordinator.authenticateNewMethod("apple"),
  ).resolves.toEqual({ kind: "signed-out", reason: "revoked" });
  expect(revokedDependencies.clearProviderSession).toHaveBeenCalledTimes(1);
  expect(revokedDependencies.purgeLocalDomainCache).toHaveBeenCalledTimes(1);
  expect(revokedDependencies.clearStoredSession).toHaveBeenCalledTimes(1);

  now = 1_000;
  const offlineDependencies = createDependencies({
    loadStoredSession: jest.fn(async () => stored),
    now: () => now,
    refreshSession: jest.fn(async () => {
      throw new ProviderSignInError("offline");
    }),
  });
  const offlineCoordinator = new NativeAuthCoordinator(
    offlineDependencies,
  );
  await offlineCoordinator.signIn("google");
  now = 20_000_000;

  await expect(
    offlineCoordinator.authenticateNewMethod("apple"),
  ).rejects.toEqual(new ProviderSignInError("offline"));
  expect(offlineDependencies.clearStoredSession).not.toHaveBeenCalled();
});

test("keeps transient restore failures recoverable and removes only revoked credentials", async () => {
  const stored: StoredSession = {
    provider: "google",
    refreshToken: "stored-refresh-token",
    version: 1,
  };
  const offlineDependencies = createDependencies({
    loadStoredSession: jest.fn(async () => stored),
    refreshSession: jest.fn(async () => {
      throw new ProviderSignInError("offline");
    }),
  });

  await expect(
    new NativeAuthCoordinator(offlineDependencies).restore(),
  ).resolves.toEqual({ kind: "restore-retry", reason: "offline" });
  expect(offlineDependencies.clearStoredSession).not.toHaveBeenCalled();

  const unavailableDependencies = createDependencies({
    loadStoredSession: jest.fn(async () => {
      throw new ProviderSignInError("unavailable");
    }),
  });
  await expect(
    new NativeAuthCoordinator(unavailableDependencies).restore(),
  ).resolves.toEqual({ kind: "restore-retry", reason: "unavailable" });
  expect(unavailableDependencies.clearStoredSession).not.toHaveBeenCalled();

  const serviceDependencies = createDependencies({
    loadStoredSession: jest.fn(async () => stored),
    getMe: jest.fn(async () => {
      throw new OpenJobApiError(503, "service_unavailable");
    }),
  });
  await expect(
    new NativeAuthCoordinator(serviceDependencies).restore(),
  ).resolves.toEqual({ kind: "restore-retry", reason: "unavailable" });
  expect(serviceDependencies.clearStoredSession).not.toHaveBeenCalled();

  const unexpectedDependencies = createDependencies({
    loadStoredSession: jest.fn(async () => stored),
    refreshSession: jest.fn(async () => {
      throw new SyntaxError("Malformed provider response.");
    }),
  });
  await expect(
    new NativeAuthCoordinator(unexpectedDependencies).restore(),
  ).resolves.toEqual({ kind: "restore-retry", reason: "unavailable" });
  expect(unexpectedDependencies.clearStoredSession).not.toHaveBeenCalled();

  const revokedDependencies = createDependencies({
    loadStoredSession: jest.fn(async () => stored),
    refreshSession: jest.fn(async () => {
      throw new ProviderSignInError("revoked");
    }),
  });
  await expect(
    new NativeAuthCoordinator(revokedDependencies).restore(),
  ).resolves.toEqual({ kind: "signed-out", reason: "revoked" });
  expect(revokedDependencies.clearStoredSession).toHaveBeenCalledTimes(1);
  expect(revokedDependencies.purgeLocalDomainCache).toHaveBeenCalledTimes(1);
});

test("cancellation is stable and sign-out or switch-user purges session data", async () => {
  const dependencies = createDependencies({
    signInWithProvider: jest.fn(async () => {
      throw new ProviderSignInError("cancelled");
    }),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await expect(coordinator.signIn("apple")).resolves.toEqual({
    kind: "signed-out",
    reason: "cancelled",
  });
  expect(dependencies.saveStoredSession).not.toHaveBeenCalled();

  await coordinator.signOut();
  await coordinator.switchUser();
  expect(dependencies.clearProviderSession).toHaveBeenCalledTimes(2);
  expect(dependencies.clearStoredSession).toHaveBeenCalledTimes(2);
  expect(dependencies.purgeLocalDomainCache).toHaveBeenCalledTimes(2);
});

test("revoked Task List access purges session data and preserves the revoked reason", async () => {
  const dependencies = createDependencies();
  const coordinator = new NativeAuthCoordinator(dependencies);

  await expect(coordinator.revokeSession()).resolves.toEqual({
    kind: "signed-out",
    reason: "revoked",
  });
  expect(dependencies.clearProviderSession).toHaveBeenCalledTimes(1);
  expect(dependencies.clearStoredSession).toHaveBeenCalledTimes(1);
  expect(dependencies.purgeLocalDomainCache).toHaveBeenCalledTimes(1);
});

test("canceling an unknown persisted sign-in clears it while manager cancel preserves the active User", async () => {
  const unknownDependencies = createDependencies({
    getMe: jest.fn(async () => {
      throw new OpenJobApiError(409, "sign_in_method_unrecognized");
    }),
  });
  const unknown = new NativeAuthCoordinator(unknownDependencies);
  await unknown.signIn("google");

  await expect(unknown.cancelPending()).resolves.toEqual({
    kind: "signed-out",
  });
  expect(unknownDependencies.clearStoredSession).toHaveBeenCalledTimes(1);

  const activeDependencies = createDependencies();
  const active = new NativeAuthCoordinator(activeDependencies);
  await active.signIn("google");
  await active.authenticateNewMethod("apple");

  await expect(active.cancelPending()).resolves.toEqual({
    kind: "signed-in",
    methods: ["google"],
    user,
  });
  expect(activeDependencies.clearStoredSession).not.toHaveBeenCalled();
});

test("purges a live session when the platform reports Apple credential revocation", async () => {
  let revoke: (() => void) | undefined;
  const unsubscribe = jest.fn();
  const dependencies = createDependencies({
    subscribeToCredentialRevocation: (listener) => {
      revoke = listener;
      return unsubscribe;
    },
  });
  const coordinator = new NativeAuthCoordinator(dependencies);
  const listener = jest.fn();
  let resolveRevocation: ((result: unknown) => void) | undefined;
  const revocation = new Promise((resolve) => {
    resolveRevocation = resolve;
  });
  const stop = coordinator.subscribeToCredentialRevocation((result) => {
    listener(result);
    resolveRevocation?.(result);
  });
  revoke?.();
  await expect(revocation).resolves.toEqual({
    kind: "signed-out",
    reason: "revoked",
  });

  expect(dependencies.clearStoredSession).toHaveBeenCalledTimes(1);
  expect(dependencies.clearProviderSession).toHaveBeenCalledTimes(1);
  expect(dependencies.purgeLocalDomainCache).toHaveBeenCalledTimes(1);
  expect(listener).toHaveBeenCalledWith({
    kind: "signed-out",
    reason: "revoked",
  });
  stop();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

test("blocks new sign-in until every local cleanup boundary succeeds", async () => {
  const clearStoredSession = jest
    .fn()
    .mockRejectedValueOnce(new Error("Keychain unavailable"))
    .mockResolvedValueOnce(undefined);
  const dependencies = createDependencies({ clearStoredSession });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await expect(coordinator.signOut()).resolves.toEqual({
    kind: "cleanup-retry",
  });
  expect(dependencies.clearProviderSession).toHaveBeenCalledTimes(1);
  expect(dependencies.purgeLocalDomainCache).toHaveBeenCalledTimes(1);

  await expect(coordinator.signOut()).resolves.toEqual({
    kind: "signed-out",
  });
  expect(clearStoredSession).toHaveBeenCalledTimes(2);
});

test("still clears every private store when the cleanup marker cannot be written", async () => {
  const dependencies = createDependencies({
    markCleanupPending: jest.fn(async () => {
      throw new ProviderSignInError("unavailable");
    }),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await expect(coordinator.signOut()).resolves.toEqual({
    kind: "signed-out",
  });
  expect(dependencies.clearProviderSession).toHaveBeenCalledTimes(1);
  expect(dependencies.purgeLocalDomainCache).toHaveBeenCalledTimes(1);
  expect(dependencies.clearStoredSession).toHaveBeenCalledTimes(1);
  expect(dependencies.clearCleanupPending).not.toHaveBeenCalled();
});

test("persists a cleanup gate across relaunch when provider cleanup fails", async () => {
  const dependencies = createDependencies({
    clearProviderSession: jest.fn(async () => {
      throw new Error("Provider SDK unavailable");
    }),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await coordinator.signIn("google");
  await expect(coordinator.switchUser()).resolves.toEqual({
    kind: "cleanup-retry",
  });

  expect(dependencies.purgeLocalDomainCache).toHaveBeenCalledTimes(1);
  expect(dependencies.clearStoredSession).toHaveBeenCalledTimes(1);
  expect(dependencies.clearCleanupPending).not.toHaveBeenCalled();

  const relaunched = createDependencies({
    loadCleanupPending: jest.fn(async () => true),
  });
  await expect(
    new NativeAuthCoordinator(relaunched).restore(),
  ).resolves.toEqual({ kind: "signed-out" });
  expect(relaunched.refreshSession).not.toHaveBeenCalled();
  expect(relaunched.clearProviderSession).toHaveBeenCalledTimes(1);
  expect(relaunched.purgeLocalDomainCache).toHaveBeenCalledTimes(1);
  expect(relaunched.clearStoredSession).toHaveBeenCalledTimes(1);
  expect(relaunched.clearCleanupPending).toHaveBeenCalledTimes(1);
});

test("discards a canceled candidate provider session without deleting the active User", async () => {
  const dependencies = createDependencies();
  const coordinator = new NativeAuthCoordinator(dependencies);

  await coordinator.signIn("apple");
  await coordinator.authenticateNewMethod("google");
  await expect(coordinator.cancelPending()).resolves.toEqual({
    kind: "signed-in",
    methods: ["google"],
    user,
  });

  expect(dependencies.clearProviderSession).toHaveBeenCalledTimes(1);
  expect(dependencies.clearStoredSession).not.toHaveBeenCalled();
  expect(dependencies.purgeLocalDomainCache).not.toHaveBeenCalled();
  await expect(coordinator.authenticateNewMethod("google")).resolves.toMatchObject({
    kind: "confirm-link",
    newProvider: "google",
  });
});

test("restarts an unknown-first link when its additional proof expires", async () => {
  const dependencies = createDependencies({
    getMe: jest
      .fn()
      .mockRejectedValueOnce(
        new OpenJobApiError(409, "sign_in_method_unrecognized"),
      )
      .mockResolvedValue(user),
    linkSignInMethod: jest.fn(async () => {
      throw new OpenJobApiError(401, "fresh_authentication_required");
    }),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await coordinator.signIn("google");
  await coordinator.authenticateExistingUser();

  await expect(coordinator.confirmLink()).resolves.toEqual({
    kind: "unrecognized",
    notice: "fresh_authentication_required",
    provider: "google",
  });
  expect(dependencies.clearProviderSession).toHaveBeenCalledTimes(1);
  expect(dependencies.clearStoredSession).not.toHaveBeenCalled();
  expect(dependencies.purgeLocalDomainCache).not.toHaveBeenCalled();

  await expect(coordinator.authenticateExistingUser()).resolves.toEqual({
    existingProvider: "apple",
    kind: "confirm-link",
    newProvider: "google",
    user,
  });
});

test("restarts an unknown-first link when its confirmed target changes", async () => {
  const dependencies = createDependencies({
    getMe: jest
      .fn()
      .mockRejectedValueOnce(
        new OpenJobApiError(409, "sign_in_method_unrecognized"),
      )
      .mockResolvedValue(user),
    linkSignInMethod: jest.fn(async () => {
      throw new OpenJobApiError(409, "link_target_changed");
    }),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await coordinator.signIn("google");
  await coordinator.authenticateExistingUser();

  await expect(coordinator.confirmLink()).resolves.toEqual({
    kind: "unrecognized",
    notice: "link_target_changed",
    provider: "google",
  });
  expect(dependencies.clearProviderSession).toHaveBeenCalledTimes(1);
  expect(dependencies.clearStoredSession).not.toHaveBeenCalled();
  expect(dependencies.purgeLocalDomainCache).not.toHaveBeenCalled();

  await expect(coordinator.authenticateExistingUser()).resolves.toEqual({
    existingProvider: "apple",
    kind: "confirm-link",
    newProvider: "google",
    user,
  });
});

test.each([
  ["fresh_authentication_required", 401],
  ["link_target_changed", 409],
] as const)(
  "retains unknown-first confirmation when clearing the secondary proof fails after %s",
  async (code, status) => {
    const cleanupError = new ProviderSignInError("unavailable");
    const dependencies = createDependencies({
      clearProviderSession: jest
        .fn()
        .mockRejectedValueOnce(cleanupError)
        .mockResolvedValue(undefined),
      getMe: jest
        .fn()
        .mockRejectedValueOnce(
          new OpenJobApiError(409, "sign_in_method_unrecognized"),
        )
        .mockResolvedValue(user),
      linkSignInMethod: jest.fn(async () => {
        throw new OpenJobApiError(status, code);
      }),
    });
    const coordinator = new NativeAuthCoordinator(dependencies);

    await coordinator.signIn("google");
    await coordinator.authenticateExistingUser();

    await expect(coordinator.confirmLink()).rejects.toBe(cleanupError);
    expect(dependencies.clearStoredSession).not.toHaveBeenCalled();
    expect(dependencies.purgeLocalDomainCache).not.toHaveBeenCalled();

    await expect(coordinator.confirmLink()).resolves.toEqual({
      kind: "unrecognized",
      notice: code,
      provider: "google",
    });
    expect(dependencies.linkSignInMethod).toHaveBeenCalledTimes(2);
  },
);

test("returns an existing User to the method manager when a new proof expires", async () => {
  const dependencies = createDependencies({
    linkSignInMethod: jest.fn(async () => {
      throw new OpenJobApiError(401, "fresh_authentication_required");
    }),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await coordinator.signIn("google");
  await coordinator.authenticateNewMethod("apple");

  await expect(coordinator.confirmLink()).resolves.toEqual({
    kind: "signed-in",
    methods: ["google"],
    notice: "fresh_authentication_required",
    user,
  });
  await expect(coordinator.authenticateNewMethod("apple")).resolves.toEqual({
    existingProvider: "google",
    kind: "confirm-link",
    newProvider: "apple",
    user,
  });
  expect(dependencies.clearStoredSession).not.toHaveBeenCalled();
});

test("revocation invalidates an in-flight link before it can restore signed-in state", async () => {
  let revoke: (() => void) | undefined;
  let resolveLink: ((value: typeof user) => void) | undefined;
  let markLinkStarted: (() => void) | undefined;
  const actualLinkStarted = new Promise<void>((resolve) => {
    markLinkStarted = resolve;
  });
  const dependencies = createDependencies({
    linkSignInMethod: jest.fn(
      () =>
        new Promise<typeof user>((resolve) => {
          resolveLink = resolve;
          markLinkStarted?.();
        }),
    ),
    subscribeToCredentialRevocation: (listener) => {
      revoke = listener;
      return () => undefined;
    },
  });
  const coordinator = new NativeAuthCoordinator(dependencies);
  let resolveRevocation: (() => void) | undefined;
  const revocation = new Promise<void>((resolve) => {
    resolveRevocation = resolve;
  });
  coordinator.subscribeToCredentialRevocation(() => resolveRevocation?.());

  await coordinator.signIn("google");
  await coordinator.authenticateNewMethod("apple");
  const linking = coordinator.confirmLink();
  await actualLinkStarted;
  revoke?.();
  await revocation;
  resolveLink?.(user);

  await expect(linking).rejects.toEqual(new ProviderSignInError("revoked"));
  await expect(
    coordinator.authenticateNewMethod("apple"),
  ).rejects.toThrow("An authenticated OpenJob User is required.");
});

test("serializes a stale SecureStore save before cleanup and surfaces clear failure", async () => {
  let revoke: (() => void) | undefined;
  let finishSave: (() => void) | undefined;
  let markSaveStarted: (() => void) | undefined;
  const saveStarted = new Promise<void>((resolve) => {
    markSaveStarted = resolve;
  });
  const events: string[] = [];
  const dependencies = createDependencies({
    clearStoredSession: jest.fn(async () => {
      events.push("clear");
      throw new Error("Keychain unavailable");
    }),
    saveStoredSession: jest.fn(async () => {
      events.push("save-start");
      markSaveStarted?.();
      await new Promise<void>((resolve) => {
        finishSave = resolve;
      });
      events.push("save-finish");
    }),
    subscribeToCredentialRevocation: (listener) => {
      revoke = listener;
      return () => undefined;
    },
  });
  const coordinator = new NativeAuthCoordinator(dependencies);
  let resolveRevocation: ((result: AuthFlowResult) => void) | undefined;
  const revocation = new Promise<AuthFlowResult>((resolve) => {
    resolveRevocation = resolve;
  });
  coordinator.subscribeToCredentialRevocation((result) =>
    resolveRevocation?.(result),
  );

  const signingIn = coordinator.signIn("google");
  await saveStarted;
  revoke?.();
  finishSave?.();

  await expect(signingIn).rejects.toEqual(new ProviderSignInError("revoked"));
  await expect(revocation).resolves.toEqual({ kind: "cleanup-retry" });
  expect(events).toEqual(["save-start", "save-finish", "clear"]);
});

test("serializes a provider prompt before revocation cleanup", async () => {
  let revoke: (() => void) | undefined;
  let finishProvider: (() => void) | undefined;
  let markProviderStarted: (() => void) | undefined;
  const providerStarted = new Promise<void>((resolve) => {
    markProviderStarted = resolve;
  });
  const events: string[] = [];
  const dependencies = createDependencies({
    clearProviderSession: jest.fn(async () => {
      events.push("provider-clear");
    }),
    signInWithProvider: jest.fn(
      (provider: "apple" | "google") =>
        new Promise((resolve) => {
          events.push("provider-start");
          markProviderStarted?.();
          finishProvider = () => {
            events.push("provider-finish");
            resolve({
              idToken: `${provider}-provider-token`,
              provider,
            });
          };
        }),
    ),
    subscribeToCredentialRevocation: (listener) => {
      revoke = listener;
      return () => undefined;
    },
  });
  const coordinator = new NativeAuthCoordinator(dependencies);
  let resolveRevocation: ((result: AuthFlowResult) => void) | undefined;
  const revocation = new Promise<AuthFlowResult>((resolve) => {
    resolveRevocation = resolve;
  });
  coordinator.subscribeToCredentialRevocation((result) =>
    resolveRevocation?.(result),
  );

  const signingIn = coordinator.signIn("google");
  await providerStarted;
  revoke?.();
  finishProvider?.();

  await expect(signingIn).rejects.toEqual(new ProviderSignInError("revoked"));
  await expect(revocation).resolves.toEqual({
    kind: "signed-out",
    reason: "revoked",
  });
  expect(events).toEqual([
    "provider-start",
    "provider-finish",
    "provider-clear",
  ]);
});

test("recovers a pending deletion after sign-in on a device without its receipt", async () => {
  const pendingStatusToken = "v1.pendingJobCapability.signaturePayload";
  const events: string[] = [];
  const dependencies = createDependencies({
    getMe: jest.fn(async () => {
      throw new OpenJobApiError(
        410,
        "account_deletion_pending",
        "Account deletion is in progress.",
      );
    }),
    prepareDeletionStatus: jest.fn(async () => {
      events.push("prepare");
      return {
        ...pendingDeletionStatus,
        statusToken: pendingStatusToken,
      };
    }),
    purgeLocalDomainCache: jest.fn(async () => {
      events.push("purge");
    }),
    saveDeletionReceipt: jest.fn(async () => {
      events.push("save-receipt");
    }),
    signInWithProvider: jest.fn(async () => ({
      idToken: "raw-google-id-token",
      provider: "google" as const,
      revocation: {
        idToken: "raw-google-id-token",
        kind: "access_token" as const,
        value: "fresh-google-access-token",
      },
    })),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await expect(coordinator.signIn("google")).resolves.toEqual({
    deadline: pendingDeletionStatus.deadline,
    kind: "deletion-pending",
    reauthenticationProviders: pendingDeletionStatus.reauthenticationProviders,
    requestedAt: pendingDeletionStatus.requestedAt,
  });
  expect(dependencies.prepareDeletionStatus).toHaveBeenCalledWith(
    "google-id-token",
    {
      credentialToken: "google-id-token",
      provider: "google",
      revocation: {
        idToken: "raw-google-id-token",
        kind: "access_token",
        value: "fresh-google-access-token",
      },
    },
  );
  expect(dependencies.saveDeletionReceipt).toHaveBeenCalledWith({
    phase: "submitting",
    statusToken: pendingStatusToken,
    version: 1,
  });
  expect(dependencies.listSignInMethods).not.toHaveBeenCalled();
  expect(dependencies.saveStoredSession).not.toHaveBeenCalled();
  expect(dependencies.purgeLocalDomainCache).toHaveBeenCalledTimes(1);
  expect(dependencies.clearStoredSession).toHaveBeenCalledTimes(1);
  expect(dependencies.clearProviderSession).toHaveBeenCalledTimes(1);
  expect(events).toEqual(["prepare", "save-receipt", "purge"]);
});

test("accepts a completed deletion race during proof-bound lost-receipt recovery", async () => {
  const events: string[] = [];
  const dependencies = createDependencies({
    getMe: jest.fn(async () => {
      throw new OpenJobApiError(
        410,
        "account_deletion_pending",
        "Account deletion is in progress.",
      );
    }),
    prepareDeletionStatus: jest.fn(async () => {
      events.push("prepare");
      return { status: "completed" as const };
    }),
    purgeLocalDomainCache: jest.fn(async () => {
      events.push("purge");
    }),
    signInWithProvider: jest.fn(async () => ({
      idToken: "raw-google-id-token",
      provider: "google" as const,
      revocation: {
        idToken: "raw-google-id-token",
        kind: "access_token" as const,
        value: "fresh-google-access-token",
      },
    })),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await expect(coordinator.signIn("google")).resolves.toEqual({
    kind: "deletion-completed",
  });
  expect(dependencies.prepareDeletionStatus).toHaveBeenCalledWith(
    "google-id-token",
    {
      credentialToken: "google-id-token",
      provider: "google",
      revocation: {
        idToken: "raw-google-id-token",
        kind: "access_token",
        value: "fresh-google-access-token",
      },
    },
  );
  expect(dependencies.saveDeletionReceipt).not.toHaveBeenCalled();
  expect(dependencies.purgeLocalDomainCache).toHaveBeenCalledTimes(1);
  expect(dependencies.clearStoredSession).toHaveBeenCalledTimes(1);
  expect(dependencies.clearProviderSession).toHaveBeenCalledTimes(1);
  expect(events).toEqual(["prepare", "purge"]);
});

test("retries a transient lost-receipt PUT with the exact same in-memory provider proof while access stays purged", async () => {
  const pendingStatusToken = "v1.pendingJobCapability.signaturePayload";
  const events: string[] = [];
  const prepareDeletionStatus = jest
    .fn()
    .mockImplementationOnce(async () => {
      events.push("prepare-1");
      throw new OpenJobApiError(
        503,
        "request_failed",
        "OpenJob could not complete the request.",
      );
    })
    .mockImplementationOnce(async () => {
      events.push("prepare-2");
      return {
        ...pendingDeletionStatus,
        statusToken: pendingStatusToken,
      };
    });
  const dependencies = createDependencies({
    getMe: jest.fn(async () => {
      throw new OpenJobApiError(
        410,
        "account_deletion_pending",
        "Account deletion is in progress.",
      );
    }),
    prepareDeletionStatus,
    purgeLocalDomainCache: jest.fn(async () => {
      events.push("purge");
    }),
    saveDeletionReceipt: jest.fn(async () => {
      events.push("save-receipt");
    }),
    signInWithProvider: jest.fn(async () => ({
      idToken: "raw-google-id-token",
      provider: "google" as const,
      revocation: {
        idToken: "raw-google-id-token",
        kind: "access_token" as const,
        value: "fresh-google-access-token",
      },
    })),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await expect(coordinator.signIn("google")).resolves.toEqual({
    kind: "deletion-status-retry",
    reason: "proof-retry",
  });
  expect(dependencies.saveDeletionReceipt).not.toHaveBeenCalled();
  expect(dependencies.purgeLocalDomainCache).toHaveBeenCalledTimes(1);
  expect(dependencies.clearStoredSession).toHaveBeenCalledTimes(1);
  expect(dependencies.clearProviderSession).toHaveBeenCalledTimes(1);

  await expect(coordinator.refreshDeletionStatus()).resolves.toEqual({
    deadline: pendingDeletionStatus.deadline,
    kind: "deletion-pending",
    reauthenticationProviders: pendingDeletionStatus.reauthenticationProviders,
    requestedAt: pendingDeletionStatus.requestedAt,
  });
  expect(prepareDeletionStatus).toHaveBeenCalledTimes(2);
  expect(prepareDeletionStatus.mock.calls[1][0]).toBe(
    prepareDeletionStatus.mock.calls[0][0],
  );
  expect(prepareDeletionStatus.mock.calls[1][1]).toBe(
    prepareDeletionStatus.mock.calls[0][1],
  );
  expect(prepareDeletionStatus.mock.calls[1]).toEqual([
    "google-id-token",
    {
      credentialToken: "google-id-token",
      provider: "google",
      revocation: {
        idToken: "raw-google-id-token",
        kind: "access_token",
        value: "fresh-google-access-token",
      },
    },
  ]);
  expect(dependencies.saveDeletionReceipt).toHaveBeenCalledWith({
    phase: "submitting",
    statusToken: pendingStatusToken,
    version: 1,
  });
  expect(dependencies.purgeLocalDomainCache).toHaveBeenCalledTimes(2);
  expect(events).toEqual([
    "prepare-1",
    "purge",
    "prepare-2",
    "save-receipt",
    "purge",
  ]);
});

test("bounds transient lost-receipt proof retries and then requires a new interactive provider sign-in", async () => {
  const prepareDeletionStatus = jest.fn(async () => {
    throw new OpenJobApiError(
      503,
      "request_failed",
      "OpenJob could not complete the request.",
    );
  });
  const dependencies = createDependencies({
    getMe: jest.fn(async () => {
      throw new OpenJobApiError(
        410,
        "account_deletion_pending",
        "Account deletion is in progress.",
      );
    }),
    prepareDeletionStatus,
    signInWithProvider: jest.fn(async () => ({
      idToken: "raw-google-id-token",
      provider: "google" as const,
      revocation: {
        idToken: "raw-google-id-token",
        kind: "access_token" as const,
        value: "fresh-google-access-token",
      },
    })),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await expect(coordinator.signIn("google")).resolves.toEqual({
    kind: "deletion-status-retry",
    reason: "proof-retry",
  });
  await expect(coordinator.refreshDeletionStatus()).resolves.toEqual({
    kind: "deletion-status-retry",
    reason: "proof-retry",
  });
  await expect(coordinator.refreshDeletionStatus()).resolves.toEqual({
    kind: "signed-out",
    reason: "deletion-pending",
  });
  await expect(coordinator.refreshDeletionStatus()).resolves.toEqual({
    kind: "signed-out",
  });
  expect(prepareDeletionStatus).toHaveBeenCalledTimes(3);
  expect(dependencies.saveDeletionReceipt).not.toHaveBeenCalled();
  expect(dependencies.purgeLocalDomainCache).toHaveBeenCalledTimes(3);
});

test("expires an in-memory lost-receipt proof after five minutes without resubmitting it", async () => {
  let now = 1_000;
  const prepareDeletionStatus = jest.fn(async () => {
    throw new OpenJobApiError(
      503,
      "request_failed",
      "OpenJob could not complete the request.",
    );
  });
  const dependencies = createDependencies({
    getMe: jest.fn(async () => {
      throw new OpenJobApiError(
        410,
        "account_deletion_pending",
        "Account deletion is in progress.",
      );
    }),
    now: () => now,
    prepareDeletionStatus,
    signInWithProvider: jest.fn(async () => ({
      idToken: "raw-google-id-token",
      provider: "google" as const,
      revocation: {
        idToken: "raw-google-id-token",
        kind: "access_token" as const,
        value: "fresh-google-access-token",
      },
    })),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await expect(coordinator.signIn("google")).resolves.toEqual({
    kind: "deletion-status-retry",
    reason: "proof-retry",
  });
  now += 5 * 60_000;
  await expect(coordinator.refreshDeletionStatus()).resolves.toEqual({
    kind: "signed-out",
    reason: "deletion-pending",
  });
  expect(prepareDeletionStatus).toHaveBeenCalledTimes(1);
  expect(dependencies.saveDeletionReceipt).not.toHaveBeenCalled();
  expect(dependencies.purgeLocalDomainCache).toHaveBeenCalledTimes(2);
});

test("drops a permanently invalid lost-receipt response instead of resubmitting sensitive proof", async () => {
  const prepareDeletionStatus = jest.fn(async () => {
    throw new OpenJobApiError(
      502,
      "invalid_response",
      "OpenJob returned an invalid deletion status.",
    );
  });
  const dependencies = createDependencies({
    getMe: jest.fn(async () => {
      throw new OpenJobApiError(
        410,
        "account_deletion_pending",
        "Account deletion is in progress.",
      );
    }),
    prepareDeletionStatus,
    signInWithProvider: jest.fn(async () => ({
      idToken: "raw-google-id-token",
      provider: "google" as const,
      revocation: {
        idToken: "raw-google-id-token",
        kind: "access_token" as const,
        value: "fresh-google-access-token",
      },
    })),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await expect(coordinator.signIn("google")).resolves.toEqual({
    kind: "signed-out",
    reason: "deletion-pending",
  });
  await expect(coordinator.refreshDeletionStatus()).resolves.toEqual({
    kind: "signed-out",
  });
  expect(prepareDeletionStatus).toHaveBeenCalledTimes(1);
  expect(dependencies.saveDeletionReceipt).not.toHaveBeenCalled();
  expect(dependencies.purgeLocalDomainCache).toHaveBeenCalledTimes(1);
});

test("a Firebase-only restore cannot recover a lost pending receipt without fresh provider proof", async () => {
  const dependencies = createDependencies({
    getMe: jest.fn(async () => {
      throw new OpenJobApiError(
        410,
        "account_deletion_pending",
        "Account deletion is in progress.",
      );
    }),
    loadStoredSession: jest.fn(async () => ({
      ownerUserId: user.userId,
      provider: "google" as const,
      refreshToken: "google-refresh-token",
      version: 2 as const,
    })),
    prepareDeletionStatus: jest.fn(async () => {
      throw new OpenJobApiError(
        401,
        "fresh_authentication_required",
        "Freshly authenticate the required Sign-in Method.",
      );
    }),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await expect(coordinator.restore()).resolves.toEqual({
    kind: "signed-out",
    reason: "deletion-pending",
  });
  expect(dependencies.prepareDeletionStatus).not.toHaveBeenCalled();
  expect(dependencies.purgeLocalDomainCache).toHaveBeenCalledTimes(1);
  expect(dependencies.clearStoredSession).toHaveBeenCalledTimes(1);
  expect(dependencies.clearProviderSession).toHaveBeenCalledTimes(1);
});

test("a QA-only sign-in cannot recover a lost pending receipt without fresh provider proof", async () => {
  const dependencies = createDependencies({
    getMe: jest.fn(async () => {
      throw new OpenJobApiError(
        410,
        "account_deletion_pending",
        "Account deletion is in progress.",
      );
    }),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await expect(
    coordinator.signInWithQaPassword("qa@example.test", "qa-password"),
  ).resolves.toEqual({
    kind: "signed-out",
    reason: "deletion-pending",
  });
  expect(dependencies.prepareDeletionStatus).not.toHaveBeenCalled();
  expect(dependencies.purgeLocalDomainCache).toHaveBeenCalledTimes(1);
  expect(dependencies.clearStoredSession).toHaveBeenCalledTimes(1);
  expect(dependencies.clearProviderSession).toHaveBeenCalledTimes(1);
});

test("interactive recovery without revocation proof fails closed and prompts provider sign-in again", async () => {
  const dependencies = createDependencies({
    getMe: jest.fn(async () => {
      throw new OpenJobApiError(
        410,
        "account_deletion_pending",
        "Account deletion is in progress.",
      );
    }),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await expect(coordinator.signIn("google")).resolves.toEqual({
    kind: "signed-out",
    reason: "deletion-pending",
  });
  expect(dependencies.prepareDeletionStatus).not.toHaveBeenCalled();
  expect(dependencies.purgeLocalDomainCache).toHaveBeenCalledTimes(1);
  expect(dependencies.clearStoredSession).toHaveBeenCalledTimes(1);
  expect(dependencies.clearProviderSession).toHaveBeenCalledTimes(1);
});

test("fails closed when a recovered pending-deletion receipt cannot be stored", async () => {
  const pendingStatusToken = "v1.pendingJobCapability.signaturePayload";
  const saveError = new Error("Keychain unavailable");
  const events: string[] = [];
  const dependencies = createDependencies({
    getMe: jest.fn(async () => {
      throw new OpenJobApiError(
        410,
        "account_deletion_pending",
        "Account deletion is in progress.",
      );
    }),
    prepareDeletionStatus: jest.fn(async () => {
      events.push("prepare");
      return {
        ...pendingDeletionStatus,
        statusToken: pendingStatusToken,
      };
    }),
    purgeLocalDomainCache: jest.fn(async () => {
      events.push("purge");
    }),
    saveDeletionReceipt: jest.fn(async () => {
      events.push("save-receipt");
      throw saveError;
    }),
    signInWithProvider: jest.fn(async () => ({
      idToken: "raw-google-id-token",
      provider: "google" as const,
      revocation: {
        idToken: "raw-google-id-token",
        kind: "access_token" as const,
        value: "fresh-google-access-token",
      },
    })),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await expect(coordinator.signIn("google")).resolves.toEqual({
    kind: "deletion-status-retry",
    reason: "storage-unavailable",
  });
  expect(dependencies.saveDeletionReceipt).toHaveBeenCalledWith({
    phase: "submitting",
    statusToken: pendingStatusToken,
    version: 1,
  });
  expect(dependencies.listSignInMethods).not.toHaveBeenCalled();
  expect(dependencies.saveStoredSession).not.toHaveBeenCalled();
  expect(dependencies.purgeLocalDomainCache).toHaveBeenCalledTimes(1);
  expect(dependencies.clearStoredSession).toHaveBeenCalledTimes(1);
  expect(dependencies.clearProviderSession).toHaveBeenCalledTimes(1);
  expect(events).toEqual(["prepare", "save-receipt", "purge"]);
});

test("deletes a User only after fresh proof for every linked method and purges local data", async () => {
  const dependencies = createDependencies({
    listSignInMethods: jest.fn(async () => ["google" as const, "apple" as const]),
    signInWithProvider: jest.fn(async (provider: "apple" | "google") => ({
      idToken: `${provider}-provider-token`,
      provider,
      revocation:
        provider === "google"
          ? {
              idToken: "google-provider-token",
              kind: "access_token" as const,
              value: "google-access",
            }
          : {
              clientId: "dev.openjob.app",
              idToken: "apple-provider-token",
              kind: "authorization_code" as const,
              value: "apple-code",
            },
    })),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);
  await coordinator.signIn("google");

  await expect(coordinator.deleteUser()).resolves.toEqual({
    kind: "deletion-completed",
  });
  expect(dependencies.prepareDeletionStatus).toHaveBeenCalledWith(
    "google-id-token",
  );
  expect(dependencies.saveDeletionReceipt).toHaveBeenNthCalledWith(
    1,
    deletionReceipt,
  );
  expect(dependencies.saveDeletionReceipt).toHaveBeenNthCalledWith(
    2,
    submittingDeletionReceipt,
  );
  expect(dependencies.saveDeletionReceipt).toHaveBeenNthCalledWith(
    3,
    completedDeletionReceipt,
  );
  expect(dependencies.deleteUser).toHaveBeenCalledWith(
    "google-id-token",
    [
      {
        credentialToken: "apple-id-token",
        provider: "apple",
        revocation: {
          clientId: "dev.openjob.app",
          idToken: "apple-provider-token",
          kind: "authorization_code",
          value: "apple-code",
        },
      },
      {
        credentialToken: "google-id-token",
        provider: "google",
        revocation: {
          idToken: "google-provider-token",
          kind: "access_token",
          value: "google-access",
        },
      },
    ],
    deletionStatusToken,
  );
  expect(dependencies.purgeLocalDomainCache).toHaveBeenCalledTimes(1);
  expect(dependencies.clearStoredSession).toHaveBeenCalledTimes(1);
  expect(dependencies.clearProviderSession).toHaveBeenCalledTimes(1);
  expect(dependencies.clearDeletionReceipt).not.toHaveBeenCalled();
});

test("reports pending deletion after access ends and still purges local data", async () => {
  const events: string[] = [];
  const dependencies = createDependencies({
    deleteUser: jest.fn(async () => {
      events.push("delete");
      return {
        ...pendingDeletionStatus,
        statusToken: deletionStatusToken,
      };
    }),
    prepareDeletionStatus: jest.fn(async () => {
      events.push("prepare");
      return {
        status: "not_started" as const,
        statusToken: deletionStatusToken,
        submissionExpiresAt: "2026-07-28T12:05:00.000Z",
      };
    }),
    purgeLocalDomainCache: jest.fn(async () => {
      events.push("purge");
    }),
    saveDeletionReceipt: jest.fn(async () => {
      events.push("save-receipt");
    }),
    signInWithProvider: jest.fn(async () => {
      events.push("provider");
      return {
        idToken: "google-provider-token",
        provider: "google" as const,
        revocation: {
          idToken: "google-provider-token",
          kind: "access_token" as const,
          value: "google-access",
        },
      };
    }),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);
  await coordinator.signIn("google");
  events.length = 0;
  await expect(coordinator.deleteUser()).resolves.toEqual({
    deadline: pendingDeletionStatus.deadline,
    kind: "deletion-pending",
    reauthenticationProviders: pendingDeletionStatus.reauthenticationProviders,
    requestedAt: pendingDeletionStatus.requestedAt,
  });
  expect(dependencies.saveDeletionReceipt).toHaveBeenNthCalledWith(
    1,
    deletionReceipt,
  );
  expect(dependencies.saveDeletionReceipt).toHaveBeenNthCalledWith(
    2,
    submittingDeletionReceipt,
  );
  expect(events).toEqual([
    "prepare",
    "save-receipt",
    "provider",
    "save-receipt",
    "delete",
    "purge",
  ]);
  expect(dependencies.purgeLocalDomainCache).toHaveBeenCalledTimes(1);
});

test("reauthenticates only the requested pending provider and resumes the same deletion", async () => {
  const pendingReauthentication = {
    ...pendingDeletionStatus,
    reauthenticationProviders: ["google" as const],
  };
  const dependencies = createDependencies({
    getDeletionStatus: jest.fn(async () => pendingReauthentication),
    loadDeletionReceipt: jest.fn(async () => submittingDeletionReceipt),
    refreshDeletionProvider: jest.fn(async () => ({
      ...pendingDeletionStatus,
      statusToken: deletionStatusToken,
    })),
    signInWithProvider: jest.fn(async () => ({
      idToken: "raw-google-id-token",
      provider: "google" as const,
      revocation: {
        idToken: "raw-google-id-token",
        kind: "access_token" as const,
        value: "google-access-token",
      },
    })),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await expect(
    coordinator.reauthenticateDeletionProvider("google"),
  ).resolves.toEqual({
    deadline: pendingDeletionStatus.deadline,
    kind: "deletion-pending",
    reauthenticationProviders: [],
    requestedAt: pendingDeletionStatus.requestedAt,
  });
  expect(dependencies.getDeletionStatus).toHaveBeenCalledWith(
    deletionStatusToken,
  );
  expect(dependencies.signInWithProvider).toHaveBeenCalledWith("google");
  expect(dependencies.refreshDeletionProvider).toHaveBeenCalledWith(
    deletionStatusToken,
    {
      credentialToken: "google-id-token",
      provider: "google",
      revocation: {
        idToken: "raw-google-id-token",
        kind: "access_token",
        value: "google-access-token",
      },
    },
  );
  expect(dependencies.clearStoredSession).toHaveBeenCalledTimes(2);
  expect(dependencies.clearProviderSession).toHaveBeenCalledTimes(2);
});

test("an already-pending PUT stores its job receipt and ends access before provider auth", async () => {
  const events: string[] = [];
  const pendingStatusToken = "v1.pendingJobCapability.signaturePayload";
  const pendingReceipt = {
    phase: "submitting" as const,
    statusToken: pendingStatusToken,
    version: 1 as const,
  };
  const signInWithProvider = jest.fn(async () => ({
    idToken: "google-provider-token",
    provider: "google" as const,
  }));
  const dependencies = createDependencies({
    prepareDeletionStatus: jest.fn(async () => {
      events.push("prepare");
      return {
        ...pendingDeletionStatus,
        statusToken: pendingStatusToken,
      };
    }),
    purgeLocalDomainCache: jest.fn(async () => {
      events.push("purge");
    }),
    saveDeletionReceipt: jest.fn(async (receipt) => {
      events.push(`save-${receipt.phase}`);
    }),
    signInWithProvider,
  });
  const coordinator = new NativeAuthCoordinator(dependencies);
  await coordinator.signIn("google");
  events.length = 0;

  await expect(coordinator.deleteUser()).resolves.toEqual({
    deadline: pendingDeletionStatus.deadline,
    kind: "deletion-pending",
    reauthenticationProviders: pendingDeletionStatus.reauthenticationProviders,
    requestedAt: pendingDeletionStatus.requestedAt,
  });
  expect(events).toEqual(["prepare", "save-submitting", "purge"]);
  expect(dependencies.saveDeletionReceipt).toHaveBeenCalledWith(
    pendingReceipt,
  );
  expect(signInWithProvider).toHaveBeenCalledTimes(1);
  expect(dependencies.exchangeProviderCredential).toHaveBeenCalledTimes(1);
  expect(dependencies.deleteUser).not.toHaveBeenCalled();
  expect(dependencies.clearStoredSession).toHaveBeenCalledTimes(1);
  expect(dependencies.clearProviderSession).toHaveBeenCalledTimes(1);
});

test("an already-pending PUT still purges access when its job receipt cannot be saved", async () => {
  const saveError = new Error("Keychain unavailable");
  const signInWithProvider = jest.fn(async () => ({
    idToken: "google-provider-token",
    provider: "google" as const,
  }));
  const dependencies = createDependencies({
    getDeletionStatus: jest.fn(async () => pendingDeletionStatus),
    prepareDeletionStatus: jest.fn(async () => ({
      ...pendingDeletionStatus,
      statusToken: "v1.pendingJobCapability.signaturePayload",
    })),
    saveDeletionReceipt: jest
      .fn()
      .mockRejectedValueOnce(saveError)
      .mockResolvedValueOnce(undefined),
    signInWithProvider,
  });
  const coordinator = new NativeAuthCoordinator(dependencies);
  await coordinator.signIn("google");

  await expect(coordinator.deleteUser()).resolves.toEqual({
    kind: "deletion-status-retry",
    reason: "storage-unavailable",
  });
  expect(signInWithProvider).toHaveBeenCalledTimes(1);
  expect(dependencies.deleteUser).not.toHaveBeenCalled();
  expect(dependencies.purgeLocalDomainCache).toHaveBeenCalledTimes(1);
  expect(dependencies.clearStoredSession).toHaveBeenCalledTimes(1);
  expect(dependencies.clearProviderSession).toHaveBeenCalledTimes(1);

  await expect(coordinator.refreshDeletionStatus()).resolves.toEqual({
    deadline: pendingDeletionStatus.deadline,
    kind: "deletion-pending",
    reauthenticationProviders: pendingDeletionStatus.reauthenticationProviders,
    requestedAt: pendingDeletionStatus.requestedAt,
  });
  expect(dependencies.getDeletionStatus).toHaveBeenCalledTimes(1);
  expect(dependencies.saveDeletionReceipt).toHaveBeenCalledTimes(2);
  expect(dependencies.saveDeletionReceipt).toHaveBeenLastCalledWith({
    phase: "submitting",
    statusToken: "v1.pendingJobCapability.signaturePayload",
    version: 1,
  });
  expect(dependencies.purgeLocalDomainCache).toHaveBeenCalledTimes(2);
  expect(signInWithProvider).toHaveBeenCalledTimes(1);
  expect(dependencies.deleteUser).not.toHaveBeenCalled();
});

test("serializes deletion attempts so status capabilities cannot interleave", async () => {
  let finishPost: ((result: { status: "completed" }) => void) | undefined;
  let markPostStarted: (() => void) | undefined;
  const postStarted = new Promise<void>((resolve) => {
    markPostStarted = resolve;
  });
  const dependencies = createDependencies({
    deleteUser: jest.fn(
      () =>
        new Promise<{ status: "completed" }>((resolve) => {
          markPostStarted?.();
          finishPost = resolve;
        }),
    ),
    signInWithProvider: jest.fn(async () => ({
      idToken: "google-provider-token",
      provider: "google" as const,
      revocation: {
        idToken: "google-provider-token",
        kind: "access_token" as const,
        value: "google-access",
      },
    })),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);
  await coordinator.signIn("google");

  const first = coordinator.deleteUser();
  const second = coordinator.deleteUser();
  await postStarted;

  expect(dependencies.prepareDeletionStatus).toHaveBeenCalledTimes(1);
  expect(dependencies.saveDeletionReceipt).toHaveBeenCalledTimes(2);
  expect(dependencies.deleteUser).toHaveBeenCalledTimes(1);
  finishPost?.({ status: "completed" });
  await expect(first).resolves.toEqual({ kind: "deletion-completed" });
  await expect(second).rejects.toThrow(
    "An authenticated OpenJob User is required.",
  );
  expect(dependencies.prepareDeletionStatus).toHaveBeenCalledTimes(1);
  expect(dependencies.deleteUser).toHaveBeenCalledTimes(1);
});

test("does not start deletion or purge when its prepared receipt cannot be persisted", async () => {
  const saveError = new Error("Keychain unavailable");
  const dependencies = createDependencies({
    saveDeletionReceipt: jest.fn(async () => {
      throw saveError;
    }),
    signInWithProvider: jest.fn(async () => ({
      idToken: "google-provider-token",
      provider: "google" as const,
      revocation: {
        idToken: "google-provider-token",
        kind: "access_token" as const,
        value: "google-access",
      },
    })),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);
  await coordinator.signIn("google");

  await expect(coordinator.deleteUser()).rejects.toBe(saveError);
  expect(dependencies.prepareDeletionStatus).toHaveBeenCalledTimes(1);
  expect(dependencies.saveDeletionReceipt).toHaveBeenCalledWith(
    deletionReceipt,
  );
  expect(dependencies.deleteUser).not.toHaveBeenCalled();
  expect(dependencies.purgeLocalDomainCache).not.toHaveBeenCalled();
  expect(dependencies.clearStoredSession).not.toHaveBeenCalled();
  expect(dependencies.clearProviderSession).not.toHaveBeenCalled();
  expect(dependencies.signInWithProvider).toHaveBeenCalledTimes(1);
  await expect(coordinator.listGroups()).resolves.toEqual([]);
});

test("persists prepared intent before fresh provider authentication", async () => {
  const providerError = new ProviderSignInError("cancelled");
  const signInWithProvider = jest
    .fn()
    .mockResolvedValueOnce({
      idToken: "google-provider-token",
      provider: "google" as const,
    })
    .mockRejectedValueOnce(providerError);
  const dependencies = createDependencies({ signInWithProvider });
  const coordinator = new NativeAuthCoordinator(dependencies);
  await coordinator.signIn("google");

  await expect(coordinator.deleteUser()).rejects.toBe(providerError);
  expect(dependencies.prepareDeletionStatus).toHaveBeenCalledTimes(1);
  expect(dependencies.saveDeletionReceipt).toHaveBeenCalledTimes(1);
  expect(dependencies.saveDeletionReceipt).toHaveBeenCalledWith(
    deletionReceipt,
  );
  expect(signInWithProvider).toHaveBeenCalledTimes(2);
  expect(dependencies.deleteUser).not.toHaveBeenCalled();
  expect(dependencies.purgeLocalDomainCache).not.toHaveBeenCalled();
});

test("does not prompt providers when the deletion preflight rejects an existing intent", async () => {
  const preflightError = new OpenJobApiError(
    409,
    "deletion_pending",
    "Deletion is already pending.",
  );
  const signInWithProvider = jest.fn(async () => ({
    idToken: "google-provider-token",
    provider: "google" as const,
  }));
  const dependencies = createDependencies({
    prepareDeletionStatus: jest.fn(async () => {
      throw preflightError;
    }),
    signInWithProvider,
  });
  const coordinator = new NativeAuthCoordinator(dependencies);
  await coordinator.signIn("google");

  await expect(coordinator.deleteUser()).rejects.toBe(preflightError);
  expect(signInWithProvider).toHaveBeenCalledTimes(1);
  expect(dependencies.saveDeletionReceipt).not.toHaveBeenCalled();
  expect(dependencies.deleteUser).not.toHaveBeenCalled();
  expect(dependencies.purgeLocalDomainCache).not.toHaveBeenCalled();
});

test("does not POST when the submitting phase overwrite fails", async () => {
  const saveError = new Error("Keychain overwrite unavailable");
  const dependencies = createDependencies({
    saveDeletionReceipt: jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(saveError),
    signInWithProvider: jest.fn(async () => ({
      idToken: "google-provider-token",
      provider: "google" as const,
      revocation: {
        idToken: "google-provider-token",
        kind: "access_token" as const,
        value: "google-access",
      },
    })),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);
  await coordinator.signIn("google");

  await expect(coordinator.deleteUser()).rejects.toBe(saveError);
  expect(dependencies.saveDeletionReceipt).toHaveBeenNthCalledWith(
    1,
    deletionReceipt,
  );
  expect(dependencies.saveDeletionReceipt).toHaveBeenNthCalledWith(
    2,
    submittingDeletionReceipt,
  );
  expect(dependencies.deleteUser).not.toHaveBeenCalled();
  expect(dependencies.purgeLocalDomainCache).not.toHaveBeenCalled();
  expect(dependencies.clearStoredSession).not.toHaveBeenCalled();
  await expect(coordinator.listGroups()).resolves.toEqual([]);
});

test("resolves a destructive POST response loss through the pre-persisted token", async () => {
  const events: string[] = [];
  const dependencies = createDependencies({
    deleteUser: jest.fn(async () => {
      events.push("delete");
      throw new ProviderSignInError("offline");
    }),
    getDeletionStatus: jest.fn(async () => {
      events.push("status");
      return pendingDeletionStatus;
    }),
    purgeLocalDomainCache: jest.fn(async () => {
      events.push("purge");
    }),
    saveDeletionReceipt: jest.fn(async () => {
      events.push("save-receipt");
    }),
    signInWithProvider: jest.fn(async () => ({
      idToken: "google-provider-token",
      provider: "google" as const,
      revocation: {
        idToken: "google-provider-token",
        kind: "access_token" as const,
        value: "google-access",
      },
    })),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);
  await coordinator.signIn("google");

  await expect(coordinator.deleteUser()).resolves.toEqual({
    deadline: pendingDeletionStatus.deadline,
    kind: "deletion-pending",
    reauthenticationProviders: pendingDeletionStatus.reauthenticationProviders,
    requestedAt: pendingDeletionStatus.requestedAt,
  });
  expect(events).toEqual([
    "save-receipt",
    "save-receipt",
    "delete",
    "status",
    "purge",
  ]);
  expect(dependencies.getDeletionStatus).toHaveBeenCalledWith(
    deletionStatusToken,
  );
});

test("finishes failed local cleanup before restoring a pending deletion receipt", async () => {
  const dependencies = createDependencies({
    clearStoredSession: jest
      .fn()
      .mockRejectedValueOnce(new Error("Keychain unavailable"))
      .mockResolvedValueOnce(undefined),
    deleteUser: jest.fn(async () => ({
      ...pendingDeletionStatus,
      statusToken: deletionStatusToken,
    })),
    getDeletionStatus: jest.fn(async () => pendingDeletionStatus),
    signInWithProvider: jest.fn(async () => ({
      idToken: "google-provider-token",
      provider: "google" as const,
      revocation: {
        idToken: "google-provider-token",
        kind: "access_token" as const,
        value: "google-access",
      },
    })),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);
  await coordinator.signIn("google");

  await expect(coordinator.deleteUser()).resolves.toEqual({
    kind: "cleanup-retry",
  });
  await expect(coordinator.signOut()).resolves.toEqual({
    deadline: pendingDeletionStatus.deadline,
    kind: "deletion-pending",
    reauthenticationProviders: pendingDeletionStatus.reauthenticationProviders,
    requestedAt: pendingDeletionStatus.requestedAt,
  });
  expect(dependencies.getDeletionStatus).toHaveBeenCalledWith(
    deletionStatusToken,
  );
});

test("a new coordinator clears a prepared not-started receipt and restores auth without purging", async () => {
  const events: string[] = [];
  const dependencies = createDependencies({
    clearDeletionReceipt: jest.fn(async () => {
      events.push("clear-receipt");
    }),
    getDeletionStatus: jest.fn(async () => {
      events.push("status");
      return {
        status: "not_started" as const,
        submissionExpired: true as const,
        submissionExpiresAt,
      };
    }),
    loadDeletionReceipt: jest.fn(async () => deletionReceipt),
    loadStoredSession: jest.fn(async () => ({
      ownerUserId: user.userId,
      provider: "google" as const,
      refreshToken: "google-refresh-token",
      version: 2 as const,
    })),
    refreshSession: jest.fn(async () => {
      events.push("refresh-auth");
      return googleSession;
    }),
  });
  const relaunched = new NativeAuthCoordinator(dependencies);

  await expect(relaunched.restoreCachedSession()).resolves.toBeNull();
  await expect(relaunched.restore()).resolves.toEqual({
    kind: "signed-in",
    methods: ["google"],
    user,
  });
  expect(events).toEqual(["status", "clear-receipt", "refresh-auth"]);
  expect(dependencies.purgeLocalDomainCache).not.toHaveBeenCalled();
  expect(dependencies.clearStoredSession).not.toHaveBeenCalled();
});

test("a not-started receipt remains access-blocking until its exact submission window expires", async () => {
  const dependencies = createDependencies({
    getDeletionStatus: jest.fn(async () => ({
      status: "not_started" as const,
      submissionExpired: false,
      submissionExpiresAt,
    })),
    loadDeletionReceipt: jest.fn(async () => deletionReceipt),
    loadStoredSession: jest.fn(async () => ({
      ownerUserId: user.userId,
      provider: "google" as const,
      refreshToken: "google-refresh-token",
      version: 2 as const,
    })),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await expect(coordinator.restoreCachedSession()).resolves.toBeNull();
  await expect(coordinator.restore()).resolves.toEqual({
    kind: "deletion-status-retry",
    reason: "unavailable",
  });
  expect(dependencies.getDeletionStatus).toHaveBeenCalledWith(
    deletionStatusToken,
  );
  expect(dependencies.clearDeletionReceipt).not.toHaveBeenCalled();
  expect(dependencies.loadStoredSession).not.toHaveBeenCalled();
  expect(dependencies.purgeLocalDomainCache).toHaveBeenCalledTimes(1);
  expect(dependencies.clearStoredSession).toHaveBeenCalledTimes(1);
  expect(dependencies.clearProviderSession).toHaveBeenCalledTimes(1);
});

test("a new coordinator clears a canceled submitting receipt and restores auth", async () => {
  const dependencies = createDependencies({
    getDeletionStatus: jest.fn(async () => ({
      status: "not_started" as const,
      submissionExpired: true as const,
      submissionExpiresAt,
    })),
    loadDeletionReceipt: jest.fn(async () => submittingDeletionReceipt),
    loadStoredSession: jest.fn(async () => ({
      ownerUserId: user.userId,
      provider: "google" as const,
      refreshToken: "google-refresh-token",
      version: 2 as const,
    })),
  });
  const relaunched = new NativeAuthCoordinator(dependencies);

  await expect(relaunched.restore()).resolves.toEqual({
    kind: "signed-in",
    methods: ["google"],
    user,
  });
  expect(dependencies.clearDeletionReceipt).toHaveBeenCalledTimes(1);
  expect(dependencies.purgeLocalDomainCache).not.toHaveBeenCalled();
});

test("a new coordinator queries a pending receipt before purging and blocks sign-in", async () => {
  const events: string[] = [];
  const dependencies = createDependencies({
    getDeletionStatus: jest.fn(async () => {
      events.push("status");
      return pendingDeletionStatus;
    }),
    loadDeletionReceipt: jest.fn(async () => deletionReceipt),
    purgeLocalDomainCache: jest.fn(async () => {
      events.push("purge");
    }),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await expect(coordinator.restoreCachedSession()).resolves.toBeNull();
  await expect(coordinator.restore()).resolves.toEqual({
    deadline: pendingDeletionStatus.deadline,
    kind: "deletion-pending",
    reauthenticationProviders: pendingDeletionStatus.reauthenticationProviders,
    requestedAt: pendingDeletionStatus.requestedAt,
  });
  await expect(coordinator.signIn("google")).resolves.toEqual({
    deadline: pendingDeletionStatus.deadline,
    kind: "deletion-pending",
    reauthenticationProviders: pendingDeletionStatus.reauthenticationProviders,
    requestedAt: pendingDeletionStatus.requestedAt,
  });
  expect(dependencies.getDeletionStatus).toHaveBeenCalledWith(
    deletionStatusToken,
  );
  expect(dependencies.signInWithProvider).not.toHaveBeenCalled();
  expect(dependencies.loadStoredSession).not.toHaveBeenCalled();
  expect(dependencies.purgeLocalDomainCache).toHaveBeenCalledTimes(2);
  expect(dependencies.clearStoredSession).toHaveBeenCalledTimes(2);
  expect(dependencies.clearProviderSession).toHaveBeenCalledTimes(2);
  expect(events.slice(0, 2)).toEqual(["status", "purge"]);
});

test.each([
  ["offline", new ProviderSignInError("offline")],
  [
    "invalid-response",
    new OpenJobApiError(502, "invalid_response", "Invalid response"),
  ],
])("purges and retains a submitting receipt when status refresh is %s", async (reason, error) => {
  const events: string[] = [];
  const dependencies = createDependencies({
    getDeletionStatus: jest.fn(async () => {
      events.push("status");
      throw error;
    }),
    loadDeletionReceipt: jest.fn(async () => submittingDeletionReceipt),
    purgeLocalDomainCache: jest.fn(async () => {
      events.push("purge");
    }),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await expect(coordinator.refreshDeletionStatus()).resolves.toEqual({
    kind: "deletion-status-retry",
    reason,
  });
  expect(events).toEqual(["status", "purge"]);
  expect(dependencies.clearDeletionReceipt).not.toHaveBeenCalled();
  expect(dependencies.clearStoredSession).toHaveBeenCalledTimes(1);
});

test("purges and blocks sign-in when the protected receipt cannot be decoded", async () => {
  const events: string[] = [];
  const dependencies = createDependencies({
    loadDeletionReceipt: jest.fn(async () => {
      events.push("load-receipt");
      throw new ProviderSignInError("unavailable");
    }),
    purgeLocalDomainCache: jest.fn(async () => {
      events.push("purge");
    }),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await expect(coordinator.signIn("google")).resolves.toEqual({
    kind: "deletion-status-retry",
    reason: "unavailable",
  });
  expect(events).toEqual(["load-receipt", "purge"]);
  expect(dependencies.signInWithProvider).not.toHaveBeenCalled();
  expect(dependencies.clearStoredSession).toHaveBeenCalledTimes(1);
  expect(dependencies.clearDeletionReceipt).not.toHaveBeenCalled();
});

test("a completed receipt survives termination before final UI render", async () => {
  const events: string[] = [];
  let storedReceipt:
    | typeof completedDeletionReceipt
    | typeof deletionReceipt
    | typeof submittingDeletionReceipt
    | null = null;
  let releaseCompletedSave: (() => void) | undefined;
  let markCompletedSaved: (() => void) | undefined;
  const completedSaved = new Promise<void>((resolve) => {
    markCompletedSaved = resolve;
  });
  const dependencies = createDependencies({
    loadDeletionReceipt: jest.fn(async () => storedReceipt),
    saveDeletionReceipt: jest.fn(async (receipt) => {
      events.push(`save-${receipt.phase}`);
      storedReceipt = receipt;
      if (receipt.phase === "completed") {
        markCompletedSaved?.();
        await new Promise<void>((resolve) => {
          releaseCompletedSave = resolve;
        });
      }
    }),
    purgeLocalDomainCache: jest.fn(async () => {
      events.push("purge");
    }),
    signInWithProvider: jest.fn(async () => ({
      idToken: "google-provider-token",
      provider: "google" as const,
      revocation: {
        idToken: "google-provider-token",
        kind: "access_token" as const,
        value: "google-access",
      },
    })),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);
  await coordinator.signIn("google");

  const deletion = coordinator.deleteUser();
  await completedSaved;
  expect(storedReceipt).toEqual(completedDeletionReceipt);
  expect(events).toEqual([
    "save-prepared",
    "save-submitting",
    "purge",
    "save-completed",
  ]);

  const relaunched = new NativeAuthCoordinator(dependencies);
  const getMeCalls = dependencies.getMe.mock.calls.length;
  await expect(relaunched.restoreCachedSession()).resolves.toBeNull();
  await expect(relaunched.restore()).resolves.toEqual({
    kind: "deletion-completed",
  });
  expect(dependencies.getDeletionStatus).not.toHaveBeenCalled();
  expect(dependencies.getMe).toHaveBeenCalledTimes(getMeCalls);
  expect(dependencies.refreshSession).not.toHaveBeenCalled();
  expect(dependencies.loadStoredSession).not.toHaveBeenCalled();
  expect(dependencies.clearDeletionReceipt).not.toHaveBeenCalled();

  releaseCompletedSave?.();
  await expect(deletion).resolves.toEqual({ kind: "deletion-completed" });
});

test("a failed completed-phase write retains submitting so relaunch re-proves completion", async () => {
  let storedReceipt:
    | typeof completedDeletionReceipt
    | typeof deletionReceipt
    | typeof submittingDeletionReceipt
    | null = null;
  let failCompletedSave = true;
  const dependencies = createDependencies({
    loadDeletionReceipt: jest.fn(async () => storedReceipt),
    saveDeletionReceipt: jest.fn(async (receipt) => {
      if (receipt.phase === "completed" && failCompletedSave) {
        failCompletedSave = false;
        throw new Error("Keychain unavailable");
      }
      storedReceipt = receipt;
    }),
    signInWithProvider: jest.fn(async () => ({
      idToken: "google-provider-token",
      provider: "google" as const,
      revocation: {
        idToken: "google-provider-token",
        kind: "access_token" as const,
        value: "google-access",
      },
    })),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);
  await coordinator.signIn("google");

  await expect(coordinator.deleteUser()).resolves.toEqual({
    kind: "deletion-status-retry",
    reason: "unavailable",
  });
  expect(storedReceipt).toEqual(submittingDeletionReceipt);

  const relaunched = new NativeAuthCoordinator(dependencies);
  await expect(relaunched.restore()).resolves.toEqual({
    kind: "deletion-completed",
  });
  expect(dependencies.getDeletionStatus).toHaveBeenCalledWith(
    deletionStatusToken,
  );
  expect(storedReceipt).toEqual(completedDeletionReceipt);
  expect(dependencies.clearDeletionReceipt).not.toHaveBeenCalled();
});

test("acknowledgement alone clears a completed receipt and retries clear failure", async () => {
  const clearDeletionReceipt = jest
    .fn()
    .mockRejectedValueOnce(new Error("Keychain unavailable"))
    .mockResolvedValueOnce(undefined);
  const dependencies = createDependencies({
    clearDeletionReceipt,
    loadDeletionReceipt: jest.fn(async () => completedDeletionReceipt),
  });
  const coordinator = new NativeAuthCoordinator(dependencies);

  await expect(coordinator.restore()).resolves.toEqual({
    kind: "deletion-completed",
  });
  expect(dependencies.getDeletionStatus).not.toHaveBeenCalled();
  expect(clearDeletionReceipt).not.toHaveBeenCalled();

  await expect(
    coordinator.acknowledgeDeletionCompletion(),
  ).resolves.toEqual({
    kind: "deletion-clear-retry",
    status: "completed",
  });
  await expect(
    coordinator.acknowledgeDeletionCompletion(),
  ).resolves.toEqual({
    kind: "signed-out",
    reason: "deleted",
  });
  expect(clearDeletionReceipt).toHaveBeenCalledTimes(2);
});
