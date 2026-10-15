import type { GroupId } from "./v1-groups.ts";

export type AgentGrant = {
  agentId: string;
  ownerUserId: string;
  groupId: GroupId;
  name: string;
  scope: "tasks:read";
  createdAt: string;
  expiresAt: string;
};
export type StoredAgentGrant = AgentGrant & { tokenHash: string; membershipId: string };
export type AgentGrantStore = {
  create(grant: AgentGrant, tokenHash: string): Promise<boolean>;
  list(ownerUserId: string): Promise<AgentGrant[]>;
  revoke(ownerUserId: string, agentId: string): Promise<boolean>;
  authorize(token: string): Promise<AgentGrant | null>;
  removeAllForUser(ownerUserId: string): Promise<number>;
};

export const AGENT_ID = /^agt_[a-f0-9]{32}$/;
export const AGENT_TOKEN = /^oj_agent_(agt_[a-f0-9]{32})\.([A-Za-z0-9_-]{43})$/;
export const AGENT_LIFETIME_MS = 24 * 60 * 60 * 1000;

export function agentBearer(request: Request): string | null {
  const value = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(oj_agent_\S*)$/i.exec(value);
  return match ? match[1] : null;
}

export async function agentTokenHash(token: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function newAgentSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export class AgentAccessDenied extends Error {}
