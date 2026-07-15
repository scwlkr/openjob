import { env } from "cloudflare:workers";
import { createFirestoreGroupStore } from "@/db/groups";
import { createFirestoreUserStore } from "@/db/users";
import { createFirebaseIdTokenVerifier } from "./firebase-id-token";
import { createV1GroupsApi, createV1GroupsHandler } from "./v1-groups";
import { createV1IdentityApi, createV1IdentityHandler } from "./v1-identity";

type FirebaseBindings = {
  FIREBASE_CLIENT_EMAIL?: string;
  FIREBASE_PRIVATE_KEY?: string;
  FIREBASE_PROJECT_ID?: string;
};

type V1Runtime = {
  groupsApi: ReturnType<typeof createV1GroupsApi>;
  identityApi: ReturnType<typeof createV1IdentityApi>;
};

let runtime: V1Runtime | null = null;

function requiredBinding(
  bindings: FirebaseBindings,
  name: keyof FirebaseBindings,
) {
  const value = bindings[name];
  if (!value) throw new Error(`The ${name} binding is unavailable.`);
  return value;
}

function getRuntime() {
  if (runtime) return runtime;
  const bindings = env as FirebaseBindings;
  const projectId = requiredBinding(bindings, "FIREBASE_PROJECT_ID");
  const firebase = {
    projectId,
    clientEmail: requiredBinding(bindings, "FIREBASE_CLIENT_EMAIL"),
    privateKey: requiredBinding(bindings, "FIREBASE_PRIVATE_KEY"),
  };
  const users = createFirestoreUserStore(firebase);
  const groups = createFirestoreGroupStore(firebase);
  const verifyIdToken = createFirebaseIdTokenVerifier({ projectId });
  runtime = {
    groupsApi: createV1GroupsApi({ groups, users, verifyIdToken }),
    identityApi: createV1IdentityApi({ groups, users, verifyIdToken }),
  };
  return runtime;
}

function getIdentityApi() {
  return getRuntime().identityApi;
}

function getGroupsApi() {
  return getRuntime().groupsApi;
}

export const handleV1IdentityRequest = createV1IdentityHandler(getIdentityApi);
export const handleV1GroupsRequest = createV1GroupsHandler(getGroupsApi);
