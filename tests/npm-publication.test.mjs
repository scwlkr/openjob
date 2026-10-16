import { candidateIdentity } from '../distribution/channels.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';
import { localPublicationIdentity, verifyPublicationManifest, publicationDecision, assertLocalPublish } from '../distribution/publication.mjs';
const sha = '714e85062677aea5ef4e50e75994d61fa5cdb6b0';
const dev = localPublicationIdentity({ channel: 'dev', baseVersion: '0.3.7', source: sha, timestamp: 1792157345 });
const release = localPublicationIdentity({ channel: 'latest', baseVersion: '0.3.8', source: sha, timestamp: 1792157345 });
const manifest = identity => ({ name: identity.name, version: identity.version, repository: { url: 'git+https://github.com/scwlkr/openjob.git' }, publishConfig: { tag: identity.channel }, openjobDistribution: { version: identity.version, source: identity.source, ref: identity.ref, channel: identity.channel, registryVerified: true } });
const metadata = { name: dev.name, maintainers: [{ name: 'scwlkr' }], repository: manifest(dev).repository, 'dist-tags': { dev: '0.3.8-dev.1792154226.37c322be4d3d', latest: '0.3.7' } };
const integrity = 'sha512-approved';
test('channel policy rejects downgrades, tag/version disagreement, wrong identity and conflicting bytes', () => {
  assert.equal(publicationDecision(dev, integrity, metadata, null), 'publish');
  assert.equal(publicationDecision(release, integrity, metadata, null), 'publish');
  const exact = { ...manifest(dev), dist: { integrity } }, current = { ...metadata, 'dist-tags': { ...metadata['dist-tags'], dev: dev.version } };
  assert.equal(publicationDecision(dev, integrity, current, exact), 'already_current');
  for (const [meta, existing] of [[metadata, exact], [current, { ...exact, dist: { integrity: 'other' } }], [{ ...metadata, maintainers: [] }, null], [{ ...metadata, 'dist-tags': { dev: '99.0.0-dev.1.abc' } }, null], [{ ...metadata, 'dist-tags': { dev: '0.3.8' } }, null]]) assert.throws(() => publicationDecision(dev, integrity, meta, existing));
  assert.throws(() => verifyPublicationManifest({ ...manifest(dev), publishConfig: { tag: 'latest' } }, dev));
  assert.throws(() => verifyPublicationManifest({ ...manifest(dev), openjobDistribution: { ...manifest(dev).openjobDistribution, source: 'a'.repeat(40) } }, dev));
});

test('local identities retain exact main/dev and stable version/tag mapping', () => {
  assert.equal(dev.ref, 'refs/heads/main'); assert.equal(release.ref, 'refs/tags/v0.3.8');
  assert.throws(() => localPublicationIdentity({ channel: 'other', baseVersion: '0.3.8', source: sha, timestamp: 1 }));
});
test('publication requires explicit exact artifact approval and rejects hosted/background CI', () => {
  assertLocalPublish({}, integrity, integrity);
  for (const env of [{ CI: 'true' }, { GITHUB_ACTIONS: 'true' }]) assert.throws(() => assertLocalPublish(env, integrity, integrity));
  for (const approval of [undefined, '', 'sha512-other']) assert.throws(() => assertLocalPublish({}, approval, integrity));
  assert.throws(() => execFileSync(process.execPath, ['scripts/npm-publication.mjs', 'publish', '/absent'], { stdio: 'pipe' }), error => /Publishing requires separate owner approval/.test(error.stderr.toString()));
});
test('Actions are manual artifact-only; local publisher preserves authentication and never retries writes', async () => {
  const workflow = YAML.parse(await readFile('.github/workflows/npm-artifacts.yml', 'utf8'));
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  await assert.rejects(readFile('.github/workflows/npm-publish.yml'));
  const runner = await readFile('scripts/npm-publication.mjs', 'utf8');
  assert.doesNotMatch(runner, /NODE_AUTH_TOKEN|NPM_TOKEN|id-token|npm trust|dist-tag.*add|--otp/);
  assert.match(runner, /'whoami'/); assert.match(runner, /'--tag', identity.channel/);
  assert.match(runner, /smoke-npm-app/); assert.doesNotMatch(runner, /--userconfig/);
});
test('candidate cannot satisfy a stable publication manifest', () => {
  const candidate = candidateIdentity({ baseVersion: '0.3.7', version: '0.3.8', sha });
  assert.equal(candidate.ref, 'candidate-unpublished/v0.3.8');
  for (const version of ['0.3.7', '0.3.6', '0.3.8-rc.1', 'garbage', '00.3.8']) assert.throws(() => candidateIdentity({ baseVersion: '0.3.7', version, sha }));
  assert.throws(() => verifyPublicationManifest({ ...manifest(release), openjobDistribution: { ...candidate, registryVerified: false } }, release));
});
