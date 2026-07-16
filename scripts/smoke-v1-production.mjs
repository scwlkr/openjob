import { runV1AcceptanceScenario } from "./v1-acceptance-scenario.mjs";
import { createOpenApiResponseValidator } from "../tests/support/openapi-response.mjs";

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const baseUrl = new URL(process.env.OPENJOB_SMOKE_BASE_URL ?? "https://openjob.dev");
const tokens = new Map([
  ["first", requiredEnvironment("OPENJOB_SMOKE_TOKEN_A")],
  ["second", requiredEnvironment("OPENJOB_SMOKE_TOKEN_B")],
]);
if (tokens.get("first") === tokens.get("second")) {
  throw new Error("The production smoke requires two distinct Firebase identities.");
}

const suffix = Date.now().toString(36);
const proposedUsernames = {
  first: process.env.OPENJOB_SMOKE_USERNAME_A ?? `smokea-${suffix}`,
  second: process.env.OPENJOB_SMOKE_USERNAME_B ?? `smokeb-${suffix}`,
};
const assertContract = await createOpenApiResponseValidator();

async function request({ as, body, method, path }) {
  const headers = new Headers({ accept: "application/json" });
  const token = tokens.get(as);
  if (token) headers.set("authorization", `Bearer ${token}`);
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
  `Production v0.0.5 smoke passed: ${result.operationCount} operations; disposable Group ended.\n`,
);
