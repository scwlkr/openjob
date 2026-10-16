import { createFirestoreAgentGrantStore } from '../../db/agent-grants.ts';
import { createFirestoreTaskStore } from '../../db/v1-tasks.ts';
import { createV1AgentGrantsApi } from '../../server/v1-agent-grants.ts';
import { createV1TasksApi } from '../../server/v1-tasks.ts';
import { createFakeFirestore, createPrivateKey } from './fake-firestore.mjs';

export const NOW = Date.parse('2026-10-15T12:00:00.000Z');
export const ROOT = 'projects/openjob-dev/databases/(default)/documents/';
export const OWNER = 'user_fixture';
export const GROUP = 'grp_fixture';
export const collection = `/api/v1/groups/${GROUP}/tasks`;

export async function fixture() {
  const firestore = createFakeFirestore();
  let clock = NOW;
  let next = 0;
  let beforeCommit;
  const seed = (path, values) => firestore.documents.set(ROOT + path, {
    name: ROOT + path, updateTime: new Date(clock + ++next).toISOString(),
    fields: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { stringValue: value }])),
  });
  seed(`v1UserDirectory/${OWNER}`, { userId: OWNER });
  seed('v1UserDirectory/user_other', { userId: 'user_other' });
  seed(`v1Groups/${GROUP}`, { groupId: GROUP });
  seed(`v1Groups/${GROUP}/members/${OWNER}`, { userId: OWNER, membershipId: 'membership_original' });
  for (const id of ['one', 'two']) {
    seed(`v1Groups/${GROUP}/tasks/task_${id}`, { taskId: `task_${id}`, groupId: GROUP, text: `Isolated ${id}`, assigneeState: 'unassigned', state: 'open' });
    firestore.documents.get(ROOT + `v1Groups/${GROUP}/tasks/task_${id}`).fields.createdAt = { timestampValue: new Date(NOW).toISOString() };
  }
  const fetchImplementation = async (input, init = {}) => {
    if (String(input).endsWith('/documents:commit') && beforeCommit) { const hook = beforeCommit; beforeCommit = undefined; hook(); }
    return firestore.fetch(input, init);
  };
  const config = { projectId: 'openjob-dev', clientEmail: 'fixture@example.invalid', privateKey: await createPrivateKey() };
  const grants = createFirestoreAgentGrantStore(config, fetchImplementation, { now: () => clock });
  const tasks = createFirestoreTaskStore(config, fetchImplementation);
  const users = {
    async resolve(identity) { return { userId: identity.uid, username: 'fixture', deletionPending: Boolean(firestore.documents.get(ROOT + `v1UserDirectory/${identity.uid}`)?.fields.deletionState) }; },
    async getByUsername() { throw new Error('Agent must not resolve human mutation targets.'); },
  };
  const verifyIdToken = async request => {
    const auth = request.headers.get('authorization');
    return auth === 'Bearer fixture-human' ? { uid: OWNER } : auth === 'Bearer fixture-other' ? { uid: 'user_other' } : null;
  };
  const admin = createV1AgentGrantsApi({ grants, users, verifyIdToken, now: () => clock,
    agentId: () => `agt_${String(++next).padStart(32, '0')}`, secret: () => 'A'.repeat(43) });
  let beforeList;
  const taskApi = createV1TasksApi({ agents: grants, users, verifyIdToken, tasks: { ...tasks,
    async list(...args) { const result = await tasks.list(...args); await beforeList?.(); return result; },
  } });
  const request = (path, { token = 'fixture-human', method = 'GET', body, headers = {} } = {}) => {
    const req = new Request('http://fixture.invalid' + path, { method, headers: { authorization: `Bearer ${token}`, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return (path.startsWith('/api/v1/agent-grants') ? admin : taskApi).fetch(req);
  };
  const issue = async (body = { groupId: GROUP, name: 'Fixture planner' }) => request('/api/v1/agent-grants', { method: 'POST', body });
  return { firestore, grants, tasks, taskApi, admin, request, issue, seed, clock: value => { clock = value; }, beforeList: hook => { beforeList = hook; }, beforeCommit: hook => { beforeCommit = hook; } };
}

