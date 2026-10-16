/** Local prototype only. Never expose host credentials to production service adapters. */
export const env = Object.freeze({});
export function waitUntil(task: Promise<unknown>) {
  void task.catch(() => {});
}
