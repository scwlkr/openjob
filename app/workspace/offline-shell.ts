/** Prepare only the public application shell; this never asks for push permission. */
export async function prepareOfflineWorkspaceShell(): Promise<void> {
  if (!navigator.serviceWorker) throw new Error("Offline page preparation is unavailable.");
  const registration = await navigator.serviceWorker.register("/notification-service-worker.js", { scope: "/" });
  const ready = registration.active ? registration : await navigator.serviceWorker.ready;
  const worker = ready.active;
  if (!worker) throw new Error("Offline page preparation is unavailable.");
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); reject(new Error("Offline page preparation timed out.")); }, 30000);
    channel.port1.onmessage = event => {
      clearTimeout(timer); channel.port1.close();
      if (event.data?.type === "openjob:offline-shell-ready") resolve();
      else reject(new Error("Offline page preparation failed."));
    };
    worker.postMessage({ type: "openjob:prepare-offline-shell" }, [channel.port2]);
  });
}
