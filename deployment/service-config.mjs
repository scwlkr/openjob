import { readFile } from 'node:fs/promises';

export async function serviceConfiguration(environment) {
  const keys = ['FIREBASE_PROJECT_ID', 'FIREBASE_API_KEY', 'FIREBASE_APP_ID', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_CLIENT_EMAIL'];
  const missing = keys.filter(key => !environment[key]?.trim());
  let privateKey = environment.FIREBASE_PRIVATE_KEY?.replaceAll('\\n', '\n');
  if (environment.FIREBASE_PRIVATE_KEY_FILE) {
    try { privateKey = await readFile(environment.FIREBASE_PRIVATE_KEY_FILE, 'utf8'); }
    catch { missing.push('FIREBASE_PRIVATE_KEY_FILE (unreadable)'); }
  }
  if (!privateKey?.trim()) missing.push('FIREBASE_PRIVATE_KEY or FIREBASE_PRIVATE_KEY_FILE');
  return {
    missing,
    firebase: { projectId: environment.FIREBASE_PROJECT_ID ?? '', apiKey: environment.FIREBASE_API_KEY ?? '', appId: environment.FIREBASE_APP_ID ?? '', authDomain: environment.FIREBASE_AUTH_DOMAIN ?? '' },
    server: { projectId: environment.FIREBASE_PROJECT_ID, apiKey: environment.FIREBASE_API_KEY, clientEmail: environment.FIREBASE_CLIENT_EMAIL, privateKey },
    appleServiceId: environment.APPLE_SIGN_IN_SERVICE_ID ?? '',
  };
}
