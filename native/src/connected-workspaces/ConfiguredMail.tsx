import { useCallback, useEffect, useRef, useState } from 'react';
import type { GoogleConnectionCatalog, NativeConnectedWorkspaceController } from '../connected-workspaces-contracts';
import { Action, Block, Copy } from '../personal-workspace/controls';
import { MailReader } from './MailReader';
import type { NativeMailIntents } from './mail-task-intents';

type Props = { controller: NativeConnectedWorkspaceController; owner: string; workspaceId: string; intents: NativeMailIntents; onTask(taskId: string): Promise<void>; onAccessEnded(error: unknown): void };
export function ConfiguredMail(props: Props) {
  const { controller, owner, workspaceId, onAccessEnded } = props;
  const [catalog, setCatalog] = useState<GoogleConnectionCatalog>(), [selected, setSelected] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lease = useRef({ active: false, pending: false });
  const refresh = useCallback(async () => {
    const current = lease.current; if (!current.active || current.pending) return;
    current.pending = true; setBusy(true); setSelected(''); setCatalog(undefined); setError('');
    try { const value = await controller.connections(owner); if (current.active) setCatalog(value); }
    catch (failure) { if (current.active) { setError('Configured Mail accounts unavailable. Check Connections, then refresh. Your reviewed Task requests are kept.'); onAccessEnded(failure); } }
    finally { if (current.active) { current.pending = false; setBusy(false); } }
  }, [controller, owner, onAccessEnded]);
  useEffect(() => { const current = lease.current; current.active = true; queueMicrotask(() => { if (current.active) void refresh(); }); return () => { current.active = false; }; }, [refresh]);
  const bindings = catalog?.bindings.filter(row => row.workspaceId === workspaceId) ?? [];
  return <Block><Copy heading>Configured Mail</Copy><Copy>Read only accounts assigned to this Workspace. Manage consent, reconnect and disconnect in Connections.</Copy>
    <Action label="Refresh configured Mail accounts" disabled={busy} onPress={() => void refresh()} />
    {error ? <Copy>{error}</Copy> : null}{catalog && !bindings.length && <Copy>No Mail connection belongs to this Workspace.</Copy>}
    {bindings.map(row => <Block key={row.id}><Copy>{row.address} · {row.status}{row.expired ? ' · expired' : ''}</Copy><Action label={`Read Mail ${row.address}`} selected={selected === row.id} disabled={busy || row.status !== 'connected' || row.expired || !catalog?.mailAvailable} onPress={() => setSelected(row.id)} /></Block>)}
    {selected && <MailReader key={selected} {...props} connectionId={selected} />}
  </Block>;
}
