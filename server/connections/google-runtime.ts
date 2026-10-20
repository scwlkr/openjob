import { createFirestoreRestClient, type FirebaseConfig } from '../../db/firestore-rest.ts';
import { createFirestorePrivateGoogleConnections } from '../../db/private-google-connections.ts';
import { isActiveUser } from '../../db/user-history.ts';
import { createGoogleConnectionsFlow } from './google-flow.ts';
import { connectionFail } from '../../shared/connection-onboarding.ts';

type FlowOptions = Parameters<typeof createGoogleConnectionsFlow>[0];
export type PortableGoogleConfiguration = {
  executionMode: 'configured'; key: CryptoKey; keyId: string;
  previousKeys?: Readonly<Record<string, CryptoKey>>;
  ownerUserId: string; firebaseUid: string; address: string;
  clientId: string; clientSecret: string; callbackUri: string;
};
/** Explicit server-only composition; not an environment/credential loader. */
export function createGoogleConnectionsRuntime(options: {
  configuration: PortableGoogleConfiguration;
  firebase: FirebaseConfig;
  databaseTransport: typeof fetch;
  googleTransport: typeof fetch;
  mailTransport: typeof fetch;
  homes: FlowOptions['homes'];
  evidenceMode?: FlowOptions['evidenceMode'];
}) {
  const config = { ...options.configuration };
  if (config.executionMode !== 'configured' || !/^user_[a-f0-9]{32}$/.test(config.ownerUserId) || typeof config.firebaseUid !== 'string' || !config.firebaseUid || config.firebaseUid.length > 128 || /\s/.test(config.firebaseUid) || typeof config.address !== 'string' || config.address.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.address)) throw new Error('Google runtime is not configured.');
  const db = createFirestoreRestClient(options.firebase, options.databaseTransport);
  const store = createFirestorePrivateGoogleConnections({ db, key: config.key, keyId: config.keyId, previousKeys: config.previousKeys, executionMode: 'configured' });
  const flow = createGoogleConnectionsFlow({ executionMode: 'configured', evidenceMode: options.evidenceMode, repository: store, homes: options.homes, isOwnerActive: owner => owner === config.ownerUserId ? isActiveUser(db, owner) : Promise.resolve(false), google: { clientId: config.clientId, clientSecret: config.clientSecret, callbackUri: config.callbackUri, transport: options.googleTransport }, mailTransport: options.mailTransport });
  return { flow: { ...flow, begin(owner: string, address: string, workspaceId: string) {
    if (address.toLowerCase() !== config.address.toLowerCase()) connectionFail('forbidden');
    return flow.begin(owner, address, workspaceId);
  } }, admission: { userId: config.ownerUserId, provider: 'google' as const, firebaseUid: config.firebaseUid }, cleanup: { removeForDeletion: store.removeForDeletion } };
}
