'use client';
import { useCallback, useRef, useState } from 'react';
import type { ProviderMessagePage } from '../../shared/provider-contracts';
import ConnectedMailTask from './connected-mail-task';
import styles from '../workspace/workspace.module.css';

type Props = { connectionId: string; workspaceId: string; initialPage: ProviderMessagePage; fixture: boolean; request(path?: string, input?: object): Promise<unknown> };
export default function ConnectedGoogleMail({ connectionId, workspaceId, initialPage, fixture, request }: Props) {
  const [page, setPage] = useState<ProviderMessagePage | undefined>(initialPage);
  const [number, setNumber] = useState(1), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  // Only authored titles survive paging. Provider bodies are replaced, never accumulated.
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Set<string>>(new Set());
  const loading = useRef(false);
  const onPendingChange = useCallback((id: string, value: boolean) => setPending(before => {
    if (before.has(id) === value) return before;
    const next = new Set(before); if (value) next.add(id); else next.delete(id); return next;
  }), []);
  async function read(cursor?: string, nextNumber = 1) {
    if (loading.current || pending.size) return;
    loading.current = true; setBusy(true); setError(''); setPage(undefined);
    try {
      const query = cursor === undefined ? '' : `?${new URLSearchParams({ cursor })}`;
      const result = await request(`/${connectionId}/mail${query}`) as { workspaceId: string; page: ProviderMessagePage };
      if (result.workspaceId !== workspaceId || !Array.isArray(result.page?.messages) || !(result.page.nextCursor === null || typeof result.page.nextCursor === 'string')) throw new Error();
      setPage(result.page); setNumber(nextNumber);
    } catch (error) {
      setError((error as { code?: string })?.code === 'invalid_cursor' ? 'This Mail page is no longer available. Open the first page to continue.' : 'Mail could not be read. Check the connection, then open the first page to retry.');
    } finally { loading.current = false; setBusy(false); }
  }
  return <section className={styles.panel} aria-label="Connected Mail">
    <h2>{fixture ? 'Invented Mail' : 'Read-only Mail'}</h2>
    <p>One page at a time. Edited Task titles are kept while paging within this mailbox.</p>
    {error && <p role="alert">{error}</p>}
    <div className={styles.actions}>
      <button disabled={busy || !!pending.size || number === 1 && !!page} onClick={() => void read()}>First page</button>
      <button disabled={busy || !!pending.size || !page?.nextCursor} onClick={() => void read(page?.nextCursor ?? undefined, number + 1)}>Next page</button>
    </div>
    {!!pending.size && <p>Finish confirming the Task before changing pages.</p>}
    {busy && <p role="status">Reading Mail…</p>}
    {page && <><p>Mail page {number}</p>{!page.messages.length && <p>This page has no messages.</p>}{page.messages.map(message => <article key={message.id}>
      <h3>{message.subject}</h3><p>{message.body}</p>
      <ConnectedMailTask message={message} workspaceId={workspaceId} connectionId={connectionId} request={request} title={titles[message.id] ?? message.subject.slice(0, 500)} onTitleChange={title => setTitles(before => ({ ...before, [message.id]: title }))} onPendingChange={onPendingChange} />
    </article>)}</>}
  </section>;
}
