import { useEffect, useRef, useState } from 'react';
import type { ReplyMode, ReplyPlan } from '../../../shared/connected-reply';
import type { ConnectedSource, NativeConnectedWorkspaceController, ReplyPreparation } from '../connected-workspaces-contracts';
import { Action, Block, Copy, Field, Row } from '../personal-workspace/controls';

export type NativeReplyBuffer = { body: string; mode: ReplyMode; revision: number; reviewToken: string; plan: ReplyPlan; dirty: boolean };
const planFor = (value: ReplyPreparation, mode: ReplyMode) => mode === 'reply' ? value.plans.reply : value.plans.replyAll;
function Addressing({ plan }: { plan: ReplyPlan }) { return <><Copy>From: {plan.from}</Copy><Copy>To: {plan.to.join(', ')}</Copy>{plan.cc.length > 0 && <Copy>Cc: {plan.cc.join(', ')}</Copy>}<Copy>Subject: {plan.subject || '(No subject)'}</Copy></>; }
export function ConnectedSourceReply({ controller, owner, workspaceId, taskId, buffer, onBuffer, onAccessEnded }: { controller: NativeConnectedWorkspaceController; owner: string; workspaceId: string; taskId: string; buffer?: NativeReplyBuffer; onBuffer(buffer?: NativeReplyBuffer): void; onAccessEnded(error: unknown): void }) {
  const [source, setSource] = useState<ConnectedSource>(), [prepared, setPrepared] = useState<ReplyPreparation>(), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const lease = useRef({ active: true, pending: false });
  useEffect(() => { const current = lease.current; current.active = true; return () => { current.active = false; }; }, []);
  async function run(action: () => Promise<void>) {
    if (lease.current.pending || !lease.current.active) return;
    lease.current.pending = true; setBusy(true); setNotice('');
    try { await action(); }
    catch (error) {
      if (!lease.current.active) return;
      const code = (error as { code?: string }).code;
      setPrepared(undefined);
      if (!['conflict', 'reply_review_required'].includes(code ?? '')) setSource(undefined);
      setNotice(code === 'conflict' ? 'A newer draft was saved. Your text is kept. Refresh and review the saved version.' : code === 'reply_review_required' ? 'Source addressing changed. Your text is kept. Refresh and review current recipients.' : 'Connected source unavailable. Task, Calendar and authored reply are kept. Reconnect and refresh before retrying.');
      onAccessEnded(error);
    } finally { if (lease.current.active) { lease.current.pending = false; setBusy(false); } }
  }
  const current = () => lease.current.active;
  async function open() { await run(async () => { setSource(undefined); setPrepared(undefined); const value = await controller.source(owner, workspaceId, taskId); if (current()) setSource(value); }); }
  function loadBuffer(value: ReplyPreparation) {
    const draft = value.draft, mode = draft?.mode ?? 'reply';
    onBuffer({ body: draft?.body ?? '', mode, revision: draft?.revision ?? 0, reviewToken: draft && JSON.stringify(draft.plan) !== JSON.stringify(planFor(value, mode)) ? '' : value.reviewToken, plan: draft?.plan ?? planFor(value, mode), dirty: false });
  }
  async function prepare() { await run(async () => { setPrepared(undefined); const value = await controller.reply(owner, workspaceId, taskId); if (!current()) return; setPrepared(value); if (!buffer) loadBuffer(value); setNotice(value.draft ? 'Saved OpenJob draft reopened. Nothing sent.' : 'Review the account and recipients, then write your reply.'); }); }
  const reviewRequired = !!buffer && !!prepared && (buffer.reviewToken !== prepared.reviewToken || JSON.stringify(buffer.plan) !== JSON.stringify(planFor(prepared, buffer.mode)));
  const conflict = !!buffer && !!prepared && buffer.revision !== (prepared.draft?.revision ?? 0);
  async function save() {
    if (!buffer || !prepared || reviewRequired || conflict) return;
    const submitted = { ...buffer };
    await run(async () => {
      const result = await controller.saveReply(owner, workspaceId, taskId, { mode: submitted.mode, body: submitted.body, expectedRevision: submitted.revision, reviewToken: submitted.reviewToken });
      if (!current()) return;
      if (JSON.stringify(result.draft.plan) !== JSON.stringify(submitted.plan)) throw new Error('Invalid reply acknowledgment');
      onBuffer({ ...submitted, revision: result.draft.revision, dirty: false }); setPrepared({ ...prepared, draft: result.draft }); setNotice('OpenJob draft saved. Nothing sent.');
    });
  }
  return <Block><Action label="Open connected source Mail" disabled={busy} onPress={() => void open()} />
    {notice ? <Copy>{notice}</Copy> : null}
    {source && <><Copy heading>{source.message.subject}</Copy><Copy>{source.mode === 'google-fixture' ? 'Invented Mail · ' : ''}{source.address}</Copy><Copy>{source.message.body}</Copy><Action label="Close connected source Mail" disabled={busy} onPress={() => { setSource(undefined); setPrepared(undefined); }} />
      <Copy heading>OpenJob reply draft</Copy><Copy>Source Mail is read-only. Sending is off. Save before leaving or closing the app.</Copy>
      <Action label={prepared || buffer ? 'Refresh reply and saved version' : 'Prepare reply draft'} disabled={busy} onPress={() => void prepare()} />
      {prepared && buffer && <><Row>{(['reply', 'reply-all'] as const).map(mode => <Action key={mode} label={mode === 'reply' ? 'Reply' : 'Reply all'} disabled={busy} selected={buffer.mode === mode} onPress={() => onBuffer({ ...buffer, mode, plan: planFor(prepared, mode), reviewToken: prepared.reviewToken, dirty: true })} />)}</Row>
        {reviewRequired && <><Copy>Addressing changed. Previous reviewed addressing:</Copy><Addressing plan={buffer.plan} /><Copy>Current addressing:</Copy></>}<Addressing plan={planFor(prepared, buffer.mode)} />
        {!planFor(prepared, buffer.mode).inReplyTo && <Copy>Source has no Message-ID; provider threading is unavailable.</Copy>}
        {reviewRequired && <Action label="Confirm current recipients and subject" disabled={busy} onPress={() => onBuffer({ ...buffer, plan: planFor(prepared, buffer.mode), reviewToken: prepared.reviewToken, dirty: true })} />}
        {prepared.draft && <Block><Copy heading>Saved version · revision {prepared.draft.revision}</Copy><Addressing plan={prepared.draft.plan} /><Copy>{prepared.draft.body || '(Empty draft)'}</Copy><Action label="Replace editor with saved draft" disabled={busy} onPress={() => loadBuffer(prepared)} /></Block>}
        {conflict && <><Copy>A newer saved version exists. Review it before choosing your text or the saved draft.</Copy><Action label="Keep my text over reviewed version" disabled={busy} onPress={() => onBuffer({ ...buffer, revision: prepared.draft?.revision ?? 0, dirty: true })} /></>}
      </>}
      {buffer && <><Field label="Your connected reply" value={buffer.body} multiline maxLength={20000} editable={!busy} onChange={body => onBuffer({ ...buffer, body, dirty: true })} /><Copy>{buffer.body.length} / 20,000 characters · {buffer.dirty ? 'Unsaved edits' : 'Editor ready'}</Copy><Action label="Save OpenJob draft" disabled={busy || !prepared || reviewRequired || conflict} onPress={() => void save()} /></>}
    </>}
    {!source && buffer && <Copy>Authored reply kept in this Workspace. Reopen the source to continue.</Copy>}
    {buffer?.dirty && <Action label="Discard unsaved reply edits" disabled={busy} onPress={() => { onBuffer(undefined); setPrepared(undefined); setNotice('Unsaved edits discarded. Saved draft is kept.'); }} />}
  </Block>;
}
