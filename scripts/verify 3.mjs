const MODES = new Set(["focused", "merge", "release-candidate"]);
const USAGE =
  "Usage: npm run verify -- <focused|merge|release-candidate> --base <revision> [--cache <path>] [--evidence <gate>=<reference>]";

function failArguments(message = USAGE) {
  const result = {
    schemaVersion: 1,
    status: "failed",
    error: { code: "invalid_arguments", message },
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.stderr.write(`FAILED invalid_arguments — ${message}\n`);
  process.exitCode = 2;
}

const [mode] = process.argv.slice(2);
if (!MODES.has(mode)) failArguments();
