import { readFileSync } from "node:fs";
import { CliError } from "./errors.mjs";

export function readInputObject(path) {
  let text;
  try {
    text = path === "-" ? readFileSync(0, "utf8") : readFileSync(path, "utf8");
  } catch {
    throw new CliError("input_read_failed", `Could not read input from ${path}.`, 2);
  }
  try {
    const value = JSON.parse(text);
    if (value === null || Array.isArray(value) || typeof value !== "object") {
      throw new Error("not an object");
    }
    return value;
  } catch {
    throw new CliError("input_invalid", "Input must be one JSON object.", 2);
  }
}
