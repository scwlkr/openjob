import type { OwnedWorkspace, OwnedWorkspaceSnapshot } from '../../shared/owned-workspaces';
import type { TaskCalendarCommand } from '../../shared/task-calendar-sync';
import type { MailTaskResult } from '../../shared/mail-task-source';
import type { ConnectedReplyDraft, ReplyPreparation, ReplySaveInput } from '../../shared/connected-reply';
import type { ProviderMessage, ProviderMessagePage } from '../../shared/provider-contracts';
import type { GoogleConnectionCatalog } from '../../shared/google-connection-catalog';

export type { OwnedWorkspace, OwnedWorkspaceSnapshot, ConnectedReplyDraft, ReplyPreparation, ReplySaveInput, ProviderMessage, GoogleConnectionCatalog };
export type ConnectedMail = { mode: 'google' | 'google-fixture'; workspaceId: string; page: ProviderMessagePage };
export type ConnectedSource = { mode: 'google' | 'google-fixture'; workspaceId: string; taskId: string; address: string; message: ProviderMessage };
export type ConnectedCommand = TaskCalendarCommand & { expectedNotes?: string };
export type MailTaskInput = { messageId: string; title: string; requestId?: string };
/** Same API contracts as web/CLI. No credential access in presentation code. */
export type NativeConnectedWorkspaceApi = {
  list(token: string, owner: string): Promise<OwnedWorkspace[]>;
  create(token: string, owner: string, name: string): Promise<OwnedWorkspaceSnapshot>;
  personal(token: string, owner: string): Promise<OwnedWorkspaceSnapshot>;
  read(token: string, owner: string, workspaceId: string): Promise<OwnedWorkspaceSnapshot>;
  command(token: string, owner: string, workspaceId: string, input: ConnectedCommand): Promise<OwnedWorkspaceSnapshot>;
  connections(token: string, owner: string): Promise<GoogleConnectionCatalog>;
  mail(token: string, owner: string, workspaceId: string, connectionId: string): Promise<ConnectedMail>;
  createMailTask(token: string, owner: string, workspaceId: string, connectionId: string, input: MailTaskInput): Promise<MailTaskResult>;
  source(token: string, owner: string, workspaceId: string, taskId: string): Promise<ConnectedSource>;
  reply(token: string, owner: string, workspaceId: string, taskId: string): Promise<ReplyPreparation>;
  saveReply(token: string, owner: string, workspaceId: string, taskId: string, input: ReplySaveInput): Promise<{ workspaceId: string; taskId: string; draft: ConnectedReplyDraft }>;
};
export type NativeConnectedWorkspaceController = { [K in keyof NativeConnectedWorkspaceApi]: NativeConnectedWorkspaceApi[K] extends (token: string, ...args: infer A) => infer R ? (...args: A) => R : never };
