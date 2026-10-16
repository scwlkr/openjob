import { basename, dirname, resolve } from "node:path";
import { accessSync, constants, lstatSync, realpathSync, statSync } from "node:fs";
import { CliError } from "./errors.mjs";
import { preflightOutput, writeEnvelope } from "./output.mjs";

/** @param {Map<string, string>} options */
export function prepareAgentGrant(options) {
  const groupId = options.get("--group");
  const name = options.get("--name")?.trim();
  const tokenPath = options.get("--token-out");
  if (!groupId || groupId.length > 1_500 || !/^grp_[A-Za-z0-9_-]+$/.test(groupId) ||
      !name || [...name].length > 80 || /[\u0000-\u001f\u007f-\u009f]/.test(name) || !tokenPath || tokenPath === "-") {
    throw new CliError("usage_error", "Agent grant requires explicit --group, a 1–80 character --name, and a new --token-out file (not stdout).", 2);
  }
  return { body: { groupId, name }, tokenOptions: preparePrivateTokenOutput(options) };
}

/** Shared private, atomic grant-token destination checks. @param {Map<string,string>} options */
export function preparePrivateTokenOutput(options) {
  const tokenPath = options.get("--token-out");
  if (!tokenPath || tokenPath === "-" || options.has("--force")) throw new CliError("usage_error", "Use a new private --token-out file without --force.", 2);
  const preflight = path => {
    preflightOutput(new Map([["--out", path]]));
    try {
      const parent = dirname(resolve(path));
      if (!statSync(parent).isDirectory()) throw new Error("Not a directory");
      accessSync(parent, constants.W_OK | constants.X_OK);
      if (lstatSync(path, { throwIfNoEntry: false })) {
        throw new CliError("output_exists", `Output file already exists: ${path}`, 2);
      }
    } catch (error) {
      if (error instanceof CliError) throw error;
      throw new CliError("output_write_failed", "Output requires a writable, accessible parent directory.", 2);
    }
  };
  const tokenOptions = new Map([["--out", tokenPath]]);
  preflight(tokenPath);
  const output = options.get("--out");
  if (output && output !== "-") {
    preflight(output);
    const canonical = path => resolve(realpathSync(dirname(resolve(path))), basename(path));
    if (canonical(output) === canonical(tokenPath)) {
      throw new CliError("usage_error", "Public output and the private token require different files.", 2);
    }
  }
  return tokenOptions;
}

/**
 * @param {import("../openapi-types.ts").CreateAgentGrantResponse} response
 * @param {ReturnType<typeof prepareAgentGrant>} prepared
 */
export function deliverAgentGrant(response, prepared) {
  const agent = response?.data?.agent;
  const token = response?.data?.token;
  if (!agent || !/^agt_[a-f0-9]{32}$/.test(agent.agentId) ||
      !/^user_[A-Za-z0-9_-]+$/.test(agent.ownerUserId) || agent.groupId !== prepared.body.groupId ||
      agent.name !== prepared.body.name || agent.scope !== "tasks:read" ||
      !Number.isFinite(Date.parse(agent.createdAt)) || !Number.isFinite(Date.parse(agent.expiresAt)) ||
      typeof token !== "string" || !new RegExp(`^oj_agent_${agent.agentId}\\.[A-Za-z0-9_-]{43}$`).test(token)) {
    throw new CliError("invalid_response", "OpenJob returned an invalid grant response. Inspect openjob agent list before retrying.", 8);
  }
  try {
    // Reuse the atomic mode-0600 writer. Its no-overwrite link also fences destination races.
    writeEnvelope({ data: token }, "table", prepared.tokenOptions);
  } catch {
    throw new CliError("agent_token_delivery_failed", `Grant ${agent.agentId} was created but its token was not saved. Revoke it with openjob agent revoke ${agent.agentId} --yes.`, 8);
  }
  const { agentId, ownerUserId, groupId, name, scope, createdAt, expiresAt } = agent;
  return { agentId, ownerUserId, groupId, name, scope, createdAt, expiresAt };
}
