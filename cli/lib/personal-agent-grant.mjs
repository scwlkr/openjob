import { lstatSync } from "node:fs";
import { CliError } from "./errors.mjs";
import { preparePrivateTokenOutput } from "./agent-grant.mjs";
import { readTextSource } from "./input.mjs";
import { writeEnvelope } from "./output.mjs";

const SCOPES = ["tasks:read", "tasks:write", "calendar:read", "calendar:write"];
const RESOURCES = ["tasks:personal", "calendar:personal"];
export function preparePersonalAgentGrant(options) {
  const name = options.get("--name")?.trim();
  const list = (option, allowed) => {
    const value = options.get(option);
    const items = typeof value === "string" ? value.split(",").map(item => item.trim()) : [];
    if (!items.length || new Set(items).size !== items.length || items.some(item => !allowed.includes(item))) throw new CliError("usage_error", `Use an explicit comma-separated ${option} list of supported personal capabilities or resources.`, 2);
    return items;
  };
  if (!name || [...name].length > 80 || /[\u0000-\u001f\u007f-\u009f]/.test(name)) throw new CliError("usage_error", "Personal agent grant requires a 1–80 character plain-text --name.", 2);
  const scopes = list("--scopes", SCOPES);
  const resourceIds = list("--resources", RESOURCES);
  return { body: { name, scopes, resourceIds }, tokenOptions: preparePrivateTokenOutput(options) };
}

export function publicPersonalAgent(agent) {
  if (!agent || typeof agent !== "object" || !/^agt_[a-f0-9]{32}$/.test(agent.id) || !/^[A-Za-z0-9_-]{1,128}$/.test(agent.ownerUserId) ||
    typeof agent.name !== "string" || !agent.name.trim() || [...agent.name].length > 80 || /[\u0000-\u001f\u007f-\u009f]/.test(agent.name) ||
    !Array.isArray(agent.scopes) || !agent.scopes.length || agent.scopes.some(scope => !SCOPES.includes(scope)) || new Set(agent.scopes).size !== agent.scopes.length ||
    !Array.isArray(agent.resourceIds) || !agent.resourceIds.length || agent.resourceIds.some(resource => !RESOURCES.includes(resource)) || new Set(agent.resourceIds).size !== agent.resourceIds.length ||
    !Number.isFinite(Date.parse(agent.createdAt)) || !Number.isFinite(Date.parse(agent.expiresAt)) || Date.parse(agent.createdAt) >= Date.parse(agent.expiresAt) || typeof agent.revoked !== "boolean") {
    throw new CliError("invalid_response", "Invalid personal grant metadata. Inspect openjob workspace agent list before retrying.", 8);
  }
  const { id, ownerUserId, name, scopes, resourceIds, createdAt, expiresAt, revoked } = agent;
  return { id, ownerUserId, name, scopes, resourceIds, createdAt, expiresAt, revoked };
}

export function deliverPersonalAgentGrant(response, prepared) {
  const agent = publicPersonalAgent(response?.data?.agent);
  const token = response?.data?.token;
  const equal = (a, b) => a.length === b.length && a.every(item => b.includes(item));
  if (agent.name !== prepared.body.name || agent.revoked || !equal(agent.scopes, prepared.body.scopes) || !equal(agent.resourceIds, prepared.body.resourceIds) ||
      typeof token !== "string" || !new RegExp(`^oj_personal_${agent.ownerUserId}\\.${agent.id}\\.[A-Za-z0-9_-]{43}$`).test(token)) {
    throw new CliError("invalid_response", "Invalid personal grant delivery. Inspect openjob workspace agent list and revoke uncertain grants before retrying.", 8);
  }
  try { writeEnvelope({ data: token }, "table", prepared.tokenOptions); }
  catch { throw new CliError("agent_token_delivery_failed", `Grant ${agent.id} was created but its token was not saved. Revoke it with openjob workspace agent revoke ${agent.id} --yes.`, 8); }
  return agent;
}

export function readPersonalAgentToken(path) {
  if (path !== "-") {
    try { const file = lstatSync(path); if (!file.isFile() || (file.mode & 0o077) !== 0) throw new Error("Not private"); }
    catch { throw new CliError("input_invalid", "Personal agent credentials require a regular private file (mode 0600), or stdin.", 2); }
  }
  const token = readTextSource(path);
  if (!/^oj_personal_[A-Za-z0-9_-]{1,128}\.agt_[a-f0-9]{32}\.[A-Za-z0-9_-]{43}$/.test(token)) throw new CliError("input_invalid", "Use one personal workspace agent credential. Group credentials are not accepted.", 2);
  return token;
}
