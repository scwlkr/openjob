import { fail } from './imap-wire.ts';
const controls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
function safe(value: string, maximum: number, lines = false): string { if (value.length > maximum || (lines ? controls : /[\u0000-\u001f\u007f-\u009f]/).test(value)) fail('malformed_response'); return value; }
/** Explicit plaintext RFC822 subset, not a general MIME implementation. */
export function parseImapRfc822(bytes: Uint8Array): { subject: string; from: string; to: string; body: string } {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > 65536) fail('malformed_response');
  let text: string; try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return fail('malformed_response'); }
  const split = text.indexOf('\r\n\r\n'); if (split < 0 || new TextEncoder().encode(text.slice(0, split)).length > 16384) fail('malformed_response');
  const rawHeaders = text.slice(0, split); if (/(^|[^\r])\n|\r(?!\n)/.test(rawHeaders)) fail('malformed_response');
  const lines: string[] = []; for (const line of rawHeaders.split('\r\n')) { if (/^[ \t]/.test(line)) { if (!lines.length) fail('malformed_response'); lines[lines.length - 1] += ` ${line.trimStart()}`; } else lines.push(line); }
  if (lines.length > 100) fail('malformed_response'); const headers = new Map<string, string>();
  const critical = ['subject', 'from', 'to', 'mime-version', 'content-type', 'content-transfer-encoding', 'content-disposition'];
  for (const line of lines) {
    const at = line.indexOf(':'); const name = line.slice(0, at).toLowerCase(); if (at < 1 || name.length > 128 || !/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name)) fail('malformed_response');
    const value = safe(line.slice(at + 1).trim(), 4096); if (/=\?[^?\s]+\?[bq]\?/i.test(value)) fail('unsupported_operation');
    if (critical.includes(name)) { if (headers.has(name)) fail('malformed_response'); headers.set(name, value); }
  }
  if (headers.has('mime-version') && headers.get('mime-version') !== '1.0') fail('unsupported_operation');
  const disposition = headers.get('content-disposition'); if (disposition && disposition.toLowerCase() !== 'inline') fail('unsupported_operation');
  const type = /^(text\/plain)(?:;\s*charset=(?:"(utf-8|us-ascii)"|(utf-8|us-ascii)))?$/i.exec(headers.get('content-type') ?? 'text/plain'); if (!type) fail('unsupported_operation');
  const charset = (type[2] ?? type[3] ?? 'us-ascii').toLowerCase(); const encoding = (headers.get('content-transfer-encoding') ?? '7bit').toLowerCase();
  if (!['7bit', '8bit'].includes(encoding)) fail('unsupported_operation');
  const body = safe(text.slice(split + 4), 65536, true);
  if ((charset === 'us-ascii' || encoding === '7bit') && [...new TextEncoder().encode(body)].some(byte => byte > 127)) fail('unsupported_operation');
  return { subject: safe(headers.get('subject') || '(No subject)', 4096), from: safe(headers.get('from') ?? '', 4096), to: safe(headers.get('to') ?? '', 4096), body };
}
