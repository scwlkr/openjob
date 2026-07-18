import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("the notification worker has lifecycle behavior without app fetch, cache, sync, or badge behavior", async () => {
  const source = await readFile(
    new URL("../public/notification-service-worker.js", import.meta.url),
    "utf8",
  );
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

  assert.deepEqual([...listeners.keys()].sort(), ["activate", "install"]);
  assert.equal(listeners.has("fetch"), false);
  assert.equal(listeners.has("sync"), false);
  assert.doesNotMatch(source, /\bcaches\b|setAppBadge|clearAppBadge/);

  listeners.get("install")({});
  let activation;
  listeners.get("activate")({ waitUntil(promise) { activation = promise; } });
  await activation;
  assert.deepEqual(calls, ["skipWaiting", "claim"]);
});
