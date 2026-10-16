const NOTIFICATION_DATABASE = "openjob-notifications";
const INSTALLATION_STORE = "installation-state";
const PENDING_LAUNCH_RECORD = "pending-launch";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function readInstallationState() {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(NOTIFICATION_DATABASE, 1);
      request.onerror = () => resolve(null);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(INSTALLATION_STORE)) {
          request.result.createObjectStore(INSTALLATION_STORE);
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(INSTALLATION_STORE)) {
          database.close();
          resolve(null);
          return;
        }
        const transaction = database.transaction(INSTALLATION_STORE, "readonly");
        const read = transaction.objectStore(INSTALLATION_STORE).get("current");
        read.onerror = () => {
          database.close();
          resolve(null);
        };
        read.onsuccess = () => {
          database.close();
          resolve(read.result ?? null);
        };
      };
    } catch {
      resolve(null);
    }
  });
}

function writePendingLaunch(groupId) {
  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open(NOTIFICATION_DATABASE, 1);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(INSTALLATION_STORE)) {
          request.result.createObjectStore(INSTALLATION_STORE);
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(INSTALLATION_STORE, "readwrite");
        transaction.objectStore(INSTALLATION_STORE).put(
          { groupId },
          PENDING_LAUNCH_RECORD,
        );
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => {
          database.close();
          reject(transaction.error);
        };
      };
    } catch (error) {
      reject(error);
    }
  });
}

function normalizedPreview(text) {
  const normalized = text.replace(/\s+/gu, " ").trim();
  const characters = Array.from(normalized);
  return characters.length <= 160
    ? normalized
    : `${characters.slice(0, 159).join("")}…`;
}

function notificationPayload(event) {
  try {
    const payload = event.data?.json();
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      Object.keys(payload).sort().join(",") !==
        "eventKind,groupId,groupName,launchTarget,recipientUserId,taskId,taskPreview" ||
      !["assignment", "completion"].includes(payload.eventKind) ||
      typeof payload.recipientUserId !== "string" ||
      !/^user_[A-Za-z0-9_-]+$/.test(payload.recipientUserId) ||
      typeof payload.groupId !== "string" ||
      !/^grp_[A-Za-z0-9_-]+$/.test(payload.groupId) ||
      typeof payload.groupName !== "string" ||
      payload.groupName.length === 0 ||
      typeof payload.taskId !== "string" ||
      !/^task_[A-Za-z0-9_-]+$/.test(payload.taskId) ||
      typeof payload.taskPreview !== "string" ||
      payload.launchTarget !==
        `/?notification-group=${encodeURIComponent(payload.groupId)}`
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

async function displayPush(event) {
  const payload = notificationPayload(event);
  if (!payload) return;
  const installation = await readInstallationState();
  if (
    !installation?.active ||
    installation.ownerUserId !== payload.recipientUserId
  ) {
    return;
  }
  await self.registration.showNotification(
    payload.eventKind === "assignment"
      ? `Assigned in ${payload.groupName}`
      : `Completed in ${payload.groupName}`,
    {
      body: normalizedPreview(payload.taskPreview),
      tag: payload.taskId,
      renotify: true,
      data: {
        groupId: payload.groupId,
        launchTarget: payload.launchTarget,
      },
    },
  );
}

self.addEventListener("push", (event) => {
  event.waitUntil(displayPush(event));
});

async function selectNotificationGroup(notification) {
  notification.close();
  const groupId = notification.data?.groupId;
  const launchTarget = notification.data?.launchTarget;
  if (
    typeof groupId !== "string" ||
    launchTarget !== `/?notification-group=${encodeURIComponent(groupId)}`
  ) {
    return;
  }
  await writePendingLaunch(groupId).catch(() => undefined);
  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  if (windows.length === 0) {
    await self.clients.openWindow(launchTarget);
    return;
  }
  const client = windows[0];
  const navigatedClient = await client.navigate(launchTarget);
  const targetClient = navigatedClient ?? client;
  await targetClient.focus();
  targetClient.postMessage({
    type: "openjob:select-notification-group",
    groupId,
  });
}

self.addEventListener("notificationclick", (event) => {
  event.waitUntil(selectNotificationGroup(event.notification));
});

// Public shell only. Private API responses and credentials never enter Cache Storage.
const WORKSPACE_SHELL_CACHE = "openjob-workspace-shell-v1";
const SHELL_ASSET_LIMIT = 192;
const SHELL_BYTE_LIMIT = 16 * 1024 * 1024;
function publicShellUrl(value, base = self.location.origin) {
  const url = new URL(value, base);
  if (url.origin !== self.location.origin || url.search || url.hash || /\/(?:api|auth|__test)(?:\/|$)/i.test(url.pathname)) return null;
  if (url.pathname === "/workspace") return url;
  if (/^\/(?:assets|_next\/static)\/[A-Za-z0-9_./-]*[.-][A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|svg|png|webp)$/u.test(url.pathname)) return url;
  return null;
}
async function prepareWorkspaceShell() {
  const queue = [new URL("/workspace", self.location.origin)];
  const seen = new Set(); const responses = []; let bytes = 0;
  while (queue.length) {
    const url = queue.shift();
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    if (seen.size > SHELL_ASSET_LIMIT) throw new Error("Public shell is too large.");
    const response = await fetch(url.href, { credentials: "omit", redirect: "error", cache: "no-store", headers: { "accept": url.pathname === "/workspace" ? "text/html" : "*/*" } });
    if (!response.ok || response.type === "opaque" || response.redirected || response.headers.has("set-cookie")) throw new Error("Public shell unavailable.");
    const buffer = await response.clone().arrayBuffer(); bytes += buffer.byteLength;
    if (buffer.byteLength > 2 * 1024 * 1024 || bytes > SHELL_BYTE_LIMIT) throw new Error("Public shell is too large.");
    const contentType = response.headers.get("content-type") ?? "";
    if (url.pathname === "/workspace" && !contentType.includes("text/html")) throw new Error("Public shell unavailable.");
    responses.push([url.href, response]);
    if (/html|javascript|css/.test(contentType)) {
      const text = new TextDecoder().decode(buffer);
      for (const match of text.matchAll(/["'(]([^"'()\s<>]+\.(?:js|css|woff2?|svg|png|webp))["')]/g)) {
        const resource = /^(?:assets|_next\/static)\//.test(match[1]) ? `/${match[1]}` : match[1];
        const asset = publicShellUrl(resource, url.href);
        if (asset && asset.pathname !== "/workspace" && !seen.has(asset.href)) queue.push(asset);
      }
    }
  }
  const cache = await caches.open(WORKSPACE_SHELL_CACHE);
  // Publish the HTML last so a failed asset write preserves the previous prepared page.
  for (const [url, response] of responses.reverse()) await cache.put(url, response);
  for (const request of await cache.keys()) if (!seen.has(request.url)) await cache.delete(request);
}
self.addEventListener("message", event => {
  if (event.data?.type !== "openjob:prepare-offline-shell") return;
  event.waitUntil(prepareWorkspaceShell().then(
    () => event.ports?.[0]?.postMessage({ type: "openjob:offline-shell-ready" }),
    () => event.ports?.[0]?.postMessage({ type: "openjob:offline-shell-failed" }),
  ));
});
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || request.headers.has("authorization")) return;
  const url = publicShellUrl(request.url);
  if (!url) return;
  event.respondWith((async () => {
    const cache = await caches.open(WORKSPACE_SHELL_CACHE);
    if (url.pathname !== "/workspace") {
      const cached = await cache.match(url.href); if (cached) return cached;
    }
    try { return await fetch(request); }
    catch (error) { const cached = await cache.match(url.href); if (cached) return cached; throw error; }
  })());
});
