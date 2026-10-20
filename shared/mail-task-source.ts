/** Private provider references. Never include these in Task/Calendar projections. */
export type MailTaskSource = {
  workspaceId: string; taskId: string; connectionId: string; accountId: string;
  messageId: string; threadId: string; requestId?: string; requestHash?: string;
};
export type MailTaskReference = Omit<MailTaskSource, 'taskId'>;
export type MailTaskResult = { workspaceId: string; taskId: string; created: boolean };
const fail = (): never => { throw Object.assign(new Error('Mail source unavailable.'), { code: 'invalid_state' }); };
export function parseMailTaskSources(encoded?: string): MailTaskSource[] {
  if (encoded === undefined) return [];
  const rows = JSON.parse(encoded) as MailTaskSource[];
  if (!Array.isArray(rows) || rows.length > 1000) fail();
  const ids = new Set<string>();
  for (const row of rows) {
    if (!row || ['workspaceId', 'taskId', 'connectionId', 'accountId', 'messageId', 'threadId'].some(key => typeof row[key as keyof MailTaskSource] !== 'string')) fail();
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.values(row).some(value => typeof value !== 'string') || Object.keys(row).some(key => !['workspaceId', 'taskId', 'connectionId', 'accountId', 'messageId', 'threadId', 'requestId', 'requestHash'].includes(key)) || !/^wsp_[a-f0-9]{32}$/.test(row.workspaceId) || !/^[A-Za-z0-9_-]{1,128}$/.test(row.taskId) || !/^con_[a-f0-9]{32}$/.test(row.connectionId) || !/^gmail_[a-f0-9]{32}$/.test(row.accountId) || !/^[A-Za-z0-9_-]{1,128}$/.test(row.messageId) || !/^[A-Za-z0-9_-]{1,128}$/.test(row.threadId) || (row.requestId === undefined) !== (row.requestHash === undefined) || row.requestId !== undefined && (!/^[a-f0-9-]{36}$/.test(row.requestId) || !/^[a-f0-9]{64}$/.test(row.requestHash!)) || ids.has(row.taskId)) fail();
    ids.add(row.taskId);
  }
  return rows;
}
export function retainMailTaskSources(rows: MailTaskSource[], tasks: { id: string }[]) {
  const ids = new Set(tasks.map(task => task.id));
  return rows.filter(row => ids.has(row.taskId));
}
export function existingMailTask(rows: MailTaskSource[], source: MailTaskReference) {
  if (source.requestId) {
    const previous = rows.find(row => row.workspaceId === source.workspaceId && row.requestId === source.requestId);
    if (previous && previous.requestHash !== source.requestHash) throw Object.assign(new Error('Task request changed.'), { code: 'conflict' });
    return previous;
  }
  return rows.find(row => row.workspaceId === source.workspaceId && row.connectionId === source.connectionId && row.accountId === source.accountId && row.messageId === source.messageId);
}
