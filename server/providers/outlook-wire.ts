import type { ProviderFolder, ProviderMessage } from '../../shared/provider-contracts.ts';
import { createProviderResourceRef as ref } from '../../shared/provider-preview.ts';
export type OutlookReadErrorCode = 'execution_disabled' | 'authentication_required' | 'consent_required' | 'provider_forbidden' | 'rate_limited' | 'provider_error' | 'network_error' | 'malformed_response' | 'unsupported_operation' | 'invalid_cursor' | 'forbidden' | 'invalid_input' | 'timeout';
export class OutlookReadError extends Error { readonly code: OutlookReadErrorCode; constructor(code: OutlookReadErrorCode) { super(`Outlook read adapter: ${code.replaceAll('_', ' ')}.`); this.name = 'OutlookReadError'; this.code = code; } }
export function fail(code: OutlookReadErrorCode): never { throw new OutlookReadError(code); }
export function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) fail('malformed_response'); return value as Record<string, unknown>; }
export function string(value: unknown, max = 4096, empty = false): string {
  if (typeof value !== 'string' || !empty && !value || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value)) fail('malformed_response');
  for (const character of value) { const point = character.codePointAt(0)!; if (point >= 0xd800 && point <= 0xdfff) fail('malformed_response'); }
  return value;
}
export function upstream(value: unknown): string { const id = string(value, 256); if (!/^[A-Za-z0-9_+=/-]+$/.test(id)) fail('malformed_response'); return id; }
function resource(account: string, kind: 'message' | 'thread' | 'folder', id: string) { try { return ref(account, kind, id); } catch { return fail('malformed_response'); } }
export const email = (value: unknown): value is string => typeof value === 'string' && value.length <= 254 && !/[\u0000-\u001f\u007f-\u009f]/.test(value) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
function address(value: unknown): string {
  const entry = object(object(value).emailAddress); if (!email(entry.address)) fail('malformed_response');
  if (entry.name !== undefined && (typeof entry.name !== 'string' || entry.name.length > 256 || /[\u0000-\u001f\u007f-\u009f]/.test(entry.name))) fail('malformed_response');
  return entry.name ? `${entry.name} <${entry.address}>` : entry.address;
}
export function mapFolder(value: unknown, account: string, expected: string): ProviderFolder {
  const row = object(value); const id = upstream(row.id); if (id !== expected) fail('malformed_response');
  const name = string(row.displayName, 256); if (/[\u0000-\u001f\u007f-\u009f]/.test(name)) fail('malformed_response');
  return { id: resource(account, 'folder', id), accountId: account, upstreamId: id, name };
}
export function mapMessage(value: unknown, account: string, expected: string): ProviderMessage {
  const row = object(value); const id = upstream(row.id); const thread = upstream(row.conversationId); const folder = upstream(row.parentFolderId);
  if (id !== expected || typeof row.isRead !== 'boolean') fail('malformed_response');
  const subject = string(row.subject, 4096, true); if (/[\u0000-\u001f\u007f-\u009f]/.test(subject)) fail('malformed_response');
  const body = object(row.body); const content = string(body.content, 65536, true); if (new TextEncoder().encode(content).length > 65536 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(content)) fail('malformed_response');
  if (typeof body.contentType !== 'string' || body.contentType.toLowerCase() !== 'text') fail('malformed_response');
  const recipients = row.toRecipients; if (!Array.isArray(recipients) || recipients.length > 100) fail('malformed_response');
  const to = recipients.map(address).join(', '); if (to.length > 4096) fail('malformed_response');
  const received = string(row.receivedDateTime, 64); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(received) || !Number.isFinite(Date.parse(received))) fail('malformed_response');
  const receivedAt = new Date(received).toISOString(); if (receivedAt.slice(0, 19) !== received.slice(0, 19) || !/^\d{4}-/.test(receivedAt)) fail('malformed_response');
  return { id: resource(account, 'message', id), accountId: account, upstreamId: id, upstreamThreadId: thread, threadId: resource(account, 'thread', thread), folderIds: [resource(account, 'folder', folder)], subject: subject || '(No subject)', from: address(row.from), to, body: content, receivedAt, read: row.isRead };
}
