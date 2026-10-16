import { NativeAuthCoordinator, OpenJobApiError, type NativeAuthDependencies } from '../src/auth/coordinator';
const owner = 'user_alex';
const session = { provider: 'google' as const, idToken: 'private-token', refreshToken: 'private-refresh', expiresAt: 999999999 };
const snapshot = { accounts: [], messages: [], tasks: [], calendars: [], events: [], drafts: [], sent: [], agents: [], activity: [] };
function fixture(personal = true) {
  let userId = owner;
  const dependencies = {
    signInWithProvider: jest.fn(async () => ({ provider: 'google', idToken: 'proof' })), exchangeProviderCredential: jest.fn(async () => session), getMe: jest.fn(async () => ({ userId, username: 'alex', usernameRequired: false })), listSignInMethods: jest.fn(async () => ['google']),
    saveStoredSession: jest.fn(async () => undefined), loadStoredSession: jest.fn(async () => ({ version: 2, ownerUserId: userId, provider: 'google', refreshToken: 'refresh' })), refreshSession: jest.fn(async () => session),
    loadLocalTaskListCache: jest.fn(async () => ({ ownerUserId: owner, group: { groupId: "g", name: "Group", role: "member", createdAt: "2026-10-17T00:00:00.000Z" }, snapshot: { tasks: [], members: [] }, status: "open", validator: "fixture", freshAt: "2026-10-17T00:00:00.000Z" })),
    loadDeletionReceipt: jest.fn(async () => null), loadCleanupPending: jest.fn(async () => false), clearStoredSession: jest.fn(async () => undefined), clearProviderSession: jest.fn(async () => undefined), purgeLocalDomainCache: jest.fn(async () => undefined), markCleanupPending: jest.fn(async () => undefined), clearCleanupPending: jest.fn(async () => undefined), clearDeletionReceipt: jest.fn(async () => undefined), now: () => 1000,
    ...(personal ? { readPersonalWorkspace: jest.fn(async () => snapshot), commandPersonalWorkspace: jest.fn(async () => undefined), listPersonalAgents: jest.fn(async () => []), revokePersonalAgent: jest.fn(async () => undefined) } : {}),
  };
  return { coordinator: new NativeAuthCoordinator(dependencies as unknown as NativeAuthDependencies), dependencies, setOwner: (id: string) => { userId = id; } };
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
test('optional stable token-free facade routes all operations through active session', async () => {
  expect(fixture(false).coordinator.getPersonalWorkspaceController()).toBeUndefined(); const f = fixture(); const api = f.coordinator.getPersonalWorkspaceController()!;
  expect(api).toBe(f.coordinator.getPersonalWorkspaceController()); expect(Object.keys(api).length).toBe(4); expect(JSON.stringify(api)).not.toContain('token'); await expect(api.readPersonalWorkspace(owner)).rejects.toMatchObject({ code: 'revoked' });
  await f.coordinator.signIn('google'); await expect(api.readPersonalWorkspace(owner)).resolves.toBe(snapshot); await api.commandPersonalWorkspace(owner, { type: 'task.create', title: 'Plan' }); await api.listPersonalAgents(owner); await api.revokePersonalAgent(owner, 'fixture-agent');
  expect(f.dependencies.readPersonalWorkspace).toHaveBeenCalledWith(session.idToken, owner); expect(f.dependencies.commandPersonalWorkspace).toHaveBeenCalledWith(session.idToken, { type: 'task.create', title: 'Plan' }); expect(f.dependencies.listPersonalAgents).toHaveBeenCalledWith(session.idToken, owner); expect(f.dependencies.revokePersonalAgent).toHaveBeenCalledWith(session.idToken, 'fixture-agent');
});
test('previous owner cannot act through facade after replacement sign-in', async () => {
  const f = fixture(); await f.coordinator.signIn('google'); const api = f.coordinator.getPersonalWorkspaceController()!; await f.coordinator.signOut(); f.setOwner('user_sam'); await f.coordinator.signIn('google');
  for (const action of [() => api.readPersonalWorkspace(owner), () => api.commandPersonalWorkspace(owner, { type: 'mail.examples.add' }), () => api.listPersonalAgents(owner), () => api.revokePersonalAgent(owner, 'agent')]) await expect(action()).rejects.toMatchObject({ code: 'revoked' });
  expect(f.dependencies.commandPersonalWorkspace).not.toHaveBeenCalled(); await expect(api.readPersonalWorkspace('user_sam')).resolves.toBe(snapshot);
});
test('late old-identity read or 401 cannot affect replacement session', async () => {
  for (const failure of [false, true]) {
    const f = fixture(); await f.coordinator.signIn('google'); const api = f.coordinator.getPersonalWorkspaceController()!; const pending = deferred<typeof snapshot>(); f.dependencies.readPersonalWorkspace!.mockImplementationOnce(() => pending.promise);
    const reading = api.readPersonalWorkspace(owner); await Promise.resolve(); await Promise.resolve(); await f.coordinator.signOut(); f.setOwner('user_sam'); await f.coordinator.signIn('google');
    if (failure) pending.reject(new OpenJobApiError(401, 'authentication_required', 'Fixture')); else pending.resolve(snapshot);
    await expect(reading).rejects.toMatchObject({ code: 'revoked' }); await expect(api.readPersonalWorkspace('user_sam')).resolves.toBe(snapshot);
  }
});
test('provisional cached identity cannot read or write personal data', async () => {
  const f = fixture(); await expect(f.coordinator.restoreCachedSession()).resolves.toMatchObject({ provisional: true }); const api = f.coordinator.getPersonalWorkspaceController()!;
  await expect(api.readPersonalWorkspace(owner)).rejects.toMatchObject({ code: 'revoked' }); await expect(api.commandPersonalWorkspace(owner, { type: 'mail.examples.add' })).rejects.toMatchObject({ code: 'revoked' }); expect(f.dependencies.readPersonalWorkspace).not.toHaveBeenCalled(); expect(f.dependencies.commandPersonalWorkspace).not.toHaveBeenCalled();
});
test('wrong token identity blocks dispatch and delayed identity checks cannot act on replacement user', async () => {
  const f = fixture(); await f.coordinator.signIn('google'); const api = f.coordinator.getPersonalWorkspaceController()!;
  f.dependencies.getMe.mockResolvedValueOnce({ userId: 'user_wrong', username: 'wrong', usernameRequired: false });
  await expect(api.commandPersonalWorkspace(owner, { type: 'mail.examples.add' })).rejects.toMatchObject({ code: 'revoked' }); expect(f.dependencies.commandPersonalWorkspace).not.toHaveBeenCalled();
  const pending = deferred<{ userId: string; username: string; usernameRequired: boolean }>(); f.dependencies.getMe.mockImplementationOnce(() => pending.promise);
  const writing = api.commandPersonalWorkspace(owner, { type: 'mail.examples.add' }); await Promise.resolve(); await Promise.resolve();
  await f.coordinator.signOut(); f.setOwner('user_sam'); await f.coordinator.signIn('google'); pending.resolve({ userId: owner, username: 'alex', usernameRequired: false });
  await expect(writing).rejects.toMatchObject({ code: 'revoked' }); expect(f.dependencies.commandPersonalWorkspace).not.toHaveBeenCalled(); await expect(api.readPersonalWorkspace('user_sam')).resolves.toBe(snapshot);
});
test('a refreshed token belonging to another identity never reaches the personal command endpoint', async () => {
  const f = fixture(); await f.coordinator.signIn('google');
  f.dependencies.now = () => session.expiresAt;
  f.dependencies.refreshSession.mockResolvedValueOnce({ ...session, idToken: 'foreign-refreshed-token', expiresAt: session.expiresAt + 600000 });
  f.dependencies.getMe.mockResolvedValueOnce({ userId: 'user_wrong', username: 'wrong', usernameRequired: false });
  await expect(f.coordinator.getPersonalWorkspaceController()!.commandPersonalWorkspace(owner, { type: 'task.create', title: 'Must not dispatch' })).rejects.toMatchObject({ code: 'revoked' });
  expect(f.dependencies.refreshSession).toHaveBeenCalledTimes(1); expect(f.dependencies.getMe).toHaveBeenLastCalledWith('foreign-refreshed-token'); expect(f.dependencies.commandPersonalWorkspace).not.toHaveBeenCalled();
});
