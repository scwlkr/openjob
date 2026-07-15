import { env } from "cloudflare:workers";
import { createFirestoreUserStore } from "@/db/users";
import { createFirebaseIdTokenVerifier } from "./firebase-id-token";
import { createV1IdentityApi } from "./v1-identity";

type FirebaseBindings = {
  FIREBASE_CLIENT_EMAIL?: string;
  FIREBASE_PRIVATE_KEY?: string;
  FIREBASE_PROJECT_ID?: string;
};

let identityApi: ReturnType<typeof createV1IdentityApi> | null = null;

function requiredBinding(
  bindings: FirebaseBindings,
  name: keyof FirebaseBindings,
) {
  const value = bindings[name];
  if (!value) throw new Error(`The ${name} binding is unavailable.`);
  return value;
}

function getIdentityApi() {
  if (identityApi) return identityApi;
  const bindings = env as FirebaseBindings;
  const projectId = requiredBinding(bindings, "FIREBASE_PROJECT_ID");
  const users = createFirestoreUserStore({
    projectId,
    clientEmail: requiredBinding(bindings, "FIREBASE_CLIENT_EMAIL"),
    privateKey: requiredBinding(bindings, "FIREBASE_PRIVATE_KEY"),
  });
  identityApi = createV1IdentityApi({
    users,
    verifyIdToken: createFirebaseIdTokenVerifier({ projectId }),
  });
  return identityApi;
}

export function handleV1IdentityRequest(request: Request) {
  return getIdentityApi().fetch(request);
}
