import { useState } from 'react';
import { Action, Block, Copy, Field } from '../personal-workspace/controls';
import { nativeMailIntentKey, type NativeMailIntents } from './mail-task-intents';

export function MailTask({ connectionId, messageId, suggestion, intents, available, canUse, onTask }: { connectionId: string; messageId: string; suggestion: string; intents: NativeMailIntents; available: boolean; canUse(): boolean; onTask(taskId: string): Promise<void> }) {
  const [forgetting, setForgetting] = useState(false);
  const draft = intents.entries[nativeMailIntentKey(connectionId, messageId)], title = draft?.title ?? suggestion.slice(0, 500);
  const pending = draft?.phase === 'submitting' || draft?.phase === 'uncertain';
  return <Block><Field label="Connected Task title" value={title} maxLength={500} editable={!pending} onChange={value => intents.edit(connectionId, messageId, value)} />
    <Copy>Review the Task title. Only your authored work is kept when Mail closes.</Copy>
    {draft?.phase === 'submitting' && <Copy>Confirming Task… Your reviewed request stays in this Workspace.</Copy>}
    {draft?.phase === 'uncertain' && <Copy>Task result is uncertain. Check saved Tasks and refresh Mail access, then retry this exact request. No automatic retry was made.</Copy>}
    {draft?.phase === 'uncertain' && (forgetting ? <Block><Copy>A Task may already exist. Check saved Tasks before creating another; a new request could create a duplicate. Stop retrying keeps your reviewed title and any previous linked Task.</Copy><Action label="Confirm stop retrying Task request" onPress={() => { intents.forget(connectionId, messageId); setForgetting(false); }} /><Action label="Keep Task request for retry" onPress={() => setForgetting(false)} /></Block> : <Action label="Stop retrying Task request" onPress={() => setForgetting(true)} />)}
    {draft?.receipt && <Action label={`Open linked Task ${draft.receiptTitle ?? draft.title}`} onPress={() => void onTask(draft.receipt!.taskId)} />}
    {!forgetting && (draft?.phase === 'confirmed' ? <Action label={`Create another Task from ${suggestion}`} disabled={!title.trim() || !available} onPress={() => { if (canUse()) void intents.submit(connectionId, messageId, title, true); }} /> : <Action label={draft?.phase === 'uncertain' ? `Retry same Task request ${title}` : `Create or find Task from ${suggestion}`} disabled={draft?.phase === 'submitting' || !title.trim() || !available} onPress={() => { if (canUse()) void intents.submit(connectionId, messageId, title); }} />)}
  </Block>;
}
