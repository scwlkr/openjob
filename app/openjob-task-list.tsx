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
type NamedMember = Member & { username: string };
type EditorMode = "new" | "edit" | "assign";
type Editor =
  | { mode: "new"; username: string }
  | { mode: "edit" | "assign"; task: Task };
type TaskFormInput = { text: string; assigneeUsername: string; dueDate: string };
type EditorAction = "save" | "delete";
type TaskStateAction = "complete" | "reopen" | "undo";
type TaskStateSubject = { taskId: string; taskText: string };
type TaskStateFailure = TaskStateSubject & {
  action: TaskStateAction;
  desiredState: Task["state"];
  message: string;
};
type UndoableCompletion = TaskStateSubject & { expiresAt: number };
type StoredEditorDraft = {
  groupId: string;
  input: TaskFormInput;
  mode: EditorMode;
  taskId: string | null;
};
type MemberSection =
  | { kind: "current" | "former"; key: string; label: string }
  | { kind: "unassigned"; key: "unassigned"; label: "Unassigned" };

const TASK_EDITOR_DRAFT_KEY = "openjob:pending-task-editor";
const ALL_TASKS_FILTER = { status: "all" } as const;
const STATUS_FILTERS: { label: string; value: StatusFilter }[] = [
  { label: "Open", value: "open" },
  { label: "Done", value: "done" },
  { label: "All", value: "all" },
];

const TASK_FORM_COPY: Record<EditorMode, { kicker: string; title: string; submit: string }> = {
  new: { kicker: "New Task", title: "New Task", submit: "Create Task" },
  edit: { kicker: "Task details", title: "Edit Task", submit: "Save Task" },
  assign: { kicker: "Unassigned recovery", title: "Assign Task", submit: "Assign Task" },
};

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

function taskFormInput(task: Task): TaskFormInput {
  return {
    text: task.text,
    assigneeUsername: task.assignee.state === "assigned" ? task.assignee.username : "",
    dueDate: task.dueDate ?? "",
  };
}

function editorFormInput(editor: Editor): TaskFormInput {
  return editor.mode === "new"
    ? { text: "", assigneeUsername: editor.username, dueDate: "" }
    : taskFormInput(editor.task);
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
  return "OpenJob could not apply that change. Check your connection and try again.";
}

function readEditorDraft(): StoredEditorDraft | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(TASK_EDITOR_DRAFT_KEY) ?? "null") as Partial<StoredEditorDraft> | null;
    if (
      !value ||
      typeof value.groupId !== "string" ||
      !value.input ||
      typeof value.input.text !== "string" ||
      typeof value.input.assigneeUsername !== "string" ||
      typeof value.input.dueDate !== "string" ||
      !["new", "edit", "assign"].includes(value.mode ?? "") ||
      !(value.taskId === null || typeof value.taskId === "string")
    ) return null;
    return value as StoredEditorDraft;
  } catch {
    return null;
  }
}

function TaskForm({
  busyAction,
  error,
  initialAssignee,
  initialDueDate = "",
  initialText = "",
  members,
  mode,
  onCancel,
  onInputChange,
  onDelete,
  onSave,
}: {
  busyAction: EditorAction | null;
  error: string;
  initialAssignee: string;
  initialDueDate?: string;
  initialText?: string;
  members: NamedMember[];
  mode: EditorMode;
  onCancel: () => void;
  onInputChange: (input: TaskFormInput) => void;
  onDelete?: () => void;
  onSave: (input: TaskFormInput) => void;
}) {
  const [text, setText] = useState(initialText);
  const [assignee, setAssignee] = useState(initialAssignee);
  const [dueDate, setDueDate] = useState(initialDueDate);
  const [validationError, setValidationError] = useState("");
  const copy = TASK_FORM_COPY[mode];

  return (
    <form
      className={styles.taskForm}
      aria-label={copy.title}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setValidationError("");
        const textLength = [...text.trim()].length;
        if (textLength < 1 || textLength > 2_000) {
          setValidationError("Use 1 to 2,000 characters.");
          return;
        }
        if (!members.some((member) => member.username === assignee)) {
          setValidationError("Choose a current Member before saving.");
          return;
        }
        onSave({ text, assigneeUsername: assignee, dueDate });
      }}
      noValidate
    >
      <label>
        Task text
        <textarea
          value={text}
          onChange={(event) => {
            const nextText = event.target.value;
            setText(nextText);
            setValidationError("");
            onInputChange({ text: nextText, assigneeUsername: assignee, dueDate });
          }}
          autoFocus
          required
        />
      </label>
      <label>
        Assignee
        <select
          value={assignee}
          onChange={(event) => {
            const nextAssignee = event.target.value;
            setAssignee(nextAssignee);
            setValidationError("");
            onInputChange({ text, assigneeUsername: nextAssignee, dueDate });
          }}
          required
        >
          <option value="" disabled>Choose a Member</option>
          {members.map((member) => <option key={member.userId} value={member.username}>@{member.username}</option>)}
        </select>
      </label>
      <label>
        Due date
        <input
          type="date"
          value={dueDate}
          onChange={(event) => {
            const nextDueDate = event.target.value;
            setDueDate(nextDueDate);
            setValidationError("");
            onInputChange({ text, assigneeUsername: assignee, dueDate: nextDueDate });
          }}
        />
      </label>
      {validationError || error ? <p className={styles.fieldError} role="alert">{validationError || error}</p> : null}
      <div className={styles.taskFormActions}>
        {onDelete ? (
          <button
            className={styles.taskDeleteButton}
            type="button"
            disabled={busyAction !== null}
            onClick={onDelete}
          >
            {busyAction === "delete" ? "Deleting…" : "Delete Task"}
          </button>
        ) : null}
        <button className={styles.taskCancelButton} type="button" disabled={busyAction !== null} onClick={onCancel}>Cancel</button>
        <button className={styles.primaryButton} type="submit" disabled={busyAction !== null}>
          {busyAction === "save" ? "Saving…" : copy.submit}
        </button>
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorInput, setEditorInput] = useState<TaskFormInput | null>(null);
  const [editorAction, setEditorAction] = useState<EditorAction | null>(null);
  const [taskStateActions, setTaskStateActions] = useState<Record<string, TaskStateAction>>({});
  const [taskStateFailures, setTaskStateFailures] = useState<Record<string, TaskStateFailure>>({});
  const [undoableCompletions, setUndoableCompletions] = useState<UndoableCompletion[]>([]);
  const activeLoadGeneration = useRef(0);
  const editorOpener = useRef<HTMLButtonElement | null>(null);
  const editorDialog = useRef<HTMLElement | null>(null);
  const newTaskButton = useRef<HTMLButtonElement | null>(null);
  const savingRef = useRef(false);
  const statusFilterButtons = useRef<Partial<Record<StatusFilter, HTMLButtonElement | null>>>({});
  const statusRef = useRef<StatusFilter>("open");
  const taskStateActionsRef = useRef(new Map<string, TaskStateAction>());

  const closeEditor = useCallback(() => {
    window.sessionStorage.removeItem(TASK_EDITOR_DRAFT_KEY);
    setEditor(null);
    setEditorInput(null);
    setActionError("");
  }, []);

  const openEditor = useCallback((nextEditor: Editor, opener: HTMLButtonElement) => {
    editorOpener.current = opener;
    window.sessionStorage.removeItem(TASK_EDITOR_DRAFT_KEY);
    setEditor(nextEditor);
    setEditorInput(editorFormInput(nextEditor));
    setActionError("");
  }, []);

  useEffect(() => {
    if (!editor) return;
    const fallback = newTaskButton.current;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !savingRef.current) {
        event.preventDefault();
        closeEditor();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = editorDialog.current;
      if (!dialog) return;
      const controls = [...dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      )];
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) return;
      const activeControl = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      if (!activeControl || !controls.includes(activeControl)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && activeControl === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeControl === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      const opener = editorOpener.current;
      window.requestAnimationFrame(() => {
        if (opener?.isConnected) opener.focus();
        else fallback?.focus();
      });
    };
  }, [closeEditor, editor]);

  useEffect(() => {
    if (loading || editor) return;
    const draft = readEditorDraft();
    if (!draft || draft.groupId !== group.groupId) return;
    let restoredEditor: Editor;
    if (draft.mode === "new") {
      restoredEditor = { mode: "new", username: draft.input.assigneeUsername };
    } else {
      const task = tasks.find((candidate) => candidate.taskId === draft.taskId);
      if (!task || task.state === "done") {
        window.sessionStorage.removeItem(TASK_EDITOR_DRAFT_KEY);
        return;
      }
      restoredEditor = { mode: draft.mode, task };
    }
    const timeout = window.setTimeout(() => {
      editorOpener.current = null;
      setEditorInput(draft.input);
      setEditor(restoredEditor);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [editor, group.groupId, loading, tasks]);

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
        api.listTasks(token, group.groupId, ALL_TASKS_FILTER),
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
  }, [api, group.groupId, onSessionExpired, session]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    const now = Date.now();
    const hasExpiredCompletion = undoableCompletions.some(
      (completion) => completion.expiresAt <= now && !taskStateActions[completion.taskId],
    );
    const nextExpiration = Math.min(
      ...undoableCompletions
        .filter((completion) => completion.expiresAt > now)
        .map((completion) => completion.expiresAt),
    );
    if (!hasExpiredCompletion && !Number.isFinite(nextExpiration)) return;
    const timeout = window.setTimeout(() => {
      const pruneTime = Date.now();
      const focusedTaskId = document.activeElement instanceof HTMLElement
        ? document.activeElement.dataset.taskStateControl
        : undefined;
      const focusWillExpire = focusedTaskId !== undefined && undoableCompletions.some(
        (completion) => completion.taskId === focusedTaskId
          && completion.expiresAt <= pruneTime
          && !taskStateActionsRef.current.has(completion.taskId),
      );
      setUndoableCompletions((current) => current.filter(
        (completion) => completion.expiresAt > pruneTime || taskStateActionsRef.current.has(completion.taskId),
      ));
      if (focusWillExpire && focusedTaskId) {
        focusTaskStateFallback(focusedTaskId, document.activeElement);
      }
    }, hasExpiredCompletion ? 0 : nextExpiration - now);
    return () => window.clearTimeout(timeout);
  }, [taskStateActions, undoableCompletions]);

  const namedMembers = useMemo(
    () =>
      members
        .filter((member): member is NamedMember => member.username !== null)
        .sort((left, right) => left.username === right.username ? 0 : left.username < right.username ? -1 : 1),
    [members],
  );

  const taskCounts = useMemo(() => {
    const open = tasks.filter((task) => task.state === "open").length;
    return { open, done: tasks.length - open, all: tasks.length };
  }, [tasks]);

  const visibleTasks = useMemo(
    () => status === "all" ? tasks : tasks.filter((task) => task.state === status),
    [status, tasks],
  );

  const sections = useMemo(() => {
    const currentUsernames = new Set(namedMembers.map((member) => member.username));
    const memberSections: MemberSection[] = namedMembers
      .filter((member) => visibleTasks.some(
        (task) => task.assignee.state === "assigned" && task.assignee.username === member.username,
      ))
      .map((member) => ({
        kind: "current" as const,
        key: member.username,
        label: `@${member.username}`,
      }));
    const formerUsernames = new Set<string>();
    for (const task of visibleTasks) {
      if (task.assignee.state === "assigned" && !currentUsernames.has(task.assignee.username)) {
        formerUsernames.add(task.assignee.username);
      }
    }
    for (const username of [...formerUsernames].sort()) {
      memberSections.push({
        kind: "former",
        key: username,
        label: `@${username}`,
      });
    }
    if (visibleTasks.some((task) => task.assignee.state === "unassigned")) {
      memberSections.push({
        kind: "unassigned",
        key: "unassigned",
        label: "Unassigned",
      });
    }
    return memberSections;
  }, [namedMembers, visibleTasks]);

  async function runEditorMutation(action: (token: string) => Promise<unknown>, nextEditorAction: EditorAction) {
    if (savingRef.current) return;
    const opener = editorOpener.current;
    let mutationCommitted = false;
    savingRef.current = true;
    setEditorAction(nextEditorAction);
    setActionError("");
    try {
      const token = await session.getIdToken();
      await action(token);
      mutationCommitted = true;
      window.sessionStorage.removeItem(TASK_EDITOR_DRAFT_KEY);
      setEditor(null);
      setEditorInput(null);
      const nextTasks = await api.listTasks(token, group.groupId, ALL_TASKS_FILTER);
      setTasks(nextTasks);
      window.requestAnimationFrame(() => {
        if (!opener?.isConnected && document.activeElement === document.body) {
          newTaskButton.current?.focus();
        }
      });
    } catch (mutationError) {
      if (!(await onSessionExpired(mutationError))) {
        setActionError(mutationCommitted
          ? "Your change was saved, but the Task List could not refresh. Reload the Task List."
          : mutationMessage(mutationError));
      }
    } finally {
      savingRef.current = false;
      setEditorAction(null);
    }
  }

  function focusTaskStateFallback(taskId: string, excludedElement?: Element | null) {
    const taskControl = [...document.querySelectorAll(
      `[data-task-state-control="${CSS.escape(taskId)}"]`,
    )].find((element) => element !== excludedElement);
    if (taskControl instanceof HTMLElement) taskControl.focus();
    else statusFilterButtons.current[statusRef.current]?.focus();
  }

  function restoreTaskStateFocus(taskId: string) {
    window.requestAnimationFrame(() => {
      if (document.activeElement === document.body) focusTaskStateFallback(taskId);
    });
  }

  function startTaskStateAction(taskId: string, taskAction: TaskStateAction) {
    taskStateActionsRef.current.set(taskId, taskAction);
    setTaskStateActions((current) => ({ ...current, [taskId]: taskAction }));
  }

  function finishTaskStateAction(taskId: string) {
    taskStateActionsRef.current.delete(taskId);
    setTaskStateActions((current) => {
      const next = { ...current };
      delete next[taskId];
      return next;
    });
  }

  function clearTaskStateFailure(taskId: string) {
    setTaskStateFailures((current) => {
      if (!current[taskId]) return current;
      const next = { ...current };
      delete next[taskId];
      return next;
    });
  }

  async function runTaskStateMutation(
    task: Task,
    desiredState: Task["state"],
    taskAction: TaskStateAction,
  ) {
    if (taskStateActionsRef.current.has(task.taskId)) return;
    startTaskStateAction(task.taskId, taskAction);
    clearTaskStateFailure(task.taskId);
    setActionError("");
    restoreTaskStateFocus(task.taskId);
    try {
      const token = await session.getIdToken();
      const updatedTask = await api.setTaskState(token, group.groupId, task.taskId, desiredState);
      setTasks((current) => current.map((candidate) =>
        candidate.taskId === task.taskId ? updatedTask : candidate,
      ));
      clearTaskStateFailure(task.taskId);
      if (taskAction === "complete") {
        setUndoableCompletions((current) => [
          ...current.filter((completion) => completion.taskId !== task.taskId),
          { expiresAt: Date.now() + 5_000, taskId: task.taskId, taskText: task.text },
        ]);
      } else {
        setUndoableCompletions((current) => current.filter(
          (completion) => completion.taskId !== task.taskId,
        ));
      }
    } catch (mutationError) {
      if (!(await onSessionExpired(mutationError))) {
        setTaskStateFailures((current) => ({
          ...current,
          [task.taskId]: {
            action: taskAction,
            desiredState,
            message: mutationMessage(mutationError),
            taskId: task.taskId,
            taskText: task.text,
          },
        }));
      }
    } finally {
      finishTaskStateAction(task.taskId);
      restoreTaskStateFocus(task.taskId);
    }
  }

  function storeEditorDraft(input: TaskFormInput) {
    if (!editor) return;
    window.sessionStorage.setItem(TASK_EDITOR_DRAFT_KEY, JSON.stringify({
      groupId: group.groupId,
      input,
      mode: editor.mode,
      taskId: editor.mode === "new" ? null : editor.task.taskId,
    } satisfies StoredEditorDraft));
  }

  function saveEditor(input: TaskFormInput) {
    if (!editor) return;
    storeEditorDraft(input);
    if (editor.mode === "new") {
      void runEditorMutation((token) => api.createTask(token, group.groupId, {
        text: input.text,
        assigneeUsername: input.assigneeUsername,
        ...(input.dueDate ? { dueDate: input.dueDate } : {}),
      }), "save");
      return;
    }
    void runEditorMutation((token) => api.updateTask(token, group.groupId, editor.task.taskId, {
      text: input.text,
      assigneeUsername: input.assigneeUsername,
      dueDate: input.dueDate || null,
    }), "save");
  }

  function deleteEditorTask() {
    if (!editor || editor.mode === "new") return;
    if (!window.confirm(`This will permanently delete “${editor.task.text}”. Continue?`)) return;
    storeEditorDraft(editorInput ?? taskFormInput(editor.task));
    void runEditorMutation(
      (token) => api.deleteTask(token, group.groupId, editor.task.taskId),
      "delete",
    );
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
  const displayedEditorInput = editor === null
    ? null
    : editorInput ?? editorFormInput(editor);

  return (
    <section className={styles.taskList} aria-label="Task List">
      {actionError ? (
        <div className={styles.taskActionError} role="alert">
          <span>{actionError}</span>
          <button type="button" onClick={() => void load()}>Reload Task List</button>
        </div>
      ) : null}
      {Object.values(taskStateFailures).map((failure) => (
        <div className={styles.taskActionError} role="alert" key={failure.taskId}>
          <span>{failure.message}</span>
          <button
            type="button"
            aria-label={`Retry ${failure.action === "complete" ? "completion" : failure.action} of ${failure.taskText}`}
            onClick={() => {
              const task = tasks.find((candidate) => candidate.taskId === failure.taskId);
              if (task) void runTaskStateMutation(task, failure.desiredState, failure.action);
              else void load();
            }}
          >
            Retry
          </button>
        </div>
      ))}
      {Object.entries(taskStateActions).map(([taskId, taskAction]) => {
        if (taskAction === "undo") return null;
        const task = tasks.find((candidate) => candidate.taskId === taskId);
        if (!task) return null;
        return (
          <div
            className={styles.taskStatePending}
            role="status"
            aria-label={`Task state update: ${task.text}`}
            key={taskId}
          >
            {taskAction === "complete" ? "Completing" : "Reopening"} “{task.text}”…
          </div>
        );
      })}
      {undoableCompletions.map((completion) => (
        <div className={styles.taskUndo} role="status" key={completion.taskId}>
          <span>Completed “{completion.taskText}”. Undo available for 5 seconds.</span>
          <button
            type="button"
            disabled={taskStateActions[completion.taskId] === "undo"}
            data-task-state-control={completion.taskId}
            aria-label={`Undo completion of ${completion.taskText}`}
            onClick={() => {
              const task = tasks.find((candidate) => candidate.taskId === completion.taskId);
              if (task) void runTaskStateMutation(task, "open", "undo");
            }}
          >
            {taskStateActions[completion.taskId] === "undo" ? "Undoing…" : "Undo"}
          </button>
        </div>
      ))}
      <div className={styles.taskToolbar}>
        <div className={styles.statusFilters} role="group" aria-label="Task status">
          {STATUS_FILTERS.map((filter) => (
            <button
              aria-label={`${filter.label} ${taskCounts[filter.value]}`}
              aria-pressed={status === filter.value}
              key={filter.value}
              ref={(element) => {
                statusFilterButtons.current[filter.value] = element;
              }}
              type="button"
              onClick={() => {
                statusRef.current = filter.value;
                setStatus(filter.value);
              }}
            >
              {filter.label}
              <span aria-hidden="true">{taskCounts[filter.value]}</span>
            </button>
          ))}
        </div>
        <button
          className={styles.newTaskButton}
          ref={newTaskButton}
          type="button"
          onClick={(event) => openEditor({ mode: "new", username: "" }, event.currentTarget)}
        >
          New Task
        </button>
      </div>

      {sections.length === 0 ? (
        <p className={styles.emptyTaskList} role="status">
          {status === "all" ? "No Tasks yet." : `No ${status === "open" ? "open" : "done"} Tasks.`}
        </p>
      ) : null}

      <div className={styles.taskSections}>
        {sections.map((section) => {
          const sectionTasks = visibleTasks.filter((task) =>
            section.kind === "unassigned"
              ? task.assignee.state === "unassigned"
              : task.assignee.state === "assigned" && task.assignee.username === section.key,
          );
          return (
            <section className={styles.memberSection} data-testid="member-section" key={section.key}>
              <header>
                <div>
                  <h2>{section.label}</h2>
                  {section.kind === "former" ? <small>Former Member</small> : null}
                </div>
                <span>{sectionTasks.length}</span>
              </header>
              <div className={styles.taskCards}>
                {section.kind === "current" ? (
                  <button
                    className={styles.addTaskButton}
                    type="button"
                    onClick={(event) => openEditor({ mode: "new", username: section.key }, event.currentTarget)}
                  >
                    Add Task
                  </button>
                ) : null}
                {sectionTasks.map((task) => {
                  const overdue = task.state === "open" && task.dueDate !== null && task.dueDate < localDateKey();
                  const taskStateAction = taskStateActions[task.taskId];
                  const showCompletionControl = (task.state === "open" && taskStateAction !== "reopen")
                    || taskStateAction === "complete"
                    || taskStateAction === "undo";
                  const taskBody = (
                    <>
                      <span className={styles.taskText}>{task.text}</span>
                      <span className={styles.taskMeta}>
                        <span>{task.state === "open" ? "Open" : "Done"}</span>
                        {task.dueDate ? (
                          <span className={styles.taskDue}>
                            <time dateTime={task.dueDate}>Due {formatDueDate(task.dueDate)}</time>
                            {overdue ? <b>Overdue</b> : null}
                          </span>
                        ) : null}
                      </span>
                    </>
                  );
                  return (
                    <article className={styles.taskCard} data-testid="task-card" key={task.taskId}>
                      <div className={styles.taskMain}>
                        {showCompletionControl ? (
                          <div className={styles.taskStateControl}>
                            <input
                              className={styles.taskCompletion}
                              type="checkbox"
                              checked={task.state === "done" || taskStateAction === "complete"}
                              disabled={taskStateAction !== undefined}
                              data-task-state-control={task.taskId}
                              aria-label={`${taskStateAction === "complete" ? "Completing" : taskStateAction === "undo" ? "Undoing completion of" : "Complete"} ${task.text}`}
                              onChange={() => void runTaskStateMutation(task, "done", "complete")}
                            />
                            {taskStateAction === "complete" ? <span>Completing…</span> : null}
                            {taskStateAction === "undo" ? <span>Undoing…</span> : null}
                          </div>
                        ) : null}
                        {task.state === "open" && taskStateAction === undefined ? (
                          <button
                            className={styles.taskBodyButton}
                            type="button"
                            aria-label={`${task.assignee.state === "unassigned" ? "Assign" : "Edit"} Task: ${task.text}`}
                            onClick={(event) => openEditor(
                              task.assignee.state === "unassigned" ? { mode: "assign", task } : { mode: "edit", task },
                              event.currentTarget,
                            )}
                          >
                            {taskBody}
                          </button>
                        ) : (
                          <div className={styles.taskBody}>{taskBody}</div>
                        )}
                      </div>
                      {(task.state === "done" && taskStateAction !== "complete") || taskStateAction === "reopen" ? (
                        <button
                          className={styles.taskReopenButton}
                          type="button"
                          disabled={taskStateAction !== undefined}
                          data-task-state-control={task.taskId}
                          aria-label={`${taskStateAction === "reopen" ? "Reopening" : "Reopen"} ${task.text}`}
                          onClick={() => void runTaskStateMutation(task, "open", "reopen")}
                        >
                          {taskStateAction === "reopen" ? "Reopening…" : "Reopen"}
                        </button>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {editor ? (
        <div className={`${styles.dialogBackdrop} ${styles.taskDialogBackdrop}`} role="presentation">
          <section
            className={styles.taskDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-editor-title"
            ref={editorDialog}
          >
            <p className={styles.kicker}>{TASK_FORM_COPY[editor.mode].kicker}</p>
            <h2 id="task-editor-title">{TASK_FORM_COPY[editor.mode].title}</h2>
            <TaskForm
              busyAction={editorAction}
              error={actionError}
              initialAssignee={displayedEditorInput?.assigneeUsername ?? ""}
              initialDueDate={displayedEditorInput?.dueDate ?? ""}
              initialText={displayedEditorInput?.text ?? ""}
              members={namedMembers}
              mode={editor.mode}
              onCancel={closeEditor}
              onDelete={editor.mode === "new" ? undefined : deleteEditorTask}
              onInputChange={setEditorInput}
              onSave={saveEditor}
            />
          </section>
        </div>
      ) : null}
    </section>
  );
}
