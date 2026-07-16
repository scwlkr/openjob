"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  ApiError,
  type AuthSession,
  type Ban,
  type Group,
  type InviteLink,
  type Member,
  type OpenJobApi,
  type User,
} from "./openjob-contracts";
import styles from "./openjob.module.css";

function actionMessage(error: unknown) {
  if (error instanceof ApiError) {
    const fieldMessage = error.fields && Object.values(error.fields)[0];
    if (fieldMessage) return fieldMessage;
    const messages: Record<string, string> = {
      admin_required: "You no longer have Admin permission for this Group.",
      ban_not_allowed: "That User cannot be banned from this Group.",
      confirmation_mismatch: "Enter the current Group Name exactly.",
      last_admin: "Promote another Admin before making that change.",
      members_remain: "Remove every other Member before ending this Group.",
      open_tasks_assigned: "Reassign or complete your open Tasks before leaving.",
      self_removal: "Use Leave Group to remove yourself.",
    };
    if (messages[error.code]) return messages[error.code];
    if (error.status === 404) return "That Group, Member, or ban is no longer available.";
    if (error.status === 409) return "The Group changed. Reload and try again.";
  }
  return "OpenJob could not save that change. Try again.";
}

function memberLabel(member: Pick<Member, "userId" | "username">) {
  return member.username ? `@${member.username}` : member.userId;
}

function expiryLabel(value: string) {
  return `Expires ${new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))}`;
}

export function GroupGovernance({
  api,
  group,
  onGroupRemoved,
  onGroupUpdated,
  onSessionExpired,
  session,
  user,
}: {
  api: OpenJobApi;
  group: Group;
  onGroupRemoved: (message: string) => void;
  onGroupUpdated: (group: Group) => void;
  onSessionExpired: (error: unknown) => Promise<boolean>;
  session: AuthSession;
  user: User;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [bans, setBans] = useState<Ban[]>([]);
  const [invite, setInvite] = useState<InviteLink | null>(null);
  const [name, setName] = useState(group.name);
  const [confirmationName, setConfirmationName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (token?: string) => {
    setLoading(true);
    setError("");
    try {
      const activeToken = token ?? await session.getIdToken();
      if (group.role === "admin") {
        const [nextMembers, nextBans, nextInvite] = await Promise.all([
          api.listMembers(activeToken, group.groupId),
          api.listBans(activeToken, group.groupId),
          api.getInviteLink(activeToken, group.groupId),
        ]);
        setMembers(nextMembers);
        setBans(nextBans);
        setInvite(nextInvite);
      } else {
        setMembers(await api.listMembers(activeToken, group.groupId));
        setBans([]);
        setInvite(null);
      }
    } catch (loadError) {
      if (!(await onSessionExpired(loadError))) setError(actionMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [api, group.groupId, group.role, onSessionExpired, session]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  async function runAction(
    action: (token: string) => Promise<void>,
    { refresh = true }: { refresh?: boolean } = {},
  ) {
    setSaving(true);
    setError("");
    try {
      const token = await session.getIdToken();
      await action(token);
      if (refresh) await load(token);
    } catch (actionError) {
      if (!(await onSessionExpired(actionError))) setError(actionMessage(actionError));
    } finally {
      setSaving(false);
    }
  }

  function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runAction(async (token) => {
      const renamed = await api.renameGroup(token, group.groupId, name);
      setName(renamed.name);
      onGroupUpdated(renamed);
    }, { refresh: false });
  }

  function confirmAction(message: string, action: () => void) {
    if (window.confirm(message)) action();
  }

  const isAdmin = group.role === "admin";
  const soleMember = members.length === 1 && members[0]?.userId === user.userId;

  return (
    <section className={styles.governanceSurface} data-testid="governance-surface" aria-label="Group management">
      <header>
        <p className={styles.kicker}>{isAdmin ? "Group administration" : "Group membership"}</p>
        <h2>{isAdmin ? `Manage ${group.name}` : `${group.name} settings`}</h2>
      </header>

      {error ? (
        <div className={styles.governanceError} role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void load()}>Reload</button>
        </div>
      ) : null}

      {loading ? <p className={styles.governanceLoading} aria-busy="true">Loading Group details…</p> : (
        <div className={styles.governanceGrid}>
          {isAdmin && invite ? (
            <section className={styles.governanceCard}>
              <div className={styles.cardHeading}>
                <div>
                  <p className={styles.kicker}>Access</p>
                  <h3>Invite Link</h3>
                </div>
                <span>{invite.remainingJoins} joins remaining</span>
              </div>
              <label className={styles.readonlyField}>
                Invite Link
                <input readOnly value={invite.url} />
              </label>
              <time dateTime={invite.expiresAt}>{expiryLabel(invite.expiresAt)}</time>
              <button
                className={styles.secondaryButton}
                type="button"
                disabled={saving}
                onClick={() => confirmAction(
                  "Rotate this Invite Link? The current link will stop working immediately.",
                  () => void runAction(async (token) => {
                    setInvite(await api.rotateInviteLink(token, group.groupId));
                  }, { refresh: false }),
                )}
              >
                Rotate Invite Link
              </button>
            </section>
          ) : null}

          <section className={styles.governanceCard}>
            <div className={styles.cardHeading}>
              <div>
                <p className={styles.kicker}>Roster</p>
                <h3>Members</h3>
              </div>
              <span>{members.length}</span>
            </div>
            <div className={styles.governanceRows}>
              {members.map((member) => (
                <article className={styles.governanceRow} data-testid="member-row" key={member.userId}>
                  <div>
                    <strong>{memberLabel(member)}</strong>
                    <span>{member.role === "admin" ? "Admin" : "Member"}</span>
                  </div>
                  {isAdmin ? (
                    <div className={styles.rowActions}>
                      {member.role === "member" ? (
                        <button type="button" disabled={saving} onClick={() => void runAction((token) =>
                          api.promoteMember(token, group.groupId, member.userId).then(() => undefined)
                        )}>Promote</button>
                      ) : (
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => confirmAction(
                            `Demote ${memberLabel(member)} to Member?`,
                            () => void runAction((token) =>
                              api.demoteMember(token, group.groupId, member.userId).then(() => undefined)
                            ),
                          )}
                        >Demote</button>
                      )}
                      {member.userId !== user.userId ? (
                        <>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => confirmAction(
                              `Kick ${memberLabel(member)}? Their open Tasks will become Unassigned.`,
                              () => void runAction((token) => api.kickMember(token, group.groupId, member.userId)),
                            )}
                          >Kick</button>
                          <button
                            className={styles.dangerTextButton}
                            type="button"
                            disabled={saving}
                            onClick={() => confirmAction(
                              `Ban ${memberLabel(member)}? They will lose access and cannot rejoin until unbanned.`,
                              () => void runAction((token) =>
                                api.banMember(token, group.groupId, member.userId).then(() => undefined)
                              ),
                            )}
                          >Ban</button>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </section>

          {isAdmin ? (
            <section className={styles.governanceCard}>
              <div className={styles.cardHeading}>
                <div>
                  <p className={styles.kicker}>Denied access</p>
                  <h3>Bans</h3>
                </div>
                <span>{bans.length}</span>
              </div>
              {bans.length === 0 ? <p className={styles.emptyGovernance}>No banned Users.</p> : (
                <div className={styles.governanceRows}>
                  {bans.map((ban) => (
                    <article className={styles.governanceRow} data-testid="ban-row" key={ban.userId}>
                      <div>
                        <strong>{memberLabel(ban)}</strong>
                        <time dateTime={ban.bannedAt}>Banned {new Date(ban.bannedAt).toLocaleDateString()}</time>
                      </div>
                      <div className={styles.rowActions}>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => confirmAction(
                            `Unban ${memberLabel(ban)}? They will still need an Invite Link to rejoin.`,
                            () => void runAction((token) => api.unbanMember(token, group.groupId, ban.userId)),
                          )}
                        >Unban</button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {isAdmin ? (
            <section className={styles.governanceCard}>
              <p className={styles.kicker}>Identity</p>
              <h3>Group Name</h3>
              <form className={styles.inlineGovernanceForm} onSubmit={rename} noValidate>
                <label>
                  Group Name
                  <input value={name} onChange={(event) => setName(event.target.value)} />
                </label>
                <button className={styles.secondaryButton} type="submit" disabled={saving || name === group.name}>
                  Rename Group
                </button>
              </form>
            </section>
          ) : null}

          <section className={`${styles.governanceCard} ${styles.dangerCard}`}>
            <p className={styles.kicker}>Membership</p>
            <h3>{isAdmin && soleMember ? "End Group" : "Leave Group"}</h3>
            {isAdmin && soleMember ? (
              <>
                <p>Permanently remove this Group, its Task List, membership, Invite Link, and bans.</p>
                <label className={styles.readonlyField}>
                  Type {group.name} to confirm
                  <input value={confirmationName} onChange={(event) => setConfirmationName(event.target.value)} />
                </label>
                <button
                  className={styles.dangerButton}
                  type="button"
                  disabled={saving || confirmationName !== group.name}
                  onClick={() => confirmAction(
                    `Permanently End Group “${group.name}”? This cannot be undone.`,
                    () => void runAction(async (token) => {
                      await api.endGroup(token, group.groupId, confirmationName);
                      onGroupRemoved(`${group.name} was permanently ended.`);
                    }, { refresh: false }),
                  )}
                >End Group</button>
              </>
            ) : (
              <>
                <p>You can leave after your open Tasks are reassigned or completed. A final Admin must promote another Admin first.</p>
                <button
                  className={styles.dangerButton}
                  type="button"
                  disabled={saving}
                  onClick={() => confirmAction(
                    `Leave Group “${group.name}”? You will lose access immediately.`,
                    () => void runAction(async (token) => {
                      await api.leaveGroup(token, group.groupId);
                      onGroupRemoved(`You left ${group.name}.`);
                    }, { refresh: false }),
                  )}
                >Leave Group</button>
              </>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
