import addresses from 'email-addresses';
import { validateConnectedReplyDraft, type ConnectedReplyDraft } from '../../shared/connected-reply.ts';

function invalid(): never { throw new Error('Unsupported Gmail reply content.'); }
const base64 = (text: string) => btoa(Array.from(new TextEncoder().encode(text), byte => String.fromCharCode(byte)).join(''));
function mailbox(value: string) {
  if (typeof value !== 'string' || value.length > 320 || /[^\x20-\x7e]/.test(value)) invalid();
  const rows = addresses.parseAddressList({ input: value, strict: true, rfc6532: false });
  if (!rows || rows.length !== 1 || rows[0]?.type !== 'mailbox') return invalid();
  const item = rows[0];
  const local = /^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+(?:\.[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+)*$/.test(item.local) ? item.local : `"${item.local.replace(/["\\]/g, '\\$&')}"`;
  if (`${local}@${item.domain}` !== value) invalid();
  return value;
}
function messageId(value: string) {
  if (typeof value !== 'string' || value.length > 900 || !/^<[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+(?:\.[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+)*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*>$/.test(value)) invalid();
  return value;
}
function subject(value: string) {
  // Each UTF-8 encoded-word stays whole and below RFC2047's 75-character limit.
  const words: string[] = []; let chunk = '';
  for (const char of value) {
    if (new TextEncoder().encode(chunk + char).length > 42) { words.push(`=?UTF-8?B?${base64(chunk)}?=`); chunk = ''; }
    chunk += char;
  }
  if (chunk) words.push(`=?UTF-8?B?${base64(chunk)}?=`);
  return words.length ? `Subject:\r\n ${words.join('\r\n ')}` : 'Subject:';
}
/** Deterministic text-only MIME from an already frozen reviewed draft. No quoting. */
export function serializeGmailReply(draft: ConnectedReplyDraft) {
  try { validateConnectedReplyDraft(draft); } catch { invalid(); }
  if (!draft.body.trim() || /[\u0000-\u001f\u007f]/.test(draft.plan.subject) || !draft.plan.subject.isWellFormed() || !draft.body.isWellFormed()) invalid();
  const plan = draft.plan;
  if (!plan.inReplyTo || !plan.references.length || plan.references.at(-1) !== plan.inReplyTo) invalid();
  const recipients = [...plan.to, ...plan.cc].map(mailbox);
  if (new Set(recipients.map(value => value.toLowerCase())).size !== recipients.length) invalid();
  const headers = [
    `Date: ${new Date(draft.updatedAt).toUTCString()}`, `From: ${mailbox(plan.from)}`,
    `To: ${plan.to.map(mailbox).join(',\r\n ')}`,
    ...(plan.cc.length ? [`Cc: ${plan.cc.map(mailbox).join(',\r\n ')}`] : []),
    subject(plan.subject), `In-Reply-To: ${messageId(plan.inReplyTo)}`,
    `References: ${plan.references.map(messageId).join('\r\n ')}`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64',
  ];
  // Base64 keeps body text out of header syntax; CRLF is the text MIME line ending.
  const body = base64(draft.body.replace(/\r\n|\r|\n/g, '\r\n')).match(/.{1,76}/g)?.join('\r\n') ?? '';
  const mime = headers.join('\r\n') + '\r\n\r\n' + body + '\r\n';
  if (mime.split('\r\n').some(line => line.length > 998) || mime.length > 131072) invalid();
  return base64(mime).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
