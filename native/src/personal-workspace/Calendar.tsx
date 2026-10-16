import { useState } from 'react';
import type { WorkspaceView, PersonalWorkspaceCommand } from '../personal-workspace-contracts';
import { Action, Block, Confirm, Copy, Field, Row, nowSlot, validSlot } from './controls';

type Props = { view: WorkspaceView; busy: boolean; command: (input: PersonalWorkspaceCommand) => Promise<boolean>; onTask: (id: string) => void };
export function Calendar({ view, busy, command, onTask }: Props) {
  const [title, setTitle] = useState('');
  const [editing, setEditing] = useState('');
  const [calendarId, setCalendarId] = useState('');
  const [start, setStart] = useState(() => nowSlot().start);
  const [end, setEnd] = useState(() => nowSlot().end);
  const [deleting, setDeleting] = useState('');
  const [error, setError] = useState('');
  const selectedCalendar = calendarId || view.calendars[0]?.id || '';
  return <><Copy heading>Personal Calendar · UTC agenda</Copy>
    {[...view.events].sort((a,b) => a.start.localeCompare(b.start)).map(event => {
      const task = view.tasks.find(item => item.id === event.taskId && item.calendarEventId === event.id && view.calendars.some(calendar => calendar.id === event.calendarId && calendar.ownerId === item.ownerId));
      return <Block key={event.id}><Copy heading>{event.title}</Copy><Copy>{event.start} – {event.end}{'\n'}{view.calendars.find(item => item.id === event.calendarId)?.name}{task ? ' · linked Task' : ''}</Copy>
        <Row>{task && <Action label={`Open linked task ${event.title}`} onPress={() => onTask(task.id)} />}<Action label={`Edit block ${event.title}`} disabled={busy} onPress={() => { setEditing(event.id); setTitle(event.title); setCalendarId(event.calendarId); setStart(event.start); setEnd(event.end); setError(''); }} /><Action label={`Delete block ${event.title}`} disabled={busy} onPress={() => setDeleting(event.id)} /></Row>
        {deleting === event.id && <Confirm message="Delete this calendar block? A linked Task will remain unscheduled." label="Confirm delete block" busy={busy} onCancel={() => setDeleting('')} onConfirm={async () => { if (await command({ type: 'calendar.delete', eventId: event.id })) { setDeleting(''); if (editing === event.id) { setEditing(''); setTitle(''); } } }} />}
      </Block>;
    })}
    {!view.events.length && <Copy>No personal calendar blocks yet.</Copy>}
    <Block><Copy heading>{editing ? 'Edit calendar block' : 'Create calendar block'}</Copy><Field label="Calendar block title" value={title} onChange={setTitle} />
      <Row>{view.calendars.map(item => <Action key={item.id} label={`Block calendar ${item.name}`} selected={selectedCalendar === item.id} disabled={Boolean(editing)} onPress={() => setCalendarId(item.id)} />)}</Row>
      <Field label="Block start UTC ISO" value={start} onChange={setStart} /><Field label="Block end UTC ISO" value={end} onChange={setEnd} />{error ? <Copy>{error}</Copy> : null}
      <Action label="Save calendar block" disabled={busy || !title.trim()} onPress={async () => { if (!validSlot(start, end)) { setError('Use valid UTC ISO times with the end after the start.'); return; } const input: PersonalWorkspaceCommand = editing ? { type: 'calendar.update', eventId: editing, title, start: new Date(start).toISOString(), end: new Date(end).toISOString() } : { type: 'calendar.create', calendarId: selectedCalendar, title, start: new Date(start).toISOString(), end: new Date(end).toISOString() }; if (await command(input)) { setEditing(''); setTitle(''); } }} />
      {editing && <Action label="Cancel block edit" onPress={() => { setEditing(''); setTitle(''); }} />}
    </Block>
  </>;
}
