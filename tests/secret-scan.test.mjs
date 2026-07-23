import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scannerUrl = new URL("../scripts/check-v1-secrets.mjs", import.meta.url);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

test("secret scan rejects tracked native credential artifacts by filename", async () => {
  const root = await mkdtemp(join(tmpdir(), "openjob-secret-scan-"));
  const artifacts = [
    "credentials.json",
    "ios/AuthKey_TEST.p8",
    "ios/distribution.p12",
    "ios/OpenJob.mobileprovision",
    "android/upload.jks",
    "android/upload.keystore",
    "android/upload.key",
    "android/upload.der",
    "android/upload.pk8",
    "android/upload.pkcs8",
    "GoogleService-Info.plist",
    "google-services.json",
  ];

  try {
    await mkdir(join(root, "scripts"), { recursive: true });
    await writeFile(
      join(root, "scripts", "check-v1-secrets.mjs"),
      await readFile(scannerUrl),
    );
    for (const artifact of artifacts) {
      await mkdir(join(root, artifact, ".."), { recursive: true });
      await writeFile(join(root, artifact), Buffer.from([0, 1, 2, 3]));
    }

    git(root, ["init", "-b", "main"]);
    git(root, ["add", "."]);

    const result = spawnSync(
      process.execPath,
      [join(root, "scripts", "check-v1-secrets.mjs")],
      { cwd: root, encoding: "utf8" },
    );

    assert.equal(result.status, 1, result.stderr || result.stdout);
    for (const artifact of artifacts) {
      assert.match(result.stderr, new RegExp(artifact.replaceAll(".", "\\.")));
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("native credential artifacts are ignored before they can be staged", () => {
  const artifacts = [
    "native/credentials/AuthKey_TEST.p8",
    "native/credentials.json",
    "native/credentials/android/keystore.jks",
    "native/credentials/distribution.p12",
    "native/credentials/OpenJob.mobileprovision",
    "native/credentials/upload.jks",
    "native/credentials/upload.keystore",
    "native/credentials/upload.key",
    "native/credentials/upload.der",
    "native/credentials/upload.pk8",
    "native/credentials/upload.pkcs8",
    "native/GoogleService-Info.plist",
    "native/google-services.json",
  ];

  for (const artifact of artifacts) {
    const result = spawnSync(
      "git",
      ["check-ignore", "--no-index", "--quiet", artifact],
      { cwd: repositoryRoot },
    );
    assert.equal(result.status, 0, `${artifact} must be ignored`);
  }
});

test("secret scan inspects ignored native projects and artifact directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "openjob-secret-scan-"));
  const artifacts = [
    "native/android/app/upload.keystore",
    "native/ios/OpenJob.mobileprovision",
    "native/.artifacts/credentials.json",
  ];

  try {
    await mkdir(join(root, "scripts"), { recursive: true });
    await writeFile(
      join(root, "scripts", "check-v1-secrets.mjs"),
      await readFile(scannerUrl),
    );
    await writeFile(
      join(root, ".gitignore"),
      ["/native/android/", "/native/ios/", "/native/.artifacts/"].join("\n"),
    );
    for (const artifact of [...artifacts, "native/android/app/debug.keystore"]) {
      await mkdir(join(root, artifact, ".."), { recursive: true });
      await writeFile(join(root, artifact), Buffer.from([0, 1, 2, 3]));
    }

    git(root, ["init", "-b", "main"]);
    git(root, ["add", ".gitignore", "scripts/check-v1-secrets.mjs"]);

    const result = spawnSync(
      process.execPath,
      [join(root, "scripts", "check-v1-secrets.mjs")],
      { cwd: root, encoding: "utf8" },
    );

    assert.equal(result.status, 1, result.stderr || result.stdout);
    for (const artifact of artifacts) {
      assert.match(result.stderr, new RegExp(artifact.replaceAll(".", "\\.")));
    }
    assert.doesNotMatch(result.stderr, /debug\.keystore/u);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("secret scan rejects untracked provider secrets before staging", async () => {
  const root = await mkdtemp(join(tmpdir(), "openjob-secret-scan-"));
  const privateKeyHeader = ["-----BEGIN RSA", "PRIVATE KEY-----"].join(" ");
  const privateKeyFooter = ["-----END RSA", "PRIVATE KEY-----"].join(" ");
  const privateKey = [
    privateKeyHeader,
    "a".repeat(64),
    "b".repeat(64),
    privateKeyFooter,
  ].join("\n");
  const encryptedPrivateKey = [
    ["-----BEGIN ENCRYPTED", "PRIVATE KEY-----"].join(" "),
    "c".repeat(96),
    ["-----END ENCRYPTED", "PRIVATE KEY-----"].join(" "),
  ].join("\n");
  const expoToken = ["expo", "_", "a".repeat(40)].join("");
  const googleClientSecret = ["GOCSPX", "-", "b".repeat(28)].join("");

  try {
    await mkdir(join(root, "scripts"), { recursive: true });
    await writeFile(
      join(root, "scripts", "check-v1-secrets.mjs"),
      await readFile(scannerUrl),
    );
    git(root, ["init", "-b", "main"]);
    git(root, ["add", "scripts/check-v1-secrets.mjs"]);
    await writeFile(join(root, "untracked-private.txt"), privateKey);
    await writeFile(
      join(root, "untracked-encrypted-private.txt"),
      encryptedPrivateKey,
    );
    await writeFile(
      join(root, "untracked-provider.txt"),
      [expoToken, googleClientSecret].join("\n"),
    );

    const result = spawnSync(
      process.execPath,
      [join(root, "scripts", "check-v1-secrets.mjs")],
      { cwd: root, encoding: "utf8" },
    );

    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, /untracked-private\.txt/u);
    assert.match(result.stderr, /untracked-encrypted-private\.txt/u);
    assert.match(result.stderr, /private key/iu);
    assert.match(result.stderr, /Expo access token/u);
    assert.match(result.stderr, /Google OAuth client secret/u);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
