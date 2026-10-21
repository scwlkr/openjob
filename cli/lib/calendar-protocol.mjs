// Shared response boundary for the installed CLI and the typed web facade.
const fail = () => { throw Object.assign(new Error('Provider Calendar response unavailable. Inspect saved planning before retrying.'), { code: 'invalid_response' }); };
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) => object(value) && Object.keys(value).sort().join(',') === [...expected].sort().join(',');
const text = (value, max = 512) => typeof value === 'string' && value.length <= max && value.isWellFormed() && !/[\u0000-\u001f\u007f]/.test(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const cop = value => typeof value === 'string' && /^cop_[a-f0-9]{64}$/.test(value);
const tag = value => text(value, 256) && /^"[\x21\x23-\x7e]+"$/.test(value);
function zone(value) { if (!text(value, 128) || !value) fail(); try { new Intl.DateTimeFormat('en', { timeZone: value }).format(0); } catch { fail(); } }
function calendarId(value, account) { if (!id(account) || typeof value !== 'string' || !value.startsWith(account + ':calendar:')) fail(); let upstream; try { upstream = decodeURIComponent(value.slice((account + ':calendar:').length)); } catch { fail(); } if (!text(upstream, 1024) || !upstream || upstream === 'primary' || account + ':calendar:' + encodeURIComponent(upstream) !== value) fail(); return upstream; }
function eventId(value, calendar) { if (typeof value !== 'string' || !value.startsWith(calendar + ':event:')) fail(); let upstream; try { upstream = decodeURIComponent(value.slice((calendar + ':event:').length)); } catch { fail(); } if (!text(upstream, 1024) || !upstream || calendar + ':event:' + encodeURIComponent(upstream) !== value) fail(); return upstream; }
function point(value) {
  if (!object(value)) fail(); zone(value.timeZone);
  if (value.kind === 'timed' && keys(value, ['kind', 'at', 'timeZone']) && iso(value.at)) return;
  if (value.kind === 'all-day' && keys(value, ['kind', 'date', 'timeZone']) && typeof value.date === 'string' && /^\d{4}-\d\d-\d\d$/.test(value.date) && Number.isFinite(Date.parse(value.date + 'T00:00:00Z')) && new Date(value.date + 'T00:00:00Z').toISOString().slice(0, 10) === value.date) return;
  fail();
}
function span(value, timedOnly = false, unknownEnd = false) {
  if (!keys(value, ['start', 'end'])) fail(); point(value.start);
  if (unknownEnd && value.end === null) return;
  point(value.end);
  if (value.start.kind !== value.end.kind || timedOnly && value.start.kind !== 'timed' || (value.start.kind === 'timed' ? Date.parse(value.start.at) >= Date.parse(value.end.at) : value.start.date >= value.end.date)) fail();
}
function observation(value) { if (![value.observedAt, value.expiresAt].every(iso) || Date.parse(value.expiresAt) <= Date.parse(value.observedAt) || Date.parse(value.expiresAt) - Date.parse(value.observedAt) > 60_000) fail(); }
function cursor(value) { if (value !== null && (!text(value, 8192) || !value)) fail(); }
function calendar(value, account) {
  if (!keys(value, ['id', 'accountId', 'upstreamId', 'name', 'timeZone', 'access']) || value.accountId !== account || calendarId(value.id, account) !== value.upstreamId || !text(value.name, 500) || !value.name || !['busy', 'reader', 'writer', 'writer-limited', 'owner'].includes(value.access)) fail(); zone(value.timeZone);
}
function block(value, expectedEvent) {
  if (!keys(value, ['eventId', 'etag', 'title', 'span']) || value.eventId !== expectedEvent || !tag(value.etag) || !text(value.title, 500) || !value.title.trim()) fail(); span(value.span, true);
}
export function calendarAccounts(value) {
  if (!Array.isArray(value) || value.length > 100) fail();
  for (const row of value) if (!keys(row, ['accountId', 'connectionId', 'label', 'available']) || !id(row.accountId) || !id(row.connectionId) || !text(row.label, 500) || !row.label || typeof row.available !== 'boolean') fail();
  if (new Set(value.map(row => row.accountId)).size !== value.length) fail(); return value;
}
export function calendarListPage(value, account) {
  if (!keys(value, ['calendars', 'nextCursor', 'observedAt', 'expiresAt']) || !Array.isArray(value.calendars) || value.calendars.length > 50) fail(); observation(value); cursor(value.nextCursor);
  for (const row of value.calendars) calendar(row, account);
  if (new Set(value.calendars.map(row => row.id)).size !== value.calendars.length) fail(); return value;
}
export function calendarEventsPage(value, account, target) {
  if (!keys(value, ['calendar', 'events', 'nextCursor', 'observedAt', 'expiresAt']) || value.calendar?.id !== target || !Array.isArray(value.events) || value.events.length > 50) fail(); calendar(value.calendar, account); observation(value); cursor(value.nextCursor);
  if (value.calendar.access === 'busy') fail();
  for (const row of value.events) {
    if (!keys(row, ['id', 'accountId', 'calendarId', 'upstreamId', 'etag', 'title', 'span', 'transparency', 'occurrence', 'hasAttendees']) || row.accountId !== account || row.calendarId !== target || eventId(row.id, target) !== row.upstreamId || !text(row.etag, 256) || !/^(?:W\/)?"[\x21\x23-\x7e]+"$/.test(row.etag) || !text(row.title, 4096) || !['opaque', 'transparent'].includes(row.transparency) || typeof row.hasAttendees !== 'boolean') fail();
    span(row.span, false, true); if (row.occurrence !== null) { if (!keys(row.occurrence, ['seriesId', 'originalStart']) || !text(row.occurrence.seriesId, 1024) || !row.occurrence.seriesId) fail(); point(row.occurrence.originalStart); }
  }
  if (new Set(value.events.map(row => row.id)).size !== value.events.length) fail(); return value;
}
export function calendarAvailability(value, target, window) {
  if (!keys(value, ['calendarId', 'start', 'end', 'busy', 'observedAt', 'expiresAt']) || value.calendarId !== target || value.start !== window.start || value.end !== window.end || !Array.isArray(value.busy) || value.busy.length > 1000 || ![value.start, value.end].every(iso)) fail(); observation(value);
  for (const row of value.busy) if (!keys(row, ['start', 'end']) || ![row.start, row.end].every(iso) || row.start < value.start || row.end > value.end || row.start >= row.end) fail(); return value;
}
export function remotePlanningLinks(value) {
  if (!Array.isArray(value) || value.length > 500) fail();
  for (const row of value) {
    if (!keys(row, ['targetKind', 'taskId', 'calendarId', 'eventId', 'operationId', 'state', 'confirmed']) || row.targetKind !== 'provider' || !id(row.taskId) || !cop(row.operationId) || !['reserved', 'linked', 'unknown', 'review_required'].includes(row.state)) fail();
    calendarId(row.calendarId, String(row.calendarId).split(':calendar:')[0]); if (!/^oj[a-f0-9]{64}$/.test(eventId(row.eventId, row.calendarId))) fail();
    if (row.confirmed !== null) block(row.confirmed, row.eventId); if (row.state === 'linked' && row.confirmed === null) fail();
  }
  if (new Set(value.map(row => row.taskId)).size !== value.length) fail(); return value;
}
export function calendarOperation(value, workspace, expected = {}) {
  const fields = ['id', 'workspaceId', 'taskId', 'action', 'requestId', 'calendarId', 'eventId', 'state', 'createdAt', 'updatedAt', 'dispatchBefore', 'receiptExpiresAt', 'mode', 'receiptExpired', 'receipt', ...(value?.outcome === undefined ? [] : ['outcome'])];
  if (!keys(value, fields) || !cop(value.id) || value.workspaceId !== workspace || !id(value.taskId) || !['calendar.create', 'calendar.update', 'calendar.delete'].includes(value.action) || !/^[a-f0-9-]{36}$/.test(value.requestId) || !['queued', 'executing', 'confirmed', 'rejected', 'unknown'].includes(value.state) || value.mode !== 'fixture' || typeof value.receiptExpired !== 'boolean' || !['createdAt', 'updatedAt', 'dispatchBefore', 'receiptExpiresAt'].every(key => iso(value[key]))) fail();
  if (expected.id !== undefined && value.id !== expected.id || expected.input && (value.taskId !== expected.input.taskId || value.action !== expected.input.action || value.requestId !== expected.input.requestId || expected.input.action === 'calendar.create' && value.calendarId !== expected.input.calendarId)) fail();
  calendarId(value.calendarId, String(value.calendarId).split(':calendar:')[0]); if (!/^oj[a-f0-9]{64}$/.test(eventId(value.eventId, value.calendarId))) fail();
  const terminal = ['confirmed', 'rejected', 'unknown'].includes(value.state); if (terminal !== (value.outcome !== undefined) || (value.state === 'confirmed') !== (value.receipt !== null)) fail();
  if (value.state === 'confirmed') {
    if (value.outcome !== 'provider_accepted') fail();
    if (value.action === 'calendar.delete') { if (!keys(value.receipt, ['deleted']) || value.receipt.deleted !== true) fail(); }
    else if (!keys(value.receipt, ['eventId', 'etag']) || value.receipt.eventId !== value.eventId || !tag(value.receipt.etag)) fail();
  } else if (value.state === 'unknown' && value.outcome !== 'dispatch_unknown' || value.state === 'rejected' && !['provider_rejected', 'provider_conflict', 'unsupported_event', 'authority_changed', 'payload_invalid', 'intent_expired'].includes(value.outcome)) fail();
  if (Date.parse(value.updatedAt) < Date.parse(value.createdAt) || Date.parse(value.dispatchBefore) - Date.parse(value.createdAt) !== 900_000 || Date.parse(value.receiptExpiresAt) - Date.parse(value.createdAt) !== 604_800_000) fail(); return value;
}
export function calendarPlanInput(value) {
  if (!object(value) || !id(value.taskId) || typeof value.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.requestId)) fail();
  const base = ['action', 'taskId', 'requestId'];
  if (value.action === 'calendar.create') { if (!keys(value, [...base, 'accountId', 'calendarId', 'title', 'span'])) fail(); calendarId(value.calendarId, value.accountId); }
  else if (value.action === 'calendar.update' || value.action === 'calendar.delete') { if (!keys(value, [...base, 'etag', ...(value.action === 'calendar.update' ? ['title', 'span'] : [])]) || !tag(value.etag)) fail(); }
  else fail();
  if (value.action !== 'calendar.delete') {
    if (!text(value.title, 500) || !value.title.trim() || !keys(value.span, ['start', 'end'])) fail();
    const normalized = {};
    for (const key of ['start', 'end']) {
      const point = value.span[key]; if (!keys(point, ['kind', 'at', 'timeZone']) || point.kind !== 'timed' || typeof point.at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(point.at) || !Number.isFinite(Date.parse(point.at))) fail();
      const day = point.at.slice(0, 10); if (new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) !== day || Number(point.at.slice(11, 13)) > 23 || Number(point.at.slice(14, 16)) > 59 || Number(point.at.slice(17, 19)) > 59) fail();
      normalized[key] = { ...point, at: new Date(point.at).toISOString() };
    }
    span(normalized, true); return { ...value, span: normalized };
  }
  return value;
}
export function planningDetachInput(value) {
  if (!keys(value, ['operationId', 'eventId', 'etag', 'acknowledge']) || !cop(value.operationId) || !text(value.eventId, 8192) || !value.eventId || value.etag !== null && !tag(value.etag) || value.acknowledge !== 'leave_provider_event') fail(); return value;
}
export function planningDetachReceipt(value, task, operation, expected) {
  if (!keys(value, ['taskId', 'operationId', 'eventId', 'etag', 'detachedAt', 'detached', 'providerEventLeft']) || value.taskId !== task || value.operationId !== operation || !iso(value.detachedAt) || value.detached !== true || value.providerEventLeft !== true) fail(); planningDetachInput({ operationId: value.operationId, eventId: value.eventId, etag: value.etag, acknowledge: 'leave_provider_event' });
  if (expected && (value.eventId !== expected.eventId || value.etag !== expected.etag)) fail(); return value;
}
export function planningReviewReceipt(value, task, operation, expectedEvent) {
  if (!keys(value, ['taskId', 'operationId', 'eventId', 'reviewedAt', 'relationship']) || value.taskId !== task || value.operationId !== operation || !iso(value.reviewedAt) || !['linked', 'removed'].includes(value.relationship)) fail();
  planningDetachInput({ operationId: value.operationId, eventId: value.eventId, etag: null, acknowledge: 'leave_provider_event' });
  if (expectedEvent !== undefined && value.eventId !== expectedEvent) fail(); return value;
}
