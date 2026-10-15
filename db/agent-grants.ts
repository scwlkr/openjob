import { createFirestoreRestClient, type FirebaseConfig, type FirestoreDocument } from "./firestore-rest.ts";
import { activeUserFenceWrite, isActiveUser } from "./user-history.ts";
import { AGENT_ID, AGENT_TOKEN, agentTokenHash, type AgentGrant, type AgentGrantStore, type StoredAgentGrant } from "../server/agent-grants.ts";
import { isGroupId } from "../server/v1-groups.ts";

function publicGrant(grant: StoredAgentGrant): AgentGrant {
  const { agentId, ownerUserId, groupId, name, scope, createdAt, expiresAt } = grant;
  return { agentId, ownerUserId, groupId, name, scope, createdAt, expiresAt };
}

function parse(document: FirestoreDocument): StoredAgentGrant | null {
  const f = document.fields ?? {};
  const agentId = f.agentId?.stringValue;
  const ownerUserId = f.ownerUserId?.stringValue;
  const groupId = f.groupId?.stringValue;
  const name = f.name?.stringValue;
  const membershipId = f.membershipId?.stringValue;
  const tokenHash = f.tokenHash?.stringValue;
  const createdAt = f.createdAt?.timestampValue;
  const expiresAt = f.expiresAt?.timestampValue;
  if (!agentId || !AGENT_ID.test(agentId) || !document.name.endsWith(`/v1AgentGrants/${agentId}`) ||
      !ownerUserId || !/^user_[A-Za-z0-9_-]+$/.test(ownerUserId) || !isGroupId(groupId ?? "") ||
      !name || !membershipId || !tokenHash || !/^[a-f0-9]{64}$/.test(tokenHash) ||
      f.scope?.stringValue !== "tasks:read" || !createdAt || !expiresAt ||
      !Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(expiresAt))) return null;
  return { agentId, ownerUserId, groupId: groupId as AgentGrant["groupId"], name, membershipId,
    tokenHash, createdAt, expiresAt, scope: "tasks:read" };
}

function equalHash(left: string, right: string) {
  let difference = left.length ^ right.length;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export function createFirestoreAgentGrantStore(
  config: FirebaseConfig,
  fetchImplementation: typeof fetch = fetch,
  { now = Date.now }: { now?: () => number } = {},
): AgentGrantStore {
  const firestore = createFirestoreRestClient(config, fetchImplementation);
  const path = (id: string) => `v1AgentGrants/${id}`;
  async function read(relative: string) {
    const response = await firestore.request(relative, {}, { allowNotFound: true });
    return response.status === 404 ? null : await response.json() as FirestoreDocument;
  }
  async function access(grant: Pick<AgentGrant, "ownerUserId" | "groupId">) {
    const [group, member] = await Promise.all([
      read(`v1Groups/${grant.groupId}`),
      read(`v1Groups/${grant.groupId}/members/${grant.ownerUserId}`),
    ]);
    return group?.updateTime && !Object.hasOwn(group.fields ?? {}, "deletionCleanupUserId") &&
      member?.updateTime && member.fields?.membershipId?.stringValue
      ? { group, member, membershipId: member.fields.membershipId.stringValue } : null;
  }
  async function owned(ownerUserId: string, limit?: number) {
    const response = await firestore.request(":runQuery", { method: "POST", body: JSON.stringify({
      structuredQuery: { from: [{ collectionId: "v1AgentGrants" }],
        where: { fieldFilter: { field: { fieldPath: "ownerUserId" }, op: "EQUAL", value: { stringValue: ownerUserId } } },
        ...(limit ? { limit } : {}),
      },
    }) });
    const rows = await response.json() as { document?: FirestoreDocument }[];
    return rows.flatMap((row) => row.document ? [row.document] : []);
  }
  async function commit(writes: unknown[]) {
    await firestore.request(":commit", { method: "POST", body: JSON.stringify({ writes }) });
  }
  return Object.freeze({
    async create(grant, tokenHash) {
      const current = await access(grant);
      if (!current) return false;
      const values = { ...grant, tokenHash, membershipId: current.membershipId };
      const fields = Object.fromEntries(Object.entries(values).map(([key, value]) => [key,
        key === "createdAt" || key === "expiresAt" ? { timestampValue: value } : { stringValue: value },
      ]));
      await commit([
        await activeUserFenceWrite(firestore, grant.ownerUserId),
        { verify: current.group.name, currentDocument: { updateTime: current.group.updateTime } },
        { verify: current.member.name, currentDocument: { updateTime: current.member.updateTime } },
        { update: { name: firestore.documentName(path(grant.agentId)), fields }, currentDocument: { exists: false } },
      ]);
      return true;
    },
    async list(ownerUserId) {
      return (await owned(ownerUserId)).flatMap((document) => {
        const grant = parse(document);
        return grant && grant.ownerUserId === ownerUserId ? [publicGrant(grant)] : [];
      }).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.agentId.localeCompare(b.agentId));
    },
    async revoke(ownerUserId, agentId) {
      if (!AGENT_ID.test(agentId)) return false;
      const document = await read(path(agentId));
      if (!document || document.fields?.ownerUserId?.stringValue !== ownerUserId) return false;
      await commit([
        await activeUserFenceWrite(firestore, ownerUserId),
        { delete: document.name, currentDocument: { updateTime: document.updateTime } },
      ]);
      return true;
    },
    async authorize(token) {
      const id = AGENT_TOKEN.exec(token)?.[1];
      if (!id) return null;
      const document = await read(path(id));
      const grant = document ? parse(document) : null;
      if (!grant || !equalHash(grant.tokenHash, await agentTokenHash(token)) || Date.parse(grant.expiresAt) <= now()) return null;
      if (!(await isActiveUser(firestore, grant.ownerUserId))) return null;
      const current = await access(grant);
      return current?.membershipId === grant.membershipId ? publicGrant(grant) : null;
    },
    async removeAllForUser(ownerUserId) {
      let removed = 0;
      for (;;) {
        const documents = await owned(ownerUserId, 100);
        if (documents.length === 0) return removed;
        await commit(documents.map((document) => ({ delete: document.name })));
        removed += documents.length;
      }
    },
  });
}
