import type { ProviderAccount, ProviderPreview } from "../shared/provider-contracts.ts";
import { createProviderPreview } from "../shared/provider-preview.ts";
import type { ProviderConnectionReader } from "./providers/provider-connections.ts";

const capabilities = ["mailRead", "calendarRead", "draft", "send", "calendarWrite", "reconnect"] as const;
function fail(): never { throw Object.assign(new Error("Invalid provider connection metadata"), { code: "invalid_state" }); }
function publicMockAccount(account: ProviderAccount): ProviderAccount {
  if (account.mode !== "mock" || !/^[A-Za-z0-9_-]{1,128}$/.test(account.id)) fail();
  return {
    id: account.id, upstreamId: account.upstreamId, provider: account.provider,
    label: account.label, address: account.address, mode: "mock", status: account.status,
    statusReason: account.statusReason,
    capabilities: Object.fromEntries(capabilities.map(key => [key, {
      available: account.capabilities[key].available, reason: account.capabilities[key].reason,
    }])) as ProviderAccount["capabilities"],
    sync: { state: account.sync.state, asOf: account.sync.asOf, reason: account.sync.reason },
  };
}

/** Production has no injected connections. Mock transport is explicit, server-owned test wiring. */
export function createProviderWorkspacePreview({ connections }: { connections?: ProviderConnectionReader } = {}) {
  return async (ownerId: string, input: { accountId?: string; cursor?: string } = {}): Promise<ProviderPreview> => {
    const owned = (await connections?.listAccounts(ownerId) ?? []).map(publicMockAccount);
    const selected = owned.find(account => account.id === input.accountId);
    const base = await createProviderPreview({ ownerId, ...(selected ? {} : input) });
    const ids = new Set(base.accounts.map(account => account.id));
    for (const account of owned) { if (ids.has(account.id)) fail(); ids.add(account.id); }
    const accounts = [...base.accounts, ...owned];
    if (!selected) return { ...base, accounts };
    if (selected.status !== "ready" || !selected.capabilities.mailRead.available) {
      if (input.cursor) throw Object.assign(new Error("Blocked provider connections have no message pages"), { code: "invalid_cursor" });
      return { ...base, mode: "mock", accounts, selectedAccountId: selected.id,
        messages: [], folders: [], calendars: [], events: [], nextCursor: null, syncCursor: null };
    }
    const page = await connections!.listMessages({ ownerId, accountId: selected.id, cursor: input.cursor });
    return { ...base, ...page, mode: "mock", accounts, selectedAccountId: selected.id };
  };
}
