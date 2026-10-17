import { useImperativeHandle, useState, type Ref } from 'react';
import type { WorkspaceView, PersonalWorkspaceCommand } from '../personal-workspace-contracts';
import { mailLinkedTasks } from '../../../shared/workspace-links';
import { Action, Block, Copy, Field, Row } from './controls';

type Folder = 'Inbox' | 'Drafts' | 'Simulated Sent';
type Compose = { id?: string; accountId: string; to: string; subject: string; body: string };
export type MailHandle = { openMessage: (messageId: string, accountId: string) => boolean };
type Props = { view: WorkspaceView; busy: boolean; mailRef: Ref<MailHandle>; onTask: (id: string) => void; command: (input: PersonalWorkspaceCommand) => Promise<boolean> };
export function Mail({ view, busy, command, mailRef, onTask }: Props) {
  const [account, setAccount] = useState('');
  const [folder, setFolder] = useState<Folder>('Inbox');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState('');
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [compose, setCompose] = useState<Compose | null>(null);
  const message = view.messages.find(item => item.id === selected && (!account || item.accountId === account));
  const replyDraft = view.drafts.find(item => item.messageId === selected);
  const reply = replies[selected] ?? replyDraft?.body ?? '';
  const query = search.trim().toLowerCase();
  const matches = (item: { accountId: string; subject?: string; body: string }) => (!account || item.accountId === account) && (!query || `${item.subject || ''} ${item.body}`.toLowerCase().includes(query));
  useImperativeHandle(mailRef, () => ({ openMessage(messageId, accountId) {
    if (!view.messages.some(item => item.id === messageId && item.accountId === accountId)) return false;
    setAccount(accountId); setFolder('Inbox'); setSearch(''); setSelected(messageId); return true;
  } }), [view]);
  return <>
    <Block><Copy heading>Invented Mail</Copy><Copy>Online-only invented examples and saved drafts. No real mailbox connection or delivery. Unsaved input stays in memory for this session.</Copy>
      <Action label="Add invented examples" disabled={busy} onPress={() => command({ type: 'mail.examples.add' })} />
      <Row><Action label="All mailboxes" selected={!account} onPress={() => { setAccount(''); setSelected(''); }} />{view.accounts.map(item => <Action key={item.id} label={`Mailbox ${item.label}`} selected={account === item.id} onPress={() => { setAccount(item.id); setSelected(''); }} />)}</Row>
      <Row>{(['Inbox', 'Drafts', 'Simulated Sent'] as Folder[]).map(item => <Action key={item} label={item} selected={folder === item} onPress={() => setFolder(item)} />)}</Row>
      <Field label="Search invented mail" value={search} onChange={setSearch} />
      <Action label="Compose invented draft" disabled={!view.accounts.length || busy} onPress={() => setCompose({ accountId: account || view.accounts[0]?.id || '', to: '', subject: '', body: '' })} />
    </Block>
    {compose && <Block><Copy heading>{compose.id ? 'Edit saved draft' : 'Compose local draft'}</Copy><Copy>From: {view.accounts.find(item => item.id === compose.accountId)?.address}</Copy>
      {!compose.id && <Row>{view.accounts.map(item => <Action key={item.id} label={`Draft from ${item.label}`} selected={compose.accountId === item.id} onPress={() => setCompose({ ...compose, accountId: item.id })} />)}</Row>}
      <Field label="Draft recipient" value={compose.to} onChange={to => setCompose({ ...compose, to })} /><Field label="Draft subject" value={compose.subject} onChange={subject => setCompose({ ...compose, subject })} /><Field label="Draft body" multiline value={compose.body} onChange={body => setCompose({ ...compose, body })} />
      <Action label="Save composed draft" disabled={busy || !compose.to.trim() || !compose.subject.trim() || !compose.body.trim()} onPress={async () => { const input: PersonalWorkspaceCommand = compose.id ? { type: 'mail.draft.update', draftId: compose.id, to: compose.to, subject: compose.subject, body: compose.body } : { type: 'mail.compose', accountId: compose.accountId, to: compose.to, subject: compose.subject, body: compose.body }; if (await command(input)) setCompose(null); }} /><Action label="Cancel draft editor" onPress={() => setCompose(null)} />
    </Block>}
    {folder === 'Inbox' && <>
      {view.messages.filter(matches).map(item => <Block key={item.id}><Action label={`Read ${item.subject}`} onPress={() => setSelected(item.id)} /><Copy>{view.accounts.find(entry => entry.id === item.accountId)?.label} · {item.read ? 'Read' : 'Unread'}</Copy></Block>)}
      {!view.messages.filter(matches).length && <Copy>No invented messages match this mailbox and search.</Copy>}
      {message && <Block><Copy heading>{message.subject}</Copy><Copy>From: {message.from}{'\n'}To: {message.to}{'\n'}Example time: {message.receivedAt}</Copy><Copy>{message.body}</Copy>
        <Row><Action label={message.read ? 'Mark message unread' : 'Mark message read'} disabled={busy} onPress={() => command({ type: 'mail.read', messageId: message.id, read: !message.read })} /><Action label="Create private task from mail" disabled={busy} onPress={() => command({ type: 'task.create', title: message.subject, messageId: message.id })} /></Row>
        <Copy heading>Linked Tasks</Copy>{mailLinkedTasks(view, { accountId: message.accountId, messageId: message.id }).map(task => <Action key={task.id} label={`Open linked task ${task.title}${task.completed ? ' · completed' : ''}`} onPress={() => onTask(task.id)} />)}
        <Field label="Reply body" multiline value={reply} onChange={value => setReplies({ ...replies, [message.id]: value })} /><Action label="Save reply draft" disabled={busy || !reply.trim()} onPress={() => command(replyDraft ? { type: 'mail.draft.update', draftId: replyDraft.id, to: replyDraft.to || message.from, subject: replyDraft.subject || `Re: ${message.subject}`, body: reply } : { type: 'mail.draft', messageId: message.id, body: reply })} />
      </Block>}
    </>}
    {folder === 'Drafts' && <>{view.drafts.filter(matches).map(item => <Block key={item.id}><Copy heading>{item.subject || 'Reply draft'}</Copy><Copy>From: {view.accounts.find(entry => entry.id === item.accountId)?.address}{'\n'}To: {item.to}</Copy><Copy>{item.body}</Copy><Row><Action label={`Edit draft ${item.subject || item.id}`} disabled={busy} onPress={() => setCompose({ id: item.id, accountId: item.accountId, to: item.to || '', subject: item.subject || '', body: item.body })} /><Action label={`Simulate send ${item.subject || item.id}`} disabled={busy} onPress={() => command({ type: 'mail.simulate-send', draftId: item.id })} /></Row><Copy>Local simulation only. No provider or recipient receives mail.</Copy></Block>)}{!view.drafts.filter(matches).length && <Copy>No saved drafts match.</Copy>}</>}
    {folder === 'Simulated Sent' && <>{view.sent.filter(matches).map(item => <Block key={item.id}><Copy heading>{item.subject}</Copy><Copy>From: {item.from}{'\n'}To: {item.to}{'\n'}{item.sentAt} · Simulated delivery only</Copy><Copy>{item.body}</Copy></Block>)}{!view.sent.filter(matches).length && <Copy>No simulated messages match.</Copy>}</>}
  </>;
}
