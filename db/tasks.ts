import { env } from "cloudflare:workers";
import { createFirestoreStore } from "./firestore";

export type { TaskRecord } from "./firestore";

type FirebaseBindings = {
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_CLIENT_EMAIL?: string;
  FIREBASE_PRIVATE_KEY?: string;
};

let store: ReturnType<typeof createFirestoreStore> | null = null;

function requiredBinding(bindings: FirebaseBindings, name: keyof FirebaseBindings) {
  const value = bindings[name];
  if (!value) throw new Error(`The ${name} binding is unavailable.`);
  return value;
}

function getStore() {
  if (store) return store;
  const bindings = env as FirebaseBindings;
  store = createFirestoreStore({
    projectId: requiredBinding(bindings, "FIREBASE_PROJECT_ID"),
    clientEmail: requiredBinding(bindings, "FIREBASE_CLIENT_EMAIL"),
    privateKey: requiredBinding(bindings, "FIREBASE_PRIVATE_KEY"),
  });
  return store;
}

export async function listTasks() {
  return getStore().listTasks();
}

export async function createTask(input: {
  assignee: string;
  description: string;
  dueDate: string | null;
}) {
  return getStore().createTask(input);
}

export async function setTaskCompleted(id: string, completed: boolean) {
  return getStore().setTaskCompleted(id, completed);
}
