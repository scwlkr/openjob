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
const user = {
  userId: "usr_one",
  username: "walker",
  usernameRequired: false,
};

function createDependencies(
  overrides: Partial<NativeAuthDependencies> = {},
): NativeAuthDependencies & {
  clearProviderSession: jest.Mock;
  clearStoredSession: jest.Mock;
  createUser: jest.Mock;
  exchangeProviderCredential: jest.Mock;
  getMe: jest.Mock;
  linkSignInMethod: jest.Mock;
  listSignInMethods: jest.Mock;
  loadStoredSession: jest.Mock;
  purgeLocalDomainCache: jest.Mock;
  refreshSession: jest.Mock;
  saveStoredSession: jest.Mock;
  signInWithProvider: jest.Mock;
} {
  return {
    clearCleanupPending: jest.fn(async () => undefined),
    clearProviderSession: jest.fn(async () => undefined),
    clearStoredSession: jest.fn(async () => undefined),
    createUser: jest.fn(async () => user),
    exchangeProviderCredential: jest.fn(async (credential) =>
      credential.provider === "google" ? googleSession : appleSession,
    ),
    getMe: jest.fn(async () => user),
    linkSignInMethod: jest.fn(async () => user),
    listSignInMethods: jest.fn(async () => ["google" as const]),
    loadCleanupPending: jest.fn(async () => false),
    loadStoredSession: jest.fn(async () => null),
    markCleanupPending: jest.fn(async () => undefined),
    now: () => 1_000,
    purgeLocalDomainCache: jest.fn(async () => undefined),
    refreshSession: jest.fn(async () => googleSession),
    saveStoredSession: jest.fn(async () => undefined),
    signInWithProvider: jest.fn(async (provider) => ({
      idToken: `${provider}-provider-token`,
      provider,
    })),
    ...overrides,
  } as unknown as NativeAuthDependencies & {
    clearProviderSession: jest.Mock;
    clearStoredSession: jest.Mock;
    createUser: jest.Mock;
    exchangeProviderCredential: jest.Mock;
    getMe: jest.Mock;
    linkSignInMethod: jest.Mock;
    listSignInMethods: jest.Mock;
    loadStoredSession: jest.Mock;
    purgeLocalDomainCache: jest.Mock;
    refreshSession: jest.Mock;
    saveStoredSession: jest.Mock;
    signInWithProvider: jest.Mock;
  };
}

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
    provider: "google",
    refreshToken: "google-refresh-token",
    version: 1,
  });
  expect(JSON.stringify(dependencies.saveStoredSession.mock.calls)).not.toContain(
    "google-id-token",
  );
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
    provider: "google",
    refreshToken: "google-refresh-token",
    version: 1,
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
