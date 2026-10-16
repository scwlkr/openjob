import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { access } from 'node:fs/promises';

export async function runService(args) {
  const entry = fileURLToPath(new URL('../app/service/server.mjs', import.meta.url));
  try { await access(entry); } catch { throw new Error('Packaged service assets are missing. Build/install the app tarball first.'); }
  const child = spawn(process.execPath, [entry, ...args], { env: process.env, stdio: 'inherit' });
  const stop = () => child.kill('SIGTERM');
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => { process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop); process.exitCode = code ?? 1; resolve(); });
  });
}
