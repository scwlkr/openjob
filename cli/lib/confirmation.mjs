import { createInterface } from "node:readline";
import { CliError } from "./errors.mjs";

export async function confirmTaskDeletion(taskId, options) {
  await confirmDestructiveAction(
    `Delete Task ${taskId}?`,
    "Non-interactive deletion requires --yes.",
    options,
  );
}

export async function confirmDestructiveAction(prompt, nonInteractiveMessage, options) {
  if (options.has("--yes")) return;
  if (!inputIsInteractive()) {
    throw new CliError("confirmation_required", nonInteractiveMessage, 2);
  }

  process.stderr.write(`${prompt} [y/N] `);
  const answer = await readAnswer();
  if (!new Set(["y", "yes"]).has(answer.trim().toLowerCase())) {
    throw new CliError("confirmation_declined", "Action cancelled.", 2);
  }
}

export async function confirmGroupEnd(groupName, options) {
  if (!inputIsInteractive()) {
    const confirmationName = options.get("--confirm-name");
    if (!confirmationName) {
      throw new CliError(
        "confirmation_required",
        "Non-interactive Group ending requires --confirm-name <current-name>.",
        2,
      );
    }
    return confirmationName;
  }

  process.stderr.write(`Type ${groupName} to End Group: `);
  const confirmationName = await readAnswer();
  if (confirmationName !== groupName) {
    throw new CliError(
      "confirmation_declined",
      "Group ending cancelled because the name did not match.",
      2,
    );
  }
  return confirmationName;
}

export function inputIsInteractive() {
  return Boolean(
    process.stdin.isTTY ||
    (process.env.NODE_ENV === "test" && process.env.OPENJOB_TEST_INTERACTIVE === "1"),
  );
}

async function readAnswer() {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let answer = "";
  for await (const line of lines) {
    answer = line;
    break;
  }
  lines.close();
  return answer;
}
