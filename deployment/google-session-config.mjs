/** Nonsecret, default-off local selection only; never discovers credentials or keys. */
export function googleSessionConfiguration(environment) {
  const mode = environment.OPENJOB_GOOGLE_SESSION_MODE ?? 'disabled';
  if (mode === 'disabled') return undefined;
  try {
    if (mode !== 'configured' || environment.FIREBASE_PROJECT_ID !== 'openjob-nonprod' || (environment.OPENJOB_GOOGLE_CONNECTIONS_MODE ?? 'disabled') !== 'disabled') throw new Error();
    const origin = new URL(environment.OPENJOB_PUBLIC_ORIGIN);
    const ownerUserId = environment.OPENJOB_GOOGLE_OWNER_USER_ID, firebaseUid = environment.OPENJOB_GOOGLE_OWNER_FIREBASE_UID;
    const address = environment.OPENJOB_GOOGLE_MAILBOX, clientId = environment.OPENJOB_GOOGLE_CLIENT_ID;
    if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || origin.origin !== environment.OPENJOB_PUBLIC_ORIGIN || !/^user_[a-f0-9]{32}$/.test(ownerUserId ?? '') || typeof firebaseUid !== 'string' || !firebaseUid || firebaseUid.length > 128 || /\s/.test(firebaseUid) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address ?? '') || !/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId ?? '')) throw new Error();
    return { origin: origin.origin, ownerUserId, firebaseUid, address, clientId };
  } catch { throw new Error('Local Gmail session configuration invalid.'); }
}
