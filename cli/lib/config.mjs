import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { CliError } from "./errors.mjs";

export function configPath(environment = process.env) {
  if (environment.OPENJOB_CONFIG) return environment.OPENJOB_CONFIG;
  const base = environment.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "openjob", "config.json");
}

export function readConfig(environment = process.env) {
  const path = configPath(environment);
  if (!existsSync(path)) return {};
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (
      value === null ||
      Array.isArray(value) ||
      typeof value !== "object" ||
      (value.currentGroupId !== undefined && typeof value.currentGroupId !== "string")
    ) {
      throw new Error("invalid config shape");
    }
    return value;
  } catch {
    throw new CliError(
      "config_invalid",
      `Local config at ${path} is not valid OpenJob config JSON.`,
      2,
    );
  }
}

export function resolveGroup(options, environment = process.env) {
  const explicit = options.get("--group");
  if (explicit) return { groupId: explicit, source: "flag" };
  if (environment.OPENJOB_GROUP_ID) {
    return { groupId: environment.OPENJOB_GROUP_ID, source: "environment" };
  }
  const currentGroupId = readConfig(environment).currentGroupId;
  if (currentGroupId) return { groupId: currentGroupId, source: "config" };
  throw new CliError(
    "group_required",
    "Select a Group with --group, OPENJOB_GROUP_ID, or openjob group use.",
    2,
  );
}

export function writeCurrentGroup(groupId, environment = process.env) {
  const path = configPath(environment);
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(temporary, `${JSON.stringify({ currentGroupId: groupId }, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temporary, path);
    chmodSync(path, 0o600);
  } catch {
    if (existsSync(temporary)) unlinkSync(temporary);
    throw new CliError("config_write_failed", `Could not update local config at ${path}.`, 2);
  }
}
