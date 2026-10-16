// Local preparation is read-only outside ignored build/scratch files. Publishing is separate.
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { candidateIdentity } from '../distribution/channels.mjs';
import { localPublicationIdentity, verifyRegistryOwner, verifyPublicationManifest, publicationDecision, assertLocalPublish } from '../distribution/publication.mjs';

const [mode, target, flag, approval] = process.argv.slice(2);
if (!['prepare', 'publish'].includes(mode) || !target || (mode === 'publish' && (flag !== '--approve' || !approval))) throw new Error('Use npm:prepare -- dev|latest|candidate [VERSION], or npm:publish -- PLAN_JSON --approve SHA512. Publishing requires separate owner approval.');
if (process.env.CI || process.env.GITHUB_ACTIONS) throw new Error('This workflow runs locally; no CI publishing or background jobs.');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const run = (command, args, options = {}) => execFileSync(command, args, { stdio: 'inherit', ...options });
const node = (...args) => run(process.execPath, args);
const base = JSON.parse(await readFile('cli/package.json', 'utf8'));
const source = git('rev-parse', 'HEAD');
if (git('status', '--porcelain')) throw new Error('A clean reviewed source checkout is required.');
const digest = bytes => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
async function registry(path = '') {
  const response = await fetch(`https://registry.npmjs.org/@scwlkr%2fopenjob${path}?openjob-read=${Date.now()}`, { headers: { accept: 'application/json', 'cache-control': 'no-cache' }, redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (response.status === 404 && path) return null;
  if (!response.ok) throw new Error('Public registry metadata unavailable; no publication attempted.');
  const text = await response.text(); if (text.length > 4 * 1024 * 1024) throw new Error('Registry metadata exceeds limit.');
  return JSON.parse(text);
}
function freshSource(identity) {
  if (!['https://github.com/scwlkr/openjob.git', 'git@github.com:scwlkr/openjob.git'].includes(git('remote', 'get-url', 'origin'))) throw new Error('Origin must be the owning OpenJob repository.');
  const remoteMain = git('ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0];
  if (identity.channel === 'dev') {
    if (remoteMain !== identity.source) throw new Error('Dev requires exact current remote main; refresh/review before packaging or publishing.');
  } else {
    const refs = git('ls-remote', 'origin', identity.ref, `${identity.ref}^{}`).split('\n');
    const peeled = refs.find(row => row.endsWith('^{}')) ?? refs.find(row => row.endsWith(identity.ref));
    if (peeled?.split(/\s/)[0] !== identity.source) throw new Error('Stable requires the exact separately reviewed remote version tag.');
    git('fetch', '--no-tags', 'origin', 'main');
    if (git('rev-parse', 'origin/main') !== remoteMain) throw new Error('Main changed during verification; inspect before retrying.');
    git('merge-base', '--is-ancestor', identity.source, 'origin/main');
  }
}
if (mode === 'prepare') {
  const candidate = target === 'candidate';
  const identity = candidate ? { ...candidateIdentity({ baseVersion: base.version, version: flag, sha: source }), name: '@scwlkr/openjob' }
    : localPublicationIdentity({ channel: target, baseVersion: base.version, source, timestamp: Number(git('show', '-s', '--format=%ct', 'HEAD')) });
  if (!candidate) { freshSource(identity); verifyRegistryOwner(await registry()); }
  node('--test', 'tests/npm-publication.test.mjs', 'tests/npm-distribution.test.mjs');
  node('node_modules/typescript/bin/tsc', '--noEmit');
  node('scripts/check-v1-secrets.mjs');
  run(process.execPath, ['scripts/build-npm-app.mjs', target, ...(candidate ? [flag] : [])], { env: { ...process.env, GITHUB_REF: identity.ref } });
  const pkgPath = resolve('dist/npm/package.json'), pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  if (!candidate) { pkg.openjobDistribution.registryVerified = true; verifyPublicationManifest(pkg, identity); await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n'); }
  const packed = JSON.parse(execFileSync('npm', ['pack', './dist/npm', '--pack-destination', './dist', '--json', '--ignore-scripts'], { encoding: 'utf8' }))[0];
  const filename = basename(packed.filename), tarball = resolve('dist', filename), integrity = digest(await readFile(tarball));
  const scratch = await mkdtemp(join(tmpdir(), 'openjob-local-package-'));
  try {
    run('npm', ['install', '-g', '--prefix', scratch, tarball, '--ignore-scripts', '--no-audit', '--no-fund']);
    node('scripts/smoke-npm-app.mjs', join(scratch, 'bin/openjob'));
  } finally { await rm(scratch, { recursive: true, force: true }); }
  if (git('rev-parse', 'HEAD') !== source || git('status', '--porcelain')) throw new Error('Source changed during checks; no publication plan saved.');
  if (!candidate) freshSource(identity);
  const plan = { identity, filename, integrity, publishable: !candidate };
  await writeFile('dist/publication.json', JSON.stringify(plan, null, 2) + '\n');
  console.log(JSON.stringify({ ...plan, published: false, next: candidate ? 'Installation review only; cannot publish this candidate.' : 'Review this exact version/channel/source/integrity. Publish only after owner approval.' }));
} else {
  const planPath = resolve(target), plan = JSON.parse(await readFile(planPath, 'utf8'));
  assertLocalPublish(process.env, approval, plan.integrity);
  const identity = localPublicationIdentity({ channel: plan.identity?.channel, baseVersion: base.version, source, timestamp: Number(git('show', '-s', '--format=%ct', 'HEAD')) });
  if (plan.publishable !== true || JSON.stringify(plan.identity) !== JSON.stringify(identity) || !/^scwlkr-openjob-[0-9A-Za-z.-]+\.tgz$/.test(plan.filename)) throw new Error('Plan is not publishable from this exact reviewed source.');
  const tarball = resolve(dirname(planPath), plan.filename), bytes = await readFile(tarball);
  if (bytes.length > 5 * 1024 * 1024 || digest(bytes) !== plan.integrity) throw new Error('Approved artifact bytes changed.');
  const pkg = JSON.parse(execFileSync('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8', maxBuffer: 1024 * 1024 }));
  verifyPublicationManifest(pkg, identity);
  if (execFileSync('npm', ['whoami', '--registry=https://registry.npmjs.org'], { encoding: 'utf8' }).trim() !== 'scwlkr') throw new Error('Use the existing scwlkr npm login. No authentication settings were changed.');
  const decision = publicationDecision(identity, plan.integrity, await registry(), await registry(`/${encodeURIComponent(identity.version)}`));
  freshSource(identity);
  if (decision === 'publish') {
    console.log('Publishing approved bytes once. Complete any npm security prompt personally; never put OTPs or tokens in project files.');
    run('npm', ['publish', tarball, '--access', 'public', '--tag', identity.channel, '--registry=https://registry.npmjs.org', '--ignore-scripts']);
  }
  const exact = await registry(`/${encodeURIComponent(identity.version)}`), metadata = await registry();
  if (publicationDecision(identity, plan.integrity, metadata, exact) !== 'already_current') throw new Error('Readback unconfirmed; inspect registry before retrying. Never automatically replay an ambiguous publish.');
  console.log(JSON.stringify({ version: identity.version, channel: identity.channel, integrity: plan.integrity, status: decision === 'publish' ? 'published_verified' : decision }));
}
