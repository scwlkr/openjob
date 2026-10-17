import assert from 'node:assert/strict';
import { createOpenApiResponseValidator } from './openapi-response.mjs';
import { onboardingFixture } from './onboarding-app-fixture.mjs';
import { fixture as protocolFixture, CLIENT, BINDING } from './google-oauth-transport.mjs';
import { createGoogleConnectionsFlow } from '../../server/connections/google-flow.ts';
import { createConnectionsApi } from '../../server/connections/api.ts';

export const CALLBACK = 'https://chosen-host.example.invalid/connections/google/callback';
export async function googleFlowFixture(options = {}) {
  const validate = await createOpenApiResponseValidator();
  const original = await onboardingFixture(), protocol = protocolFixture(), envelopes = new Map(), hooks = {};
  let fault = false;
  // A private atomic backing fixture, shared by independently reconstructed flows.
  // It persists across instances in this test only; no live vault is provisioned.
  const repository = {
    async read(owner) { return structuredClone(envelopes.get(owner) ?? []); },
    async change(owner, apply) {
      if (fault) throw new Error('Private store unavailable');
      const next = apply(structuredClone(envelopes.get(owner) ?? []));
      envelopes.set(owner, structuredClone(next)); return structuredClone(next);
    },
  };
  const flowOptions = { executionMode: 'configured', evidenceMode: 'google-fixture', repository, homes: original.owned, isOwnerActive: async owner => { try { await original.owned.list(owner); return true; } catch { return false; } }, google: { clientId: CLIENT, clientSecret: 'invented_client_secret', callbackUri: CALLBACK, transport: protocol.transport }, mailTransport: async (input, init) => {
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error'); const url = new URL(input); assert.equal(url.origin, 'https://gmail.googleapis.com');
    if (hooks.mail) await hooks.mail(url);
    if (url.pathname.endsWith('/profile')) return Response.json({ emailAddress: BINDING.address });
    if (url.pathname.endsWith('/labels')) return Response.json({ labels: [{ id: 'INBOX', name: 'Inbox' }] });
    if (url.pathname.endsWith('/messages')) return Response.json({ messages: [{ id: 'm1', threadId: 't1' }] });
    return Response.json({ id: 'm1', threadId: 't1', internalDate: String(Date.now()), labelIds: ['INBOX'], payload: { mimeType: 'text/plain', body: { data: Buffer.from('Invented connected message.').toString('base64url') } } });
  }, ...options };
  let flow, api;
  function reconstruct(overrides = {}) { flow = createGoogleConnectionsFlow({ ...flowOptions, ...overrides }); api = createConnectionsApi({ users: original.users, verifyIdToken: original.verifyIdToken, google: flow }); return { flow, api }; }
  reconstruct();
  const request = (path = '', input, name = 'alex', target = api, extra = {}) => target.fetch(new Request('https://fixture.invalid/api/v1/connections' + path, { method: input === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${original.sessions[name]?.token ?? name}`, ...(input === undefined ? {} : { 'content-type': 'application/json' }), ...extra }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) }));
  const call = async (...args) => { const response = await request(...args); assert.equal(response.status, 200, await response.clone().text()); const path = args[0] ?? ''; await validate(response.clone(), path === '/google/callback' ? '/api/v1/connections/google/callback' : path.endsWith('/mail') ? '/api/v1/connections/{connectionId}/mail' : path ? '/api/v1/connections/{connectionId}' : '/api/v1/connections', args[1] === undefined ? 'get' : 'post'); return (await response.json()).data; };
  async function begin() { const result = await call('', { address: BINDING.address, workspaceId: original.home }); const url = new URL(result.authorizationUrl); protocol.hooks.claims = { nonce: url.searchParams.get('nonce') }; return { ...result, state: url.searchParams.get('state') }; }
  const complete = start => call('/google/callback', { state: start.state, code: 'invented_single_use_code', callbackUri: CALLBACK });
  return { ...original, protocol, envelopes, repository, hooks, flowOptions, reconstruct, request, call, begin, complete, failStore(value) { fault = value; }, get flow() { return flow; }, get googleApi() { return api; } };
}
