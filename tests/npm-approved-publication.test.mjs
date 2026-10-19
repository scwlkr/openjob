import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { approvedPublication, verifyApprovedPlan, verifyApprovedProvenance, completeApprovedPublication, approvedPublishArgs, checkApprovedNpmLogin } from '../distribution/approved-publication.mjs';
import { localPublicationIdentity, publicationDecision } from '../distribution/publication.mjs';

const bytes = Buffer.from('invented archived bytes, no package/provider/authentication effects');
const source = { baseVersion: '0.3.7', source: approvedPublication.source, timestamp: 1792161876 };
const identity = localPublicationIdentity({ channel: 'dev', ...source });
const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
const receipt = { ...approvedPublication, integrity };
const plan = { identity, filename: `scwlkr-openjob-${identity.version}.tgz`, integrity, publishable: true };

test('approved npm invocation fixes dev/registry and disables hooks and transport retries', () => {
  assert.deepEqual(approvedPublishArgs('/private/sealed.tgz'), [
    'publish', '/private/sealed.tgz', '--access', 'public', '--tag', 'dev',
    '--registry=https://registry.npmjs.org', '--ignore-scripts', '--fetch-retries=0',
  ]);
});

test('failed login reports exact private owner handoff without leaking npm stderr or another identity', () => {
  checkApprovedNpmLogin(() => 'scwlkr\n');
  assert.throws(() => checkApprovedNpmLogin(() => 'other-private-identity'), error => {
    assert.match(error.message, /existing scwlkr/); assert.doesNotMatch(error.message, /other-private-identity/); return true;
  });
  assert.throws(() => checkApprovedNpmLogin(() => { throw Object.assign(new Error('secret-fixture-value https://auth.invalid/private'), { stderr: 'secret-fixture-value' }); }), error => {
    assert.match(error.message, /npm login --auth-type=web --registry=https:\/\/registry.npmjs.org/);
    assert.match(error.message, /saves a local credential/);
    assert.doesNotMatch(error.stack, /secret-fixture-value|auth.invalid/); return true;
  });
});

test('authentication failure stops before registry checks or publication with no retry', async () => {
  const calls = [];
  await assert.rejects(completeApprovedPublication({ mode: 'publish',
    checkLogin() { calls.push('whoami'); checkApprovedNpmLogin(() => { throw new Error('E401'); }); },
    decision() { calls.push('registry'); }, provenance() { calls.push('source'); }, publish() { calls.push('publish'); },
  }), /before publication/);
  assert.deepEqual(calls, ['whoami']);
});

test('resumption binds original source/version/channel/approval and all archived bytes', () => {
  assert.deepEqual(verifyApprovedPlan(plan, bytes, source, receipt), identity);
  for (const changed of [
    { ...plan, publishable: false }, { ...plan, integrity: 'sha512-other' },
    { ...plan, filename: '../elsewhere.tgz' },
    ...['version', 'source', 'channel', 'name', 'ref'].map(key => ({ ...plan, identity: { ...identity, [key]: 'other' } })),
    { ...plan, identity: { ...identity, extra: true } },
  ]) assert.throws(() => verifyApprovedPlan(changed, bytes, source, receipt));
  assert.throws(() => verifyApprovedPlan(plan, Buffer.concat([bytes, Buffer.from('changed')]), source, receipt));
  assert.throws(() => verifyApprovedPlan(plan, bytes, { ...source, timestamp: source.timestamp + 1 }, receipt));
  assert.throws(() => verifyApprovedPlan(plan, bytes, { ...source, baseVersion: '0.3.8' }, receipt));
  for (const changed of [{ ...receipt, registry: 'https://other.invalid' }, { ...receipt, channel: 'latest' }, { ...receipt, approvalReference: '' }]) {
    assert.throws(() => verifyApprovedPlan(plan, bytes, source, changed));
  }
  // Fake test receipt is never accepted by the CLI's actual recorded approval.
  assert.throws(() => verifyApprovedPlan(plan, bytes, source));
});

test('current clean publisher and main ancestry are required despite immutable artifact approval', () => {
  const proof = { runner: 'a'.repeat(40), remoteMain: 'a'.repeat(40), ancestor: true, clean: true };
  verifyApprovedProvenance(proof);
  for (const changed of [{ ...proof, remoteMain: 'b'.repeat(40) }, { ...proof, runner: 'x' }, { ...proof, ancestor: false }, { ...proof, clean: false }]) {
    assert.throws(() => verifyApprovedProvenance(changed));
  }
});

const metadata = { name: identity.name, maintainers: [{ name: 'scwlkr' }], repository: { url: 'git+https://github.com/scwlkr/openjob.git' }, 'dist-tags': { dev: '0.3.8-dev.1792154226.37c322be4d3d', latest: '0.3.7' } };
test('original dev approval cannot roll back a newer dev or replace existing mismatched bytes', () => {
  assert.equal(publicationDecision(identity, integrity, metadata, null), 'publish');
  assert.throws(() => publicationDecision(identity, integrity, { ...metadata, 'dist-tags': { ...metadata['dist-tags'], dev: '0.3.8-dev.9999999999.aaaaaaaaaaaa' } }, null));
  const exact = { name: identity.name, version: identity.version, repository: metadata.repository, publishConfig: { tag: 'dev' }, openjobDistribution: { ...identity, registryVerified: true }, dist: { integrity } };
  const current = { ...metadata, 'dist-tags': { ...metadata['dist-tags'], dev: identity.version } };
  assert.equal(publicationDecision(identity, integrity, current, exact), 'already_current');
  assert.throws(() => publicationDecision(identity, integrity, current, { ...exact, dist: { integrity: 'other' } }));
  assert.throws(() => publicationDecision(identity, integrity, metadata, exact));
});

function operations(mode, decisions, failure) {
  const calls = [];
  return { calls, args: { mode,
    checkLogin() { calls.push('login'); },
    decision() { calls.push('registry'); return decisions.shift(); },
    provenance() { calls.push('provenance'); if (failure === 'source') throw new Error('source moved'); },
    publish() { calls.push('publish'); if (failure === 'npm') throw new Error('EOTP or uncertain result'); },
  } };
}
test('check is read-only; publication freshly checks registry/source and writes at most once', async () => {
  const check = operations('check', ['publish']);
  assert.equal(await completeApprovedPublication(check.args), 'ready_for_owner_npm_authentication');
  assert.deepEqual(check.calls, ['registry', 'provenance']);
  const publish = operations('publish', ['publish', 'already_current']);
  assert.equal(await completeApprovedPublication(publish.args), 'published_verified');
  assert.deepEqual(publish.calls, ['login', 'registry', 'provenance', 'publish', 'registry']);
  const current = operations('publish', ['already_current', 'already_current']);
  assert.equal(await completeApprovedPublication(current.args), 'already_current');
  assert.ok(!current.calls.includes('publish'));
});
test('moved source, EOTP/ambiguous writes and unconfirmed readback never trigger a second attempt', async () => {
  for (const [failure, decisions] of [['source', ['publish']], ['npm', ['publish']], [null, ['publish', 'publish']]]) {
    const op = operations('publish', decisions, failure);
    await assert.rejects(completeApprovedPublication(op.args));
    assert.ok(op.calls.filter(call => call === 'publish').length <= 1);
    if (failure === 'source') assert.ok(!op.calls.includes('publish'));
    if (failure === 'npm') assert.deepEqual(op.calls, ['login', 'registry', 'provenance', 'publish']);
  }
});
