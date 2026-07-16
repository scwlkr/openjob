export type User = {
  userId: string;
  username: string | null;
  usernameRequired: boolean;
};

export type Group = {
  groupId: string;
  name: string;
  role: "member" | "admin";
  createdAt: string;
};

export type Member = {
  userId: string;
  username: string | null;
  role: "member" | "admin";
  joinedAt: string;
};

export type Task = {
  taskId: string;
  groupId: string;
  text: string;
  assignee:
    | { state: "assigned"; userId: string; username: string }
    | { state: "unassigned" };
  dueDate: string | null;
  state: "open" | "done";
  createdAt: string;
  completedAt: string | null;
};

export type AuthSession = { getIdToken(): Promise<string> };

export type OpenJobAuth = {
  observe(
    listener: (session: AuthSession | null) => void,
    onError?: (error: unknown) => void,
  ): () => void;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
};

export type OpenJobApi = {
  getMe(token: string): Promise<User>;
  claimUsername(token: string, username: string): Promise<User>;
  listGroups(token: string): Promise<Group[]>;
  getGroup(token: string, groupId: string): Promise<Group>;
  createGroup(token: string, name: string): Promise<Group>;
  listMembers(token: string, groupId: string): Promise<Member[]>;
  listTasks(token: string, groupId: string): Promise<Task[]>;
  createTask(
    token: string,
    groupId: string,
    input: { text: string; assigneeUsername: string; dueDate?: string },
  ): Promise<Task>;
  updateTask(
    token: string,
    groupId: string,
    taskId: string,
    input: { text?: string; assigneeUsername?: string; dueDate?: string | null },
  ): Promise<Task>;
  setTaskState(
    token: string,
    groupId: string,
    taskId: string,
    state: "open" | "done",
  ): Promise<Task>;
  deleteTask(token: string, groupId: string, taskId: string): Promise<void>;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
