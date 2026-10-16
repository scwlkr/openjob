import { createFirestorePersonalWorkspaceStore } from '../db/personal-workspace.ts';
import { createFirestoreUserStore } from '../db/users.ts';
import { createFirestoreGroupStore } from '../db/groups.ts';
import { createFirebaseIdTokenVerifier } from './firebase-id-token.ts';
import { createV1IdentityApi } from './v1-identity.ts';
import { createPersonalApplication } from './personal-application.ts';

type Config = { projectId: string; apiKey: string; clientEmail: string; privateKey: string };

export function createPortableRuntime(config: Config) {
  const users = createFirestoreUserStore(config);
  const groups = createFirestoreGroupStore(config);
  const workspace = createFirestorePersonalWorkspaceStore(config);
  const verifyIdToken = createFirebaseIdTokenVerifier({ projectId: config.projectId });
  const identity = createV1IdentityApi({ groups, users, verifyIdToken, verifyCredentialToken: verifyIdToken.verifyToken });
  const application = createPersonalApplication({ workspace, users, verifyIdToken });
  return {
    fetch(request: Request) {
      const path = new URL(request.url).pathname;
      if (path === '/api/v1/me' || path.startsWith('/api/v1/me/')) return identity.fetch(request);
      if (path.startsWith('/api/v1/workspace/agent-grants')) return application.personalAgentGrantsApi.fetch(request);
      if (path === '/api/v1/workspace/provider-preview') return application.providerPreviewApi.fetch(request);
      if (path.startsWith('/api/v1/workspace/')) return application.personalWorkspaceApi.fetch(request);
      return Promise.resolve(new Response(JSON.stringify({ error: { code: 'not_found' } }), { status: 404, headers: { 'content-type': 'application/json' } }));
    },
  };
}
