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

test("the notification worker has lifecycle behavior without app fetch, cache, sync, or badge behavior", async () => {
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
    "install",
    "notificationclick",
    "push",
  ]);
  assert.equal(listeners.has("fetch"), false);
  assert.equal(listeners.has("sync"), false);
  assert.doesNotMatch(source, /\bcaches\b|setAppBadge|clearAppBadge/);

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
  let windows = [{
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
  vm.runInNewContext(await workerSource(), { self });

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
    { options: { type: "window", includeUncontrolled: true } },
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
    { options: { type: "window", includeUncontrolled: true } },
    { openWindow: "/?notification-group=grp_notifications" },
  ]);
});
