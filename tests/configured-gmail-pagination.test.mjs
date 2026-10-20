import assert from 'node:assert/strict';
import test from 'node:test';
import { googleFlowFixture } from './support/google-connection-flow.mjs';
import { onboardingFixture } from './support/onboarding-app-fixture.mjs';

async function fixture() {
  const f = await googleFlowFixture(), calls = [];
  f.hooks.mail = url => { calls.push(url); };
  f.hooks.response = url => {
    if (url.pathname.endsWith('/messages')) {
      assert.equal(url.searchParams.get('maxResults'), '10');
      const token = url.searchParams.get('pageToken');
      assert.ok(token === null || token === 'invented-second-page');
      return Response.json(token ? { messages: [{ id: 'm11', threadId: 't11' }] } : { messages: Array.from({ length: 10 }, (_, i) => ({ id: `m${i + 1}`, threadId: `t${i + 1}` })), nextPageToken: 'invented-second-page' });
    }
    const match = /\/messages\/(m\d+)$/.exec(url.pathname);
    if (match) return f.hooks.deleted && match[1] === 'm11' ? new Response(null, { status: 404 }) : Response.json({ id: match[1], threadId: match[1].replace('m', 't'), internalDate: '1792500000000', labelIds: ['INBOX'], payload: { mimeType: 'text/plain', headers: [{ name: 'Subject', value: `Invented ${match[1]}` }], body: { data: Buffer.from(`Invented body ${match[1]}`).toString('base64url') } } });
  };
  const start = await f.begin(); await f.complete(start);
  const path = `/${start.connectionId}/mail`;
  return { ...f, start, calls, path };
}
const withCursor = (path, cursor) => `${path}?${new URLSearchParams({ cursor })}`;

test('configured signed Mail exposes the eleventh message and exact page-two Task source through bounded cursor', async () => {
  const f = await fixture(), first = await f.call(f.path);
  assert.equal(first.page.messages.length, 10); assert.ok(first.page.nextCursor);
  f.reconstruct();
  const second = await f.call(withCursor(f.path, first.page.nextCursor));
  assert.equal(second.page.messages.length, 1); assert.equal(second.page.messages[0].upstreamId, 'm11'); assert.equal(second.page.nextCursor, null);
  assert.equal(f.calls.filter(url => url.pathname.endsWith('/messages')).at(-1).searchParams.get('pageToken'), 'invented-second-page');
  const task = await f.flow.createTask(f.owner, f.start.connectionId, { messageId: 'm11', title: 'Authored page-two work' });
  await f.call(f.path);
  assert.equal((await f.flow.taskSource(f.owner, f.home, task.taskId)).message.body, 'Invented body m11');
  f.hooks.deleted = true;
  await assert.rejects(f.flow.taskSource(f.owner, f.home, task.taskId));
  assert.equal((await f.owned.snapshot(f.owner, f.home)).work.tasks.find(row => row.id === task.taskId).title, 'Authored page-two work');
  assert.doesNotMatch(JSON.stringify(f.db.exportState()), /Invented body m11/);
});

test('strict Mail-only cursor query rejects malformed, duplicate, unknown and cross-account inputs before Gmail traffic', async () => {
  const f = await fixture(), first = await f.call(f.path), cursor = first.page.nextCursor;
  f.calls.length = 0;
  for (const query of ['cursor=', 'cursor=bad', `cursor=${'a'.repeat(4097)}`, `cursor=${cursor}&cursor=${cursor}`, `cursor=${cursor}&unknown=secret`, 'unknown=secret']) {
    assert.equal((await f.request(`${f.path}?${query}`)).status, 400);
  }
  for (const field of ['owner', 'account', 'subject']) {
    const payload = JSON.parse(Buffer.from(cursor.slice(4), 'base64url'));
    payload[field] = 'foreign';
    const foreign = `gm3.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
    const response = await f.request(withCursor(f.path, foreign));
    assert.equal(response.status, 400); const body = await response.json();
    assert.equal(body.error.code, 'invalid_cursor'); assert.match(body.error.message, /first page/);
    assert.equal(JSON.stringify(body).includes(foreign), false);
  }
  for (const path of ['', '/session', '/google/callback', `/${f.start.connectionId}`, `/${f.start.connectionId}/tasks`]) assert.equal((await f.request(withCursor(path, cursor))).status, 400);
  assert.equal((await f.request(withCursor(f.path, cursor), { action: 'disconnect' })).status, 400);
  assert.equal((await f.request(withCursor(f.path, cursor), undefined, 'sam')).status, 403);
  assert.equal((await f.request(withCursor(f.path, cursor), undefined, 'oj_invented')).status, 401);
  assert.equal((await f.request(withCursor(f.path, cursor), undefined, 'alex', f.googleApi, { origin: 'https://foreign.invalid' })).status, 400);
  assert.equal(f.calls.length, 0);
  const simulated = await onboardingFixture();
  assert.equal((await simulated.api.fetch(new Request('https://fixture.invalid/api/v1/connections/con_' + 'a'.repeat(32) + '/mail?cursor=' + cursor, { headers: { authorization: `Bearer ${simulated.sessions.alex.token}` } }))).status, 400);
});

test('disconnect denies a next-page request already in flight and all subsequent page reads', async () => {
  const f = await fixture(), first = await f.call(f.path);
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), waiting = new Promise(resolve => { entered = resolve; });
  f.hooks.mail = async url => { f.calls.push(url); if (url.searchParams.has('pageToken')) { entered(); await gate; } };
  const reading = f.request(withCursor(f.path, first.page.nextCursor)); await waiting;
  await f.flow.act(f.owner, f.start.connectionId, 'disconnect'); release();
  assert.notEqual((await reading).status, 200);
  f.calls.length = 0;
  assert.equal((await f.request(withCursor(f.path, first.page.nextCursor))).status, 409);
  assert.equal(f.calls.length, 0);
});
