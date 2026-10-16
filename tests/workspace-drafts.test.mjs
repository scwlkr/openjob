import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceEngine } from '../shared/workspace-engine.ts';
import { createFixtureWorkspace } from '../shared/workspace-fixtures.ts';

const alex = { kind: 'human', ownerId: 'demo_alex' };
const sam = { kind: 'human', ownerId: 'demo_sam' };
const compose = { type: 'mail.compose', accountId: 'alex_gmail', to: 'mia@team.example.invalid', subject: 'Fixture plan', body: 'Invented fixture content.' };
function agent(engine, scopes, resourceIds = ['alex_gmail']) {
  const issued = engine.command(alex, { type: 'agent.grant', name: 'Fixture helper', scopes, resourceIds });
  return { kind: 'agent', ownerId: alex.ownerId, agentId: issued.id };
}
function unchangedFailure(engine, actor, command, code = 'forbidden') {
  const before = engine.exportState();
  assert.throws(() => engine.command(actor, command), error => error.code === code);
  assert.deepEqual(engine.exportState(), before);
}

test('saved compose edits retain identity and local simulated Sent consumes the draft exactly once', () => {
  const engine = createWorkspaceEngine();
  const draft = engine.command(alex, compose);
  const edit = { type: 'mail.draft.update', draftId: draft.id, to: 'noah@work.example.invalid', subject: 'Revised fixture plan', body: 'Revised invented content.' };
  const updated = engine.command(alex, edit);
  assert.equal(updated.id, draft.id);
  assert.equal(updated.accountId, draft.accountId);
  assert.equal(engine.snapshot(alex).drafts.length, 1);
  const sent = engine.command(alex, { type: 'mail.simulate-send', draftId: draft.id });
  assert.equal(sent.to, edit.to); assert.equal(sent.subject, edit.subject); assert.equal(sent.body, edit.body);
  assert.equal(sent.from, 'alex@gmail.example.invalid'); assert.equal(sent.mode, 'fixture'); assert.ok(Number.isFinite(Date.parse(sent.sentAt)));
  assert.equal(engine.snapshot(alex).drafts.length, 0);
  assert.deepEqual(engine.snapshot(alex).sent, [sent]);
  unchangedFailure(engine, alex, { type: 'mail.simulate-send', draftId: draft.id });
  unchangedFailure(engine, alex, edit);
  sent.body = 'external mutation';
  assert.equal(engine.snapshot(alex).sent[0].body, edit.body);
  const restored = createWorkspaceEngine(engine.exportState());
  assert.deepEqual(restored.snapshot(alex).sent, engine.snapshot(alex).sent);
  assert.equal(restored.snapshot(alex).drafts.length, 0);
});

test('reply drafts inherit recipient and subject and explicitly update the same saved reply', () => {
  const engine = createWorkspaceEngine();
  const draft = engine.command(alex, { type: 'mail.draft', messageId: 'alex_msg_launch', body: 'First reply' });
  assert.equal(draft.to, 'mia@team.example.invalid'); assert.equal(draft.subject, 'Re: Launch checklist for Friday');
  const repeated = engine.command(alex, { type: 'mail.draft', messageId: 'alex_msg_launch', body: 'Repeated reply save' });
  assert.equal(repeated.id, draft.id); assert.equal(engine.snapshot(alex).drafts.length, 1);
  assert.equal(repeated.body, 'Repeated reply save');
  engine.command(alex, { type: 'mail.draft.update', draftId: draft.id, to: draft.to, subject: draft.subject, body: 'Updated reply' });
  const sent = engine.command(alex, { type: 'mail.simulate-send', draftId: draft.id });
  assert.equal(sent.messageId, 'alex_msg_launch'); assert.equal(sent.body, 'Updated reply');
  const followup = engine.command(alex, { type: 'mail.draft', messageId: 'alex_msg_launch', body: 'A separate follow-up' });
  assert.notEqual(followup.id, draft.id); assert.equal(engine.snapshot(alex).sent.length, 1);
  const fixture = createFixtureWorkspace(); fixture.messages[0].subject = 'Re: Existing thread';
  const reply = createWorkspaceEngine(fixture).command(alex, { type: 'mail.draft', messageId: 'alex_msg_launch', body: 'Reply' });
  assert.equal(reply.subject, 'Re: Existing thread');
});

test('draft edit and simulated delivery require owned mailbox and exact explicit agent permissions', () => {
  const engine = createWorkspaceEngine();
  const draft = engine.command(alex, compose);
  const edit = { type: 'mail.draft.update', draftId: draft.id, to: compose.to, subject: compose.subject, body: 'Scoped edit' };
  const simulate = { type: 'mail.simulate-send', draftId: draft.id };
  unchangedFailure(engine, sam, edit); unchangedFailure(engine, sam, simulate);
  for (const scopes of [['mail:read'], ['mail:draft'], ['mail:simulate-send'], ['tasks:write']]) {
    const actor = agent(engine, scopes);
    if (!scopes.includes('mail:draft')) unchangedFailure(engine, actor, edit);
    else engine.command(actor, edit);
    unchangedFailure(engine, actor, simulate);
  }
  const wrongAccount = agent(engine, ['mail:draft', 'mail:simulate-send'], ['alex_outlook']);
  unchangedFailure(engine, wrongAccount, edit); unchangedFailure(engine, wrongAccount, simulate);
  const allowed = agent(engine, ['mail:draft', 'mail:simulate-send']);
  engine.command(allowed, edit);
  engine.command(alex, { type: 'agent.revoke', agentId: allowed.agentId });
  unchangedFailure(engine, allowed, edit, 'unauthorized'); unchangedFailure(engine, allowed, simulate, 'unauthorized');
  const active = agent(engine, ['mail:draft', 'mail:simulate-send']);
  const sent = engine.command(active, simulate); assert.equal(sent.mode, 'fixture');
});

test('Sent reads enforce owner, mailbox and mail:read; genuine sending remains disabled', () => {
  const engine = createWorkspaceEngine();
  const draft = engine.command(alex, compose);
  unchangedFailure(engine, alex, { type: 'mail.send', draftId: draft.id }, 'sending_disabled');
  engine.command(alex, { type: 'mail.simulate-send', draftId: draft.id });
  assert.equal(engine.snapshot(sam).sent.length, 0);
  for (const [scopes, resources] of [[['tasks:read'], ['tasks:personal']], [['mail:draft', 'mail:simulate-send'], ['alex_gmail']], [['mail:read'], ['alex_outlook']]]) {
    assert.equal(engine.snapshot(agent(engine, scopes, resources)).sent.length, 0);
  }
  const reader = agent(engine, ['mail:read']);
  const view = engine.snapshot(reader); assert.equal(view.sent.length, 1);
  view.sent[0].body = 'tampered'; assert.equal(engine.snapshot(reader).sent[0].body, compose.body);
  unchangedFailure(engine, reader, { type: 'mail.send', draftId: draft.id }, 'sending_disabled');
  engine.command(alex, { type: 'agent.revoke', agentId: reader.agentId });
  assert.throws(() => engine.snapshot(reader), error => error.code === 'unauthorized');
});

test('malformed edits are atomic, cannot move accounts and only absent legacy Sent is normalized', () => {
  const fixture = createFixtureWorkspace(); delete fixture.sent;
  const engine = createWorkspaceEngine(fixture); assert.deepEqual(engine.exportState().sent, []);
  const draft = engine.command(alex, compose);
  const edit = { type: 'mail.draft.update', draftId: draft.id, to: compose.to, subject: compose.subject, body: compose.body };
  for (const command of [{ ...edit, to: 'invalid' }, { ...edit, body: '' }, { ...edit, subject: '' }, { ...edit, accountId: 'alex_outlook' }, { type: 'mail.simulate-send' }, { type: 'mail.simulate-send', draftId: draft.id, mode: 'live' }]) unchangedFailure(engine, alex, command, 'invalid_input');
  const legacyDraftState = engine.exportState(); delete legacyDraftState.drafts[0].to;
  const incomplete = createWorkspaceEngine(legacyDraftState);
  unchangedFailure(incomplete, alex, { type: 'mail.simulate-send', draftId: draft.id }, 'invalid_input');
  assert.equal(incomplete.snapshot(alex).drafts.length, 1);
  assert.equal(incomplete.snapshot(alex).sent.length, 0);
});
