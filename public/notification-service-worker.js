const NOTIFICATION_DATABASE = "openjob-notifications";
const INSTALLATION_STORE = "installation-state";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Push display is added with Task-event delivery. The worker intentionally has
// no fetch, cache, sync, or badge behavior. Page and worker share only the
// installation state database above so sign-out can suppress delayed delivery.
void NOTIFICATION_DATABASE;
void INSTALLATION_STORE;
