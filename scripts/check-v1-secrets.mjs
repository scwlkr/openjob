import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const secretPatterns = [
  [
    "private key",
    /-----BEGIN (?:DSA |EC |ENCRYPTED |OPENSSH |RSA )?PRIVATE KEY-----\s+(?:[A-Za-z0-9+/=]\s*){40,}-----END (?:DSA |EC |ENCRYPTED |OPENSSH |RSA )?PRIVATE KEY-----/,
  ],
  ["Expo access token", /\bexpo_[A-Za-z0-9_-]{30,}\b/],
  ["Google OAuth client secret", /\bGOCSPX-[A-Za-z0-9_-]{20,}\b/],
  ["Google OAuth access token", /\bya29\.[A-Za-z0-9_-]{30,}\b/],
  ["Google OAuth refresh token", /\b1\/\/[A-Za-z0-9_-]{30,}\b/],
  [
    "JWT or Firebase ID token",
    /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\b/,
  ],
];
const forbiddenCredentialArtifacts = [
  ["EAS credential bundle", /(?:^|\/)credentials\.json$/iu],
  ["Apple private key", /(?:^|\/)[^/]+\.p8$/iu],
  ["Apple signing archive", /(?:^|\/)[^/]+\.p12$/iu],
  ["Apple provisioning profile", /(?:^|\/)[^/]+\.mobileprovision$/iu],
  [
    "private key or signing store",
    /(?:^|\/)[^/]+\.(?:der|jks|key|keystore|pk8|pkcs8)$/iu,
  ],
  ["Firebase iOS configuration", /(?:^|\/)GoogleService-Info\.plist$/u],
  ["Firebase Android configuration", /(?:^|\/)google-services\.json$/u],
];

async function walk(directory, files) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await walk(path, files);
    else if (entry.isFile()) files.add(path);
  }
}

const { stdout } = await run(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  {
    cwd: root,
    encoding: "buffer",
    maxBuffer: 20 * 1024 * 1024,
  },
);
const files = new Set(
  stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((path) => `${root}${path}`),
);
await walk(`${root}dist`, files);
await walk(`${root}.wrangler`, files);

const findings = [];
for (const path of files) {
  const relativePath = path.slice(root.length);
  for (const [label, pattern] of forbiddenCredentialArtifacts) {
    if (pattern.test(relativePath)) {
      findings.push(`${relativePath}: ${label}`);
    }
  }
  const contents = await readFile(path);
  if (contents.includes(0)) continue;
  const text = contents.toString("utf8");
  for (const [label, pattern] of secretPatterns) {
    if (pattern.test(text)) {
      findings.push(`${relativePath}: ${label}`);
    }
  }
}

if (findings.length > 0) {
  process.stderr.write(`Secret-safety scan failed:\n${findings.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Secret-safety scan passed: ${files.size} files checked.\n`);
}
