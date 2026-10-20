import assert from 'node:assert/strict';
import test from 'node:test';
import { googleFlowFixture } from './support/google-connection-flow.mjs';
const pathFor = (id, query) => `/${id}/mail?${new URLSearchParams(query)}`;

test('configured folder + cursor forwarding stays bound; label movement/removal preserves exact Task source', async () => {
  const f = await googleFlowFixture(), calls = [];
  let moved = false, removed = false;
  f.hooks.mail = url => { calls.push(url); };
  f.hooks.response = url => {
    if (url.pathname.endsWith('/labels')) return Response.json({ labels: [...(removed ? [] : [{ id: 'INBOX', name: 'Inbox' }]), { id: 'Label_review', name: 'Review' }] });
    if (url.pathname.endsWith('/messages')) {
      const label = url.searchParams.get('labelIds');
      assert.ok(label === null || label === 'INBOX' || label === 'Label_review');
      return Response.json(url.searchParams.has('pageToken') ? { messages: [] } : { messages: moved && label === 'INBOX' ? [] : [{ id: 'm1', threadId: 't1' }], nextPageToken: 'invented-folder-next' });
    }
    if (url.pathname.endsWith('/messages/m1')) return Response.json({ id: 'm1', threadId: 't1', internalDate: '1792500000000', labelIds: moved ? ['Label_review'] : ['INBOX'], payload: { mimeType: 'text/plain', headers: [{ name: 'Subject', value: 'Move-safe synthetic source' }], body: { data: Buffer.from('Invented move-safe body.').toString('base64url') } } });
  };
  const start = await f.begin(); await f.complete(start);
  const catalog = (await f.call(`/${start.connectionId}/mail`)).page.folders;
  const inbox = catalog.find(row => row.upstreamId === 'INBOX').id, review = catalog.find(row => row.upstreamId === 'Label_review').id;
  const first = await f.call(pathFor(start.connectionId, { folderId: inbox })); assert.equal(first.page.messages.length, 1);
  assert.equal((await f.call(pathFor(start.connectionId, { cursor: first.page.nextCursor, folderId: inbox }))).page.messages.length, 0);
  assert.equal(calls.filter(url => url.pathname.endsWith('/messages')).at(-1).searchParams.get('pageToken'), 'invented-folder-next');
  calls.length = 0;
  for (const folderId of [review, undefined]) {
    const response = await f.request(pathFor(start.connectionId, { cursor: first.page.nextCursor, ...(folderId ? { folderId } : {}) }));
    assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'invalid_cursor');
  }
  for (const query of [`folderId=${encodeURIComponent(inbox)}&folderId=${encodeURIComponent(inbox)}`, 'folderId=', 'folderId=INBOX', 'folderId=foreign:folder:INBOX', `folderId=${encodeURIComponent(inbox)}&unknown=1`]) assert.equal((await f.request(`/${start.connectionId}/mail?${query}`)).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await f.request(pathFor(start.connectionId, { folderId: inbox }), undefined, 'sam')).status, 403);
  assert.equal((await f.request(pathFor(start.connectionId, { folderId: inbox }), undefined, 'oj_invented')).status, 401);
  const task = await f.flow.createTask(f.owner, start.connectionId, { messageId: 'm1', title: 'Keep authored work when source moves' });
  moved = true;
  assert.deepEqual((await f.call(pathFor(start.connectionId, { folderId: inbox }))).page.messages, []);
  assert.equal((await f.call(pathFor(start.connectionId, { folderId: review }))).page.messages[0].upstreamId, 'm1');
  removed = true;
  const missing = await f.request(pathFor(start.connectionId, { folderId: inbox })); assert.equal(missing.status, 404); const failure = (await missing.json()).error; assert.equal(failure.code, 'folder_unavailable'); assert.match(failure.message, /All Mail/);
  f.reconstruct();
  assert.equal((await f.flow.taskSource(f.owner, f.home, task.taskId)).message.body, 'Invented move-safe body.');
  assert.equal((await f.owned.snapshot(f.owner, f.home)).work.tasks.find(row => row.id === task.taskId).title, 'Keep authored work when source moves');
  assert.doesNotMatch(JSON.stringify(f.db.exportState()), /Invented move-safe body/);
  await f.flow.act(f.owner, start.connectionId, 'disconnect'); calls.length = 0;
  assert.equal((await f.request(pathFor(start.connectionId, { folderId: review }))).status, 409); assert.equal(calls.length, 0);
});
