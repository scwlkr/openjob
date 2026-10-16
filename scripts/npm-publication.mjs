// Default mode prepares an immutable plan; only an explicitly enabled hosted OIDC job can publish.
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, resolve, dirname } from 'node:path';
import { publicationIdentity, verifyRegistryOwner, verifyPublicationManifest, publicationDecision, verifyPublishingEnvironment, PUBLISH_ENVIRONMENTS, assertPublicationRuntime, verifyPublishedRelease } from '../distribution/publication.mjs';

const [mode, target] = process.argv.slice(2);
if (!['prepare', 'publish'].includes(mode) || !target) throw new Error('Use npm-publication.mjs prepare DIST_DIRECTORY | publish PLAN_JSON.');
if (mode === 'publish') assertPublicationRuntime(process.env);
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const context = { repository: process.env.GITHUB_REPOSITORY, eventName: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF, sha: process.env.GITHUB_SHA };
const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
const base = JSON.parse(await readFile('cli/package.json', 'utf8'));
const identity = publicationIdentity(context, event, base.version, Number(git('show', '-s', '--format=%ct', 'HEAD')));
if (git('rev-parse', 'HEAD') !== identity.source || git('status', '--porcelain')) throw new Error('An exact clean checkout is required.');
async function registry(path = '') {
  const response = await fetch(`https://registry.npmjs.org/@scwlkr%2fopenjob${path}?openjob-read=${Date.now()}`, { headers: { accept: 'application/json', 'cache-control': 'no-cache' }, redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (response.status === 404 && path) return null;
  if (!response.ok) throw new Error('Public registry metadata unavailable; no publication attempted.');
  const text = await response.text(); if (text.length > 4 * 1024 * 1024) throw new Error('Registry metadata exceeds limit.');
  return JSON.parse(text);
}
function freshSource() {
  if (identity.channel === 'dev') {
    const current = git('ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0];
    if (current !== identity.source) throw new Error('Main advanced; stale dev run cannot publish.');
  } else {
    const refs = git('ls-remote', 'origin', identity.ref, `${identity.ref}^{}`).split('\n');
    const peeled = refs.find(row => row.endsWith('^{}')) ?? refs.find(row => row.endsWith(identity.ref));
    if (peeled?.split(/\s/)[0] !== identity.source) throw new Error('Release tag moved or disappeared.');
    // Stable approval is limited to reviewed main history, not a foreign release commit.
    git('fetch', '--no-tags', 'origin', 'main');
    git('merge-base', '--is-ancestor', identity.source, 'origin/main');
  }
}
async function github(path) {
  const response = await fetch(`https://api.github.com/repos/scwlkr/openjob${path}`, { headers: { accept: 'application/vnd.github+json', ...(process.env.GH_TOKEN ? { authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) }, redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Publishing environment/release read unavailable; require owner setup before activation.');
  return response.json();
}
async function verifyEnvironments() {
  for (const channel of ['dev', 'latest']) {
    const path = `/environments/${PUBLISH_ENVIRONMENTS[channel]}`;
    verifyPublishingEnvironment(channel, await github(path), await github(path + '/deployment-branch-policies'));
  }
  if (identity.channel === 'latest') verifyPublishedRelease(identity, await github(`/releases/${event.release.id}`), event.release.id);
}
const digest = bytes => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
if (mode === 'prepare') {
  await verifyEnvironments(); freshSource(); verifyRegistryOwner(await registry());
  const directory = resolve(target), path = resolve(directory, 'package.json');
  const pkg = JSON.parse(await readFile(path, 'utf8'));
  // Public ownership was verified above; this affects build output only, never npm account settings.
  pkg.openjobDistribution.registryVerified = true;
  verifyPublicationManifest(pkg, identity);
  await writeFile(path, JSON.stringify(pkg, null, 2) + '\n');
  const packed = JSON.parse(execFileSync('npm', ['pack', directory, '--pack-destination', dirname(directory), '--json', '--ignore-scripts'], { encoding: 'utf8' }))[0];
  const plan = { identity, filename: basename(packed.filename), integrity: digest(await readFile(resolve(dirname(directory), packed.filename))) };
  await writeFile(resolve(dirname(directory), 'publication.json'), JSON.stringify(plan, null, 2) + '\n');
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `channel=${identity.channel}\nenvironment=${identity.environment}\nversion=${identity.version}\nartifact_name=openjob-npm-publication-${identity.source}-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Exact npm artifact awaiting publication\n\nPackage: ${identity.name}@${identity.version}\n\nChannel: ${identity.channel}; source: ${identity.source}; ref: ${identity.ref}\n\nIntegrity: ${plan.integrity}\n\nThe publish job uses these same bytes; stable requires the owner environment approval.\n`);
  console.log(JSON.stringify({ ...plan, published: false }));
} else {

  const planPath = resolve(target), plan = JSON.parse(await readFile(planPath, 'utf8'));
  if (JSON.stringify(plan.identity) !== JSON.stringify(identity) || !/^scwlkr-openjob-[0-9A-Za-z.-]+\.tgz$/.test(plan.filename)) throw new Error('Approved plan does not match this exact event/source.');
  const tarball = resolve(dirname(planPath), plan.filename), bytes = await readFile(tarball);
  if (bytes.length > 5 * 1024 * 1024 || digest(bytes) !== plan.integrity) throw new Error('Approved artifact bytes changed.');
  const pkg = JSON.parse(execFileSync('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8', maxBuffer: 1024 * 1024 }));
  verifyPublicationManifest(pkg, identity);
  const version = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim().split('.').map(Number);
  if (version[0] < 11 || version[0] === 11 && (version[1] < 5 || version[1] === 5 && version[2] < 1)) throw new Error('OIDC publication requires npm11.5.1+.');
  await verifyEnvironments();
  const decision = publicationDecision(identity, plan.integrity, await registry(), await registry(`/${encodeURIComponent(identity.version)}`));
  freshSource();
  if (decision === 'publish') {
    // One attempt only: never retry an ambiguous write or repair dist-tags automatically.
    execFileSync('npm', ['publish', tarball, '--access', 'public', '--tag', identity.channel, '--registry=https://registry.npmjs.org', '--ignore-scripts', '--userconfig=/dev/null', '--browser=false'], { stdio: 'inherit' });
  }
  let confirmed = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const exact = await registry(`/${encodeURIComponent(identity.version)}`), metadata = await registry();
    try { confirmed = publicationDecision(identity, plan.integrity, metadata, exact) === 'already_current'; } catch { /* Read-only propagation check; never replay a write. */ }
    if (confirmed) break;
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!confirmed) throw new Error('Publication readback unconfirmed; inspect registry before retrying.');
  console.log(JSON.stringify({ version: identity.version, channel: identity.channel, integrity: plan.integrity, status: decision === 'publish' ? 'published_verified' : decision }));
}
