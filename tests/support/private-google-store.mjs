import { createFirestorePrivateGoogleConnections } from '../../db/private-google-connections.ts';
import { createFirestoreRestClient } from '../../db/firestore-rest.ts';
import { googleFlowFixture } from './google-connection-flow.mjs';
export async function privateGoogleStoreFixture() {
  const f = await googleFlowFixture();
  // Deterministic invented test bytes only; no real key or credential is created.
  const key = await crypto.subtle.importKey('raw', new Uint8Array(32).fill(7), 'AES-GCM', false, ['encrypt', 'decrypt']);
  const client = createFirestoreRestClient(f.config, f.db.fetch), options = { db: client, key, keyId: 'synthetic-key-v1', executionMode: 'configured' };
  const store = createFirestorePrivateGoogleConnections(options);
  f.reconstruct({ repository: store });
  const location = client.documentName(`v1PrivateGoogleConnections/${f.owner}`);
  return { ...f, store, options, client, location }; 
}

