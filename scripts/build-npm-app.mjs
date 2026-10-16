// Build only; never publishes, changes tags, deploys, or configures npm access.
import { build } from 'vite';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { artifactIdentity, candidateIdentity, sourceRef, NPM_PACKAGE_NAME } from '../distribution/channels.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const channel = process.argv[2];
if (!['local', 'candidate', 'latest', 'dev'].includes(channel)) throw new Error('Use build-npm-app.mjs <local|candidate VERSION|latest|dev>.');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const pkg = JSON.parse(await readFile(join(root, 'cli/package.json'), 'utf8'));
const source = git('rev-parse', 'HEAD');
let identity = { version: pkg.version, channel: 'latest', source, ref: 'local-unpublished' };
if (channel === 'candidate') {
  if (git('status', '--porcelain')) throw new Error('Candidate requires clean reviewed source; no release/tag is created.');
  identity = candidateIdentity({ baseVersion: pkg.version, version: process.argv[3], sha: source });
}
if (!['local', 'candidate'].includes(channel)) {
  if (git('status', '--porcelain')) throw new Error('Channel artifacts require a clean source checkout.');
  const ref = process.env.GITHUB_REF || (channel === 'latest' ? `refs/tags/${git('describe', '--exact-match', '--tags')}` : `refs/heads/${git('branch', '--show-current')}`);
  if (git('rev-parse', sourceRef(ref)) !== source) throw new Error('Channel ref does not identify this exact source.');
  identity = artifactIdentity({ channel, baseVersion: pkg.version, ref, sha: source, timestamp: Number(git('show', '-s', '--format=%ct', 'HEAD')) });
}
const output = join(root, 'dist/npm');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await build({ configFile: join(root, 'tests/browser/personal-workspace-vite.config.ts'), build: { outDir: join(output, 'app/web'), emptyOutDir: true }, logLevel: 'warn' });
await build({ configFile: false, publicDir: false, build: { ssr: join(root, 'scripts/personal-workspace-test-server.mjs'), target: 'node22', outDir: join(output, 'app/api'), emptyOutDir: true, minify: false, rollupOptions: { output: { entryFileNames: 'server.mjs' } } }, ssr: { noExternal: true }, logLevel: 'warn' });
await build({ configFile: join(root, 'deployment/web-vite.config.ts'), build: { target: 'es2022', outDir: join(output, 'app/service-web'), emptyOutDir: true }, logLevel: 'warn' });
await build({ configFile: false, publicDir: false, resolve: { alias: { '@': root } }, build: { ssr: join(root, 'deployment/service-server.mjs'), target: 'node22', outDir: join(output, 'app/service'), emptyOutDir: true, minify: false, rollupOptions: { output: { entryFileNames: 'server.mjs' } } }, ssr: { noExternal: true }, logLevel: 'warn' });
await cp(join(root, 'deployment/healthcheck.mjs'), join(output, 'app/service/healthcheck.mjs'));
for (const name of ['lib', 'generated', 'openapi-types.ts', 'openjob.mjs', 'README.md']) await cp(join(root, 'cli', name), join(output, name), { recursive: true });
const { private: _private, ...manifest } = pkg;
manifest.name = NPM_PACKAGE_NAME;
manifest.description = 'OpenJob workspace prototype and command-line client';
manifest.version = identity.version;
manifest.files = [...pkg.files, 'app'];
manifest.openjobDistribution = { ...identity, registryVerified: false };
manifest.publishConfig = { access: 'public', tag: identity.channel };
manifest.repository = { type: 'git', url: 'git+https://github.com/scwlkr/openjob.git' };
await writeFile(join(output, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ directory: output, ...identity, published: false }));
