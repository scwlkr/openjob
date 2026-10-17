import { createRoot } from 'react-dom/client';
import { useCallback, useState } from 'react';
import OwnedWorkspacesApp from '../../../app/owned-workspaces/owned-workspaces-app';
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
createRoot(document.getElementById('root')!).render(<Fixture />);
