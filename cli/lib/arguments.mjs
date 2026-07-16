import { CliError } from "./errors.mjs";

const VALUE_OPTIONS = new Set([
  "--assignee",
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
]);

const BOOLEAN_OPTIONS = new Set([
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
    if (options.has(token)) {
      throw new CliError("usage_error", `Option ${token} may be used only once.`, 2);
    }
    if (BOOLEAN_OPTIONS.has(token)) {
      options.set(token, true);
      continue;
    }
    if (!VALUE_OPTIONS.has(token)) {
      throw new CliError("usage_error", `Unknown option ${token}.`, 2);
    }
    const value = raw[index + 1];
    if (!value || value.startsWith("--")) {
      throw new CliError("usage_error", `Option ${token} requires a value.`, 2);
    }
    options.set(token, value);
    index += 1;
  }

  return { options, positionals };
}
