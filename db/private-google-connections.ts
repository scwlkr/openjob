import { FirestoreRequestError, bytesToBase64Url, type createFirestoreRestClient, type FirestoreDocument } from './firestore-rest.ts';
import { activeUserHistoryWrite, assertActiveUser, isInactiveUserError } from './user-history.ts';
import { googleRows, type GoogleConnection, type PrivateGoogleConnections } from '../server/connections/google-state.ts';
import { connectionFail } from '../shared/connection-onboarding.ts';

type Client = ReturnType<typeof createFirestoreRestClient>;
type Options = { executionMode?: 'disabled' | 'configured'; db: Client; key: CryptoKey; keyId: string };
const encoder = new TextEncoder();
const MAX_PLAINTEXT_BYTES = 600_000, MAX_DOCUMENT_BYTES = 850_000;
const concurrent = (error: unknown) => error instanceof FirestoreRequestError && ['ABORTED', 'ALREADY_EXISTS', 'FAILED_PRECONDITION', 'NOT_FOUND'].includes(error.code ?? '');
function decode(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) connectionFail('invalid_state');
  const bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
  if (bytesToBase64Url(bytes) !== value) connectionFail('invalid_state');
  return bytes;
}
/** Source-only private backend. No loader, default transport/key, or runtime binding.
 * Transport must not replay ambiguous commits. The existing REST client only
 * retries an explicit authentication rejection; CAS contention reruns pure apply. */
export function createFirestorePrivateGoogleConnections(options: Options): PrivateGoogleConnections & {
  cleanupExpiredForOwner(owner: string, now?: number): Promise<number>;
} {
  const { db, key, keyId, executionMode = 'disabled' } = options;
  function enabled() {
    if (executionMode !== 'configured' || !key) connectionFail('not_configured');
    const algorithm = key.algorithm as AesKeyAlgorithm;
    if (key.type !== 'secret' || key.extractable || algorithm.name !== 'AES-GCM' || algorithm.length !== 256 || !key.usages.includes('encrypt') || !key.usages.includes('decrypt') || !/^[a-zA-Z0-9_-]{1,64}$/.test(keyId)) connectionFail('not_configured');
  }
  function path(owner: string) {
    if (!/^user_[a-f0-9]{32}$/.test(owner)) connectionFail('invalid_input');
    return `v1PrivateGoogleConnections/${owner}`;
  }
  const context = (owner: string) => encoder.encode(JSON.stringify(['openjob-private-google', 1, db.documentName(path(owner)), owner, keyId]));
  async function seal(owner: string, rows: GoogleConnection[]) {
    const plaintext = encoder.encode(JSON.stringify(googleRows(rows, owner)));
    if (plaintext.length > MAX_PLAINTEXT_BYTES) connectionFail('capacity');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: context(owner), tagLength: 128 }, key, plaintext));
    return { version: { integerValue: '1' }, keyId: { stringValue: keyId }, iv: { stringValue: bytesToBase64Url(iv) }, ciphertext: { stringValue: bytesToBase64Url(ciphertext) } };
  }
  async function load(owner: string) {
    const location = path(owner);
    await assertActiveUser(db, owner);
    const response = await db.request(location, {}, { allowNotFound: true });
    if (response.status === 404) { await assertActiveUser(db, owner); return { doc: null, rows: [] as GoogleConnection[] }; }
    const doc = await response.json() as FirestoreDocument, fields = doc.fields;
    if (doc.name !== db.documentName(location) || !doc.updateTime || !fields || Object.keys(fields).sort().join(',') !== 'ciphertext,iv,keyId,version' || fields.version.integerValue !== '1' || fields.keyId.stringValue !== keyId || typeof fields.iv.stringValue !== 'string' || typeof fields.ciphertext.stringValue !== 'string' || encoder.encode(JSON.stringify(doc)).length > MAX_DOCUMENT_BYTES) connectionFail('invalid_state');
    const iv = decode(fields.iv.stringValue), ciphertext = decode(fields.ciphertext.stringValue);
    if (iv.length !== 12 || ciphertext.length < 16 || ciphertext.length > MAX_PLAINTEXT_BYTES + 16) connectionFail('invalid_state');
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: context(owner), tagLength: 128 }, key, ciphertext as BufferSource);
    const rows = googleRows(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)), owner);
    await assertActiveUser(db, owner);
    return { doc, rows };
  }
  async function change(owner: string, apply: (rows: GoogleConnection[]) => GoogleConnection[]) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { doc, rows } = await load(owner), next = googleRows(apply(rows), owner);
      const update = { name: db.documentName(path(owner)), fields: await seal(owner, next) };
      if (encoder.encode(JSON.stringify(update)).length > MAX_DOCUMENT_BYTES) connectionFail('capacity');
      const fence = await activeUserHistoryWrite(db, owner);
      try {
        await db.request(':commit', { method: 'POST', body: JSON.stringify({ writes: [fence, { update, currentDocument: doc ? { updateTime: doc.updateTime } : { exists: false } }] }) });
      } catch (error) { if (concurrent(error)) continue; throw error; }
      // Do not put this check inside the retry catch: the write already succeeded.
      await assertActiveUser(db, owner);
      return structuredClone(next);
    }
    return connectionFail('conflict');
  }
  async function guarded<T>(operation: () => Promise<T>) {
    enabled();
    try { return await operation(); }
    catch (error) {
      if (isInactiveUserError(error)) return connectionFail('forbidden');
      const code = (error as { code?: string })?.code;
      if (code && ['invalid_input', 'invalid_state', 'capacity', 'conflict'].includes(code)) return connectionFail(code);
      // Never expose Firestore/provider response text, paths, plaintext or crypto errors.
      return connectionFail('unavailable');
    }
  }
  return {
    read: owner => guarded(async () => (await load(owner)).rows),
    change: (owner, apply) => guarded(() => change(owner, apply)),
    cleanupExpiredForOwner: (owner, now = Date.now()) => guarded(async () => {
      if (!Number.isSafeInteger(now) || now < 0) connectionFail('invalid_input');
      let removed = 0;
      await change(owner, rows => {
        removed = 0;
        return rows.map(row => {
          if (!row.pending || row.pending.expiresAt > now) return row;
          removed++;
          const next: GoogleConnection = { ...row, status: 'reconnect_required' };
          delete next.pending; delete next.grant; delete next.operation; delete next.consentExpiresAt;
          return next;
        });
      });
      return removed;
    }),
  };
}
