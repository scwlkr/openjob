const apps: Array<{ name: string; options: Record<string, string> }> = [];

export function getApps() {
  return apps;
}

export function initializeApp(options: Record<string, string>, name: string) {
  const app = { name, options };
  apps.push(app);
  return app;
}
