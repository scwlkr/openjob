export type NativeGroup = {
  groupId: string;
  name: string;
  role: "member" | "admin";
  createdAt: string;
};

export type NativeMember = {
  userId: string;
  username: string | null;
  role: "member" | "admin";
  joinedAt: string;
};

export type NativeTask = {
  taskId: string;
  groupId: string;
  text: string;
  assignee:
    | { state: "assigned"; userId: string; username: string }
    | { state: "unassigned" };
  priority: "high" | "normal" | "low";
  dueDate: string | null;
  state: "open" | "done";
  createdAt: string;
  completedAt: string | null;
};

export type NativeTaskListSnapshot = {
  members: NativeMember[];
  tasks: NativeTask[];
};

export type NativeTaskListController = {
  listGroups(): Promise<NativeGroup[]>;
  readTaskList(groupId: string): Promise<NativeTaskListSnapshot>;
};
