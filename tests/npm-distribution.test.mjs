import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { artifactIdentity, sourceRef } from '../distribution/channels.mjs';
import { selectedChannel, newerVersion, checkForUpdates, updateNotice } from '../cli/lib/updates.mjs';
const sha = '5358f6cc0c030d478aafea7d4762fdab68d799e3';
const base = { baseVersion: '0.3.7', sha, timestamp: 1792144983 };
test('release mapping rejects main, mismatched tags and prereleases', () => {
  assert.equal(artifactIdentity({ ...base, channel: 'latest', ref: 'refs/tags/v0.3.7' }).version, '0.3.7');
  for (const ref of ['refs/heads/main', 'refs/tags/v0.3.8', 'refs/tags/v0.3.7-dev.1']) assert.throws(() => artifactIdentity({ ...base, channel: 'latest', ref }));
});
test('dev maps only exact main source to next-patch timestamp and SHA', () => {
  const identity = artifactIdentity({ ...base, channel: 'dev', ref: 'refs/heads/main' });
  assert.equal(identity.version, '0.3.8-dev.1792144983.5358f6cc0c03');
  assert.equal(identity.source, sha);
  assert.throws(() => artifactIdentity({ ...base, channel: 'dev', ref: 'refs/heads/feature' }));
  assert.throws(() => artifactIdentity({ ...base, timestamp: NaN, channel: 'dev', ref: 'refs/heads/main' }));
});
test('channel comes from immutable artifact metadata or source version', () => {
  assert.equal(selectedChannel({ version: '0.3.7' }), 'latest');
  assert.equal(selectedChannel({ version: '0.3.8-dev.1.abc' }), 'dev');
  assert.equal(selectedChannel({ version: '0.3.7', openjobDistribution: { channel: 'dev' } }), 'dev');
  assert.throws(() => selectedChannel({ openjobDistribution: { channel: 'beta' } }));
});
test('semver compares numeric prereleases, stable releases and invalid registry versions', () => {
  for (const [next, current] of [['0.3.8', '0.3.7'], ['0.3.8-dev.10.5358abc', '0.3.8-dev.9.abc'], ['0.3.8', '0.3.8-dev.10.abc']]) assert.equal(newerVersion(next, current), true);
  for (const [next, current] of [['0.3.7', '0.3.7'], ['0.3.6', '0.3.7'], ['0.3.8-dev.9.abc', '0.3.8'], ['garbage', '0.3.7'], ['0.3.8-dev.01', '0.3.7']]) assert.equal(newerVersion(next, current), false);
});
test('checks retain dev even when latest is newer and never install or switch', async () => {
  const pkg = { name: 'openjob', version: '0.3.8-dev.9.abc', openjobDistribution: { channel: 'dev' } };
  const before = structuredClone(pkg); let calls = 0;
  const fetchImplementation = async (url, init) => {
    calls++; assert.equal(url, 'https://registry.npmjs.org/-/package/openjob/dist-tags'); assert.equal(init.redirect, 'error'); assert.deepEqual(init.headers, { accept: 'application/json' });
    return Response.json({ latest: '9.0.0', dev: '0.3.8-dev.10.5358f6cc0c03' });
  };
  for (let i = 0; i < 2; i++) {
    const result = await checkForUpdates(pkg, { fetchImplementation });
    assert.equal(result.channel, 'dev'); assert.equal(result.status, 'update_available');
    assert.match(updateNotice(result), /npm install -g openjob@dev/);
  }
  assert.deepEqual(pkg, before); assert.equal(calls, 2);
});
test('offline, HTTP errors, invalid tags, downgrades and equal versions are quiet', async () => {
  const pkg = { name: 'openjob', version: '0.3.7' };
  for (const fetchImplementation of [async () => { throw new Error('offline'); }, async () => new Response('', { status: 404 }), async () => Response.json({ latest: '0.3.8-dev.1' }), async () => Response.json({ latest: 'bad\ncommand' })]) {
    const result = await checkForUpdates(pkg, { fetchImplementation }); assert.equal(result.status, 'unavailable'); assert.equal(updateNotice(result), '');
  }
  for (const version of ['0.3.7', '0.3.6']) assert.equal((await checkForUpdates(pkg, { fetchImplementation: async () => Response.json({ latest: version }) })).status, 'current');
});
test('artifact workflow tracks main and published releases without registry publication', async () => {
  const source = await readFile(new URL('../.github/workflows/npm-artifacts.yml', import.meta.url), 'utf8');
  assert.match(source, /branches: \[main\]/); assert.match(source, /types: \[published\]/); assert.match(source, /release\.prerelease/);
  assert.doesNotMatch(source, /^\s*run:.*npm publish/m);
});

test('detached main checkout resolves through fetched origin/main; tags remain exact', () => {
  assert.equal(sourceRef('refs/heads/main'), 'refs/remotes/origin/main');
  assert.equal(sourceRef('refs/tags/v0.3.7'), 'refs/tags/v0.3.7');
});
