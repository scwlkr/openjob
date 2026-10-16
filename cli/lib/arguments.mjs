import { CliError } from "./errors.mjs";

const VALUE_OPTIONS = new Set([
  "--agent-token-file",
  "--assignee",
  "--confirm-name",
  "--due",
  "--schedule-start",
  "--schedule-end",
  "--format",
  "--group",
  "--input",
  "--limit",
  "--name",
  "--out",
  "--priority",
  "--profile",
  "--scopes",
  "--resources",
  "--status",
  "--text",
  "--text-file",
  "--token-out",
  "--user-id",
  "--username",
]);

const BOOLEAN_OPTIONS = new Set([
  "--clear-schedule",
  "--force",
  "--help",
  "--no-open",
  "--quiet",
  "--version",
  "--yes",
]);

export function parseArguments(raw) {
  const positionals = [];
  const options = new Map();

  for (let index = 0; index < raw.length; index += 1) {
    const token = raw[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const separator = token.indexOf("=");
    const option = separator === -1 ? token : token.slice(0, separator);
    const inlineValue = separator === -1 ? undefined : token.slice(separator + 1);
    if (options.has(option)) {
      throw new CliError("usage_error", `Option ${option} may be used only once.`, 2);
    }
    if (BOOLEAN_OPTIONS.has(option)) {
      if (inlineValue !== undefined) {
        throw new CliError("usage_error", `Option ${option} does not accept a value.`, 2);
      }
      options.set(option, true);
      continue;
    }
    if (!VALUE_OPTIONS.has(option)) {
      throw new CliError("usage_error", `Unknown option ${token}.`, 2);
    }
    const value = inlineValue ?? raw[index + 1];
    if (value === undefined || (inlineValue === undefined && value.startsWith("--"))) {
      throw new CliError("usage_error", `Option ${option} requires a value.`, 2);
    }
    options.set(option, value);
    if (inlineValue === undefined) index += 1;
  }

  return { options, positionals };
}
