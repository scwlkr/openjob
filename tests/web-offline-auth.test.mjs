import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

test('Firebase restoration uses exact SDK local identity only on network failure and never invents provider permissions', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'openjob-offline-auth-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const fake = join(directory, 'firebase.mjs');
  await writeFile(fake, `export const browserLocalPersistence={},inMemoryPersistence={}; export function getApps(){return []} export function initializeApp(){return {}} export function getAuth(){return {}} export async function setPersistence(){} export function onAuthStateChanged(auth,listener){queueMicrotask(()=>listener(globalThis.__offlineAuthUser));return ()=>{}} export const onIdTokenChanged=onAuthStateChanged; export class GoogleAuthProvider{} export class OAuthProvider{} export async function signOut(){} export async function signInWithEmailAndPassword(){} export async function signInWithPopup(){throw Error('unused')}`);
  await build({ configFile: false, logLevel: 'silent', resolve: { alias: { 'firebase/app': fake, 'firebase/auth': fake } }, define: { __OPENJOB_FIREBASE_CONFIG__: '{}', __OPENJOB_QA_PASSWORD_AUTH__: 'null', __OPENJOB_APPLE_SERVICE_ID__: '"fixture"' }, build: { ssr: resolve('app/firebase-auth.ts'), outDir: directory, emptyOutDir: false, minify: false, rollupOptions: { output: { entryFileNames: 'auth.mjs' } } } });
  const { createFirebaseAuth } = await import(pathToFileURL(join(directory, 'auth.mjs')).href);
  t.after(() => { delete globalThis.__offlineAuthUser; });
  let code = 'auth/network-request-failed';
  const user = { uid: 'sdk_alex', tenantId: 'tenant_fixture', providerData: [{ providerId: 'google.com' }], async getIdTokenResult() { if (code) throw Object.assign(new Error('SDK failed.'), { code }); return { signInProvider: 'google.com' }; }, async getIdToken() { throw Object.assign(new Error('Still offline.'), { code: 'auth/network-request-failed' }); } };
  globalThis.__offlineAuthUser = user;
  function observe(options = { allowOfflineRestore: true }) { return new Promise((resolve, reject) => { const cancel = createFirebaseAuth(options).observe(value => { cancel(); resolve(value); }, error => { cancel(); reject(error); }); }); }
  await assert.rejects(observe({}), error => error.code === 'auth/network-request-failed');
  await assert.rejects(observe({ allowOfflineRestore: false }), error => error.code === 'auth/network-request-failed');
  const restored = await observe(); assert.deepEqual(restored.localIdentity, { uid: 'sdk_alex', tenantId: 'tenant_fixture' }); assert.equal(restored.signInMethod, 'google');
  await assert.rejects(restored.getIdToken(), error => error.code === 'auth/network-request-failed');
  code = 'auth/user-disabled'; await assert.rejects(observe(), error => error.code === 'auth/user-disabled');
  code = 'auth/network-request-failed'; user.providerData.push({ providerId: 'apple.com' }); await assert.rejects(observe(), error => error.code === code);
  user.providerData = [{ providerId: 'password' }]; await assert.rejects(observe(), error => error.code === code);
  code = ''; user.providerData = [{ providerId: 'google.com' }]; assert.equal((await observe()).localIdentity.uid, 'sdk_alex');
});

test('private cleanup awaits durable purge, attempts ordinary cleanup on failure and propagates retryable failure', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'openjob-web-cleanup-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const fake = join(directory, 'store.mjs'); await writeFile(fake, 'export function clearBrowserOfflineWorkspace(){globalThis.__purgeCalls++;return globalThis.__purgeResult}');
  await build({ configFile: false, logLevel: 'silent', resolve: { alias: [{ find: './workspace/offline-browser-store', replacement: fake }] }, build: { ssr: resolve('app/openjob-private-state.ts'), outDir: directory, emptyOutDir: false, rollupOptions: { output: { entryFileNames: 'cleanup.mjs' } } } });
  const { clearBrowserPrivateState, SELECTED_GROUP_KEY, TASK_EDITOR_DRAFT_KEY } = await import(pathToFileURL(join(directory, 'cleanup.mjs')).href);
  const originalWindow = globalThis.window;
  t.after(() => { globalThis.window = originalWindow; delete globalThis.__purgeCalls; delete globalThis.__purgeResult; });
  const local = new Map([[SELECTED_GROUP_KEY, 'private-group']]), session = new Map([[TASK_EDITOR_DRAFT_KEY, 'private-draft']]);
  globalThis.window = { localStorage: { removeItem: key => local.delete(key) }, sessionStorage: { removeItem: key => session.delete(key) } };
  globalThis.__purgeCalls = 0;
  let finish; globalThis.__purgeResult = new Promise(resolve => { finish = resolve; });
  let completed = false; const pending = clearBrowserPrivateState().then(() => { completed = true; });
  assert.equal(globalThis.__purgeCalls, 1); assert.equal(local.size, 0); assert.equal(session.size, 0);
  await Promise.resolve(); assert.equal(completed, false); finish(); await pending;
  globalThis.__purgeResult = Promise.reject(new Error('Durable purge failed.'));
  await assert.rejects(clearBrowserPrivateState(), /Durable purge failed/);
});

test('offline page preparation uses root worker messaging without notification permission or push subscription', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'openjob-shell-helper-')); t.after(() => rm(directory, { recursive: true, force: true }));
  await build({ configFile: false, logLevel: 'silent', build: { ssr: resolve('app/workspace/offline-shell.ts'), outDir: directory, rollupOptions: { output: { entryFileNames: 'shell.mjs' } } } });
  const { prepareOfflineWorkspaceShell } = await import(pathToFileURL(join(directory, 'shell.mjs')).href);
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator'); t.after(() => { if (original) Object.defineProperty(globalThis, 'navigator', original); else delete globalThis.navigator; });
  const calls = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker: { async register(path, options) { calls.push({ path, options }); return { active: { postMessage(message, ports) { calls.push(message); ports[0].postMessage({ type: 'openjob:offline-shell-ready' }); ports[0].close(); } }, pushManager: { subscribe() { throw new Error('No subscription permitted.'); } } }; } } } });
  await prepareOfflineWorkspaceShell();
  assert.deepEqual(calls, [{ path: '/notification-service-worker.js', options: { scope: '/' } }, { type: 'openjob:prepare-offline-shell' }]);
});

test('temporary Mail login uses separate memory persistence and cannot sign out the saved primary login', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'openjob-session-auth-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const fake = join(directory, 'firebase.mjs');
  globalThis.__mailAuthCalls = [];
  t.after(() => { delete globalThis.__mailAuthCalls; });
  await writeFile(fake, `const apps=[],auths=new Map();
export const browserLocalPersistence='local',inMemoryPersistence='memory';
export function getApps(){return apps} export function initializeApp(config,name){const app={name};apps.push(app);return app}
export function getAuth(app){if(!auths.has(app.name))auths.set(app.name,{name:app.name,user:app.name==='openjob-web'?{uid:'saved',tenantId:null,providerData:[{providerId:'google.com'}],async getIdTokenResult(){return {signInProvider:'google.com'}},async getIdToken(){return 'invented'}}:null});return auths.get(app.name)}
export async function setPersistence(auth,mode){globalThis.__mailAuthCalls.push(['persistence',auth.name,mode])}
export function onAuthStateChanged(auth,listener){queueMicrotask(()=>listener(auth.user));return ()=>{}}
export async function signOut(auth){globalThis.__mailAuthCalls.push(['signout',auth.name]);auth.user=null}
export const onIdTokenChanged=onAuthStateChanged; export class GoogleAuthProvider{constructor(){this.scopes=['profile']}addScope(scope){this.scopes.push(scope)}setCustomParameters(){}static credentialFromResult(){return null}} export class OAuthProvider{}
export async function signInWithEmailAndPassword(){} export async function signInWithPopup(auth,provider){globalThis.__mailAuthCalls.push(['popup',auth.name,[...provider.scopes]]);return {user:auths.get('openjob-web').user}}`);
  await build({ configFile: false, logLevel: 'silent', resolve: { alias: { 'firebase/app': fake, 'firebase/auth': fake } }, define: { __OPENJOB_FIREBASE_CONFIG__: '{}', __OPENJOB_QA_PASSWORD_AUTH__: 'null', __OPENJOB_APPLE_SERVICE_ID__: '"fixture"' }, build: { ssr: resolve('app/firebase-auth.ts'), outDir: directory, emptyOutDir: false, rollupOptions: { output: { entryFileNames: 'auth.mjs' } } } });
  const { createFirebaseAuth } = await import(pathToFileURL(join(directory, 'auth.mjs')).href);
  const primary = createFirebaseAuth(), temporary = createFirebaseAuth({ sessionOnly: true });
  const observe = auth => new Promise((resolve, reject) => { const cancel = auth.observe(value => { cancel(); resolve(value); }, reject); });
  assert.equal((await observe(primary)).localIdentity.uid, 'saved');
  assert.equal(await observe(temporary), null); await temporary.signOut();
  assert.equal((await observe(primary)).localIdentity.uid, 'saved');
  await temporary.signIn('google'); await primary.signIn('google');
  assert.deepEqual(globalThis.__mailAuthCalls.find(([action,name]) => action === 'popup' && name === 'openjob-mail-person')[2], ['profile', 'email']);
  assert.deepEqual(globalThis.__mailAuthCalls.find(([action,name]) => action === 'popup' && name === 'openjob-web')[2], ['profile']);
  assert.ok(globalThis.__mailAuthCalls.some(([action,name,mode]) => action === 'persistence' && name === 'openjob-mail-person' && mode === 'memory'));
  assert.equal(globalThis.__mailAuthCalls.some(([action,name]) => action === 'signout' && name === 'openjob-web'), false);
  assert.equal(globalThis.__mailAuthCalls.some(([action,name,mode]) => action === 'persistence' && name === 'openjob-mail-person' && mode === 'local'), false);
});
