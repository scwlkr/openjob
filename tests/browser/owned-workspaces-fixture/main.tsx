import { createRoot } from 'react-dom/client';
import { useCallback, useState } from 'react';
import OwnedWorkspacesApp from '../../../app/owned-workspaces/owned-workspaces-app';
import PersonalWorkspaceApp from '../../../app/workspace/personal-workspace-app';
import type { AuthSession, OpenJobAuth } from '../../../app/openjob-contracts';
import '../../../app/globals.css';
function Identity({ name }: { name: string }) {
  const [owner, setOwner] = useState('');
  const token = useCallback(async () => { const response = await fetch(`/__fixture/session/${name}`, { cache: 'no-store' }); if (!response.ok) throw new Error('Fixture unavailable.'); const value = await response.json() as { token: string; userId: string }; if (typeof value.token !== 'string' || !/^user_[a-f0-9]{32}$/.test(value.userId)) throw new Error('Invalid fixture.'); setOwner(value.userId); return value.token; }, [name]);
  // Resolve the explicit fixture identity before mounting its private app context.
  const [started, setStarted] = useState(false);
  if (!started) return <button onClick={() => { setStarted(true); void token().catch(() => setStarted(false)); }}>Open {name} fixture identity</button>;
  return owner ? <OwnedWorkspacesApp key={owner} ownerUserId={owner} getToken={token} /> : <p>Loading synthetic identity…</p>;
}
function Fixture() {
  const [name, setName] = useState('alex');
  return <><label>Fixture identity<select aria-label="Fixture identity" value={name} onChange={event => { window.location.hash = ''; setName(event.target.value); }}><option value="alex">Alex</option><option value="sam">Sam</option></select></label><Identity key={name} name={name} /></>;
}
let pilotName = 'alex';
let pilotListener: ((session: AuthSession | null) => void) | undefined;
function selectPilot(name: string) {
  pilotName = name;
  pilotListener?.({ signInMethod: 'google', localIdentity: { uid: `owned_fixture_${name}`, tenantId: null }, getIdToken: async () => {
    const response = await fetch(`/__fixture/session/${name}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Synthetic session unavailable.');
    return (await response.json() as { token: string }).token;
  } });
}
const pilotAuth: OpenJobAuth = {
  qaPasswordEnabled: false,
  observe(listener) { pilotListener = listener; selectPilot(pilotName); return () => { if (pilotListener === listener) pilotListener = undefined; }; },
  async signOut() { pilotListener?.(null); },
  async switchUser() { selectPilot(pilotName === 'alex' ? 'sam' : 'alex'); },
  async signIn() { selectPilot(pilotName); return null; },
  async signInWithQaPassword() { throw new Error('Not used by this fixture.'); },
  async authenticateForLink() { throw new Error('Not used by this fixture.'); },
};
function NormalPilotFixture() {
  const [name, setName] = useState('alex');
  return <><p>Synthetic signed identities · local fake Firestore · normal app and server composition · no live providers or sending.</p><label>Test identity<select aria-label="Test identity" value={name} onChange={event => { const next = event.target.value; setName(next); window.location.hash = ''; selectPilot(next); }}><option value="alex">Alex</option><option value="sam">Sam</option></select></label><PersonalWorkspaceApp auth={pilotAuth} workspaceMode={window.location.pathname === "/connections" ? "connections" : "pilot"} /></>;
}
createRoot(document.getElementById('root')!).render(['/pilot', '/connections', '/workspaces'].includes(window.location.pathname) ? <NormalPilotFixture /> : <Fixture />);
