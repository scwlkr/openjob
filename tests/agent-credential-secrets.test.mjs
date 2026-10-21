import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const run = promisify(execFile);
test('public artifact scan rejects every supported agent credential format without printing the secret', async t => {
  const root = await mkdtemp(join(tmpdir(), 'openjob-secret-agent-')); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'scripts')); await copyFile(resolve('scripts/check-v1-secrets.mjs'), join(root, 'scripts/check-v1-secrets.mjs')); await run('git', ['init', '--quiet'], { cwd: root });
  const id = 'agt_' + '1'.repeat(32), secret = 'A'.repeat(42) + '-';
  for (const prefix of ['oj_agent_' + id, 'oj_personal_user_' + '2'.repeat(32) + '.' + id, 'oj_workspace_wsp_' + '3'.repeat(32) + '.' + id]) {
    const credential = prefix + '.' + secret; await writeFile(join(root, 'public-artifact.txt'), 'Accidental credential: ' + credential + '\n');
    let result; try { await run(process.execPath, ['scripts/check-v1-secrets.mjs'], { cwd: root }); } catch (error) { result = error; }
    assert.equal(result?.code, 1); assert.match(result.stderr, /public-artifact.txt: OpenJob agent credential/); assert.equal((result.stdout + result.stderr).includes(credential), false);
  }
  await rm(join(root, 'public-artifact.txt')); const clean = await run(process.execPath, ['scripts/check-v1-secrets.mjs'], { cwd: root }); assert.match(clean.stdout, /passed/);
});
