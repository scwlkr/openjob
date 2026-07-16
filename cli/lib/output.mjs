import { randomBytes } from "node:crypto";
import {
  accessSync,
  constants,
  existsSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { CliError } from "./errors.mjs";

export function outputFormat(options) {
  const format = options.get("--format") || "table";
  if (!new Set(["table", "json", "jsonl"]).has(format)) {
    throw new CliError("usage_error", `Unknown output format ${format}.`, 2);
  }
  return format;
}

export function preflightOutput(options) {
  const path = options.get("--out");
  if (options.has("--force") && !path) {
    throw new CliError("usage_error", "--force requires --out.", 2);
  }
  if (!path || path === "-") return;
  if (existsSync(path)) {
    if (!options.has("--force")) {
      throw new CliError("output_exists", `Output file already exists: ${path}`, 2);
    }
    if (!statSync(path).isFile()) throw outputWriteError(path);
  }
  try {
    accessSync(dirname(path), constants.W_OK);
  } catch {
    throw outputWriteError(path);
  }
}

export function writeEnvelope(envelope, format, options) {
  const rendered = renderEnvelope(envelope, format);
  const path = options.get("--out");
  if (!path || path === "-") {
    process.stdout.write(rendered);
    return;
  }
  preflightOutput(options);
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    writeFileSync(temporary, rendered, { encoding: "utf8", flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  } catch {
    if (existsSync(temporary)) unlinkSync(temporary);
    throw new CliError(
      "output_write_failed",
      `Could not atomically write output in ${dirname(path)}.`,
      2,
    );
  }
}

function outputWriteError(path) {
  return new CliError(
    "output_write_failed",
    `Could not atomically write output in ${dirname(path)}.`,
    2,
  );
}

function renderEnvelope(envelope, format) {
  if (format === "json") {
    return `${JSON.stringify(envelope, null, 2)}\n`;
  }
  if (format === "jsonl") {
    const values = Array.isArray(envelope.data) ? envelope.data : [envelope.data];
    return values.map((value) => JSON.stringify(value)).join("\n") + (values.length ? "\n" : "");
  }

  const rows = Array.isArray(envelope.data) ? envelope.data : [envelope.data];
  if (rows.length === 0) return "";
  if (rows.every((value) => value && typeof value === "object")) {
    const fields = Object.keys(rows[0]);
    const header = fields.map(headerFor).join("\t");
    return `${header}\n${rows.map((value) => fields.map((field) => formatValue(value[field])).join("\t")).join("\n")}\n`;
  }
  return `${rows.map(formatValue).join("\n")}\n`;
}

function formatValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).replaceAll("\r", "\\r").replaceAll("\n", "\\n").replaceAll("\t", "\\t");
}

function headerFor(field) {
  return field.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}
