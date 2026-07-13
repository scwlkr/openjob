"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Task = {
  id: string;
  assignee: string;
  description: string;
  dueDate: string | null;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
};

type StatusFilter = "open" | "done" | "all";

function todayKey() {
  const today = new Date();
  return [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatDueDate(date: string) {
  const today = new Date(`${todayKey()}T12:00:00`);
  const due = new Date(`${date}T12:00:00`);
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);

  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(due);
}

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskText, setTaskText] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<StatusFilter>("open");
  const [person, setPerson] = useState("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadTasks = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch("/api/tasks", { cache: "no-store" });
      const data = (await response.json()) as { tasks?: Task[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Could not load the list.");
      setTasks(data.tasks ?? []);
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Could not load the list.",
      );
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTasks();
    const refresh = window.setInterval(() => void loadTasks(true), 20_000);
    const onFocus = () => void loadTasks(true);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(refresh);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadTasks]);

  const people = useMemo(
    () =>
      Array.from(new Set(tasks.map((task) => task.assignee))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [tasks],
  );

  useEffect(() => {
    if (person !== "all" && !people.includes(person)) setPerson("all");
  }, [people, person]);

  const openCount = tasks.filter((task) => !task.completed).length;
  const doneCount = tasks.length - openCount;

  const visibleTasks = useMemo(
    () =>
      tasks.filter((task) => {
        if (status === "open" && task.completed) return false;
        if (status === "done" && !task.completed) return false;
        return person === "all" || task.assignee === person;
      }),
    [person, status, tasks],
  );

  async function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!taskText.trim()) return;

    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: taskText, dueDate: dueDate || null }),
      });
      const data = (await response.json()) as { task?: Task; error?: string };
      if (!response.ok || !data.task) {
        throw new Error(data.error || "Could not add that task.");
      }
      setTasks((current) => [data.task as Task, ...current]);
      setTaskText("");
      setDueDate("");
      setStatus("open");
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Could not add that task.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleTask(task: Task) {
    const nextCompleted = !task.completed;
    setTasks((current) =>
      current.map((item) =>
        item.id === task.id ? { ...item, completed: nextCompleted } : item,
      ),
    );
    setError("");

    try {
      const response = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: task.id, completed: nextCompleted }),
      });
      const data = (await response.json()) as { task?: Task; error?: string };
      if (!response.ok || !data.task) {
        throw new Error(data.error || "Could not update that task.");
      }
      setTasks((current) =>
        current.map((item) => (item.id === task.id ? (data.task as Task) : item)),
      );
    } catch (updateError) {
      setTasks((current) =>
        current.map((item) =>
          item.id === task.id ? { ...item, completed: task.completed } : item,
        ),
      );
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Could not update that task.",
      );
    }
  }

  const emptyMessage = loading
    ? "Loading the list…"
    : status === "done"
      ? "Nothing completed here yet."
      : status === "open"
        ? "Nothing waiting here. Nice work."
        : "No tasks here yet.";

  return (
    <main className="site-shell">
      <header className="masthead">
        <a className="wordmark" href="#top" aria-label="Openjob home">
          OPENJOB<span>.</span>
        </a>
        <div className="shared-status">
          <span aria-hidden="true" /> Shared team board
        </div>
      </header>

      <section className="intro" id="top">
        <p className="eyebrow">No accounts. Just names.</p>
        <h1>What needs doing?</h1>
        <p className="intro-copy">
          Add a name, add the task, and keep the whole team moving.
        </p>
      </section>

      <form className="add-card" onSubmit={addTask}>
        <label htmlFor="task">New task</label>
        <div className="task-entry-row">
          <input
            id="task"
            name="task"
            value={taskText}
            onChange={(event) => setTaskText(event.target.value)}
            placeholder="@shane — Take out trash"
            autoComplete="off"
            maxLength={240}
            aria-describedby="task-hint"
          />
          <button type="submit" disabled={saving || !taskText.trim()}>
            {saving ? "Adding…" : "Add task"}
          </button>
        </div>
        <div className="date-row">
          <label htmlFor="due-date">Due date <span>optional</span></label>
          <input
            id="due-date"
            name="due-date"
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
          <p id="task-hint">Start with a name like @shane or @elijah.</p>
        </div>
      </form>

      {error ? (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void loadTasks()}>
            Try again
          </button>
        </div>
      ) : null}

      <section className="board" aria-labelledby="list-heading">
        <div className="board-heading">
          <div>
            <p className="section-label">The list</p>
            <h2 id="list-heading">
              {openCount} open <span>/ {doneCount} done</span>
            </h2>
          </div>
          <div className="status-tabs" aria-label="Filter by status">
            {(["open", "done", "all"] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={status === option ? "active" : ""}
                onClick={() => setStatus(option)}
                aria-pressed={status === option}
              >
                {option === "done" ? "Done" : option[0].toUpperCase() + option.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {people.length > 0 ? (
          <div className="people-filter" aria-label="Filter by person">
            <button
              type="button"
              className={person === "all" ? "active" : ""}
              onClick={() => setPerson("all")}
              aria-pressed={person === "all"}
            >
              Everyone
            </button>
            {people.map((name) => (
              <button
                key={name}
                type="button"
                className={person === name ? "active" : ""}
                onClick={() => setPerson(name)}
                aria-pressed={person === name}
              >
                @{name}
              </button>
            ))}
          </div>
        ) : null}

        <div className="task-list" aria-live="polite" aria-busy={loading}>
          {visibleTasks.length === 0 ? (
            <div className="empty-state">
              <span aria-hidden="true">✓</span>
              <p>{emptyMessage}</p>
            </div>
          ) : (
            visibleTasks.map((task) => {
              const isOverdue =
                Boolean(task.dueDate) && !task.completed && task.dueDate! < todayKey();
              return (
                <article
                  className={`task-row${task.completed ? " is-completed" : ""}`}
                  key={task.id}
                >
                  <button
                    className="check-button"
                    type="button"
                    onClick={() => void toggleTask(task)}
                    aria-label={`${task.completed ? "Reopen" : "Complete"} @${task.assignee}: ${task.description}`}
                    aria-pressed={task.completed}
                  >
                    <span aria-hidden="true">{task.completed ? "✓" : ""}</span>
                  </button>
                  <div className="task-copy">
                    <p>
                      <strong>@{task.assignee}</strong>
                      <span>{task.description}</span>
                    </p>
                    {task.dueDate ? (
                      <time
                        dateTime={task.dueDate}
                        className={isOverdue ? "is-overdue" : ""}
                      >
                        {isOverdue ? "Overdue · " : ""}
                        {formatDueDate(task.dueDate)}
                      </time>
                    ) : (
                      <span className="no-date">No date</span>
                    )}
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>

      <footer>
        <p>Anyone with the link can add or check off tasks.</p>
        <a href="#top">Back to top ↑</a>
      </footer>
    </main>
  );
}
