"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "./prototype.module.css";

type Status = "open" | "done" | "all";
type TaskState = Exclude<Status, "all">;
type PersonKey = "shane" | "elijah" | "morgan" | "unassigned";

type Task = {
  id: number;
  text: string;
  assignee: PersonKey;
  dueDate: string | null;
  state: TaskState;
};

type EditorState = { mode: "new" } | { mode: "edit"; taskId: number };

const groups = ["Walker Labs", "Bubba’s", "OpenJob Core"];

const people: Array<{ key: PersonKey; name: string; initials: string }> = [
  { key: "shane", name: "@shane", initials: "SW" },
  { key: "elijah", name: "@elijah", initials: "EW" },
  { key: "morgan", name: "@morgan", initials: "MP" },
  { key: "unassigned", name: "Unassigned", initials: "!" },
];

const seedTasks: Task[] = [
  { id: 1, text: "Confirm the July photo schedule", assignee: "shane", dueDate: "2026-07-15", state: "open" },
  { id: 2, text: "Publish this week’s lunch specials", assignee: "shane", dueDate: "2026-07-16", state: "open" },
  { id: 3, text: "Send final patio measurements", assignee: "elijah", dueDate: "2026-07-15", state: "open" },
  { id: 4, text: "Review vendor renewal", assignee: "elijah", dueDate: null, state: "open" },
  { id: 5, text: "Order replacement menu stands", assignee: "morgan", dueDate: "2026-07-18", state: "open" },
  { id: 6, text: "Reassign the payroll handoff", assignee: "unassigned", dueDate: "2026-07-15", state: "open" },
  { id: 7, text: "Archive the spring campaign files", assignee: "morgan", dueDate: "2026-07-11", state: "done" },
  { id: 8, text: "Confirm printer delivery", assignee: "shane", dueDate: "2026-07-12", state: "done" },
];

const variants = [
  { key: "A", name: "Group rail + lanes" },
  { key: "B", name: "Due-date ledger" },
  { key: "C", name: "Roster focus" },
] as const;

type VariantKey = (typeof variants)[number]["key"];

function isVariantKey(value: string | null): value is VariantKey {
  return variants.some((variant) => variant.key === value);
}

function personFor(key: PersonKey) {
  return people.find((person) => person.key === key) ?? people[0];
}

function formatDueDate(value: string | null) {
  if (!value) return "No due date";
  if (value === "2026-07-15") return "Today";
  if (value === "2026-07-16") return "Tomorrow";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(
    new Date(`${value}T12:00:00`),
  );
}

function dueBucket(task: Task) {
  if (!task.dueDate) return "Later";
  if (task.dueDate <= "2026-07-15") return "Today";
  if (task.dueDate === "2026-07-16") return "Tomorrow";
  return "Later";
}

function PrototypeSwitcher({ current }: { current: VariantKey }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const cycle = useCallback(
    (direction: -1 | 1) => {
      const currentIndex = variants.findIndex((variant) => variant.key === current);
      const nextIndex = (currentIndex + direction + variants.length) % variants.length;
      const params = new URLSearchParams(searchParams.toString());
      params.set("variant", variants[nextIndex].key);
      router.replace(`?${params.toString()}`);
    },
    [current, router, searchParams],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "ArrowLeft") cycle(-1);
      if (event.key === "ArrowRight") cycle(1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cycle]);

  if (process.env.NODE_ENV === "production") return null;
  const variant = variants.find((item) => item.key === current) ?? variants[0];

  return (
    <nav className={styles.switcher} aria-label="Prototype variants">
      <button type="button" onClick={() => cycle(-1)} aria-label="Previous variant">←</button>
      <span><b>{variant.key}</b> — {variant.name}</span>
      <button type="button" onClick={() => cycle(1)} aria-label="Next variant">→</button>
    </nav>
  );
}

type VariantProps = {
  activeGroup: string;
  setActiveGroup: (group: string) => void;
  status: Status;
  setStatus: (status: Status) => void;
  assignee: PersonKey | "all";
  setAssignee: (assignee: PersonKey | "all") => void;
  allTasks: Task[];
  tasks: Task[];
  openNew: (assignee?: PersonKey) => void;
  openEdit: (task: Task) => void;
  toggleTask: (taskId: number) => void;
  deleteTask: (taskId: number) => void;
  openAdmin: () => void;
};

function VariantA(props: VariantProps) {
  const visiblePeople = props.assignee === "all"
    ? people
    : people.filter((person) => person.key === props.assignee);

  return (
    <main className={styles.aShell}>
      <aside className={styles.aRail}>
        <div className={styles.aBrand}>OPENJOB<span>.</span></div>
        <p className={styles.kicker}>Your Groups</p>
        <nav className={styles.groupList} aria-label="Groups">
          {groups.map((group) => (
            <button
              type="button"
              className={group === props.activeGroup ? styles.selectedGroup : ""}
              onClick={() => props.setActiveGroup(group)}
              key={group}
            >
              <span>{group.slice(0, 2).toUpperCase()}</span>{group}
            </button>
          ))}
        </nav>
        <button className={styles.adminLink} type="button" aria-label="Admin controls" onClick={props.openAdmin}>Admin ↗</button>
        <div className={styles.signedIn}>SW <span>@shane</span></div>
      </aside>

      <section className={styles.aWork}>
        <header className={styles.aHeader}>
          <div>
            <p className={styles.kicker}>Shared Task List</p>
            <h1>{props.activeGroup}</h1>
            <p>{people.length - 1} Members · 1 Unassigned</p>
          </div>
          <button className={styles.primaryButton} type="button" onClick={() => props.openNew()}>+ New Task</button>
        </header>

        <div className={styles.aFilters}>
          <div className={styles.segmented} aria-label="Status filter">
            {(["open", "done", "all"] as Status[]).map((item) => (
              <button type="button" onClick={() => props.setStatus(item)} className={props.status === item ? styles.active : ""} key={item}>{item}</button>
            ))}
          </div>
          <label>Assignee
            <select value={props.assignee} onChange={(event) => props.setAssignee(event.target.value as PersonKey | "all")}>
              <option value="all">Everyone</option>
              {people.map((person) => <option value={person.key} key={person.key}>{person.name}</option>)}
            </select>
          </label>
        </div>

        <div className={styles.aColumns}>
          {visiblePeople.map((person) => {
            const columnTasks = props.tasks.filter((task) => task.assignee === person.key);
            return (
              <section className={styles.aColumn} key={person.key}>
                <header>
                  <span className={styles.avatar}>{person.initials}</span>
                  <h2>{person.name}</h2>
                  <b>{columnTasks.length}</b>
                </header>
                {person.key === "unassigned" ? (
                  <p className={styles.quickAdd}>Assign these Tasks to a Member</p>
                ) : (
                  <button className={styles.quickAdd} type="button" onClick={() => props.openNew(person.key)}>+ Add for {person.name}</button>
                )}
                <div className={styles.cardStack}>
                  {columnTasks.map((task) => (
                    <article className={`${styles.aCard} ${task.state === "done" ? styles.completed : ""}`} key={task.id}>
                      <button className={styles.check} type="button" onClick={() => props.toggleTask(task.id)} aria-label={`${task.state === "done" ? "Reopen" : "Complete"} ${task.text}`}>{task.state === "done" ? "✓" : ""}</button>
                      <p>{task.text}</p>
                      <footer>
                        <time>{formatDueDate(task.dueDate)}</time>
                        <span>
                          {task.state === "open" ? <button type="button" onClick={() => props.openEdit(task)}>Edit</button> : null}
                          <button type="button" onClick={() => props.deleteTask(task.id)}>Delete</button>
                        </span>
                      </footer>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function VariantB(props: VariantProps) {
  const visiblePeople = props.assignee === "all"
    ? people
    : people.filter((person) => person.key === props.assignee);
  const buckets = ["Today", "Tomorrow", "Later"];

  return (
    <main className={styles.bShell}>
      <header className={styles.bTopbar}>
        <div className={styles.bBrand}>OJ/</div>
        <label>Group
          <select value={props.activeGroup} onChange={(event) => props.setActiveGroup(event.target.value)}>
            {groups.map((group) => <option key={group}>{group}</option>)}
          </select>
        </label>
        <div className={styles.bTopActions}>
          <button type="button" onClick={props.openAdmin}>Manage Group</button>
          <button type="button" onClick={() => props.openNew()}>New Task +</button>
        </div>
      </header>

      <section className={styles.bLedger}>
        <div className={styles.bTitle}>
          <div><p>Assignment ledger</p><h1>{props.activeGroup}</h1></div>
          <div className={styles.bFilters}>
            <label>Status
              <select value={props.status} onChange={(event) => props.setStatus(event.target.value as Status)}>
                <option value="open">Open</option><option value="done">Done</option><option value="all">All</option>
              </select>
            </label>
            <label>Assignee
              <select value={props.assignee} onChange={(event) => props.setAssignee(event.target.value as PersonKey | "all")}>
                <option value="all">Everyone</option>
                {people.map((person) => <option value={person.key} key={person.key}>{person.name}</option>)}
              </select>
            </label>
          </div>
        </div>

        <div className={styles.bMatrix} style={{ "--person-count": visiblePeople.length } as React.CSSProperties}>
          <div className={styles.bCorner}>Due</div>
          {visiblePeople.map((person) => <div className={styles.bPerson} key={person.key}><span>{person.initials}</span>{person.name}</div>)}
          {buckets.map((bucket) => (
            <div className={styles.bRow} key={bucket}>
              <div className={styles.bDue}>{bucket}</div>
              {visiblePeople.map((person) => (
                <div className={styles.bCell} key={person.key}>
                  {props.tasks.filter((task) => task.assignee === person.key && dueBucket(task) === bucket).map((task) => (
                    <article className={task.state === "done" ? styles.completed : ""} key={task.id}>
                      <button type="button" onClick={() => props.toggleTask(task.id)}>{task.state === "done" ? "↺" : "✓"}</button>
                      <p>{task.text}</p>
                      <span>
                        {task.state === "open" ? <button type="button" onClick={() => props.openEdit(task)}>Edit</button> : null}
                        <button type="button" onClick={() => props.deleteTask(task.id)}>Delete</button>
                      </span>
                    </article>
                  ))}
                  {person.key === "unassigned" ? null : <button className={styles.bAdd} type="button" onClick={() => props.openNew(person.key)}>+ add</button>}
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function VariantC(props: VariantProps) {
  const selected = props.assignee === "all" ? "shane" : props.assignee;
  const selectedPerson = personFor(selected);
  const selectedTasks = props.tasks.filter((task) => task.assignee === selected);

  return (
    <main className={styles.cShell}>
      <header className={styles.cHeader}>
        <button className={styles.cGroup} type="button" onClick={() => props.setActiveGroup(groups[(groups.indexOf(props.activeGroup) + 1) % groups.length])}>
          <span>WL</span><b>{props.activeGroup}</b><small>Change Group</small>
        </button>
        <select aria-label="Change Group" value={props.activeGroup} onChange={(event) => props.setActiveGroup(event.target.value)}>
          {groups.map((group) => <option key={group}>{group}</option>)}
        </select>
        <div className={styles.cLogo}>OpenJob</div>
        <button className={styles.cAdmin} type="button" onClick={props.openAdmin}>Admin</button>
      </header>

      <section className={styles.cIntro}>
        <p>One person. One clear column.</p>
        <h1>Who are you checking on?</h1>
        <div className={styles.cRoster}>
          {people.map((person) => {
            const count = props.allTasks.filter((task) => task.assignee === person.key && task.state === "open").length;
            return (
              <button type="button" className={selected === person.key ? styles.activePerson : ""} onClick={() => props.setAssignee(person.key)} key={person.key}>
                <span>{person.initials}</span><b>{person.name}</b><small>{count} open</small>
              </button>
            );
          })}
        </div>
      </section>

      <section className={styles.cFocus}>
        <header>
          <div><span className={styles.cLargeAvatar}>{selectedPerson.initials}</span><div><p>Assignee column</p><h2>{selectedPerson.name}</h2></div></div>
          <div className={styles.segmented}>
            {(["open", "done", "all"] as Status[]).map((item) => <button type="button" className={props.status === item ? styles.active : ""} onClick={() => props.setStatus(item)} key={item}>{item}</button>)}
          </div>
          {selected === "unassigned" ? null : <button className={styles.cNew} type="button" onClick={() => props.openNew(selected)}>+ Add Task</button>}
        </header>
        <div className={styles.cTasks}>
          {selectedTasks.map((task) => (
            <article className={task.state === "done" ? styles.completed : ""} key={task.id}>
              <button className={styles.cCheck} type="button" onClick={() => props.toggleTask(task.id)}>{task.state === "done" ? "✓" : ""}</button>
              <div><p>{task.text}</p><time>{formatDueDate(task.dueDate)}</time></div>
              {task.state === "open" ? <button type="button" onClick={() => props.openEdit(task)}>Edit</button> : null}
              <button type="button" onClick={() => props.deleteTask(task.id)}>Delete</button>
            </article>
          ))}
        </div>
        <p className={styles.cHint}>Swipe the roster on narrow screens. The selected assignee stays the only Task column in view.</p>
      </section>
    </main>
  );
}

function EditorPanel({
  editor,
  draftText,
  setDraftText,
  draftAssignee,
  setDraftAssignee,
  draftDueDate,
  setDraftDueDate,
  onSave,
  onClose,
}: {
  editor: EditorState;
  draftText: string;
  setDraftText: (value: string) => void;
  draftAssignee: PersonKey;
  setDraftAssignee: (value: PersonKey) => void;
  draftDueDate: string;
  setDraftDueDate: (value: string) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}) {
  return (
    <div className={styles.panelBackdrop} role="presentation" onMouseDown={onClose}>
      <form className={styles.panel} role="dialog" aria-modal="true" aria-labelledby="task-panel-title" onSubmit={onSave} onMouseDown={(event) => event.stopPropagation()}>
        <header><p>Task editor</p><button type="button" onClick={onClose}>Close</button></header>
        <h2 id="task-panel-title">{editor.mode === "new" ? "New Task" : "Edit Task"}</h2>
        <label>Task text<textarea value={draftText} onChange={(event) => setDraftText(event.target.value)} autoFocus /></label>
        <div className={styles.panelFields}>
          <label>Assignee<select value={draftAssignee} onChange={(event) => setDraftAssignee(event.target.value as PersonKey)}>{people.filter((person) => person.key !== "unassigned").map((person) => <option value={person.key} key={person.key}>{person.name}</option>)}</select></label>
          <label>Due date<input type="date" value={draftDueDate} onChange={(event) => setDraftDueDate(event.target.value)} /></label>
        </div>
        <button className={styles.primaryButton} type="submit" disabled={!draftText.trim()}>{editor.mode === "new" ? "Create Task" : "Save changes"}</button>
      </form>
    </div>
  );
}

function AdminPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className={styles.panelBackdrop} role="presentation" onMouseDown={onClose}>
      <section className={`${styles.panel} ${styles.adminPanel}`} role="dialog" aria-modal="true" aria-labelledby="admin-panel-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><p>Admin controls</p><button type="button" onClick={onClose}>Close</button></header>
        <h2 id="admin-panel-title">Manage Walker Labs</h2>
        <div className={styles.inviteBox}><span>Invite Link · 5 days left</span><code>openjob.dev/join/WL7-Q9P</code><button type="button">Copy</button></div>
        <h3>Members</h3>
        <ul>
          <li><span><b>@shane</b><small>Admin</small></span><button type="button">•••</button></li>
          <li><span><b>@elijah</b><small>Member</small></span><button type="button">•••</button></li>
          <li><span><b>@morgan</b><small>Member</small></span><button type="button">•••</button></li>
        </ul>
        <div className={styles.dangerZone}><b>Group lifecycle</b><button type="button">Rename Group</button><button type="button">Leave Group</button><button type="button">End Group</button></div>
      </section>
    </div>
  );
}

export default function AssigneeColumnPrototype() {
  const searchParams = useSearchParams();
  const rawVariant = searchParams.get("variant");
  const variant: VariantKey = isVariantKey(rawVariant) ? rawVariant : "A";
  const [activeGroup, setActiveGroup] = useState(groups[0]);
  const [status, setStatus] = useState<Status>("open");
  const [assignee, setAssignee] = useState<PersonKey | "all">("all");
  const [tasks, setTasks] = useState(seedTasks);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [draftAssignee, setDraftAssignee] = useState<PersonKey>("shane");
  const [draftDueDate, setDraftDueDate] = useState("");

  const visibleTasks = useMemo(
    () => tasks.filter((task) => {
      if (status !== "all" && task.state !== status) return false;
      return assignee === "all" || task.assignee === assignee;
    }),
    [assignee, status, tasks],
  );

  function openNew(person: PersonKey = assignee === "all" ? "shane" : assignee) {
    setDraftText("");
    setDraftAssignee(person === "unassigned" ? "shane" : person);
    setDraftDueDate("");
    setEditor({ mode: "new" });
  }

  function openEdit(task: Task) {
    setDraftText(task.text);
    setDraftAssignee(task.assignee === "unassigned" ? "shane" : task.assignee);
    setDraftDueDate(task.dueDate ?? "");
    setEditor({ mode: "edit", taskId: task.id });
  }

  function saveTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || !draftText.trim()) return;
    if (editor.mode === "new") {
      setTasks((current) => [...current, { id: Date.now(), text: draftText.trim(), assignee: draftAssignee, dueDate: draftDueDate || null, state: "open" }]);
    } else {
      setTasks((current) => current.map((task) => task.id === editor.taskId ? { ...task, text: draftText.trim(), assignee: draftAssignee, dueDate: draftDueDate || null } : task));
    }
    setEditor(null);
  }

  function toggleTask(taskId: number) {
    setTasks((current) => current.map((task) => task.id === taskId ? { ...task, state: task.state === "open" ? "done" : "open" } : task));
  }

  function deleteTask(taskId: number) {
    if (window.confirm("Permanently delete this Task?")) {
      setTasks((current) => current.filter((task) => task.id !== taskId));
    }
  }

  const props: VariantProps = {
    activeGroup,
    setActiveGroup,
    status,
    setStatus,
    assignee,
    setAssignee,
    allTasks: tasks,
    tasks: visibleTasks,
    openNew,
    openEdit,
    toggleTask,
    deleteTask,
    openAdmin: () => setAdminOpen(true),
  };

  return (
    <div className={styles.prototypeRoot}>
      <div className={styles.prototypeFlag}>Throwaway prototype</div>
      {variant === "A" ? <VariantA {...props} /> : null}
      {variant === "B" ? <VariantB {...props} /> : null}
      {variant === "C" ? <VariantC {...props} /> : null}
      {editor ? <EditorPanel editor={editor} draftText={draftText} setDraftText={setDraftText} draftAssignee={draftAssignee} setDraftAssignee={setDraftAssignee} draftDueDate={draftDueDate} setDraftDueDate={setDraftDueDate} onSave={saveTask} onClose={() => setEditor(null)} /> : null}
      {adminOpen ? <AdminPanel onClose={() => setAdminOpen(false)} /> : null}
      <PrototypeSwitcher current={variant} />
    </div>
  );
}
