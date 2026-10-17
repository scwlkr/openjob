import { useState } from 'react';
import type { WorkspaceView, PersonalWorkspaceCommand } from '../personal-workspace-contracts';
import { Action, Block, Confirm, Copy, Field, Row, nowSlot, validSlot } from './controls';

type Props = { view: WorkspaceView; busy: boolean; selectedId: string; command: (input: PersonalWorkspaceCommand) => Promise<boolean>; onSource: (messageId: string, accountId: string) => void };
export function Tasks({ view, busy, selectedId, command, onSource }: Props) {
  const [title, setTitle] = useState('');
  const [edit, setEdit] = useState('');
  const [editedTitle, setEditedTitle] = useState('');
  const [schedule, setSchedule] = useState('');
  const [calendarId, setCalendarId] = useState('');
  const [start, setStart] = useState(() => nowSlot().start);
  const [end, setEnd] = useState(() => nowSlot().end);
  const [deleting, setDeleting] = useState('');
  const [error, setError] = useState('');
  const selectedCalendar = calendarId || view.calendars[0]?.id || '';
  return <><Block><Copy heading>Personal Tasks</Copy><Field label="New task" value={title} onChange={setTitle} /><Action label="Add task" disabled={busy || !title.trim()} onPress={async () => { if (await command({ type: 'task.create', title })) setTitle(''); }} /></Block>
    {[...view.tasks].sort((a, b) => a.id === selectedId ? -1 : b.id === selectedId ? 1 : 0).map(task => <Block key={task.id}><Copy heading>{task.title}{selectedId === task.id ? ' · opened linked task' : ''}</Copy><Copy>{task.completed ? 'Completed' : 'Open'} · {task.scheduledSlot ? `${task.scheduledSlot.start} – ${task.scheduledSlot.end}` : 'Unscheduled'}</Copy>
      {task.notes && <Copy>{task.notes}</Copy>}
      <Row><Action label={`${task.completed ? 'Reopen' : 'Complete'} ${task.title}`} disabled={busy} onPress={() => command({ type: 'task.complete', taskId: task.id, completed: !task.completed })} />
        <Action label={`Edit ${task.title}`} disabled={busy} onPress={() => { setEdit(task.id); setEditedTitle(task.title); }} />
        <Action label={`Schedule ${task.title}`} disabled={busy} onPress={() => { const slot = task.scheduledSlot || nowSlot(); setStart(slot.start); setEnd(slot.end); setCalendarId(view.events.find(event => event.id === task.calendarEventId)?.calendarId || view.calendars[0]?.id || ''); setSchedule(task.id); setError(''); }} />
        {task.scheduledSlot && <Action label={`Unschedule ${task.title}`} disabled={busy} onPress={() => command({ type: 'task.unschedule', taskId: task.id })} />}
        <Action label={`Delete ${task.title}`} disabled={busy} onPress={() => setDeleting(task.id)} /></Row>
      {task.sourceMessageId && task.sourceAccountId && view.messages.some(message => message.id === task.sourceMessageId && message.accountId === task.sourceAccountId) && <Action label={`Open source mail for ${task.title}`} onPress={() => onSource(task.sourceMessageId!, task.sourceAccountId!)} />}
      {edit === task.id && <><Field label="Task title" value={editedTitle} onChange={setEditedTitle} /><Row><Action label="Save task title" disabled={busy || !editedTitle.trim()} onPress={async () => { if (await command({ type: 'task.update', taskId: task.id, title: editedTitle })) setEdit(''); }} /><Action label="Cancel task edit" onPress={() => setEdit('')} /></Row></>}
      {deleting === task.id && <Confirm busy={busy} label="Confirm delete task" message="Delete this task and its linked calendar block? Source Mail is kept." onCancel={() => setDeleting('')} onConfirm={async () => { if (await command({ type: 'task.delete', taskId: task.id })) setDeleting(''); }} />}
    </Block>)}
    {!view.tasks.length && <Copy>No personal tasks yet.</Copy>}
    {schedule && view.tasks.some(task => task.id === schedule) && <Block><Copy heading>Schedule task</Copy><Copy>{view.tasks.find(task => task.id === schedule)?.title}</Copy><Row>{view.calendars.map(calendar => <Action key={calendar.id} label={`Use calendar ${calendar.name}`} selected={selectedCalendar === calendar.id} onPress={() => setCalendarId(calendar.id)} />)}</Row><Field label="Task start UTC ISO" value={start} onChange={setStart} /><Field label="Task end UTC ISO" value={end} onChange={setEnd} />{error ? <Copy>{error}</Copy> : null}<Action label="Save task schedule" disabled={busy} onPress={async () => { if (!validSlot(start, end)) { setError('Use valid UTC ISO times with the end after the start.'); return; } if (await command({ type: 'task.schedule', taskId: schedule, calendarId: selectedCalendar, start: new Date(start).toISOString(), end: new Date(end).toISOString() })) setSchedule(''); }} /><Action label="Cancel task schedule" onPress={() => setSchedule('')} /></Block>}
  </>;
}
