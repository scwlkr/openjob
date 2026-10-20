import assert from 'node:assert/strict';
import { createFakeFirestore, createPrivateKey } from './fake-firestore.mjs';
import { createTestFirebaseAuthority } from './firebase-id-tokens.mjs';
import { createFirestoreUserStore } from '../../db/users.ts';
import { createOwnedWorkspaceStore } from '../../db/owned-workspaces.ts';
import { createConnectionOnboardingStore } from '../../db/connection-onboarding.ts';
import { createConnectionsApplication } from '../../server/connections/application.ts';
import { createConnectionsApi } from '../../server/connections/api.ts';
import { createConsentFixture, fixtureChoices } from './connection-onboarding-fixture.mjs';
import { createFirebaseIdTokenVerifier } from '../../server/firebase-id-token.ts';
export async function onboardingFixture({ projectId = 'openjob-dev' } = {}) {
  const db = createFakeFirestore({ projectId }), config = { projectId, clientEmail: 'fixture@example.invalid', privateKey: await createPrivateKey() };
  const now = new Date().toISOString(), authority = await createTestFirebaseAuthority({ now, projectId });
  const verifyIdToken = createFirebaseIdTokenVerifier({ projectId: config.projectId, fetchImplementation: authority.fetch, now: () => Date.parse(now) });
  const users = createFirestoreUserStore(config, db.fetch), owned = createOwnedWorkspaceStore(config, db.fetch), sessions = {};
  for (const name of ['alex', 'sam']) { const token = await authority.issue({ uid: name }); const identity = await verifyIdToken(new Request('https://fixture.invalid', { headers: { authorization: `Bearer ${token}` } })); sessions[name] = { token, user: (await users.create(identity)).user }; }
  const owner = sessions.alex.user.userId, home = (await owned.create(owner, 'Work')).workspace.workspaceId;
  const consent = createConsentFixture({ config, isOwnerActive: async id => { await owned.list(id); return true; } });
  const store = createConnectionOnboardingStore(config, db.fetch), application = createConnectionsApplication({ store, homes: owned, consent: consent.adapter, choices: fixtureChoices });
  const api = createConnectionsApi({ users, verifyIdToken, onboarding: application });
  const request = (path = '', input, name = 'alex', target = api) => target.fetch(new Request('https://fixture.invalid/api/v1/connections' + path, { method: input === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${sessions[name]?.token ?? name}`, ...(input === undefined ? {} : { 'content-type': 'application/json' }) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) }));
  const call = async (...args) => { const r = await request(...args); assert.equal(r.status, 200, await r.clone().text()); return (await r.json()).data; };
  return { config, db, users, owned, sessions, owner, home, consent, store, application, api, verifyIdToken, identityTransport: authority.fetch, request, call };
}
