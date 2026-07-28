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
    | { state: "unassigned" }
    | { state: "deleted" };
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

export type NativeTaskListReadResult =
  | {
      kind: "changed";
      tasks: NativeTask[];
      validator: string;
    }
  | {
      kind: "not-modified";
      validator: string;
    };

export type NativeTaskStatus = "open" | "done" | "all";

export type NativeCachedTaskList = {
  freshAt: string;
  group: NativeGroup;
  snapshot: NativeTaskListSnapshot;
  status: NativeTaskStatus;
  validator: string;
};

export type NativeTaskListSyncResult =
  | {
      freshAt: string;
      kind: "changed";
      snapshot: NativeTaskListSnapshot;
      validator: string;
    }
  | {
      freshAt: string;
      kind: "not-modified";
      validator: string;
    };

export type NativeTaskListController = {
  listGroups(): Promise<NativeGroup[]>;
  loadCachedTaskList(): Promise<NativeCachedTaskList | null>;
  purgeCachedTaskList(): Promise<void>;
  readTaskList(groupId: string): Promise<NativeTaskListSnapshot>;
  saveCachedTaskList(entry: NativeCachedTaskList): Promise<void>;
  syncTaskList(
    groupId: string,
    validator?: string | null,
  ): Promise<NativeTaskListSyncResult>;
};
