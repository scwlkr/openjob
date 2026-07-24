import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { CliError } from "./errors.mjs";
import { resolveCliProfile } from "./profiles.mjs";

const SERVICE = "dev.openjob.cli";

function testCredentialPath(environment) {
  return environment.NODE_ENV === "test"
    ? environment.OPENJOB_TEST_CREDENTIAL_FILE
    : undefined;
}

export async function readRefreshCredential(
  environment = process.env,
  profile = resolveCliProfile(undefined, environment),
) {
  const testPath = testCredentialPath(environment);
  if (testPath) return existsSync(testPath) ? readFileSync(testPath, "utf8") : null;
  try {
    const { Entry } = await import("@napi-rs/keyring");
    return new Entry(SERVICE, profile.credentialAccount).getPassword();
  } catch {
    throw new CliError(
      "credential_store_error",
      "OpenJob could not read the operating-system credential store.",
      1,
    );
  }
}

export async function writeRefreshCredential(
  credential,
  environment = process.env,
  profile = resolveCliProfile(undefined, environment),
) {
  const testPath = testCredentialPath(environment);
  if (testPath) {
    mkdirSync(dirname(testPath), { recursive: true });
    writeFileSync(testPath, credential, { encoding: "utf8", mode: 0o600 });
    chmodSync(testPath, 0o600);
    return;
  }
  try {
    const { Entry } = await import("@napi-rs/keyring");
    new Entry(SERVICE, profile.credentialAccount).setPassword(credential);
  } catch {
    throw new CliError(
      "credential_store_error",
      "OpenJob could not update the operating-system credential store.",
      1,
    );
  }
}

export async function deleteRefreshCredential(
  environment = process.env,
  profile = resolveCliProfile(undefined, environment),
) {
  const testPath = testCredentialPath(environment);
  if (testPath) {
    if (existsSync(testPath)) unlinkSync(testPath);
    return;
  }
  try {
    const { Entry } = await import("@napi-rs/keyring");
    new Entry(SERVICE, profile.credentialAccount).deletePassword();
  } catch {
    throw new CliError(
      "credential_store_error",
      "OpenJob could not update the operating-system credential store.",
      1,
    );
  }
}
