import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const root = new URL('..', import.meta.url);
function launch(args, env = {}) {
  const child = spawn(process.execPath, ['scripts/dev-workspace.mjs', ...args], { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  return { child, output: () => output, async stop() { if (child.exitCode !== null) return; const done = once(child, 'close'); child.kill('SIGTERM'); await done; } };
}
async function ready(process, port) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (process.child.exitCode !== null) throw new Error(process.output());
    try { const response = await fetch(`http://127.0.0.1:${port}/api/workspace/snapshot`, { headers: { 'x-openjob-fixture-owner': 'demo_alex' }, signal: AbortSignal.timeout(500) }); if (response.ok) return (await response.json()).data; }
    catch { /* Wait for the owned app/router to become available. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Demo startup timed out: ' + process.output());
}

test('one fresh-demo command seeds without credentials, preserves existing state and can restart saved work', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openjob-demo-startup-test-'));
  const preserved = join(directory, 'existing.json');
  await writeFile(preserved, 'Existing shared demo must remain untouched.');
  let process, freshFile;
  try {
    process = launch(['--fresh', '--port', '4177'], { OPENJOB_WORKSPACE_STATE_FILE: preserved });
    const seeded = await ready(process, 4177);
    assert.equal(seeded.accounts.length, 3);
    assert.equal(seeded.accounts.every(account => account.mode === 'fixture'), true);
    assert.equal(seeded.messages.length, 3);
    assert.equal(seeded.tasks.length, 1);
    assert.equal(seeded.calendars.length, 2);
    freshFile = process.output().match(/Fixture state: (.+)/)[1].trim();
    assert.notEqual(freshFile, preserved);
    assert.equal(await readFile(preserved, 'utf8'), 'Existing shared demo must remain untouched.');
    const command = await fetch('http://127.0.0.1:4177/api/workspace/commands', { method: 'POST', headers: { 'content-type': 'application/json', 'x-openjob-fixture-owner': 'demo_alex' }, body: JSON.stringify({ type: 'task.create', title: 'Survives demo restart' }) });
    assert.equal(command.status, 200);
    const created = (await command.json()).data;
    await process.stop();
    process = launch(['--port', '4177'], { OPENJOB_WORKSPACE_STATE_FILE: freshFile });
    const restored = await ready(process, 4177);
    assert.equal(restored.tasks.find(task => task.id === created.id).title, 'Survives demo restart');
  } finally { if (process) await process.stop(); if (freshFile) await rm(dirname(freshFile), { recursive: true, force: true }); await rm(directory, { recursive: true, force: true }); }
});

test('demo startup refuses an occupied backend instead of using another service as readiness', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openjob-demo-collision-test-'));
  let requests = 0;
  const occupied = createServer((_request, response) => { requests++; response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"data":{}}'); });
  occupied.listen(4180, '127.0.0.1'); await once(occupied, 'listening');
  const process = launch(['--port', '4177'], { OPENJOB_WORKSPACE_STATE_FILE: join(directory, 'state.json') });
  try {
    const [code] = await once(process.child, 'close');
    assert.notEqual(code, 0);
    assert.match(process.output(), /EADDRINUSE/);
    assert.equal(requests, 0, 'readiness belongs to the launched child, not the occupied port');
  } finally { await process.stop(); await new Promise(resolve => occupied.close(resolve)); await rm(directory, { recursive: true, force: true }); }
});
