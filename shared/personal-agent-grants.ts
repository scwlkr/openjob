export type PersonalAgentScope = "tasks:read" | "tasks:write" | "calendar:read" | "calendar:write";
export type PersonalAgentResource = "tasks:personal" | "calendar:personal";
export type PersonalAgentInput = { name: string; scopes: PersonalAgentScope[]; resourceIds: PersonalAgentResource[] };
export type PersonalAgentGrant = PersonalAgentInput & { id: string; ownerUserId: string; createdAt: string; expiresAt: string; revoked: boolean };
export type StoredPersonalAgentGrant = PersonalAgentGrant & { tokenHash: string };
export const PERSONAL_AGENT_ID = /^agt_[a-f0-9]{32}$/;
export const PERSONAL_AGENT_TOKEN = /^oj_personal_([A-Za-z0-9_-]{1,128})\.(agt_[a-f0-9]{32})\.([A-Za-z0-9_-]{43})$/;
export const PERSONAL_AGENT_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const PERSONAL_AGENT_SCOPES: PersonalAgentScope[] = ["tasks:read", "tasks:write", "calendar:read", "calendar:write"];
export const PERSONAL_AGENT_RESOURCES: PersonalAgentResource[] = ["tasks:personal", "calendar:personal"];
function fail(code: string): never { throw Object.assign(new Error(code === "invalid_state" ? "Invalid stored personal grant" : "Invalid personal agent input"), { code }); }
export function validatePersonalAgentInput(input: unknown): PersonalAgentInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("invalid_input");
  const value = input as Record<string, unknown>;
  if (Object.keys(value).sort().join(",") !== "name,resourceIds,scopes" || typeof value.name !== "string" || !value.name.trim() || [...value.name.trim()].length > 80 || /[\u0000-\u001f\u007f-\u009f]/.test(value.name)) fail("invalid_input");
  if (!Array.isArray(value.scopes) || !value.scopes.length || value.scopes.length > 4 || value.scopes.some(scope => !PERSONAL_AGENT_SCOPES.includes(scope)) || new Set(value.scopes).size !== value.scopes.length) fail("invalid_input");
  if (!Array.isArray(value.resourceIds) || !value.resourceIds.length || value.resourceIds.length > 2 || value.resourceIds.some(resource => !PERSONAL_AGENT_RESOURCES.includes(resource)) || new Set(value.resourceIds).size !== value.resourceIds.length) fail("invalid_input");
  return { name: value.name.trim(), scopes: [...value.scopes], resourceIds: [...value.resourceIds] } as PersonalAgentInput;
}
export function parsePersonalAgentGrants(owner: string, encoded?: string): StoredPersonalAgentGrant[] {
  if (encoded === undefined) return [];
  let value: unknown; try { value = JSON.parse(encoded); } catch { fail("invalid_state"); }
  if (!Array.isArray(value) || value.length > 100) fail("invalid_state");
  const seen = new Set<string>();
  for (const grant of value) {
    if (!grant || typeof grant !== "object" || Array.isArray(grant) || Object.keys(grant).sort().join(",") !== "createdAt,expiresAt,id,name,ownerUserId,resourceIds,revoked,scopes,tokenHash") fail("invalid_state");
    try { validatePersonalAgentInput({ name: grant.name, scopes: grant.scopes, resourceIds: grant.resourceIds }); } catch { fail("invalid_state"); }
    if (typeof grant.id !== "string" || !PERSONAL_AGENT_ID.test(grant.id) || seen.has(grant.id) || grant.ownerUserId !== owner || typeof grant.revoked !== "boolean" || typeof grant.tokenHash !== "string" || !/^[a-f0-9]{64}$/.test(grant.tokenHash)) fail("invalid_state");
    if (typeof grant.createdAt !== "string" || typeof grant.expiresAt !== "string" || !Number.isFinite(Date.parse(grant.createdAt)) || Date.parse(grant.expiresAt) - Date.parse(grant.createdAt) !== PERSONAL_AGENT_LIFETIME_MS) fail("invalid_state");
    seen.add(grant.id);
  }
  return structuredClone(value) as StoredPersonalAgentGrant[];
}
export function publicPersonalAgent(grant: StoredPersonalAgentGrant): PersonalAgentGrant {
  const { id, ownerUserId, name, scopes, resourceIds, createdAt, expiresAt, revoked } = grant;
  return structuredClone({ id, ownerUserId, name, scopes, resourceIds, createdAt, expiresAt, revoked });
}
export async function personalAgentTokenHash(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function newPersonalAgentSecret() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
export function personalAgentHashEqual(left: string, right: string) {
  let difference = left.length ^ right.length;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
