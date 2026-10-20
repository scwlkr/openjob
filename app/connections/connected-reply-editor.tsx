'use client';
import { useEffect, useRef, useState } from 'react';
import type { ConnectedReplyDraft, ReplyMode, ReplyPlan, ReplyPreparation } from '../../shared/connected-reply';
import styles from '../workspace/workspace.module.css';
import replyStyles from './connected-reply.module.css';

export type ReplyEditorBuffer = { body: string; mode: ReplyMode; revision: number; reviewToken: string; plan: ReplyPlan; dirty: boolean };
type Props = { workspaceId: string; taskId: string; getToken(): Promise<string>; buffer?: ReplyEditorBuffer; onBuffer(buffer?: ReplyEditorBuffer): void; onUnavailable(): void };
const planFor = (value: ReplyPreparation, mode: ReplyMode) => mode === 'reply' ? value.plans.reply : value.plans.replyAll;
function Addressing({ plan }: { plan: ReplyPlan }) {
  return <dl className={replyStyles.addressing}><dt>From</dt><dd>{plan.from}</dd><dt>To</dt><dd>{plan.to.join(', ')}</dd>{plan.cc.length > 0 && <><dt>Cc</dt><dd>{plan.cc.join(', ')}</dd></>}<dt>Subject</dt><dd>{plan.subject || '(No subject)'}</dd></dl>;
}
export default function ConnectedReplyEditor({ workspaceId, taskId, getToken, buffer, onBuffer, onUnavailable }: Props) {
  const [prepared, setPrepared] = useState<ReplyPreparation>(), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const lease = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => lease.current?.abort(), []);
  const path = `/api/v1/connections/task-sources/${workspaceId}/${taskId}/reply`;
  const reviewRequired = !!buffer && !!prepared && (buffer.reviewToken !== prepared.reviewToken || JSON.stringify(buffer.plan) !== JSON.stringify(planFor(prepared, buffer.mode)));
  const conflict = !!prepared && !!buffer && buffer.revision !== (prepared.draft?.revision ?? 0);
  function accept(value: ReplyPreparation) {
    if (value.workspaceId !== workspaceId || value.taskId !== taskId || value.storageKind !== 'openjob' || !value.plans?.reply || !value.plans?.replyAll || !/^[a-f0-9]{64}$/.test(value.reviewToken)) throw new Error();
    return value;
  }
  function loadBuffer(value: ReplyPreparation) {
    const draft = value.draft, mode = draft?.mode ?? 'reply';
    onBuffer({ body: draft?.body ?? '', mode, revision: draft?.revision ?? 0, reviewToken: draft && JSON.stringify(draft.plan) !== JSON.stringify(planFor(value, mode)) ? '' : value.reviewToken, plan: draft?.plan ?? planFor(value, mode), dirty: false });
  }
  async function prepare() {
    lease.current?.abort(); const controller = new AbortController(); lease.current = controller;
    setBusy(true); setPrepared(undefined); setNotice('');
    try {
      const token = await getToken(); controller.signal.throwIfAborted();
      const response = await fetch(path, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal, redirect: 'error' });
      if (!response.ok) throw new Error();
      const value = accept((await response.json() as { data: ReplyPreparation }).data); controller.signal.throwIfAborted();
      setPrepared(value); if (!buffer) loadBuffer(value);
      setNotice(value.draft ? 'Saved OpenJob draft reopened. Nothing has been sent.' : 'Review the account and recipients, then write your reply.');
    } catch { if (!controller.signal.aborted) { setNotice('Reply unavailable. Reconnect the source account or review unsupported message headers. Your authored text is kept in this Workspace until you leave or reload.'); onUnavailable(); } }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  async function save() {
    if (!prepared || !buffer || reviewRequired || conflict || busy) return;
    const submitted = { ...buffer };
    lease.current?.abort(); const controller = new AbortController(); lease.current = controller;
    setBusy(true); setNotice('');
    try {
      const token = await getToken(); controller.signal.throwIfAborted();
      const response = await fetch(path, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ mode: submitted.mode, body: submitted.body, expectedRevision: submitted.revision, reviewToken: submitted.reviewToken }), signal: controller.signal, cache: 'no-store', redirect: 'error' });
      if (!response.ok) {
        const code = (await response.json() as { error?: { code?: string } }).error?.code;
        if (code === 'conflict' || code === 'reply_review_required') { setPrepared(undefined); setNotice(code === 'conflict' ? 'Another editor saved a newer version. Your text is kept. Refresh the reply before choosing which version to keep.' : 'The source addressing changed. Your text is kept. Refresh and review the current recipients.'); return; }
        throw new Error();
      }
      const data = (await response.json() as { data: { workspaceId: string; taskId: string; draft: ConnectedReplyDraft } }).data; controller.signal.throwIfAborted();
      if (data.workspaceId !== workspaceId || data.taskId !== taskId || data.draft.body !== submitted.body || data.draft.mode !== submitted.mode || JSON.stringify(data.draft.plan) !== JSON.stringify(submitted.plan)) throw new Error();
      onBuffer({ ...submitted, revision: data.draft.revision, dirty: false }); setPrepared({ ...prepared, draft: data.draft }); setNotice('OpenJob draft saved. Nothing has been sent.');
    } catch { if (!controller.signal.aborted) { setPrepared(undefined); setNotice('Save unavailable. Your authored text is kept. Refresh the reply before retrying.'); onUnavailable(); } }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <section className={replyStyles.editor} aria-label="Connected reply draft">
    <h3>Reply draft</h3><p>Saved in OpenJob. Source Mail is read-only; sending is off.</p>
    <button disabled={busy} onClick={() => void prepare()}>{prepared || buffer ? 'Refresh reply and saved version' : 'Prepare reply draft'}</button>
    {notice && <p role="status">{notice}</p>}
    {prepared && buffer && <>
      <label>Recipients<select disabled={busy} value={buffer.mode} onChange={event => { const mode = event.target.value as ReplyMode; onBuffer({ ...buffer, mode, plan: planFor(prepared, mode), reviewToken: prepared.reviewToken, dirty: true }); }}><option value="reply">Reply</option><option value="reply-all">Reply all</option></select></label>
      {reviewRequired && <><p role="alert">Addressing changed since this draft was reviewed. Previous addressing:</p><Addressing plan={buffer.plan} /><p>Current addressing:</p></>}
      <Addressing plan={planFor(prepared, buffer.mode)} />
      {!planFor(prepared, buffer.mode).inReplyTo && <p>The source has no Message-ID. Provider reply threading is unavailable.</p>}
      {reviewRequired && <button disabled={busy} onClick={() => onBuffer({ ...buffer, plan: planFor(prepared, buffer.mode), reviewToken: prepared.reviewToken, dirty: true })}>Confirm current recipients and subject</button>}
      {conflict && <p role="alert">A newer saved draft is available. Your editor text is kept below. Review the saved version before replacing it or saving your edits over that version.</p>}
      {prepared.draft && <details><summary>Saved version · revision {prepared.draft.revision}</summary><Addressing plan={prepared.draft.plan} /><p className={styles.body}>{prepared.draft.body || '(Empty draft)'}</p><button disabled={busy} onClick={() => { loadBuffer(prepared); setNotice('Editor replaced with the saved draft.'); }}>Replace editor with saved draft</button></details>}
      {conflict && <button disabled={busy} onClick={() => { onBuffer({ ...buffer, revision: prepared.draft?.revision ?? 0, dirty: true }); setNotice('Your text is kept for an explicit save over the reviewed version.'); }}>Keep my text over reviewed version</button>}
    </>}
    {buffer && <><label>Your reply<textarea aria-label="Your reply" rows={8} maxLength={20000} disabled={busy} value={buffer.body} onChange={event => onBuffer({ ...buffer, body: event.target.value, dirty: true })} /></label><p className={styles.small}>{buffer.body.length.toLocaleString()} / 20,000 characters · {buffer.dirty ? 'Unsaved edits' : 'Editor ready'}. Unfinished text stays while switching Workspace modules. Save before leaving this page.</p><button className={styles.primary} disabled={busy || !prepared || reviewRequired || conflict} onClick={() => void save()}>Save OpenJob draft</button>{buffer.dirty && <button disabled={busy} onClick={() => { onBuffer(undefined); setPrepared(undefined); setNotice('Unsaved reply edits discarded. Any saved draft is kept.'); }}>Discard unsaved reply edits</button>}</>}
  </section>;
}
