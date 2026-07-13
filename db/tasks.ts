import { env } from "cloudflare:workers";

export type TaskRecord = {
  id: string;
  assignee: string;
  description: string;
  dueDate: string | null;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
};

type TaskRow = {
  id: string;
  assignee: string;
  description: string;
  due_date: string | null;
  completed: number;
  created_at: string;
  updated_at: string;
};

function getDatabase() {
  const database = env.DB as D1Database | undefined;
  if (!database) throw new Error("The shared task database is unavailable.");
  return database;
}

function toTask(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    assignee: row.assignee,
    description: row.description,
    dueDate: row.due_date,
    completed: Boolean(row.completed),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function ensureTasksTable() {
  const database = getDatabase();
  await database.batch([
    database.prepare(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY NOT NULL,
        assignee TEXT NOT NULL,
        description TEXT NOT NULL,
        due_date TEXT,
        completed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    database.prepare(
      "CREATE INDEX IF NOT EXISTS tasks_status_due_idx ON tasks (completed, due_date)",
    ),
  ]);
  return database;
}

export async function listTasks(): Promise<TaskRecord[]> {
  const database = await ensureTasksTable();
  const result = await database
    .prepare(`
      SELECT id, assignee, description, due_date, completed, created_at, updated_at
      FROM tasks
      ORDER BY completed ASC,
        CASE WHEN due_date IS NULL THEN 1 ELSE 0 END ASC,
        due_date ASC,
        created_at DESC
    `)
    .all<TaskRow>();
  return result.results.map(toTask);
}

export async function createTask(input: {
  assignee: string;
  description: string;
  dueDate: string | null;
}): Promise<TaskRecord> {
  const database = await ensureTasksTable();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await database
    .prepare(`
      INSERT INTO tasks (id, assignee, description, due_date, completed, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, ?, ?)
    `)
    .bind(id, input.assignee, input.description, input.dueDate, now, now)
    .run();

  return {
    id,
    ...input,
    completed: false,
    createdAt: now,
    updatedAt: now,
  };
}

export async function setTaskCompleted(
  id: string,
  completed: boolean,
): Promise<TaskRecord | null> {
  const database = await ensureTasksTable();
  const now = new Date().toISOString();
  const result = await database
    .prepare("UPDATE tasks SET completed = ?, updated_at = ? WHERE id = ?")
    .bind(completed ? 1 : 0, now, id)
    .run();

  if (!result.meta.changes) return null;

  const row = await database
    .prepare(`
      SELECT id, assignee, description, due_date, completed, created_at, updated_at
      FROM tasks
      WHERE id = ?
    `)
    .bind(id)
    .first<TaskRow>();
  return row ? toTask(row) : null;
}
