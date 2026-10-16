// Installed tarball proof from outside the source checkout; no external services.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
const binary = process.argv[2];
if (!binary) throw new Error('Use smoke-npm-app.mjs <installed-openjob>');
const reservation = createServer();
reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise(accept => reservation.close(accept));
const child = spawn(resolve(binary), ['app', '--port', String(port)], { cwd: tmpdir(), env: { ...process.env, OPENJOB_NO_UPDATE_CHECK: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
const exited = once(child, 'exit');
let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
const origin = `http://127.0.0.1:${port}`;
try {
  const deadline = Date.now() + 15000;
  while (!output.includes('/workspace')) {
    if (child.exitCode !== null) throw new Error(`Installed app exited: ${output}`);
    if (Date.now() > deadline) throw new Error('Installed app startup timed out.');
    await new Promise(accept => setTimeout(accept, 50));
  }
  const html = await (await fetch(`${origin}/workspace`)).text();
  assert.match(html, /<div id="root"><\/div>/);
  const assets = [...html.matchAll(/(?:src|href)="([^"\s]+\.(?:js|css))"/g)].map(match => match[1]);
  assert.ok(assets.some(path => path.endsWith('.js'))); assert.ok(assets.some(path => path.endsWith('.css')));
  for (const path of assets) assert.equal((await fetch(origin + path)).status, 200);
  assert.equal((await fetch(`${origin}/brand/openjob-lockup.svg`)).status, 200);
  const session = async name => (await (await fetch(`${origin}/__test/session/${name}`)).json()).token;
  const alex = await session('alex'), sam = await session('sam');
  const request = async (token, path, input, status = 200) => {
    const response = await fetch(`${origin}/api/v1/workspace/${path}`, { headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(input ? { method: 'POST', body: JSON.stringify(input) } : {}) });
    assert.equal(response.status, status); return (await response.json()).data;
  };
  const task = await request(alex, 'commands', { type: 'task.create', title: 'Clean npm install smoke' });
  await request(alex, 'commands', { type: 'task.schedule', taskId: task.id, calendarId: 'personal', start: '2027-04-06T09:00:00Z', end: '2027-04-06T09:30:00Z' });
  await request(alex, 'commands', { type: 'task.complete', taskId: task.id, completed: true });
  assert.ok((await request(alex, 'snapshot')).tasks.some(row => row.id === task.id && row.title === 'Clean npm install smoke' && row.completed === true && !!row.scheduledSlot));
  assert.equal((await request(sam, 'snapshot')).tasks.some(row => row.id === task.id), false);
  assert.equal((await fetch(`${origin}/__test/session/alex`, { headers: { origin: 'https://untrusted.example' } })).status, 403);
  const invalidHostStatus = await new Promise((accept, reject) => {
    const req = httpRequest(`${origin}/__test/session/alex`, { headers: { host: 'untrusted.example' } }, response => { response.resume(); accept(response.statusCode); });
    req.once('error', reject); req.end();
  });
  assert.equal(invalidHostStatus, 403);
  assert.equal((await fetch(`${origin}/package.json`)).status, 404);
  console.log(JSON.stringify({ installedBinary: resolve(binary), staticAssets: assets.length, createScheduleComplete: true, ownerIsolation: true, hostOriginDenial: true, sourceCheckoutRequired: false }));
} finally {
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  await exited; clearTimeout(timer);
}
await assert.rejects(fetch(`${origin}/workspace`));
console.log('Installed app shutdown PASS');
