import { createRoot } from 'react-dom/client';
import { OpenJobBrand } from '../../app/openjob-brand';
import '../../app/globals.css';

const root = createRoot(document.getElementById('root')!);
try {
  const [health, configuration] = await Promise.all([fetch('/healthz').then(r => r.json() as Promise<{ configured: boolean; missing: string[] }>), fetch('/runtime-config').then(r => r.json())]);
  Object.assign(globalThis, { __OPENJOB_SERVICE_CONFIG__: configuration });
  if (!health.configured) {
    root.render(<main style={{ padding: 24 }}><OpenJobBrand /><h1>OpenJob service setup</h1><p>This is the real-service profile. Firebase configuration is required before sign-in. No invented session is substituted.</p><ul>{health.missing.map((name: string) => <li key={name}>{name}</li>)}</ul><p>Use <code>openjob app</code> for the separate labeled local demo. Provider connections and real sending are not configured.</p></main>);
  } else {
    if (location.pathname === '/account') {
      const { default: AccountApp } = await import('./account'); root.render(<AccountApp />);
    } else {
      const { default: PersonalWorkspaceApp } = await import('../../app/workspace/personal-workspace-app');
      root.render(<><p style={{ padding: 12 }}>Authenticated prototype · external providers are unconfigured · real sending disabled.</p><PersonalWorkspaceApp workspaceMode={location.pathname.replace(/\/$/, '') === '/connections' ? 'connections' : ['/home', '/workspaces'].includes(location.pathname.replace(/\/$/, '')) ? 'pilot' : undefined} /></>);
    }
  }
} catch {
  root.render(<main style={{ padding: 24 }}><OpenJobBrand /><h1>OpenJob service unavailable</h1><p>Check the service configuration and restart. No demo login was substituted.</p></main>);
}
