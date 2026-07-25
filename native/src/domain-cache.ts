import * as Crypto from "expo-crypto";
import { Directory, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";
import type {
  NativeGroup,
  NativeMember,
  NativeTask,
  NativeTaskListSnapshot,
} from "./task-list-contracts";

export type LocalTaskListCacheEntry = {
  ownerUserId: string;
  group: NativeGroup;
  snapshot: NativeTaskListSnapshot;
  status: "open" | "done" | "all";
  validator: string;
  freshAt: string;
};

export type SqlCipherTaskListCacheConfig = {
  databaseName: string;
  keyStorageKey: string;
  keychainService: string;
};

type CacheDirectory = {
  readonly uri: string;
  readonly exists: boolean;
  create(options: { idempotent: boolean; intermediates: boolean }): void;
  delete(): void;
};

type SqlCipherResult<Row> = {
  getFirstAsync(): Promise<Row | null>;
};

type SqlCipherStatement = {
  executeAsync<Row>(parameters: unknown[]): Promise<SqlCipherResult<Row>>;
  finalizeAsync(): Promise<void>;
};

type SqlCipherDatabase = {
  closeAsync(): Promise<void>;
  execAsync(source: string): Promise<void>;
  getFirstAsync<Row>(source: string): Promise<Row | null>;
  prepareAsync(source: string): Promise<SqlCipherStatement>;
};

type SqliteDependency = {
  openDatabaseAsync(
    databaseName: string,
    options: { useNewConnection: true },
    directory: string,
  ): Promise<SqlCipherDatabase>;
};

type SecureStoreOptions = {
  keychainAccessible?: number;
  keychainService: string;
};

type SecureStoreDependency = {
  readonly WHEN_UNLOCKED_THIS_DEVICE_ONLY: number;
  deleteItemAsync(key: string, options: SecureStoreOptions): Promise<void>;
  getItemAsync(key: string, options: SecureStoreOptions): Promise<string | null>;
  setItemAsync(
    key: string,
    value: string,
    options: SecureStoreOptions,
  ): Promise<void>;
};

export type SqlCipherTaskListCacheDependencies = {
  directory?: CacheDirectory;
  randomBytes?: (length: number) => Promise<Uint8Array> | Uint8Array;
  secureStore?: SecureStoreDependency;
  sqlite?: SqliteDependency;
};

const productionSqlite: SqliteDependency = {
  async openDatabaseAsync(databaseName, options, directory) {
    return (await SQLite.openDatabaseAsync(
      databaseName,
      options,
      directory,
    )) as unknown as SqlCipherDatabase;
  },
};

const DATABASE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const SECURE_STORE_KEY = /^[\w.-]+$/u;
const ENCRYPTION_KEY = /^[0-9a-f]{64}$/u;
const RFC3339 =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const SELECT_CACHE = "SELECT payload FROM task_list_cache WHERE singleton = ?";
const UPSERT_CACHE = `INSERT INTO task_list_cache (singleton, payload)
VALUES (?, ?)
ON CONFLICT(singleton) DO UPDATE SET payload = excluded.payload`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, expected: string[]) {
  const keys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  return keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index]);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRfc3339(value: unknown): value is string {
  return typeof value === "string" &&
    RFC3339.test(value) &&
    Number.isFinite(Date.parse(value));
}

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value;
}

function isGroup(value: unknown): value is NativeGroup {
  if (!isRecord(value)) return false;
  return hasOnlyKeys(value, ["createdAt", "groupId", "name", "role"]) &&
    isNonEmptyString(value.groupId) &&
    isNonEmptyString(value.name) &&
    (value.role === "admin" || value.role === "member") &&
    isRfc3339(value.createdAt);
}

function isMember(value: unknown): value is NativeMember {
  if (!isRecord(value)) return false;
  return hasOnlyKeys(value, ["joinedAt", "role", "userId", "username"]) &&
    isNonEmptyString(value.userId) &&
    (value.username === null || isNonEmptyString(value.username)) &&
    (value.role === "admin" || value.role === "member") &&
    isRfc3339(value.joinedAt);
}

function isAssignee(value: unknown): value is NativeTask["assignee"] {
  if (!isRecord(value)) return false;
  if (value.state === "unassigned") {
    return hasOnlyKeys(value, ["state"]);
  }
  return value.state === "assigned" &&
    hasOnlyKeys(value, ["state", "userId", "username"]) &&
    isNonEmptyString(value.userId) &&
    isNonEmptyString(value.username);
}

function isTask(value: unknown, groupId: string): value is NativeTask {
  if (!isRecord(value)) return false;
  return hasOnlyKeys(value, [
    "assignee",
    "completedAt",
    "createdAt",
    "dueDate",
    "groupId",
    "priority",
    "state",
    "taskId",
    "text",
  ]) &&
    isNonEmptyString(value.taskId) &&
    value.groupId === groupId &&
    isNonEmptyString(value.text) &&
    isAssignee(value.assignee) &&
    (value.priority === "high" ||
      value.priority === "normal" ||
      value.priority === "low") &&
    (value.dueDate === null || isDate(value.dueDate)) &&
    (value.state === "open" || value.state === "done") &&
    isRfc3339(value.createdAt) &&
    ((value.state === "open" && value.completedAt === null) ||
      (value.state === "done" && isRfc3339(value.completedAt)));
}

function isSnapshot(
  value: unknown,
  groupId: string,
): value is NativeTaskListSnapshot {
  if (!isRecord(value)) return false;
  return hasOnlyKeys(value, ["members", "tasks"]) &&
    Array.isArray(value.members) &&
    value.members.every(isMember) &&
    Array.isArray(value.tasks) &&
    value.tasks.every((task) => isTask(task, groupId));
}

function isCacheEntry(value: unknown): value is LocalTaskListCacheEntry {
  if (!isRecord(value)) return false;
  if (!hasOnlyKeys(value, [
    "freshAt",
    "group",
    "ownerUserId",
    "snapshot",
    "status",
    "validator",
  ])) {
    return false;
  }
  return isNonEmptyString(value.ownerUserId) &&
    isGroup(value.group) &&
    isSnapshot(value.snapshot, value.group.groupId) &&
    (value.status === "open" || value.status === "done" || value.status === "all") &&
    isNonEmptyString(value.validator) &&
    isRfc3339(value.freshAt);
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function aggregateFailures(results: PromiseSettledResult<unknown>[], message: string) {
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length > 0) throw new AggregateError(failures, message);
}

export function createSqlCipherTaskListCache(
  config: SqlCipherTaskListCacheConfig,
  dependencies: SqlCipherTaskListCacheDependencies = {},
) {
  if (!DATABASE_NAME.test(config.databaseName) ||
    config.databaseName === "." ||
    config.databaseName === "..") {
    throw new TypeError("Use a simple environment-specific cache database name.");
  }
  if (!SECURE_STORE_KEY.test(config.keyStorageKey)) {
    throw new TypeError("Use a valid environment-specific SecureStore key.");
  }
  if (!isNonEmptyString(config.keychainService)) {
    throw new TypeError("Provide an environment-specific Keychain service.");
  }

  const directory = dependencies.directory ??
    new Directory(Paths.cache, `${config.databaseName}.cache`);
  const randomBytes = dependencies.randomBytes ?? Crypto.getRandomBytes;
  const secureStore = dependencies.secureStore ?? SecureStore;
  const sqlite = dependencies.sqlite ?? productionSqlite;
  const sharedKeyOptions = { keychainService: config.keychainService };
  const protectedKeyOptions = {
    ...sharedKeyOptions,
    keychainAccessible: secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  };
  let database: SqlCipherDatabase | null = null;
  let opening: Promise<SqlCipherDatabase> | null = null;
  let operationTail = Promise.resolve();

  async function serialized<T>(operation: () => Promise<T>): Promise<T> {
    const previous = operationTail;
    let release: () => void = () => undefined;
    operationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async function purge() {
    const pendingOpen = opening;
    if (pendingOpen) await pendingOpen.catch(() => undefined);
    const openDatabase = database;
    database = null;
    opening = null;
    const closeResults = await Promise.allSettled([
      openDatabase?.closeAsync() ?? Promise.resolve(),
    ]);
    const deletionResults = await Promise.allSettled([
      Promise.resolve().then(() => {
        if (directory.exists) directory.delete();
      }),
      secureStore.deleteItemAsync(config.keyStorageKey, sharedKeyOptions),
    ]);
    aggregateFailures(
      [...closeResults, ...deletionResults],
      "Could not fully purge the local Task List cache.",
    );
  }

  async function openDatabase(key: string) {
    if (database) return database;
    if (!opening) {
      opening = (async () => {
        if (!directory.exists) {
          directory.create({ idempotent: true, intermediates: true });
        }
        const opened = await sqlite.openDatabaseAsync(
          config.databaseName,
          { useNewConnection: true },
          directory.uri,
        );
        database = opened;
        await opened.execAsync(`PRAGMA key = "x'${key}'"`);
        const cipher = await opened.getFirstAsync<{ cipher_version: unknown }>(
          "PRAGMA cipher_version",
        );
        if (!isNonEmptyString(cipher?.cipher_version)) {
          throw new Error("SQLCipher is unavailable for the local Task List cache.");
        }
        await opened.execAsync("PRAGMA temp_store = MEMORY");
        await opened.execAsync(`CREATE TABLE IF NOT EXISTS task_list_cache (
          singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
          payload TEXT NOT NULL
        ) WITHOUT ROWID`);
        return opened;
      })();
    }
    try {
      return await opening;
    } finally {
      opening = null;
    }
  }

  async function readStoredKey() {
    return secureStore.getItemAsync(config.keyStorageKey, sharedKeyOptions);
  }

  async function createKey() {
    const bytes = await randomBytes(32);
    if (!(bytes instanceof Uint8Array) || bytes.length !== 32) {
      throw new Error("Secure random key generation failed.");
    }
    const key = bytesToHex(bytes);
    await secureStore.setItemAsync(
      config.keyStorageKey,
      key,
      protectedKeyOptions,
    );
    return key;
  }

  async function keyForSave() {
    const stored = await readStoredKey();
    if (
      stored !== null &&
      ENCRYPTION_KEY.test(stored) &&
      directory.exists
    ) {
      return stored;
    }
    if (stored !== null || directory.exists) await purge();
    return createKey();
  }

  async function readPayload(opened: SqlCipherDatabase) {
    const statement = await opened.prepareAsync(SELECT_CACHE);
    try {
      const result = await statement.executeAsync<{ payload: unknown }>([1]);
      return await result.getFirstAsync();
    } finally {
      await statement.finalizeAsync();
    }
  }

  async function writePayload(opened: SqlCipherDatabase, payload: string) {
    await opened.execAsync("BEGIN IMMEDIATE");
    try {
      const statement = await opened.prepareAsync(UPSERT_CACHE);
      try {
        await statement.executeAsync([1, payload]);
      } finally {
        await statement.finalizeAsync();
      }
      await opened.execAsync("COMMIT");
    } catch (error) {
      const rollback = await Promise.allSettled([
        opened.execAsync("ROLLBACK"),
      ]);
      aggregateFailures(rollback, "Could not roll back the local Task List cache write.");
      throw error;
    }
  }

  return Object.freeze({
    async load(ownerUserId: string): Promise<LocalTaskListCacheEntry | null> {
      return serialized(async () => {
        if (!isNonEmptyString(ownerUserId)) {
          throw new TypeError(
            "Provide the authenticated User ID when loading cache.",
          );
        }
        let key: string | null;
        try {
          key = await readStoredKey();
        } catch {
          await purge();
          return null;
        }
        if (
          key === null ||
          !ENCRYPTION_KEY.test(key) ||
          !directory.exists
        ) {
          await purge();
          return null;
        }

        let parsed: unknown;
        try {
          const opened = await openDatabase(key);
          const row = await readPayload(opened);
          if (row === null) return null;
          if (typeof row.payload !== "string") {
            throw new Error("Invalid cache row.");
          }
          parsed = JSON.parse(row.payload) as unknown;
        } catch {
          await purge();
          return null;
        }
        if (!isCacheEntry(parsed) || parsed.ownerUserId !== ownerUserId) {
          await purge();
          return null;
        }
        return parsed;
      });
    },

    async purge() {
      await serialized(purge);
    },

    async save(entry: LocalTaskListCacheEntry) {
      await serialized(async () => {
        if (!isCacheEntry(entry)) {
          throw new TypeError(
            "Refuse to cache invalid Task List domain state.",
          );
        }
        const payload = JSON.stringify(entry);
        try {
          const key = await keyForSave();
          const opened = await openDatabase(key);
          await writePayload(opened, payload);
        } catch (error) {
          const cleanup = await Promise.allSettled([purge()]);
          aggregateFailures(
            cleanup,
            "Could not recover from a cache write failure.",
          );
          throw error;
        }
      });
    },
  });
}

export type LocalDomainPurgeBoundary = () => Promise<void>;

const noDomainCacheYet: LocalDomainPurgeBoundary = async () => undefined;
let purgeBoundary = noDomainCacheYet;

export function registerLocalDomainPurgeBoundary(
  implementation: LocalDomainPurgeBoundary,
) {
  purgeBoundary = implementation;
  return () => {
    if (purgeBoundary === implementation) purgeBoundary = noDomainCacheYet;
  };
}

export function purgeLocalDomainCache() {
  return purgeBoundary();
}
