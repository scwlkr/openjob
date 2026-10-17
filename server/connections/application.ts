import type { ConnectionOnboardingStore } from '../../db/connection-onboarding.ts';
import { connectionFail, type ConnectionBinding, type ConnectionCatalog, type ConnectionChoice } from '../../shared/connection-onboarding.ts';
import type { ProviderMessagePage } from '../../shared/provider-contracts.ts';
export type SimulatedConsentAdapter = {
  begin(owner: string, choice: ConnectionChoice, attemptId: string): Promise<string>;
  finish(owner: string, handoff: string): Promise<{ accountId: string; subject: string; address: string }>;
  cancel(owner: string, handoff: string): Promise<void>;
  disable(owner: string, attemptId: string): Promise<void>;
  read(owner: string, accountId: string): Promise<ProviderMessagePage>;
};
type Homes = { list(owner: string): Promise<{ workspaceId: string; name: string }[]> };
export function createConnectionsApplication({ store, homes, consent, choices }: { store: ConnectionOnboardingStore; homes: Homes; consent: SimulatedConsentAdapter; choices: ConnectionChoice[] }) {
  const available = structuredClone(choices);
  const uuid = () => crypto.randomUUID().replaceAll('-', '');
  async function home(owner: string, id: string) { if (!(await homes.list(owner)).some(item => item.workspaceId === id)) connectionFail('forbidden'); }
  async function binding(owner: string, id: string) { const row = (await store.read(owner)).find(item => item.id === id); if (!row) connectionFail('forbidden'); return row; }
  async function replace(owner: string, expected: ConnectionBinding, next: ConnectionBinding) {
    await store.change(owner, rows => { const current = rows.find(row => row.id === expected.id); if (JSON.stringify(current) !== JSON.stringify(expected)) connectionFail('conflict'); return rows.map(row => row.id === expected.id ? next : row); });
  }
  async function clean(owner: string, row: ConnectionBinding, status: 'cancelled' | 'disconnected') {
    const pending = { ...row, status: 'cleanup_pending' as const }; await replace(owner, row, pending);
    try {
      // Disable must fence future completion even when cancellation/cleanup fails.
      await consent.disable(owner, row.attemptId);
      if (row.handoff) await consent.cancel(owner, row.handoff);
      const next = { ...pending, status }; delete next.handoff;
      await replace(owner, pending, next);
    } catch { /* Durable cleanup_pending remains readable and explicitly retryable. */ }
  }
  return {
    async catalog(owner: string): Promise<ConnectionCatalog> {
      const rows = await store.read(owner), currentHomes = await homes.list(owner);
      return { mode: 'simulated', providers: [{ id: 'gmail', available: true, reason: 'Simulated consent and Mail read only' }, { id: 'outlook', available: false, reason: 'Authorization flow not implemented' }, { id: 'imap', available: false, reason: 'WLK302 source recovery pending' }], choices: available.map(choice => ({ id: choice.id, label: choice.label, provider: choice.provider })), homes: currentHomes.map(item => ({ workspaceId: item.workspaceId, name: item.name })), bindings: rows.map(row => ({ id: row.id, workspaceId: row.workspaceId, choiceId: row.choiceId, provider: row.provider, status: row.status, ...(row.address ? { address: row.address } : {}) })) };
    },
    async begin(owner: string, choiceId: string, workspaceId: string) {
      const choice = available.find(item => item.id === choiceId); if (!choice) connectionFail(); await home(owner, workspaceId);
      const existing = (await store.read(owner)).find(row => row.choiceId === choiceId);
      if (existing && !['cancelled', 'disconnected', 'reconnect_required'].includes(existing.status)) connectionFail('conflict');
      // Reconnect preserves the original home and stable upstream identity.
      if (existing && (existing.workspaceId !== workspaceId || existing.subject && existing.subject !== choice.subject)) connectionFail('forbidden');
      if (existing) await consent.disable(owner, existing.attemptId);
      const row: ConnectionBinding = { id: existing?.id ?? `con_${uuid()}`, ownerId: owner, workspaceId, choiceId, provider: 'gmail', status: 'authorizing', attemptId: uuid(), ...(existing?.subject ? { subject: existing.subject } : {}) };
      if (existing) await replace(owner, existing, row);
      else await store.change(owner, rows => { if (rows.some(item => item.choiceId === choiceId)) connectionFail('conflict'); return [...rows, row]; });
      try {
        const handoff = await consent.begin(owner, choice, row.attemptId); await home(owner, workspaceId);
        await replace(owner, row, { ...row, handoff, status: 'consent_required' });
      } catch {
        const current = await binding(owner, row.id);
        if (current.attemptId === row.attemptId) await clean(owner, current, 'cancelled');
        else await consent.disable(owner, row.attemptId);
        connectionFail('consent_failed');
      }
      return row.id;
    },
    async approve(owner: string, id: string) {
      const row = await binding(owner, id); if (row.status !== 'consent_required' || !row.handoff) connectionFail('conflict'); await home(owner, row.workspaceId);
      const claimed = { ...row, status: 'authorizing' as const }; await replace(owner, row, claimed);
      try {
        const verified = await consent.finish(owner, row.handoff), choice = available.find(item => item.id === row.choiceId)!;
        if (verified.subject !== choice.subject || row.subject && row.subject !== verified.subject) connectionFail('identity_mismatch');
        await home(owner, row.workspaceId);
        const next = { ...claimed, ...verified, status: 'connected' as const }; delete next.handoff;
        await replace(owner, claimed, next);
      } catch {
        const current = await binding(owner, row.id);
        if (current.attemptId === row.attemptId && !['cancelled', 'disconnected', 'cleanup_pending'].includes(current.status)) await clean(owner, current, 'disconnected');
        else await consent.disable(owner, row.attemptId);
        connectionFail('consent_failed');
      }
    },
    async cancel(owner: string, id: string) { const row = await binding(owner, id); if (!['consent_required', 'authorizing'].includes(row.status)) connectionFail('conflict'); await clean(owner, row, 'cancelled'); },
    async disconnect(owner: string, id: string) { await clean(owner, await binding(owner, id), 'disconnected'); },
    async retryCleanup(owner: string, id: string) { const row = await binding(owner, id); if (row.status !== 'cleanup_pending') connectionFail('conflict'); await clean(owner, row, 'disconnected'); },
    async mail(owner: string, id: string) {
      const row = await binding(owner, id); if (row.status !== 'connected' || !row.accountId) connectionFail('reconnect_required'); await home(owner, row.workspaceId);
      let page: ProviderMessagePage;
      try { page = await consent.read(owner, row.accountId); }
      catch { await replace(owner, row, { ...row, status: 'reconnect_required' }); return connectionFail('reconnect_required'); }
      await home(owner, row.workspaceId);
      if (JSON.stringify(await binding(owner, id)) !== JSON.stringify(row)) connectionFail('conflict');
      return { mode: 'simulated', workspaceId: row.workspaceId, page };
    },
  };
}
export type ConnectionsApplication = ReturnType<typeof createConnectionsApplication>;
