import { candidateIdentity } from '../distribution/channels.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';
import { publicationIdentity, verifyPublicationManifest, publicationDecision, verifyPublishingEnvironment, assertPublicationRuntime, verifyPublishedRelease, stableApprovalComment, verifyStableArtifactApproval } from '../distribution/publication.mjs';
const sha = '714e85062677aea5ef4e50e75994d61fa5cdb6b0';
const context = { repository: 'scwlkr/openjob', eventName: 'push', ref: 'refs/heads/main', sha };
const event = { repository: { full_name: context.repository }, after: sha };
const dev = publicationIdentity(context, event, '0.3.7', 1792157345);
const releaseEvent = { repository: event.repository, action: 'published', release: { id: 123, tag_name: 'v0.3.8', draft: false, prerelease: false, published_at: '2026-10-16T14:00:00Z' } };
const release = publicationIdentity({ ...context, eventName: 'release', ref: 'refs/tags/v0.3.8' }, releaseEvent, '0.3.8', 1792157345);
const manifest = identity => ({ name: identity.name, version: identity.version, repository: { url: 'git+https://github.com/scwlkr/openjob.git' }, publishConfig: { tag: identity.channel }, openjobDistribution: { version: identity.version, source: identity.source, ref: identity.ref, channel: identity.channel, registryVerified: true } });
const metadata = { name: dev.name, maintainers: [{ name: 'scwlkr' }], repository: manifest(dev).repository, 'dist-tags': { dev: '0.3.8-dev.1792154226.37c322be4d3d', latest: '0.3.7' } };
const integrity = 'sha512-approved';
test('publication only maps exact owning main pushes or published matching stable releases', () => {
  assert.equal(dev.environment, 'openjob-npm-dev'); assert.equal(release.environment, 'openjob-npm-release');
  for (const change of [{ eventName: 'pull_request' }, { ref: 'refs/heads/other' }, { repository: 'fork/openjob' }]) assert.throws(() => publicationIdentity({ ...context, ...change }, event, '0.3.7', 1792157345));
  for (const change of [{ draft: true }, { prerelease: true }, { tag_name: 'v0.3.7' }]) assert.throws(() => publicationIdentity({ ...context, eventName: 'release', ref: 'refs/tags/v0.3.8' }, { ...releaseEvent, release: { ...releaseEvent.release, ...change } }, '0.3.8', 1792157345));
  assert.throws(() => publicationIdentity(context, { ...event, deleted: true }, '0.3.7', 1792157345));
});
test('channel policy rejects downgrades, tag/version disagreement, wrong identity and conflicting bytes', () => {
  assert.equal(publicationDecision(dev, integrity, metadata, null), 'publish');
  assert.equal(publicationDecision(release, integrity, metadata, null), 'publish');
  const exact = { ...manifest(dev), dist: { integrity } }, current = { ...metadata, 'dist-tags': { ...metadata['dist-tags'], dev: dev.version } };
  assert.equal(publicationDecision(dev, integrity, current, exact), 'already_current');
  for (const [meta, existing] of [[metadata, exact], [current, { ...exact, dist: { integrity: 'other' } }], [{ ...metadata, maintainers: [] }, null], [{ ...metadata, 'dist-tags': { dev: '99.0.0-dev.1.abc' } }, null], [{ ...metadata, 'dist-tags': { dev: '0.3.8' } }, null]]) assert.throws(() => publicationDecision(dev, integrity, meta, existing));
  assert.throws(() => verifyPublicationManifest({ ...manifest(dev), publishConfig: { tag: 'latest' } }, dev));
  assert.throws(() => verifyPublicationManifest({ ...manifest(dev), openjobDistribution: { ...manifest(dev).openjobDistribution, source: 'a'.repeat(40) } }, dev));
});
function environment(channel) {
  return { id: 12, name: channel === 'dev' ? 'openjob-npm-dev' : 'openjob-npm-release', deployment_branch_policy: { custom_branch_policies: true, protected_branches: false }, protection_rules: channel === 'dev' ? [] : [{ type: 'required_reviewers', reviewers: [{ type: 'User', reviewer: { login: 'scwlkr', id: 206951249 } }] }] };
}
const policies = channel => ({ total_count: 1, branch_policies: [{ name: channel === 'dev' ? 'main' : 'v*', type: channel === 'dev' ? 'branch' : 'tag' }] });
test('existing environments must enforce exact refs and owner stable review', () => {
  for (const channel of ['dev', 'latest']) verifyPublishingEnvironment(channel, environment(channel), policies(channel));
  for (const change of [{ protection_rules: [] }, { deployment_branch_policy: null }]) assert.throws(() => verifyPublishingEnvironment('latest', { ...environment('latest'), ...change }, policies('latest')));
  assert.throws(() => verifyPublishingEnvironment('dev', environment('dev'), { total_count: 2, branch_policies: [...policies('dev').branch_policies, { name: '*', type: 'branch' }] }));
  assert.throws(() => verifyPublishedRelease(release, { ...releaseEvent.release, draft: true }, 123));
  verifyPublishedRelease(release, releaseEvent.release, 123);
});
test('publish command is unreachable outside explicitly enabled hosted OIDC and rejects token fallback', () => {
  const env = { OPENJOB_NPM_PUBLISHING_ENABLED: 'true', GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.invalid', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'fixture' };
  assertPublicationRuntime(env);
  for (const change of [{ OPENJOB_NPM_PUBLISHING_ENABLED: '' }, { GITHUB_ACTIONS: '' }, { RUNNER_ENVIRONMENT: 'self-hosted' }, { ACTIONS_ID_TOKEN_REQUEST_TOKEN: '' }, { NODE_AUTH_TOKEN: 'fixture' }, { NPM_TOKEN: 'fixture' }]) assert.throws(() => assertPublicationRuntime({ ...env, ...change }));
  assert.throws(() => execFileSync(process.execPath, ['scripts/npm-publication.mjs', 'publish', '/absent'], { env: { ...process.env, OPENJOB_NPM_PUBLISHING_ENABLED: '' }, stdio: 'pipe' }), error => /Publication is disabled/.test(error.stderr.toString()));
});
test('disabled workflow separates sealing from approved publication and preserves immutable artifacts on reruns', async () => {
  const workflow = YAML.parse(await readFile('.github/workflows/npm-publish.yml', 'utf8'));
  assert.deepEqual(workflow.on.push.branches, ['main']); assert.deepEqual(workflow.on.release.types, ['published']);
  assert.match(workflow.jobs.build.if, /OPENJOB_NPM_PUBLISHING_ENABLED/); assert.match(workflow.jobs.publish.if, /OPENJOB_NPM_PUBLISHING_ENABLED/);
  assert.equal(workflow.jobs.build.permissions, undefined); assert.equal(workflow.permissions['id-token'], undefined);
  assert.equal(workflow.jobs.publish.permissions['id-token'], 'write');
  const upload = workflow.jobs.build.steps.find(step => step.uses?.startsWith('actions/upload-artifact'));
  const download = workflow.jobs.publish.steps.find(step => step.uses?.startsWith('actions/download-artifact'));
  assert.equal(upload.with.name, '${{ steps.plan.outputs.artifact_name }}'); assert.equal(download.with.name, '${{ needs.build.outputs.artifact_name }}');
  assert.equal(upload.with.overwrite, undefined); assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.doesNotMatch(JSON.stringify(workflow), /secrets\.|NODE_AUTH_TOKEN|NPM_TOKEN/);
  const runner = await readFile('scripts/npm-publication.mjs', 'utf8'); assert.match(runner, /GITHUB_RUN_ATTEMPT/); assert.doesNotMatch(runner, /dist-tag.*add/);
});

test('next candidate is installation metadata, never a publishable stable tag', () => {
  const candidate = candidateIdentity({ baseVersion: '0.3.7', version: '0.3.8', sha });
  assert.equal(candidate.ref, 'candidate-unpublished/v0.3.8');
  for (const version of ['0.3.7', '0.3.6', '0.3.8-rc.1', 'garbage', '00.3.8']) assert.throws(() => candidateIdentity({ baseVersion: '0.3.7', version, sha }));
  assert.throws(() => verifyPublicationManifest({ ...manifest(release), openjobDistribution: { ...candidate, registryVerified: false } }, release));
});

test('stable owner approval binds run-scoped history to exact environment and artifact digest', () => {
  const env = environment('latest');
  const approval = { state: 'approved', user: { id: 206951249, login: 'scwlkr' }, comment: stableApprovalComment(release, integrity), environments: [{ id: env.id, name: env.name }] };
  verifyStableArtifactApproval(release, integrity, env, [approval]);
  for (const change of [{ state: 'rejected' }, { user: { id: 1, login: 'scwlkr' } }, { user: { id: 206951249, login: 'other' } }, { comment: 'Ship it!' }, { environments: [{ id: 13, name: env.name }] }, { environments: [{ id: env.id, name: 'other' }] }]) assert.throws(() => verifyStableArtifactApproval(release, integrity, env, [{ ...approval, ...change }]));
  assert.throws(() => verifyStableArtifactApproval(release, 'sha512-other', env, [approval]));
  assert.throws(() => verifyStableArtifactApproval(release, integrity, env, []));
  for (const history of [[approval, { ...approval, state: 'rejected' }], [{ ...approval, state: 'rejected' }, approval]]) assert.throws(() => verifyStableArtifactApproval(release, integrity, env, history));
  assert.throws(() => verifyStableArtifactApproval(release, integrity, { ...env, id: undefined }, [approval]));
});
