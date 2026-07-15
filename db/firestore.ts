import {
  createFirestoreRestClient,
  type FirebaseConfig,
  type FirestoreDocument,
  type FirestoreValue,
} from "./firestore-rest.ts";

export type TaskRecord = {
  id: string;
  assignee: string;
  description: string;
  dueDate: string | null;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
};

function fromFirestoreDocument(document: FirestoreDocument): TaskRecord {
  const fields = document.fields ?? {};
  const id = decodeURIComponent(document.name.split("/").at(-1) ?? "");
  const assignee = fields.assignee?.stringValue;
  const description = fields.description?.stringValue;
  const createdAt = fields.createdAt?.timestampValue;
  const updatedAt = fields.updatedAt?.timestampValue;

  if (!id || !assignee || !description || !createdAt || !updatedAt) {
    throw new Error("Firestore returned an invalid task record.");
  }

  return {
    id,
    assignee,
    description,
    dueDate: fields.dueDate?.stringValue ?? null,
    completed: fields.completed?.booleanValue ?? false,
    createdAt,
    updatedAt,
  };
}

function toFirestoreFields(task: Omit<TaskRecord, "id">) {
  const fields: Record<string, FirestoreValue> = {
    assignee: { stringValue: task.assignee },
    description: { stringValue: task.description },
    completed: { booleanValue: task.completed },
    createdAt: { timestampValue: task.createdAt },
    updatedAt: { timestampValue: task.updatedAt },
  };
  if (task.dueDate) fields.dueDate = { stringValue: task.dueDate };
  return fields;
}

function compareTasks(left: TaskRecord, right: TaskRecord) {
  if (left.completed !== right.completed) return left.completed ? 1 : -1;
  if (left.dueDate !== right.dueDate) {
    if (left.dueDate === null) return 1;
    if (right.dueDate === null) return -1;
    return left.dueDate.localeCompare(right.dueDate);
  }
  return right.createdAt.localeCompare(left.createdAt);
}

export function createFirestoreStore(
  config: FirebaseConfig,
  fetchImplementation: typeof fetch = fetch,
) {
  const { request } = createFirestoreRestClient(config, fetchImplementation);

  return {
    async listTasks() {
      const tasks: TaskRecord[] = [];
      let pageToken: string | undefined;

      do {
        const query = new URLSearchParams({ pageSize: "1000" });
        if (pageToken) query.set("pageToken", pageToken);
        const response = await request(`tasks?${query}`);
        const result = (await response.json()) as {
          documents?: FirestoreDocument[];
          nextPageToken?: string;
        };
        tasks.push(...(result.documents ?? []).map(fromFirestoreDocument));
        pageToken = result.nextPageToken;
      } while (pageToken);

      return tasks.sort(compareTasks);
    },

    async createTask(input: {
      assignee: string;
      description: string;
      dueDate: string | null;
    }) {
      const now = new Date().toISOString();
      const task: TaskRecord = {
        id: crypto.randomUUID(),
        ...input,
        completed: false,
        createdAt: now,
        updatedAt: now,
      };
      const response = await request(
        `tasks?documentId=${encodeURIComponent(task.id)}`,
        {
          method: "POST",
          body: JSON.stringify({ fields: toFirestoreFields(task) }),
        },
      );
      return fromFirestoreDocument((await response.json()) as FirestoreDocument);
    },

    async setTaskCompleted(id: string, completed: boolean) {
      const query = new URLSearchParams();
      query.append("updateMask.fieldPaths", "completed");
      query.append("updateMask.fieldPaths", "updatedAt");
      const response = await request(
        `tasks/${encodeURIComponent(id)}?${query}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            fields: {
              completed: { booleanValue: completed },
              updatedAt: { timestampValue: new Date().toISOString() },
            },
          }),
        },
        { allowNotFound: true },
      );
      if (response.status === 404) return null;
      return fromFirestoreDocument((await response.json()) as FirestoreDocument);
    },
  };
}
