// Resume ONLY the immutable approval recorded in source. Never prepares/rebuilds.
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { approvedPublication as receipt, verifyApprovedPlan, verifyApprovedProvenance, completeApprovedPublication, approvedPublishArgs, checkApprovedNpmLogin } from '../distribution/approved-publication.mjs';
import { assertLocalPublish, publicationDecision, verifyPublicationManifest } from '../distribution/publication.mjs';

const [mode, target, flag, approval, ...extra] = process.argv.slice(2);
if (!['check', 'publish'].includes(mode) || !target || flag !== '--approve' || !approval || extra.length) {
  throw new Error('Use npm:resume:check or npm:resume -- PLAN_JSON --approve APPROVED_SHA512.');
}
assertLocalPublish(process.env, approval, receipt.integrity);
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const runner = git('rev-parse', 'HEAD');
// Imported publisher code must belong to this checkout, not a different cwd.
if (resolve(git('rev-parse', '--show-toplevel'), 'scripts/npm-approved-publication.mjs') !== fileURLToPath(import.meta.url)) {
  throw new Error('Run the resume command from its own reviewed checkout.');
}
function provenance() {
  if (!['https://github.com/scwlkr/openjob.git', 'git@github.com:scwlkr/openjob.git'].includes(git('remote', 'get-url', 'origin'))) throw new Error('Origin must be the owning OpenJob repository.');
  const remoteMain = git('ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0];
  let ancestor = false;
  try { git('merge-base', '--is-ancestor', receipt.source, runner); ancestor = true; } catch { /* fail closed below */ }
  verifyApprovedProvenance({ runner: git('rev-parse', 'HEAD'), remoteMain, ancestor, clean: !git('status', '--porcelain') });
  if (git('rev-parse', 'HEAD') !== runner) throw new Error('Publisher source changed; inspect before retrying.');
}
provenance();
const planPath = resolve(target), text = await readFile(planPath, 'utf8');
if (text.length > 8192) throw new Error('Publication plan exceeds limit.');
const plan = JSON.parse(text);
// Validate filename before resolving any plan-controlled artifact path.
if (plan.filename !== `scwlkr-openjob-${receipt.version}.tgz`) throw new Error('Unexpected approved artifact filename.');
const bytes = await readFile(resolve(dirname(planPath), plan.filename));
const originalSource = {
  baseVersion: JSON.parse(git('show', `${receipt.source}:cli/package.json`)).version,
  source: receipt.source, timestamp: Number(git('show', '-s', '--format=%ct', receipt.source)),
};
const identity = verifyApprovedPlan(plan, bytes, originalSource);
async function registry(path = '') {
  const response = await fetch(`${receipt.registry}/@scwlkr%2fopenjob${path}?openjob-read=${Date.now()}`, { headers: { accept: 'application/json', 'cache-control': 'no-cache' }, redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (response.status === 404 && path) return null;
  if (!response.ok) throw new Error('Public registry unavailable; inspect before any retry.');
  const body = await response.text();
  if (body.length > 4 * 1024 * 1024) throw new Error('Registry metadata exceeds limit.');
  return JSON.parse(body);
}
async function decision() {
  return publicationDecision(identity, receipt.integrity, await registry(), await registry(`/${encodeURIComponent(identity.version)}`));
}
const staging = await mkdtemp(join(tmpdir(), 'openjob-approved-resume-'));
try {
  const approvedTarball = join(staging, plan.filename);
  await writeFile(approvedTarball, bytes, { flag: 'wx', mode: 0o600 });
  const pkg = JSON.parse(execFileSync('tar', ['-xOf', approvedTarball, 'package/package.json'], { encoding: 'utf8', maxBuffer: 1024 * 1024 }));
  verifyPublicationManifest(pkg, identity);
  const status = await completeApprovedPublication({ mode, decision, provenance,
    checkLogin() {
      checkApprovedNpmLogin(() => execFileSync('npm', ['whoami', `--registry=${receipt.registry}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    },
    publish() {
      console.log('Publishing the original approved bytes once. Complete npm authentication personally; never share security links, OTPs or tokens.');
      execFileSync('npm', approvedPublishArgs(approvedTarball), { stdio: 'inherit' });
    },
  });
  console.log(JSON.stringify({ version: identity.version, integrity: receipt.integrity, source: identity.source, publisher: runner, approval: receipt.approvalReference, status, published: mode === 'publish' }));
} finally { await rm(staging, { recursive: true, force: true }); }
