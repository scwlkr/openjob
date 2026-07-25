import {
  createSqlCipherTaskListCache,
  purgeLocalDomainCache,
  registerLocalDomainPurgeBoundary,
  type LocalTaskListCacheEntry,
} from "../src/domain-cache";

type FakeDatabaseState = {
  payload: string | null;
};

function cacheEntry(
  ownerUserId = "user_one",
  groupId = "grp_one",
): LocalTaskListCacheEntry {
  return {
    ownerUserId,
    group: {
      groupId,
      name: "QA Group",
      role: "admin",
      createdAt: "2026-07-25T12:00:00.000Z",
    },
    snapshot: {
      members: [
        {
          userId: ownerUserId,
          username: "owner",
          role: "admin",
          joinedAt: "2026-07-25T12:00:00.000Z",
        },
      ],
      tasks: [
        {
          taskId: "task_one",
          groupId,
          text: "Verify encrypted launch",
          assignee: {
            state: "assigned",
            userId: ownerUserId,
            username: "owner",
          },
          priority: "high",
          dueDate: "2026-07-26",
          state: "open",
          createdAt: "2026-07-25T12:00:00.000Z",
          completedAt: null,
        },
      ],
    },
    status: "open",
    validator: '"oj-validator-one"',
    freshAt: "2026-07-25T12:05:00.000Z",
  };
}

function createFakeDirectory(initiallyExists = false) {
  let exists = initiallyExists;
  return {
    create: jest.fn(() => {
      exists = true;
    }),
    delete: jest.fn(() => {
      exists = false;
    }),
    get exists() {
      return exists;
    },
    uri: "file:///private/cache/openjob-preview/",
  };
}

function createFakeSecureStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 2,
    deleteItemAsync: jest.fn(async (key: string) => {
      values.delete(key);
    }),
    getItemAsync: jest.fn(async (key: string) => values.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    values,
  };
}

function createFakeSqlite(
  state: FakeDatabaseState = { payload: null },
  { cipherVersion = "4.6.1 community" } = {},
) {
  let pendingPayload: string | null | undefined;
  const sql: string[] = [];
  const boundParameters: unknown[][] = [];
  const closeAsync = jest.fn(async () => undefined);
  const database = {
    closeAsync,
    execAsync: jest.fn(async (source: string) => {
      sql.push(source);
      if (source === "BEGIN IMMEDIATE") pendingPayload = undefined;
      if (source === "COMMIT" && pendingPayload !== undefined) {
        state.payload = pendingPayload;
        pendingPayload = undefined;
      }
      if (source === "ROLLBACK") pendingPayload = undefined;
    }),
    async getFirstAsync<Row>(source: string): Promise<Row | null> {
      sql.push(source);
      return (source === "PRAGMA cipher_version"
        ? { cipher_version: cipherVersion }
        : null) as Row | null;
    },
    prepareAsync: jest.fn(async (source: string) => {
      sql.push(source);
      const finalizeAsync = jest.fn(async () => undefined);
      return {
        async executeAsync<Row>(parameters: unknown[]) {
          boundParameters.push(parameters);
          if (source.startsWith("SELECT payload")) {
            return {
              async getFirstAsync() {
                return (state.payload === null
                  ? null
                  : { payload: state.payload }) as Row | null;
              },
            };
          }
          if (source.startsWith("INSERT INTO task_list_cache")) {
            pendingPayload = parameters[1] as string;
          }
          return { async getFirstAsync() { return null; } };
        },
        finalizeAsync,
      };
    }),
  };
  const openDatabaseAsync = jest.fn(async () => database);
  return {
    boundParameters,
    closeAsync,
    database,
    openDatabaseAsync,
    sql,
    sqlite: { openDatabaseAsync },
    state,
  };
}

function createHarness({
  cipherVersion,
  directoryExists = false,
  payload = null,
  secureValues = {},
}: {
  cipherVersion?: string;
  directoryExists?: boolean;
  payload?: string | null;
  secureValues?: Record<string, string>;
} = {}) {
  const directory = createFakeDirectory(directoryExists);
  const secureStore = createFakeSecureStore(secureValues);
  const sqlite = createFakeSqlite(
    { payload },
    cipherVersion === undefined ? {} : { cipherVersion },
  );
  const randomBytes = jest.fn(() =>
    Uint8Array.from({ length: 32 }, (_, index) => index),
  );
  const cache = createSqlCipherTaskListCache(
    {
      databaseName: "openjob-preview.db",
      keyStorageKey: "openjob.native.cache.preview.v1",
      keychainService: "dev.openjob.app.preview.cache",
    },
    {
      directory,
      randomBytes,
      secureStore,
      sqlite: sqlite.sqlite,
    },
  );
  return { cache, directory, randomBytes, secureStore, ...sqlite };
}

test("round-trips one encrypted Task List cache entry through bound storage", async () => {
  const harness = createHarness();
  const entry = cacheEntry();

  await harness.cache.save(entry);
  await expect(harness.cache.load(entry.ownerUserId)).resolves.toEqual(entry);

  expect(harness.openDatabaseAsync).toHaveBeenCalledWith(
    "openjob-preview.db",
    { useNewConnection: true },
    harness.directory.uri,
  );
  expect(harness.sql[0]).toMatch(/^PRAGMA key = "x'[0-9a-f]{64}'"$/u);
  expect(harness.sql.slice(1, 3)).toEqual([
    "PRAGMA cipher_version",
    "PRAGMA temp_store = MEMORY",
  ]);
  expect(harness.sql).not.toContain(entry.snapshot.tasks[0]?.text);
  expect(harness.boundParameters).toContainEqual([1, JSON.stringify(entry)]);
  expect(harness.boundParameters).toContainEqual([1]);
});

test("purges cache and key instead of painting another User's entry", async () => {
  const harness = createHarness();
  await harness.cache.save(cacheEntry("user_one"));

  await expect(harness.cache.load("user_two")).resolves.toBeNull();

  expect(harness.closeAsync).toHaveBeenCalledTimes(1);
  expect(harness.directory.delete).toHaveBeenCalledTimes(1);
  expect(harness.secureStore.deleteItemAsync).toHaveBeenCalledWith(
    "openjob.native.cache.preview.v1",
    { keychainService: "dev.openjob.app.preview.cache" },
  );
});

test.each([
  ["invalid JSON", "{not-json"],
  [
    "a Task from another Group",
    JSON.stringify({
      ...cacheEntry(),
      snapshot: {
        ...cacheEntry().snapshot,
        tasks: [{ ...cacheEntry().snapshot.tasks[0], groupId: "grp_other" }],
      },
    }),
  ],
])("purges %s instead of returning corrupt domain state", async (_label, payload) => {
  const key = "ab".repeat(32);
  const harness = createHarness({
    directoryExists: true,
    payload,
    secureValues: { "openjob.native.cache.preview.v1": key },
  });

  await expect(harness.cache.load("user_one")).resolves.toBeNull();

  expect(harness.closeAsync).toHaveBeenCalledTimes(1);
  expect(harness.directory.delete).toHaveBeenCalledTimes(1);
  expect(harness.secureStore.deleteItemAsync).toHaveBeenCalledTimes(1);
});

test("deletes an orphan database directory when its key is absent", async () => {
  const harness = createHarness({ directoryExists: true });

  await expect(harness.cache.load("user_one")).resolves.toBeNull();

  expect(harness.openDatabaseAsync).not.toHaveBeenCalled();
  expect(harness.directory.delete).toHaveBeenCalledTimes(1);
});

test("creates exactly 32 random key bytes with device-only SecureStore options", async () => {
  const harness = createHarness();

  await harness.cache.save(cacheEntry());

  expect(harness.randomBytes).toHaveBeenCalledWith(32);
  expect(harness.secureStore.setItemAsync).toHaveBeenCalledWith(
    "openjob.native.cache.preview.v1",
    "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    {
      keychainAccessible:
        harness.secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      keychainService: "dev.openjob.app.preview.cache",
    },
  );
});

test("atomically replaces the singleton row when a different owner saves", async () => {
  const harness = createHarness();
  await harness.cache.save(cacheEntry("user_one", "grp_one"));
  const replacement = cacheEntry("user_two", "grp_two");

  await harness.cache.save(replacement);

  await expect(harness.cache.load("user_two")).resolves.toEqual(replacement);
  expect(harness.sql.filter((source) => source === "BEGIN IMMEDIATE")).toHaveLength(2);
  expect(harness.sql.filter((source) => source === "COMMIT")).toHaveLength(2);
  expect(JSON.parse(harness.state.payload ?? "null").ownerUserId).toBe("user_two");
});

test("serializes purge behind an in-flight cache save", async () => {
  const harness = createHarness();
  let finishOpen: (() => void) | undefined;
  let signalOpen: (() => void) | undefined;
  const opening = new Promise<void>((resolve) => {
    signalOpen = resolve;
  });
  harness.openDatabaseAsync.mockImplementationOnce(
    () => {
      signalOpen?.();
      return new Promise((resolve) => {
        finishOpen = () => resolve(harness.database);
      });
    },
  );

  const saving = harness.cache.save(cacheEntry());
  await opening;
  const keyDeletesBeforePurge =
    harness.secureStore.deleteItemAsync.mock.calls.length;
  const purging = harness.cache.purge();
  await Promise.resolve();

  expect(harness.directory.delete).not.toHaveBeenCalled();
  expect(finishOpen).toBeDefined();
  finishOpen?.();
  await saving;
  await purging;

  expect(harness.directory.delete).toHaveBeenCalledTimes(1);
  expect(harness.secureStore.deleteItemAsync).toHaveBeenCalledTimes(
    keyDeletesBeforePurge + 1,
  );
});

test("rejects a non-SQLCipher database and purges it", async () => {
  const key = "cd".repeat(32);
  const harness = createHarness({
    cipherVersion: "",
    directoryExists: true,
    secureValues: { "openjob.native.cache.preview.v1": key },
  });

  await expect(harness.cache.load("user_one")).resolves.toBeNull();

  expect(harness.closeAsync).toHaveBeenCalledTimes(1);
  expect(harness.directory.delete).toHaveBeenCalledTimes(1);
  expect(harness.secureStore.deleteItemAsync).toHaveBeenCalledTimes(1);
});

test("purge attempts close, directory deletion, and key deletion before rejecting", async () => {
  const harness = createHarness();
  await harness.cache.save(cacheEntry());
  harness.closeAsync.mockClear();
  harness.directory.delete.mockClear();
  harness.secureStore.deleteItemAsync.mockClear();
  harness.closeAsync.mockRejectedValueOnce(new Error("close failed"));
  harness.directory.delete.mockImplementationOnce(() => {
    throw new Error("directory delete failed");
  });
  harness.secureStore.deleteItemAsync.mockRejectedValueOnce(
    new Error("key delete failed"),
  );

  await expect(harness.cache.purge()).rejects.toThrow();

  expect(harness.closeAsync).toHaveBeenCalledTimes(1);
  expect(harness.directory.delete).toHaveBeenCalledTimes(1);
  expect(harness.secureStore.deleteItemAsync).toHaveBeenCalledTimes(1);
});

test("invokes the replaceable #39 purge boundary", async () => {
  const purge = jest.fn(async () => undefined);
  const unregister = registerLocalDomainPurgeBoundary(purge);

  await purgeLocalDomainCache();
  expect(purge).toHaveBeenCalledTimes(1);

  unregister();
  await expect(purgeLocalDomainCache()).resolves.toBeUndefined();
  expect(purge).toHaveBeenCalledTimes(1);
});
