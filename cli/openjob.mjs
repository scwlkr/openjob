#!/usr/bin/env node
// @ts-check

import { prepareAgentGrant, deliverAgentGrant, preparePrivateTokenOutput } from "./lib/agent-grant.mjs";
import { findAvailableTaskSlots } from "./lib/workspace-availability.mjs";
import { parseCalendarIcal, previewCalendarIcalImport } from "./lib/calendar-ical.mjs";
import { openSync, fstatSync, closeSync, readSync } from "node:fs";
import { readWorkspaceAgentToken } from "./lib/owned-workspace-agents.mjs";
import { runOwnedWorkspace } from "./lib/owned-workspace.mjs";
import { runReplyOperation } from "./lib/reply-operations.mjs";
import { preparePersonalAgentGrant, deliverPersonalAgentGrant, publicPersonalAgent, readPersonalAgentToken } from "./lib/personal-agent-grant.mjs";
import { normalizeWorkspaceTaskQuery, filterWorkspaceTasks } from "./lib/workspace-task-query.mjs";
import { parseArguments } from "./lib/arguments.mjs";
import {
  apiRequestWithIdToken as requestApiWithIdToken,
  createApiClient,
} from "./lib/api.mjs";
import { loginWithGoogle } from "./lib/auth.mjs";
import {
  confirmDestructiveAction,
  confirmGroupEnd,
  confirmTaskDeletion,
  inputIsInteractive,
} from "./lib/confirmation.mjs";
import {
  clearCurrentGroup,
  resolveGroup as resolveGroupForProfile,
  writeCurrentGroup,
} from "./lib/config.mjs";
import {
  deleteRefreshCredential,
  writeRefreshCredential,
} from "./lib/credential-store.mjs";
import { CliError, reportError } from "./lib/errors.mjs";
import { readInputObject, readTextSource } from "./lib/input.mjs";
import { outputFormat, preflightOutput, writeEnvelope, writeRawPrivateFile } from "./lib/output.mjs";
import { resolveCliProfile } from "./lib/profiles.mjs";
import { runService } from "./lib/service.mjs";
import { runApp } from "./lib/app.mjs";
import { automaticUpdateNotice, checkForUpdates } from "./lib/updates.mjs";
import packageJson from "./package.json" with { type: "json" };

/** @typedef {Map<string, string>} CommandOptions */
/** @typedef {ReturnType<typeof resolveCliProfile>} CliProfile */
/** @typedef {import("./openapi-types.ts").CurrentUserResponse} CurrentUserResponse */
/** @typedef {import("./openapi-types.ts").ClaimUsernameRequest} ClaimUsernameRequest */
/** @typedef {import("./openapi-types.ts").ClaimUsernameResponse} ClaimUsernameResponse */
/** @typedef {import("./openapi-types.ts").ListGroupsResponse} ListGroupsResponse */
/** @typedef {import("./openapi-types.ts").ListAgentGrantsResponse} ListAgentGrantsResponse */
/** @typedef {import("./openapi-types.ts").CreateAgentGrantResponse} CreateAgentGrantResponse */
/** @typedef {import("./openapi-types.ts").PersonalWorkspaceSnapshotResponse} PersonalWorkspaceSnapshotResponse */
/** @typedef {import("./openapi-types.ts").PersonalWorkspaceCommandRequest} PersonalWorkspaceCommandRequest */
/** @typedef {import("./openapi-types.ts").PersonalWorkspaceCommandResponse} PersonalWorkspaceCommandResponse */
/** @typedef {import("./openapi-types.ts").CreateGroupRequest} CreateGroupRequest */
/** @typedef {import("./openapi-types.ts").CreateGroupResponse} CreateGroupResponse */
/** @typedef {import("./openapi-types.ts").GetGroupResponse} GetGroupResponse */
/** @typedef {import("./openapi-types.ts").RenameGroupRequest} RenameGroupRequest */
/** @typedef {import("./openapi-types.ts").RenameGroupResponse} RenameGroupResponse */
/** @typedef {import("./openapi-types.ts").EndGroupRequest} EndGroupRequest */
/** @typedef {import("./openapi-types.ts").ListMembersResponse} ListMembersResponse */
/** @typedef {import("./openapi-types.ts").PromoteMemberResponse} PromoteMemberResponse */
/** @typedef {import("./openapi-types.ts").DemoteMemberResponse} DemoteMemberResponse */
/** @typedef {import("./openapi-types.ts").ListBansResponse} ListBansResponse */
/** @typedef {import("./openapi-types.ts").BanUserRequest} BanUserRequest */
/** @typedef {import("./openapi-types.ts").BanUserResponse} BanUserResponse */
/** @typedef {import("./openapi-types.ts").GetInviteLinkResponse} GetInviteLinkResponse */
/** @typedef {import("./openapi-types.ts").RotateInviteLinkResponse} RotateInviteLinkResponse */
/** @typedef {import("./openapi-types.ts").InspectInviteResponse} InspectInviteResponse */
/** @typedef {import("./openapi-types.ts").JoinInviteResponse} JoinInviteResponse */
/** @typedef {import("./openapi-types.ts").ListTasksResponse} ListTasksResponse */
/** @typedef {import("./openapi-types.ts").CreateTaskRequest} CreateTaskRequest */
/** @typedef {import("./openapi-types.ts").CreateTaskResponse} CreateTaskResponse */
/** @typedef {import("./openapi-types.ts").GetTaskResponse} GetTaskResponse */
/** @typedef {import("./openapi-types.ts").UpdateTaskRequest} UpdateTaskRequest */
/** @typedef {import("./openapi-types.ts").UpdateTaskResponse} UpdateTaskResponse */
/** @typedef {import("./openapi-types.ts").SetTaskStateRequest} SetTaskStateRequest */
/** @typedef {import("./openapi-types.ts").SetTaskStateResponse} SetTaskStateResponse */

const VERSION = packageJson.version;
const PROFILE_OPTION = "--profile";
const OUTPUT_OPTIONS = ["--format", "--force", "--out", "--quiet"];
const GROUP_SCOPED_OPTIONS = [...OUTPUT_OPTIONS, "--group"];
const TASK_COMMON_OPTIONS = GROUP_SCOPED_OPTIONS;
const TASK_FIELD_OPTIONS = ["--text", "--text-file", "--assignee", "--priority", "--due", "--schedule-start", "--schedule-end", "--clear-schedule"];
const TASK_OPTIONS = new Map([
  ["list", new Set([...TASK_COMMON_OPTIONS, "--agent-token-file", "--status", "--assignee", "--limit"])],
  ["create", new Set([...TASK_COMMON_OPTIONS, "--input", ...TASK_FIELD_OPTIONS])],
  ["show", new Set([...TASK_COMMON_OPTIONS, "--agent-token-file"])],
  ["edit", new Set([...TASK_COMMON_OPTIONS, "--input", ...TASK_FIELD_OPTIONS])],
  ["done", new Set(TASK_COMMON_OPTIONS)],
  ["reopen", new Set(TASK_COMMON_OPTIONS)],
  ["delete", new Set([...TASK_COMMON_OPTIONS, "--yes"])],
]);
const COMMAND_OPTIONS = new Map([
  ["operation list", new Set([...OUTPUT_OPTIONS, "--workspace", "--task", "--cursor"])],
  ["operation show", new Set([...OUTPUT_OPTIONS, "--workspace"])],
  ["operation enqueue", new Set([...OUTPUT_OPTIONS, "--workspace", "--input"])],
  ["operation run-fixture", new Set([...OUTPUT_OPTIONS, "--workspace"])],
  ["connections list", new Set(OUTPUT_OPTIONS)],
  ["connections begin", new Set([...OUTPUT_OPTIONS, "--input"])],
  ["connections action", new Set([...OUTPUT_OPTIONS, "--input"])],
  ["connections mail", new Set([...OUTPUT_OPTIONS, "--cursor", "--folder", "--search", "--metadata-only"])],
  ["connections message", new Set(OUTPUT_OPTIONS)],
  ["connections task", new Set([...OUTPUT_OPTIONS, "--input"])],
  ["connections source", new Set(OUTPUT_OPTIONS)],
  ["connections reply", new Set(OUTPUT_OPTIONS)],
  ["connections reply-save", new Set([...OUTPUT_OPTIONS, "--input"])],
  ["workspace snapshot", new Set(["--workspace", ...OUTPUT_OPTIONS, "--agent-token-file"])],
  ["workspace availability", new Set([...OUTPUT_OPTIONS, "--task", "--schedule-start", "--schedule-end", "--minutes"])],
  ["workspace tasks", new Set(["--workspace", ...OUTPUT_OPTIONS, "--agent-token-file", "--status", "--search", "--scheduled-on"])],
  ["workspace providers", new Set([...OUTPUT_OPTIONS, "--account", "--cursor"])],
  ["workspace command", new Set(["--workspace", ...OUTPUT_OPTIONS, "--input", "--agent-token-file"])],
  ["workspace calendar export", new Set([...OUTPUT_OPTIONS.filter(option => option !== "--force"), "--calendar", "--file", "--agent-token-file"])],
  ["workspace calendar import", new Set([...OUTPUT_OPTIONS, "--calendar", "--file", "--agent-token-file", "--dry-run", "--yes"])],
  ["workspace agent grant", new Set(["--workspace", ...OUTPUT_OPTIONS.filter(option => option !== "--force"), "--name", "--scopes", "--resources", "--token-out"])],
  ["workspace agent list", new Set(["--workspace", ...OUTPUT_OPTIONS])],
  ["workspace agent revoke", new Set(["--workspace", ...OUTPUT_OPTIONS, "--yes"])],
  ["agent grant", new Set([...OUTPUT_OPTIONS.filter(option => option !== "--force"), "--group", "--name", "--token-out"])],
  ["agent list", new Set(OUTPUT_OPTIONS)],
  ["agent revoke", new Set([...OUTPUT_OPTIONS, "--yes"])],
  ["auth login", new Set([...OUTPUT_OPTIONS, "--no-open"])],
  ["auth status", new Set(OUTPUT_OPTIONS)],
  ["auth logout", new Set([...OUTPUT_OPTIONS, "--yes"])],
  ["user show", new Set(OUTPUT_OPTIONS)],
  ["username claim", new Set([...OUTPUT_OPTIONS, "--input"])],
  ["group list", new Set(OUTPUT_OPTIONS)],
  ["group create", new Set([...OUTPUT_OPTIONS, "--input", "--name"])],
  ["group show", new Set(GROUP_SCOPED_OPTIONS)],
  ["group use", new Set(OUTPUT_OPTIONS)],
  ["group current", new Set(GROUP_SCOPED_OPTIONS)],
  ["group rename", new Set([...GROUP_SCOPED_OPTIONS, "--input", "--name"])],
  ["group leave", new Set([...GROUP_SCOPED_OPTIONS, "--yes"])],
  ["group end", new Set([...GROUP_SCOPED_OPTIONS, "--confirm-name", "--yes"])],
  ["member list", new Set(GROUP_SCOPED_OPTIONS)],
  ["member kick", new Set([...GROUP_SCOPED_OPTIONS, "--yes"])],
  ["member promote", new Set(GROUP_SCOPED_OPTIONS)],
  ["member demote", new Set([...GROUP_SCOPED_OPTIONS, "--yes"])],
  ["ban list", new Set(GROUP_SCOPED_OPTIONS)],
  ["ban add", new Set([...GROUP_SCOPED_OPTIONS, "--input", "--user-id", "--username", "--yes"])],
  ["ban remove", new Set(GROUP_SCOPED_OPTIONS)],
  ["invite show", new Set(GROUP_SCOPED_OPTIONS)],
  ["invite rotate", new Set([...GROUP_SCOPED_OPTIONS, "--yes"])],
  ["invite inspect", new Set(OUTPUT_OPTIONS)],
  ["invite join", new Set(OUTPUT_OPTIONS)],
]);

if (!["app", "server"].includes(process.argv[2])) process.once("SIGINT", () => process.exit(130));

const HELP = `OpenJob

Usage:
  openjob [global options] <resource> <command> [arguments]

Local app and updates:
  openjob app [--port 5191] [--state-file PATH]   Run the packaged workspace prototype
  openjob server [--port 5192] [--host 127.0.0.1|0.0.0.0]  Run the configured Node service
  openjob updates             Check the installed latest/dev channel (JSON)
  OPENJOB_NO_UPDATE_CHECK=1    Disable automatic notice-only checks

Resources:
  operation    Inspect/queue/run fixture reply operations in an explicit Workspace
  connections  List, begin, action or read Mail; normal runtime closed
  workspace  Personal Tasks, Calendar and invented Mail through the shared API
  auth       Sign in, inspect authentication, or sign out
  user       Show the current User
  username   Claim the current User's immutable Username
  group      List, create, select, inspect, rename, leave, or end Groups
  member     List Members and govern membership or Admin status
  ban        List, add, or remove Group-scoped bans
  invite     Inspect, join through, show, or rotate Invite Links
  task       List and manage Tasks; scoped reads: openjob help task
  agent      Grant, list and revoke scoped agent access

Global options:
  --group <group-id>          Override the client-local current Group
  --profile <name>            Select production or preview-owner
  --format <table|json|jsonl> Output encoding; default: table
  --out <path|->              Write results to a new file or stdout (-)
  --force                     Allow --out to replace an existing file
  --yes                       Confirm a destructive operation
  --quiet                     Suppress nonessential diagnostics
  --help                      Show help
  --version                   Show the version`;

/** @type {Record<string, string>} */
const RESOURCE_HELP = {
  connections: `Usage:
  openjob connections list
  openjob connections begin --input <json-file>
  openjob connections action <connection-id> --input <json-file>
  openjob connections mail <connection-id> [--folder <folder-id>] [--search <gmail-query>] [--cursor <next-cursor>] [--metadata-only]
  openjob connections message <connection-id> <upstream-message-id>
  openjob connections task <connection-id> --input <json-file>
  openjob connections source <workspace-id> <task-id>
  openjob connections reply <workspace-id> <task-id>
  openjob connections reply-save <workspace-id> <task-id> --input <json-file>

Begin input: simulated choiceId+workspaceId, or configured Google address+workspaceId.
Action input: action=approve(simulated)|cancel|disconnect|retry-cleanup|refresh(Google).
Google begin returns a browser consent URL; callback requires the signed human UI.
Configured Gmail --metadata-only lists headers without bodies; connections message reads one exact message. Mail accepts --folder with its returned account-qualified folder ID and --search with Gmail query syntax. Keep both filters with a matching nextCursor; omit --cursor to restart at the first page.
Normal runtime remains unconfigured; no CLI token input or automatic consent.`,
  operation: `Usage:
  openjob operation list --workspace <wsp_id> [--task <task-id>] [--cursor <cursor>]
  openjob operation show <op_id> --workspace <wsp_id>
  openjob operation enqueue --workspace <wsp_id> --input <path|->
  openjob operation run-fixture <op_id> --workspace <wsp_id>

Synthetic launcher only. Enqueue is accepted intent, not a send. Retain requestId
and exact input for explicit retry; mutations never retry automatically.
run-fixture exits 0 confirmed simulation, 4 rejected, 8 queued/executing/unknown.
Unknown operations cannot execute again. List/show inspect status without an effect.`,
  workspace: `Usage:
  openjob workspace snapshot
  openjob workspace availability --task <id> --schedule-start <ISO> --schedule-end <ISO> --minutes <5-480>
  openjob workspace tasks [--status <all|open|completed>] [--search <literal-title>] [--scheduled-on <YYYY-MM-DD>]
  openjob workspace providers [--account <account-id>] [--cursor <cursor>]
  openjob workspace command --input <path|->
  openjob workspace calendar export --calendar <id> --file <new-path>
  openjob workspace calendar import --calendar <id> --file <path> [--dry-run] [--yes]
  openjob workspace agent grant --name <name> --scopes <comma-list> --resources <comma-list> --token-out <new-path>
  openjob workspace agent list
  openjob workspace agent revoke <agent-id> [--yes]

Uses the selected profile's personal Tasks, Calendar and invented Mail API.
Add --workspace <wsp_id> to snapshot/tasks/command and agent grant/list/revoke for
an independent owned Workspace. Its grants accept only exact tsp_/cal_ resources
and Tasks/Calendar read/write scopes; linked planning changes need both writes.
Owned notes commands require expectedNotes. Workspace credentials must use the
same explicit --workspace with --agent-token-file; no human refresh fallback.
Commands are strict JSON task.create/update/notes/complete/schedule/unschedule/delete
or calendar.create/update/delete objects. Invented Mail supports mail.examples.add,
mail.read/draft/compose/draft.update/simulate-send. Real mail.send is always denied.
No real provider messages or fixture identity headers are accepted.
snapshot/command accept --agent-token-file <path|-> for personal scoped credentials,
with no credential refresh or human fallback. command input and token cannot both use stdin.
Mutations are not automatically retried after network or service failures.`,
  agent: `Usage:
  openjob agent grant --group <group-id> --name <name> --token-out <new-path>
  openjob agent list
  openjob agent revoke <agent-id> [--yes]

Uses the selected human profile. Grant writes a private token file, never stdout.
Grant requires an explicit Group, a name and a new token file; --force is rejected.
Only public grant metadata is printed. Listing never returns agent tokens.
Revocation stops subsequent reads; it cannot recall data already read.
Non-interactive revocation requires --yes. Agent token files are not accepted.`,
  auth: `Usage:
  openjob auth login [--no-open]
  openjob auth status
  openjob auth logout [--yes]`,
  user: `Usage:
  openjob user show`,
  username: `Usage:
  openjob username claim <username>
  openjob username claim --input <path|->`,
  group: `Usage:
  openjob group list
  openjob group create --name <name> | --input <path|->
  openjob group show [--group <group-id>]
  openjob group use <group-id>
  openjob group current
  openjob group rename --name <name> | --input <path|->
  openjob group leave [--yes]
  openjob group end [--confirm-name <name>]`,
  member: `Usage:
  openjob member list
  openjob member kick <username> [--yes]
  openjob member promote <username>
  openjob member demote <username> [--yes]`,
  ban: `Usage:
  openjob ban list
  openjob ban add (--username <username> | --user-id <user-id> | --input <path|->) [--yes]
  openjob ban remove <user-id>`,
  invite: `Usage:
  openjob invite show
  openjob invite rotate [--yes]
  openjob invite inspect <token-or-url>
  openjob invite join <token-or-url>`,
  task: `Usage:
  openjob task list [--agent-token-file <path|-> --group <group-id>] [--status <open|done|all>] [--assignee <username|unassigned|all>] [--limit <count>]
  openjob task create (--text <text> | --text-file <path|->) --assignee <username> [--priority <high|normal|low>] [--due <YYYY-MM-DD>] [--schedule-start <timestamp> --schedule-end <timestamp>]
  openjob task create --input <path|->
  openjob task show <task-id> [--agent-token-file <path|-> --group <group-id>]
  openjob task edit <task-id> [--text <text> | --text-file <path|->] [--assignee <username>] [--priority <high|normal|low>] [--due <YYYY-MM-DD|none>] [--schedule-start <timestamp> --schedule-end <timestamp> | --clear-schedule]
  openjob task edit <task-id> --input <path|->
  openjob task done <task-id>
  openjob task reopen <task-id>
  openjob task delete <task-id> [--yes]

Agent list/show reads require an explicit Group and token file (or stdin -).
Grants expire after 24 hours and stop on revocation or owner membership loss.
Agent reads never refresh or fall back to human credentials.`,
};

/** @param {string} resource @param {string} command */
function commandOptions(resource, command) {
  return resource === "task"
    ? TASK_OPTIONS.get(command)
    : COMMAND_OPTIONS.get(`${resource} ${command}`);
}

/** @param {string} resource @param {string} command @param {CommandOptions} options */
function validateCommandOptions(resource, command, options) {
  const allowed = commandOptions(resource, command);
  if (!allowed) return;
  for (const option of options.keys()) {
    if (option !== PROFILE_OPTION && !allowed.has(option)) {
      throw new CliError(
        "usage_error",
        `Option ${option} is not valid for ${resource} ${command}.`,
        2,
      );
    }
  }
}

/** @param {string[]} rest @param {CommandOptions} options @returns {ClaimUsernameRequest} */
function usernameMutationBody(rest, options) {
  const hasInput = options.has("--input");
  const hasValidInput = hasInput ? rest.length === 0 : rest.length === 1;
  if (!hasValidInput) {
    throw new CliError(
      "usage_error",
      "username claim requires exactly one Username argument or --input.",
      2,
    );
  }
  if (hasInput) {
    return /** @type {ClaimUsernameRequest} */ (readInputObject(options.get("--input")));
  }
  const username = rest[0];
  return { username: username.startsWith("@") ? username.slice(1) : username };
}

/** @param {string[]} raw @param {unknown} error */
function clearConcealedConfigGroup(raw, error) {
  if (!(error instanceof CliError) || error.code !== "group_not_found") return;
  const parsed = parseArguments(raw);
  const [resource, command] = parsed.positionals;
  if (!commandOptions(resource, command)?.has("--group")) return;
  const profile = resolveCliProfile(
    parsed.options.get(PROFILE_OPTION),
    process.env,
  );
  const selected = resolveGroupForProfile(
    parsed.options,
    process.env,
    profile,
  );
  if (selected.source === "config") {
    clearCurrentGroup(selected.groupId, process.env, profile);
  }
}

/** @param {CurrentUserResponse} currentUser @param {CliProfile} profile */
function assertSelectedIdentity(currentUser, profile) {
  if (profile.expectedUsername === null && profile.expectedUserId === null) return;
  if (
    currentUser?.data?.username !== profile.expectedUsername ||
    currentUser?.data?.userId !== profile.expectedUserId
  ) {
    throw new CliError(
      "profile_identity_mismatch",
      "Signed-in User does not match the selected CLI profile.",
      3,
    );
  }
}

/**
 * @param {"create" | "edit"} command
 * @param {CommandOptions} options
 * @returns {CreateTaskRequest | UpdateTaskRequest}
 */
function taskMutationBody(command, options) {
  const hasInput = options.has("--input");
  const selectedFields = TASK_FIELD_OPTIONS.filter((option) => options.has(option));
  if (hasInput && selectedFields.length > 0) {
    throw new CliError(
      "usage_error",
      `task ${command} accepts --input or named field flags, never both.`,
      2,
    );
  }
  if (hasInput) return readInputObject(options.get("--input"));

  const textSources = ["--text", "--text-file"].filter((option) =>
    options.has(option),
  );
  if (command === "create" && (textSources.length !== 1 || !options.has("--assignee"))) {
    throw new CliError(
      "usage_error",
      "task create requires one text source and --assignee.",
      2,
    );
  }
  if (command === "edit" && selectedFields.length === 0) {
    throw new CliError("usage_error", "task edit requires at least one field.", 2);
  }
  if (textSources.length > 1) {
    throw new CliError("usage_error", `task ${command} accepts one text source.`, 2);
  }

  const body = {};
  if (options.has("--text")) body.text = options.get("--text");
  if (options.has("--text-file")) body.text = readTextSource(options.get("--text-file"));
  if (options.has("--assignee")) {
    const assignee = (options.get("--assignee") ?? "").replace(/^@/, "");
    if (assignee === "unassigned") {
      throw new CliError("usage_error", "Task assignees must be Member Usernames.", 2);
    }
    body.assigneeUsername = assignee;
  }
  const hasStart = options.has("--schedule-start");
  const hasEnd = options.has("--schedule-end");
  const clearSchedule = options.has("--clear-schedule");
  if (hasStart !== hasEnd || (clearSchedule && (command !== "edit" || hasStart || hasEnd))) {
    throw new CliError("usage_error", "Supply both --schedule-start and --schedule-end, or --clear-schedule on edit.", 2);
  }
  if (clearSchedule) body.scheduledSlot = null;
  else if (hasStart && hasEnd) body.scheduledSlot = {
    start: options.get("--schedule-start") ?? "",
    end: options.get("--schedule-end") ?? "",
  };
  if (options.has("--due")) {
    const dueDate = options.get("--due");
    body.dueDate = command === "edit" && dueDate === "none" ? null : dueDate;
  }
  if (options.has("--priority")) {
    const priority = options.get("--priority") ?? "";
    if (!new Set(["high", "normal", "low"]).has(priority)) {
      throw new CliError("usage_error", "--priority must be high, normal, or low.", 2);
    }
    body.priority = /** @type {"high" | "normal" | "low"} */ (priority);
  }
  return body;
}

/**
 * @param {"create" | "rename"} command
 * @param {CommandOptions} options
 * @returns {CreateGroupRequest | RenameGroupRequest}
 */
function groupNameMutationBody(command, options) {
  const hasName = options.has("--name");
  const hasInput = options.has("--input");
  if (hasName === hasInput) {
    throw new CliError(
      "usage_error",
      `group ${command} requires exactly one of --name or --input.`,
      2,
    );
  }
  return hasInput
    ? /** @type {CreateGroupRequest | RenameGroupRequest} */ (
        readInputObject(options.get("--input"))
      )
    : { name: options.get("--name") ?? "" };
}

/**
 * @param {string} groupId
 * @param {string} rawUsername
 * @param {CommandOptions} options
 * @param {(path: string, options?: { limit?: number, quiet?: boolean }) => Promise<unknown>} apiCollection
 */
async function memberByUsername(
  groupId,
  rawUsername,
  options,
  apiCollection,
) {
  const username = rawUsername.replace(/^@/, "");
  const members = /** @type {ListMembersResponse} */ (await apiCollection(
    `/groups/${encodeURIComponent(groupId)}/members`,
    { quiet: options.has("--quiet") },
  ));
  const member = members.data.find((candidate) => candidate.username === username);
  if (!member) {
    throw new CliError("member_not_found", `Member @${username} was not found.`, 5);
  }
  return member;
}

/** @param {string} raw */
function inviteToken(raw) {
  if (!raw.includes("://")) return raw;
  try {
    const url = new URL(raw);
    const segments = url.pathname.split("/").filter(Boolean);
    if (
      !new Set(["http:", "https:"]).has(url.protocol) ||
      segments.length !== 2 ||
      segments[0] !== "invites"
    ) {
      throw new Error("not an Invite Link");
    }
    return decodeURIComponent(segments[1]);
  } catch {
    throw new CliError(
      "usage_error",
      "Invite input must be a token or an /invites/<token> URL.",
      2,
    );
  }
}

/** @param {string[]} raw */
async function main(raw) {
  if (raw[0] === "server" && !raw.includes("--help")) return runService(raw.slice(1));
  if (raw[0] === "app" && !raw.includes("--help")) return runApp(raw.slice(1), packageJson);
  if (raw[0] === "updates" && !raw.includes("--help")) {
    if (raw.length !== 1) throw new CliError("usage_error", "Use openjob updates.", 2);
    process.stdout.write(JSON.stringify(await checkForUpdates(packageJson)) + "\n");
    return;
  }
  if (raw.length === 0 || raw.includes("--help")) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (raw[0] === "help") {
    if (raw.length === 1) {
      process.stdout.write(`${HELP}\n`);
      return;
    }
    const resourceHelp = RESOURCE_HELP[raw[1]];
    if (!resourceHelp || raw.length !== 2) {
      throw new CliError("usage_error", "Unknown help topic. Run openjob --help.", 2);
    }
    process.stdout.write(`${resourceHelp}\n`);
    return;
  }
  if (raw.includes("--version")) {
    process.stdout.write(`openjob ${VERSION}\n`);
    return;
  }

  const parsed = parseArguments(raw);
  const [resource, command, ...rest] = parsed.positionals;
  validateCommandOptions(resource, resource === "workspace" && ["agent", "calendar"].includes(command) ? `${command} ${rest[0]}` : command, parsed.options);
  const profile = resolveCliProfile(
    parsed.options.get(PROFILE_OPTION),
    process.env,
  );
  const agentTokenFile = parsed.options.get("--agent-token-file");
  let agentToken;
  if (typeof agentTokenFile === "string") {
    if (resource === "workspace") {
      if (agentTokenFile === "-" && parsed.options.get("--input") === "-") throw new CliError("usage_error", "The personal credential and command input cannot both use stdin.", 2);
      agentToken = parsed.options.has("--workspace") ? readWorkspaceAgentToken(agentTokenFile, parsed.options.get("--workspace")) : readPersonalAgentToken(agentTokenFile);
    } else {
      if (!parsed.options.has("--group")) throw new CliError("usage_error", "Agent reads require explicit --group.", 2);
      agentToken = readTextSource(agentTokenFile);
      if (!/^oj_agent_agt_[a-f0-9]{32}\.[A-Za-z0-9_-]{43}$/.test(agentToken)) {
        throw new CliError("input_invalid", "Agent token file must contain one valid agent credential.", 2);
      }
    }
  }
  const storedApi = createApiClient(process.env, agentToken, profile, { allowCredentialRefresh: agentToken === undefined });
  const hasBoundIdentity =
    agentToken === undefined && (profile.expectedUsername !== null || profile.expectedUserId !== null);
  /** @type {Promise<CurrentUserResponse> | undefined} */
  let selectedIdentityPromise;
  const selectedIdentity = () => {
    if (!hasBoundIdentity) {
      return /** @type {Promise<CurrentUserResponse>} */ (
        storedApi.request("/me")
      );
    }
    selectedIdentityPromise ??= (async () => {
      const currentUser = /** @type {CurrentUserResponse} */ (
        await storedApi.request("/me")
      );
      try {
        assertSelectedIdentity(currentUser, profile);
      } catch (error) {
        if (
          error instanceof CliError &&
          error.code === "profile_identity_mismatch"
        ) {
          await deleteRefreshCredential(process.env, profile);
        }
        throw error;
      }
      return currentUser;
    })();
    return selectedIdentityPromise;
  };
  /**
   * @param {string} path
   * @param {RequestInit} [init]
   * @param {{ retryable?: boolean, quiet?: boolean }} [options]
   */
  const apiRequest = async (path, init = {}, options = {}) => {
    if (hasBoundIdentity) await selectedIdentity();
    return storedApi.request(path, init, options);
  };
  /** @param {string} path @param {RequestInit} init @param {string} idToken */
  const apiRequestWithIdToken = (path, init, idToken) =>
    requestApiWithIdToken(path, init, idToken, process.env, profile);
  /** @param {string} path @param {{ limit?: number, quiet?: boolean }} [options] */
  const apiCollection = async (path, options = {}) => {
    if (hasBoundIdentity) await selectedIdentity();
    return storedApi.collection(path, options);
  };
  /** @param {CommandOptions} options */
  const resolveGroup = (options) =>
    resolveGroupForProfile(options, process.env, profile);
  const format = outputFormat(parsed.options);
  preflightOutput(parsed.options);
  /** @param {unknown} envelope */
  const writeResult = (envelope) => writeEnvelope(envelope, format, parsed.options);
  if (resource === 'operation') { await runReplyOperation({ command, rest, options: parsed.options, apiRequest, writeResult }); return; }
  if (resource === "workspace" && parsed.options.has("--workspace")) {
    await runOwnedWorkspace({ command, rest, options: parsed.options, apiRequest, writeResult, confirmDestructiveAction }); return;
  }
  if (resource === "workspace" && command === "calendar" && rest.length === 1 && ["export", "import"].includes(rest[0])) {
    const calendarId = parsed.options.get("--calendar"), file = parsed.options.get("--file");
    if (!calendarId || !/^[A-Za-z0-9:_-]{1,128}$/.test(calendarId) || !file || file === "-") throw new CliError("usage_error", "Calendar import/export requires --calendar <id> and --file <path> (not stdin/stdout).", 2);
    if (rest[0] === "export") {
      preparePrivateTokenOutput(new Map([...parsed.options, ["--token-out", file]]));
      const response = /** @type {import("./openapi-types.ts").CalendarIcalExportResponse} */ (await apiRequest(`/workspace/calendar-export?calendarId=${encodeURIComponent(calendarId)}`, {}, { retryable: true, quiet: parsed.options.has("--quiet") }));
      const data = response?.data;
      if (!data || data.calendarId !== calendarId || data.filename !== "openjob-calendar.ics" || data.contentType !== "text/calendar; charset=utf-8" || typeof data.ical !== "string" || Buffer.byteLength(data.ical) > 16384) throw new CliError("invalid_response", "OpenJob returned an invalid calendar export.", 8);
      try { parseCalendarIcal(data.ical); } catch { throw new CliError("invalid_response", "OpenJob returned an invalid calendar export.", 8); }
      writeRawPrivateFile(data.ical, file); writeResult({ data: { calendarId, file } }); return;
    }
    let ical; let descriptor;
    try {
      descriptor = openSync(file, "r");
      if (!fstatSync(descriptor).isFile()) throw new Error();
      const bytes = Buffer.alloc(16385); let length = 0;
      while (length < bytes.length) { const count = readSync(descriptor, bytes, length, bytes.length - length, null); if (!count) break; length += count; }
      if (length > 16384) throw new Error();
      ical = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)); parseCalendarIcal(ical);
    } catch { throw new CliError("input_invalid", "Use a supported UTF-8 iCalendar file up to 16 KiB and 50 timed UTC events.", 2); }
    finally { if (descriptor !== undefined) closeSync(descriptor); }
    const snapshot = /** @type {PersonalWorkspaceSnapshotResponse} */ (await apiRequest("/workspace/snapshot", {}, { retryable: true, quiet: parsed.options.has("--quiet") }));
    let preview;
    try { preview = await previewCalendarIcalImport(snapshot.data, calendarId, ical); }
    catch { throw new CliError("input_invalid", "The calendar import cannot be previewed for this target.", 2); }
    if (parsed.options.has("--dry-run")) { writeResult({ data: preview }); return; }
    process.stderr.write(`Calendar import preview: ${JSON.stringify(preview)}\n`);
    await confirmDestructiveAction(`Import ${preview.events.length} event(s) into Calendar ${calendarId}?`, "Calendar import requires --yes or interactive confirmation after preview. Use --dry-run to review without writing.", parsed.options);
    const response = await apiRequest("/workspace/commands", { method: "POST", body: JSON.stringify({ type: "calendar.import", calendarId, ical, expectedRevision: preview.expectedRevision }) });
    writeResult(response); return;
  }
  if (resource === "workspace" && command === "availability" && rest.length === 0) {
    const taskId = parsed.options.get("--task"), start = parsed.options.get("--schedule-start"), end = parsed.options.get("--schedule-end");
    const durationMinutes = Number(parsed.options.get("--minutes"));
    if (typeof taskId !== "string" || typeof start !== "string" || typeof end !== "string") throw new CliError("usage_error", "Use workspace availability --task ID --schedule-start ISO --schedule-end ISO --minutes 5-480.", 2);
    const snapshot = /** @type {PersonalWorkspaceSnapshotResponse} */ (await apiRequest("/workspace/snapshot", {}, { retryable: true, quiet: parsed.options.has("--quiet") }));
    try { writeResult({ data: findAvailableTaskSlots(snapshot.data, { taskId, start, end, durationMinutes }) }); }
    catch { throw new CliError("input_invalid", "Choose an open Task and a valid ISO window of at most seven days, duration 5-480 minutes. Suggestions cover saved visible Calendar blocks only.", 2); }
    return;
  }
  if (resource === "workspace" && command === "tasks" && rest.length === 0) {
    let query;
    try { query = normalizeWorkspaceTaskQuery({ status: parsed.options.get("--status"), search: parsed.options.get("--search"), scheduledOn: parsed.options.get("--scheduled-on") }); }
    catch { throw new CliError("usage_error", "Use --status all|open|completed, --search up to 200 characters and a real --scheduled-on YYYY-MM-DD date.", 2); }
    const response = /** @type {PersonalWorkspaceSnapshotResponse} */ (await apiRequest("/workspace/snapshot", {}, { retryable: true, quiet: parsed.options.has("--quiet") }));
    if (!Array.isArray(response?.data?.tasks)) throw new CliError("invalid_response", "OpenJob returned an invalid task snapshot.", 8);
    writeResult({ data: filterWorkspaceTasks(response.data.tasks, query) }); return;
  }
  if (resource === "connections") {
    if (command === 'message' && rest.length === 2 && /^con_[a-f0-9]{32}$/.test(rest[0]) && /^[A-Za-z0-9_-]{1,128}$/.test(rest[1])) {
      writeResult(await apiRequest(`/connections/${rest[0]}/mail/${rest[1]}`, {}, { retryable: true })); return;
    }
    if (command === 'task' && rest.length === 1 && /^con_[a-f0-9]{32}$/.test(rest[0])) {
      writeResult(await apiRequest(`/connections/${rest[0]}/tasks`, { method: 'POST', body: JSON.stringify(readInputObject(parsed.options.get('--input'))) })); return;
    }
    if (['source', 'reply', 'reply-save'].includes(command) && rest.length === 2 && /^wsp_[a-f0-9]{32}$/.test(rest[0]) && /^[A-Za-z0-9_-]{1,128}$/.test(rest[1])) {
      const path = `/connections/task-sources/${rest[0]}/${rest[1]}${command === 'source' ? '' : '/reply'}`;
      writeResult(await apiRequest(path, command === 'reply-save' ? { method: 'POST', body: JSON.stringify(readInputObject(parsed.options.get('--input'))) } : {})); return;
    }
    if (command === "list" && rest.length === 0) { writeResult(await apiRequest("/connections", {}, { retryable: true })); return; }
    if (command === "begin" && rest.length === 0) {
      const input = readInputObject(parsed.options.get("--input"));
      writeResult(await apiRequest("/connections", { method: "POST", body: JSON.stringify(input) })); return;
    }
    if ((command === "action" || command === "mail") && rest.length === 1 && /^con_[a-f0-9]{32}$/.test(rest[0])) {
      const path = `/connections/${rest[0]}`;
      const cursor = parsed.options.get("--cursor");
      if (cursor !== undefined && (!cursor || cursor.length > 4096 || !/^gm3\.[A-Za-z0-9_-]+$/.test(cursor))) throw new CliError("usage_error", "Use the bounded nextCursor returned by configured Gmail Mail, or omit --cursor for the first page.", 2);
      const folderId = parsed.options.get("--folder");
      if (folderId !== undefined && !/^[A-Za-z0-9_-]{1,128}:folder:[A-Za-z0-9_-]{1,128}$/.test(folderId)) throw new CliError("usage_error", "Use an account-qualified folder ID returned by this Gmail Mail account.", 2);
      const search = parsed.options.get("--search");
      if (search !== undefined && (search.length > 512 || !search.trim() || /[\u0000-\u001f\u007f]/.test(search))) throw new CliError("usage_error", "Use a nonempty Gmail query of at most 512 characters without control characters, or omit --search.", 2);
      const query = new URLSearchParams(); if (parsed.options.has('--metadata-only')) query.set('view', 'metadata'); if (cursor !== undefined) query.set('cursor', cursor); if (folderId !== undefined) query.set('folderId', folderId); if (search !== undefined) query.set('search', search.trim());
      const mailPath = `${path}/mail${query.size ? `?${query}` : ""}`;
      writeResult(await apiRequest(command === "mail" ? mailPath : path, command === "mail" ? {} : { method: "POST", body: JSON.stringify(readInputObject(parsed.options.get("--input"))) })); return;
    }
    throw new CliError("usage_error", "Use connections list | begin --input <json-file> | action <id> --input <json-file> | mail <id> [--metadata-only] | message <id> <upstream-message-id> | task <id> --input <json-file> | source/reply <workspace-id> <task-id> | reply-save <workspace-id> <task-id> --input <json-file>. Configured Google consent uses the browser. Normal Connections remain unconfigured.", 2);
  }
  if (resource === "workspace" && command === "providers" && rest.length === 0) {
    const query = new URLSearchParams();
    for (const [option, key, maximum] of [["--account", "accountId", 128], ["--cursor", "cursor", 4096]]) {
      const value = parsed.options.get(String(option));
      if (value !== undefined) {
        if (typeof value !== "string" || !value || value.length > Number(maximum) || (key === "accountId" ? !/^[A-Za-z0-9_-]+$/.test(value) : !/^[\x21-\x7e]+$/.test(value))) throw new CliError("usage_error", "Use a bounded provider account ID and opaque cursor.", 2);
        query.set(String(key), value);
      }
    }
    const response = /** @type {import("./openapi-types.ts").ProviderPreviewResponse} */ (await apiRequest(`/workspace/provider-preview${query.size ? `?${query}` : ""}`, {}, { retryable: true, quiet: parsed.options.has("--quiet") }));
    writeResult(response); return;
  }
  if (resource === "workspace" && command === "agent" && rest[0] === "grant" && rest.length === 1) {
    const prepared = preparePersonalAgentGrant(parsed.options);
    let response;
    try { response = /** @type {import("./openapi-types.ts").CreatePersonalAgentGrantResponse} */ (await apiRequest("/workspace/agent-grants", { method: "POST", body: JSON.stringify(prepared.body) })); }
    catch (error) {
      if (!(error instanceof CliError) || !["service_unavailable", "invalid_response"].includes(error.code) && error.exitStatus !== 8) throw error;
      throw new CliError("agent_grant_uncertain", "Personal grant issuance could not be confirmed. Inspect openjob workspace agent list and revoke uncertain grants before retrying. No automatic retry was made.", 8);
    }
    writeResult({ data: deliverPersonalAgentGrant(response, prepared) });
    return;
  }
  if (resource === "workspace" && command === "agent" && rest[0] === "list" && rest.length === 1) {
    const response = /** @type {import("./openapi-types.ts").ListPersonalAgentGrantsResponse} */ (await apiRequest("/workspace/agent-grants", {}, { retryable: true, quiet: parsed.options.has("--quiet") }));
    if (!Array.isArray(response?.data)) throw new CliError("invalid_response", "Invalid personal grant list.", 8);
    writeResult({ data: response.data.map(publicPersonalAgent) }); return;
  }
  if (resource === "workspace" && command === "agent" && rest[0] === "revoke" && rest.length === 2) {
    const id = rest[1];
    if (!/^agt_[a-f0-9]{32}$/.test(id)) throw new CliError("usage_error", "Use a personal Agent ID returned by openjob workspace agent list.", 2);
    await confirmDestructiveAction(`Revoke personal agent ${id}?`, "Non-interactive personal agent revocation requires --yes.", parsed.options);
    await apiRequest(`/workspace/agent-grants/${id}`, { method: "DELETE" });
    writeResult({ data: { id, revoked: true } }); return;
  }
  if (resource === "workspace" && command === "snapshot" && rest.length === 0) {
    const response = /** @type {PersonalWorkspaceSnapshotResponse} */ (await apiRequest("/workspace/snapshot", {}, { retryable: true, quiet: parsed.options.has("--quiet") }));
    writeResult(response);
    return;
  }
  if (resource === "workspace" && command === "command" && rest.length === 0) {
    const path = parsed.options.get("--input");
    if (typeof path !== "string" || !path) throw new CliError("usage_error", "workspace command requires --input <path|->.", 2);
    const input = readInputObject(path);
    /** @type {Record<string, string[]>} */
    const fields = {
      "task.create": ["type", "title", "messageId"], "task.update": ["type", "taskId", "title"], "task.notes": ["type", "taskId", "notes"],
      "task.complete": ["type", "taskId", "completed"], "task.schedule": ["type", "taskId", "calendarId", "start", "end"],
      "task.schedule-available": ["type", "taskId", "calendarId", "start", "end"],
      "task.unschedule": ["type", "taskId"], "task.delete": ["type", "taskId"],
      "calendar.create": ["type", "calendarId", "title", "start", "end"],
      "calendar.update": ["type", "eventId", "title", "start", "end"], "calendar.delete": ["type", "eventId"],
      "calendar.import": ["type", "calendarId", "ical", "expectedRevision"],
      "mail.examples.add": ["type"], "mail.read": ["type", "messageId", "read"],
      "mail.draft": ["type", "messageId", "body"], "mail.compose": ["type", "accountId", "to", "subject", "body"],
      "mail.draft.update": ["type", "draftId", "to", "subject", "body"], "mail.simulate-send": ["type", "draftId"],
      "mail.send": ["type", "draftId"],
    };
    const type = input.type;
    if (typeof type !== "string" || !Object.hasOwn(fields, type) || fields[type].some(key => !(type === "task.create" && key === "messageId") && !Object.hasOwn(input, key)) || Object.keys(input).some(key => !fields[type].includes(key)) || Buffer.byteLength(JSON.stringify(input)) > 262144) {
      throw new CliError("input_invalid", "Use one bounded personal workspace command with exactly its documented fields.", 2);
    }
    for (const field of fields[type]) {
      if (type === "task.create" && field === "messageId" && input[field] === undefined) continue;
      if (["completed", "read"].includes(field) ? typeof input[field] !== "boolean" : typeof input[field] !== "string" || field !== "notes" && !input[field].trim() || (field === "notes" ? [...input[field]].length : input[field].length) > (["body", "notes"].includes(field) ? 20000 : field === "ical" ? 16384 : 500)) {
        throw new CliError("input_invalid", "One or more personal workspace command fields are invalid.", 2);
      }
    }
    if (type === "calendar.import") {
      try { if (!/^ci1_[a-f0-9]{64}$/.test(input.expectedRevision)) throw new Error(); parseCalendarIcal(input.ical); }
      catch { throw new CliError("input_invalid", "Use a supported bounded iCalendar file and its reviewed calendar revision.", 2); }
    }
    const body = /** @type {PersonalWorkspaceCommandRequest} */ (input);
    const response = /** @type {PersonalWorkspaceCommandResponse} */ (await apiRequest("/workspace/commands", { method: "POST", body: JSON.stringify(body) }));
    writeResult(response);
    return;
  }
  if (resource === "group" && command === "current" && rest.length === 0) {
    writeResult({ data: resolveGroup(parsed.options) });
    return;
  }
  if (resource === "auth" && command === "status" && rest.length === 0) {
    const currentUser = await selectedIdentity();
    writeResult(
      {
        data: {
          signedIn: true,
          userId: currentUser.data.userId,
          username: currentUser.data.username,
          usernameRequired: currentUser.data.usernameRequired,
        },
      },
    );
    return;
  }
  if (resource === "auth" && command === "login" && rest.length === 0) {
    const candidate = await loginWithGoogle(
      {
        openBrowser: !parsed.options.has("--no-open"),
      },
      process.env,
      profile,
    );
    const currentUser = /** @type {CurrentUserResponse} */ (
      await apiRequestWithIdToken("/me", {}, candidate.idToken)
    );
    assertSelectedIdentity(currentUser, profile);
    await writeRefreshCredential(
      candidate.refreshToken,
      process.env,
      profile,
    );
    writeResult(currentUser);
    return;
  }
  if (resource === "auth" && command === "logout" && rest.length === 0) {
    await confirmDestructiveAction(
      "Remove the stored OpenJob credential?",
      "Non-interactive logout requires --yes.",
      parsed.options,
    );
    await deleteRefreshCredential(process.env, profile);
    writeResult({ data: { signedIn: false } });
    return;
  }
  if (resource === "user" && command === "show" && rest.length === 0) {
    writeResult(await selectedIdentity());
    return;
  }
  if (resource === "username" && command === "claim") {
    const body = usernameMutationBody(rest, parsed.options);
    writeResult(
      /** @type {ClaimUsernameResponse} */ (await apiRequest("/me/username", {
        method: "PUT",
        body: JSON.stringify(body),
      })),
    );
    return;
  }
  if (resource === "agent" && command === "grant" && rest.length === 0) {
    const prepared = prepareAgentGrant(parsed.options);
    /** @type {CreateAgentGrantResponse} */
    let issued;
    try {
      issued = /** @type {CreateAgentGrantResponse} */ (await apiRequest(
        "/agent-grants", { method: "POST", body: JSON.stringify(prepared.body) },
      ));
    } catch (error) {
      if (error instanceof CliError && error.exitStatus !== 8) throw error;
      throw new CliError("agent_grant_uncertain", "Grant issuance could not be confirmed. Inspect openjob agent list and revoke any uncertain grant before retrying. No automatic retry was made.", 8);
    }
    writeResult({ data: deliverAgentGrant(issued, prepared) });
    return;
  }
  if (resource === "agent" && command === "list" && rest.length === 0) {
    writeResult(/** @type {ListAgentGrantsResponse} */ (await apiRequest(
      "/agent-grants", {}, { retryable: true, quiet: parsed.options.has("--quiet") },
    )));
    return;
  }
  if (resource === "agent" && command === "revoke" && rest.length === 1) {
    const agentId = rest[0];
    if (!/^agt_[a-f0-9]{32}$/.test(agentId)) {
      throw new CliError("usage_error", "Use an Agent ID returned by openjob agent list.", 2);
    }
    await confirmDestructiveAction(
      `Revoke agent grant ${agentId}?`,
      "Non-interactive agent revocation requires --yes.",
      parsed.options,
    );
    await apiRequest(`/agent-grants/${encodeURIComponent(agentId)}`, { method: "DELETE" });
    writeResult({ data: { agentId, revoked: true } });
    return;
  }
  if (resource === "group" && command === "list" && rest.length === 0) {
    writeResult(/** @type {ListGroupsResponse} */ (await apiCollection("/groups")));
    return;
  }
  if (resource === "task" && command === "list" && rest.length === 0) {
    const { groupId } = resolveGroup(parsed.options);
    const status = parsed.options.get("--status") || "open";
    if (!new Set(["open", "done", "all"]).has(status)) {
      throw new CliError("usage_error", "--status must be open, done, or all.", 2);
    }
    const assigneeOption = parsed.options.get("--assignee") || "all";
    const assignee = assigneeOption.startsWith("@")
      ? assigneeOption.slice(1)
      : assigneeOption;
    const limitOption = parsed.options.get("--limit");
    const limit = limitOption === undefined ? undefined : Number(limitOption);
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) {
      throw new CliError("usage_error", "--limit must be a positive integer.", 2);
    }
    const parameters = new URLSearchParams({ status });
    if (assignee !== "all") parameters.set("assignee", assignee);
    const path = `/groups/${encodeURIComponent(groupId)}/tasks?${parameters}`;
    writeResult(
      /** @type {ListTasksResponse} */ (await apiCollection(path, {
        limit,
        quiet: parsed.options.has("--quiet"),
      })),
    );
    return;
  }
  if (resource === "task" && command === "create" && rest.length === 0) {
    const body = /** @type {CreateTaskRequest} */ (
      taskMutationBody("create", parsed.options)
    );
    const { groupId } = resolveGroup(parsed.options);
    writeResult(
      /** @type {CreateTaskResponse} */ (await apiRequest(
        `/groups/${encodeURIComponent(groupId)}/tasks`, {
        method: "POST",
        body: JSON.stringify(body),
      })),
    );
    return;
  }
  if (resource === "task" && command === "show" && rest.length === 1) {
    const { groupId } = resolveGroup(parsed.options);
    writeResult(
      /** @type {GetTaskResponse} */ (await apiRequest(
        `/groups/${encodeURIComponent(groupId)}/tasks/${encodeURIComponent(rest[0])}`,
        {},
        { retryable: true, quiet: parsed.options.has("--quiet") },
      )),
    );
    return;
  }
  if (resource === "task" && command === "edit" && rest.length === 1) {
    const body = /** @type {UpdateTaskRequest} */ (
      taskMutationBody("edit", parsed.options)
    );
    const { groupId } = resolveGroup(parsed.options);
    writeResult(
      /** @type {UpdateTaskResponse} */ (await apiRequest(
        `/groups/${encodeURIComponent(groupId)}/tasks/${encodeURIComponent(rest[0])}`,
        { method: "PATCH", body: JSON.stringify(body) },
      )),
    );
    return;
  }
  if (
    resource === "task" &&
    new Set(["done", "reopen"]).has(command) &&
    rest.length === 1
  ) {
    const { groupId } = resolveGroup(parsed.options);
    const body = /** @satisfies {SetTaskStateRequest} */ ({
      state: command === "done" ? "done" : "open",
    });
    writeResult(
      /** @type {SetTaskStateResponse} */ (await apiRequest(
        `/groups/${encodeURIComponent(groupId)}/tasks/${encodeURIComponent(rest[0])}/state`,
        {
          method: "PUT",
          body: JSON.stringify(body),
        },
        { retryable: true, quiet: parsed.options.has("--quiet") },
      )),
    );
    return;
  }
  if (resource === "task" && command === "delete" && rest.length === 1) {
    await confirmTaskDeletion(rest[0], parsed.options);
    const { groupId } = resolveGroup(parsed.options);
    await apiRequest(
      `/groups/${encodeURIComponent(groupId)}/tasks/${encodeURIComponent(rest[0])}`,
      { method: "DELETE" },
    );
    writeResult({ data: { taskId: rest[0], deleted: true } });
    return;
  }
  if (resource === "group" && command === "create" && rest.length === 0) {
    const body = /** @type {CreateGroupRequest} */ (
      groupNameMutationBody("create", parsed.options)
    );
    writeResult(
      /** @type {CreateGroupResponse} */ (await apiRequest("/groups", {
        method: "POST",
        body: JSON.stringify(body),
      })),
    );
    return;
  }
  if (resource === "group" && command === "show" && rest.length === 0) {
    const { groupId } = resolveGroup(parsed.options);
    writeResult(
      /** @type {GetGroupResponse} */ (
        await apiRequest(`/groups/${encodeURIComponent(groupId)}`)
      ),
    );
    return;
  }
  if (resource === "group" && command === "rename" && rest.length === 0) {
    const body = /** @type {RenameGroupRequest} */ (
      groupNameMutationBody("rename", parsed.options)
    );
    const { groupId } = resolveGroup(parsed.options);
    writeResult(
      /** @type {RenameGroupResponse} */ (await apiRequest(
        `/groups/${encodeURIComponent(groupId)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      })),
    );
    return;
  }
  if (resource === "group" && command === "leave" && rest.length === 0) {
    const { groupId } = resolveGroup(parsed.options);
    await confirmDestructiveAction(
      `Leave Group ${groupId}?`,
      "Non-interactive Group leaving requires --yes.",
      parsed.options,
    );
    await apiRequest(`/groups/${encodeURIComponent(groupId)}/actions/leave`, {
      method: "POST",
    });
    clearCurrentGroup(groupId, process.env, profile);
    writeResult({ data: { resource: "membership", groupId, deleted: true } });
    return;
  }
  if (resource === "group" && command === "end" && rest.length === 0) {
    const { groupId } = resolveGroup(parsed.options);
    let groupName;
    if (inputIsInteractive()) {
      const group = /** @type {GetGroupResponse} */ (await apiRequest(
        `/groups/${encodeURIComponent(groupId)}`,
        {},
        { retryable: true, quiet: parsed.options.has("--quiet") },
      ));
      groupName = group.data.name;
    }
    const confirmationName = await confirmGroupEnd(groupName, parsed.options);
    const body = /** @satisfies {EndGroupRequest} */ ({ confirmationName });
    await apiRequest(`/groups/${encodeURIComponent(groupId)}/actions/end`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    clearCurrentGroup(groupId, process.env, profile);
    writeResult({ data: { resource: "group", groupId, deleted: true } });
    return;
  }
  if (resource === "member" && command === "list" && rest.length === 0) {
    const { groupId } = resolveGroup(parsed.options);
    writeResult(
      /** @type {ListMembersResponse} */ (await apiCollection(
        `/groups/${encodeURIComponent(groupId)}/members`,
        { quiet: parsed.options.has("--quiet") },
      )),
    );
    return;
  }
  if (
    resource === "member" &&
    new Set(["kick", "promote", "demote"]).has(command) &&
    rest.length === 1
  ) {
    const { groupId } = resolveGroup(parsed.options);
    const username = rest[0].replace(/^@/, "");
    if (new Set(["kick", "demote"]).has(command)) {
      await confirmDestructiveAction(
        `${command === "kick" ? "Kick" : "Demote"} @${username}?`,
        `Non-interactive Member ${command} requires --yes.`,
        parsed.options,
      );
    }
    const member = await memberByUsername(
      groupId,
      username,
      parsed.options,
      apiCollection,
    );
    const result = /** @type {PromoteMemberResponse | DemoteMemberResponse | null} */ (
      await apiRequest(
      `/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(member.userId)}/actions/${command}`,
      { method: "POST" },
      )
    );
    writeResult(
      command === "kick"
        ? {
            data: {
              resource: "membership",
              groupId,
              userId: member.userId,
              username: member.username,
              deleted: true,
            },
          }
        : result,
    );
    return;
  }
  if (resource === "ban" && command === "list" && rest.length === 0) {
    const { groupId } = resolveGroup(parsed.options);
    writeResult(
      /** @type {ListBansResponse} */ (await apiCollection(
        `/groups/${encodeURIComponent(groupId)}/bans`,
        { quiet: parsed.options.has("--quiet") },
      )),
    );
    return;
  }
  if (resource === "ban" && command === "add" && rest.length === 0) {
    const username = parsed.options.get("--username");
    const selectedUserId = parsed.options.get("--user-id");
    const inputPath = parsed.options.get("--input");
    const inputModes = ["--username", "--user-id", "--input"].filter((option) =>
      parsed.options.has(option),
    );
    if (inputModes.length !== 1) {
      throw new CliError(
        "usage_error",
        "ban add requires exactly one of --username, --user-id, or --input.",
        2,
      );
    }
    const { groupId } = resolveGroup(parsed.options);
    await confirmDestructiveAction(
      `Ban ${username ? `@${username.replace(/^@/, "")}` : selectedUserId ?? "the input User"}?`,
      "Non-interactive banning requires --yes.",
      parsed.options,
    );
    const body = /** @type {BanUserRequest} */ (inputPath
      ? readInputObject(inputPath)
      : {
          userId: username
            ? (
                await memberByUsername(
                  groupId,
                  username,
                  parsed.options,
                  apiCollection,
                )
              ).userId
            : selectedUserId,
        });
    writeResult(
      /** @type {BanUserResponse} */ (await apiRequest(
        `/groups/${encodeURIComponent(groupId)}/bans/actions/ban`, {
        method: "POST",
        body: JSON.stringify(body),
      })),
    );
    return;
  }
  if (resource === "ban" && command === "remove" && rest.length === 1) {
    const { groupId } = resolveGroup(parsed.options);
    const userId = rest[0];
    await apiRequest(
      `/groups/${encodeURIComponent(groupId)}/bans/${encodeURIComponent(userId)}/actions/unban`,
      { method: "POST" },
    );
    writeResult({ data: { resource: "ban", groupId, userId, deleted: true } });
    return;
  }
  if (resource === "invite" && command === "show" && rest.length === 0) {
    const { groupId } = resolveGroup(parsed.options);
    writeResult(
      /** @type {GetInviteLinkResponse} */ (await apiRequest(
        `/groups/${encodeURIComponent(groupId)}/invite-link`,
        {},
        { retryable: true, quiet: parsed.options.has("--quiet") },
      )),
    );
    return;
  }
  if (resource === "invite" && command === "rotate" && rest.length === 0) {
    const { groupId } = resolveGroup(parsed.options);
    await confirmDestructiveAction(
      `Rotate the Invite Link for Group ${groupId}?`,
      "Non-interactive Invite Link rotation requires --yes.",
      parsed.options,
    );
    writeResult(
      /** @type {RotateInviteLinkResponse} */ (await apiRequest(
        `/groups/${encodeURIComponent(groupId)}/invite-link/actions/rotate`,
        { method: "POST" },
      )),
    );
    return;
  }
  if (
    resource === "invite" &&
    new Set(["inspect", "join"]).has(command) &&
    rest.length === 1
  ) {
    const token = inviteToken(rest[0]);
    const action = command === "join" ? "/actions/join" : "";
    writeResult(
      /** @type {InspectInviteResponse | JoinInviteResponse} */ (await apiRequest(
        `/invites/${encodeURIComponent(token)}${action}`,
        command === "join" ? { method: "POST" } : {},
        { retryable: true, quiet: parsed.options.has("--quiet") },
      )),
    );
    return;
  }
  if (resource === "group" && command === "use" && rest.length === 1) {
    const groupId = rest[0];
    await apiRequest(`/groups/${encodeURIComponent(groupId)}`);
    writeCurrentGroup(groupId, process.env, profile);
    writeResult({ data: { groupId, source: "config" } });
    return;
  }
  throw new CliError("usage_error", "Unknown command. Run openjob --help.", 2);
}

const raw = process.argv.slice(2);
try {
  if (raw[0] !== "app" && raw[0] !== "updates" && process.stderr.isTTY) await automaticUpdateNotice(packageJson);
  await main(raw);
} catch (error) {
  let format = "table";
  try {
    format = outputFormat(parseArguments(raw).options);
  } catch {}
  try {
    clearConcealedConfigGroup(raw, error);
  } catch (clearError) {
    error = clearError;
  }
  reportError(error, format);
}
