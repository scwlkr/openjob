import { createHash } from 'node:crypto';
import { localPublicationIdentity } from './publication.mjs';

// This is an approval receipt, not permission to publish future versions.
// Adding/changing a receipt requires owner authorization and source review.
export const approvedPublication = Object.freeze({
  name: '@scwlkr/openjob', registry: 'https://registry.npmjs.org', channel: 'dev',
  version: '0.3.8-dev.1792161876.9ba3929fbf0c',
  source: '9ba3929fbf0ccc3e24e2577410a355fa3798736e',
  integrity: 'sha512-XHe/R52kjuZnrHwPuKaElHJqnYfAdGrLOZwGrowoRRsXUyYgCRE37zHdo3J6z7NsY0lLEkVH9J81bqOk73D5Kg==',
  approvedAt: '2026-10-16T14:52:00Z',
  approvalReference: 'linear:WLK-307/comment/457f8b14-a961-4018-8a66-22203aa6cf8d',
});

export function verifyApprovedPlan(plan, bytes, originalSource, receipt = approvedPublication) {
  const identity = localPublicationIdentity({ channel: receipt.channel, ...originalSource });
  const expected = { version: receipt.version, channel: receipt.channel, source: receipt.source, ref: 'refs/heads/main', name: receipt.name };
  if (receipt.channel !== 'dev' || receipt.registry !== 'https://registry.npmjs.org' || receipt.name !== '@scwlkr/openjob'
    || !receipt.approvalReference || !receipt.approvedAt || plan?.publishable !== true
    || plan.filename !== `scwlkr-openjob-${receipt.version}.tgz`
    || !plan.identity || Object.keys(plan.identity).sort().join(',') !== Object.keys(expected).sort().join(',')
    || Object.entries(expected).some(([key, value]) => plan.identity[key] !== value || identity[key] !== value)
    || plan.integrity !== receipt.integrity || !bytes.length || bytes.length > 5 * 1024 * 1024
    || `sha512-${createHash('sha512').update(bytes).digest('base64')}` !== receipt.integrity) {
    throw new Error('Plan/bytes/source do not match the recorded owner-approved artifact. No publication attempted.');
  }
  return identity;
}

export function verifyApprovedProvenance({ runner, remoteMain, ancestor, clean }) {
  if (!/^[a-f0-9]{40}$/.test(runner) || runner !== remoteMain || !ancestor || !clean) {
    throw new Error('Resume requires a clean current-main publisher and approved artifact source in main history.');
  }
}

export function approvedPublishArgs(tarball) {
  return ['publish', tarball, '--access', 'public', '--tag', approvedPublication.channel,
    `--registry=${approvedPublication.registry}`, '--ignore-scripts', '--fetch-retries=0'];
}

// Both CLI modes use the same last-minute registry/provenance checks. No retry.
export async function completeApprovedPublication({ mode, decision, provenance, checkLogin, publish }) {
  if (!['check', 'publish'].includes(mode)) throw new Error('Unsupported publication operation.');
  if (mode === 'publish') await checkLogin();
  const status = await decision();
  await provenance();
  if (mode === 'check') return status === 'publish' ? 'ready_for_owner_npm_authentication' : status;
  if (status === 'publish') await publish();
  if (await decision() !== 'already_current') throw new Error('Readback unconfirmed. Inspect registry; never automatically replay a publish.');
  return status === 'publish' ? 'published_verified' : status;
}
