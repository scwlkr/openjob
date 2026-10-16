"use client";

import { useRef, useState, type FormEvent } from "react";
import type { WorkspaceCommand, WorkspaceScope, WorkspaceView } from "../../shared/workspace-contracts";
import styles from "./workspace.module.css";

const scopes: WorkspaceScope[] = ["mail:read", "mail:draft", "mail:simulate-send", "tasks:read", "tasks:write", "calendar:read", "calendar:write"];
type Props = {
  view: WorkspaceView;
  owner: string;
  busy: boolean;
  command: (input: WorkspaceCommand, success: string) => Promise<boolean>;
  refresh: () => Promise<WorkspaceView>;
};

async function agentRequest(owner: string, agentId: string, input?: WorkspaceCommand) {
  const response = await fetch(`/api/workspace/${input ? "commands" : "snapshot"}`, {
    method: input ? "POST" : "GET",
    headers: { "content-type": "application/json", "x-openjob-fixture-owner": owner, "x-openjob-fixture-agent": agentId },
    ...(input ? { body: JSON.stringify(input) } : {}),
    redirect: "error",
  });
  const body = await response.json() as { data?: unknown; error?: { code?: string; message?: string } };
  if (!response.ok) throw new Error(`${body.error?.code || response.status}: ${body.error?.message || "Agent access denied"}`);
  return body.data;
}

export default function WorkspaceAgents({ view, owner, busy, command, refresh }: Props) {
  const [name, setName] = useState("");
  const [capabilities, setCapabilities] = useState<WorkspaceScope[]>(["tasks:read"]);
  const [resources, setResources] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [agentView, setAgentView] = useState<WorkspaceView | null>(null);
  const [inspectionError, setInspectionError] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [result, setResult] = useState<{ allowed: boolean; message: string } | null>(null);
  const [working, setWorking] = useState(false);
  const latestInspection = useRef(0);
  const selected = view.agents.find(agent => agent.id === selectedId);
  const disabled = busy || working;
  const resourceOptions = [
    ...view.accounts.map(account => ({ id: account.id, label: `${account.label} mailbox` })),
    ...view.calendars.map(calendar => ({ id: calendar.id, label: `${calendar.name} calendar` })),
    { id: "tasks:personal", label: "Personal tasks" },
  ];
  const resourceLabel = (id: string) => resourceOptions.find(resource => resource.id === id)?.label || id;

  async function inspect(id: string) {
    const request = ++latestInspection.current;
    setSelectedId(id); setAgentView(null); setInspectionError(""); setResult(null); setWorking(true);
    try {
      const next = await agentRequest(owner, id) as WorkspaceView;
      if (request === latestInspection.current) setAgentView(next);
    } catch (error) {
      if (request === latestInspection.current) setInspectionError(error instanceof Error ? error.message : "Agent access denied");
    } finally { if (request === latestInspection.current) setWorking(false); }
  }

  async function createTask(event: FormEvent) {
    event.preventDefault();
    if (!selectedId || !taskTitle.trim()) return;
    setWorking(true); setResult(null);
    let created = false;
    try {
      // Always use the selected simulated agent identity. There is no human retry path.
      await agentRequest(owner, selectedId, { type: "task.create", title: taskTitle });
      created = true;
      await refresh();
      setResult({ allowed: true, message: `Allowed: task “${taskTitle.trim()}” created as ${selected?.name || "the simulated agent"}.` });
      setTaskTitle("");
      try { setAgentView(await agentRequest(owner, selectedId) as WorkspaceView); }
      catch { setAgentView(null); }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed";
      setResult({ allowed: created, message: created ? `Task created as the simulated agent. Workspace refresh failed: ${message}` : `Denied or unavailable: ${message}. No human fallback was attempted.` });
    } finally { setWorking(false); }
  }

  return <div className={styles.calendarGrid}>
    <section className={styles.panel}>
      <h2 className={styles.sectionHeading}>Personal agents</h2>
      <p className={styles.inset}>Simulated identities with explicit scopes and resources. No API secrets are created. Actions below use the selected agent’s access.</p>
      {view.agents.map(agent => <article key={agent.id} className={styles.agent} data-testid="agent-row">
        <strong>{agent.name}</strong>
        <small>{agent.revoked ? "Revoked" : "Active"} · Simulated identity</small>
        <small>Granted scopes: {agent.scopes.join(", ")}</small>
        <small>Allowed resources: {agent.resourceIds.map(resourceLabel).join(", ")}</small>
        {agent.revoked && <small>Effective access: none. Revocation takes effect immediately.</small>}
        <div className={styles.actions}>
          <button disabled={disabled} onClick={() => inspect(agent.id)}>Inspect access</button>
          <button disabled={disabled || agent.revoked} onClick={async () => {
            if (await command({ type: "agent.revoke", agentId: agent.id }, "Agent access revoked")) {
              if (selectedId === agent.id) await inspect(agent.id);
            }
          }}>Revoke</button>
        </div>
      </article>)}
      {!view.agents.length && <p className={styles.inset}>No simulated agents yet. Grant only the capabilities and resources needed.</p>}
      {selected && <section aria-label="Agent access result" className={styles.inspection}>
        <h3>Agent access result</h3>
        <p><strong>{selected.name}</strong> · {selected.revoked ? "Revoked" : "Active"} simulated identity</p>
        <p>Effective scopes: {selected.revoked ? "none" : selected.scopes.join(", ")}</p>
        <p>Effective resources: {selected.revoked ? "none" : selected.resourceIds.map(resourceLabel).join(", ")}</p>
        {inspectionError && <p role="alert">{inspectionError}</p>}
        {agentView && <>
          <p data-testid="agent-counts">{agentView.messages.length} messages · {agentView.tasks.length} tasks · {agentView.events.length} events</p>
          <ul>{agentView.messages.map(item => <li key={item.id}>Mail: {item.subject}</li>)}{agentView.tasks.map(item => <li key={item.id}>Task: {item.title}</li>)}{agentView.events.map(item => <li key={item.id}>Event: {item.title}</li>)}</ul>
        </>}
        <form onSubmit={createTask}>
          <label>Agent task title<input aria-label="Agent task title" required maxLength={500} value={taskTitle} onChange={event => setTaskTitle(event.target.value)} /></label>
          <p className={styles.small}>Try a personal task using this simulated identity. Requires tasks:write and Personal tasks. A denied action stays denied.</p>
          <button disabled={disabled || !taskTitle.trim()}>Create task as agent</button>
        </form>
        {result && <p role={result.allowed ? "status" : "alert"} data-testid="agent-action-result">{result.message}</p>}
      </section>}
    </section>
    <section className={styles.panel}>
      <h2 className={styles.sectionHeading}>Grant scoped access</h2>
      <form className={styles.form} onSubmit={async event => {
        event.preventDefault();
        if (await command({ type: "agent.grant", name, scopes: capabilities, resourceIds: resources }, "Scoped agent created")) { setName(""); setResources([]); }
      }}>
        <label>Agent name<input aria-label="Agent name" required maxLength={500} value={name} onChange={event => setName(event.target.value)} /></label>
        <fieldset><legend>Capabilities</legend>{scopes.map(scope => <label className={styles.check} key={scope}><input type="checkbox" checked={capabilities.includes(scope)} onChange={event => setCapabilities(event.target.checked ? [...capabilities, scope] : capabilities.filter(item => item !== scope))} />{scope}</label>)}</fieldset>
        <fieldset><legend>Allowed resources</legend>{resourceOptions.map(resource => <label className={styles.check} key={resource.id}><input type="checkbox" checked={resources.includes(resource.id)} onChange={event => setResources(event.target.checked ? [...resources, resource.id] : resources.filter(item => item !== resource.id))} />{resource.label}</label>)}</fieldset>
        <p className={styles.small}>Select only the mailboxes, calendars and personal task collection this agent needs. Unselected resources stay private. All identities and providers here are simulated.</p>
        <button className={styles.primary} disabled={disabled || !capabilities.length || !resources.length}>Create agent</button>
      </form>
    </section>
  </div>;
}
