import { createSqlCipherOfflineWorkspaceCache } from '../src/offline-workspace-cache';
import type { NativeOfflineWorkspaceRecord } from '../src/offline-workspace-contracts';
const owner = 'user_alex';
const config = { databaseName: 'personal-offline.db', keyStorageKey: 'personal.key', keychainService: 'personal.cache' };
function record(): NativeOfflineWorkspaceRecord {
  const projection = { tasks: [{ id: 'existing', ownerId: owner, title: 'Prior pending work', completed: false }], calendars: [{ id: 'personal', ownerId: owner, name: 'Personal', color: '#2454dc' }], events: [] };
  return { ownerUserId: owner, revision: `tc1_${'a'.repeat(64)}`, projection, pending: { operationId: '00000000-0000-4000-8000-000000000001', baseRevision: `tc1_${'a'.repeat(64)}`, expiresAt: '2026-10-18T00:00:00.000Z', projection, attempted: false } };
}
function fixture() {
  let exists = false, payload: string | null = null, staged: string | null = null, failRead = false, failCommit = false;
  const values = new Map<string, string>(); const sql: string[] = [];
  const directory = { uri: 'file:///document/personal-offline/', get exists() { return exists; }, create: jest.fn(() => { exists = true; }), delete: jest.fn(() => { exists = false; payload = null; }) };
  const secure = { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 2, getItemAsync: jest.fn(async (key: string) => { if (failRead) throw new Error('Private keychain unavailable'); return values.get(key) ?? null; }), setItemAsync: jest.fn(async (key: string, value: string) => { values.set(key, value); }), deleteItemAsync: jest.fn(async (key: string) => { values.delete(key); }) };
  const database = {
    closeAsync: jest.fn(async () => undefined),
    execAsync: jest.fn(async (statement: string) => { sql.push(statement); if (statement === 'BEGIN IMMEDIATE') staged = null; if (statement === 'ROLLBACK') staged = null; if (statement === 'COMMIT') { if (failCommit) throw new Error('Commit unavailable.'); if (staged !== null) payload = staged; staged = null; } }),
    async getFirstAsync<Row>() { return { cipher_version: '4.6' } as Row; },
    async prepareAsync(statement: string) { return { async executeAsync<Row>(parameters: unknown[]) { if (statement.startsWith('INSERT')) staged = parameters[1] as string; return { async getFirstAsync() { return (payload === null ? null : { payload }) as Row | null; } }; }, async finalizeAsync() {} }; },
  };
  const dependencies = { directory, secureStore: secure, randomBytes: () => new Uint8Array(32).fill(7), sqlite: { openDatabaseAsync: jest.fn(async () => database) } };
  return { create: () => createSqlCipherOfflineWorkspaceCache(config, dependencies), directory, secure, values, database, sql, payload: () => payload, failRead(value: boolean) { failRead = value; }, failCommit(value: boolean) { failCommit = value; } };
}
test('separate encrypted durable cache restarts with pending work and device-only key protection', async () => {
  const f = fixture(); await f.create().save(record()); expect(await f.create().load(owner)).toEqual(record());
  expect(f.secure.setItemAsync).toHaveBeenCalledWith(config.keyStorageKey, expect.stringMatching(/^[a-f0-9]{64}$/), { keychainService: config.keychainService, keychainAccessible: 2 });
  expect(f.sql[0]).toMatch(/^PRAGMA key/); expect(f.sql).toContain('BEGIN IMMEDIATE'); expect(f.sql).toContain('COMMIT');
  expect(f.payload()).not.toMatch(/sourceMessageId|sourceAccountId|mail:|accessToken|refreshToken|tokenHash/);
});
test('transient Keychain reads and transaction failures never erase prior durable pending work or key', async () => {
  const f = fixture(); const cache = f.create(); await cache.save(record()); const previous = f.payload(), key = f.values.get(config.keyStorageKey);
  f.failRead(true); await expect(cache.load(owner)).rejects.toThrow('storage'); await expect(cache.save(record())).rejects.toThrow('storage');
  expect(f.payload()).toBe(previous); expect(f.values.get(config.keyStorageKey)).toBe(key); expect(f.directory.delete).not.toHaveBeenCalled();
  f.failRead(false); f.failCommit(true); const next = record(); next.pending!.projection.tasks[0]!.title = 'Uncommitted replacement';
  await expect(cache.save(next)).rejects.toThrow('storage'); expect(f.payload()).toBe(previous); expect(f.sql).toContain('ROLLBACK'); expect(f.values.get(config.keyStorageKey)).toBe(key); expect(f.directory.delete).not.toHaveBeenCalled();
  f.failCommit(false); expect(await cache.load(owner)).toEqual(record());
});
test('missing keys, foreign owners and forbidden private fields fail closed without silently destroying the database', async () => {
  const f = fixture(); const cache = f.create(); await cache.save(record()); const previous = f.payload(), key = f.values.get(config.keyStorageKey)!;
  f.values.delete(config.keyStorageKey); await expect(cache.load(owner)).rejects.toThrow('storage'); expect(f.payload()).toBe(previous); expect(f.directory.delete).not.toHaveBeenCalled();
  f.values.set(config.keyStorageKey, key); await expect(cache.load('user_sam')).rejects.toThrow('storage'); expect(f.payload()).toBe(previous);
  const bad = record(); Object.assign(bad.pending!.projection.tasks[0]!, { sourceMessageId: 'private_mail' }); await expect(cache.save(bad)).rejects.toThrow(); expect(f.payload()).toBe(previous);
});
test('explicit purge fences delayed old-owner writes and clears database and key together', async () => {
  const f = fixture(); const cache = f.create(); await cache.save(record());
  let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; }); let began!: () => void; const started = new Promise<void>(resolve => { began = resolve; });
  f.secure.getItemAsync.mockImplementationOnce(async () => { began(); await waiting; return f.values.get(config.keyStorageKey) ?? null; });
  const writing = cache.save(record()); await started; const purging = cache.purge(); release();
  await expect(writing).rejects.toThrow('superseded'); await purging;
  expect(f.payload()).toBeNull(); expect(f.directory.exists).toBe(false); expect(f.values.size).toBe(0); expect(await cache.load(owner)).toBeNull();
});
