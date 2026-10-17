// Simulated consent, invented credentials and injected Gmail responses only. Never calls global fetch.
import { createFakeFirestore } from './fake-firestore.mjs';
import { createFirestoreProviderConnectionStore } from '../../db/provider-connections.ts';
import { createMockProviderOAuthLifecycle } from '../../server/providers/provider-oauth-lifecycle.ts';
import { createMockProviderOAuthTransactions } from '../../server/providers/provider-oauth-transactions.ts';
import { createProviderTokenVaultBroker } from '../../server/providers/provider-token-vault.ts';
import { createProviderConnectionReader } from '../../server/providers/provider-connections.ts';
export const fixtureChoices = [{ id: 'invented_gmail', provider: 'gmail', label: 'Invented Alex mailbox', subject: 'invented_alex_subject' }];
export function createConsentFixture({ config, isOwnerActive, now = Date.now }) {
  const attempts = new Map(); let readFailure = false, cleanupFailure = false;
  const counts = { exchange: 0, reads: 0 };
  const callbackUri = 'https://fixture.invalid/simulated-callback';
  return {
    counts,
    failReads(value) { readFailure = value; }, failCleanup(value) { cleanupFailure = value; },
    forget() { attempts.clear(); },
    adapter: {
      async begin(owner, choice, attemptId) {
        if (attempts.size >= 100) throw new Error('Fixture capacity');
        const db = createFakeFirestore(), name = `projects/openjob-dev/databases/(default)/documents/v1UserDirectory/${owner}`;
        db.documents.set(name, { name, updateTime: new Date(now()).toISOString(), fields: { userId: { stringValue: owner } } });
        const connections = createFirestoreProviderConnectionStore(config, db.fetch), entries = new Map();
        const accountId = `fixture_${attemptId}`;
        const active = async candidate => candidate === owner && !record.disabled && await isOwnerActive(owner);
        const vault = { async read(ref) { return structuredClone(entries.get(ref) ?? null); }, async write(row) { entries.set(row.credentialRef, structuredClone(row)); }, async delete(row) { entries.delete(row.credentialRef); } };
        const record = { owner, attemptId, accountId, disabled: false, connections, entries };
        const flow = createMockProviderOAuthLifecycle({ executionMode: 'mock', clientId: 'invented_client', callbackUri, connections, transactions: createMockProviderOAuthTransactions({ now }), vault, isOwnerActive: active, now,
          async exchange() { counts.exchange++; return { accessToken: 'invented_fixture_access', idToken: 'invented_fixture_identity', scopes: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly'], expiresAt: now() + 3600000 }; },
          async verifyIdentity({ nonce }) { return { iss: 'https://accounts.google.com', aud: 'invented_client', exp: Math.floor(now() / 1000) + 3600, nonce, sub: choice.subject, email: 'alex@example.invalid', email_verified: true }; },
        });
        const handoff = await flow.begin({ ownerId: owner, accountId, expectedSubject: choice.subject, label: choice.label });
        const broker = createProviderTokenVaultBroker({ vault, connections, isOwnerActive: active, executionMode: 'mock', now });
        const reader = createProviderConnectionReader({ store: connections, broker, isOwnerActive: active, executionMode: 'mock', now, fetchImplementation: async input => {
          counts.reads++; if (readFailure) throw new Error('Simulated expired access');
          const url = new URL(input); if (url.origin !== 'https://gmail.googleapis.com') throw new Error('Unexpected fixture destination');
          if (url.pathname.endsWith('/profile')) return Response.json({ emailAddress: 'alex@example.invalid', messagesTotal: 1, threadsTotal: 1, historyId: '1' });
          if (url.pathname.endsWith('/labels')) return Response.json({ labels: [{ id: 'INBOX', name: 'INBOX', type: 'system' }] });
          if (url.pathname.endsWith('/messages')) return Response.json({ messages: [{ id: 'fixture_message', threadId: 'fixture_thread' }] });
          if (url.pathname.endsWith('/messages/fixture_message')) return Response.json({ id: 'fixture_message', threadId: 'fixture_thread', labelIds: ['INBOX'], internalDate: String(now()), payload: { mimeType: 'text/plain', headers: [{ name: 'Subject', value: 'Plan the invented first account' }, { name: 'From', value: 'sender@example.invalid' }, { name: 'To', value: 'alex@example.invalid' }], body: { data: Buffer.from('Invented Mail body. No provider was contacted.').toString('base64url') } } });
          throw new Error('Unsupported fixture operation');
        } });
        Object.assign(record, { flow, reader, handoff: handoff.state }); attempts.set(attemptId, record);
        return handoff.state;
      },
      async finish(owner, handoff) {
        const record = [...attempts.values()].find(item => item.owner === owner && item.handoff === handoff && !item.disabled); if (!record) throw new Error('Fixture consent unavailable');
        await record.flow.callback({ ownerId: owner, state: handoff, callbackUri, code: 'invented_fixture_code' });
        const row = await record.connections.getForOwner(owner, record.accountId);
        if (!row || record.disabled) throw new Error('Fixture consent cancelled');
        return { accountId: row.accountId, subject: row.subject, address: row.address };
      },
      async cancel(owner, handoff) {
        const record = [...attempts.values()].find(item => item.owner === owner && item.handoff === handoff);
        if (record) { record.disabled = true; try { await record.flow.cancel(owner, handoff); } catch { /* Consumed state is already denied; disable handles cleanup. */ } }
      },
      async disable(owner, attemptId) {
        const record = attempts.get(attemptId); if (!record) return;
        if (record.owner !== owner) throw new Error('Foreign fixture attempt');
        record.disabled = true; if (cleanupFailure) throw new Error('Simulated cleanup unavailable');
        const row = await record.connections.getForOwner(owner, record.accountId);
        if (row) await record.connections.revokeForOwner(owner, row.accountId, row.revision);
        record.entries.clear(); attempts.delete(attemptId);
      },
      async read(owner, accountId) {
        const record = [...attempts.values()].find(item => item.owner === owner && item.accountId === accountId && !item.disabled);
        if (!record) throw new Error('Fixture credential lost; reconnect required');
        return record.reader.listMessages({ ownerId: owner, accountId });
      },
    },
  };
}
