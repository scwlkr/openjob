import { open } from 'node:fs/promises';

async function readSecretFile(path) {
  const file = await open(path, 'r');
  try {
    const info = await file.stat(); if (!info.isFile() || info.size > 4096) throw new Error();
    const buffer = Buffer.alloc(4097), { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 4096) throw new Error();
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally { await file.close(); }
}

/** Explicit opt-in only. Never print file names, secret values or parser errors. */
export async function googleServiceConfiguration(environment, readSecret = readSecretFile) {
  const mode = environment.OPENJOB_GOOGLE_CONNECTIONS_MODE ?? 'disabled';
  if (mode === 'disabled') return undefined;
  if (mode !== 'configured') throw new Error('Google connection configuration invalid.');
  try {
    const origin = new URL(environment.OPENJOB_PUBLIC_ORIGIN);
    const clientId = environment.OPENJOB_GOOGLE_CLIENT_ID;
    const keyId = environment.OPENJOB_GOOGLE_KEY_ID;
    const ownerUserId = environment.OPENJOB_GOOGLE_OWNER_USER_ID;
    const firebaseUid = environment.OPENJOB_GOOGLE_OWNER_FIREBASE_UID;
    const address = environment.OPENJOB_GOOGLE_MAILBOX;
    if (origin.protocol !== 'https:' || origin.href !== origin.origin + '/' || origin.username || origin.password || !/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId ?? '') || !/^[a-zA-Z0-9_-]{1,64}$/.test(keyId ?? '')) throw new Error();
    if (!/^user_[a-f0-9]{32}$/.test(ownerUserId ?? '') || typeof firebaseUid !== 'string' || !firebaseUid || firebaseUid.length > 128 || /\s/.test(firebaseUid) || typeof address !== 'string' || address.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error();
    const secretFile = environment.OPENJOB_GOOGLE_CLIENT_SECRET_FILE, keyFile = environment.OPENJOB_GOOGLE_KEY_FILE;
    if (typeof secretFile !== 'string' || !secretFile.startsWith('/') || typeof keyFile !== 'string' || !keyFile.startsWith('/') || secretFile === keyFile) throw new Error();
    // Read only explicitly selected files; no default credentials, discovery or generation.
    const [secretRaw, keyRaw] = await Promise.all([readSecret(secretFile, 'utf8'), readSecret(keyFile, 'utf8')]);
    if (typeof secretRaw !== 'string' || secretRaw.length > 4096 || typeof keyRaw !== 'string' || keyRaw.length > 128) throw new Error();
    const clientSecret = secretRaw.trim(), encodedKey = keyRaw.trim();
    if (!clientSecret || /[^\x21-\x7e]/.test(clientSecret) || !/^[A-Za-z0-9+/]{43}=$/.test(encodedKey)) throw new Error();
    const bytes = Buffer.from(encodedKey, 'base64');
    if (bytes.length !== 32 || bytes.toString('base64') !== encodedKey) throw new Error();
    const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
    bytes.fill(0);
    return { executionMode: 'configured', ownerUserId, firebaseUid, address, key, keyId, clientId, clientSecret, callbackUri: origin.origin + '/connections/google/callback' };
  } catch { throw new Error('Google connection configuration invalid.'); }
}
