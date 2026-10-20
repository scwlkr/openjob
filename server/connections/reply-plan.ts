import addresses from 'email-addresses';
import type { ReplyPlan, ReplySource } from '../../shared/connected-reply.ts';
import { connectionFail } from '../../shared/connection-onboarding.ts';
import type { GmailReplyHeaders } from '../providers/gmail-wire.ts';

function list(value: string | undefined, required = false): string[] {
  if (value === undefined || value === '') { if (required) connectionFail('reply_unavailable'); return []; }
  const parsed = addresses.parseAddressList({ input: value, strict: true, rfc6532: false });
  if (!parsed) connectionFail('reply_unavailable');
  const mailboxes = parsed.flatMap(item => item.type === 'group' ? item.addresses : [item]);
  if (required && !mailboxes.length || mailboxes.length > 50) connectionFail('reply_unavailable');
  return mailboxes.map(item => {
    // The parser's semantic local part drops quotes. Serialize it as an addr-spec again.
    const local = /^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+(?:\.[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+)*$/.test(item.local) ? item.local : `"${item.local.replace(/["\\]/g, '\\$&')}"`;
    const value = `${local}@${item.domain}`;
    if (value.length > 320 || /[\u0000-\u001f\u007f]/.test(value)) connectionFail('reply_unavailable');
    return value;
  });
}
function messageIds(value?: string) {
  if (value === undefined || value === '') return [];
  const ids = value.match(/<[^<>\s@]+@[^<>\s@]+>/g) ?? [];
  if (!ids.length || ids.length > 100 || ids.some(id => id.length > 998) || value.replace(/<[^<>\s@]+@[^<>\s@]+>/g, '').trim()) connectionFail('reply_unavailable');
  return ids;
}
/** Reviewed address plans only; source body, Bcc and attachments never enter a draft. */
export function replyPlans(from: string, meta: GmailReplyHeaders): { reply: ReplyPlan; replyAll: ReplyPlan } {
  const originalFrom = list(meta.from, true), originalTo = list(meta.to), originalCc = list(meta.cc);
  const self = from.toLowerCase();
  const unique = (values: string[], omit: string[] = []) => { const seen = new Set([self, ...omit.map(item => item.toLowerCase())]); return values.filter(item => { const key = item.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; }); };
  // A present invalid/empty Reply-To must never fall back silently to From.
  let targets = unique(meta.replyTo === undefined ? originalFrom : list(meta.replyTo, true));
  if (!targets.length && meta.replyTo === undefined && originalFrom.every(item => item.toLowerCase() === self)) targets = unique(originalTo);
  if (!targets.length) connectionFail('reply_unavailable');
  const parent = messageIds(meta.messageId); if (parent.length > 1) connectionFail('reply_unavailable');
  const inherited = messageIds(meta.references), previous = meta.references === undefined ? messageIds(meta.inReplyTo) : [];
  const references = [...inherited, ...(!inherited.length && previous.length === 1 ? previous : []), ...parent];
  if (references.length > 100) connectionFail('reply_unavailable');
  const subject = /^re:/i.test(meta.subject ?? '') ? meta.subject! : `Re: ${meta.subject ?? ''}`;
  if (subject.length > 4096) connectionFail('reply_unavailable');
  const base = { from, subject, ...(parent[0] ? { inReplyTo: parent[0] } : {}), references };
  const allTo = unique([...targets, ...originalTo]);
  const reply = { ...base, to: targets, cc: [] }, replyAll = { ...base, to: allTo, cc: unique(originalCc, allTo) };
  if (replyAll.to.length > 50 || replyAll.cc.length > 50) connectionFail('reply_unavailable');
  return { reply, replyAll };
}
export async function replyReviewToken(owner: string, source: ReplySource, plans: ReturnType<typeof replyPlans>) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([owner, source, plans])));
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}
