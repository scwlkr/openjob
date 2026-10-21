import type { GoogleConnectionCatalog } from './google-connection-catalog';
type ScopedCatalog = Pick<GoogleConnectionCatalog, 'mode' | 'mailAvailable' | 'bindings'>;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const workspace = (value: unknown) => typeof value === 'string' && /^wsp_[a-f0-9]{32}$/.test(value);
/** Select display metadata only. The Connections API still authorizes every read/write. */
export function workspaceMailCatalog(value: unknown, workspaceId: string): ScopedCatalog | undefined {
  if (!workspace(workspaceId) || !object(value)) throw new Error('Mail connections unavailable.');
  if (value.mode === 'simulated') return undefined;
  if (!['google', 'google-fixture'].includes(value.mode as string) || Object.keys(value).sort().join(',') !== 'bindings,homes,mailAvailable,mode' || typeof value.mailAvailable !== 'boolean' || !Array.isArray(value.homes) || value.homes.length > 51 || !Array.isArray(value.bindings) || value.bindings.length > 50) throw new Error('Mail connections unavailable.');
  if (value.homes.some(row => !object(row) || Object.keys(row).sort().join(',') !== 'name,workspaceId' || !workspace(row.workspaceId) || typeof row.name !== 'string') || !value.homes.some(row => row.workspaceId === workspaceId)) throw new Error('Mail home unavailable.');
  const ids = new Set();
  for (const row of value.bindings) {
    if (!object(row) || Object.keys(row).sort().join(',') !== (row.operation === undefined ? 'address,expired,id,status,workspaceId' : 'address,expired,id,operation,status,workspaceId') || typeof row.id !== 'string' || !/^con_[a-f0-9]{32}$/.test(row.id) || ids.has(row.id) || !workspace(row.workspaceId) || typeof row.address !== 'string' || row.address.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.address) || typeof row.expired !== 'boolean' || !['authorizing', 'consent_required', 'connected', 'cancelled', 'reconnect_required', 'cleanup_pending', 'disconnected'].includes(row.status as string) || row.operation !== undefined && !['exchange', 'refresh'].includes(row.operation as string)) throw new Error('Mail connections unavailable.');
    ids.add(row.id);
  }
  return { mode: value.mode as GoogleConnectionCatalog['mode'], mailAvailable: value.mailAvailable, bindings: structuredClone(value.bindings.filter(row => row.workspaceId === workspaceId)) as GoogleConnectionCatalog['bindings'] };
}
