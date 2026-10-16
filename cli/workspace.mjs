#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

async function main(args) {
  if (args.includes('--help')) {
    console.log('Fixture-only workspace client. No live providers or sending.\nUsage: node cli/workspace.mjs snapshot|command --url http://127.0.0.1:4180 --owner demo_alex [--agent ID] [--input FILE|-]');
    return;
  }
  const command = args.shift();
  const options = {};
  while (args.length) {
    const key = args.shift();
    if (!['--url', '--owner', '--agent', '--input'].includes(key) || options[key] !== undefined || !args.length) throw new Error('Invalid or duplicate option. Use --help.');
    options[key] = args.shift();
  }
  if (!['snapshot', 'command'].includes(command) || !options['--url'] || !options['--owner']) throw new Error('An explicit command, --url and --owner are required. Use --help.');
  const base = new URL(options['--url']);
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('--url must be a plain HTTP loopback origin.');
  if (!/^demo_[a-z]+$/.test(options['--owner'])) throw new Error('--owner must be an explicit demo fixture identity.');
  if (command === 'snapshot' && options['--input']) throw new Error('--input is only valid for command.');
  let body;
  if (command === 'command') {
    if (!options['--input']) throw new Error('command requires --input FILE or --input -.');
    let raw;
    if (options['--input'] === '-') {
      const chunks = [];
      let length = 0;
      for await (const chunk of process.stdin) {
        length += chunk.length;
        if (length > 32 * 1024) throw new Error('Command exceeds 32 KiB.');
        chunks.push(chunk);
      }
      raw = Buffer.concat(chunks).toString('utf8');
    } else raw = await readFile(options['--input'], 'utf8');
    if (Buffer.byteLength(raw) > 32 * 1024) throw new Error('Command exceeds 32 KiB.');
    body = JSON.stringify(JSON.parse(raw));
  }
  const headers = { 'x-openjob-fixture-owner': options['--owner'] };
  if (options['--agent']) headers['x-openjob-fixture-agent'] = options['--agent'];
  if (body) headers['content-type'] = 'application/json';
  const response = await fetch(new URL(`/api/workspace/${command === 'snapshot' ? 'snapshot' : 'commands'}`, base), {
    method: body ? 'POST' : 'GET', headers, body, redirect: 'error', signal: AbortSignal.timeout(10000),
  });
  let result;
  try { result = await response.json(); } catch { throw new Error(`HTTP ${response.status}: invalid fixture response.`); }
  if (!response.ok) throw new Error(`HTTP ${response.status} ${result.error?.code ?? 'request_failed'}: ${result.error?.message ?? 'Fixture request failed.'}`);
  console.log(JSON.stringify(result));
}

main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
