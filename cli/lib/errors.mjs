export class CliError extends Error {
  constructor(code, message, exitStatus = 1, details, payload) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.exitStatus = exitStatus;
    this.details = details;
    this.payload = payload;
  }
}

export function reportError(error, format = "table") {
  const known =
    error instanceof CliError
      ? error
      : new CliError("internal_error", "The CLI failed unexpectedly.", 1);
  if (format === "json" || format === "jsonl") {
    const payload =
      known.payload ??
      {
        code: known.code,
        message: known.message,
        ...(known.details ? { fieldErrors: known.details } : {}),
      };
    process.stderr.write(
      `${JSON.stringify({ error: payload })}\n`,
    );
  } else {
    process.stderr.write(`openjob: ${known.code}: ${known.message}\n`);
  }
  process.exitCode = known.exitStatus;
}
