// Packages existing built assets only; no server connection, credentials or deployment.
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=JSON.parse(await readFile(join(root,'dist/npm/package.json'),'utf8'));
const destination=join(root,'dist/server-bundle');
await rm(destination,{recursive:true,force:true}); await mkdir(join(destination,'deployment'),{recursive:true});
for(const name of ['compose.yaml','.dockerignore'])await cp(join(root,name),join(destination,name));
for(const name of ['Dockerfile','compose.google-local.yaml','service.env.example'])await cp(join(root,'deployment',name),join(destination,'deployment',name));
await cp(join(root,'dist/npm'),join(destination,'dist/npm'),{recursive:true});
await writeFile(join(destination,'README.md'),'# OpenJob local/server pilot bundle\n\nBuild on the target architecture with `docker compose --profile demo build demo`.\nRun the labeled local-only synthetic app with `docker compose --profile demo up -d demo`, then http://127.0.0.1:5191/workspace.\nThe separate `service` profile serves real Firebase authentication only after approved configuration; absent inputs yield setup/503, never a demo identity. No provider accounts or real sending are configured.\nBoth published ports bind host loopback. No server is purchased/deployed by this archive. See docs/PORTABLE_SERVICE.md in the source repository before an actual deployment. Do not publicly expose the synthetic profile.\n');
const hashes={};
async function walk(directory,prefix=''){
 for(const entry of await readdir(directory,{withFileTypes:true})){
  const rel=prefix+entry.name,path=join(directory,entry.name);
  if(entry.isDirectory())await walk(path,rel+'/');
  else hashes[rel]=createHash('sha256').update(await readFile(path)).digest('hex');
 }
}
await walk(destination);
await writeFile(join(destination,'receipt.json'),JSON.stringify({source:manifest.openjobDistribution,files:hashes,deployed:false,published:false},null,2)+'\n');
const archive=join(root,'dist/openjob-server-bundle.tgz');
execFileSync('tar',['-czf',archive,'-C',destination,'.']);
console.log(JSON.stringify({archive,files:Object.keys(hashes).length,source:manifest.openjobDistribution,deployed:false,published:false}));
