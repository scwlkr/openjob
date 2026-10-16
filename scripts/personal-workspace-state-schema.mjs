// Only the two invented owners and their existing personal-domain records persist.
import { createHash } from 'node:crypto';
import { validatePersonalWorkspace } from '../shared/personal-workspace.ts';
import { parsePersonalAgentGrants } from '../shared/personal-agent-grants.ts';
import { parseTaskCalendarReceipts } from '../db/task-calendar-sync.ts';
export const STATE_LIMIT = 4 * 1024 * 1024;
const PREFIX = 'projects/openjob-dev/databases/(default)/documents/';
const methods = ['alex', 'sam'].map(owner => createHash('sha256').update(`google\0personal_browser_${owner}`).digest('base64url'));
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function exact(value, keys) { return object(value) && Object.keys(value).sort().join(',') === keys.sort().join(','); }
function fail() { throw new Error('Local workspace state is invalid or unsupported; original file preserved.'); }
function field(value, key, type) {
  if (!exact(value[key], [type])) fail();
  return value[key][type];
}
export function validateLocalSnapshot(value) {
  if (!exact(value, ['kind', 'version', 'revision', 'documents']) || value.kind !== 'openjob-local-prototype' || value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 6 || value.revision > 999000 || !Array.isArray(value.documents) || value.documents.length < 6 || value.documents.length > 8) fail();
  const records = new Map();
  for (const row of value.documents) {
    if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string' || !row[0].startsWith(PREFIX) || !exact(row[1], ['name', 'fields', 'updateTime']) || row[1].name !== row[0] || records.has(row[0])) fail();
    const match = /^2026-07-15T12:00:00\.(\d{6})Z$/.exec(row[1].updateTime);
    if (!match || Number(match[1]) < 1 || Number(match[1]) > value.revision || !object(row[1].fields)) fail();
    records.set(row[0], row[1]);
  }
  const allowed = new Set(); const owners = new Set();
  for (const method of methods) {
    const name = PREFIX + `v1SignInMethods/${method}`;
    const fields = records.get(name)?.fields;
    if (!exact(fields, ['methodId', 'provider', 'userId', 'linkedAt']) || field(fields, 'methodId', 'stringValue') !== method || field(fields, 'provider', 'stringValue') !== 'google' || !Number.isFinite(Date.parse(field(fields, 'linkedAt', 'timestampValue')))) fail();
    const owner = field(fields, 'userId', 'stringValue');
    if (!/^user_[a-f0-9]{32}$/.test(owner) || owners.has(owner)) fail();
    owners.add(owner); allowed.add(name);
    const slot = PREFIX + `v1UserSignInMethods/${owner}/providers/google`;
    if (JSON.stringify(records.get(slot)?.fields) !== JSON.stringify(fields)) fail();
    allowed.add(slot);
    const directory = PREFIX + `v1UserDirectory/${owner}`;
    const user = records.get(directory)?.fields;
    if (!exact(user, ['userId', 'emptyShellEligible', 'createdAt']) || field(user, 'userId', 'stringValue') !== owner || field(user, 'emptyShellEligible', 'booleanValue') !== true || !Number.isFinite(Date.parse(field(user, 'createdAt', 'timestampValue')))) fail();
    allowed.add(directory);
    const workspaceName = PREFIX + `v1PersonalWorkspaces/${owner}`;
    const workspace = records.get(workspaceName)?.fields;
    if (workspace) {
      if (!exact(workspace, ['ownerUserId', 'stateJson', 'grantJson', 'syncJson']) || field(workspace, 'ownerUserId', 'stringValue') !== owner) fail();
      try {
        validatePersonalWorkspace(owner, JSON.parse(field(workspace, 'stateJson', 'stringValue')));
        parsePersonalAgentGrants(owner, field(workspace, 'grantJson', 'stringValue'));
        parseTaskCalendarReceipts(owner, field(workspace, 'syncJson', 'stringValue'));
      } catch { fail(); }
      allowed.add(workspaceName);
    }
  }
  if ([...records.keys()].some(name => !allowed.has(name)) || Buffer.byteLength(JSON.stringify(value)) > STATE_LIMIT) fail();
  return value;
}
