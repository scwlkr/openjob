import assert from 'node:assert/strict';
import test from 'node:test';
import { googleFlowFixture } from './support/google-connection-flow.mjs';
const pathFor = (id, query) => `/${id}/mail?${new URLSearchParams(query)}`;

test('configured submitted search scopes pages and cursors, recovers rejected/stale queries and preserves exact saved source', async () => {
  const f = await googleFlowFixture(), calls = [];
  let stale = false;
  f.hooks.mail = url => { calls.push(url); };
  f.hooks.response = url => {
    if (url.pathname.endsWith('/messages')) {
      const q = url.searchParams.get('q');
      if (q === 'reject') return new Response('SECRET_PROVIDER_BODY reject', { status: 400 });
      if (stale && url.searchParams.has('pageToken')) return new Response('SECRET_PROVIDER_BODY stale', { status: 400 });
      return Response.json(q === 'missing' ? { messages: [] } : { messages: [{ id: 'm1', threadId: 't1' }], ...(url.searchParams.has('pageToken') ? {} : { nextPageToken: 'invented-search-next' }) });
    }
  };
  const start = await f.begin(); await f.complete(start);
  const query = 'from:"café 日本語" & subject:proposal';
  const first = await f.call(pathFor(start.connectionId, { search: query }));
  assert.equal(first.page.messages.length, 1); assert.ok(first.page.nextCursor);
  const folderId = first.page.folders[0].id;
  await f.call(pathFor(start.connectionId, { cursor: first.page.nextCursor, search: query }));
  assert.ok(calls.filter(url => url.pathname.endsWith('/messages')).every(url => url.searchParams.get('q') === query));
  const filtered = await f.call(pathFor(start.connectionId, { search: query, folderId }));
  await f.call(pathFor(start.connectionId, { cursor: filtered.page.nextCursor, folderId, search: query }));
  const scoped = calls.filter(url => url.pathname.endsWith('/messages')).at(-1); assert.equal(scoped.searchParams.get('labelIds'), 'INBOX');
  calls.length = 0;
  for (const search of ['different', undefined]) assert.equal((await f.request(pathFor(start.connectionId, { cursor: first.page.nextCursor, ...(search ? { search } : {}) }))).status, 400);
  for (const queryString of ['search=', 'search=%20%20', 'search=bad%0Aquery', `search=${'x'.repeat(513)}`, 'search=x&search=x', 'search=x&unknown=1']) assert.equal((await f.request(`/${start.connectionId}/mail?${queryString}`)).status, 400);
  for (const path of ['', '/session', `/${start.connectionId}/tasks`]) assert.equal((await f.request(`${path}?search=private`)).status, 400);
  assert.equal((await f.request(pathFor(start.connectionId, { search: query }), undefined, 'sam')).status, 403);
  assert.equal((await f.request(pathFor(start.connectionId, { search: query }), undefined, 'oj_invented')).status, 401);
  assert.equal(calls.length, 0);
  const rejected = await f.request(pathFor(start.connectionId, { search: 'reject' })); assert.equal(rejected.status, 400);
  const failure = await rejected.json(); assert.equal(failure.error.code, 'search_rejected'); assert.doesNotMatch(JSON.stringify(failure), /SECRET_PROVIDER_BODY/);
  stale = true;
  const expired = await f.request(pathFor(start.connectionId, { search: query, cursor: first.page.nextCursor })); assert.equal(expired.status, 400); assert.equal((await expired.json()).error.code, 'invalid_cursor');
  assert.equal((await f.call(pathFor(start.connectionId, { search: query }))).page.messages.length, 1);
  const task = await f.flow.createTask(f.owner, start.connectionId, { messageId: 'm1', title: 'Keep authored work outside search' });
  assert.deepEqual((await f.call(pathFor(start.connectionId, { search: 'missing' }))).page.messages, []);
  f.reconstruct();
  assert.equal((await f.flow.taskSource(f.owner, f.home, task.taskId)).message.body, 'Invented connected message.');
  assert.equal((await f.owned.snapshot(f.owner, f.home)).work.tasks.find(row => row.id === task.taskId).title, 'Keep authored work outside search');
  assert.equal(JSON.stringify(f.db.exportState()).includes(query), false);
  await f.flow.act(f.owner, start.connectionId, 'disconnect'); calls.length = 0;
  assert.equal((await f.request(pathFor(start.connectionId, { search: query }))).status, 409); assert.equal(calls.length, 0);
});
