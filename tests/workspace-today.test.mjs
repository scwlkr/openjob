import test from 'node:test';
import assert from 'node:assert/strict';
import { personalToday } from '../shared/workspace-today.ts';
import { createEmptyPersonalWorkspace } from '../shared/personal-workspace.ts';

test('Today uses local midnight/DST, preserves history and excludes unavailable calendars', () => {
  const old = process.env.TZ; process.env.TZ = 'America/Chicago';
  try {
    const view = createEmptyPersonalWorkspace('alex');
    const slot = { start: '2027-03-15T04:00:00Z', end: '2027-03-15T04:30:00Z' };
    view.tasks = [
      { id: 'planned', ownerId: 'alex', title: 'Local evening', completed: false, scheduledSlot: slot },
      { id: 'completed', ownerId: 'alex', title: 'Done', completed: true, scheduledSlot: slot },
      { id: 'unplanned', ownerId: 'alex', title: 'Choose time', completed: false },
      { id: 'tomorrow', ownerId: 'alex', title: 'Future', completed: false, scheduledSlot: { start: '2027-03-15T05:00:00Z', end: '2027-03-15T05:30:00Z' } },
    ];
    view.events = [
      { id: 'today', calendarId: 'personal', title: 'Late work', ...slot },
      { id: 'hidden', calendarId: 'unavailable', title: 'Do not show', ...slot },
      { id: 'end', calendarId: 'personal', title: 'Ends at midnight', start: '2027-03-14T05:00:00Z', end: '2027-03-14T06:00:00Z' },
    ];
    const before = structuredClone(view);
    const result = personalToday(view, new Date('2027-03-14T16:00:00Z'));
    assert.equal((result.end - result.start) / 3600000, 23);
    assert.deepEqual(result.planned.map(t => t.id), ['planned']);
    assert.deepEqual(result.unplanned.map(t => t.id), ['unplanned']);
    assert.deepEqual(result.events.map(t => t.id), ['today']);
    assert.deepEqual(view, before);
    assert.equal((personalToday(view, new Date('2027-11-07T16:00:00Z')).end - personalToday(view, new Date('2027-11-07T16:00:00Z')).start) / 3600000, 25);
  } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; }
});
