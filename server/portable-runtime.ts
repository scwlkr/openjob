import { createFirestorePersonalWorkspaceStore } from '../db/personal-workspace.ts';
import { createFirestoreUserStore } from '../db/users.ts';
import { createFirestoreGroupStore } from '../db/groups.ts';
import { createFirebaseIdTokenVerifier } from './firebase-id-token.ts';
import { createV1IdentityApi } from './v1-identity.ts';
import { createWorkspacePilotRuntime } from './workspace-pilot-runtime.ts';
import { createPersonalApplication } from './personal-application.ts';
import { createGoogleConnectionsRuntime, type PortableGoogleConfiguration } from './connections/google-runtime.ts';
import { createOwnedWorkspaceStore } from '../db/owned-workspaces.ts';
import { createPersonalWorkspaceContextStore } from '../db/personal-workspace-context.ts';
import { createWorkspaceContextStore } from './workspace-context-store.ts';

type Config = { projectId: string; apiKey: string; clientEmail: string; privateKey: string };

type Options = {
  databaseTransport?: typeof fetch; identityTransport?: typeof fetch;
  google?: PortableGoogleConfiguration;
  googleTransport?: typeof fetch; mailTransport?: typeof fetch;
  evidenceMode?: 'google' | 'google-fixture';
};
export function createPortableRuntime(config: Config, options: Options = {}) {
  const databaseTransport = options.databaseTransport ?? fetch;
  const users = createFirestoreUserStore(config, databaseTransport);
  const groups = createFirestoreGroupStore(config, databaseTransport);
  const workspace = createFirestorePersonalWorkspaceStore(config, databaseTransport);
  const verifyIdToken = createFirebaseIdTokenVerifier({ projectId: config.projectId, fetchImplementation: options.identityTransport ?? fetch });
  const identity = createV1IdentityApi({ groups, users, verifyIdToken, verifyCredentialToken: verifyIdToken.verifyToken });
  // No provider fallback: callers explicitly supply both transports and private inputs.
  if (options.google && (!options.googleTransport || !options.mailTransport)) throw new Error('Explicit Google transports are required.');
  const google = options.google ? createGoogleConnectionsRuntime({ configuration: options.google, firebase: config, databaseTransport, googleTransport: options.googleTransport!, mailTransport: options.mailTransport!, evidenceMode: options.evidenceMode, homes: createWorkspaceContextStore({ owned: createOwnedWorkspaceStore(config, databaseTransport), personal: workspace, contexts: createPersonalWorkspaceContextStore(config, databaseTransport) }) }) : undefined;
  // Explicit Google pilot selection admits only that same binding to existing
  // owner-only Task/Calendar setup. Personal mapping still requires its POST action.
  const workspacePilot = createWorkspacePilotRuntime({ config, personal: workspace, users, verifyIdToken, transport: databaseTransport, admission: google?.admission });
  const application = createPersonalApplication({ workspace, users, verifyIdToken, google: google?.flow, googleAdmission: google?.admission });
  return {
    // Internal capability only; portable service has no deletion-worker HTTP route.
    privateGoogleCleanup: google?.cleanup,
    fetch(request: Request) {
      const path = new URL(request.url).pathname;
      if (path === '/api/v1/workspaces' || path.startsWith('/api/v1/workspaces/')) return workspacePilot.fetch(request);
      if (path === '/api/v1/me' || path.startsWith('/api/v1/me/')) return identity.fetch(request);
      if (path.startsWith('/api/v1/workspace/agent-grants')) return application.personalAgentGrantsApi.fetch(request);
      if (path === '/api/v1/connections' || path.startsWith('/api/v1/connections/')) return application.connectionsApi.fetch(request);
      if (path === '/api/v1/workspace/provider-preview') return application.providerPreviewApi.fetch(request);
      if (path.startsWith('/api/v1/workspace/')) return application.personalWorkspaceApi.fetch(request);
      return Promise.resolve(new Response(JSON.stringify({ error: { code: 'not_found' } }), { status: 404, headers: { 'content-type': 'application/json' } }));
    },
  };
}
