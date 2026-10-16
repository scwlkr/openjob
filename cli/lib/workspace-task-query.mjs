/** @typedef {{status:'all'|'open'|'completed',search:string,scheduledOn?:string}} WorkspaceTaskQuery */

/** @returns {never} */
function invalid() {
  throw Object.assign(new Error('Invalid workspace task filters.'), { code: 'invalid_input' });
}

/** Normalize presentation filters without accepting owner, scope or provider inputs.
 * @param {unknown} [input]
 * @returns {WorkspaceTaskQuery}
 */
export function normalizeWorkspaceTaskQuery(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) invalid();
  if (Reflect.ownKeys(input).some(key => !['status', 'search', 'scheduledOn'].includes(String(key)))) invalid();
  const candidate = /** @type {Record<string, unknown>} */ (input);
  const status = candidate.status === undefined ? 'all' : candidate.status;
  const search = candidate.search === undefined ? '' : candidate.search;
  if (typeof status !== 'string' || !['all', 'open', 'completed'].includes(status) || typeof search !== 'string' || search.trim().length > 200) invalid();
  const result = /** @type {WorkspaceTaskQuery} */ ({ status, search: search.trim() });
  const scheduledOn = candidate.scheduledOn;
  if (scheduledOn !== undefined && scheduledOn !== '') {
    if (typeof scheduledOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(scheduledOn) || Number(scheduledOn.slice(0, 4)) < 1) invalid();
    const day = new Date(scheduledOn + 'T00:00:00.000Z');
    if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== scheduledOn) invalid();
    result.scheduledOn = scheduledOn;
  }
  return result;
}

/** Filter an already authorized snapshot; keep stable order and original record fields.
 * @template {{title:string,completed:boolean,scheduledSlot?:{start:string,end:string}}} T
 * @param {readonly T[]} tasks
 * @param {unknown} [input]
 * @returns {T[]}
 */
export function filterWorkspaceTasks(tasks, input = {}) {
  const query = normalizeWorkspaceTaskQuery(input);
  if (!Array.isArray(tasks)) invalid();
  const search = query.search.toLowerCase();
  const dayStart = query.scheduledOn ? Date.parse(query.scheduledOn + 'T00:00:00.000Z') : undefined;
  return tasks.filter(task => {
    if (query.status === 'open' && task.completed || query.status === 'completed' && !task.completed) return false;
    if (search && !task.title.toLowerCase().includes(search)) return false;
    if (dayStart !== undefined) {
      const slot = task.scheduledSlot;
      if (!slot) return false;
      const start = Date.parse(slot.start), end = Date.parse(slot.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start >= dayStart + 86400000 || end <= dayStart) return false;
    }
    return true;
  });
}
