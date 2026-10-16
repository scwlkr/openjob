import { artifactIdentity, NPM_PACKAGE_NAME } from './channels.mjs';
import { compareSemVer, parseSemVer } from '../lib/semver.ts';
const fail = message => { throw new Error(message); };
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

export function localPublicationIdentity({ channel, baseVersion, source, timestamp }) {
  return { ...artifactIdentity({ channel, baseVersion, sha: source, timestamp, ref: channel === 'dev' ? 'refs/heads/main' : `refs/tags/v${baseVersion}` }), name: NPM_PACKAGE_NAME };
}
export function assertLocalPublish(env, approval, integrity) {
  if (env.CI || env.GITHUB_ACTIONS || !integrity || approval !== integrity) fail('Publish requires a local interactive run and explicit approval of the exact integrity.');
}
