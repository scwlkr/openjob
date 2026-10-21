import { createNativeConnectedWorkspaceApi } from '../src/connected-workspaces-api';

const owner = `user_${'a'.repeat(32)}`, id = `wsp_${'b'.repeat(32)}`, agentId = `agt_${'c'.repeat(32)}`;
const workspace = { workspaceId: id, ownerUserId: owner, taskSpaceId: `tsp_${'b'.repeat(32)}`, calendarId: `cal_${'b'.repeat(32)}`, name: 'Work', createdAt: '2026-10-20T00:00:00.000Z' };
const grant = { id: agentId, workspaceId: id, ownerUserId: owner, name: 'Planning helper', scopes: ['tasks:read'], resourceIds: [workspace.taskSpaceId], revoked: false, createdAt: '2026-10-20T00:00:00.000Z', expiresAt: '2026-10-21T00:00:00.000Z' };
const action = { agentId, operation: 'task.create', itemId: 'offline_00000000-0000-4000-8000-000000000001', at: '2026-10-20T12:00:00.000Z' };
const body = { agents: [grant], actions: [action] }, base = 'https://fixture.example.invalid/api/v1';
const json = (data: unknown) => new Response(JSON.stringify({ data }));
test('native owner list and revoke use exact Workspace routes and DELETE acknowledgement without credentials in public data', async () => {
  const fetcher = jest.fn().mockResolvedValueOnce(json(body)).mockResolvedValueOnce(json({ id: agentId, revoked: true }));
  const api = createNativeConnectedWorkspaceApi({ apiBaseUrl: base, fetchImplementation: fetcher });
  expect(await api.agentGrants('synthetic-human', owner, workspace)).toEqual(body);
  expect(await api.revokeAgent('synthetic-human', owner, id, agentId)).toEqual({ id: agentId, revoked: true });
  expect(fetcher.mock.calls[0]![0]).toBe(`${base}/workspaces/${id}/agent-grants`);
  expect(fetcher.mock.calls[1]![0]).toBe(`${base}/workspaces/${id}/agent-grants/${agentId}`);
  expect(fetcher.mock.calls[1]![1]).toMatchObject({ method: 'DELETE', cache: 'no-store', redirect: 'error', headers: { authorization: 'Bearer synthetic-human' } });
  expect(fetcher.mock.calls[1]![1].body).toBeUndefined();
});
test('native list rejects foreign owner/resource, private credential fields, duplicate grants and malformed actions', async () => {
  const bad = [
    { ...body, extra: 'private' }, { ...body, agents: [...body.agents, grant] }, { ...body, actions: Array(201).fill(action) },
    ...[{ workspaceId: `wsp_${'d'.repeat(32)}` }, { ownerUserId: `user_${'d'.repeat(32)}` }, { tokenHash: 'private' }, { token: 'private' }, { scopes: ['mail:read'] }, { resourceIds: [workspace.calendarId] }].map(change => ({ ...body, agents: [{ ...grant, ...change }] })),
    ...[{ token: 'private' }, { itemId: 'foreign' }, { operation: 'mail.send' }].map(change => ({ ...body, actions: [{ ...action, ...change }] })),
  ];
  for (const value of bad) {
    const api = createNativeConnectedWorkspaceApi({ apiBaseUrl: base, fetchImplementation: jest.fn(async () => json(value)) });
    await expect(api.agentGrants('fixture', owner, workspace)).rejects.toMatchObject({ status: 502, code: 'invalid_response' });
  }
});
test('native revoke rejects invalid targets before transport, uncertain or unexpected acknowledgements, and never retries', async () => {
  const transport = jest.fn(); const api = createNativeConnectedWorkspaceApi({ apiBaseUrl: base, fetchImplementation: transport });
  await expect(api.revokeAgent('fixture', owner, id, 'foreign')).rejects.toMatchObject({ status: 400 });
  await expect(api.revokeAgent('fixture', owner, 'foreign', agentId)).rejects.toMatchObject({ status: 400 });
  await expect(api.agentGrants('fixture', `user_${'e'.repeat(32)}`, workspace)).rejects.toMatchObject({ status: 400 }); expect(transport).not.toHaveBeenCalled();
  for (const value of [{ id: `agt_${'e'.repeat(32)}`, revoked: true }, { id: agentId, revoked: false }, { id: agentId, revoked: true, token: 'private' }]) {
    const fetcher = jest.fn(async () => json(value)), client = createNativeConnectedWorkspaceApi({ apiBaseUrl: base, fetchImplementation: fetcher });
    await expect(client.revokeAgent('fixture', owner, id, agentId)).rejects.toMatchObject({ code: 'invalid_response' }); expect(fetcher).toHaveBeenCalledTimes(1);
  }
  const failed = jest.fn(async () => new Response(JSON.stringify({ error: { code: 'forbidden', message: 'PRIVATE_DETAILS' } }), { status: 403 }));
  await expect(createNativeConnectedWorkspaceApi({ apiBaseUrl: base, fetchImplementation: failed }).revokeAgent('fixture', owner, id, agentId)).rejects.toMatchObject({ status: 403, code: 'forbidden', message: 'Workspace request unavailable. Refresh before retrying.' }); expect(failed).toHaveBeenCalledTimes(1);
});
