import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import SessionGmail from '../../../app/connections/session-gmail';
import '../../../app/globals.css';

let mode = 'normal', release: (() => void) | undefined, active = false, epoch = 0;
window.fetch = async (input, init) => {
  const path = String(input), method = init?.method;
  if (path.endsWith('/status')) return Response.json({ data: { address: 'alex@example.invalid' } });
  if (method === 'DELETE') { active = false; return Response.json({ data: { status: 'disconnected' } }); }
  if (path.endsWith('/begin')) { active = false; epoch++; return Response.json({ data: { sessionId: String(epoch).padStart(32, '0'), expiresAt: Date.now() + 600000 } }); }
  if (path.endsWith('/connect')) { active = true; return Response.json({ data: { expiresAt: Date.now() + (mode === 'expiry' ? 100 : 600000) } }); }
  if (path.endsWith('/mail')) {
    if (mode === 'delay-read') await new Promise<void>(resolve => { release = resolve; });
    return Response.json({ data: { page: { messages: active ? [{ id: 'invented', subject: 'Invented session subject', body: 'Invented session body' }] : [] } } });
  }
  throw new Error('Unexpected fixture request');
};
const session = { localIdentity: { uid: 'alex', tenantId: null }, signInMethod: 'google' as const, getIdToken: async () => 'invented-firebase-proof' };
const popup = async (_uid: string, _address: string, signal: AbortSignal, consume: (token: string) => Promise<void>) => {
  if (mode === 'delay-popup') await new Promise<void>(resolve => { release = resolve; });
  signal.throwIfAborted(); await consume('invented-ui-access');
};
function App() {
  const [controller] = useState(() => new AbortController());
  return <main><p>Isolated UI fixture · all accounts and Mail invented · no provider calls.</p>
    <button onClick={() => { mode = 'delay-popup'; }}>Delay popup</button><button onClick={() => { mode = 'delay-read'; }}>Delay read</button><button onClick={() => { release?.(); release = undefined; }}>Release pending</button><button onClick={() => { mode = 'expiry'; }}>Short expiry</button><button onClick={() => controller.abort()}>Fixture sign out</button>
    <SessionGmail session={session} signal={controller.signal} popup={popup} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
