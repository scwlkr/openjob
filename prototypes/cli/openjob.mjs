#!/usr/bin/env node

import {
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

const ROOT_HELP = `OpenJob CLI contract prototype (no network requests)

Usage:
  openjob [global options] <resource> <command> [arguments]
  openjob help [resource]
  openjob demo

Resources:
  auth       Sign in, inspect the signed-in User, or sign out
  user       Show the current User
  username   Claim the current User's immutable Username
  group      List, create, select, inspect, rename, leave, or end Groups
  member     List Members and govern membership or Admin status
  ban        List, add, or remove Group-scoped bans
  invite     Inspect, join through, show, or rotate Invite Links
  task       List, create, inspect, edit, complete, reopen, or delete Tasks

Global options:
  --group <group-id>          Override the client-local current Group
  --format <table|json|jsonl> Output encoding; default: table
  --out <path|->              Write results to a new file or stdout (-)
  --force                     Allow --out to replace an existing file
  --yes                       Confirm a destructive operation
  --no-color                  Disable decorative color
  --quiet                     Suppress nonessential diagnostics
  --help                      Show help
  --version                   Show the version

Run "openjob help <resource>" for the complete resource surface.
Run "openjob demo" for a representative workflow.`;

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
  openjob ban add (--username <username> | --user-id <user-id>) [--yes]
  openjob ban remove <user-id>`,
  invite: `Usage:
  openjob invite show
  openjob invite rotate [--yes]
  openjob invite inspect <token-or-url>
  openjob invite join <token-or-url>`,
  task: `Usage:
  openjob task list [--status <open|done|all>] [--assignee <username|unassigned|all>] [--limit <count>]
  openjob task create (--text <text> | --text-file <path|->) --assignee <username> [--due <YYYY-MM-DD>]
  openjob task create --input <path|->
  openjob task show <task-id>
  openjob task edit <task-id> [--text <text> | --text-file <path|->] [--assignee <username>] [--due <YYYY-MM-DD|none>]
  openjob task edit <task-id> --input <path|->
  openjob task done <task-id>
  openjob task reopen <task-id>
  openjob task delete <task-id> [--yes]`,
};

const COMMANDS = Object.fromEntries(
  Object.entries({
    auth: ["login", "status", "logout"],
    user: ["show"],
    username: ["claim"],
    group: ["list", "create", "show", "use", "current", "rename", "leave", "end"],
    member: ["list", "kick", "promote", "demote"],
    ban: ["list", "add", "remove"],
    invite: ["show", "rotate", "inspect", "join"],
    task: ["list", "create", "show", "edit", "done", "reopen", "delete"],
  }).map(([resource, commands]) => [resource, new Set(commands)]),
);

const VALUE_OPTIONS = new Set([
  "--assignee",
  "--confirm-name",
  "--due",
  "--format",
  "--group",
  "--input",
  "--limit",
  "--name",
  "--out",
  "--status",
  "--text",
  "--text-file",
  "--user-id",
  "--username",
]);

const BOOLEAN_OPTIONS = new Set([
  "--force",
  "--help",
  "--no-color",
  "--no-open",
  "--quiet",
  "--version",
  "--yes",
]);

const DEMO = `$ openjob auth login
Opening Google sign-in in your browser...            # stderr
USERNAME  USER_ID
scwlkr    usr_01

$ openjob group list
ID        NAME          ROLE
grp_ops   Field Ops     admin
grp_shop  Shop Projects member

$ openjob group use grp_ops
CURRENT_GROUP_ID
grp_ops

$ openjob task list --status open
ID       STATE  ASSIGNEE  DUE         TEXT
tsk_101  open   scwlkr    2026-07-18  Confirm Friday crew
tsk_102  open   unassigned            Replace bay light

$ printf '%s\\n' '{"text":"Order filters","assigneeUsername":"scwlkr"}' \\
    | openjob task create --input - --format json
{
  "data": {
    "id": "tsk_new",
    "state": "open",
    "assignee": {
      "state": "assigned",
      "userId": "usr_01",
      "username": "scwlkr"
    },
    "dueDate": null,
    "text": "Order filters"
  }
}

$ openjob task delete tsk_101 --yes --format json --out deleted.json
# stdout is empty because the result was written atomically to deleted.json`;

function parseArguments(raw) {
  const positionals = [];
  const options = new Map();

  for (let index = 0; index < raw.length; index += 1) {
    const token = raw[index];
    if (VALUE_OPTIONS.has(token)) {
      const value = raw[index + 1];
      if (value === undefined || value.startsWith("--")) {
        fail("usage_error", `${token} requires a value`, 2);
      }
      options.set(token, value);
      index += 1;
      continue;
    }
    if (BOOLEAN_OPTIONS.has(token)) {
      options.set(token, true);
      continue;
    }
    if (token.startsWith("--")) {
      fail("usage_error", `unknown option ${token}`, 2);
    }
    positionals.push(token);
  }

  return { options, positionals };
}

function fail(code, message, exitCode, format = "table") {
  if (format === "json" || format === "jsonl") {
    process.stderr.write(`${JSON.stringify({ error: { code, message } })}\n`);
  } else {
    process.stderr.write(`openjob: ${code}: ${message}\n`);
  }
  process.exit(exitCode);
}

function readSource(source, kind) {
  try {
    return source === "-" ? readFileSync(0, "utf8") : readFileSync(source, "utf8");
  } catch (error) {
    fail("input_error", `cannot read ${kind} from ${source}: ${error.message}`, 2);
  }
}

function readJsonInput(source) {
  try {
    return JSON.parse(readSource(source, "JSON input"));
  } catch (error) {
    fail("input_error", `invalid JSON input: ${error.message}`, 2, "json");
  }
}

function renderTable(value) {
  const records = Array.isArray(value) ? value : [value];
  const rows = records.map((record) => {
    if (!record.assignee || typeof record.assignee !== "object") return record;
    return {
      id: record.id,
      state: record.state,
      assignee:
        record.assignee.state === "unassigned" ? "unassigned" : record.assignee.username,
      due: record.dueDate ?? "",
      text: record.text,
    };
  });
  if (rows.length === 0) return "";

  const keys = Object.keys(rows[0]);
  const cells = rows.map((row) => keys.map((key) => String(row[key] ?? "")));
  const widths = keys.map((key, index) =>
    Math.max(key.length, ...cells.map((row) => row[index].length)),
  );
  const line = (row) => row.map((cell, index) => cell.padEnd(widths[index])).join("  ").trimEnd();

  return [line(keys.map((key) => key.toUpperCase())), ...cells.map(line)].join("\n");
}

function renderResult(data, format) {
  if (format === "json") return JSON.stringify({ data }, null, 2);
  if (format === "jsonl") {
    const records = Array.isArray(data) ? data : [data];
    return records.map((record) => JSON.stringify(record)).join("\n");
  }
  return renderTable(data);
}

function writeResult(content, output, force) {
  const bytes = `${content}${content.endsWith("\n") ? "" : "\n"}`;
  if (!output || output === "-") {
    process.stdout.write(bytes);
    return;
  }

  const target = resolve(output);
  if (existsSync(target) && !force) {
    fail("output_exists", `${output} already exists; pass --force to replace it`, 2);
  }

  const temporary = resolve(dirname(target), `.${target.split("/").pop()}.${process.pid}.tmp`);
  try {
    writeFileSync(temporary, bytes, { encoding: "utf8", flag: "wx" });
    renameSync(temporary, target);
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    fail("output_error", `cannot write ${output}: ${error.message}`, 2);
  }
}

function sampleFor(resource, command, positionals, options) {
  if (resource === "task" && command === "list") {
    return [
      {
        id: "tsk_101",
        state: "open",
        assignee: {
          state: "assigned",
          userId: "usr_01",
          username: "scwlkr",
        },
        dueDate: "2026-07-18",
        text: "Confirm Friday crew",
      },
      {
        id: "tsk_102",
        state: "open",
        assignee: { state: "unassigned" },
        dueDate: null,
        text: "Replace bay light",
      },
    ];
  }

  if (resource === "task" && command === "create") {
    const input = options.has("--input") ? readJsonInput(options.get("--input")) : null;
    const directInputUsed = ["--text", "--text-file", "--assignee", "--due"].some((key) =>
      options.has(key),
    );
    if (input && directInputUsed) {
      fail("usage_error", "--input cannot be combined with task field flags", 2);
    }

    const textSources = ["--text", "--text-file"].filter((key) => options.has(key));
    if (!input && textSources.length !== 1) {
      fail("usage_error", "task create requires exactly one of --text, --text-file, or --input", 2);
    }

    const text = input
      ? input.text
      : options.has("--text-file")
        ? readSource(options.get("--text-file"), "Task text").replace(/\n$/, "")
        : options.get("--text");
    const assignee = input?.assigneeUsername ?? options.get("--assignee");
    if (!text || !assignee) {
      fail("usage_error", "task create requires text and an assignee Username", 2);
    }

    return {
      id: "tsk_new",
      state: "open",
      assignee: {
        state: "assigned",
        userId: "usr_01",
        username: String(assignee).replace(/^@/, ""),
      },
      dueDate: input?.dueDate ?? options.get("--due") ?? null,
      text,
    };
  }

  if (resource === "group" && command === "list") {
    return [
      { id: "grp_ops", name: "Field Ops", role: "admin" },
      { id: "grp_shop", name: "Shop Projects", role: "member" },
    ];
  }

  if (resource === "member" && command === "list") {
    return [
      { userId: "usr_01", username: "scwlkr", role: "admin" },
      { userId: "usr_02", username: "alex", role: "member" },
    ];
  }

  if (resource === "auth" && command === "login" && !options.has("--quiet")) {
    process.stderr.write("Opening Google sign-in in your browser...\n");
  }

  if (resource === "auth" || resource === "user" || resource === "username") {
    return { userId: "usr_01", username: positionals[2] ?? "scwlkr", authenticated: true };
  }

  return {
    status: "prototype",
    command: [resource, command, ...positionals.slice(2)].join(" "),
    groupId: options.get("--group") ?? "grp_ops",
  };
}

const raw = process.argv.slice(2);
if (raw.length === 0 || raw[0] === "help" || raw.includes("--help")) {
  const resource = raw[0] === "help" ? raw[1] : raw[0];
  process.stdout.write(`${RESOURCE_HELP[resource] ?? ROOT_HELP}\n`);
  process.exit(0);
}

if (raw.includes("--version")) {
  process.stdout.write("openjob prototype\n");
  process.exit(0);
}

if (raw[0] === "demo") {
  process.stdout.write(`${DEMO}\n`);
  process.exit(0);
}

const { options, positionals } = parseArguments(raw);
const [resource, command] = positionals;
const format = options.get("--format") ?? "table";
if (!new Set(["table", "json", "jsonl"]).has(format)) {
  fail("usage_error", `unknown format ${format}`, 2, format);
}
if (!COMMANDS[resource]?.has(command)) {
  fail("usage_error", `unknown command ${[resource, command].filter(Boolean).join(" ")}`, 2, format);
}

const destructive = new Set([
  "ban add",
  "group leave",
  "invite rotate",
  "member demote",
  "member kick",
  "task delete",
]);
if (destructive.has(`${resource} ${command}`) && !options.has("--yes")) {
  fail("confirmation_required", "prototype is non-interactive; pass --yes to confirm", 2, format);
}
if (resource === "group" && command === "end" && !options.has("--confirm-name")) {
  fail("confirmation_required", "group end requires --confirm-name in the non-interactive prototype", 2, format);
}

const data = sampleFor(resource, command, positionals, options);
writeResult(renderResult(data, format), options.get("--out"), options.has("--force"));
