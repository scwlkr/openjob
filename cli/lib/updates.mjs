// Notice-only checks. No process spawning, package installs, credentials or channel writes.

export function selectedChannel(pkg) {
  const channel = pkg.openjobDistribution?.channel ?? (pkg.version.includes('-dev.') ? 'dev' : 'latest');
  if (!['latest', 'dev'].includes(channel)) throw new Error('Unsupported OpenJob update channel.');
  return channel;
}
function parseVersion(value) {
  const match = typeof value === 'string' && value.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/);
  if (!match) return null;
  const pre = match[4]?.split('.') ?? [];
  if (pre.some(part => /^0\d+$/.test(part))) return null;
  return { core: match.slice(1, 4).map(Number), pre };
}
export function newerVersion(candidate, installed) {
  const a = parseVersion(candidate), b = parseVersion(installed);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i];
  if (!a.pre.length || !b.pre.length) return !a.pre.length && !!b.pre.length;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const left = a.pre[i], right = b.pre[i];
    if (left === right) continue;
    if (left === undefined || right === undefined) return right === undefined;
    const ln = /^\d+$/.test(left), rn = /^\d+$/.test(right);
    if (ln !== rn) return !ln;
    return ln ? Number(left) > Number(right) : left > right;
  }
  return false;
}
export async function checkForUpdates(pkg, { fetchImplementation = fetch, timeout = 1500 } = {}) {
  const channel = selectedChannel(pkg);
  const result = { installed: pkg.version, channel, available: null, status: 'unavailable' };
  try {
    // Fetch only public dist-tags. Never use an account token or npm configuration.
    const response = await fetchImplementation(`https://registry.npmjs.org/-/package/${encodeURIComponent(pkg.name)}/dist-tags`, { signal: AbortSignal.timeout(timeout), redirect: 'error', headers: { accept: 'application/json' } });
    if (!response.ok) return result;
    const text = await response.text();
    if (text.length > 16384) return result;
    const candidate = JSON.parse(text)[channel];
    if (!parseVersion(candidate) || (channel === 'latest' && candidate.includes('-')) || (channel === 'dev' && !candidate.includes('-dev.'))) return result;
    return { ...result, available: candidate, status: newerVersion(candidate, pkg.version) ? 'update_available' : 'current' };
  } catch { return result; }
}
export function updateNotice(result, name = 'openjob') {
  return result.status === 'update_available' ? `OpenJob ${result.available} is available on @${result.channel}. Update when ready: npm install -g ${name}@${result.channel}\n` : '';
}
export async function automaticUpdateNotice(pkg) {
  if (process.env.OPENJOB_NO_UPDATE_CHECK === '1') return;
  const result = await checkForUpdates(pkg);
  process.stderr.write(updateNotice(result, pkg.name));
  return result;
}
