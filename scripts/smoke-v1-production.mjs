import { readFile } from "node:fs/promises";
import { runV1AcceptanceScenario } from "./v1-acceptance-scenario.mjs";
import { createOpenApiResponseValidator } from "../tests/support/openapi-response.mjs";

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const baseUrl = new URL(process.env.OPENJOB_SMOKE_BASE_URL ?? "https://openjob.dev");
const tokens = new Map([
  ["initialAdmin", requiredEnvironment("OPENJOB_SMOKE_TOKEN_A")],
  ["memberUser", requiredEnvironment("OPENJOB_SMOKE_TOKEN_B")],
]);
if (tokens.get("initialAdmin") === tokens.get("memberUser")) {
  throw new Error("The production smoke requires two distinct Firebase identities.");
}

const suffix = Date.now().toString(36);
const proposedUsernames = {
  initialAdmin: process.env.OPENJOB_SMOKE_USERNAME_A ?? `smokea-${suffix}`,
  memberUser: process.env.OPENJOB_SMOKE_USERNAME_B ?? `smokeb-${suffix}`,
};
const assertContract = await createOpenApiResponseValidator();
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

const releaseResponse = await fetch(new URL("/api/version", baseUrl), {
  cache: "no-store",
  headers: { accept: "application/json" },
});
if (!releaseResponse.ok) {
  throw new Error(`Production release metadata returned ${releaseResponse.status}.`);
}
const releaseMetadata = await releaseResponse.json();
const expectedVersion = process.env.OPENJOB_EXPECTED_VERSION ?? packageJson.version;
if (releaseMetadata.version !== expectedVersion) {
  throw new Error(
    `Expected production OpenJob ${expectedVersion}, received ${String(releaseMetadata.version)}.`,
  );
}
if (
  process.env.OPENJOB_EXPECTED_COMMIT &&
  releaseMetadata.commit !== process.env.OPENJOB_EXPECTED_COMMIT
) {
  throw new Error(
    `Expected production commit ${process.env.OPENJOB_EXPECTED_COMMIT}, received ${String(releaseMetadata.commit)}.`,
  );
}

async function request({ actor, body, method, path }) {
  const headers = new Headers({ accept: "application/json" });
  const token = tokens.get(actor);
  if (actor === "invalid") {
    headers.set("authorization", "Bearer invalid-production-smoke-token");
  } else if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }
  let requestBody;
  if (body !== undefined) {
    headers.set("content-type", "application/json");
    requestBody = JSON.stringify(body);
  }
  return fetch(new URL(path, baseUrl), {
    body: requestBody,
    headers,
    method,
  });
}

const result = await runV1AcceptanceScenario({
  proposedUsernames,
  request,
  validate: assertContract,
});
process.stdout.write(
  `Production v${releaseMetadata.version} (${releaseMetadata.commit}) smoke passed: ${result.operationCount} operations; disposable Group ended.\n`,
);
