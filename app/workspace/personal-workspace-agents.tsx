"use client";

import { useEffect, useState } from "react";
import type { AuthSession } from "../openjob-contracts";
import { PERSONAL_AGENT_SCOPES, PERSONAL_AGENT_RESOURCES, type PersonalAgentGrant } from "../../shared/personal-agent-grants";
import { PERSONAL_MAIL_ACCOUNTS } from "../../shared/personal-mail-examples";
import type { PersonalWorkspaceClient } from "./personal-workspace-api";
import styles from "./workspace.module.css";

type Props = { session: AuthSession; signal: AbortSignal; client: PersonalWorkspaceClient; onChanged: () => Promise<void> };

export default function PersonalWorkspaceAgents({ session, signal, client, onChanged }: Props) {
  const [grants, setGrants] = useState<PersonalAgentGrant[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [observedAt, setObservedAt] = useState(() => Date.now());

  useEffect(() => { const timer = window.setInterval(() => setObservedAt(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);

  useEffect(() => {
    let active = true;
    client.listAgents(session, signal).then((items) => { if (active && !signal.aborted) setGrants(items); }).catch(() => { if (active && !signal.aborted) setError("Agent access could not be loaded. Try Refresh agents."); });
    return () => { active = false; };
  }, [client, session, signal]);

  async function refresh() {
    if (signal.aborted) return;
    setBusy(true); setError("");
    try { const items = await client.listAgents(session, signal); if (!signal.aborted) setGrants(items); }
    catch { if (!signal.aborted) setError("Agent access could not be loaded. Try Refresh agents."); }
    finally { if (!signal.aborted) setBusy(false); }
  }

  async function revoke(agent: PersonalAgentGrant) {
    if (signal.aborted || !window.confirm(`Revoke access for “${agent.name}”? Future API requests will stop immediately. Existing task and calendar changes remain.`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await client.revokeAgent(session, agent.id, signal);
      if (signal.aborted) return;
      const items = await client.listAgents(session, signal);
      if (signal.aborted) return;
      setGrants(items); setNotice("Agent access revoked. Future API requests are denied.");
      await onChanged();
    } catch { if (!signal.aborted) setError("Revocation could not be confirmed. Refresh agents to check access before retrying."); }
    finally { if (!signal.aborted) setBusy(false); }
  }

  return <section aria-label="Personal agent access">
    <div className={styles.title}><div><h2>Scoped personal agents</h2><p>Review access issued through the authenticated OpenJob CLI. Credentials are saved to a private file at issuance and are never shown here.</p></div><button disabled={busy} onClick={refresh}>Refresh agents</button></div>
    <p className={styles.banner}>These grants authorize selected personal Tasks, Calendar and named invented Mail resources for 24 hours. Mail scopes cover only persisted invented examples and local draft/simulation actions; provider mail and actual sending remain unavailable. Revoke any grant to stop future requests immediately.</p>
    <details className={styles.activity}><summary>Available scoped resources</summary><p>{PERSONAL_AGENT_SCOPES.join(", ")}</p><ul>{PERSONAL_AGENT_RESOURCES.map((resource) => <li key={resource}>{PERSONAL_MAIL_ACCOUNTS.find((account) => account.id === resource)?.label || (resource === "tasks:personal" ? "Personal Tasks" : "Personal Calendar")} · {resource}</li>)}</ul></details>
    {error && <p role="alert" className={styles.error}>{error}</p>}{notice && <p role="status" className={styles.success}>{notice}</p>}
    {grants === null && !error && <p role="status">Loading agent access…</p>}
    {grants?.length === 0 && <p className={styles.empty}>No personal agents have access. Use the authenticated CLI to issue a scoped credential when needed.</p>}
    {grants?.map((agent) => {
      const expired = Date.parse(agent.expiresAt) <= observedAt;
      return <article className={styles.panel} data-testid="personal-agent-row" key={agent.id}><div className={styles.agent}>
        <strong>{agent.name}</strong><small>Agent ID: {agent.id}</small><p>{agent.revoked ? "Revoked" : expired ? "Expired" : "Active"}</p>
        <p>Effective scopes: {agent.scopes.join(", ")}<br />Effective resources: {agent.resourceIds.join(", ")}</p>
        <p>Named invented mailboxes: {agent.resourceIds.filter((resource) => resource.startsWith("mail:")).map((resource) => PERSONAL_MAIL_ACCOUNTS.find((account) => account.id === resource)?.label || resource).join(", ") || "None"}</p>
        <small>Expires {new Date(agent.expiresAt).toLocaleString()} · issued {new Date(agent.createdAt).toLocaleString()}</small>
        <button disabled={busy || agent.revoked || expired} onClick={() => revoke(agent)}>Revoke access</button>
      </div></article>;
    })}
  </section>;
}
