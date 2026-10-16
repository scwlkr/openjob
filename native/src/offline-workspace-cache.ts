import * as Crypto from 'expo-crypto';
import { Directory, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import type { SqlCipherTaskListCacheConfig, SqlCipherTaskListCacheDependencies } from './domain-cache';
import type { NativeOfflineWorkspaceCache } from './offline-workspace-contracts';
import { validateOfflineWorkspaceRecord } from './offline-workspace-record';
export { validateOfflineWorkspaceRecord } from './offline-workspace-record';

/** Separate durable SQLCipher database and device-only Keychain key; never caches Mail or credentials. */
export function createSqlCipherOfflineWorkspaceCache(config: SqlCipherTaskListCacheConfig, dependencies: SqlCipherTaskListCacheDependencies = {}): NativeOfflineWorkspaceCache {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(config.databaseName) || config.databaseName === '.' || config.databaseName === '..' || !/^[\w.-]+$/.test(config.keyStorageKey) || !config.keychainService) throw new Error('Invalid offline cache configuration.');
  const directory = dependencies.directory ?? new Directory(Paths.document, `${config.databaseName}.personal`);
  const secure = dependencies.secureStore ?? SecureStore;
  const sqlite = dependencies.sqlite ?? SQLite;
  const random = dependencies.randomBytes ?? Crypto.getRandomBytes;
  const options = { keychainService: config.keychainService };
  type Database = Awaited<ReturnType<NonNullable<SqlCipherTaskListCacheDependencies['sqlite']>['openDatabaseAsync']>>;
  let database: Database | null = null;
  let generation = 0, tail = Promise.resolve();
  async function serial<T>(action: () => Promise<T>): Promise<T> {
    const previous = tail; let release!: () => void; tail = new Promise<void>(resolve => { release = resolve; }); await previous;
    try { return await action(); } finally { release(); }
  }
  async function erase() {
    const old = database; database = null;
    const closed = await Promise.allSettled([old?.closeAsync()]);
    const results = [...closed, ...await Promise.allSettled([Promise.resolve().then(() => { if (directory.exists) directory.delete(); }), secure.deleteItemAsync(config.keyStorageKey, options)])];
    if (results.some(result => result.status === 'rejected')) throw new Error('Could not purge the offline workspace cache.');
  }
  function lease(expected: number, guard: () => void) { guard(); if (expected !== generation) throw new Error('Offline cache operation superseded.'); }
  return {
    async purge() { generation++; await serial(erase); },
    async load(owner, guard = () => undefined) {
      const epoch = generation;
      return serial(async () => {
        const check = () => lease(epoch, guard);
        const checked = async <T,>(operation: () => Promise<T>) => { check(); const value = await operation(); check(); return value; };
        check();
        try {
          const key = await checked(() => secure.getItemAsync(config.keyStorageKey, options));
          if (key === null && !directory.exists) return null;
          if (!key || !/^[a-f0-9]{64}$/.test(key) || !directory.exists) throw new Error('Offline key or database unavailable.');
          if (!database) {
            database = await checked(async () => { const opened = await sqlite.openDatabaseAsync(config.databaseName, { useNewConnection: true }, directory.uri) as Database; database = opened; return opened; });
            await checked(() => database!.execAsync(`PRAGMA key = "x'${key}'"`));
            const cipher = await checked(() => database!.getFirstAsync<{ cipher_version: unknown }>('PRAGMA cipher_version'));
            if (typeof cipher?.cipher_version !== 'string' || !cipher.cipher_version) throw new Error('SQLCipher unavailable.');
            await checked(() => database!.execAsync('PRAGMA temp_store = MEMORY'));
            await checked(() => database!.execAsync('CREATE TABLE IF NOT EXISTS personal_offline_cache (singleton INTEGER PRIMARY KEY CHECK(singleton=1),payload TEXT NOT NULL) WITHOUT ROWID'));
          }
          const statement = await checked(() => database!.prepareAsync('SELECT payload FROM personal_offline_cache WHERE singleton = ?'));
          let row;
          try { const result = await checked(() => statement.executeAsync<{ payload: unknown }>([1])); row = await checked(() => result.getFirstAsync()); }
          finally { await statement.finalizeAsync(); check(); }
          if (!row) return null;
          if (typeof row.payload !== 'string' || row.payload.length > 900000) throw new Error('Invalid cache payload.');
          return validateOfflineWorkspaceRecord(JSON.parse(row.payload), owner);
        } catch {
          const failed = database; database = null; await failed?.closeAsync().catch(() => undefined);
          check(); throw new Error('Offline workspace storage is unavailable.');
        }
      });
    },
    async save(value, guard = () => undefined) {
      const record = validateOfflineWorkspaceRecord(value, value.ownerUserId);
      const payload = JSON.stringify(record); if (payload.length > 900000) throw new Error('Offline workspace capacity exceeded.');
      const epoch = generation;
      await serial(async () => {
        const check = () => lease(epoch, guard);
        const checked = async <T,>(operation: () => Promise<T>) => { check(); const value = await operation(); check(); return value; };
        check();
        try {
          let key = await checked(() => secure.getItemAsync(config.keyStorageKey, options));
          if (key === null && !directory.exists) {
            const bytes = await checked(async () => random(32));
            if (!(bytes instanceof Uint8Array) || bytes.length !== 32) throw new Error('Key generation failed.');
            key = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
            await checked(() => secure.setItemAsync(config.keyStorageKey, key!, { ...options, keychainAccessible: secure.WHEN_UNLOCKED_THIS_DEVICE_ONLY }));
            directory.create({ idempotent: true, intermediates: true }); check();
          }
          if (!key || !/^[a-f0-9]{64}$/.test(key) || !directory.exists) throw new Error('Offline key or database unavailable.');
          if (!database) {
            database = await checked(async () => { const opened = await sqlite.openDatabaseAsync(config.databaseName, { useNewConnection: true }, directory.uri) as Database; database = opened; return opened; });
            await checked(() => database!.execAsync(`PRAGMA key = "x'${key}'"`));
            const cipher = await checked(() => database!.getFirstAsync<{ cipher_version: unknown }>('PRAGMA cipher_version'));
            if (typeof cipher?.cipher_version !== 'string' || !cipher.cipher_version) throw new Error('SQLCipher unavailable.');
            await checked(() => database!.execAsync('PRAGMA temp_store = MEMORY'));
            await checked(() => database!.execAsync('CREATE TABLE IF NOT EXISTS personal_offline_cache (singleton INTEGER PRIMARY KEY CHECK(singleton=1),payload TEXT NOT NULL) WITHOUT ROWID'));
          }
          await checked(() => database!.execAsync('BEGIN IMMEDIATE'));
          try {
            const statement = await checked(() => database!.prepareAsync('INSERT INTO personal_offline_cache (singleton,payload) VALUES (?,?) ON CONFLICT(singleton) DO UPDATE SET payload=excluded.payload'));
            try { await checked(() => statement.executeAsync([1, payload])); } finally { await statement.finalizeAsync(); check(); }
            await checked(() => database!.execAsync('COMMIT'));
          } catch (error) { await database!.execAsync('ROLLBACK').catch(() => undefined); throw error; }
        } catch { const failed = database; database = null; await failed?.closeAsync().catch(() => undefined); check(); throw new Error('Offline workspace storage is unavailable.'); }
      });
    },
  };
}
