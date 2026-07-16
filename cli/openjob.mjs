#!/usr/bin/env node

import { parseArguments } from "./lib/arguments.mjs";
import { apiCollection, apiRequest, apiRequestWithIdToken } from "./lib/api.mjs";
import { loginWithGoogle } from "./lib/auth.mjs";
import { resolveGroup, writeCurrentGroup } from "./lib/config.mjs";
import { deleteRefreshCredential } from "./lib/credential-store.mjs";
import { CliError, reportError } from "./lib/errors.mjs";
import { readInputObject } from "./lib/input.mjs";
import { outputFormat, preflightOutput, writeEnvelope } from "./lib/output.mjs";

const VERSION = "0.0.5";

const HELP = `OpenJob

Usage:
  openjob [global options] <resource> <command> [arguments]

Resources:
  auth       Sign in, inspect authentication, or sign out
  user       Show the current User
  username   Claim the current User's immutable Username
  group      List, create, select, or inspect Groups
  task       List and manage Tasks

Global options:
  --group <group-id>          Override the client-local current Group
  --format <table|json|jsonl> Output encoding; default: table
  --out <path|->              Write results to a new file or stdout (-)
  --force                     Allow --out to replace an existing file
  --quiet                     Suppress nonessential diagnostics
  --help                      Show help
  --version                   Show the version`;

const RESOURCE_HELP = {
  auth: `Usage:
  openjob auth login [--no-open]
  openjob auth status
  openjob auth logout`,
  user: `Usage:
  openjob user show`,
  username: `Usage:
  openjob username claim <username>`,
  group: `Usage:
  openjob group list
  openjob group create --name <name> | --input <path|->
  openjob group show [--group <group-id>]
  openjob group use <group-id>
  openjob group current`,
  task: `Usage:
  openjob task list [--status <open|done|all>] [--assignee <username|unassigned|all>] [--limit <count>]`,
};

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
  const format = outputFormat(parsed.options);
  preflightOutput(parsed.options);
  const writeResult = (envelope) => writeEnvelope(envelope, format, parsed.options);
  const [resource, command, ...rest] = parsed.positionals;
  if (resource === "group" && command === "current" && rest.length === 0) {
    writeResult({ data: resolveGroup(parsed.options) });
    return;
  }
  if (resource === "auth" && command === "status" && rest.length === 0) {
    const currentUser = await apiRequest("/me");
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
    const currentUser = await apiRequestWithIdToken("/me", {}, idToken);
    writeResult(currentUser);
    return;
  }
  if (resource === "auth" && command === "logout" && rest.length === 0) {
    await deleteRefreshCredential();
    writeResult({ data: { signedIn: false } });
    return;
  }
  if (resource === "user" && command === "show" && rest.length === 0) {
    writeResult(await apiRequest("/me"));
    return;
  }
  if (resource === "username" && command === "claim" && rest.length === 1) {
    const username = rest[0].startsWith("@") ? rest[0].slice(1) : rest[0];
    writeResult(
      await apiRequest("/me/username", {
        method: "PUT",
        body: JSON.stringify({ username }),
      }),
    );
    return;
  }
  if (resource === "group" && command === "list" && rest.length === 0) {
    writeResult(await apiCollection("/groups"));
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
    writeResult(await apiCollection(path, { limit }));
    return;
  }
  if (resource === "group" && command === "create" && rest.length === 0) {
    const name = parsed.options.get("--name");
    const inputPath = parsed.options.get("--input");
    if ((!name && !inputPath) || (name && inputPath)) {
      throw new CliError(
        "usage_error",
        "group create requires exactly one of --name or --input.",
        2,
      );
    }
    const body = inputPath ? readInputObject(inputPath) : { name };
    writeResult(
      await apiRequest("/groups", { method: "POST", body: JSON.stringify(body) }),
    );
    return;
  }
  if (resource === "group" && command === "show" && rest.length === 0) {
    const { groupId } = resolveGroup(parsed.options);
    writeResult(await apiRequest(`/groups/${encodeURIComponent(groupId)}`));
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

try {
  await main(process.argv.slice(2));
} catch (error) {
  let format = "table";
  try {
    format = outputFormat(parseArguments(process.argv.slice(2)).options);
  } catch {}
  reportError(error, format);
}
