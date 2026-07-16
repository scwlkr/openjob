import { createInterface } from "node:readline";
import { CliError } from "./errors.mjs";

export async function confirmTaskDeletion(taskId, options) {
  if (options.has("--yes")) return;
  const interactive =
    process.stdin.isTTY ||
    (process.env.NODE_ENV === "test" && process.env.OPENJOB_TEST_INTERACTIVE === "1");
  if (!interactive) {
    throw new CliError(
      "confirmation_required",
      "Non-interactive deletion requires --yes.",
      2,
    );
  }

  process.stderr.write(`Delete Task ${taskId}? [y/N] `);
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let answer = "";
  for await (const line of lines) {
    answer = line;
    break;
  }
  lines.close();
  if (!new Set(["y", "yes"]).has(answer.trim().toLowerCase())) {
    throw new CliError("confirmation_declined", "Task deletion cancelled.", 2);
  }
}
