import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url);
async function start(stateFile) {
  const child = spawn(process.execPath, ['scripts/workspace-fixture-server.mjs', '--state-file', stateFile, '--port', '0'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Fixture startup timeout: ' + stderr)); }, 10000);
    child.stdout.on('data', chunk => {
      stdout += chunk;
      const match = stdout.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Fixture exited ${code}: ${stderr}`)); });
  });
  return { url, async stop() { const exited = once(child, 'close'); child.kill('SIGTERM'); await exited; } };
}
async function run(url, command, { owner = 'demo_alex', agent } = {}) {
  const args = ['cli/workspace.mjs', command ? 'command' : 'snapshot', '--url', url, '--owner', owner, ...(agent ? ['--agent', agent] : []), ...(command ? ['--input', '-'] : [])];
  const child = spawn(process.execPath, args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.end(command ? JSON.stringify(command) : undefined);
  const [status] = await once(child, 'close');
  return { status, stdout, stderr };
}

test('CLI edits reply and composed drafts in place, simulates sending to isolated Sent, and restores persisted state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openjob-drafts-api-'));
  const stateFile = join(directory, 'state.json');
  let service;
  try {
    service = await start(stateFile);
    const call = (command, identity) => run(service.url, command, identity);
    const ok = async (command, identity) => {
      const result = await call(command, identity);
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout).data;
    };
    const deny = async (command, identity, code = /forbidden/) => {
      const result = await call(command, identity);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, code);
      assert.equal(result.stdout, '');
    };
    const reply = await ok({ type: 'mail.draft', messageId: 'alex_msg_launch', body: 'Initial reply fixture.' });
    const composed = await ok({ type: 'mail.compose', accountId: 'alex_outlook', to: 'reviewer@example.invalid', subject: 'Fixture review', body: 'Initial composed fixture.' });
    const edits = [
      { draft: reply, accountId: 'alex_gmail', to: 'mia@team.example.invalid', subject: 'Updated launch fixture', body: 'Edited reply, fixture only.' },
      { draft: composed, accountId: 'alex_outlook', to: 'reviewer@example.invalid', subject: 'Updated review fixture', body: 'Edited composed mail, fixture only.' },
    ];
    for (const { draft, accountId, to, subject, body } of edits) {
      const updated = await ok({ type: 'mail.draft.update', draftId: draft.id, to, subject, body });
      assert.equal(updated.id, draft.id);
      assert.equal(updated.accountId, accountId);
      assert.equal(updated.to, to); assert.equal(updated.subject, subject); assert.equal(updated.body, body);
    }
    let view = await ok();
    assert.equal(view.drafts.length, 2, 'editing preserves draft IDs and does not create duplicates');
    assert.deepEqual(view.sent, [], 'saving an edit never sends even to fixture Sent');
    await deny({ type: 'mail.draft.update', draftId: reply.id, accountId: 'alex_outlook', to: 'x@example.invalid', subject: 'Wrong mailbox', body: 'No account reassignment.' }, undefined, /invalid_input/);
    await deny({ type: 'mail.draft.update', draftId: reply.id, to: 'sam@example.invalid', subject: 'Private', body: 'Foreign edit.' }, { owner: 'demo_sam' });
    await deny({ type: 'mail.simulate-send', draftId: reply.id }, { owner: 'demo_sam' });
    await deny({ type: 'mail.send', draftId: reply.id }, undefined, /sending_disabled/);

    const grant = (name, scopes, resourceIds) => ok({ type: 'agent.grant', name, scopes, resourceIds });
    const reader = await grant('Fixture reader', ['mail:read'], ['alex_gmail']);
    const tasks = await grant('Fixture tasks only', ['tasks:read'], ['tasks:personal']);
    const drafter = await grant('Fixture drafter', ['mail:draft'], ['alex_gmail']);
    const simulatorOnly = await grant('Fixture simulator only', ['mail:simulate-send'], ['alex_gmail']);
    const otherAccount = await grant('Other fixture mailbox', ['mail:read', 'mail:draft', 'mail:simulate-send'], ['alex_imap']);
    const sender = await grant('Scoped fixture sender', ['mail:read', 'mail:draft', 'mail:simulate-send'], ['alex_gmail']);
    for (const agent of [reader, tasks, drafter, simulatorOnly, otherAccount]) {
      await deny({ type: 'mail.simulate-send', draftId: reply.id }, { agent: agent.id });
    }
    await deny({ type: 'mail.simulate-send', draftId: composed.id }, { agent: sender.id });
    const sentReply = await ok({ type: 'mail.simulate-send', draftId: reply.id }, { agent: sender.id });
    const sentComposed = await ok({ type: 'mail.simulate-send', draftId: composed.id });
    for (const [sent, edit] of [[sentReply, edits[0]], [sentComposed, edits[1]]]) {
      assert.equal(sent.mode, 'fixture');
      assert.equal(sent.accountId, edit.accountId);
      assert.equal(sent.to, edit.to); assert.equal(sent.subject, edit.subject); assert.equal(sent.body, edit.body);
      assert.ok(Number.isFinite(Date.parse(sent.sentAt)));
    }
    assert.equal(sentReply.from, 'alex@gmail.example.invalid');
    assert.equal(sentComposed.from, 'alex@outlook.example.invalid');
    await deny({ type: 'mail.simulate-send', draftId: reply.id }, undefined);
    view = await ok();
    assert.equal(view.sent.length, 2, 'a consumed draft cannot produce a second Sent item');
    assert.equal(view.drafts.length, 0);
    assert.deepEqual((await ok(null, { owner: 'demo_sam' })).sent, []);
    assert.deepEqual((await ok(null, { agent: tasks.id })).sent, []);
    assert.deepEqual((await ok(null, { agent: otherAccount.id })).sent, []);
    assert.deepEqual((await ok(null, { agent: reader.id })).sent.map(item => item.id), [sentReply.id]);

    const pending = await ok({ type: 'mail.compose', accountId: 'alex_gmail', to: 'pending@example.invalid', subject: 'Pending fixture', body: 'Must remain a draft.' });
    await ok({ type: 'agent.revoke', agentId: sender.id });
    await deny({ type: 'mail.simulate-send', draftId: pending.id }, { agent: sender.id }, /unauthorized/);
    await deny(null, { agent: sender.id }, /unauthorized/);
    assert.equal((await ok()).sent.length, 2);
    const saved = JSON.parse(await readFile(stateFile, 'utf8'));
    assert.equal(saved.sent.length, 2);
    assert.equal(saved.drafts[0].id, pending.id);
    await service.stop(); service = await start(stateFile);
    const restored = await ok();
    assert.deepEqual(restored.sent, saved.sent);
    assert.deepEqual(restored.drafts, saved.drafts);
    assert.equal(restored.agents.find(item => item.id === sender.id).revoked, true);
    await deny({ type: 'mail.send', draftId: pending.id }, undefined, /sending_disabled/);
  } finally {
    if (service) await service.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
