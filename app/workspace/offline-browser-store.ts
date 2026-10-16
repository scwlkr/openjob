import { createTaskCalendarOfflineController, validateOfflineWorkspaceRecord } from '../../shared/task-calendar-offline.ts';
import type { TaskCalendarOfflineRecord, TaskCalendarOfflineController, TaskCalendarSyncInput, TaskCalendarSyncSnapshot, TaskCalendarSyncAck } from '../../shared/task-calendar-offline.ts';
import { browserOfflineTransaction } from './offline-browser-idb.ts';
export const BROWSER_OFFLINE_PURGED_EVENT = 'openjob:private-workspace-purged';
export const BROWSER_OFFLINE_CHANGED_EVENT = 'openjob:private-workspace-changed';
const MARKER = 'openjob.private-workspace.generation.v1';
const CHANGED = 'openjob.private-workspace.changed.v1';
const LOCK = 'openjob-private-workspace-v1';
export type BrowserAuthoredMailRecovery = { enabled: true; compose?: { to?: string; subject?: string; body?: string }; replies?: Record<string, string> };
export type BrowserOfflineEnvironment = { indexedDB: IDBFactory; locks: { request<T>(name: string, options: { mode: 'exclusive' }, action: () => Promise<T>): Promise<T> }; storage: Pick<Storage, 'getItem' | 'setItem'>; events: Pick<Window, 'addEventListener' | 'dispatchEvent'> };
type Entry = { ownerUserId: string; record?: TaskCalendarOfflineRecord; authored?: BrowserAuthoredMailRecovery };
type Database = { version: 1; generation: string; identities: Record<string, Entry> };
function fail(code = 'storage_unavailable'): never { throw Object.assign(new Error(code === 'revoked' ? 'Saved workspace access ended.' : 'Browser offline storage is unavailable.'), { code }); }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const ownerId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export function browserOfflineIdentityKey(uid: string, tenantId: string | null = null) { const result = JSON.stringify([tenantId, uid]); validateIdentity(result); return result; }
function validateIdentity(key: string) {
  let value: unknown; try { value = JSON.parse(key); } catch { fail(); }
  if (!Array.isArray(value) || value.length !== 2 || value[0] !== null && (typeof value[0] !== 'string' || !value[0].length || value[0].length > 128) || typeof value[1] !== 'string' || !value[1].length || value[1].length > 128 || value.some(item => typeof item === 'string' && /[\u0000-\u001f\u007f]/.test(item)) || JSON.stringify(value) !== key) fail();
}
export function validateBrowserAuthoredMailRecovery(value: unknown): BrowserAuthoredMailRecovery {
  if (!object(value) || value.enabled !== true || Object.keys(value).some(key => !['enabled', 'compose', 'replies'].includes(key)) || JSON.stringify(value).length > 64000) fail();
  if (value.compose !== undefined) {
    if (!object(value.compose) || Object.keys(value.compose).some(key => !['to', 'subject', 'body'].includes(key))) fail();
    for (const [key, item] of Object.entries(value.compose)) if (typeof item !== 'string' || item.length > (key === 'body' ? 20000 : 500)) fail();
  }
  if (value.replies !== undefined && (!object(value.replies) || Object.entries(value.replies).some(([key, item]) => !/^example-message-[1-6]$/.test(key) || typeof item !== 'string' || item.length > 20000))) fail();
  return JSON.parse(JSON.stringify(value)) as BrowserAuthoredMailRecovery;
}
function database(value: unknown, generation: string): Database {
  if (value === undefined) return { version: 1, generation, identities: {} };
  if (!object(value) || Object.keys(value).sort().join(',') !== 'generation,identities,version' || value.version !== 1 || typeof value.generation !== 'string' || !object(value.identities) || Object.keys(value.identities).length > 3 || JSON.stringify(value).length > 1600000) fail();
  if (value.generation !== generation) fail('revoked');
  for (const [identity, entry] of Object.entries(value.identities)) {
    validateIdentity(identity);
    if (!object(entry) || Object.keys(entry).some(key => !['ownerUserId', 'record', 'authored'].includes(key)) || !ownerId(entry.ownerUserId)) fail();
    if (entry.record !== undefined) validateOfflineWorkspaceRecord(entry.record, entry.ownerUserId);
    if (entry.authored !== undefined) validateBrowserAuthoredMailRecovery(entry.authored);
  }
  return value as Database;
}
const bridged = new WeakSet<object>();
function environment(injected?: BrowserOfflineEnvironment): BrowserOfflineEnvironment {
  try {
    const env = injected ?? { indexedDB: globalThis.indexedDB, locks: navigator.locks, storage: localStorage, events: window };
    if (!env.indexedDB || !env.storage || !env.events) fail();
    if (!bridged.has(env.events)) {
      env.events.addEventListener('storage', event => { if ((event as StorageEvent).key === MARKER) env.events.dispatchEvent(new Event(BROWSER_OFFLINE_PURGED_EVENT)); else if ((event as StorageEvent).key === CHANGED) env.events.dispatchEvent(new Event(BROWSER_OFFLINE_CHANGED_EVENT)); });
      bridged.add(env.events);
    }
    return env;
  } catch { return fail(); }
}
export async function clearBrowserOfflineWorkspace(injected?: BrowserOfflineEnvironment): Promise<void> {
  const env = environment(injected);
  // This prefix is deliberately synchronous: old tabs fail guards even while cleanup waits for IDB.
  let generation: string;
  try { generation = crypto.randomUUID(); env.storage.setItem(MARKER, generation); if (env.storage.getItem(MARKER) !== generation) fail(); } catch { fail(); }
  env.events.dispatchEvent(new Event(BROWSER_OFFLINE_PURGED_EVENT));
  await browserOfflineTransaction(env.indexedDB, () => ({ value: { version: 1, generation: env.storage.getItem(MARKER) ?? generation, identities: {} }, result: undefined }), () => {});
}
export type BrowserOfflineWorkspace = { loadBinding(): Promise<string | null>; bindOwner(owner: string): Promise<void>; offline: TaskCalendarOfflineController; clear(): Promise<void>; loadAuthored(): Promise<BrowserAuthoredMailRecovery | null>; saveAuthored(value: BrowserAuthoredMailRecovery): Promise<void>; clearAuthored(): Promise<void> };
export function createBrowserOfflineWorkspace({ identityKey, signal, read, write, environment: injected, now = Date.now, randomUUID = () => crypto.randomUUID() }: { identityKey: string; signal: AbortSignal; read(owner: string): Promise<TaskCalendarSyncSnapshot>; write(owner: string, input: TaskCalendarSyncInput): Promise<TaskCalendarSyncAck>; environment?: BrowserOfflineEnvironment; now?: () => number; randomUUID?: () => string }): BrowserOfflineWorkspace {
  validateIdentity(identityKey); const env = environment(injected); if (!env.locks?.request) fail();
  let generation: string; try { generation = env.storage.getItem(MARKER) ?? '0'; } catch { return fail(); }
  let boundOwner: string | null = null;
  let lastSeen: string | null = null;
  let lastAuthoredSeen = JSON.stringify(null);
  const changed = () => { try { env.storage.setItem(CHANGED, randomUUID()); env.events.dispatchEvent(new Event(BROWSER_OFFLINE_CHANGED_EVENT)); } catch { /* Persistence succeeded; a notification failure does not undo it. */ } };
  const guard = () => { if (signal.aborted) fail('revoked'); let current: string; try { current = env.storage.getItem(MARKER) ?? '0'; } catch { fail(); } if (current !== generation) fail('revoked'); };
  async function transaction<T>(change: (current: Database) => { result: T; save?: boolean }): Promise<T> {
    guard(); return browserOfflineTransaction(env.indexedDB, value => { const current = database(value, generation); const next = change(current); if (next.save && JSON.stringify(current).length > 1600000) fail(); return { result: next.result, ...(next.save ? { value: current } : {}) }; }, guard);
  }
  async function locked<T>(action: () => Promise<T>) { guard(); return env.locks.request(LOCK, { mode: 'exclusive' }, async () => { guard(); const result = await action(); guard(); return result; }); }
  const entry = (current: Database, owner = boundOwner) => { const item = current.identities[identityKey]; if (!owner || item?.ownerUserId !== owner) fail('revoked'); return item; };
  const controller = createTaskCalendarOfflineController({
    cache: {
      load: async owner => transaction(current => ({ result: entry(current, owner).record ?? null })),
      save: async record => { await transaction(current => { entry(current, record.ownerUserId).record = validateOfflineWorkspaceRecord(record, record.ownerUserId); return { result: undefined, save: true }; }); changed(); },
      purge: () => clearBrowserOfflineWorkspace(env),
    },
    capture: owner => { guard(); if (boundOwner !== owner) fail('revoked'); return () => { guard(); if (boundOwner !== owner) fail('revoked'); }; },
    read: async owner => { guard(); const result = await read(owner); guard(); return result; },
    write: async (owner, input) => { guard(); const result = await write(owner, input); guard(); return result; }, randomUUID, now,
  });
  async function delivered(owner: string, action: () => ReturnType<TaskCalendarOfflineController['load']>, checkSeen = false) {
    return locked(async () => {
      const fingerprint = await transaction(current => ({ result: JSON.stringify(entry(current, owner).record ?? null) }));
      if (checkSeen && fingerprint !== lastSeen) {
        const current = await controller.load(owner); lastSeen = fingerprint;
        return { ...current, error: 'changed_in_another_tab' };
      }
      const result = await action();
      lastSeen = await transaction(current => ({ result: JSON.stringify(entry(current, owner).record ?? null) }));
      return result;
    });
  }
  const offline: TaskCalendarOfflineController = {
    load: owner => delivered(owner, () => controller.load(owner)), refresh: owner => delivered(owner, () => controller.refresh(owner)), edit: (owner, input) => delivered(owner, () => controller.edit(owner, input), true), sync: owner => delivered(owner, () => controller.sync(owner)), resolve: (owner, choice) => delivered(owner, () => controller.resolve(owner, choice), true),
  };
  return {
    async loadBinding() { return locked(async () => { const owner = await transaction(current => ({ result: current.identities[identityKey]?.ownerUserId ?? null })); boundOwner = owner; return owner; }); },
    async bindOwner(owner) { if (!ownerId(owner)) fail(); await locked(() => transaction(current => { const prior = current.identities[identityKey]; if (prior && prior.ownerUserId !== owner) fail('revoked'); if (!prior && Object.keys(current.identities).length >= 3) fail(); current.identities[identityKey] = prior ?? { ownerUserId: owner }; return { result: undefined, save: true }; })); boundOwner = owner; },
    offline, clear: () => clearBrowserOfflineWorkspace(env),
    loadAuthored: () => locked(async () => {
      const value = await transaction(current => ({ result: entry(current).authored ? validateBrowserAuthoredMailRecovery(entry(current).authored) : null }));
      lastAuthoredSeen = JSON.stringify(value); return value;
    }),
    saveAuthored: value => {
      const checked = validateBrowserAuthoredMailRecovery(value);
      return locked(async () => {
        await transaction(current => {
          const item = entry(current);
          if (JSON.stringify(item.authored ?? null) !== lastAuthoredSeen) fail('changed_in_another_tab');
          item.authored = checked; return { result: undefined, save: true };
        });
        lastAuthoredSeen = JSON.stringify(checked);
      });
    },
    clearAuthored: () => locked(async () => {
      await transaction(current => {
        const item = entry(current);
        if (JSON.stringify(item.authored ?? null) !== lastAuthoredSeen) fail('changed_in_another_tab');
        delete item.authored; return { result: undefined, save: true };
      });
      lastAuthoredSeen = JSON.stringify(null);
    }),
  };
}
