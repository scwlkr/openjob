"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  type AuthSession,
  type Group,
  type Member,
  type OpenJobApi,
  type Task,
} from "./openjob-contracts";
import styles from "./openjob.module.css";

type StatusFilter = "open" | "done" | "all";
type AssigneeFilter =
  | { kind: "all" }
  | { kind: "unassigned" }
  | { kind: "member"; username: string };
type NamedMember = Member & { username: string };
type EditorMode = "new" | "edit" | "assign";
type Editor =
  | { mode: "new"; username: string }
  | { mode: "edit" | "assign"; task: Task };
type TaskFormInput = { text: string; assigneeUsername: string; dueDate: string };
type AssigneeLane = { username: string; current: boolean };
type TaskLane = {
  key: string;
  label: string;
  canCreate: boolean;
  former: boolean;
  unassigned: boolean;
};

const ALL_ASSIGNEES_VALUE = "filter:all";
const UNASSIGNED_VALUE = "filter:unassigned";
const MEMBER_VALUE_PREFIX = "member:";

const TASK_FORM_COPY: Record<EditorMode, { kicker: string; title: string; submit: string }> = {
  new: { kicker: "New Task", title: "New Task", submit: "Create Task" },
  edit: { kicker: "Task details", title: "Edit Task", submit: "Save Task" },
  assign: { kicker: "Unassigned recovery", title: "Assign Task", submit: "Assign Task" },
};

function apiAssignee(filter: AssigneeFilter) {
  if (filter.kind === "all") return undefined;
  return filter.kind === "unassigned" ? "unassigned" : filter.username;
}

function filterSelectValue(filter: AssigneeFilter) {
  if (filter.kind === "all") return ALL_ASSIGNEES_VALUE;
  return filter.kind === "unassigned" ? UNASSIGNED_VALUE : `${MEMBER_VALUE_PREFIX}${filter.username}`;
}

function filterFromSelectValue(value: string): AssigneeFilter {
  if (value === ALL_ASSIGNEES_VALUE) return { kind: "all" };
  if (value === UNASSIGNED_VALUE) return { kind: "unassigned" };
  return { kind: "member", username: value.slice(MEMBER_VALUE_PREFIX.length) };
}

function filterIncludesMember(filter: AssigneeFilter, username: string) {
  return filter.kind === "all" || (filter.kind === "member" && filter.username === username);
}

function filterIncludesUnassigned(filter: AssigneeFilter, hasUnassigned: boolean) {
  return filter.kind === "unassigned" || (filter.kind === "all" && hasUnassigned);
}

function localDateKey(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function formatDueDate(dueDate: string) {
  return new Date(`${dueDate}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function loadMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 403) return "You no longer have permission to view this Task List.";
    if (error.status === 404) return "This Group is no longer accessible.";
  }
  return "OpenJob could not load this Task List. Check your connection and try again.";
}

function mutationMessage(error: unknown) {
  if (error instanceof ApiError) {
    const fieldMessage = error.fields && Object.values(error.fields)[0];
    if (fieldMessage) return fieldMessage;
    if (error.status === 403) return "You no longer have permission to change Tasks in this Group.";
    if (error.status === 404) return "That Task or Group is no longer available. Reload the Task List.";
    if (error.code === "assignee_not_member") return "That assignee is no longer a Member. Reload and choose another.";
    if (error.status === 409) return "That Task changed. Reload the Task List and try again.";
  }
  return "OpenJob could not save that change. Check your connection and try again.";
}

function TaskForm({
  error,
  initialAssignee,
  initialDueDate = "",
  initialText = "",
  members,
  mode,
  onCancel,
  onSave,
  saving,
}: {
  error: string;
  initialAssignee: string;
  initialDueDate?: string;
  initialText?: string;
  members: NamedMember[];
  mode: EditorMode;
  onCancel: () => void;
  onSave: (input: TaskFormInput) => void;
  saving: boolean;
}) {
  const [text, setText] = useState(initialText);
  const [assignee, setAssignee] = useState(initialAssignee);
  const [dueDate, setDueDate] = useState(initialDueDate);
  const copy = TASK_FORM_COPY[mode];

  return (
    <form
      className={styles.taskForm}
      aria-label={copy.title}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSave({ text, assigneeUsername: assignee, dueDate });
      }}
      noValidate
    >
      <label>
        Task text
        <textarea value={text} onChange={(event) => setText(event.target.value)} autoFocus />
      </label>
      {mode !== "new" ? (
        <label>
          Assignee
          <select value={assignee} onChange={(event) => setAssignee(event.target.value)}>
            {members.map((member) => <option key={member.userId} value={member.username}>@{member.username}</option>)}
          </select>
        </label>
      ) : null}
      <label>
        Due date
        <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
      </label>
      {error ? <p className={styles.fieldError} role="alert">{error}</p> : null}
      <div className={styles.taskFormActions}>
        <button type="button" onClick={onCancel}>Cancel</button>
        <button className={styles.primaryButton} type="submit" disabled={saving}>{saving ? "Saving…" : copy.submit}</button>
      </div>
    </form>
  );
}

export function TaskList({
  api,
  group,
  onSessionExpired,
  session,
}: {
  api: OpenJobApi;
  group: Group;
  onSessionExpired: (error: unknown) => Promise<boolean>;
  session: AuthSession;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [status, setStatus] = useState<StatusFilter>("open");
  const [assignee, setAssignee] = useState<AssigneeFilter>({ kind: "all" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saving, setSaving] = useState(false);
  const activeLoadGeneration = useRef(0);

  const taskFilters = useMemo(
    () => {
      const filteredAssignee = apiAssignee(assignee);
      return {
        status,
        ...(filteredAssignee ? { assignee: filteredAssignee } : {}),
      };
    },
    [assignee, status],
  );

  const load = useCallback(async () => {
    const loadGeneration = ++activeLoadGeneration.current;
    try {
      const token = await session.getIdToken();
      if (loadGeneration !== activeLoadGeneration.current) return;
      setLoading(true);
      setError("");
      setActionError("");
      const [nextMembers, nextTasks] = await Promise.all([
        api.listMembers(token, group.groupId),
        api.listTasks(token, group.groupId, taskFilters),
      ]);
      if (loadGeneration !== activeLoadGeneration.current) return;
      setMembers(nextMembers);
      setTasks(nextTasks);
    } catch (loadError) {
      if (loadGeneration !== activeLoadGeneration.current) return;
      if (!(await onSessionExpired(loadError))) setError(loadMessage(loadError));
    } finally {
      if (loadGeneration === activeLoadGeneration.current) setLoading(false);
    }
  }, [api, group.groupId, onSessionExpired, session, taskFilters]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  const namedMembers = useMemo(
    () =>
      members
        .filter((member): member is NamedMember => member.username !== null)
        .sort((left, right) => left.username === right.username ? 0 : left.username < right.username ? -1 : 1),
    [members],
  );

  const assigneeLanes = useMemo(() => {
    const currentUsernames = new Set(namedMembers.map((member) => member.username));
    const usernames = new Set(currentUsernames);
    for (const task of tasks) {
      if (task.assignee.state === "assigned") usernames.add(task.assignee.username);
    }
    if (assignee.kind === "member") usernames.add(assignee.username);
    return [...usernames]
      .sort((left, right) => left === right ? 0 : left < right ? -1 : 1)
      .map((username): AssigneeLane => ({ username, current: currentUsernames.has(username) }));
  }, [assignee, namedMembers, tasks]);

  const lanes = useMemo(() => {
    const memberLanes: TaskLane[] = assigneeLanes
      .filter((lane) => filterIncludesMember(assignee, lane.username))
      .map((lane) => ({
        key: lane.username,
        label: `@${lane.username}`,
        canCreate: lane.current,
        former: !lane.current,
        unassigned: false,
      }));
    const hasUnassigned = tasks.some((task) => task.assignee.state === "unassigned");
    if (filterIncludesUnassigned(assignee, hasUnassigned)) {
      memberLanes.push({
        key: "unassigned",
        label: "Unassigned",
        canCreate: false,
        former: false,
        unassigned: true,
      });
    }
    return memberLanes;
  }, [assignee, assigneeLanes, tasks]);

  async function runMutation(action: (token: string) => Promise<unknown>) {
    setSaving(true);
    setActionError("");
    try {
      const token = await session.getIdToken();
      await action(token);
      setTasks(await api.listTasks(token, group.groupId, taskFilters));
      setEditor(null);
    } catch (mutationError) {
      if (!(await onSessionExpired(mutationError))) setActionError(mutationMessage(mutationError));
    } finally {
      setSaving(false);
    }
  }

  function saveEditor(input: TaskFormInput) {
    if (!editor) return;
    if (editor.mode === "new") {
      void runMutation((token) => api.createTask(token, group.groupId, {
        text: input.text,
        assigneeUsername: editor.username,
        ...(input.dueDate ? { dueDate: input.dueDate } : {}),
      }));
      return;
    }
    void runMutation((token) => api.updateTask(token, group.groupId, editor.task.taskId, {
      text: input.text,
      assigneeUsername: input.assigneeUsername,
      dueDate: input.dueDate || null,
    }));
  }

  if (loading) {
    return <div className={styles.taskLoading} aria-busy="true">Loading Task List…</div>;
  }
  if (error) {
    return (
      <div className={styles.taskLoadError} role="alert">
        <p>{error}</p>
        <button type="button" onClick={() => void load()}>Try again</button>
      </div>
    );
  }

  return (
    <section className={styles.taskList} aria-label="Task List">
      {actionError ? (
        <div className={styles.taskActionError} role="alert">
          <span>{actionError}</span>
          <button type="button" onClick={() => void load()}>Reload Task List</button>
        </div>
      ) : null}
      <div className={styles.taskToolbar}>
        <label>
          Task status
          <select
            value={status}
            onChange={(event) => {
              setLoading(true);
              setStatus(event.target.value as StatusFilter);
            }}
          >
            <option value="open">Open</option>
            <option value="done">Done</option>
            <option value="all">All</option>
          </select>
        </label>
        <label>
          Assignee filter
          <select
            value={filterSelectValue(assignee)}
            onChange={(event) => {
              setLoading(true);
              setAssignee(filterFromSelectValue(event.target.value));
            }}
          >
            <option value={ALL_ASSIGNEES_VALUE}>All assignees</option>
            {assigneeLanes.map((lane) => (
              <option key={lane.username} value={`${MEMBER_VALUE_PREFIX}${lane.username}`}>@{lane.username}</option>
            ))}
            <option value={UNASSIGNED_VALUE}>Unassigned</option>
          </select>
        </label>
      </div>

      <div className={styles.taskLanes}>
        {lanes.map((lane) => {
          const laneTasks = tasks.filter((task) =>
            lane.unassigned
              ? task.assignee.state === "unassigned"
              : task.assignee.state === "assigned" && task.assignee.username === lane.key,
          );
          return (
            <section className={styles.taskLane} data-testid="task-lane" key={lane.key}>
              <header>
                <div>
                  <h2>{lane.label}</h2>
                  {lane.former ? <small>Former Member</small> : null}
                </div>
                <span>{laneTasks.length}</span>
              </header>
              <div className={styles.taskCards}>
                {lane.canCreate ? (
                  editor?.mode === "new" && editor.username === lane.key ? (
                    <TaskForm
                      error={actionError}
                      initialAssignee={lane.key}
                      members={namedMembers}
                      mode="new"
                      onCancel={() => { setEditor(null); setActionError(""); }}
                      onSave={saveEditor}
                      saving={saving}
                    />
                  ) : (
                    <button
                      className={styles.addTaskButton}
                      type="button"
                      onClick={() => { setEditor({ mode: "new", username: lane.key }); setActionError(""); }}
                    >
                      Add Task
                    </button>
                  )
                ) : null}
                {laneTasks.length === 0 ? <p className={styles.emptyLane}>No Tasks here.</p> : null}
                {laneTasks.map((task) => {
                  const overdue = task.state === "open" && task.dueDate !== null && task.dueDate < localDateKey();
                  return (
                    <article className={styles.taskCard} data-testid="task-card" key={task.taskId}>
                      <p>{task.text}</p>
                      {task.dueDate ? (
                        <div className={styles.taskDue}>
                          <time dateTime={task.dueDate}>{formatDueDate(task.dueDate)}</time>
                          {overdue ? <b>Overdue</b> : null}
                        </div>
                      ) : null}
                      <div className={styles.taskCardActions}>
                        {task.state === "open" ? (
                          task.assignee.state === "unassigned" ? (
                            <button type="button" onClick={() => { setEditor({ mode: "assign", task }); setActionError(""); }}>Assign</button>
                          ) : (
                            <button type="button" onClick={() => { setEditor({ mode: "edit", task }); setActionError(""); }}>Edit</button>
                          )
                        ) : null}
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void runMutation((token) =>
                            api.setTaskState(token, group.groupId, task.taskId, task.state === "open" ? "done" : "open")
                          )}
                        >
                          {task.state === "open" ? "Complete" : "Reopen"}
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => {
                            if (window.confirm(`This will permanently delete “${task.text}”. Continue?`)) {
                              void runMutation((token) => api.deleteTask(token, group.groupId, task.taskId));
                            }
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {editor && editor.mode !== "new" ? (
        <div className={styles.dialogBackdrop} role="presentation">
          <section
            className={styles.taskDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-editor-title"
          >
            <p className={styles.kicker}>{TASK_FORM_COPY[editor.mode].kicker}</p>
            <h2 id="task-editor-title">{TASK_FORM_COPY[editor.mode].title}</h2>
            <TaskForm
              error={actionError}
              initialAssignee={
                editor.task.assignee.state === "assigned"
                  ? editor.task.assignee.username
                  : namedMembers[0]?.username ?? ""
              }
              initialDueDate={editor.task.dueDate ?? ""}
              initialText={editor.task.text}
              members={namedMembers}
              mode={editor.mode}
              onCancel={() => { setEditor(null); setActionError(""); }}
              onSave={saveEditor}
              saving={saving}
            />
          </section>
        </div>
      ) : null}
    </section>
  );
}
