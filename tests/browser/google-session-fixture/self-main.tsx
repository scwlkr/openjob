import { createRoot } from 'react-dom/client';
import SelfSessionGmail from '../../../app/connections/self-session-gmail';
import type { AuthSession, OpenJobAuth } from '../../../app/openjob-contracts';
import '../../../app/globals.css';

const mode = new URL(location.href).searchParams.get('state') ?? 'ready';
const session: AuthSession = { localIdentity: { uid: 'invented', tenantId: null, email: 'alex@example.invalid', displayName: 'Alex Example' }, signInMethod: 'google', getIdToken: async () => 'invented-firebase-proof' };
let listener: (session: AuthSession | null) => void = () => {}, signed = mode !== 'signed-out', checks = 0;
const auth: Pick<OpenJobAuth, 'observe' | 'signIn' | 'switchUser' | 'signOut'> = { observe(next: typeof listener) { listener = next; queueMicrotask(() => next(signed ? session : null)); return () => {}; }, async signIn() { signed = true; listener(session); return null; }, async switchUser() { signed = false; listener(null); }, async signOut() { signed = false; listener(null); } };
window.fetch = async (input, init) => {
  const path = String(input);
  if (path.endsWith('/status')) {
    checks++;
    if (mode === 'timeout' && checks === 1) return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    if (mode === 'checking') return new Promise(() => {});
    if (mode === 'email-missing') return Response.json({ error: { code: 'email_permission_required' } }, { status: 401 });
    if (mode === 'wrong') return Response.json({ error: { code: 'wrong_account' } }, { status: 401 });
    if (mode === 'error' && checks === 1) return Response.json({ error: { code: 'account_check_unavailable', message: 'Account check: provider_request_failed.' } }, { status: 503 });
    return Response.json({ data: { address: 'alex@example.invalid' } });
  }
  if (init?.method === 'DELETE') return Response.json({ data: { status: 'disconnected' } });
  if (path.endsWith('/begin')) return Response.json({ data: { sessionId: 'a'.repeat(32), expiresAt: Date.now() + 600000 } });
  if (path.endsWith('/connect')) return Response.json({ data: { expiresAt: Date.now() + 600000 } });
  if (path.endsWith('/mail')) return Response.json({ data: { page: { messages: [] } } });
  throw new Error('Unexpected fixture request');
};
const popup = async (_uid: string, _address: string, _signal: AbortSignal, consume: (token: string) => Promise<void>) => { await consume('invented-access'); };
createRoot(document.getElementById('root')!).render(<SelfSessionGmail authentication={auth} popup={popup} accountTimeoutMs={mode === 'checking' ? 8000 : 180} />);
