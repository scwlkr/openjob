import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function workerSource() {
  return readFile(
    new URL("../public/notification-service-worker.js", import.meta.url),
    "utf8",
  );
}

function indexedDbWith(record) {
  return {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = {
          close() {},
          objectStoreNames: { contains: () => true },
          transaction() {
            return {
              objectStore() {
                return {
                  get() {
                    const read = {};
                    queueMicrotask(() => {
                      read.result = record;
                      read.onsuccess?.();
                    });
                    return read;
                  },
                };
              },
            };
          },
        };
        request.onsuccess?.();
      });
      return request;
    },
  };
}

test("the notification worker preserves lifecycle and push behavior alongside explicit public shell caching", async () => {
  const source = await workerSource();
  const listeners = new Map();
  const calls = [];
  const self = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    clients: {
      claim() {
        calls.push("claim");
        return Promise.resolve();
      },
    },
    skipWaiting() {
      calls.push("skipWaiting");
    },
  };
  vm.runInNewContext(source, { self });

  assert.deepEqual([...listeners.keys()].sort(), [
    "activate",
    "fetch",
    "install",
    "message",
    "notificationclick",
    "push",
  ]);
  assert.equal(listeners.has("fetch"), true);
  assert.equal(listeners.has("sync"), false);
  assert.doesNotMatch(source, /setAppBadge|clearAppBadge/);

  listeners.get("install")({});
  let activation;
  listeners.get("activate")({ waitUntil(promise) { activation = promise; } });
  await activation;
  assert.deepEqual(calls, ["skipWaiting", "claim"]);
});

test("the notification worker displays only matching recipient payloads with Task-scoped replacement", async () => {
  const listeners = new Map();
  const shown = [];
  const installationState = {
    installationId: "installation_0123456789",
    ownerUserId: "user_eli",
    active: true,
  };
  const self = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    clients: { claim: async () => undefined },
    registration: {
      async showNotification(title, options) { shown.push({ title, options }); },
    },
    skipWaiting() {},
  };
  vm.runInNewContext(await workerSource(), {
    indexedDB: indexedDbWith(installationState),
    queueMicrotask,
    self,
  });

  async function push(data) {
    let completion;
    listeners.get("push")({
      data: { json: () => data },
      waitUntil(promise) { completion = promise; },
    });
    await completion;
  }

  await push({
    recipientUserId: "user_eli",
    eventKind: "assignment",
    groupId: "grp_notifications",
    groupName: "Release Team",
    taskId: "task_release",
    taskPreview: `  Prepare\n\n release ${"x".repeat(180)}  `,
    launchTarget: "/?notification-group=grp_notifications",
  });
  assert.equal(shown.length, 1);
  assert.equal(shown[0].title, "Assigned in Release Team");
  assert.equal(shown[0].options.body, `Prepare release ${"x".repeat(143)}…`);
  assert.equal(shown[0].options.tag, "task_release");
  assert.equal(shown[0].options.renotify, true);
  assert.deepEqual(JSON.parse(JSON.stringify(shown[0].options.data)), {
    groupId: "grp_notifications",
    launchTarget: "/?notification-group=grp_notifications",
  });

  await push({
    recipientUserId: "user_eli",
    eventKind: "completion",
    groupId: "grp_notifications",
    groupName: "Release Team",
    taskId: "task_release",
    taskPreview: "Prepare release",
    launchTarget: "/?notification-group=grp_notifications",
  });
  assert.equal(shown[1].title, "Completed in Release Team");
  assert.equal(shown[1].options.tag, shown[0].options.tag);

  await push({
    recipientUserId: "user_previous",
    eventKind: "completion",
    groupId: "grp_notifications",
    groupName: "Release Team",
    taskId: "task_release",
    taskPreview: "Private Task",
    launchTarget: "/?notification-group=grp_notifications",
  });
  await push({ recipientUserId: "user_eli", eventKind: "malformed" });
  installationState.active = false;
  await push({
    recipientUserId: "user_eli",
    eventKind: "assignment",
    groupId: "grp_notifications",
    groupName: "Release Team",
    taskId: "task_signed_out",
    taskPreview: "Private Task",
    launchTarget: "/?notification-group=grp_notifications",
  });
  assert.equal(shown.length, 2);
});

test("notification selection focuses an existing OpenJob client or opens the Group launch target", async () => {
  const listeners = new Map();
  const calls = [];
  const records = new Map();
  const indexedDB = {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = {
          close() {},
          objectStoreNames: { contains: () => true },
          transaction() {
            const transaction = {
              objectStore() {
                return {
                  put(value, key) {
                    records.set(key, value);
                    calls.push({ pendingLaunch: { key, value } });
                  },
                };
              },
            };
            queueMicrotask(() => transaction.oncomplete?.());
            return transaction;
          },
        };
        request.onsuccess?.();
      });
      return request;
    },
  };
  let windows = [{
    async navigate(target) { calls.push({ navigate: target }); return this; },
    async focus() { calls.push("focus"); },
    postMessage(message) { calls.push({ message }); },
  }];
  const self = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    clients: {
      async claim() {},
      async matchAll(options) { calls.push({ options }); return windows; },
      async openWindow(target) { calls.push({ openWindow: target }); },
    },
    skipWaiting() {},
  };
  vm.runInNewContext(await workerSource(), { indexedDB, queueMicrotask, self });

  async function click() {
    let completion;
    listeners.get("notificationclick")({
      notification: {
        close() { calls.push("close"); },
        data: {
          groupId: "grp_notifications",
          launchTarget: "/?notification-group=grp_notifications",
        },
      },
      waitUntil(promise) { completion = promise; },
    });
    await completion;
  }

  await click();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    "close",
    { pendingLaunch: {
      key: "pending-launch",
      value: { groupId: "grp_notifications" },
    } },
    { options: { type: "window", includeUncontrolled: true } },
    { navigate: "/?notification-group=grp_notifications" },
    "focus",
    { message: {
      type: "openjob:select-notification-group",
      groupId: "grp_notifications",
    } },
  ]);

  calls.length = 0;
  windows = [];
  await click();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    "close",
    { pendingLaunch: {
      key: "pending-launch",
      value: { groupId: "grp_notifications" },
    } },
    { options: { type: "window", includeUncontrolled: true } },
    { openWindow: "/?notification-group=grp_notifications" },
  ]);
});

test('public shell preparation omits credentials and excludes private/API/auth/nonhashed requests from cache', async () => {
  const listeners = new Map(), entries = new Map(), fetched = [], messages = [];
  let offline = false;
  const cache = { async put(url, response) { entries.set(url, response); }, async match(url) { return entries.get(url)?.clone(); }, async keys() { return [...entries.keys()].map(url => new Request(url)); }, async delete(request) { return entries.delete(request.url); } };
  const self = { location: { origin: 'https://openjob.example' }, addEventListener(type, callback) { listeners.set(type, callback); } };
  const fetch = async (request, options) => {
    const url = typeof request === 'string' ? request : request.url;
    fetched.push({ url, options }); if (offline) throw new Error('Offline.');
    if (url.endsWith('/workspace')) return new Response('<script type="module" src="/assets/page-12345678.js"></script><link href="/assets/page-12345678.css" rel="stylesheet"><script src="/api/v1/me"></script>', { headers: { 'content-type': 'text/html' } });
    return new Response(url.endsWith('.js') ? 'import "./chunk-abcdefgh.js";' : 'body{}', { headers: { 'content-type': url.endsWith('.js') ? 'text/javascript' : 'text/css' } });
  };
  vm.runInNewContext(await workerSource(), { self, fetch, caches: { open: async () => cache }, URL, TextDecoder, Set });
  let completion;
  listeners.get('message')({ data: { type: 'openjob:prepare-offline-shell' }, ports: [{ postMessage(message) { messages.push(message.type); } }], waitUntil(promise) { completion = promise; } });
  await completion;
  assert.deepEqual(messages, ['openjob:offline-shell-ready']);
  assert.equal(entries.size, 4); assert.ok(entries.has('https://openjob.example/assets/chunk-abcdefgh.js'));
  assert.ok(fetched.every(call => call.options.credentials === 'omit' && call.options.redirect === 'error'));
  for (const path of ['/api/v1/me', '/auth/callback', '/__test/state', '/workspace?private=1', '/assets/unhashed.js', '/']) {
    let intercepted = false; listeners.get('fetch')({ request: new Request(`https://openjob.example${path}`), respondWith() { intercepted = true; } });
    assert.equal(intercepted, false, path);
  }
  let intercepted = false;
  listeners.get('fetch')({ request: new Request('https://openjob.example/workspace', { headers: { authorization: 'Bearer private' } }), respondWith() { intercepted = true; } });
  assert.equal(intercepted, false);
  offline = true;
  let response;
  listeners.get('fetch')({ request: new Request('https://openjob.example/workspace'), respondWith(promise) { response = promise; } });
  assert.match(await (await response).text(), /page-12345678/);
  assert.equal(entries.size, 4, 'runtime navigation never adds a cache entry');
});
