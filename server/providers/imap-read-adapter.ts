import type { ProviderAccount, ProviderConnectorStatus, ProviderReadAdapter } from '../../shared/provider-contracts.ts';
import { createProviderResourceRef as ref } from '../../shared/provider-preview.ts';
import { ImapReadError, fail, parseExamine, parseSearch, parseFetch, type ImapReadErrorCode } from './imap-wire.ts';
import { parseImapRfc822 } from './imap-rfc822.ts';
export { ImapReadError } from './imap-wire.ts';
export type ImapAccountBinding = { ownerId: string; accountId: string; subject: string; address: string; label: string; imap: { serverId: string; username: string; mailbox: 'INBOX' } };
export type ImapReadCredential = { accessToken: string; subject: string; scopes: string[]; expiresAt: number };
export type ImapReadSession = { binding: ImapAccountBinding; exchange(command: Uint8Array): Promise<Uint8Array>; close(): void | Promise<void> };
export type ImapReadAdapterOptions = { bindings: ImapAccountBinding[]; resolveCredential(binding: ImapAccountBinding): Promise<ImapReadCredential | null>; approveExecution?(binding: ImapAccountBinding): boolean | Promise<boolean>; openSession?(binding: ImapAccountBinding, credential: ImapReadCredential): Promise<ImapReadSession>; now?: () => number; timeoutMs?: number; pageSize?: number };
const encoder = new TextEncoder();
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const opaque = (value: unknown, maximum = 256): value is string => { if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f-\u009f]/.test(value)) return false; return ![...value].some(char => { const point = char.codePointAt(0)!; return point >= 0xd800 && point <= 0xdfff; }); };
function validBinding(value: unknown, code: ImapReadErrorCode): ImapAccountBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code); const row = value as ImapAccountBinding;
  if (Object.keys(row).sort().join(',') !== 'accountId,address,imap,label,ownerId,subject' || !id(row.ownerId) || !id(row.accountId) || !opaque(row.subject) || !opaque(row.label) || !opaque(row.address, 254) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.address) || !row.imap || typeof row.imap !== 'object' || Array.isArray(row.imap) || Object.keys(row.imap).sort().join(',') !== 'mailbox,serverId,username' || !id(row.imap.serverId) || !opaque(row.imap.username) || row.imap.mailbox !== 'INBOX') fail(code); return row;
}
function bindingFingerprint(row: ImapAccountBinding): string { return JSON.stringify([row.ownerId, row.accountId, row.subject, row.address, row.label, row.imap.serverId, row.imap.username, row.imap.mailbox]); }
async function configDigest(binding: ImapAccountBinding) { const digest = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify([binding.imap.serverId, binding.imap.username, binding.imap.mailbox]))); return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''); }
export function describeImapReadAdapter(): ProviderConnectorStatus[] { return [{ provider: 'imap', adapter: 'imap-inbox-read', status: 'not_connected', consent: 'required', liveExecutionEnabled: false, implementedOperations: ['mail.read', 'mail.inbox'], unsupportedOperations: ['calendar.read', 'calendar.write', 'mail.draft', 'mail.send', 'mail.delta', 'mail.threads', 'reconnect'], message: 'Bounded read-only IMAP INBOX mapping is implemented with invented protocol bytes. No live server is connected. Requires explicit internal imap.read approval and an injected authenticated session; no socket, TLS, login or OAuth implementation is provided.' }]; }
function account(binding: ImapAccountBinding): ProviderAccount { const unavailable = { available: false, reason: 'This bounded IMAP reader does not implement this operation.' }; return { id: binding.accountId, upstreamId: binding.subject, provider: 'imap', label: binding.label, address: binding.address, mode: 'provider', status: 'not_connected', statusReason: 'Owned binding metadata only; no live IMAP authentication has been verified.', capabilities: { mailRead: { available: true, reason: 'Requires approved injected authenticated INBOX session; imap.read is internal approval, not OAuth consent.' }, calendarRead: { ...unavailable }, calendarWrite: { ...unavailable }, draft: { ...unavailable }, send: { ...unavailable }, reconnect: { ...unavailable } }, sync: { state: 'blocked', asOf: null, reason: 'No live synchronization. Cursor bounds UIDs, not an immutable message/flag snapshot.' } }; }
type Cursor = { version: 1; mode: 'imap-inbox-read'; owner: string; account: string; subject: string; config: string; validity: number; last: number; ceiling: number; pageSize: number };
function encode(cursor: Cursor) { const result = `im1.${btoa(String.fromCharCode(...encoder.encode(JSON.stringify(cursor)))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}`; if (result.length > 4096) fail('malformed_response'); return result; }
function cursor(value: string | undefined, binding: ImapAccountBinding, config: string, pageSize: number): Cursor | null {
  if (value === undefined) return null;
  try { if (typeof value !== 'string' || value.length > 4096 || !/^im1\.[A-Za-z0-9_-]+$/.test(value)) throw new Error(); const row = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(value.slice(4).replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0)))) as Cursor;
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).sort().join(',') !== 'account,ceiling,config,last,mode,owner,pageSize,subject,validity,version' || row.version !== 1 || row.mode !== 'imap-inbox-read' || row.owner !== binding.ownerId || row.account !== binding.accountId || row.subject !== binding.subject || row.config !== config || row.pageSize !== pageSize || ![row.validity, row.last, row.ceiling].every(number => Number.isInteger(number) && number > 0 && number <= 4294967295) || row.last >= row.ceiling || encode(row) !== value) throw new Error(); return row;
  } catch { return fail('invalid_cursor'); }
}
async function timed<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> { let timer: ReturnType<typeof setTimeout> | undefined; try { return await Promise.race([operation(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ImapReadError('timeout')), timeoutMs); })]); } catch (error) { if (error instanceof ImapReadError) throw error; return fail('network_error'); } finally { if (timer) clearTimeout(timer); } }
/** There is no network fallback: all sessions are explicitly injected and approval defaults closed. */
export function createImapReadAdapter(options: ImapReadAdapterOptions): ProviderReadAdapter {
  const { resolveCredential, approveExecution = () => false, openSession, now = Date.now, timeoutMs = 10000, pageSize = 10 } = options;
  if (!Array.isArray(options.bindings) || options.bindings.length > 100 || typeof resolveCredential !== 'function' || typeof approveExecution !== 'function' || openSession !== undefined && typeof openSession !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 10) fail('invalid_input');
  let bindings: ImapAccountBinding[]; try { bindings = structuredClone(options.bindings); } catch { return fail('invalid_input'); } const accounts = new Set<string>();
  for (const binding of bindings) { validBinding(binding, 'invalid_input'); if (accounts.has(binding.accountId)) fail('invalid_input'); accounts.add(binding.accountId); }
  async function approved(binding: ImapAccountBinding) { let allowed = false; try { allowed = await approveExecution(structuredClone(binding)); } catch { fail('execution_disabled'); } if (allowed !== true) fail('execution_disabled'); }
  function consent(binding: ImapAccountBinding, value: ImapReadCredential | null): asserts value is ImapReadCredential { if (!value || value.subject !== binding.subject || typeof value.accessToken !== 'string' || !/^[A-Za-z0-9._~+\/-]{1,8192}={0,2}$/.test(value.accessToken) || !Number.isFinite(value.expiresAt) || value.expiresAt <= now()) fail('authentication_required'); if (!Array.isArray(value.scopes) || value.scopes.length > 100 || value.scopes.some(scope => !opaque(scope)) || new Set(value.scopes).size !== value.scopes.length || !value.scopes.includes('imap.read')) fail('consent_required'); }
  return {
    async listAccounts(owner) { if (!id(owner)) fail('invalid_input'); return bindings.filter(binding => binding.ownerId === owner).map(account); },
    async listMessages({ ownerId, accountId, cursor: token }) {
      if (!id(ownerId) || !id(accountId)) fail('invalid_input'); const binding = bindings.find(binding => binding.ownerId === ownerId && binding.accountId === accountId); if (!binding) fail('forbidden');
      const digest = await configDigest(binding); const previous = cursor(token, binding, digest, pageSize); if (!openSession) fail('execution_disabled'); await approved(binding);
      let credential: ImapReadCredential | null; try { credential = structuredClone(await resolveCredential(structuredClone(binding))); } catch { return fail('authentication_required'); } consent(binding, credential); await approved(binding); consent(binding, credential);
      let session: ImapReadSession | undefined; let openingExpired = false; let tagIndex = 0;
      const cleanup = async (value: ImapReadSession) => { if (typeof value?.close === 'function') { try { await timed(async () => { await value.close(); }, timeoutMs); } catch { /* A local transport close cannot authorize another command. */ } } };
      try {
        const opening = Promise.resolve().then(() => openSession(structuredClone(binding), structuredClone(credential!))).then(async value => { if (openingExpired) { await cleanup(value); return fail('timeout'); } return value; });
        try { session = await timed(() => opening, timeoutMs); } catch (error) { openingExpired = true; throw error; }
        try { if (!session || typeof session.exchange !== 'function' || typeof session.close !== 'function' || bindingFingerprint(validBinding(session.binding, 'authentication_required')) !== bindingFingerprint(binding)) fail('authentication_required'); } catch { fail('authentication_required'); }
        const command = async (request: string) => { await approved(binding); consent(binding, credential); const tag = `A${String(++tagIndex).padStart(3, '0')}`; const bytes = await timed(() => session!.exchange(encoder.encode(`${tag} ${request}\r\n`)), timeoutMs); return { tag, bytes }; };
        const examined = await command('EXAMINE INBOX'); const validity = parseExamine(examined.bytes, examined.tag); if (previous && previous.validity !== validity) fail('invalid_cursor');
        const searched = await command('UID SEARCH ALL'); const all = parseSearch(searched.bytes, searched.tag); const ceiling = previous?.ceiling ?? all.at(-1) ?? 0; const last = previous?.last ?? 0; const available = all.filter(uid => uid > last && uid <= ceiling); const selected = available.slice(0, pageSize);
        const messages = []; const namespace = `imap1.${digest}`; const folderId = ref(accountId, 'folder', `${namespace}.INBOX`);
        for (const uid of selected) { const fetched = await command(`UID FETCH ${uid} (UID FLAGS INTERNALDATE BODY.PEEK[])`); const message = parseFetch(fetched.bytes, fetched.tag, uid); const plain = parseImapRfc822(message.literal); const upstreamId = `${namespace}.${validity}.${uid}`; messages.push({ id: ref(accountId, 'message', upstreamId), accountId, upstreamId, upstreamThreadId: upstreamId, threadId: ref(accountId, 'thread', upstreamId), folderIds: [folderId], ...plain, receivedAt: message.receivedAt, read: message.read }); }
        const nextCursor = available.length > selected.length ? encode({ version: 1, mode: 'imap-inbox-read', owner: ownerId, account: accountId, subject: binding.subject, config: digest, validity, last: selected.at(-1)!, ceiling, pageSize }) : null;
        const completed = session; session = undefined; await cleanup(completed);
        await approved(binding); consent(binding, credential);
        return { messages, folders: [{ id: folderId, accountId, upstreamId: `${namespace}.INBOX`, name: 'INBOX' }], calendars: [], events: [], syncCursor: null, nextCursor };
      } catch (error) { if (error instanceof ImapReadError) throw error; return fail('malformed_response'); }
      finally { if (session) await cleanup(session); }
    },
    async readChanges() { return fail('unsupported_operation'); },
  };
}
