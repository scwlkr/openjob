#!/usr/bin/env node
// @ts-check

import { parseArguments } from "./lib/arguments.mjs";
import { apiCollection, apiRequest, apiRequestWithIdToken } from "./lib/api.mjs";
import { loginWithGoogle } from "./lib/auth.mjs";
import {
  confirmDestructiveAction,
  confirmGroupEnd,
  confirmTaskDeletion,
  inputIsInteractive,
} from "./lib/confirmation.mjs";
import { clearCurrentGroup, resolveGroup, writeCurrentGroup } from "./lib/config.mjs";
import { deleteRefreshCredential } from "./lib/credential-store.mjs";
import { CliError, reportError } from "./lib/errors.mjs";
import { readInputObject, readTextSource } from "./lib/input.mjs";
import { outputFormat, preflightOutput, writeEnvelope } from "./lib/output.mjs";
import packageJson from "./package.json" with { type: "json" };

/** @typedef {Map<string, string>} CommandOptions */
/** @typedef {import("./openapi-types.ts").CurrentUserResponse} CurrentUserResponse */
/** @typedef {import("./openapi-types.ts").ClaimUsernameRequest} ClaimUsernameRequest */
/** @typedef {import("./openapi-types.ts").ClaimUsernameResponse} ClaimUsernameResponse */
/** @typedef {import("./openapi-types.ts").ListGroupsResponse} ListGroupsResponse */
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
const OUTPUT_OPTIONS = ["--format", "--force", "--out", "--quiet"];
const GROUP_SCOPED_OPTIONS = [...OUTPUT_OPTIONS, "--group"];
const TASK_COMMON_OPTIONS = GROUP_SCOPED_OPTIONS;
const TASK_FIELD_OPTIONS = ["--text", "--text-file", "--assignee", "--priority", "--due"];
const TASK_OPTIONS = new Map([
  ["list", new Set([...TASK_COMMON_OPTIONS, "--status", "--assignee", "--limit"])],
  ["create", new Set([...TASK_COMMON_OPTIONS, "--input", ...TASK_FIELD_OPTIONS])],
  ["show", new Set(TASK_COMMON_OPTIONS)],
  ["edit", new Set([...TASK_COMMON_OPTIONS, "--input", ...TASK_FIELD_OPTIONS])],
  ["done", new Set(TASK_COMMON_OPTIONS)],
  ["reopen", new Set(TASK_COMMON_OPTIONS)],
  ["delete", new Set([...TASK_COMMON_OPTIONS, "--yes"])],
]);
const COMMAND_OPTIONS = new Map([
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

process.once("SIGINT", () => process.exit(130));

const HELP = `OpenJob

Usage:
  openjob [global options] <resource> <command> [arguments]

Resources:
  auth       Sign in, inspect authentication, or sign out
  user       Show the current User
  username   Claim the current User's immutable Username
  group      List, create, select, inspect, rename, leave, or end Groups
  member     List Members and govern membership or Admin status
  ban        List, add, or remove Group-scoped bans
  invite     Inspect, join through, show, or rotate Invite Links
  task       List and manage Tasks

Global options:
  --group <group-id>          Override the client-local current Group
  --format <table|json|jsonl> Output encoding; default: table
  --out <path|->              Write results to a new file or stdout (-)
  --force                     Allow --out to replace an existing file
  --yes                       Confirm a destructive operation
  --quiet                     Suppress nonessential diagnostics
  --help                      Show help
  --version                   Show the version`;

/** @type {Record<string, string>} */
const RESOURCE_HELP = {
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
  openjob task list [--status <open|done|all>] [--assignee <username|unassigned|all>] [--limit <count>]
  openjob task create (--text <text> | --text-file <path|->) --assignee <username> [--priority <high|normal|low>] [--due <YYYY-MM-DD>]
  openjob task create --input <path|->
  openjob task show <task-id>
  openjob task edit <task-id> [--text <text> | --text-file <path|->] [--assignee <username>] [--priority <high|normal|low>] [--due <YYYY-MM-DD|none>]
  openjob task edit <task-id> --input <path|->
  openjob task done <task-id>
  openjob task reopen <task-id>
  openjob task delete <task-id> [--yes]`,
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
    if (!allowed.has(option)) {
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
  const selected = resolveGroup(parsed.options);
  if (selected.source === "config") clearCurrentGroup(selected.groupId);
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

/** @param {string} groupId @param {string} rawUsername @param {CommandOptions} options */
async function memberByUsername(groupId, rawUsername, options) {
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
  validateCommandOptions(resource, command, parsed.options);
  const format = outputFormat(parsed.options);
  preflightOutput(parsed.options);
  /** @param {unknown} envelope */
  const writeResult = (envelope) => writeEnvelope(envelope, format, parsed.options);
  if (resource === "group" && command === "current" && rest.length === 0) {
    writeResult({ data: resolveGroup(parsed.options) });
    return;
  }
  if (resource === "auth" && command === "status" && rest.length === 0) {
    const currentUser = /** @type {CurrentUserResponse} */ (await apiRequest("/me"));
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
    const idToken = await loginWithGoogle({
      openBrowser: !parsed.options.has("--no-open"),
    });
    const currentUser = /** @type {CurrentUserResponse} */ (
      await apiRequestWithIdToken("/me", {}, idToken)
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
    await deleteRefreshCredential();
    writeResult({ data: { signedIn: false } });
    return;
  }
  if (resource === "user" && command === "show" && rest.length === 0) {
    writeResult(/** @type {CurrentUserResponse} */ (await apiRequest("/me")));
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
    clearCurrentGroup(groupId);
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
    clearCurrentGroup(groupId);
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
    const member = await memberByUsername(groupId, username, parsed.options);
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
            ? (await memberByUsername(groupId, username, parsed.options)).userId
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
    writeCurrentGroup(groupId);
    writeResult({ data: { groupId, source: "config" } });
    return;
  }
  throw new CliError("usage_error", "Unknown command. Run openjob --help.", 2);
}

const raw = process.argv.slice(2);
try {
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
