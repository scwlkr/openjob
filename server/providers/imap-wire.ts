export type ImapReadErrorCode = 'execution_disabled' | 'authentication_required' | 'consent_required' | 'provider_forbidden' | 'rate_limited' | 'provider_error' | 'network_error' | 'malformed_response' | 'unsupported_operation' | 'invalid_cursor' | 'forbidden' | 'invalid_input' | 'timeout';
export class ImapReadError extends Error { readonly code: ImapReadErrorCode; constructor(code: ImapReadErrorCode) { super(`IMAP read adapter: ${code.replaceAll('_', ' ')}.`); this.name = 'ImapReadError'; this.code = code; } }
export function fail(code: ImapReadErrorCode): never { throw new ImapReadError(code); }
export function number(value: string, zero = false): number { if (!(zero ? /^(0|[1-9][0-9]{0,9})$/ : /^[1-9][0-9]{0,9}$/).test(value)) fail('malformed_response'); const result = Number(value); if (result > 4294967295) fail('malformed_response'); return result; }
export function responseBytes(value: unknown): Uint8Array { if (!(value instanceof Uint8Array) || value.byteLength > 262144 || !value.byteLength) fail('malformed_response'); return value; }
function protocol(bytes: Uint8Array): string { if (bytes.some(byte => byte > 126 || byte < 32 && byte !== 13 && byte !== 10 && byte !== 9)) fail('malformed_response'); return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
function lines(value: Uint8Array): string[] { const text = protocol(responseBytes(value)); if (!text.endsWith('\r\n') || /(^|[^\r])\n|\r(?!\n)/.test(text)) fail('malformed_response'); return text.slice(0, -2).split('\r\n'); }
function completion(line: string | undefined, tag: string, readOnly = false) {
  const match = /^([^ ]+) (OK|NO|BAD)(?: (.*))?$/i.exec(line ?? '');
  if (!match || match[1] !== tag) fail('malformed_response');
  const status = match[2]!.toUpperCase();
  if (status === 'NO') fail('provider_forbidden'); if (status === 'BAD') fail('provider_error');
  if (readOnly && !/^\[READ-ONLY\](?: |$)/i.test(match[3] ?? '')) fail('malformed_response');
}
export function parseExamine(value: Uint8Array, tag: string): number {
  const rows = lines(value); completion(rows.pop(), tag, true); let validity: number | undefined; const seen = new Set<string>();
  for (const line of rows) {
    const match = /^\* OK \[UIDVALIDITY ([0-9]+)\](?: .*)?$/i.exec(line);
    if (match) { if (validity !== undefined) fail('malformed_response'); validity = number(match[1]!); continue; }
    let key: string | undefined;
    if (/^\* FLAGS \([^()\r\n]*\)$/i.test(line)) key = 'flags';
    else if (/^\* [0-9]+ (EXISTS|RECENT)$/i.test(line)) { const count = /^\* ([0-9]+) (EXISTS|RECENT)$/i.exec(line)!; number(count[1]!, true); key = count[2]!.toUpperCase(); }
    else if (/^\* OK \[(UIDNEXT|UNSEEN) [0-9]+\](?: .*)?$/i.test(line)) { const code = /^\* OK \[(UIDNEXT|UNSEEN) ([0-9]+)\]/i.exec(line)!; number(code[2]!); key = code[1]!.toUpperCase(); }
    else if (/^\* OK \[PERMANENTFLAGS \(\)\](?: .*)?$/i.test(line)) key = 'permanentflags';
    else fail('malformed_response');
    if (key === undefined || seen.has(key)) fail('malformed_response'); seen.add(key);
  }
  if (validity === undefined) fail('malformed_response'); return validity;
}
export function parseSearch(value: Uint8Array, tag: string): number[] {
  const rows = lines(value); completion(rows.pop(), tag); if (rows.length !== 1 || !/^\* SEARCH(?: [0-9]+)*$/i.test(rows[0]!)) fail('malformed_response');
  const values = rows[0]!.slice(8).trim(); const uids = values ? values.split(' ').map(value => number(value)) : [];
  if (uids.length > 1000 || new Set(uids).size !== uids.length) fail('malformed_response'); return uids.sort((a, b) => a - b);
}
function internalDate(value: string): string {
  const match = /^( [1-9]|0?[1-9]|[12][0-9]|3[01])-([A-Za-z]{3})-([0-9]{4}) ([0-9]{2}):([0-9]{2}):([0-9]{2}) ([+-])([0-9]{2})([0-9]{2})$/.exec(value); if (!match) fail('malformed_response');
  const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(match[2]!.toLowerCase());
  const day = Number(match[1]); const year = Number(match[3]); const hour = Number(match[4]); const minute = Number(match[5]); const second = Number(match[6]); const zoneHour = Number(match[8]); const zoneMinute = Number(match[9]);
  if (month < 0 || !year || hour > 23 || minute > 59 || second > 59 || zoneHour > 23 || zoneMinute > 59) fail('malformed_response');
  const civil = `${match[3]}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${match[4]}:${match[5]}:${match[6]}.000Z`; const milliseconds = Date.parse(civil); if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== civil) fail('malformed_response');
  const result = new Date(milliseconds - (match[7] === '+' ? 1 : -1) * (zoneHour * 60 + zoneMinute) * 60000).toISOString(); if (!/^[0-9]{4}-/.test(result)) fail('malformed_response'); return result;
}
export function parseFetch(value: Uint8Array, tag: string, expectedUid: number): { literal: Uint8Array; read: boolean; receivedAt: string } {
  const bytes = responseBytes(value); let end = -1; for (let index = 0; index < bytes.length - 1; index++) if (bytes[index] === 13 && bytes[index + 1] === 10) { end = index; break; }
  if (end < 0) fail('malformed_response'); const first = protocol(bytes.slice(0, end));
  const match = /^\* ([0-9]+) FETCH \((.*)BODY\[\] \{([0-9]+)\}$/i.exec(first); if (!match) fail('malformed_response'); number(match[1]!);
  const count = number(match[3]!); if (count > 65536 || end + 2 + count > bytes.length) fail('malformed_response'); const literal = bytes.slice(end + 2, end + 2 + count);
  const rest = lines(bytes.slice(end + 2 + count)); completion(rest.pop(), tag); if (rest.length !== 1 || !rest[0]!.endsWith(')')) fail('malformed_response');
  let attrs = `${match[2]} ${rest[0]!.slice(0, -1)}`.trim(); const found = new Map<string, string>();
  while (attrs) { const field = /^(UID ([0-9]+)|FLAGS \(([^()]*)\)|INTERNALDATE "([^"\r\n]+)")(?: |$)/i.exec(attrs); if (!field) fail('malformed_response'); const key = field[2] !== undefined ? 'uid' : field[3] !== undefined ? 'flags' : 'date'; if (found.has(key)) fail('malformed_response'); found.set(key, field[2] ?? field[3] ?? field[4]!); attrs = attrs.slice(field[0].length).trimStart(); }
  if (found.size !== 3 || number(found.get('uid')!) !== expectedUid) fail('malformed_response');
  const flags = found.get('flags')! ? found.get('flags')!.split(' ') : []; if (flags.length > 100 || flags.some(flag => !/^\\?[A-Za-z0-9_$.-]{1,64}$/.test(flag)) || new Set(flags.map(flag => flag.toLowerCase())).size !== flags.length) fail('malformed_response');
  return { literal, read: flags.some(flag => flag.toLowerCase() === '\\seen'), receivedAt: internalDate(found.get('date')!) };
}
