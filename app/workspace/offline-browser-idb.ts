export const OFFLINE_DATABASE = 'openjob-private-workspace-v1';
const STORE = 'private-state';
/** Resolve writes only after transaction completion, and abort guarded late writes. */
export async function browserOfflineTransaction<T>(factory: IDBFactory, change: (value: unknown) => { value?: unknown; result: T }, guard: () => void): Promise<T> {
  guard();
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(OFFLINE_DATABASE, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Offline storage unavailable.'));
    request.onblocked = () => reject(new Error('Offline storage unavailable.'));
  });
  return new Promise<T>((resolve, reject) => {
    let result: T; let failure: unknown;
    try {
      guard(); const transaction = db.transaction(STORE, 'readwrite'); const store = transaction.objectStore(STORE);
      transaction.oncomplete = () => { db.close(); try { guard(); resolve(result); } catch (error) { reject(error); } };
      transaction.onabort = transaction.onerror = () => { db.close(); reject(failure ?? new Error('Offline storage could not be saved.')); };
      const request = store.get('current');
      request.onerror = () => { failure = new Error('Offline storage could not be loaded.'); transaction.abort(); };
      request.onsuccess = () => { try { guard(); const next = change(request.result); result = next.result; if (next.value !== undefined) { guard(); store.put(next.value, 'current'); } } catch (error) { failure = error; transaction.abort(); } };
    } catch (error) { db.close(); reject(error); }
  });
}
