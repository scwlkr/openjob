import assert from 'node:assert/strict';
import { onboardingFixture } from './onboarding-app-fixture.mjs';
import { createOwnedWorkspaceStore } from '../../db/owned-workspaces.ts';
import { createWorkspaceContextStore } from '../../server/workspace-context-store.ts';
import { createFirestorePersonalWorkspaceStore } from '../../db/personal-workspace.ts';
import { createPersonalWorkspaceContextStore } from '../../db/personal-workspace-context.ts';
import { createWorkspacePilotApplication } from '../../server/workspace-pilot-application.ts';
export async function workspaceAgentFixture() {
  const f = await onboardingFixture(); let now = Date.now();
  const store = createOwnedWorkspaceStore(f.config, f.db.fetch, { now: () => now });
  const contexts = createPersonalWorkspaceContextStore(f.config, f.db.fetch), personal = createFirestorePersonalWorkspaceStore(f.config, f.db.fetch);
  const homes = createWorkspaceContextStore({ owned: store, contexts, personal });
  const options = { store: homes, users: f.users, verifyIdToken: f.verifyIdToken, admission: { userId: f.owner, provider: 'google', firebaseUid: 'alex' } };
  const api = createWorkspacePilotApplication(options);
  const request = (path = '', { token = f.sessions.alex.token, input, method = input === undefined ? 'GET' : 'POST', origin, target = api } = {}) => target.fetch(new Request(`https://fixture.invalid/api/v1/workspaces${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(input === undefined ? {} : { 'content-type': 'application/json' }), ...(origin ? { origin } : {}) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) }));
  const call = async (path, opts, status = 200) => { const response = await request(path, opts); assert.equal(response.status, status, await response.clone().text()); assert.equal(response.headers.get('cache-control'), 'no-store'); return (await response.json()).data; };
  const snapshot = await store.snapshot(f.owner, f.home), workspace = snapshot.workspace;
  const grant = (scopes, resourceIds, name = 'Bounded external agent', id = f.home) => call(`/${id}/agent-grants`, { input: { name, scopes, resourceIds } }, 201);
  return { ...f, connectionsApi: f.api, store, homes, options, api, request, call, workspace, grant, advance(ms) { now += ms; } };
}
