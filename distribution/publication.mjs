import { artifactIdentity, NPM_PACKAGE_NAME } from './channels.mjs';
import { compareSemVer, parseSemVer } from '../lib/semver.ts';
export const PUBLISH_REPOSITORY = 'scwlkr/openjob';
export const PUBLISH_WORKFLOW = 'npm-publish.yml';
export const PUBLISH_ENVIRONMENTS = { dev: 'openjob-npm-dev', latest: 'openjob-npm-release' };
const fail = message => { throw new Error(message); };
export function publicationIdentity(context, event, baseVersion, timestamp) {
  if (context.repository !== PUBLISH_REPOSITORY || event.repository?.full_name !== PUBLISH_REPOSITORY) fail('Only the owning repository may publish.');
  let channel, ref;
  if (context.eventName === 'push' && context.ref === 'refs/heads/main' && event.deleted !== true && event.after === context.sha) { channel = 'dev'; ref = context.ref; }
  else if (context.eventName === 'release' && event.action === 'published' && event.release?.draft === false && event.release.prerelease === false) { channel = 'latest'; ref = `refs/tags/${event.release.tag_name}`; if (context.ref !== ref) fail('Release ref mismatch.'); }
  else fail('Only main pushes and published stable releases are eligible.');
  return { ...artifactIdentity({ channel, ref, sha: context.sha, baseVersion, timestamp }), name: NPM_PACKAGE_NAME, environment: PUBLISH_ENVIRONMENTS[channel] };
}
export function verifyRegistryOwner(metadata) {
  if (metadata?.name !== NPM_PACKAGE_NAME || !metadata.maintainers?.some(item => item.name === 'scwlkr') || metadata.repository?.url !== 'git+https://github.com/scwlkr/openjob.git') fail('Registry identity does not match the verified owner/repository.');
}
export function verifyPublicationManifest(pkg, identity) {
  const meta = pkg?.openjobDistribution;
  if (pkg?.name !== NPM_PACKAGE_NAME || pkg.version !== identity.version || pkg.private || pkg.repository?.url !== 'git+https://github.com/scwlkr/openjob.git' || pkg.publishConfig?.tag !== identity.channel || meta?.source !== identity.source || meta.ref !== identity.ref || meta.channel !== identity.channel || meta.version !== identity.version || meta.registryVerified !== true) fail('Artifact identity/channel is not the exact verified publication plan.');
}
export function publicationDecision(identity, integrity, metadata, exact) {
  verifyRegistryOwner(metadata);
  const current = metadata['dist-tags']?.[identity.channel];
  const parsed = parseSemVer(current ?? '');
  if (!parsed || (identity.channel === 'latest' ? parsed.prerelease.length !== 0 : !current.includes('-dev.'))) fail('Current registry tag is invalid; require owner review.');
  const comparison = compareSemVer(identity.version, current);
  if (comparison === null || comparison < 0) fail('Refusing to move a channel backwards.');
  if (exact) {
    verifyPublicationManifest(exact, identity);
    if (exact.dist?.integrity !== integrity || current !== identity.version) fail('Existing version or dist-tag differs; inspect without republishing or moving tags.');
    return 'already_current';
  }
  if (comparison === 0) fail('Tag/version metadata disagree; inspect before publication.');
  return 'publish';
}
export function verifyPublishingEnvironment(channel, environment, policies) {
  const name = PUBLISH_ENVIRONMENTS[channel];
  if (environment?.name !== name || environment.deployment_branch_policy?.custom_branch_policies !== true || environment.deployment_branch_policy.protected_branches !== false) fail('Publishing environment must already have explicit ref restrictions.');
  const expected = channel === 'dev' ? { name: 'main', type: 'branch' } : { name: 'v*', type: 'tag' };
  if (policies?.total_count !== 1 || policies.branch_policies?.length !== 1 || policies.branch_policies[0].name !== expected.name || policies.branch_policies[0].type !== expected.type) fail('Publishing environment has unexpected allowed refs.');
  if (channel === 'latest') {
    if (environment.can_admins_bypass !== false) fail('Stable approval cannot permit administrator bypass.');
    const rule = environment.protection_rules?.find(item => item.type === 'required_reviewers');
    if (!rule || rule.reviewers?.length !== 1 || rule.reviewers[0].type !== 'User' || rule.reviewers[0].reviewer?.id !== 206951249 || rule.reviewers[0].reviewer.login !== 'scwlkr') fail('Stable publication requires the owner environment reviewer.');
  }
}

export function assertPublicationRuntime(env) {
  if (env.OPENJOB_NPM_PUBLISHING_ENABLED !== 'true' || env.GITHUB_ACTIONS !== 'true' || env.RUNNER_ENVIRONMENT !== 'github-hosted' || !env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN || env.NODE_AUTH_TOKEN || env.NPM_TOKEN) fail('Publication is disabled outside the explicitly enabled hosted OIDC job; no token fallback.');
}
export function verifyPublishedRelease(identity, release, expectedId) {
  if (!Number.isSafeInteger(expectedId) || expectedId < 1 || release?.id !== expectedId || release.tag_name !== identity.ref.slice('refs/tags/'.length) || release.draft !== false || release.prerelease !== false || !release.published_at) fail('The approved stable release is no longer published at its exact tag.');
}
