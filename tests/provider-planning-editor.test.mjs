import test from 'node:test';
import assert from 'node:assert/strict';
import { initialProviderEditor, providerUtc, canStartProviderIntent } from '../app/owned-workspaces/provider-planning-drafts.ts';
import { calendarPlanInput } from '../cli/lib/calendar-protocol.mjs';

test('a title-only provider edit preserves CLI-authored seconds and milliseconds through the shared request boundary', () => {
  const task = { id: 'task_precision', title: 'Local Task' }, confirmed = { title: 'Provider block', etag: '"original"', span: { start: { kind: 'timed', at: '2026-11-01T06:30:23.123Z', timeZone: 'America/Chicago' }, end: { kind: 'timed', at: '2026-11-01T07:30:24.456Z', timeZone: 'America/Chicago' } } };
  const editor = { ...initialProviderEditor(task, { confirmed }), title: 'Reviewed title only' };
  const input = calendarPlanInput({ action: 'calendar.update', taskId: task.id, requestId: crypto.randomUUID(), etag: editor.baseEtag, title: editor.title, span: { start: { ...confirmed.span.start, at: providerUtc(editor.start) }, end: { ...confirmed.span.end, at: providerUtc(editor.end) } } });
  assert.deepEqual(input.span, confirmed.span); assert.equal(input.title, 'Reviewed title only');
});

test('an unknown request unlocks only from its own reviewed link or exact positive removal evidence, without changing historical state', () => {
  const id = 'cop_' + 'a'.repeat(64), other = 'cop_' + 'b'.repeat(64), pending = { operation: { id, state: 'unknown' } };
  assert.equal(canStartProviderIntent(pending), false);
  assert.equal(canStartProviderIntent(pending, { operationId: id, state: 'unknown' }), false);
  assert.equal(canStartProviderIntent(pending, { operationId: other, state: 'linked' }), false);
  assert.equal(canStartProviderIntent(pending, { operationId: id, state: 'linked' }), true);
  assert.equal(canStartProviderIntent({ ...pending, reviewedRemoval: other }), false);
  const resolved = { ...pending, reviewedRemoval: id };
  assert.equal(canStartProviderIntent(resolved), true);
  // A newer relationship cannot undo the saved resolution of this old intent.
  assert.equal(canStartProviderIntent(resolved, { operationId: other, state: 'unknown' }), true);
  assert.equal(resolved.operation.state, 'unknown');
});
