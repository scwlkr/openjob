import { createServer } from 'node:http';
import { readFile, mkdir, open, rename, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createWorkspaceEngine } from '../shared/workspace-engine.ts';
import { createFixtureWorkspace } from '../shared/workspace-fixtures.ts';
import { createWorkspaceApi } from '../server/workspace-api.ts';

const args = process.argv.slice(2);
const options = {};
while (args.length) {
  const key = args.shift();
  if (!['--state-file', '--port'].includes(key) || options[key] !== undefined || !args.length) throw new Error('Use --state-file FILE and optional --port PORT.');
  options[key] = args.shift();
}
const stateFile = resolve(options['--state-file'] ?? process.env.OPENJOB_WORKSPACE_STATE_FILE ?? '/tmp/openjob-workspace-demo.json');
const port = Number(options['--port'] ?? 4180);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid fixture port.');
let initial;
try { initial = JSON.parse(await readFile(stateFile, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot read workspace fixture state; original file preserved.'); }
let engine = createWorkspaceEngine(initial ?? createFixtureWorkspace());
let api = createWorkspaceApi({ engine, enabled: true });

async function persist() {
  await mkdir(dirname(stateFile), { recursive: true });
  const temporary = `${stateFile}.${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(engine.exportState()) + '\n');
    await file.sync();
    await file.close();
    await rename(temporary, stateFile);
  } catch (error) {
    await file.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}
await persist();
let queue = Promise.resolve();
const server = createServer((incoming, outgoing) => {
  // Serialize mutations and durable writes so a response never precedes its state save.
  queue = queue.then(async () => {
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(',') : value);
      const request = new Request(`http://${incoming.headers.host ?? '127.0.0.1'}${incoming.url}`, {
        method: incoming.method, headers,
        ...(incoming.method === 'POST' ? { body: incoming, duplex: 'half' } : {}),
      });
      const before = engine.exportState();
      const response = await api(request);
      if (response.ok && incoming.method === 'POST') {
        try { await persist(); }
        catch (error) {
          engine = createWorkspaceEngine(before);
          api = createWorkspaceApi({ engine, enabled: true });
          throw error;
        }
      }
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.writeHead(500, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      outgoing.end(JSON.stringify({ error: { code: 'fixture_storage_error', message: 'Fixture state could not be saved. Do not retry a mutation blindly.' } }));
    }
  }).catch(() => {});
});
server.listen(port, '127.0.0.1', () => {
  console.log(`OpenJob FIXTURE workspace: http://127.0.0.1:${server.address().port} (simulated providers; sending disabled; local JSON persistence)`);
  process.send?.({ type: 'workspace-fixture-ready' });
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
