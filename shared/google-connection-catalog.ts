import type { ConnectionStatus } from './connection-onboarding';
/** Public connection status only; no provider grants or credentials. */
export type GoogleConnectionCatalog = {
  mode: 'google' | 'google-fixture';
  homes: { workspaceId: string; name: string }[];
  bindings: { id: string; workspaceId: string; address: string; status: ConnectionStatus; operation?: 'exchange' | 'refresh'; expired: boolean }[];
  mailAvailable: boolean;
};
