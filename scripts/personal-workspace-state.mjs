import { constants } from 'node:fs';
import { open, mkdir, realpath, rename, unlink, lstat } from 'node:fs/promises';
import { dirname, basename, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createFakeFirestore } from '../tests/support/fake-firestore.mjs';
import { validateLocalSnapshot, STATE_LIMIT } from './personal-workspace-state-schema.mjs';

export async function writeLocalSnapshot(path, text) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let file, committed = false;
  try {
    file = await open(temporary, 'wx', 0o600);
    await file.writeFile(text); await file.sync(); await file.close(); file = undefined;
    await rename(temporary, path); committed = true;
    const directory = await open(dirname(path), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } catch {
    await file?.close().catch(() => {}); await unlink(temporary).catch(() => {});
    throw Object.assign(new Error(committed ? 'Local save durability is uncertain; restart to inspect saved work.' : 'Local save failed; previous work preserved.'), { uncertain: committed });
  }
}
export async function openPersonalWorkspaceState(filePath, { writeSnapshot = writeLocalSnapshot } = {}) {
  const firestore = createFakeFirestore();
  if (!filePath) return { firestore, filePath: null, execute: operation => operation(), persist: async () => {}, close: async () => {} };
  const requested = resolve(filePath);
  await mkdir(dirname(requested), { recursive: true, mode: 0o700 });
  const path = join(await realpath(dirname(requested)), basename(requested));
  const lockPath = `${path}.lock`;
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch { throw new Error('Local state is locked or inaccessible. Stop its owner; after a crash copy the state to a fresh path rather than resetting it.'); }
  const owned = await lock.stat();
  let closed = false, paused = false, queue = Promise.resolve();
  async function close() {
    if (closed) return; closed = true; await queue.catch(() => {});
    await lock.close();
    const current = await lstat(lockPath).catch(() => null);
    if (current?.ino === owned.ino && current?.dev === owned.dev) await unlink(lockPath);
  }
  function snapshot() { return { kind: 'openjob-local-prototype', version: 1, ...firestore.exportState() }; }
  async function persist() {
    if (paused) throw new Error('Local storage is paused after an uncertain save; restart to inspect saved work.');
    const text = JSON.stringify(validateLocalSnapshot(snapshot())) + '\n';
    try { await writeSnapshot(path, text); } catch (error) { if (error.uncertain) paused = true; throw error; }
  }
  try {
    await lock.writeFile(`OpenJob local prototype process ${process.pid}\n`);
    let file;
    try {
      file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const info = await file.stat();
      if (!info.isFile() || info.size > STATE_LIMIT) throw new Error('Invalid local workspace file.');
      const stored = validateLocalSnapshot(JSON.parse(await file.readFile('utf8')));
      firestore.restoreState(stored);
    } catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot load local workspace state; original file preserved.'); }
    finally { await file?.close(); }
  } catch (error) { await close(); throw error; }
  function execute(operation, save = false) {
    const result = queue.then(async () => {
      if (closed || paused) throw new Error('Local storage unavailable; restart to inspect saved work.');
      const before = firestore.exportState();
      try {
        const response = await operation();
        if (save && response.ok) await persist();
        return response;
      } catch (error) { if (!error.uncertain) firestore.restoreState(before); throw error; }
    });
    queue = result.catch(() => {}); return result;
  }
  return { firestore, filePath: path, execute, persist, close };
}
