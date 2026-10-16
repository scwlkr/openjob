import test from 'node:test';
import assert from 'node:assert/strict';
import { mailLinkedTasks } from '../app/workspace/workspace-links.ts';
const own = { id: 'one', ownerId: 'alex', title: 'First', completed: false, sourceAccountId: 'mail', sourceMessageId: 'message' };
const view = { accounts: [{ id: 'mail', ownerId: 'alex' }], messages: [{ id: 'message', accountId: 'mail' }], tasks: [own, { ...own, id: 'two', completed: true }, { ...own, id: 'foreign', ownerId: 'sam' }, { ...own, id: 'wrong-account', sourceAccountId: 'other' }, { ...own, id: 'wrong-message', sourceMessageId: 'other' }, { ...own, id: 'unlinked', sourceMessageId: undefined }] };
test('Mail links resolve only exact owner account and message pairs, including completed Tasks', () => {
  assert.deepEqual(mailLinkedTasks(view, { accountId: 'mail', messageId: 'message' }).map(item => item.id), ['one', 'two']);
  for (const input of [{ accountId: 'missing', messageId: 'message' }, { accountId: 'mail', messageId: 'missing' }]) assert.deepEqual(mailLinkedTasks(view, input), []);
  assert.deepEqual(mailLinkedTasks({ ...view, accounts: [] }, { accountId: 'mail', messageId: 'message' }), []);
  assert.deepEqual(mailLinkedTasks({ ...view, messages: [{ id: 'message', accountId: 'other' }] }, { accountId: 'mail', messageId: 'message' }), []);
});
