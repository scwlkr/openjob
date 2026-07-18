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
