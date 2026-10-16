// Pure mapping shared by the artifact builder and deterministic checks.
export function artifactIdentity({ channel, baseVersion, ref, sha, timestamp }) {
  if (!/^\d+\.\d+\.\d+$/.test(baseVersion) || !/^[a-f0-9]{40}$/.test(sha)) throw new Error('A stable base version and full source SHA are required.');
  if (channel === 'latest') {
    if (ref !== `refs/tags/v${baseVersion}`) throw new Error('latest requires the matching stable release tag.');
    return { version: baseVersion, channel, source: sha, ref };
  }
  if (channel !== 'dev' || ref !== 'refs/heads/main' || !Number.isSafeInteger(timestamp) || timestamp < 1) throw new Error('dev requires main and its commit timestamp.');
  const [major, minor, patch] = baseVersion.split('.').map(Number);
  return { version: `${major}.${minor}.${patch + 1}-dev.${timestamp}.${sha.slice(0, 12)}`, channel, source: sha, ref };
}

// actions/checkout can detach HEAD; main is still available through origin.
export function sourceRef(ref) {
  return ref === 'refs/heads/main' ? 'refs/remotes/origin/main' : ref;
}
