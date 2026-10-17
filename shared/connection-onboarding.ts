/** Application metadata only. Provider secrets belong to the injected broker. */
export type ConnectionStatus = 'authorizing' | 'consent_required' | 'connected' | 'cancelled' | 'reconnect_required' | 'cleanup_pending' | 'disconnected';
export type ConnectionBinding = {
  id: string; ownerId: string; workspaceId: string; choiceId: string; provider: 'gmail';
  status: ConnectionStatus; attemptId: string; handoff?: string; subject?: string;
  address?: string; accountId?: string;
};
export type ConnectionChoice = { id: string; label: string; provider: 'gmail'; subject: string };
export type ConnectionCatalog = {
  mode: 'simulated'; providers: { id: string; available: boolean; reason: string }[];
  choices: { id: string; label: string; provider: 'gmail' }[];
  homes: { workspaceId: string; name: string }[];
  bindings: Omit<ConnectionBinding, 'ownerId' | 'handoff' | 'subject' | 'accountId' | 'attemptId'>[];
};
export function connectionFail(code = 'invalid_input'): never { throw Object.assign(new Error('Connection unavailable. Refresh its status before retrying.'), { code }); }
export function validateConnectionBindings(value: unknown, owner: string): ConnectionBinding[] {
  if (!Array.isArray(value) || value.length > 50) connectionFail('invalid_state');
  const states = ['authorizing', 'consent_required', 'connected', 'cancelled', 'reconnect_required', 'cleanup_pending', 'disconnected'];
  const rows = value as ConnectionBinding[];
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Object.keys(row).some(key => !['id', 'ownerId', 'workspaceId', 'choiceId', 'provider', 'status', 'attemptId', 'handoff', 'subject', 'address', 'accountId'].includes(key)) || row.ownerId !== owner || !/^con_[a-f0-9]{32}$/.test(row.id) || !/^wsp_[a-f0-9]{32}$/.test(row.workspaceId) || !/^[a-z0-9_-]{1,80}$/.test(row.choiceId) || row.provider !== 'gmail' || !states.includes(row.status) || !/^[a-f0-9]{32}$/.test(row.attemptId)) connectionFail('invalid_state');
    for (const key of ['handoff', 'subject', 'address', 'accountId'] as const) if (row[key] !== undefined && (typeof row[key] !== 'string' || !row[key] || row[key]!.length > 512 || /[\u0000-\u001f\u007f]/.test(row[key]!))) connectionFail('invalid_state');
    if (row.status === 'connected' && (!row.subject || !row.address || !row.accountId)) connectionFail('invalid_state');
  }
  if (new Set(rows.map(row => row.id)).size !== rows.length || new Set(rows.map(row => row.choiceId)).size !== rows.length) connectionFail('invalid_state');
  return structuredClone(rows);
}
