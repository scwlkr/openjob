import type { ProviderAccount, ProviderConnectorStatus, ProviderReadAdapter } from '../../shared/provider-contracts.ts';
import { fail, object, upstream, email, string, mapMessage, mapFolder } from './outlook-wire.ts';
import { initialMessagesUrl, validateMessagesUrl, outlookGet, OUTLOOK_ORIGIN, OUTLOOK_PROFILE_SELECT, OUTLOOK_MESSAGE_SELECT } from './outlook-transport.ts';
export { OutlookReadError } from './outlook-wire.ts';
export type OutlookAccountBinding = { ownerId: string; accountId: string; subject: string; address: string; label: string };
export type OutlookReadCredential = { accessToken: string; subject: string; scopes: string[]; expiresAt: number };
export type OutlookReadAdapterOptions = { bindings: OutlookAccountBinding[]; resolveCredential(binding: OutlookAccountBinding): Promise<OutlookReadCredential | null>; approveExecution?(binding: OutlookAccountBinding): boolean | Promise<boolean>; fetchImplementation?: typeof fetch; now?: () => number; timeoutMs?: number };
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const opaque = (value: unknown): value is string => { if (typeof value !== 'string' || !value || value.length > 256 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) return false; for (const char of value) { const point = char.codePointAt(0)!; if (point >= 0xd800 && point <= 0xdfff) return false; } return true; };
export function describeOutlookReadAdapter(): ProviderConnectorStatus[] {
  return [{ provider: 'outlook', adapter: 'outlook-graph-read', status: 'not_connected', consent: 'required', liveExecutionEnabled: false, implementedOperations: ['mail.read', 'mail.folders'], unsupportedOperations: ['calendar.read', 'calendar.write', 'mail.draft', 'mail.send', 'mail.delta', 'reconnect'], message: 'Outlook Graph read mapping is implemented with invented HTTP evidence. No live account is connected. Reviewed server wiring and delegated Mail.Read plus User.Read consent are required; runtime execution remains disabled. Subject binding verifies Graph /me.id, not OIDC issuer or tenant claims.' }];
}
function account(binding: OutlookAccountBinding): ProviderAccount {
  const unavailable = { available: false, reason: 'This Outlook adapter does not implement this operation.' };
  return { id: binding.accountId, upstreamId: binding.subject, provider: 'outlook', label: binding.label, address: binding.address, mode: 'provider', status: 'not_connected', statusReason: 'Server binding metadata only; no live connection has been verified.', capabilities: { mailRead: { available: true, reason: 'Requires owner-approved execution and delegated Mail.Read plus User.Read.' }, calendarRead: { ...unavailable }, calendarWrite: { ...unavailable }, draft: { ...unavailable }, send: { ...unavailable }, reconnect: { ...unavailable } }, sync: { state: 'blocked', asOf: null, reason: 'No live synchronization has been performed. Graph delta is unsupported.' } };
}
type Cursor = { version: 1; mode: 'outlook-read-page'; owner: string; account: string; subject: string; nextLink: string; visited: string[] };
function encode(cursor: Cursor): string { const result = `op1.${btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(cursor)))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}`; if (result.length > 4096) fail('malformed_response'); return result; }
function decode(value: string | undefined, binding: OutlookAccountBinding): { url: string; visited: string[] } {
  if (value === undefined) return { url: initialMessagesUrl(), visited: [] };
  try {
    if (typeof value !== 'string' || value.length > 4096 || !/^op1\.[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const row = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(value.slice(4).replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0)))) as Cursor;
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).sort().join(',') !== 'account,mode,nextLink,owner,subject,version,visited' || row.version !== 1 || row.mode !== 'outlook-read-page' || row.owner !== binding.ownerId || row.account !== binding.accountId || row.subject !== binding.subject || !Array.isArray(row.visited) || row.visited.length > 16 || row.visited.some(value => typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) || new Set(row.visited).size !== row.visited.length || encode(row) !== value) throw new Error();
    const url = validateMessagesUrl(row.nextLink); if (!url.searchParams.has('$skip') && !url.searchParams.has('$skiptoken')) throw new Error();
    return { url: row.nextLink, visited: row.visited };
  } catch { return fail('invalid_cursor'); }
}
async function fingerprint(value: string) { const url = validateMessagesUrl(value); url.searchParams.sort(); const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url.href)); return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join(''); }
/** Closed by default; immutable-ID preference is requested, not asserted from ID spelling. */
export function createOutlookReadAdapter(options: OutlookReadAdapterOptions): ProviderReadAdapter {
  const { resolveCredential, approveExecution = () => false, fetchImplementation = fetch, now = Date.now, timeoutMs = 10000 } = options;
  if (!Array.isArray(options.bindings) || options.bindings.length > 100 || typeof resolveCredential !== 'function' || typeof approveExecution !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) fail('invalid_input');
  const bindings = structuredClone(options.bindings); const seen = new Set<string>(); const subjects = new Set<string>();
  for (const binding of bindings) { if (!binding || !id(binding.ownerId) || !id(binding.accountId) || !opaque(binding.subject) || !email(binding.address) || !opaque(binding.label) || seen.has(binding.accountId) || subjects.has(JSON.stringify([binding.ownerId, binding.subject]))) fail('invalid_input'); seen.add(binding.accountId); subjects.add(JSON.stringify([binding.ownerId, binding.subject])); }
  const select = (owner: string, account: string) => { if (!id(owner) || !id(account)) fail('invalid_input'); const found = bindings.find(binding => binding.ownerId === owner && binding.accountId === account); if (!found) fail('forbidden'); return found; };
  async function approved(binding: OutlookAccountBinding) { let allowed = false; try { allowed = await approveExecution(structuredClone(binding)); } catch { fail('execution_disabled'); } if (allowed !== true) fail('execution_disabled'); }
  function consent(binding: OutlookAccountBinding, credential: OutlookReadCredential | null): asserts credential is OutlookReadCredential {
    if (!credential || credential.subject !== binding.subject || typeof credential.accessToken !== 'string' || !/^[A-Za-z0-9._~+\/-]{1,8192}={0,2}$/.test(credential.accessToken) || !Number.isFinite(credential.expiresAt) || credential.expiresAt <= now()) fail('authentication_required');
    if (!Array.isArray(credential.scopes) || credential.scopes.length > 100 || credential.scopes.some(scope => !opaque(scope)) || new Set(credential.scopes).size !== credential.scopes.length || !credential.scopes.includes('Mail.Read') || !credential.scopes.includes('User.Read')) fail('consent_required');
  }
  return {
    async listAccounts(ownerId) { if (!id(ownerId)) fail('invalid_input'); return bindings.filter(binding => binding.ownerId === ownerId).map(account); },
    async listMessages({ ownerId, accountId, cursor }) {
      const binding = select(ownerId, accountId); const page = decode(cursor, binding); const currentHash = await fingerprint(page.url); if (page.visited.includes(currentHash)) fail('invalid_cursor'); await approved(binding);
      let credential: OutlookReadCredential | null; try { credential = structuredClone(await resolveCredential(structuredClone(binding))); } catch { return fail('authentication_required'); } consent(binding, credential);
      const get = async (url: string) => { await approved(binding); consent(binding, credential); return outlookGet(url, credential.accessToken, fetchImplementation, timeoutMs); };
      const path = (resource: string, selection: string) => { const url = new URL(`${OUTLOOK_ORIGIN}/v1.0/me${resource}`); url.search = new URLSearchParams({ $select: selection }).toString(); return url.href; };
      const profile = await get(path('', OUTLOOK_PROFILE_SELECT)); if (upstream(profile.id) !== binding.subject || !email(profile.mail ?? profile.userPrincipalName) || String(profile.mail ?? profile.userPrincipalName).toLowerCase() !== binding.address.toLowerCase()) fail('authentication_required');
      const result = await get(page.url); if (!Array.isArray(result.value) || result.value.length > 10) fail('malformed_response');
      const rows = result.value.map(value => upstream(object(value).id)); if (new Set(rows).size !== rows.length) fail('malformed_response');
      const visited = [...page.visited, currentHash]; const next = result['@odata.nextLink'];
      if (next !== undefined) { const nextUrl = validateMessagesUrl(string(next, 2048)); if (!nextUrl.searchParams.has('$skip') && !nextUrl.searchParams.has('$skiptoken') || visited.length > 16 || visited.includes(await fingerprint(nextUrl.href))) fail('malformed_response'); }
      const messages = []; const folders = new Map<string, ReturnType<typeof mapFolder>>();
      for (const messageId of rows) {
        const raw = await get(path(`/messages/${encodeURIComponent(messageId)}`, OUTLOOK_MESSAGE_SELECT)); const message = mapMessage(raw, accountId, messageId); const folderId = upstream(raw.parentFolderId);
        if (!folders.has(folderId)) folders.set(folderId, mapFolder(await get(path(`/mailFolders/${encodeURIComponent(folderId)}`, 'id,displayName')), accountId, folderId)); messages.push(message);
      }
      await approved(binding); consent(binding, credential);
      return { messages, folders: [...folders.values()], calendars: [], events: [], syncCursor: null, nextCursor: next === undefined ? null : encode({ version: 1, mode: 'outlook-read-page', owner: ownerId, account: accountId, subject: binding.subject, nextLink: next as string, visited }) };
    },
    async readChanges() { return fail('unsupported_operation'); },
  };
}
