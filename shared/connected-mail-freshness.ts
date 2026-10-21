/** Transient current-page observations; never an authorization lease or history cursor. */
export const MAIL_REFRESH_MS = 60_000;
export const MAIL_VIEW_TTL_MS = 300_000;
export type MailReadFreshness = { observedAt: string; staleAt: string; expiresAt: string };
export type MailReadWindow = MailReadFreshness & { staleDeadline: number; expiryDeadline: number; staleWallDeadline: number; expiryWallDeadline: number };
export function mailReadFreshness(observedAt: number, credentialExpiresAt: number): MailReadFreshness {
  const expiresAt = Math.min(observedAt + MAIL_VIEW_TTL_MS, credentialExpiresAt);
  if (!Number.isFinite(observedAt) || !Number.isFinite(expiresAt) || expiresAt <= observedAt) throw new Error('Mail view expired.');
  return { observedAt: new Date(observedAt).toISOString(), staleAt: new Date(Math.min(observedAt + MAIL_REFRESH_MS, expiresAt)).toISOString(), expiresAt: new Date(expiresAt).toISOString() };
}
/** Anchor to request start, not response receipt, so transit and clock skew cannot extend a view. */
export function mailReadWindow(value: unknown, requestedAt: number, wallRequestedAt: number): MailReadWindow {
  const raw = value as MailReadFreshness;
  if (!raw || typeof raw !== 'object' || Object.keys(raw).sort().join(',') !== 'expiresAt,observedAt,staleAt' || !Number.isFinite(requestedAt) || requestedAt < 0 || !Number.isFinite(wallRequestedAt)) throw new Error('Invalid Mail observation.');
  const times = [raw.observedAt, raw.staleAt, raw.expiresAt].map(value => {
    const time = typeof value === 'string' ? Date.parse(value) : NaN;
    if (!Number.isFinite(time) || new Date(time).toISOString() !== value) throw new Error('Invalid Mail observation.');
    return time;
  });
  const [observedAt, staleAt, expiresAt] = times;
  if (staleAt < observedAt || staleAt > expiresAt || staleAt - observedAt > MAIL_REFRESH_MS || expiresAt <= observedAt || expiresAt - observedAt > MAIL_VIEW_TTL_MS) throw new Error('Invalid Mail observation.');
  return { ...raw, staleDeadline: requestedAt + staleAt - observedAt, expiryDeadline: requestedAt + expiresAt - observedAt, staleWallDeadline: wallRequestedAt + staleAt - observedAt, expiryWallDeadline: wallRequestedAt + expiresAt - observedAt };
}

export const mailWindowExpired = (window: MailReadWindow, monotonicNow: number, wallNow: number) => monotonicNow >= window.expiryDeadline || wallNow >= window.expiryWallDeadline;
export const mailWindowStale = (window: MailReadWindow, monotonicNow: number, wallNow: number) => monotonicNow >= window.staleDeadline || wallNow >= window.staleWallDeadline;
